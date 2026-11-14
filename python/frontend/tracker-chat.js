import {dateKey, addDays, weekStart, habitStats, sleepStats, durationHours, formatHours, validDate, setCompletion} from './tracker-model.js';

export const TRACKER_PROMPTS = ['How consistent have I been this week?', 'How much sleep did I average over the last seven days?'];

export function isTrackerQuestion(message) {
  const t=message.toLowerCase();
  if (/^(?:please\s+)?(?:mark|make|undo)\b/.test(t.trim())) return true;
  if (/\b(remind|reminder|weather|exercises for)\b/.test(t)) return false;
  if (/\bmark .+ (?:complete|incomplete|done)\b|\b(?:log|record) (?:my |last nights? |last night.s? )?sleep\b/.test(t)) return true;
  const subject=/\b(habit|habits|tracker|gym|running|coding|studying|sleep|slept|bedtime)\b/.test(t);
  const query=/\b(my|i|me)\b/.test(t) && /\b(show|list|goal|quality|duration|progress|consistent|consistency|streak|average|averaged|many|much|did|done|complete|completed|target|targets|summary|summarise|summarize|log|mark|record)\b/.test(t);
  return (subject && query) || /\bhow consistent have i been\b/.test(t) || /\b(?:my|show|summarise|summarize) (?:weekly |habit )?progress\b/.test(t) || /\bhow many (?:times|days) (?:did|have) i\b/.test(t);
}

function period(text,today,sleep=false) {
  if (/\b(last|past) (?:seven|7) days\b/.test(text)) return {start:addDays(today,-6),end:today,label:'the last seven days'};
  if (/\byesterday\b/.test(text)) return {start:addDays(today,-1),end:addDays(today,-1),label:'yesterday'};
  if (/\btoday\b|last night/.test(text)) return {start:today,end:today,label:sleep?'today (by wake-up date)':'today'};
  if (/\blast week\b/.test(text)) return {start:addDays(weekStart(today),-7),end:addDays(weekStart(today),-1),label:'last week (Monday–Sunday)'};
  if (/\bthis year\b/.test(text)) return {start:today.slice(0,4)+'-01-01',end:today,label:'this year'};
  if (/\b(all time|ever)\b/.test(text)) return {start:'0001-01-01',end:today,label:'all time'};
  if (/\bthis week\b/.test(text)) return {start:weekStart(today),end:today,label:'this week (Monday–today)'};
  // Do not silently answer a different timeframe from the one requested.
  if (/\b(month|months|week|weeks|year|years|days|january|february|march|april|may|june|july|august|september|october|november|december)\b|\d{4}-\d{2}-\d{2}/.test(text)) return null;
  return sleep?{start:addDays(today,-6),end:today,label:'the last seven days'}:{start:weekStart(today),end:today,label:'this week (Monday–today)'};
}

