from NLP.intent import detect_intent
from Dialogue.manager import handle_intent
from DB.database import init_db
from config import MAX_TURNS,MAX_HISTORY_CHARACTERS,DEFAULT_TIMEZONE

def remember_turn(history,user_message,bot_response):
    history.extend([{'role':'user','content':user_message},{'role':'assistant','content':bot_response}])
    while history and (len(history)>MAX_TURNS*2 or sum(len(i['content']) for i in history)>MAX_HISTORY_CHARACTERS):del history[:2]
def display_response(response):
    if isinstance(response,str):print(f'Bot: {response}');return response
    pieces=[];print('Bot: ',end='',flush=True)
    for piece in response:print(piece,end='',flush=True);pieces.append(piece)
    print();return ''.join(pieces)
def run():
    init_db();history=[];context={'timezone':DEFAULT_TIMEZONE}
    print("********** Everyday Chatbot **********\nType 'quit' to exit or 'reset' to clear conversation memory.")
    while True:
        try:message=input('\nYou: ').strip()
        except (KeyboardInterrupt,EOFError):print('\nGoodbye!');break
        if message.lower() in {'quit','exit','bye'}:print('Bot: Goodbye!');break
        if message.lower()=='reset':history.clear();context={'timezone':DEFAULT_TIMEZONE};print('Bot: Conversation memory cleared.');continue
        if not message:continue
        try:answer=display_response(handle_intent(detect_intent(message),history,context=context))
        except (RuntimeError,ValueError) as error:print(f'\nBot: {error}');continue
        remember_turn(history,message,answer)
if __name__=='__main__':run()
