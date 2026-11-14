from datetime import datetime
from DB.database import save_reminder,get_all_reminders,delete_reminder_by_id
from NLP.intent import parse_reminder_time,timezone_for
from NLP.retrieval import retrieve_knowledge,format_retrieval_results
from NLP.generative import generate_response
from Services.apis import get_weather,search_exercises,APIUnavailable

CAPABILITIES='''I can:
• Add, list, and delete dated reminders.
• Look up weather by city and tomorrow’s forecast.
• Search an external exercise catalogue.
• Retrieve study, workout, sleep, and nutrition knowledge.
• Answer open-ended questions using Ollama when it is running.

Try “remind me to study at 18:00 tomorrow”, “weather in Cape Town”, “find exercises for chest”, or “give me a study tip”. Reminders do not notify you when the app is closed.'''

def handle_intent(result,history=None,*,user_id='local',context=None,request_id=None):
    context=context if context is not None else {}
    intent=result['intent'];entities=result.get('entities',{})
    context['last_source']=intent
    if intent=='empty_input':return 'Please enter a message.'
    if intent=='set_reminder':
        try:
            when=parse_reminder_time(entities.get('reminder_time') or entities.get('time',''),context.get('timezone'))
            rid=save_reminder(entities.get('task',''),when,user_id,request_id)
        except ValueError as error:return str(error)
        display=datetime.fromisoformat(when).astimezone(timezone_for(context.get('timezone'))).strftime('%d %b %Y at %H:%M')
        return f"Reminder {rid} saved: {entities['task']}\n{display}. Open the app to see due reminders."
    if intent=='list_reminders':
        rows=get_all_reminders(user_id)
        return 'No reminders yet. Tell me what to remember and when.' if not rows else 'Your reminders:\n'+'\n'.join(f"{r['id']}. {r['task']} — {r['reminder_time']}"+(' (old time-only record; delete and recreate with a date)' if r.get('needs_date') else '') for r in rows)
    if intent=='delete_reminder':return f"Reminder {entities['id']} deleted." if delete_reminder_by_id(entities['id'],user_id) else f"No reminder {entities['id']} was found in your list."
    if intent=='invalid_reminder_time':return entities.get('error','Use a valid time such as 18:00 tomorrow.')
    if intent=='incomplete_reminder':return 'Tell me the task and time: “remind me to revise databases at 18:00 tomorrow”. You can also use Add a reminder.'
    if intent=='get_time':return datetime.now(timezone_for(context.get('timezone'))).strftime('It is %H:%M on %A, %d %B %Y (%Z).')
    if intent=='capabilities':return CAPABILITIES
    if intent=='get_weather':
        city=entities.get('city') or context.get('last_city')
        if not city:context['awaiting_city']=True;return 'Which city would you like the weather for?'
        try:
            reply,matched=get_weather(city,entities.get('forecast','today'));context['last_city']=city;context['awaiting_city']=False;return reply
        except (APIUnavailable,ValueError) as error:return str(error)
    if intent=='search_exercises':
        try:return search_exercises(entities.get('query','pushup'))
        except APIUnavailable:
            context['last_source']='knowledge_fallback'
            return 'The exercise service is unavailable. Here is saved workout knowledge instead:\n\n'+format_retrieval_results('workout',retrieve_knowledge('workout',entities.get('query','workout')))
    if intent=='retrieve_knowledge':return format_retrieval_results(entities['category'],retrieve_knowledge(entities['category'],entities['query']))
    text=entities.get('original_text','')
    if context.get('awaiting_city') and len(text)<=100:
        context['awaiting_city']=False
        return handle_intent({'intent':'get_weather','entities':{'city':text}},history,user_id=user_id,context=context)
    if text.lower().strip() in {'tomorrow','what about tomorrow','and tomorrow?'} and context.get('last_city'):
        return handle_intent({'intent':'get_weather','entities':{'city':context['last_city'],'forecast':'tomorrow'}},history,user_id=user_id,context=context)
    return generate_response(text,history)
