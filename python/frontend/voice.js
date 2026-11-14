// Browser speech is optional. Recognition only starts following a microphone click;
// final transcripts send once the recognition session finishes.
export const VOICE_KEY = 'everyday-voice-v1';

export function speechChunks(text, limit = 220) {
  const words = String(text ?? '').replace(/https?:\/\/\S+/g, 'link').replace(/[*_`#]/g, '').trim().split(/\s+/);
  const chunks = []; let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > limit) { chunks.push(line); line = ''; }
    line += (line ? ' ' : '') + word;
  }
  if (line) chunks.push(line);
  return chunks;
}

export function initVoice({ root = document, platform = window, storage, getBusy = () => false, onTranscript = () => {}, onComplete = () => {} } = {}) {
  const find = id => root.getElementById(id);
  const mic = find('voice-input'), status = find('voice-status'), auto = find('voice-auto'), stop = find('voice-stop');
  const Recognition = platform.SpeechRecognition || platform.webkitSpeechRecognition;
  const synth = platform.speechSynthesis, Utterance = platform.SpeechSynthesisUtterance;
  const canSpeak = !!(synth?.speak && Utterance);
  let recognition = null, listening = false, speaking = false, destroyed = false, generation = 0, spokenGeneration = 0, voiceDraft = '', busy = false;
  const listeners = [];
  const bind = (target, event, fn) => { if (target?.addEventListener) { target.addEventListener(event, fn); listeners.push([target, event, fn]); } };
  function announce(message) { if (status) status.textContent = message; }
  function paint() {
    if (mic) {
      mic.disabled = !Recognition || busy || getBusy() || destroyed;
      mic.setAttribute('aria-pressed', String(listening));
      mic.setAttribute('aria-label', listening ? 'Stop listening' : 'Speak a message');
      mic.title = listening ? 'Finish speaking and send' : 'Speak a message; it sends automatically when you finish';
    }
    if (stop) stop.disabled = !speaking;
    if (auto) auto.disabled = !canSpeak;
  }
  function stopListening() {
    const previous = recognition;
    recognition = null; listening = false; generation++;
    try { previous?.abort(); } catch { /* Browser may already have stopped. */ }
    paint();
  }
  function stopSpeaking() {
    spokenGeneration++; speaking = false;
    try { synth?.cancel(); } catch { /* Text remains available. */ }
    paint();
  }
  function cancel() { stopListening(); stopSpeaking(); announce('Voice stopped. You can type or speak a new message.'); }
  function start() {
    if (destroyed || busy || getBusy() || !Recognition) return;
    if (listening) {
      try { recognition?.stop(); announce('Finishing your voice message…'); }
      catch { cancel(); }
      return;
    }
    stopSpeaking();
    const token = ++generation;
    let finalText = '';
    try {
      const session = new Recognition(); recognition = session;
      session.lang = 'en-ZA'; session.continuous = false; session.interimResults = true; session.maxAlternatives = 1;
      session.onstart = () => { if (token !== generation) return; listening = true; announce('Listening… Your message sends automatically when you finish speaking.'); paint(); };
      session.onspeechend = () => { if (token !== generation) return; try { session.stop(); } catch { /* Already ending. */ } };
      session.onresult = event => {
        if (token !== generation || destroyed) return;
        const final = [], interim = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i], transcript = result[0]?.transcript?.trim();
          if (transcript) (result.isFinal ? final : interim).push(transcript);
        }
        if (final.length) {
          finalText = final.join(' '); voiceDraft = finalText;
          onTranscript(finalText);
          announce('Message captured. Sending when you finish speaking…');
        } else if (interim.length) announce(`Hearing: ${interim.join(' ')}`);
      };
      session.onerror = event => {
        if (token !== generation) return;
        const messages = {
          'not-allowed': 'Microphone access was denied. Allow microphone access in your browser or type your message.',
          'service-not-allowed': 'Speech recognition is unavailable in this browser. You can still type your message.',
          'audio-capture': 'No microphone is available. Check your microphone or type your message.',
          'no-speech': 'No speech was detected. Tap the microphone to try again, or type your message.',
          network: 'Speech recognition could not connect. Check your connection or type your message.',
          aborted: 'Listening stopped. You can type or speak a new message.'
        };
        announce(messages[event.error] || 'Voice input failed. Try again or type your message.');
        recognition = null; listening = false; generation++; paint();
      };
      session.onend = () => {
        if (token !== generation) return;
        recognition = null; listening = false; generation++;
        if (!finalText) announce('Listening ended without a message. Tap the microphone to try again, or type.');
        paint();
        if (finalText && !destroyed && !busy && !getBusy()) return onComplete(finalText);
      };
      listening = true; paint(); announce('Starting microphone…'); session.start();
    } catch {
      recognition = null; listening = false; generation++;
      announce('Could not start voice input. Try again or type your message.'); paint();
    }
  }
  function speak(text, { force = false } = {}) {
    if (destroyed || !canSpeak || (!force && !auto?.checked)) return false;
    const chunks = speechChunks(text);
    if (!chunks.length) return false;
    stopListening(); stopSpeaking();
    const token = spokenGeneration;
    const voice = synth.getVoices?.().find(v => v.lang?.toLowerCase() === 'en-za') || synth.getVoices?.().find(v => v.lang?.toLowerCase().startsWith('en'));
    speaking = true; paint(); announce('Reading the reply aloud. Use Stop audio to stop.');
    function next() {
      if (token !== spokenGeneration || destroyed) return;
      if (!chunks.length) { speaking = false; paint(); announce('Finished reading the reply.'); return; }
      try {
        const utterance = new Utterance(chunks.shift());
        utterance.lang = voice?.lang || 'en-ZA'; if (voice) utterance.voice = voice;
        utterance.rate = 1;
        utterance.onend = next;
        utterance.onerror = () => { if (token !== spokenGeneration) return; stopSpeaking(); announce('Audio could not play. Your reply is available as text.'); };
        synth.speak(utterance);
      } catch { stopSpeaking(); announce('Audio could not play. Your reply is available as text.'); }
    }
    next(); return true;
  }
  try { if (auto) auto.checked = JSON.parse(storage?.getItem(VOICE_KEY) || '{}').readAloud === true; } catch { /* Preference is optional. */ }
  bind(mic, 'click', start);
  bind(stop, 'click', () => { stopSpeaking(); announce('Audio stopped.'); });
  bind(auto, 'change', () => {
    if (!auto.checked) stopSpeaking();
    try { storage?.setItem(VOICE_KEY, JSON.stringify({ readAloud: auto.checked })); } catch { /* Keep working without storage. */ }
    announce(auto.checked ? 'New replies will be read aloud.' : 'Automatic audio is off. Voice messages still receive spoken replies.');
  });
  bind(platform, 'pagehide', cancel);
  paint();
  announce(!Recognition ? 'Voice input is unavailable in this browser. You can type your message.' : !canSpeak ? 'Tap Speak. Your message sends automatically when you finish; spoken replies are unavailable in this browser.' : 'Tap Speak. Your message sends automatically when you finish speaking.');
  return {
    speak, cancel,
    consumeVoiceOrigin(text) { const isVoice = !!voiceDraft && !!String(text).trim(); voiceDraft = ''; return isVoice; },
    discardDraft() { voiceDraft = ''; },
    setBusy(value) { busy = !!value; if (busy && listening) stopListening(); paint(); },
    destroy() { cancel(); destroyed = true; for (const [target, event, fn] of listeners) target.removeEventListener?.(event, fn); paint(); },
    get supported() { return { recognition: !!Recognition, synthesis: canSpeak }; }
  };
}
