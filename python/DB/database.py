import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from config import DB_PATH, KNOWLEDGE_PATH

@contextmanager
def connection():
    DB_PATH.parent.mkdir(parents=True,exist_ok=True)
    conn=sqlite3.connect(DB_PATH,timeout=15);conn.row_factory=sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback();raise
    finally: conn.close()

def init_db():
    with connection() as db:
        db.execute("CREATE TABLE IF NOT EXISTS tracker_state (user_id TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT NOT NULL, reminder_time TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, user_id TEXT NOT NULL DEFAULT 'local', request_id TEXT)")
        columns={r[1] for r in db.execute("PRAGMA table_info(reminders)")}
        if 'user_id' not in columns: db.execute("ALTER TABLE reminders ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local'")
        if 'request_id' not in columns: db.execute("ALTER TABLE reminders ADD COLUMN request_id TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS reminders_request ON reminders(user_id,request_id)")
        db.execute("CREATE TABLE IF NOT EXISTS knowledge_items (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title TEXT NOT NULL UNIQUE, content TEXT NOT NULL, keywords TEXT NOT NULL, difficulty TEXT DEFAULT 'general')")
        # Existing knowledge edits remain intact. Add missing starter entries only.
        for item in json.loads(KNOWLEDGE_PATH.read_text(encoding='utf-8')):
            db.execute("INSERT OR IGNORE INTO knowledge_items(category,title,content,keywords,difficulty) VALUES(?,?,?,?,?)",tuple(item[k] for k in ('category','title','content','keywords','difficulty')))

def save_reminder(task,reminder_time,user_id='local',request_id=None):
    task=task.strip()
    if not task or len(task)>300: raise ValueError('Use a task of 1 to 300 characters.')
    # Manager/API validates timezone and future date before persistence.
    with connection() as db:
        db.execute("INSERT OR IGNORE INTO reminders(task,reminder_time,user_id,request_id) VALUES(?,?,?,?)",(task,reminder_time,user_id,request_id))
        if request_id:
            return db.execute("SELECT id FROM reminders WHERE user_id=? AND request_id=?",(user_id,request_id)).fetchone()['id']
        return db.execute('SELECT last_insert_rowid()').fetchone()[0]

def get_all_reminders(user_id='local'):
    with connection() as db:
        rows=[dict(r) for r in db.execute("SELECT id,task,reminder_time,created_at FROM reminders WHERE user_id=? ORDER BY reminder_time,id",(user_id,))]
    for r in rows:
        try:
            d=datetime.fromisoformat(r['reminder_time'].replace('Z','+00:00'))
            if d.tzinfo is not None: r['reminder_time']=d.astimezone(timezone.utc).isoformat()
        except ValueError:
            # Legacy HH:MM records need review; do not invent a date silently.
            r['needs_date']=True
    return rows

def delete_reminder_by_id(reminder_id,user_id='local'):
    with connection() as db: return db.execute("DELETE FROM reminders WHERE id=? AND user_id=?",(reminder_id,user_id)).rowcount

def get_knowledge_by_category(category):
    with connection() as db: return [dict(r) for r in db.execute("SELECT * FROM knowledge_items WHERE category=? ORDER BY id",(category,))]
