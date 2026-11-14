"""User-scoped tracker document, validated and saved with optimistic locking.

Keep tracker records separate from reminders/knowledge. The JSON schema matches
frontend/tracker-model.js; source='manual' leaves a clear future import boundary.
"""
import json
import math
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from DB.database import connection

class TrackerConflict(ValueError):
    pass

def empty_trackers():
    return {'version':1,'habits':[],'completions':[],'sleep':[], 'preferences':{'sleepGoal':8}}

def validate_trackers(data, now=None):
    now = now or datetime.now(timezone.utc)
    def require(ok, message):
        if not ok: raise ValueError(message)
    def valid_id(value):
        return isinstance(value,str) and re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',value)
    def valid_date(value):
        try: return isinstance(value,str) and len(value)==10 and date.fromisoformat(value).isoformat()==value
        except ValueError: return False
    require(isinstance(data,dict) and data.get('version')==1, 'Unsupported tracker data.')
    require(all(isinstance(data.get(key),list) for key in ('habits','completions','sleep')), 'Invalid tracker records.')
    require(len(data['habits'])<=100 and len(data['completions'])<=40000 and len(data['sleep'])<=10000, 'Tracker storage limit reached.')
    habits=[]; ids=set(); names=set()
    for h in data['habits']:
        require(isinstance(h,dict) and valid_id(h.get('id')) and h['id'] not in ids, 'Invalid or duplicate habit ID.')
        name=h.get('name')
        require(isinstance(name,str) and 1<=len(name.strip())<=60,'Use a habit name of 1–60 characters.')
        name=name.strip()
        require(name.lower() not in names,'A habit with that name already exists.')
        require(type(h.get('weeklyTarget')) is int and 1<=h['weeklyTarget']<=7,'Choose a weekly target between 1 and 7 days.')
        require(valid_date(h.get('startDate')),'Choose a valid habit start date.')
        ids.add(h['id']); names.add(name.lower())
        habits.append({'id':h['id'],'name':name,'weeklyTarget':h['weeklyTarget'],'startDate':h['startDate']})
    by_id={h['id']:h for h in habits}; seen=set(); completions=[]
    latest=(now+timedelta(hours=14)).date().isoformat()
    for c in data['completions']:
        require(isinstance(c,dict) and isinstance(c.get('habitId'),str) and c['habitId'] in by_id,'Unknown completion habit.')
        day=c.get('date'); hid=c['habitId']
        require(valid_date(day) and by_id[hid]['startDate']<=day<=latest,'Invalid completion date.')
        require((hid,day) not in seen,'Duplicate habit completion.')
        seen.add((hid,day)); completions.append({'habitId':hid,'date':day})
    sleep=[]; sleep_ids=set()
    for s in data['sleep']:
        require(isinstance(s,dict) and valid_id(s.get('id')) and s['id'] not in sleep_ids,'Invalid or duplicate sleep ID.')
        stamps=[]
        for key in ('bedtime','wakeTime'):
            value=s.get(key)
            require(isinstance(value,str) and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z',value),'Enter complete bedtime and wake-up dates and times.')
            try: stamps.append(datetime.fromisoformat(value.replace('Z','+00:00')))
            except ValueError as error: raise ValueError('Invalid sleep timestamp.') from error
        start,end=stamps
        require(timedelta(0)<end-start<=timedelta(hours=24),'Wake-up must be after bedtime, with a duration of no more than 24 hours.')
        require(end<=now,'Log sleep after you wake up. Future sessions cannot be saved.')
        require(isinstance(s.get('timeZone'),str),'Invalid sleep timezone.')
        try: wake_date=end.astimezone(ZoneInfo(s['timeZone'])).date().isoformat()
        except (KeyError,ValueError) as error: raise ValueError('Invalid sleep timezone.') from error
        require(wake_date==s.get('wakeDate'),'Sleep date must match the wake-up date.')
        require(type(s.get('quality')) is int and 1<=s['quality']<=5,'Choose a sleep quality from 1 to 5.')
        require(isinstance(s.get('notes'),str) and len(s['notes'])<=1000 and s.get('source')=='manual','Invalid sleep notes or source.')
        sleep_ids.add(s['id'])
        sleep.append({key:s[key] for key in ('id','bedtime','wakeTime','wakeDate','timeZone','quality','source')} | {'notes':s['notes'].strip()})
    sleep.sort(key=lambda s:s['bedtime'])
    for previous,current in zip(sleep,sleep[1:]):
        require(datetime.fromisoformat(current['bedtime'].replace('Z','+00:00'))>=datetime.fromisoformat(previous['wakeTime'].replace('Z','+00:00')),'This sleep session overlaps an existing record.')
    prefs=data.get('preferences')
    goal=prefs.get('sleepGoal') if isinstance(prefs,dict) else None
    require(type(goal) in (int,float) and math.isfinite(goal) and 1<=goal<=16 and goal*4==int(goal*4),'Choose a sleep goal of 1–16 hours in 15-minute steps.')
    return {'version':1,'habits':habits,'completions':completions,'sleep':sleep,'preferences':{'sleepGoal':goal}}

def get_trackers(user_id):
    with connection() as db:
        row=db.execute('SELECT data,revision FROM tracker_state WHERE user_id=?',(user_id,)).fetchone()
    return {'state':json.loads(row['data']),'revision':row['revision']} if row else {'state':empty_trackers(),'revision':0}

def save_trackers(user_id, payload):
    if not isinstance(payload,dict) or type(payload.get('revision')) is not int or payload['revision']<0:
        raise ValueError('Invalid tracker revision.')
    state=validate_trackers(payload.get('state')); revision=payload['revision']
    with connection() as db:
        db.execute('INSERT OR IGNORE INTO tracker_state(user_id,data,revision) VALUES(?,?,0)',(user_id,json.dumps(empty_trackers())))
        result=db.execute('UPDATE tracker_state SET data=?,revision=revision+1 WHERE user_id=? AND revision=?',(json.dumps(state),user_id,revision))
        if result.rowcount!=1: raise TrackerConflict('Records changed elsewhere. Reload, then apply your change again.')
    return {'state':state,'revision':revision+1}
