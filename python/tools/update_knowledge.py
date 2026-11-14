"""Explicitly apply edits from data/knowledge.json to the SQLite knowledge table."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from DB.database import init_db,connection
from config import KNOWLEDGE_PATH
init_db()
items=json.loads(KNOWLEDGE_PATH.read_text(encoding='utf-8'))
with connection() as db:
 for item in items:
  db.execute('''INSERT INTO knowledge_items(category,title,content,keywords,difficulty) VALUES(?,?,?,?,?)
    ON CONFLICT(title) DO UPDATE SET category=excluded.category,content=excluded.content,keywords=excluded.keywords,difficulty=excluded.difficulty''',tuple(item[k] for k in ('category','title','content','keywords','difficulty')))
print(f'Applied {len(items)} knowledge entries. Reminders were not changed.')
