import {emptyTrackers, validateTrackers, TRACKER_KEY} from './tracker-model.js';

// Tracker persistence is independent of chat mode. An offline remote save is
// never silently redirected to a different database or reported as successful.
export function createTrackerStore({storage, fetcher=globalThis.fetch, onChange=()=>{}, onStatus=()=>{}}={}) {
  let state=emptyTrackers(), revision=0, remote=false, ready=false, busy=false, blocked=false;
  let identity='', generation=0, configured=false;
  const notify=()=>onChange(state);
  function localEnvelope() {
    if (!storage) throw Error('Browser storage is unavailable. Tracker changes cannot be saved.');
    const raw=storage.getItem(TRACKER_KEY);
    if (!raw) return {state:emptyTrackers(),revision:0};
    const envelope=JSON.parse(raw);
    if (!Number.isInteger(envelope.revision) || envelope.revision<0) throw Error('Saved tracker data could not be read.');
    return {state:validateTrackers(envelope.state),revision:envelope.revision};
  }
  async function request(options={}) {
    const response=await fetcher('/api/trackers',{credentials:'same-origin',signal:AbortSignal.timeout(15000),...options});
    const data=await response.json();
    if (!response.ok) {const error=Error(data.error||'Tracker request failed.'); error.status=response.status; throw error;}
    if (!Number.isInteger(data.revision) || data.revision<0) throw Error('Invalid tracker response.');
    return {state:validateTrackers(data.state),revision:data.revision};
  }
  async function load() {
    const ticket=++generation; ready=false; notify(); onStatus('Loading your tracker records…');
    try {
      const envelope=remote?await request():localEnvelope();
      if (ticket!==generation) return;
      state=envelope.state; revision=envelope.revision; ready=true; blocked=false;
      onStatus(remote?'Saved to your '+(identity==='python'?'Python database.':'signed-in account.'):'Saved in this browser. Use the same browser to keep tracking.');
    } catch(error) {if(ticket!==generation)return;blocked=true;onStatus(`${error.message} Your stored records have not been replaced. Use Reload to try again.`,true);}
    notify();
  }
  return {
    get state(){return state;}, get configured(){return configured;}, get ready(){return ready && !blocked;}, get busy(){return busy;},
    async configure(status) {
      const nextRemote=!!status.trackers && (status.mode==='python'||status.signed_in);
      const nextIdentity=status.mode==='python'?'python':status.signed_in?status.identity_key:'browser';
      if(configured && nextRemote===remote && nextIdentity===identity) return;
      configured=true; remote=nextRemote;identity=nextIdentity; state=emptyTrackers();revision=0;
      await load();
    },
    reload:load,
    async update(mutator) {
      if (!ready || blocked) throw Error('Reload your tracker records before saving.');
      if (busy) throw Error('A save is in progress. Please wait.');
      busy=true;notify();onStatus('Saving tracker records…'); const ticket=generation;
      try {
        // Re-read guest storage before mutation to preserve another tab's work.
        const current=remote?{state,revision}:localEnvelope();
        const candidate=validateTrackers(mutator(structuredClone(current.state)));
        const envelope=remote?await request({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:current.revision,state:candidate})}):{state:candidate,revision:current.revision+1};
        if(ticket!==generation) throw Error('Your account changed while saving. Reload before continuing.');
        if(!remote) storage.setItem(TRACKER_KEY,JSON.stringify(envelope));
        state=envelope.state;revision=envelope.revision;onStatus(remote?'Saved to your '+(identity==='python'?'Python database.':'signed-in account.'):'Saved in this browser. Use the same browser to keep tracking.');
        return state;
      } catch(error) {
        if(error.status===409){blocked=true;onStatus('Another tab or device changed these records. Reload, then apply your change again.',true);}
        else onStatus(`Save not confirmed: ${error.message} Reload to check the saved records before retrying.`,true);
        throw error;
      } finally {busy=false;notify();}
    }
  };
}
