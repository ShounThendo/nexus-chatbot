import json
import urllib.request
import urllib.error
from config import OLLAMA_URL, MODEL_NAME, OLLAMA_TIMEOUT

SYSTEM_PROMPT='''You are an everyday-life assistance chatbot. Give clear, concise answers in simple English. Use supplied conversation history for follow-ups. If a personal detail is absent, say you do not know it. Do not claim permanent memory or to create/delete reminders. Do not invent live weather, exercise API results, or medical diagnoses. Give general wellness information. Keep replies brief unless asked for detail.'''
def generate_response(user_message,history=None):
    if not user_message.strip():yield 'Please enter a question.';return
    payload={'model':MODEL_NAME,'messages':[{'role':'system','content':SYSTEM_PROMPT},*(history or []),{'role':'user','content':user_message}],'think':False,'stream':True,'keep_alive':'15m','options':{'temperature':0.7,'num_predict':250,'num_ctx':4096}}
    request=urllib.request.Request(OLLAMA_URL,data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'},method='POST')
    received=False;completed=False
    try:
        with urllib.request.urlopen(request,timeout=OLLAMA_TIMEOUT) as response:
            for line in response:
                if not line.strip():continue
                part=json.loads(line)
                if part.get('error'):raise RuntimeError(f"Ollama reported: {part['error']}")
                text=part.get('message',{}).get('content','')
                if text:received=True;yield text
                if part.get('done'):completed=True;break
        if not completed:raise RuntimeError('The response was interrupted. Please try again.')
        if not received:raise RuntimeError('Ollama returned an empty answer. Please try again.')
    except urllib.error.HTTPError as error:
        if error.code==404:raise RuntimeError(f'Model not found. Run: ollama pull {MODEL_NAME}') from error
        raise RuntimeError(f'Ollama returned HTTP {error.code}.') from error
    except TimeoutError as error:raise RuntimeError('Ollama took too long. Try again.') from error
    except urllib.error.URLError as error:raise RuntimeError('Cannot reach Ollama. Start Ollama and check the model is installed.') from error
    except (ValueError,OSError) as error:raise RuntimeError('Could not read the complete Ollama response.') from error
