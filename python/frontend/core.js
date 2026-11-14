export const STORAGE_KEY = 'everyday-assistant-v1';
export const WELCOME = 'Hello, I’m Nexus. How can I help?';
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const session = () => ({ sessionId: uuid(), messages: [], reminders: [] });
export function freshState(mode='hosted') { return { version: 2, mode, endpoint: '', sessions: { hosted: session(), demo: session(), python: session() } }; }
export function normalizeReminders(value) {
  if (!Array.isArray(value)) throw new Error('The backend reminders field must be an array.');
  const seen = new Set();
  return value.map(r => {
    if (!r || !['number', 'string'].includes(typeof r.id) || !String(r.id).length || typeof r.task !== 'string' || !r.task.trim() || typeof r.reminder_time !== 'string' || !Number.isFinite(new Date(r.reminder_time).getTime()) || seen.has(String(r.id))) throw new Error('A backend reminder has an invalid ID, task, or date.');
    seen.add(String(r.id));
    return { id: r.id, task: r.task.trim().slice(0, 300), reminder_time: new Date(r.reminder_time).toISOString(), ...(typeof r.request_id==='string'?{request_id:r.request_id}:{}) };
  }).sort((a,b) => new Date(a.reminder_time) - new Date(b.reminder_time));
}
export function loadState(storage) {
  try {
    const state = JSON.parse(storage.getItem(STORAGE_KEY));
    if (![1,2].includes(state?.version) || !['hosted','demo', 'python'].includes(state.mode) || typeof state.endpoint !== 'string') return freshState();
    if(state.version===1){state.version=2;state.sessions.hosted=session();if(state.mode==='demo'){state.mode='hosted';state.sessions.hosted.reminders=state.sessions.demo.reminders||[];}}
    for (const mode of ['hosted','demo', 'python']) {
      const s = state.sessions?.[mode];
      if (!s || typeof s.sessionId !== 'string' || !Array.isArray(s.messages)) return freshState();
      s.messages = s.messages.filter(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string' && typeof m.id === 'string' && Number.isFinite(new Date(m.at).getTime())).slice(-120);
      s.messages.forEach(m => { if (m.status === 'pending') { m.status = 'error'; m.content = 'This request was interrupted. You can retry it.'; } });
      s.reminders = normalizeReminders(s.reminders);
    }
    if (state.mode === 'python') validateEndpoint(state.endpoint);
    return state;
  } catch { return freshState(); }
}
export function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter the full URL of your chat endpoint.'); }
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('Use an HTTPS endpoint. HTTP is only allowed for localhost development.');
  if (url.username || url.password || url.hash || url.search) throw new Error('Use an endpoint URL without credentials, query parameters, or a fragment.');
  return url.href;
}
export function validateReminder(task, dateTime, now = new Date()) {
  const text = task.trim(); const date = new Date(dateTime);
  if (!text) throw new Error('Enter a task for your reminder.');
  if (text.length > 300) throw new Error('Keep the reminder task under 300 characters.');
  if (!dateTime || !Number.isFinite(date.getTime())) throw new Error('Choose a valid date and time.');
  if (date <= now) throw new Error('Choose a date and time in the future.');
  return { task: text, reminder_time: date.toISOString() };
}
export function localDateInput(date) {
  const p = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
function parseReminder(message, now) {
  const m = message.match(/^(?:remind me to|set (?:a )?reminder to|add (?:a )?reminder to)\s+(.+?)\s+(?:at|in)\s+(.+)$/i);
  if (!m) return null;
  const task=m[1].trim(), raw=m[2].trim(); let date;
  const relative=raw.match(/^(\d+)\s*(minute|hour)s?$/i);
  if(relative) date=new Date(now.getTime()+Number(relative[1])*(relative[2].toLowerCase()==='hour'?3600000:60000));
  else if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(raw)) date=new Date(raw.replace(' ','T'));
  else {
    const t=raw.match(/^(?:(tomorrow|today)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s+(tomorrow|today))?$/i);
    if (!t) return null;
    let h=Number(t[2]),min=Number(t[3]??0);const suffix=t[4]?.toLowerCase();
    if(min>59 || h>23 || (suffix && (h<1||h>12))) return null;
    if(suffix) h=h%12+(suffix==='pm'?12:0);
    date=new Date(now);date.setHours(h,min,0,0);
    const day=(t[1]||t[5]||'').toLowerCase();
    if(day==='tomorrow' || (!day && date<=now)) date.setDate(date.getDate()+1);
  }
  try {return validateReminder(task,date.toISOString(),now);} catch {return null;}
}
export function demoReply(request, reminders, now = new Date()) {
  const text=request.message.trim(),lower=text.toLowerCase();let list=normalizeReminders(reminders);
  if(request.intent==='set_reminder' || /^(remind me|set (?:a )?reminder|add (?:a )?reminder)/i.test(text)) {
    const entity=request.intent==='set_reminder'?validateReminder(request.entities.task,request.entities.reminder_time,now):parseReminder(text,now);
    if(!entity)return {reply:'Tell me what to remember and when, for example: “Remind me to revise databases at 18:00 tomorrow”. You can also use the Add a reminder button.',reminders:list};
    const id=Math.max(0,...list.map(r=>Number(r.id)||0))+1;list.push({id,...entity});
    return {reply:`Reminder ${id} added: ${entity.task}\n${new Date(entity.reminder_time).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}.\n\nThis demo stores the reminder in your browser; it does not send a notification.`,reminders:normalizeReminders(list)};
  }
  const del=text.match(/^(?:delete|remove)\s+(?:reminder\s+)?(?:#)?(\d+)\s*$/i);
  if(request.intent==='delete_reminder'||del){const id=request.entities?.id??del[1];const found=list.find(r=>String(r.id)===String(id));return {reply:found?`Deleted reminder ${id}: ${found.task}`:`I couldn’t find reminder ${id}. Ask me to show your reminders.`,reminders:list.filter(r=>String(r.id)!==String(id))};}
  if(request.intent==='list_reminders'||/^(?:show|list|view)(?: me)?(?: all)?(?: my| the)? reminders/i.test(text)||/^(?:what are|do i have) my reminders/.test(lower)) return {reply:list.length?`Your reminders:\n${list.map(r=>`${r.id}. ${r.task} — ${new Date(r.reminder_time).toLocaleString([],{dateStyle:'medium',timeStyle:'short'})}`).join('\n')}`:'You have no reminders yet. Use Add a reminder, or tell me what to remember and when.',reminders:list};
  if(/\b(time|date)\b/.test(lower))return {reply:`It’s ${now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} on ${now.toLocaleDateString([],{weekday:'long',year:'numeric',month:'long',day:'numeric'})}, using your device’s local time.`,reminders:list};
  if(/\b(study|studying|focus|revision|revise)\b/.test(lower))return {reply:'Sample study tip\n\nChoose one small topic. Study it for 25 minutes, then take a 5-minute break. Finish by explaining the main idea in your own words, without looking at your notes.\n\nStart small: one topic is enough for your next session.',reminders:list};
  if(/\b(workout|exercise|fitness)\b/.test(lower))return {reply:'Sample beginner workout\n\nStart with a short, comfortable walk and gentle movement. Choose an easy activity you enjoy, and build up gradually. Pause if you feel pain or unwell.\n\nPython mode can return your project’s workout database content instead.',reminders:list};
  if(/\b(sleep|rest|bedtime)\b/.test(lower))return {reply:'Sample sleep tip\n\nTry a simple wind-down routine: set aside your work, dim bright lights, and do something quiet before bed. A consistent bedtime can make the routine easier to keep.',reminders:list};
  if(/\b(nutrition|food|meal|eat|diet)\b/.test(lower))return {reply:'Sample everyday nutrition tip\n\nKeep your next meal simple: include a vegetable or fruit, a source of protein, and a staple food you enjoy. Keep water nearby during your day.\n\nAdjust your choices to your preferences and any advice you already follow.',reminders:list};
  if(/\b(hello|hi|hey)\b/.test(lower))return {reply:'Hello! I can help with reminders, study tips, workouts, sleep, nutrition, and the current time. What would you like to start with?',reminders:list};
  return {reply:'In demo mode, I can add, list, and delete reminders, show the time, and give sample study, workout, sleep, and nutrition tips. Try one of the shortcuts.\n\nFor open-ended conversation, connect your Python backend in Assistant connection.',reminders:list};
}
export function createController({ state = freshState(), adapter, storage, onChange = () => {}, onStorageError = () => {}, now = () => new Date() }) {
  let busy=false;
  const current=()=>state.sessions[state.mode];
  const notify=()=>{try{storage?.setItem(STORAGE_KEY,JSON.stringify(state));}catch{onStorageError();}onChange();};
  return {
    get state(){return state;},get busy(){return busy;},get current(){return current();},
    configure(mode,endpoint=''){
      if(busy)throw new Error('Wait for the current response before changing the connection.');
      if(!['hosted','demo','python'].includes(mode))throw new Error('Choose a connection mode.');
      const next=mode==='python'?validateEndpoint(endpoint):state.endpoint;
      if(mode==='python' && next!==state.endpoint)state.sessions.python=session();
      state.endpoint=next;state.mode=mode;notify();
    },
    clearChat(){if(busy)return false;current().messages=[];current().sessionId=uuid();notify();return true;},
    async send(message,extra={},retryId){
      const text=String(message).trim();if(busy||!text)return false;if(text.length>2000)throw new Error('Keep messages under 2,000 characters.');
      const s=current();let user;
      if(retryId){user=s.messages.find(m=>m.id===retryId&&m.role==='user');if(!user)return false;s.messages=s.messages.filter(m=>m.retryId!==retryId);}
      else {user={id:uuid(),role:'user',content:text,at:now().toISOString()};s.messages.push(user);}
      const pending={id:uuid(),role:'assistant',content:'',at:now().toISOString(),status:'pending',retryId:user.id};s.messages.push(pending);busy=true;notify();
      try {
        const history=s.messages.slice(0,-2).filter(m=>m.status!=='error'&&m.status!=='pending').slice(-8).map(m=>({role:m.role,content:m.content.slice(0,750)}));
        const response=await adapter.send({message:text,session_id:s.sessionId,request_id:user.id,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,history,...extra},{mode:state.mode,endpoint:state.endpoint,reminders:s.reminders});
        if(!response||typeof response.reply!=='string'||!response.reply.trim())throw new Error('The backend must return a non-empty reply string.');
        const reminders=response.reminders===undefined?s.reminders:normalizeReminders(response.reminders);
        s.reminders=reminders;pending.content=response.reply;pending.status='sent';pending.sources=response.sources||[];pending.route=response.route;state.reminderStorage=response.reminder_storage||state.reminderStorage;delete pending.retryId;delete user.extra;
      }catch(error){pending.content=error instanceof Error?error.message:'The request failed. Please retry.';pending.status='error';user.extra=extra;}
      finally{busy=false;s.messages=s.messages.slice(-120);notify();}
      return true;
    }
  };
}
