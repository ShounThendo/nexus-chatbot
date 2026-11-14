// Pure tracker rules. No browser, database, network, or demonstration records.
export const TRACKER_VERSION = 1;
export const TRACKER_KEY = 'everyday-trackers-v1';
export const emptyTrackers = () => ({version: TRACKER_VERSION, habits: [], completions: [], sleep: [], preferences: {sleepGoal: 8}});
export const newId = () => crypto.randomUUID();
export const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === value;
}
export function addDays(key, count) {
  const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+count);
  return d.toISOString().slice(0,10);
}
export function weekStart(key) {
  const day = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDays(key, -(day+6)%7);
}
export function monthDays(month) {
  const first = `${month}-01`;
  if (!validDate(first)) throw Error('Choose a valid month.');
  const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth()+1); d.setUTCDate(0);
  return Array.from({length: d.getUTCDate()}, (_,i) => addDays(first,i));
}
export function dateInZone(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
  const get = key => parts.find(p => p.type===key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function validateTrackers(input, now = new Date()) {
  const fail = message => {throw Error(message);};
  if (!input || input.version !== 1 || !Array.isArray(input.habits) || !Array.isArray(input.completions) || !Array.isArray(input.sleep)) fail('Unsupported or damaged tracker data.');
  if (input.habits.length>100 || input.completions.length>40000 || input.sleep.length>10000) fail('Tracker storage limit reached. Export a backup before removing old records.');
  const validId = id => typeof id==='string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
  const ids = new Set(), names = new Set();
  const habits = input.habits.map(h => {
    if (!h || !validId(h.id) || ids.has(h.id)) fail('Invalid or duplicate habit ID.');
    if (typeof h.name!=='string' || !h.name.trim() || h.name.trim().length>60) fail('Use a habit name of 1–60 characters.');
    if (names.has(h.name.trim().toLowerCase())) fail('A habit with that name already exists.');
    if (!Number.isInteger(h.weeklyTarget) || h.weeklyTarget<1 || h.weeklyTarget>7) fail('Choose a weekly target between 1 and 7 days.');
    if (!validDate(h.startDate)) fail('Choose a valid habit start date.');
    ids.add(h.id); names.add(h.name.trim().toLowerCase());
    return {id:h.id,name:h.name.trim(),weeklyTarget:h.weeklyTarget,startDate:h.startDate};
  });
  const seen = new Set();
  const completions = input.completions.map(c => {
    const h = habits.find(h => h.id===c?.habitId), key = `${c?.habitId}:${c?.date}`;
    if (!h || !validDate(c.date) || c.date<h.startDate || seen.has(key)) fail('Invalid or duplicate habit completion.');
    // UTC+14 is the furthest current local date; the UI enforces the user's today.
    if (c.date>new Date(+now+14*3600000).toISOString().slice(0,10)) fail('Future dates cannot be marked complete.');
    seen.add(key); return {habitId:c.habitId,date:c.date};
  });
  const sleepIds = new Set();
  const sleep = input.sleep.map(s => {
    if (!s || !validId(s.id) || sleepIds.has(s.id)) fail('Invalid or duplicate sleep ID.');
    const iso = x => typeof x==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && validDate(x.slice(0,10));
    if (!iso(s.bedtime) || !iso(s.wakeTime)) fail('Enter complete bedtime and wake-up dates and times.');
    const start = Date.parse(s.bedtime), end = Date.parse(s.wakeTime);
    if (end<=start || end-start>24*3600000) fail('Wake-up must be after bedtime, with a duration of no more than 24 hours.');
    if (end>+now) fail('Log sleep after you wake up. Future sessions cannot be saved.');
    if (!validDate(s.wakeDate) || typeof s.timeZone!=='string') fail('Invalid sleep date or timezone.');
    try {if (dateInZone(s.wakeTime,s.timeZone)!==s.wakeDate) fail('Sleep date must match the wake-up date.');} catch {fail('Invalid sleep date or timezone.');}
    if (!Number.isInteger(s.quality) || s.quality<1 || s.quality>5) fail('Choose a sleep quality from 1 to 5.');
    if (typeof s.notes!=='string' || s.notes.length>1000 || s.source!=='manual') fail('Invalid sleep notes or source.');
    sleepIds.add(s.id);
    return {id:s.id,bedtime:s.bedtime,wakeTime:s.wakeTime,wakeDate:s.wakeDate,timeZone:s.timeZone,quality:s.quality,notes:s.notes.trim(),source:'manual'};
  }).sort((a,b) => a.bedtime.localeCompare(b.bedtime));
  for (let i=1;i<sleep.length;i++) if (Date.parse(sleep[i].bedtime)<Date.parse(sleep[i-1].wakeTime)) fail('This sleep session overlaps an existing record. Edit that record or choose different times.');
  const goal = input.preferences?.sleepGoal;
  if (typeof goal!=='number' || !Number.isFinite(goal) || goal<1 || goal>16 || !Number.isInteger(goal*4)) fail('Choose a sleep goal of 1–16 hours in 15-minute steps.');
  return {version:1,habits,completions,sleep,preferences:{sleepGoal:goal}};
}
export function setCompletion(state, habitId, day, complete, today=dateKey()) {
  const habit=state.habits.find(h=>h.id===habitId);
  if (!habit || !validDate(day) || day<habit.startDate || day>today) throw Error('Choose a date from this habit’s start date through today.');
  const completions=state.completions.filter(c=>!(c.habitId===habitId && c.date===day));
  if (complete) completions.push({habitId,date:day});
  return {...state,completions};
}
export function streaks(days, today=dateKey()) {
  const unique=[...new Set(days.filter(d=>d<=today))].sort();
  let best=0, run=0, previous;
  for (const day of unique) {run=previous && addDays(previous,1)===day ? run+1 : 1; best=Math.max(best,run); previous=day;}
  const set=new Set(unique); let current=0, cursor=set.has(today)?today:addDays(today,-1);
  while (set.has(cursor)) {current++; cursor=addDays(cursor,-1);}
  return {current,best};
}
export function habitStats(state, today=dateKey(), year=Number(today.slice(0,4))) {
  const start=weekStart(today), end=addDays(start,6);
  const rows=state.habits.map(h=>{
    const records=state.completions.filter(c=>c.habitId===h.id && c.date<=today);
    const week=records.filter(c=>c.date>=start && c.date<=end).length;
    return {...h,week,total:records.length,percent:Math.min(100,Math.round(week/h.weeklyTarget*100)),...streaks(records.map(c=>c.date),today)};
  });
  const active=rows.filter(h=>h.startDate<=today);
  const target=active.reduce((s,h)=>s+h.weeklyTarget,0), credited=active.reduce((s,h)=>s+Math.min(h.week,h.weeklyTarget),0);
  const yearly=state.completions.filter(c=>c.date.startsWith(`${year}-`) && c.date<=today);
  const monthly=Array.from({length:12},(_,i)=>yearly.filter(c=>Number(c.date.slice(5,7))===i+1).length);
  return {rows,weekStart:start,weekEnd:end,target,credited,weekCount:active.reduce((s,h)=>s+h.week,0),percent:target?Math.round(credited/target*100):null,yearCount:yearly.length,activeDays:new Set(yearly.map(c=>c.date)).size,monthly,...streaks(state.completions.map(c=>c.date),today)};
}
export const durationHours = record => (Date.parse(record.wakeTime)-Date.parse(record.bedtime))/3600000;
export function sleepStats(state, today=dateKey()) {
  const days=Array.from({length:7},(_,i)=>addDays(today,i-6));
  const daily=days.map(date=>{const records=state.sleep.filter(s=>s.wakeDate===date);return {date,count:records.length,hours:records.length?records.reduce((s,r)=>s+durationHours(r),0):null};});
  const logged=daily.filter(d=>d.count), records=state.sleep.filter(s=>days.includes(s.wakeDate));
  return {daily,loggedDays:logged.length,sessions:records.length,average:logged.length?logged.reduce((s,d)=>s+d.hours,0)/logged.length:null,quality:records.length?records.reduce((s,r)=>s+r.quality,0)/records.length:null,goalDays:logged.filter(d=>d.hours>=state.preferences.sleepGoal).length};
}
export function formatHours(hours) {
  if (hours===null || hours===undefined) return '—';
  const minutes=Math.round(hours*60); return `${Math.floor(minutes/60)}h ${String(minutes%60).padStart(2,'0')}m`;
}
