"""Rules recognise actions. Ordinary conversation goes to generative AI."""
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from config import DEFAULT_TIMEZONE

CATEGORIES = {
    "workout": {"workout", "exercise", "fitness", "gym", "pushup", "pushups", "squat", "squats", "chest", "legs", "bodyweight"},
    "study": {"study", "studying", "revision", "revise", "exam", "focus", "concentration", "procrastination", "flashcards", "pomodoro"},
    "sleep": {"sleep", "sleeping", "bedtime", "insomnia"},
    "nutrition": {"nutrition", "diet", "food", "meal", "eating", "snack", "protein", "hydration", "water"},
}
REQUEST = re.compile(r"\b(?:give|show|suggest|recommend|find|help|how|tip|tips|advice|routine|workout|exercise|exercises)\b", re.I)
LIST = re.compile(r"\b(?:list|show|display|view|check|what are)\b.*\breminders?\b", re.I)
DELETE = re.compile(r"^(?:please\s+)?(?:delete|remove|cancel)\s+(?:my\s+)?(?:reminder\s*)?(?:number|id|#)?\s*(\d+)\s*[.!]?\s*$", re.I)
SET = re.compile(r"^(?:please\s+)?(?:remind me to|set a reminder to|add a reminder to|create a reminder to)\s+(.+?)\s+(at|in)\s+(.+?)\s*$", re.I)
REVERSE_SET = re.compile(r"^(?:please\s+)?(?:remind me|set a reminder|add a reminder|create a reminder)\s+at\s+(\d{1,2}:\d{2})\s+(?:to|for)\s+(.+)$", re.I)

def timezone_for(name):
    try: return ZoneInfo(name or DEFAULT_TIMEZONE)
    except (KeyError, ValueError): return ZoneInfo(DEFAULT_TIMEZONE)

def parse_reminder_time(value, timezone_name=None, now=None):
    tz = timezone_for(timezone_name)
    current = (now or datetime.now(tz)).astimezone(tz)
    text = value.strip().lower()
    relative = re.fullmatch(r"(?:in\s+)?(\d+)\s*(minute|hour)s?", text)
    if relative:
        amount = int(relative[1]); result = current + timedelta(**{relative[2] + "s": amount})
    elif re.match(r"\d{4}-\d{2}-\d{2}", text):
        try: result = datetime.fromisoformat(text.replace("z", "+00:00"))
        except ValueError as error: raise ValueError("Use a valid date and time.") from error
        if result.tzinfo is None: result = result.replace(tzinfo=tz)
    else:
        match = re.fullmatch(r"(?:(today|tomorrow)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(today|tomorrow))?", text)
        if not match: raise ValueError("Use a time such as 18:00 tomorrow, an ISO date/time, or in 15 minutes.")
        hour, minute = int(match[2]), int(match[3] or 0)
        if match[4]:
            if not 1 <= hour <= 12: raise ValueError("Use an hour from 1 to 12 with am/pm.")
            hour = hour % 12 + (12 if match[4] == "pm" else 0)
        if hour > 23 or minute > 59: raise ValueError("Use a valid time, for example 18:30.")
        result = current.replace(hour=hour, minute=minute, second=0, microsecond=0)
        day = match[1] or match[5]
        if day == "tomorrow" or (day is None and result <= current): result += timedelta(days=1)
    if result <= current: raise ValueError("Choose a reminder time in the future.")
    if result > current + timedelta(days=3660): raise ValueError("Choose a reminder within the next ten years.")
    return result.astimezone(timezone.utc).isoformat()

def detect_retrieval_category(text):
    words = set(re.findall(r"[a-z]+", text.lower()))
    scores = {k:len(words & v) for k,v in CATEGORIES.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else None

def detect_intent(text, timezone_name=None):
    cleaned = " ".join(text.strip().split())
    def result(intent, **entities): return {"intent":intent,"entities":entities}
    if not cleaned: return result("empty_input")
    match = SET.match(cleaned)
    reverse = REVERSE_SET.match(cleaned)
    if match or reverse:
        task = match[1] if match else reverse[2]
        raw = (("in " if match[2].lower() == "in" else "") + match[3]) if match else reverse[1]
        try: return result("set_reminder",task=task,reminder_time=parse_reminder_time(raw,timezone_name),time=raw)
        except ValueError as error: return result("invalid_reminder_time",error=str(error),task=task)
    if LIST.search(cleaned): return result("list_reminders")
    deletion = DELETE.match(cleaned)
    if deletion: return result("delete_reminder",id=int(deletion[1]))
    if re.search(r"\bremind(?:er)?\b",cleaned,re.I): return result("incomplete_reminder",original_text=cleaned)
    if re.search(r"\b(?:weather|forecast|temperature|raining)\b",cleaned,re.I):
        city = re.search(r"\b(?:in|for)\s+(.+?)(?:\s+(?:today|tomorrow|now))?[?!.]*$",cleaned,re.I)
        return result("get_weather",city=city[1].strip(" ?.! ") if city else "",forecast="tomorrow" if "tomorrow" in cleaned.lower() else "today")
    if re.search(r"\b(?:find|search|look up|show)\b.*\b(?:exercise|exercises)\b|\b(?:exercise|exercises)\b.*\b(?:for|about)\b",cleaned,re.I):
        query=re.sub(r"^(?:please\s+)?(?:find|search|look up|show)(?: me)?\s+", "",cleaned,flags=re.I)
        query=re.sub(r"\bexercises?\b|\b(?:for|about)\b", "",query,flags=re.I).strip()
        return result("search_exercises",query=query or "push-up")
    if re.search(r"\b(?:what(?:'s| is) (?:the )?time|current time|tell me the time)\b",cleaned,re.I): return result("get_time")
    if re.search(r"what can you do|help menu|show commands|what are your features|how can you help",cleaned,re.I): return result("capabilities")
    # Do not turn 'my name is...', 'I am working...', or unrelated stories into tips.
    category=detect_retrieval_category(cleaned)
    if category and (REQUEST.search(cleaned) or cleaned.lower() in {category,category+" tips"}): return result("retrieve_knowledge",category=category,query=cleaned)
    return result("unknown",original_text=cleaned)
