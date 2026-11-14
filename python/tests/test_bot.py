import sys
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from contextlib import closing
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from NLP.intent import detect_intent,parse_reminder_time
from NLP.retrieval import retrieve_knowledge
from Dialogue.manager import handle_intent
from DB import database as db
from main import remember_turn
from server import Handler,ThreadingHTTPServer,_sessions

class BotTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.old=db.DB_PATH;db.DB_PATH=Path(self.temp.name)/'test.db';db.init_db()
 def tearDown(self):db.DB_PATH=self.old;self.temp.cleanup()
 def test_routing_avoids_keyword_hijacking(self):
  for text in ['my name is Sam','I am working on my project','I am tired','I ate a meal today']:
   self.assertEqual(detect_intent(text)['intent'],'unknown')
  self.assertEqual(detect_intent('give me a study tip')['entities']['category'],'study')
  self.assertEqual(detect_intent('find exercises for chest')['intent'],'search_exercises')
  self.assertEqual(detect_intent('weather in Cape Town tomorrow')['entities']['city'],'Cape Town')
 def test_reminder_timezone_and_invalid_times(self):
  now=datetime(2030,1,1,10,tzinfo=timezone.utc)
  self.assertEqual(parse_reminder_time('18:00 tomorrow','Africa/Johannesburg',now),'2030-01-02T16:00:00+00:00')
  self.assertEqual(parse_reminder_time('in 15 minutes','Africa/Johannesburg',now),'2030-01-01T10:15:00+00:00')
  for text in ['25:00','12:90','bad','2020-01-01T00:00:00Z']:
   with self.assertRaises(ValueError):parse_reminder_time(text,'Africa/Johannesburg',now)
 def test_scoped_reminders_and_retry(self):
  one=db.save_reminder('Study','2035-01-01T18:00:00Z','alice','req-1');two=db.save_reminder('Study','2035-01-01T18:00:00Z','alice','req-1')
  self.assertEqual(one,two);self.assertEqual(len(db.get_all_reminders('alice')),1);self.assertEqual(db.get_all_reminders('bob'),[])
  self.assertEqual(db.delete_reminder_by_id(one,'bob'),0);self.assertEqual(db.delete_reminder_by_id(one,'alice'),1)
 def test_legacy_database_migrates_without_losing_records(self):
  db.DB_PATH=Path(self.temp.name)/'old.db'
  with closing(sqlite3.connect(db.DB_PATH)) as conn, conn:conn.execute('CREATE TABLE reminders(id INTEGER PRIMARY KEY,task TEXT,reminder_time TEXT,created_at TIMESTAMP)');conn.execute("INSERT INTO reminders VALUES(1,'Existing task','18:00',CURRENT_TIMESTAMP)")
  db.init_db();records=db.get_all_reminders();self.assertEqual(records[0]['task'],'Existing task');self.assertTrue(records[0]['needs_date']);db.init_db();self.assertEqual(len(db.get_all_reminders()),1)
 def test_retrieval_and_manager(self):
  self.assertEqual(retrieve_knowledge('workout','beginner chest')[0]['title'],'Beginner Chest Workout')
  result=handle_intent({'intent':'set_reminder','entities':{'task':'Study','reminder_time':'2035-01-01T18:00:00Z'}},user_id='alice',request_id='abc')
  self.assertIn('saved',result);self.assertEqual(len(db.get_all_reminders('alice')),1)
  self.assertIn('No reminders',handle_intent({'intent':'list_reminders'},user_id='bob'))
 def test_weather_clarification_and_followup(self):
  ctx={};self.assertIn('Which city',handle_intent({'intent':'get_weather','entities':{}},context=ctx))
  with patch('Dialogue.manager.get_weather',return_value=('Weather reply','Cape Town')) as api:
   self.assertEqual(handle_intent({'intent':'unknown','entities':{'original_text':'Cape Town'}},context=ctx),'Weather reply')
   handle_intent({'intent':'unknown','entities':{'original_text':'what about tomorrow'}},context=ctx);self.assertEqual(api.call_args.args[1],'tomorrow')
 def test_history_keeps_pairs_and_limits(self):
  history=[]
  for i in range(10):remember_turn(history,str(i),'reply')
  self.assertEqual(len(history),8);self.assertEqual(history[0]['content'],'6')
  remember_turn(history,'long','x'*7000);self.assertEqual(history,[])
 def test_web_api_contract_and_cookie_isolation(self):
  server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
  try:
   def call(payload,cookie=''):
    req=urllib.request.Request(base+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Cookie':cookie},method='POST')
    with urllib.request.urlopen(req) as response:return json.load(response),response.headers.get('Set-Cookie','').split(';')[0]
   payload={'message':'add reminder','session_id':'s','request_id':'r','intent':'set_reminder','entities':{'task':'Test task','reminder_time':'2035-01-01T18:00:00Z'}}
   result,cookie=call(payload);self.assertEqual(len(result['reminders']),1)
   retry,_=call(payload,cookie);self.assertEqual(result,retry)
   other,_=call({'message':'show my reminders','session_id':'other'});self.assertEqual(other['reminders'],[])
   result,_=call({'message':'show my reminders','session_id':'s'},cookie);self.assertEqual(len(result['reminders']),1)
   req=urllib.request.Request(base+'/api/chat',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':'https://other.example'},method='POST')
   with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(req)
   self.assertEqual(error.exception.code,403)
  finally:server.shutdown();server.server_close();_sessions.clear()

if __name__=='__main__':unittest.main()