export function trackerAnswer(message,state,today=dateKey()) {
  const text=message.toLowerCase().replace(/[’']/g,'');
  if (/\b(mark|log|record|delete|remove|edit|change|set|add)\b/.test(text)) return 'I haven’t changed any records. To update a habit, try “Mark Gym complete today” or “Undo Gym completion today”. Use Sleep inside Progress Tracker to log a sleep session.';
  const sleep=/\b(sleep|slept|bedtime)\b/.test(text),range=period(text,today,sleep);
  if(!range) return 'Please choose today, yesterday, this week, last week, the last seven days, this year, or all time. I haven’t estimated a different date range.';
  const inRange=day=>day>=range.start&&day<=range.end;
  const dates=`${range.start==='0001-01-01'?'First record':range.start} to ${range.end}`;
  if(sleep){
    const records=state.sleep.filter(r=>inRange(r.wakeDate)),days=new Set(records.map(r=>r.wakeDate)).size;
    if(!records.length)return `You have no sleep logs for ${range.label}. Add a session in Sleep inside Progress Tracker to calculate an average. Missing days are not counted as zero.`;
    const hours=records.reduce((sum,r)=>sum+durationHours(r),0),quality=records.reduce((sum,r)=>sum+r.quality,0)/records.length;
    // Use the same aggregation as the Sleep page for its default seven-day view.
    const average=range.start===addDays(today,-6)&&range.end===today?sleepStats(state,today).average:hours/days;
    return `Your recorded sleep for ${range.label} (${dates}):\n• Average: ${formatHours(average)} per logged day\n• ${records.length} session(s) across ${days} logged day(s)\n• Average quality: ${quality.toFixed(1)} / 5\n• Current nightly goal: ${formatHours(state.preferences.sleepGoal)}\n\nGrouped by each session’s recorded wake-up date. Multiple sessions on a day are added together; missing days are excluded.`;
  }
  const aliases={gym:['gym','exercise','exercised','workout','workouts'],running:['running','run','ran'],coding:['coding','code','coded'],studying:['studying','study','studied']};
  const words=new Set(text.match(/[\p{L}\p{N}_-]+/gu)||[]);
  const named=state.habits.filter(h=>{
    const name=h.name.toLowerCase();
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,'u').test(text) || (aliases[name]||[]).some(alias=>words.has(alias));
  });
  const specific=/\b(gym|exercise|exercised|workouts?|running|run|ran|coding|code|coded|studying|study|studied)\b/.test(text)||(/\bhow many (times|days)\b/.test(text)&&!/\b(habits?|progress|check-ins?)\b/.test(text));
  if(!named.length&&specific)return `I couldn’t match that activity to a saved habit. Your habits: ${state.habits.map(h=>h.name).join(', ')||'none yet'}. Use the habit’s exact name, or add it in Progress Tracker.`;
  const habits=named.length?named:state.habits,ids=new Set(habits.map(h=>h.id));
  if(!habits.length)return 'You haven’t created any habits yet. Add one in Progress Tracker, then record completions to see your progress here.';
  const completions=state.completions.filter(c=>ids.has(c.habitId)&&inRange(c.date));
  const stats=habitStats(state,today),rows=stats.rows.filter(h=>ids.has(h.id));
  const lines=habits.map(h=>`${h.name}: ${completions.filter(c=>c.habitId===h.id).length} completed day(s)`);
  const weekly=range.start===weekStart(today)&&range.end===today;
  const credited=rows.reduce((s,h)=>s+Math.min(h.week,h.weeklyTarget),0),target=rows.filter(h=>h.startDate<=today).reduce((s,h)=>s+h.weeklyTarget,0);
  return `Your habit progress for ${range.label} (${dates}):\n${lines.map(l=>'• '+l).join('\n')}\n${completions.length} recorded check-in(s) across ${new Set(completions.map(c=>c.date)).size} active day(s).`+
    (weekly?`\nWeekly target: ${target?Math.round(credited/target*100)+'%':'not set'} (${credited} of ${target} target days credited, capped per habit).`:'')+
    `\n\nCurrent daily streaks (as of ${today}):\n${rows.map(h=>`• ${h.name}: ${h.current} day(s), best ${h.best}`).join('\n')}\nStreaks count consecutive completed calendar days; rest days break a streak.`;
}

// Only explicit single-action commands may write. Keep natural-language questions,
// negations, multiple actions and unsupported dates out of the mutation path.
export function parseHabitCommand(message,today=dateKey(),habits=[]) {
  const text=message.trim().replace(/[’]/g,"'").replace(/[.!]+$/,'').replace(/^please\s+/i,'').replace(/\s+please$/i,'');
  if (!/^(mark|make|undo)\b/i.test(text)) return null;
  const invalid={error:'I haven’t changed any records. Try “Mark Gym complete today”, “Mark Gym incomplete yesterday”, or “Undo Gym completion today”. Use today, yesterday, or a date like 2026-10-17.'};
  if (/[?;\n]/.test(text)) return invalid;
  let match=/^(?:mark|make)\s+(.+)\s+(?:as\s+)?(complete|completed|done|incomplete)(?:\s+(?:on\s+|for\s+)?(.+))?$/i.exec(text);
  let name,complete,when;
  if (match) {
    name=match[1];
    if (!habits.some(h=>h.name.toLowerCase()===name.toLowerCase())) name=name.replace(/\s+as$/i,'');
    complete=!/^incomplete$/i.test(match[2]);when=match[3];
  }
  else {
    match=/^undo\s+(?:(today|yesterday)'?s\s+)?(.+)\s+completion(?:\s+(?:on\s+|for\s+)?(.+))?$/i.exec(text);
    if (!match || (match[1] && match[3])) return invalid;
    name=match[2];complete=false;when=match[1]||match[3];
  }
  when=(when||'today').toLowerCase();
  const day=when==='today'?today:when==='yesterday'?addDays(today,-1):when;
  if (!validDate(day)) return invalid;
  if (day>today) return {error:'I haven’t changed any records. Future days cannot be marked complete or incomplete.'};
  const exact=value=>habits.some(h=>h.name.toLowerCase()===value.toLowerCase());
  name=name.trim();
  if (!exact(name)) name=name.replace(/^my\s+/i,'');
  // Reserved words are safe within an exact saved label ("Mind and body").
  // Otherwise they indicate a negation, condition or compound command.
  if (!exact(name) && /\b(not|never|dont|don't|without|unless|if|and|or|then)\b/i.test(name)) return invalid;
  return {name,complete,day};
}

function commandHabits(name,habits) {
  const normalized=name.toLowerCase().replace(/\s+/g,' ');
  const exact=habits.filter(h=>h.name.toLowerCase()===normalized);
  if (exact.length) return exact;
  // Service names require an exact habit label to avoid confusing reminder
  // management or weather requests with partial habit-name matches.
  if (/\b(remind|reminder|weather|exercises for)\b/.test(normalized)) return [];
  const aliases={gym:['exercise','exercised','workout','workouts'],running:['run','ran'],coding:['code','coded'],studying:['study','studied']};
  return habits.filter(h=>{
    const label=h.name.toLowerCase();
    return (aliases[label]||[]).includes(normalized) || label.split(/\s+/).includes(normalized);
  });
}

async function habitCommandAnswer(command,state,updateState,today) {
  if(command.error) return command.error;
  const matches=commandHabits(command.name,state.habits);
  if(matches.length!==1) return matches.length
    ?`I haven’t changed any records. Which habit did you mean? ${matches.map(h=>h.name).join(', ')}. Use its full name in your command.`
    :`I couldn’t match that activity to a saved habit. Your habits: ${state.habits.map(h=>h.name).join(', ')||'none yet'}. Use the habit’s exact name, or add it in Progress Tracker. Nothing was changed.`;
  const habit=matches[0];
  if(command.day<habit.startDate) return `I haven’t changed any records. ${habit.name} started on ${habit.startDate}; choose that date or a later day.`;
  if(!updateState) return 'I haven’t changed any records. Tracker saving is unavailable. Use Progress Tracker to update this habit.';
  let previouslyComplete;
  const saved=await updateState(current=>{
    const currentHabit=current.habits.find(h=>h.id===habit.id);
    if(!currentHabit || currentHabit.name!==habit.name || currentHabit.startDate!==habit.startDate) throw Error('The habit changed while saving. Reload your trackers and try again.');
    previouslyComplete=current.completions.some(c=>c.habitId===habit.id&&c.date===command.day);
    return setCompletion(current,habit.id,command.day,command.complete,today);
  });
  // Report success only after persistence returns the requested final state.
  const savedHabit=saved?.habits?.find(h=>h.id===habit.id);
  const confirmed=saved?.completions?.some(c=>c.habitId===habit.id&&c.date===command.day);
  if(!savedHabit || !Array.isArray(saved.completions) || confirmed!==command.complete) throw Error('Tracker save was not confirmed. Reload your trackers to check before retrying.');
  const weekCount=new Set(saved.completions.filter(c=>c.habitId===habit.id&&c.date>=weekStart(today)&&c.date<=today).map(c=>c.date)).size;
  const changed=previouslyComplete!==command.complete;
  const confirmation=command.complete
    ?changed?`Well done! ${savedHabit.name} is marked complete for ${command.day}.`:`${savedHabit.name} was already complete for ${command.day}. No extra completion was added.`
    :changed?`${savedHabit.name} is marked incomplete for ${command.day}. That completion has been removed.`:`${savedHabit.name} was already incomplete for ${command.day}. No records were removed.`;
  return `${confirmation}\nYou’ve completed ${savedHabit.name} on ${weekCount} day${weekCount===1?'':'s'} this week (Monday–today), towards your target of ${savedHabit.weeklyTarget} days.\nActivity duration isn’t recorded; this counts completed days, not hours.`;
}

export function createTrackerResponder(readState,{today=()=>dateKey(),updateState}={}) {
  return async message=>{
    if(!isTrackerQuestion(message))return null;
    const state=await readState();
    const day=today(),command=parseHabitCommand(message,day,state.habits);
    if(command) return {reply:await habitCommandAnswer(command,state,updateState,day),route:'tracker_action'};
    return {reply:trackerAnswer(message,state,day),route:'tracker_summary'};
  };
}
