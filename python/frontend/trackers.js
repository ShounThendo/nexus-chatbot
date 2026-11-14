import {createTrackerStore} from './tracker-store.js';
import {dateKey, addDays, monthDays, newId, setCompletion, habitStats, sleepStats, formatHours, durationHours, validateTrackers} from './tracker-model.js';
import {localDateInput} from './core.js';

export function initTrackers({storage, toast, confirm, refreshStatus}) {
  const $=id=>document.getElementById(id);
  const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
  const button=(label,className,action)=>{const b=el('button',className,label);b.type='button';b.addEventListener('click',action);return b;};
  const friendly=(date,options={month:'short',day:'numeric'})=>new Date(`${date}T12:00:00`).toLocaleDateString(undefined,options);
  let selected=dateKey(), month=selected.slice(0,7), year=Number(selected.slice(0,4)), historyLimit=10, goalDirty=false, selectedHabitId=null;
  let dayAtRender=dateKey();
  const store=createTrackerStore({storage,onChange:render,onStatus:(text,error=false)=>{for(const name of ['progress','sleep']){const n=$(`tracker-status-${name}`);n.textContent=text;n.className=error?'storage-error':'';$(`${name}-storage`).hidden=!error;}}});
  const disabled=()=>!store.ready||store.busy;
  function stat(label,value,detail){const card=el('div','tracker-stat');card.append(el('span','tracker-stat-label',label),el('strong','',value),el('small','',detail));return card;}
  function empty(title,text){const n=el('div','tracker-empty');n.append(el('strong','',title),el('span','',text));return n;}
  async function save(mutator,errorId) {
    try {await store.update(mutator);return true;}
    catch(error){if(errorId)$(errorId).textContent=error.message;toast(error.message);return false;}
  }
  function render(){
    renderProgress();renderSleep();
    for(const id of ['add-habit','add-sleep','save-habit','save-sleep','save-sleep-goal'])$(id).disabled=disabled();
    document.querySelectorAll('[data-habit-name]').forEach(b=>b.disabled=disabled());
    document.querySelectorAll('[data-reload-trackers]').forEach(b=>b.disabled=store.busy);
  }
  function selectHabit(id){selectedHabitId=id;renderProgress();document.querySelectorAll('[data-calendar-habit]').forEach(b=>{if(b.dataset.calendarHabit===(id||''))b.focus();});}
  function renderProgress(){
    const state=store.state, today=dateKey();
    // Reset the selection when deleted or when an account switch clears records.
    const habit=state.habits.find(h=>h.id===selectedHabitId);
    if(!habit)selectedHabitId=null;
    const scoped=habit?{...state,habits:[habit],completions:state.completions.filter(c=>c.habitId===habit.id)}:state;
    const stats=habitStats(scoped,today,year), overviewStats=habitStats(state,today,year);
    const filters=$('habit-filters');
    if(filters){
      filters.replaceChildren();filters.className='habit-filters';filters.setAttribute('role','group');
      for(const choice of [{id:null,name:'All habits'},...state.habits]){const active=choice.id===selectedHabitId;const b=button(choice.name,`habit-filter${active?' active':''}`,()=>selectHabit(choice.id));b.setAttribute('aria-pressed',String(active));b.dataset.calendarHabit=choice.id||'';filters.append(b);}
    }
    $('progress-stats').replaceChildren(
      stat('This week',store.ready?`${stats.weekCount} check-ins`:'—',`${stats.credited} of ${stats.target} target days credited`),
      stat('Weekly target',store.ready && stats.percent!==null?`${stats.percent}%`:'—',habit?`${habit.name} · ${habit.weeklyTarget} days per week`:'Each habit contributes up to its own target'),
      stat(`${year} completions`,store.ready?String(stats.yearCount):'—',`${stats.activeDays} days with a habit completed`),
      stat('Current day streak',store.ready?`${stats.current} days`:'—',`${habit?habit.name:'Any habit'} · all-time best ${stats.best} days`)
    );
    $('calendar-title').textContent=`${habit?`${habit.name} · `:''}${friendly(`${month}-01`,{month:'long',year:'numeric'})}`;
    const grid=$('habit-calendar');grid.replaceChildren();
    const dates=monthDays(month), offset=(new Date(`${dates[0]}T12:00:00Z`).getUTCDay()+6)%7;
    for(let i=0;i<offset;i++){const spacer=el('span','calendar-spacer');spacer.setAttribute('aria-hidden','true');grid.append(spacer);}
    for(const day of dates){
      const records=scoped.completions.filter(c=>c.date===day), count=records.length;
      const cell=button('',`calendar-day${count?' has-completions':''}${day===today?' today':''}${day===selected?' selected':''}`,()=>{selected=day;renderProgress();});
      cell.setAttribute('aria-label',`${friendly(day,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}: ${habit?`${habit.name} ${count?'complete':'incomplete'}`:`${count} habits completed`}`);
      cell.setAttribute('aria-pressed',String(day===selected));if(day===today)cell.setAttribute('aria-current','date');
      cell.disabled=day>today;cell.append(el('span','',String(Number(day.slice(-2)))));
      const tick=el('span','day-completion',count?(habit?'✓':`✓ ${count}`):'');tick.setAttribute('aria-hidden','true');cell.append(tick);grid.append(cell);
    }
    $('selected-date').textContent=friendly(selected,{weekday:'long',month:'short',day:'numeric'});
    const eligible=scoped.habits.filter(h=>h.startDate<=selected), done=scoped.completions.filter(c=>c.date===selected);
    $('selected-date-summary').textContent=habit?(eligible.length?`${habit.name}: ${done.length?'complete':'not complete'}`:`${habit.name} starts ${friendly(habit.startDate)}.`):eligible.length?`${done.length} of ${eligible.length} habits completed`:'A fresh place to start.';
    const list=$('daily-habits');list.replaceChildren();
    if(!eligible.length)list.append(empty(habit?'Before your start date':state.habits.length?'No habits on this date':'Make your first habit',habit?'Choose a date on or after this habit’s start date.':'Add a habit and choose the date you started. No history is filled in for you.'));
    for(const h of eligible){const complete=done.some(c=>c.habitId===h.id);const b=button('',`daily-habit${complete?' done':''}`,async()=>{await save(state=>setCompletion(state,h.id,selected,!complete));});b.disabled=disabled()||selected>today;b.setAttribute('aria-pressed',String(complete));b.setAttribute('aria-label',`${h.name}: ${complete?'complete, mark incomplete':'incomplete, mark complete'}`);b.dataset.habitId=h.id;const check=el('span','habit-check',complete?'✓':'');check.setAttribute('aria-hidden','true');b.append(check,el('span','',h.name));list.append(b);}
    $('week-caption').textContent=`This week: ${friendly(stats.weekStart)} – ${friendly(stats.weekEnd)}. Targets count distinct days.`;
    const overview=$('habit-overview');overview.replaceChildren();
    for(const h of overviewStats.rows){
      const row=el('div','habit-overview-row');const name=el('div');name.append(el('span','habit-name',h.name),el('span','habit-row-detail',`From ${friendly(h.startDate,{day:'numeric',month:'short',year:'numeric'})} · ${h.total} total`));
      const progress=el('div');const label=el('div','habit-week-label');label.append(el('span','',`${h.week} / ${h.weeklyTarget} days this week`),el('span','',`${h.percent}%`));const meter=el('div','habit-meter');meter.setAttribute('role','progressbar');meter.setAttribute('aria-label',`${h.name} weekly target`);meter.setAttribute('aria-valuenow',h.percent);meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');const fill=el('span');fill.style.width=`${h.percent}%`;meter.append(fill);progress.append(label,meter);
      const streak=el('div');streak.append(el('span','habit-name',`${h.current} day streak`),el('span','habit-row-detail',`Best ${h.best} days`));
      const actions=el('div','habit-actions');const view=button('View calendar','text-button',()=>{selectHabit(h.id);$('habit-filters')?.scrollIntoView?.({behavior:'smooth',block:'start'});});view.setAttribute('aria-label',`View calendar for ${h.name}`);view.setAttribute('aria-pressed',String(h.id===selectedHabitId));const edit=button('Edit','text-button',()=>openHabit(h));edit.disabled=disabled();edit.setAttribute('aria-label',`Edit ${h.name}`);
      const remove=button('Delete','text-button danger-text',()=>confirm('Delete this habit?',`“${h.name}” and its ${h.total} saved completions will be removed. Your other habits will stay.`, 'Delete habit',async()=>{await save(s=>({...s,habits:s.habits.filter(x=>x.id!==h.id),completions:s.completions.filter(c=>c.habitId!==h.id)}));}));remove.disabled=disabled();remove.setAttribute('aria-label',`Delete ${h.name}`);actions.append(view,edit,remove);row.append(name,progress,streak,actions);overview.append(row);
    }
    $('habit-starters').hidden=state.habits.length>0;
    $('year-title').textContent=habit?`${habit.name} in ${year}`:`A look at ${year}`;$('year-summary').textContent=`${stats.yearCount} recorded completions across ${stats.activeDays} active days${habit?` for ${habit.name}`:''}.`;
    const years=new Set([year,Number(today.slice(0,4)),...state.habits.map(h=>Number(h.startDate.slice(0,4))),...state.completions.map(c=>Number(c.date.slice(0,4)))]);
    const currentYear=Number(today.slice(0,4));for(let i=currentYear-4;i<=currentYear;i++)years.add(i);
    $('progress-year').replaceChildren();for(const y of [...years].sort((a,b)=>b-a)){const option=el('option','',y);option.value=String(y);$('progress-year').append(option);}$('progress-year').value=String(year);
    const chart=$('year-chart');chart.replaceChildren();const max=Math.max(1,...stats.monthly);
    stats.monthly.forEach((count,index)=>{const name=new Date(2000,index,1).toLocaleDateString(undefined,{month:'short'});const column=el('div','chart-column');column.setAttribute('role','img');column.setAttribute('aria-label',`${name} ${year}: ${count} completions`);column.append(el('span','chart-value',count));const area=el('div','chart-bar-area');const bar=el('div','chart-bar');bar.style.height=`${count/max*100}%`;area.append(bar);column.append(area,el('span','chart-label',name));chart.append(column);});
  }
  function renderSleep(){
    const state=store.state, stats=sleepStats(state);
    $('sleep-stats').replaceChildren(
      stat('7-day sleep average',formatHours(stats.average),`Based on ${stats.loggedDays} of 7 days logged`),
      stat('Sleep goal',formatHours(state.preferences.sleepGoal),'Your chosen nightly target'),
      stat('Days reaching goal',String(stats.goalDays),`Of ${stats.loggedDays} logged days in the last 7`),
      stat('Average sleep quality',stats.quality===null?'—':`${stats.quality.toFixed(1)} / 5`,`From ${stats.sessions} sessions in the last 7 days`)
    );
    if(!goalDirty)$('sleep-goal').value=String(state.preferences.sleepGoal);
    $('sleep-chart-caption').textContent=`${friendly(stats.daily[0].date)} – ${friendly(stats.daily[6].date)} · grouped by wake-up date`;
    $('sleep-chart-goal').textContent=`Goal ${formatHours(state.preferences.sleepGoal)}`;
    const chart=$('sleep-chart');chart.replaceChildren();const max=Math.max(10,state.preferences.sleepGoal+1,...stats.daily.map(d=>d.hours||0));
    for(const day of stats.daily){
      const column=el('div','chart-column');column.setAttribute('role','img');column.setAttribute('aria-label',`${friendly(day.date)}: ${day.hours===null?'No sleep logged':formatHours(day.hours)}`);column.append(el('span','chart-value',day.hours===null?'—':formatHours(day.hours)));
      const area=el('div','chart-bar-area');const goal=el('span','chart-goal-line');goal.style.bottom=`${state.preferences.sleepGoal/max*100}%`;goal.setAttribute('aria-hidden','true');area.append(goal);
      if(day.hours===null)area.append(el('span','chart-no-log','—'));else{const bar=el('div','chart-bar');bar.style.height=`${day.hours/max*100}%`;area.append(bar);}
      column.append(area,el('span','chart-label',friendly(day.date,{weekday:'short'})),el('span','chart-label',friendly(day.date,{day:'numeric',month:'short'})));chart.append(column);
    }
    const history=$('sleep-history');history.replaceChildren();const records=[...state.sleep].sort((a,b)=>b.wakeTime.localeCompare(a.wakeTime));
    if(!records.length)history.append(empty('Your first night starts here','Log bedtime, wake-up time, and how you felt. Your summaries will appear as you add records.'));
    const qualities=['','Very poor','Poor','Okay','Good','Great'];
    for(const r of records.slice(0,historyLimit)){
      const row=el('div','sleep-history-row');const date=el('div');date.append(el('strong','',friendly(r.wakeDate,{day:'numeric',month:'short',year:'numeric'})),el('span','sleep-quality',`${r.quality}/5 · ${qualities[r.quality]}`));
      const times=el('div','sleep-times');const format=iso=>new Date(iso).toLocaleString(undefined,{timeZone:r.timeZone,month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});times.append(el('div','',`Bed ${format(r.bedtime)}`),el('div','',`Wake ${format(r.wakeTime)}`),el('span','habit-row-detail',r.timeZone.replaceAll('_',' ')));
      const duration=el('strong','',formatHours(durationHours(r)));const actions=el('div','habit-actions');const edit=button('Edit','text-button',()=>openSleep(r));edit.disabled=disabled();edit.setAttribute('aria-label',`Edit sleep from ${r.wakeDate}`);const remove=button('Delete','text-button danger-text',()=>confirm('Delete this sleep log?',`Remove the session ending ${friendly(r.wakeDate)}? Your averages will update.`, 'Delete log',async()=>{await save(s=>({...s,sleep:s.sleep.filter(x=>x.id!==r.id)}));}));remove.disabled=disabled();actions.append(edit,remove);row.append(date,times,duration,actions);if(r.notes)row.append(el('p','sleep-notes',r.notes));history.append(row);
    }
    $('more-sleep').hidden=records.length<=historyLimit;
  }
  function openHabit(habit, suggested=''){
    if(disabled())return;$('habit-form').reset();$('habit-dialog-title').textContent=habit?'Edit habit':'Create a habit';$('habit-id').value=habit?.id||'';$('habit-name').value=habit?.name||suggested;$('habit-target').value=String(habit?.weeklyTarget||3);$('habit-start').value=habit?.startDate||selected;$('habit-start').max=dateKey();$('habit-error').textContent='';$('habit-dialog').showModal();$('habit-name').focus();
  }
  function durationPreview(){
    const bed=$('sleep-bedtime').value, wake=$('sleep-wake').value, hours=(+new Date(wake)-+new Date(bed))/3600000;
    $('sleep-duration-preview').textContent=!bed||!wake?'Enter both dates and times.':hours>0 && hours<=24?`Duration: ${formatHours(hours)}`:'Wake-up must be after bedtime, with a duration of no more than 24 hours.';
  }
  function openSleep(record){
    if(disabled())return;$('sleep-form').reset();$('sleep-dialog-title').textContent=record?'Edit sleep':'Log your sleep';$('sleep-id').value=record?.id||'';
    $('sleep-bedtime').value=record?localDateInput(new Date(record.bedtime)):'';$('sleep-wake').value=record?localDateInput(new Date(record.wakeTime)):'';
    const now=localDateInput(new Date());$('sleep-bedtime').max=now;$('sleep-wake').max=now;$('sleep-quality').value=record?String(record.quality):'';$('sleep-notes').value=record?.notes||'';$('sleep-error').textContent='';
    $('sleep-timezone').textContent=`Enter times in ${Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_',' ')}. For overnight sleep, choose the following date for wake-up.`;durationPreview();$('sleep-dialog').showModal();$('sleep-bedtime').focus();
  }
  $('add-habit').addEventListener('click',()=>openHabit());
  document.querySelectorAll('[data-habit-name]').forEach(b=>b.addEventListener('click',()=>openHabit(undefined,b.dataset.habitName)));
  $('habit-form').addEventListener('submit',async e=>{
    e.preventDefault();$('habit-error').textContent='';const h={id:$('habit-id').value||newId(),name:$('habit-name').value,weeklyTarget:Number($('habit-target').value),startDate:$('habit-start').value};
    if(h.startDate>dateKey()){$('habit-error').textContent='Choose today or an earlier start date.';return;}
    if(await save(s=>{const existing=s.habits.some(x=>x.id===h.id);return {...s,habits:existing?s.habits.map(x=>x.id===h.id?h:x):[...s.habits,h]};},'habit-error')){$('habit-dialog').close();toast('Habit saved.');}
  });
  function moveMonth(delta){const d=new Date(`${month}-01T12:00:00Z`);d.setUTCMonth(d.getUTCMonth()+delta);month=d.toISOString().slice(0,7);renderProgress();}
  $('calendar-prev').addEventListener('click',()=>moveMonth(-1));$('calendar-next').addEventListener('click',()=>moveMonth(1));
  $('calendar-today').addEventListener('click',()=>{selected=dateKey();month=selected.slice(0,7);renderProgress();});
  $('progress-year').addEventListener('change',()=>{year=Number($('progress-year').value);renderProgress();});
  $('add-sleep').addEventListener('click',()=>openSleep());
  for(const id of ['sleep-bedtime','sleep-wake'])$(id).addEventListener('input',durationPreview);
  $('sleep-form').addEventListener('submit',async e=>{
    e.preventDefault();$('sleep-error').textContent='';
    try {
      const bed=$('sleep-bedtime').value,wake=$('sleep-wake').value;
      // Reject nonexistent local times rather than silently shifting during a DST gap.
      for(const value of [bed,wake])if(!value||!Number.isFinite(+new Date(value))||localDateInput(new Date(value))!==value)throw Error('Enter valid local dates and times.');
      const record={id:$('sleep-id').value||newId(),bedtime:new Date(bed).toISOString(),wakeTime:new Date(wake).toISOString(),wakeDate:wake.slice(0,10),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,quality:Number($('sleep-quality').value),notes:$('sleep-notes').value,source:'manual'};
      const candidate=s=>({...s,sleep:[...s.sleep.filter(x=>x.id!==record.id),record]});validateTrackers(candidate(store.state));
      if(await save(candidate,'sleep-error')){$('sleep-dialog').close();toast('Sleep saved.');}
    } catch(error){$('sleep-error').textContent=error.message;}
  });
  $('sleep-goal').addEventListener('input',()=>{goalDirty=true;});
  $('sleep-goal-form').addEventListener('submit',async e=>{e.preventDefault();$('sleep-goal-error').textContent='';const goal=Number($('sleep-goal').value);if(await save(s=>({...s,preferences:{...s.preferences,sleepGoal:goal}}),'sleep-goal-error')){goalDirty=false;toast('Sleep goal saved.');}});
  $('more-sleep').addEventListener('click',()=>{historyLimit+=10;renderSleep();});
  document.querySelectorAll('[data-reload-trackers]').forEach(b=>b.addEventListener('click',async()=>{await refreshStatus();await store.reload();}));
  window.addEventListener?.('storage',event=>{if(event.key==='everyday-trackers-v1' && !store.busy)store.reload();});
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible' && dateKey()!==dayAtRender){dayAtRender=dateKey();render();}});
  render();
  return {configure:status=>store.configure(status),store};
}
