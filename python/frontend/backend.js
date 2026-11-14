import { demoReply } from './core.js';
// This is the only transport layer. Replace the request/response mapping here
// when your existing Python HTTP interface differs from the documented contract.
export function createAdapter({ fetchImpl = globalThis.fetch, timeoutMs = 130000, demoDelayMs = 350, trackerResponder } = {}) {
  return { async send(request, context) {
    if(trackerResponder){const response=await trackerResponder(request.message);if(response)return response;}
    if(context.mode==='demo'){
      if(demoDelayMs)await new Promise(resolve=>setTimeout(resolve,demoDelayMs));
      return demoReply(request,context.reminders);
    }
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      const hosted=context.mode==='hosted';
      const response=await fetchImpl(hosted?'/api/chat':context.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},credentials:hosted?'same-origin':'omit',signal:controller.signal,body:JSON.stringify({...request,...(hosted?{reminders:context.reminders}:{})})});
      if(response.status===401||response.status===403)throw new Error('The Python endpoint denied access. Check its authentication configuration, then retry.');
      if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw new Error(error||`The backend returned HTTP ${response.status}. Please retry.`);}
      try{return await response.json();}catch{throw new Error('The Python endpoint returned invalid JSON. It must return {"reply":"…"}.');}
    }catch(error){
      if(error.name==='AbortError')throw new Error('The Python backend took too long to respond. Please retry.');
      if(error instanceof TypeError)throw new Error('Couldn’t reach your Python backend. Check that it is running, the endpoint URL is correct, and CORS allows this Site.');
      throw error;
    }finally{clearTimeout(timer);}
  }};
}
