import { createController, loadState, freshState, validateReminder, localDateInput } from './core.js';
import { createAdapter } from './backend.js';
import { initTrackers } from './trackers.js';
import { initVoice } from './voice.js';
import { createTrackerResponder, TRACKER_PROMPTS } from './tracker-chat.js';
const $=id=>document.getElementById(id);
const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');const use=document.createElementNS(svg.namespaceURI,'use');use.setAttribute('href',`#i-${name}`);svg.setAttribute('aria-hidden','true');svg.append(use);return svg;};
const el=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
let storage;try{storage=window.localStorage;}catch{}
let warned=false,activeView='chat',toastTimer,confirmAction,voice,replyGeneration=0;
let trackerTab='habits';
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},4500);}
const controller=createController({state:storage?loadState(storage):freshState(),adapter:createAdapter({trackerResponder:createTrackerResponder(async()=>{await startupStatus;if(trackers.store.busy)throw Error("A tracker save is in progress. Wait, then retry your question.");await trackers.store.reload();if(!trackers.store.ready)throw Error("Your tracker records could not be loaded. Use Reload in Progress Tracker or Sleep, then retry. No records were changed.");return trackers.store.state;},{updateState:mutator=>trackers.store.update(mutator)})}),storage,onChange:render,onStorageError:()=>{if(!warned){warned=true;toast('Browser storage is unavailable. Changes will last only for this visit.');}}});
if(!storage)toast('Browser storage is unavailable. Changes will last only for this visit.');
function switchTrackerTab(tab){
  trackerTab=tab==='sleep'?'sleep':'habits';
  $('habits-panel').hidden=trackerTab!=='habits';$('view-sleep').hidden=trackerTab!=='sleep';
  document.querySelectorAll('[data-tracker-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.trackerTab===trackerTab)));
}
function switchView(view){
  voice?.cancel();replyGeneration++;
  if(view==='sleep'){view='progress';switchTrackerTab('sleep');}
  if(!['chat','progress'].includes(view))view='chat';activeView=view;
  document.querySelectorAll('.view').forEach(n=>{n.hidden=n.id!=='view-'+view;});
  document.querySelectorAll('.nav-item').forEach(n=>{const active=n.dataset.view===view;n.classList.toggle('active',active);if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
  $('breadcrumb').textContent=view==='chat'?'Chat':'Progress Tracker';
  history.replaceState(null,'',view==='progress'&&trackerTab==='sleep'?'#sleep':'#'+view);
  window.scrollTo?.({top:0,behavior:'instant'});
}

function confirm(title,description,label,action){voice?.cancel();$('reminders-drawer').close();confirmAction=action;$('confirm-title').textContent=title;$('confirm-description').textContent=description;$('confirm-accept').textContent=label;$('confirm-dialog').showModal();$('confirm-cancel').focus();}
function busyButtons(){document.querySelectorAll('[data-prompt],[data-add-reminder],.delete-reminder').forEach(b=>{b.disabled=controller.busy;});$('clear-chat').disabled=controller.busy||!controller.current.messages.length;$('refresh-reminders').disabled=controller.busy;$('send-button').disabled=controller.busy||!$('message-input').value.trim();$('message-input').disabled=controller.busy;voice?.setBusy(controller.busy);}
function welcome(){const box=el('div','welcome');box.append(brainMark('div','welcome-symbol'),el('h2','', 'Hello. What’s on your mind?'));const prompts=el('div','welcome-prompts');const items=[['bell','Set a reminder',null],['book','Help me focus','Give me a study tip'],['move','Find a simple workout','Give me a beginner workout'],['clock','What time is it?','What is the time?']];for(const [symbol,label,prompt]of items){const b=el('button','prompt-card');b.append(icon(symbol),el('span','',label));if(prompt){b.dataset.prompt=prompt;b.addEventListener('click',()=>sendPrompt(prompt));}else{b.dataset.addReminder='';b.addEventListener('click',openReminder);}prompts.append(b);}for(const prompt of TRACKER_PROMPTS){const b=el('button','prompt-card',prompt);b.dataset.prompt=prompt;b.addEventListener('click',()=>sendPrompt(prompt));prompts.append(b);}box.append(prompts);return box;}
function renderMessages(){const box=$('chat-messages');box.replaceChildren();if(!controller.current.messages.length)box.append(welcome());for(const m of controller.current.messages){const row=el('article',`message-row ${m.role}${m.status==='error'?' error':''}`);if(m.role==='assistant')row.append(brainMark('span','assistant-avatar'));const body=el('div','message-body');const meta=el('div','message-meta');meta.append(el('strong','',m.role==='user'?'You':'Nexus'),el('span','',new Date(m.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})));body.append(meta);const bubble=el('div','message-text');if(m.status==='pending'){bubble.setAttribute('aria-label','Assistant is thinking');const dots=el('div','typing-dots');dots.setAttribute('aria-hidden','true');for(let i=0;i<3;i++)dots.append(el('span'));bubble.append(dots);bubble.append(el('span','sr-only','Assistant is thinking…'));}else bubble.textContent=m.content;body.append(bubble);if(m.role==='assistant'&&m.status!=='pending'){const replay=el('button','text-button read-reply');replay.type='button';replay.append(icon('speaker'),document.createTextNode('Read aloud'));replay.setAttribute('aria-label','Read this reply aloud');replay.disabled=!voice?.supported.synthesis;replay.addEventListener('click',()=>{voice?.cancel();voice?.speak(m.content,{force:true});});body.append(replay);}if(m.sources?.length){const links=el('div','message-sources');for(const source of m.sources){if(typeof source.url!=='string'||!source.url.startsWith('https://'))continue;const a=el('a','',source.label);a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}body.append(links);}if(m.status==='error'&&m.retryId){const b=el('button','retry-button','Retry message');b.disabled=controller.busy;b.addEventListener('click',async()=>{const original=controller.current.messages.find(u=>u.id===m.retryId);if(original)await sendMessage(original.content,original.extra??{},original.id);});body.append(b);}row.append(body);box.append(row);}box.scrollTop=controller.current.messages.length?box.scrollHeight:0;}
function reminderList(target,list,compact){target.replaceChildren();if(!list.length){const empty=el('div','empty-reminders');const mark=el('span','empty-icon');mark.append(icon('bell'));empty.append(mark,el('strong','', 'A little breathing room'),el('p','',controller.state.mode==='demo'?'No reminders yet. Add your first one.':'No reminders yet. Add your first one.'));target.append(empty);return;}for(const r of list){const row=el('div','reminder-item');const mark=el('span','reminder-symbol');mark.append(icon('bell'));const content=el('div','reminder-content');content.append(el('strong','',r.task));const date=new Date(r.reminder_time);const due=date<new Date();const time=el('small','',`${compact?'':`#${r.id} · `}${date.toLocaleString([],{dateStyle:'medium',timeStyle:'short'})}${due?' · Past due':''}`);if(due)time.className='due-label';content.append(time);const del=el('button','icon-button delete-reminder');del.title=`Delete reminder: ${r.task}`;del.setAttribute('aria-label',del.title);del.append(icon('trash'));del.addEventListener('click',()=>confirm('Delete this reminder?',r.task,'Delete reminder',async()=>{switchView('chat');await sendMessage(`delete reminder ${r.id}`,{intent:'delete_reminder',entities:{id:r.id}});}));row.append(mark,content,del);target.append(row);}}
function render(){const mode=controller.state.mode,python=mode==='python',demo=mode==='demo',local=controller.state.serverMode==='python';$('assistant-subtitle').textContent=controller.busy?'Working on your message…':'Here to help throughout your day';const account=controller.state.reminderStorage==='account';$('reminder-note').textContent=demo?'Offline demo reminders are stored in this browser.':account?'Your reminders are saved to your signed-in account. Alerts work while this page is open.':local||python?'Reminders are stored in your Python database. Alerts work while this page is open.':'Guest reminders stay in this browser. Sign in to save reminders to your account. Alerts work while this page is open.';const list=controller.current.reminders;for(const id of ['side-count','all-count','nav-reminder-count'])$(id).textContent=String(list.length);reminderList($('side-reminders'),list.slice(0,3),true);reminderList($('all-reminders'),list,false);renderMessages();busyButtons();}
async function sendPrompt(prompt){if(controller.busy)return;switchView('chat');await sendMessage(prompt);$('message-input').focus();}
function openReminder(){if(controller.busy)return;voice?.cancel();$('reminders-drawer').close();$('reminder-form').reset();$('reminder-error').textContent='';const next=new Date(Date.now()+3600000);$('reminder-time').value=localDateInput(next);$('reminder-time').min=localDateInput(new Date());$('reminder-dialog').showModal();$('reminder-task').focus();}
$('chat-form').addEventListener('submit',async e=>{e.preventDefault();if(controller.busy)return;const message=$('message-input').value.trim();if(!message)return;if(message.length>2000){toast('Keep messages under 2,000 characters. Edit your message before sending.');return;}$('message-input').value='';await sendMessage(message);$('message-input').focus();});
$('message-input').addEventListener('input',busyButtons);
$('message-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chat-form').requestSubmit();}});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
document.querySelectorAll('[data-tracker-tab]').forEach(b=>b.addEventListener('click',()=>{switchTrackerTab(b.dataset.trackerTab);switchView('progress');}));
document.querySelectorAll('[data-open-tracker]').forEach(b=>b.addEventListener('click',()=>{switchTrackerTab(b.dataset.openTracker);switchView('progress');}));
document.querySelectorAll('[data-open-reminders]').forEach(b=>b.addEventListener('click',()=>{voice?.cancel();$('reminders-drawer').showModal();}));
document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();switchView('chat');});
window.addEventListener?.('hashchange',()=>switchView(location.hash.slice(1)));
document.querySelectorAll('[data-prompt]').forEach(b=>b.addEventListener('click',()=>sendPrompt(b.dataset.prompt)));
document.querySelectorAll('[data-add-reminder]').forEach(b=>b.addEventListener('click',openReminder));
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
$('confirm-cancel').addEventListener('click',()=>{$('confirm-dialog').close();confirmAction=null;});
$('confirm-dialog').addEventListener('cancel',()=>{confirmAction=null;});
$('confirm-accept').addEventListener('click',async()=>{const action=confirmAction;confirmAction=null;$('confirm-dialog').close();if(action)await action();});
$('clear-chat').addEventListener('click',()=>{voice?.cancel();voice?.discardDraft();replyGeneration++;confirm('Clear this conversation?','This clears the chat for the current mode. Your reminders will stay.','Clear chat',()=>{controller.clearChat();toast('Conversation cleared.');$('message-input').focus();});});
$('reminder-form').addEventListener('submit',async e=>{e.preventDefault();let r;try{r=validateReminder($('reminder-task').value,$('reminder-time').value);}catch(error){$('reminder-error').textContent=error.message;return;}$('reminder-dialog').close();switchView('chat');await sendMessage(`remind me to ${r.task} at ${localDateInput(new Date(r.reminder_time)).replace('T',' ')}`,{intent:'set_reminder',entities:r});$('message-input').focus();});
$('refresh-reminders').addEventListener('click',async()=>{if(controller.busy)return;await sendMessage('show my reminders',{intent:'list_reminders'});toast(controller.current.messages.at(-1)?.status==='error'?'Could not refresh reminders. Open Chat to retry.':'Reminder request finished.');});
$('today-date').textContent=new Date().toLocaleDateString([],{day:'numeric',month:'short',year:'numeric'});
render();switchView(location.hash.slice(1)||'chat');

