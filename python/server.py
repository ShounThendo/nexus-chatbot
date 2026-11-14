"""Dependency-free local web API. Defaults to loopback; not a public auth service."""
import hashlib
import json
import os
import secrets
import threading
import time
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from config import ROOT,DEFAULT_TIMEZONE
from DB.database import init_db,get_all_reminders
from NLP.intent import detect_intent
from Dialogue.manager import handle_intent
from main import remember_turn
from DB.trackers import get_trackers,save_trackers,TrackerConflict

_sessions={};_lock=threading.Lock()
FRONTEND=ROOT/'frontend'
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(FRONTEND),**kwargs)
    def identity(self):
        jar=SimpleCookie()
        try:jar.load(self.headers.get('Cookie',''))
        except Exception:pass
        token=jar.get('everyday_client');value=token.value if token else ''
        if len(value)<32 or len(value)>100:value=secrets.token_urlsafe(32)
        self._cookie=f'everyday_client={value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000'
        return 'web:'+hashlib.sha256(value.encode()).hexdigest()
    def json_response(self,data,status=200):
        raw=json.dumps(data).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        if getattr(self,'_cookie',None):self.send_header('Set-Cookie',self._cookie)
        self.end_headers();self.wfile.write(raw)
    def do_GET(self):
        path=urlsplit(self.path).path
        if path=='/api/status':self.identity();self.json_response({'mode':'python','signed_in':False,'reminder_storage':'python','generative':'ollama','weather':True,'fitness':True,'trackers':True});return
        if path=='/api/trackers':
            try:self.json_response(get_trackers(self.identity()))
            except Exception:self.json_response({'error':'Tracker records could not be loaded.'},503)
            return
        if path=='/api/reminders':uid=self.identity();self.json_response({'reminders':[r for r in get_all_reminders(uid) if not r.get('needs_date')]});return
        if path.startswith('/api/'):self.json_response({'error':'Not found'},404);return
        super().do_GET()
    def do_POST(self):
        if urlsplit(self.path).path=='/api/trackers':self.tracker_post();return
        if urlsplit(self.path).path!='/api/chat':self.json_response({'error':'Not found'},404);return
        origin=self.headers.get('Origin')
        if origin and urlsplit(origin).netloc!=self.headers.get('Host'):self.json_response({'error':'Use the frontend served by this Python server.'},403);return
        if 'application/json' not in self.headers.get('Content-Type',''):self.json_response({'error':'Send application/json.'},415);return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=24000:raise ValueError('Request too large or empty.')
            data=json.loads(self.rfile.read(length));message=data.get('message','').strip()
            if not message or len(message)>2000:raise ValueError('Use a message of 1 to 2,000 characters.')
            uid=self.identity();sid=data.get('session_id','')
            if not isinstance(sid,str) or len(sid)>100:raise ValueError('Invalid session ID.')
            with _lock:
                cutoff=time.time()-3600
                for key in list(_sessions):
                    if _sessions[key]['at']<cutoff:del _sessions[key]
                if len(_sessions)>1000:raise ValueError('Server busy. Please try again later.')
                s=_sessions.setdefault((uid,sid),{'history':[],'context':{},'at':time.time(),'lock':threading.Lock(),'responses':{}})
            with s['lock']:
                s['at']=time.time();s['context']['timezone']=data.get('timezone') or DEFAULT_TIMEZONE
                request_id=data.get('request_id')
                if request_id is not None and (not isinstance(request_id,str) or len(request_id)>100):raise ValueError('Invalid request ID.')
                if request_id and request_id in s['responses']:self.json_response(s['responses'][request_id]);return
                intent=detect_intent(message,s['context']['timezone'])
                if data.get('intent') in {'set_reminder','list_reminders','delete_reminder'}:
                    entities=data.get('entities') or {}
                    if data['intent']=='delete_reminder':entities={'id':int(entities['id'])}
                    if data['intent']=='set_reminder':entities={'task':str(entities.get('task','')),'reminder_time':str(entities.get('reminder_time',''))}
                    intent={'intent':data['intent'],'entities':entities}
                response=handle_intent(intent,s['history'],user_id=uid,context=s['context'],request_id=request_id)
                reply=response if isinstance(response,str) else ''.join(response)
                remember_turn(s['history'],message,reply)
                body={'reply':reply,'reminders':[r for r in get_all_reminders(uid) if not r.get('needs_date')],'route':s['context'].get('last_source'),'reminder_storage':'python'}
                if request_id:
                    s['responses'][request_id]=body
                    while len(s['responses'])>100:del s['responses'][next(iter(s['responses']))]
                self.json_response(body)
        except (ValueError,TypeError,KeyError) as error:self.json_response({'error':str(error)},400)
        except RuntimeError as error:self.json_response({'error':str(error)},503)
        except Exception:self.json_response({'error':'The server encountered an error. Check the Python terminal.'},500)


    def tracker_post(self):
        origin=self.headers.get('Origin')
        if origin and urlsplit(origin).netloc!=self.headers.get('Host'):
            self.json_response({'error':'Use the frontend served by this Python server.'},403);return
        if not self.headers.get('Content-Type','').startswith('application/json'):
            self.json_response({'error':'Send application/json.'},415);return
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=3000000:
                self.json_response({'error':'Tracker data is empty or too large.'},413);return
            data=json.loads(self.rfile.read(length))
            self.json_response(save_trackers(self.identity(),data))
        except TrackerConflict as error:self.json_response({'error':str(error)},409)
        except (ValueError,TypeError,KeyError) as error:self.json_response({'error':str(error)},400)
        except Exception:self.json_response({'error':'Tracker changes could not be saved.'},503)

def run():
    init_db();port=int(os.getenv('CHATBOT_PORT','8000'))
    print(f'Nexus is ready: http://127.0.0.1:{port}\nKeep this terminal open. Press Ctrl+C to stop.')
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':run()
