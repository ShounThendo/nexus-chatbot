import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("CHATBOT_DB_PATH", str(ROOT / "DB" / "chatbot.db")))
DEFAULT_TIMEZONE = os.getenv("CHATBOT_TIMEZONE", "Africa/Johannesburg")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen3:1.7b")
OLLAMA_TIMEOUT = int(os.getenv("OLLAMA_TIMEOUT", "120"))
WEATHER_TIMEOUT = 12
KNOWLEDGE_PATH = ROOT / "data" / "knowledge.json"
MAX_TURNS = 4
MAX_HISTORY_CHARACTERS = 6000