async function syncStatus(){
  try {
    const response=await fetch('/api/status',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('Assistant status unavailable.');
    const status=await response.json();
    if(!['python','hosted'].includes(status.mode))throw Error('Invalid assistant status.');
    await trackers.configure(status);
    const identity=status.identity_key||status.mode;
    const old=controller.state.hostedIdentity;
    if(old&&old!==identity){controller.state.sessions.hosted.messages=[];controller.state.sessions.hosted.reminders=[];}
    controller.state.hostedIdentity=identity;
    controller.state.reminderStorage=status.reminder_storage;
    controller.state.serverMode=status.mode;
    const link=$('account-link');link.hidden=status.mode==='python';
    link.textContent=status.signed_in?'Sign out':'Sign in to save reminders';
    link.href=status.signed_in?'/signout-with-chatgpt?return_to=%2F':'/signin-with-chatgpt?return_to=%2F';
    if(status.signed_in||status.mode==='python'){
      const r=await fetch('/api/reminders',{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw Error('Reminders unavailable.');
      const data=await r.json();controller.state.sessions.hosted.reminders=data.reminders||[];
    }
    try{storage?.setItem('everyday-assistant-v1',JSON.stringify(controller.state));}catch{}
    render();
  }catch{
    // A missing status endpoint must not leave guest tracker controls disabled.
    // Preserve the last known remote destination; never redirect its saves locally.
    if(!trackers.store.configured)await trackers.configure({
      mode:controller.state.serverMode==='python'?'python':'hosted',
      signed_in:controller.state.reminderStorage==='account',
      identity_key:controller.state.hostedIdentity,
      trackers:true
    });
    toast('Assistant connection unavailable. Check the storage status on Progress Tracker or Sleep, or use Reload to reconnect.');
  }
}
const trackers=initTrackers({storage,toast,confirm,refreshStatus:syncStatus});
const startupStatus=syncStatus();
voice=initVoice({root:document,platform:window,storage,getBusy:()=>controller.busy,onTranscript:text=>{if(controller.busy)return;$('message-input').value=text;if(text.length>2000)toast('Your voice message is over 2,000 characters. Shorten it before sending.');busyButtons();$('message-input').focus();},onComplete:()=>{if(!controller.busy&&activeView==='chat')return $('chat-form').requestSubmit();}});
render();
function brainMark(tag,className){const mark=el(tag,className);mark.append(icon('brain'));return mark;}
async function sendMessage(message,extra={},retryId){
  if(controller.busy)return false;
  voice?.cancel();const force=voice?.consumeVoiceOrigin(message)||false;const generation=++replyGeneration;
  const session=controller.current;
  const sent=await controller.send(message,extra,retryId);
  const reply=session.messages.at(-1);
  if(sent&&generation===replyGeneration&&session===controller.current&&activeView==='chat'&&reply?.role==='assistant'&&reply.status!=='pending')voice?.speak(reply.content,{force});
  return sent;
}
let notified=new Set();try{notified=new Set(JSON.parse(storage?.getItem('everyday-notified')||'[]'));}catch{}
const dueTimer=setInterval(()=>{const due=controller.current.reminders.filter(r=>new Date(r.reminder_time)<=new Date()&&!notified.has(`${controller.state.mode}:${r.id}:${r.reminder_time}`));if(!due.length)return;for(const r of due)notified.add(`${controller.state.mode}:${r.id}:${r.reminder_time}`);toast(`Reminder: ${due.slice(0,3).map(r=>r.task).join(' · ')}`);try{storage?.setItem('everyday-notified',JSON.stringify([...notified].slice(-200)));}catch{}},15000);dueTimer.unref?.();
