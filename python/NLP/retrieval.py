import re
from DB.database import get_knowledge_by_category

STOP_WORDS=set('a about an and are better can could do for give help how i in is me my of on please routine show some something stay suggest tell the to what while with would you tip tips advice'.split())
NORMAL={'hydrated':'hydration','drinking':'drink','focused':'focus','focusing':'focus','studying':'study','exercising':'exercise','workouts':'workout','exercises':'exercise','snacks':'snack','meals':'meal','pushups':'pushup'}
GENERIC={'workout':{'workout','exercise','fitness','training'},'study':{'study','academic'},'sleep':{'sleep','sleeping'},'nutrition':{'nutrition','diet','eating'}}
def tokenize(text): return {NORMAL.get(w,w) for w in re.findall(r'[a-z0-9]+',text.lower())}
def retrieve_knowledge(category,query,maximum_results=3):
    items=get_knowledge_by_category(category);words=tokenize(query)-STOP_WORDS-GENERIC.get(category,set())
    if not words:return items[:maximum_results]
    scored=[]
    for item in items:
        score=sum(len(words & tokenize(item[field]))*weight for field,weight in [('title',4),('keywords',3),('difficulty',2),('content',1)])
        if score:scored.append((score,item))
    scored.sort(key=lambda x:x[0],reverse=True)
    return [i for _,i in scored[:maximum_results]] if scored else items[:maximum_results]
def format_retrieval_results(category,results):
    if not results:return f'My {category} knowledge section is empty. Add content to the knowledge database.'
    return '\n\n'.join(f"{n}. {item['title']}\n{item['content']}" for n,item in enumerate(results,1))
