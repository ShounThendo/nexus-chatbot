import copy
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from DB import database as db
from DB.trackers import empty_trackers,validate_trackers,get_trackers,save_trackers,TrackerConflict
from server import Handler,ThreadingHTTPServer

class TrackerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.old=db.DB_PATH;db.DB_PATH=Path(self.temp.name)/'test.db';db.init_db()
    def tearDown(self):
        db.DB_PATH=self.old;self.temp.cleanup()
    def sample(self):
        state=empty_trackers();state['habits']=[{'id':'gym','name':'Gym','weeklyTarget':3,'startDate':'2026-01-01'}]
        state['completions']=[{'habitId':'gym','date':'2026-01-02'}]
        state['sleep']=[{'id':'night','bedtime':'2026-01-02T20:00:00.000Z','wakeTime':'2026-01-03T04:00:00.000Z','wakeDate':'2026-01-03','timeZone':'Africa/Johannesburg','quality':4,'notes':'Rested','source':'manual'}]
        state['preferences']['sleepGoal']=7.5
        return state
    def test_new_table_preserves_existing_reminders_and_knowledge(self):
        rid=db.save_reminder('Keep this','2035-01-01T12:00:00Z');before=db.get_knowledge_by_category('study');db.init_db()
        self.assertEqual(db.get_all_reminders()[0]['id'],rid);self.assertEqual(db.get_knowledge_by_category('study'),before)
        self.assertEqual(get_trackers('alice'),{'state':empty_trackers(),'revision':0})
    def test_persistence_scope_and_revision_conflicts(self):
        state=self.sample();saved=save_trackers('alice',{'state':state,'revision':0});self.assertEqual(saved['revision'],1)
        self.assertEqual(get_trackers('alice')['state'],state);self.assertEqual(get_trackers('bob')['state'],empty_trackers())
        with self.assertRaises(TrackerConflict):save_trackers('alice',{'state':empty_trackers(),'revision':0})
        self.assertEqual(get_trackers('alice')['state'],state)
        db.init_db();self.assertEqual(get_trackers('alice')['state'],state)
    def test_validation_cross_midnight_timezone_and_overlap(self):
        now=datetime(2026,10,11,tzinfo=timezone.utc);state=self.sample();self.assertEqual(validate_trackers(state,now),state)
        r=copy.deepcopy(state['sleep'][0]);r['id']='overlap';r['bedtime']='2026-01-02T22:00:00.000Z';state['sleep'].append(r)
        with self.assertRaisesRegex(ValueError,'overlaps'):validate_trackers(state,now)
        for key,value in [('wakeTime','2035-01-03T04:00:00.000Z'),('wakeTime','2026-01-02T19:00:00.000Z'),('wakeDate','2026-01-04'),('quality',True),('timeZone','not/a/zone')]:
            state=self.sample();state['sleep'][0][key]=value
            with self.assertRaises(ValueError):validate_trackers(state,now)
    def test_invalid_targets_dates_duplicate_records_and_goals(self):
        for goal in [True,0,17,8.1,'8',float('nan')]:
            state=self.sample();state['preferences']['sleepGoal']=goal
            with self.assertRaises(ValueError):validate_trackers(state)
        state=self.sample();state['completions'].append(state['completions'][0])
        with self.assertRaises(ValueError):validate_trackers(state)
        state=self.sample();state['completions'][0]['date']='2026-02-30'
        with self.assertRaises(ValueError):validate_trackers(state)
        state=self.sample();state['habits'][0]['weeklyTarget']=8
        with self.assertRaises(ValueError):validate_trackers(state)
    def test_http_roundtrip_cookie_scope_rejections_and_static_assets(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'http://127.0.0.1:{server.server_port}'
        def call(path,body=None,cookie='',origin=None):
            headers={'Content-Type':'application/json','Cookie':cookie}
            if origin:headers['Origin']=origin
            req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
            with urllib.request.urlopen(req) as response:return json.load(response),response.headers.get('Set-Cookie','').split(';')[0]
        try:
            status,cookie=call('/api/status');self.assertTrue(status['trackers'])
            saved,_=call('/api/trackers',{'state':self.sample(),'revision':0},cookie);self.assertEqual(saved['revision'],1)
            loaded,_=call('/api/trackers',cookie=cookie);self.assertEqual(loaded['state'],self.sample())
            other,_=call('/api/trackers');self.assertEqual(other['state'],empty_trackers())
            for body,origin,status_code in [({'state':empty_trackers(),'revision':0},None,409),({'state':{},'revision':1},None,400),({'state':empty_trackers(),'revision':1},'https://other.example',403)]:
                with self.assertRaises(urllib.error.HTTPError) as error:call('/api/trackers',body,cookie,origin)
                self.assertEqual(error.exception.code,status_code)
            for path,marker in [('/',b'view-progress'),('/trackers.js',b'initTrackers'),('/trackers.css',b'.habit-calendar'),('/tracker-model.js',b'validateTrackers')]:
                with urllib.request.urlopen(base+path) as response:self.assertIn(marker,response.read())
            reply,_=call('/api/chat',{'message':'show my reminders','session_id':'existing-chat'},cookie);self.assertIn('No reminders',reply['reply'])
        finally:server.shutdown();server.server_close()
