// Original, sample-free music for Haru Five. Nothing is played or instantiated
// until the player enables sound and unlock() is called from a user gesture.
export const AUDIO_STORAGE_KEY = 'haru-five-audio-v1';

export function normalizeAudioSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const volume = (value, fallback) => typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value)) : fallback;
  return {
    enabled: source.enabled === true,
    musicVolume: volume(source.musicVolume, 0.25),
    effectsVolume: volume(source.effectsVolume, 0.5),
  };
}

// Eight bars at 84 BPM (about 23 seconds). The melody uses the C-major
// pentatonic scale; sustained harmony and a soft bass give it room to breathe.
const MELODY = [
  [76, null, 79, 81, 79, null, 76, 74],
  [72, null, 74, 76, 79, 76, null, null],
  [69, null, 72, 74, 76, null, 74, 72],
  [67, null, 69, 72, 74, 72, null, null],
  [76, 79, null, 81, 79, 76, 74, null],
  [72, 74, 76, null, 79, 81, 79, null],
  [76, null, 74, 72, 69, 72, 74, null],
  [67, null, 69, 72, null, null, null, null],
];
const HARMONY = [
  [48, 55, 64], [48, 55, 64], [45, 52, 60], [41, 48, 57],
  [48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59],
];
const BEAT = 60 / 84;
const STEP = BEAT / 2;
const LOOKAHEAD = 0.22;
const SCENE_VOLUME = { home: 1, challenge: 0.32, result: 0.9, shop: 1 };
const EFFECTS = {
  tap: [[76, 0, 0.075, 0.11]],
  // Submission is deliberately neutral: it never reveals whether an answer
  // was right. Correctness feedback remains in the game's result screen.
  submit: [[72, 0, 0.10, 0.13], [67, 0.065, 0.13, 0.10]],
  complete: [[72, 0, 0.22, 0.15], [76, 0.13, 0.23, 0.14], [79, 0.26, 0.27, 0.13], [84, 0.42, 0.42, 0.12]],
  perfect: [[72, 0, 0.24, 0.13], [76, 0.10, 0.24, 0.13], [79, 0.20, 0.24, 0.13], [81, 0.30, 0.24, 0.12], [84, 0.42, 0.30, 0.12], [88, 0.56, 0.50, 0.10], [60, 0.42, 0.65, 0.12]],
  purchase: [[76, 0, 0.18, 0.13], [79, 0.09, 0.18, 0.13], [81, 0.18, 0.20, 0.12], [84, 0.29, 0.35, 0.11]],
  equip: [[72, 0, 0.12, 0.12], [76, 0.08, 0.20, 0.11]],
  greet: [[79, 0, 0.15, 0.11], [76, 0.12, 0.15, 0.10], [81, 0.25, 0.24, 0.10]],
};

export function createAudioController({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  onStatus = () => {},
} = {}) {
  let settings = normalizeAudioSettings();
  let context = null, master = null, musicBus = null, effectsBus = null;
  let scene = 'home', hidden = false, disposed = false, unlocked = false;
  let blocked = false, unavailable = typeof AudioContextClass !== 'function';
  let timer = null, origin = 0, nextStep = 0, generation = 0;
  let lastStatus = '', pendingUnlock = null;
  const voices = new Set();
  const lastEffects = new Map();

  function getStatus() {
    const ready = !disposed && settings.enabled && !hidden && unlocked && context?.state === 'running';
    const state = disposed ? 'disposed' : !settings.enabled ? 'off' : unavailable ? 'unsupported'
      : hidden ? 'paused' : ready ? 'running' : blocked ? 'blocked' : 'locked';
    return { supported: !unavailable, ...settings, ready: Boolean(ready), state, scene };
  }

  function report() {
    const status = getStatus(), signature = JSON.stringify(status);
    if (signature === lastStatus) return;
    lastStatus = signature;
    try { onStatus(status); } catch { /* A view callback cannot break audio cleanup. */ }
  }

  function releaseVoice(voice) {
    if (!voices.delete(voice)) return;
    voice.oscillator.onended = null;
    try { voice.oscillator.disconnect(); } catch {}
    try { voice.envelope.disconnect(); } catch {}
  }

  function stopVoices(kind) {
    for (const voice of [...voices]) {
      if (kind && voice.kind !== kind) continue;
      try { voice.oscillator.stop(context?.currentTime || 0); } catch {}
      releaseVoice(voice);
    }
  }

  function stopLoop() {
    if (timer !== null) globalThis.clearInterval(timer);
    timer = null;
    stopVoices('music');
  }

  function quietContext() {
    if (!context || context.state === 'closed' || context.state === 'suspended') return;
    try { Promise.resolve(context.suspend()).catch(() => {}); } catch {}
  }

  function setGain(node, value) {
    if (!node || !context || context.state === 'closed') return;
    const now = context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setTargetAtTime(value, now, 0.035);
  }

  function updateVolumes() {
    setGain(musicBus, settings.musicVolume * SCENE_VOLUME[scene]);
    setGain(effectsBus, settings.effectsVolume);
  }

  function tone({ midi, at, duration, volume, wave = 'sine', kind = 'music', pad = false }) {
    if (!getStatus().ready || volume <= 0 || voices.size >= 64) return;
    const start = Math.max(context.currentTime, at);
    const end = start + duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const voice = { oscillator, envelope, kind };
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), start);
    envelope.gain.setValueAtTime(0.0001, start);
    if (pad) {
      envelope.gain.linearRampToValueAtTime(volume, start + 0.15);
      envelope.gain.setValueAtTime(volume, end - 0.24);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    } else {
      envelope.gain.linearRampToValueAtTime(volume, start + Math.min(0.012, duration / 5));
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.38), start + duration * 0.42);
      envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    }
    oscillator.connect(envelope);
    envelope.connect(kind === 'music' ? musicBus : effectsBus);
    voices.add(voice);
    oscillator.onended = () => releaseVoice(voice);
    oscillator.start(start);
    oscillator.stop(end + 0.015);
  }

  function scheduleStep(index, at) {
    const bar = Math.floor(index / 8) % 8, slot = index % 8;
    const chord = HARMONY[bar];
    if (slot === 0) {
      for (const midi of chord) tone({ midi, at, duration: BEAT * 4 - 0.025, volume: 0.025, pad: true });
    }
    if (slot === 0 || slot === 4) {
      tone({ midi: chord[0] - 12 + (slot === 4 ? 7 : 0), at, duration: BEAT * 1.75, volume: 0.10, wave: 'triangle' });
    }
    const midi = MELODY[bar][slot];
    if (midi !== null && (scene !== 'challenge' || slot % 2 === 0)) {
      tone({ midi, at, duration: STEP * 1.45, volume: 0.105, wave: 'triangle' });
    }
  }

  function scheduleMusic() {
    if (!getStatus().ready || settings.musicVolume === 0) return;
    const now = context.currentTime;
    // If a timer was delayed, discard missed beats. Never replay a backlog of
    // notes after a suspended tab or a busy main thread becomes active again.
    if (origin + nextStep * STEP < now - 0.04) {
      nextStep = Math.max(nextStep, Math.ceil((now + 0.025 - origin) / STEP));
    }
    while (origin + nextStep * STEP <= now + LOOKAHEAD) {
      scheduleStep(nextStep, origin + nextStep * STEP);
      nextStep += 1;
    }
  }

  function startLoop() {
    if (!getStatus().ready || settings.musicVolume === 0 || timer !== null) return;
    origin = context.currentTime + 0.045;
    nextStep = 0;
    scheduleMusic();
    timer = globalThis.setInterval(scheduleMusic, 100);
    timer?.unref?.();
  }

  function createContext() {
    if (context) return true;
    if (unavailable || disposed) return false;
    try {
      context = new AudioContextClass();
      master = context.createGain();
      musicBus = context.createGain();
      effectsBus = context.createGain();
      master.gain.setValueAtTime(0.7, context.currentTime);
      musicBus.gain.setValueAtTime(settings.musicVolume * SCENE_VOLUME[scene], context.currentTime);
      effectsBus.gain.setValueAtTime(settings.effectsVolume, context.currentTime);
      musicBus.connect(master);
      effectsBus.connect(master);
      master.connect(context.destination);
      context.onstatechange = () => {
        if (disposed) return;
        if (context.state !== 'running') {
          stopLoop();
          stopVoices();
          if (settings.enabled && !hidden) blocked = true;
        } else if (settings.enabled && !hidden && unlocked) {
          blocked = false;
          startLoop();
        }
        report();
      };
      return true;
    } catch {
      unavailable = true;
      try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
      context = null;
      report();
      return false;
    }
  }

  function unlock() {
    if (disposed || !settings.enabled || hidden || !createContext()) {
      report();
      return Promise.resolve(false);
    }
    if (pendingUnlock) return pendingUnlock;
    const request = ++generation;
    blocked = false;
    let resumeResult;
    try {
      // This call intentionally happens before any await/promise continuation,
      // so the initiating click's user activation reaches the browser API.
      resumeResult = context.state === 'running' ? undefined : context.resume();
    } catch {
      blocked = true;
      report();
      return Promise.resolve(false);
    }
    const attempt = Promise.resolve(resumeResult).then(() => {
      if (request !== generation || disposed || !settings.enabled || hidden) {
        if (!disposed && (!settings.enabled || hidden)) quietContext();
        return false;
      }
      if (context.state !== 'running') {
        unlocked = false;
        blocked = true;
        report();
        return false;
      }
      unlocked = true;
      blocked = false;
      updateVolumes();
      startLoop();
      report();
      return true;
    }, () => {
      if (request === generation && !disposed && settings.enabled && !hidden) {
        unlocked = false;
        blocked = true;
        report();
      }
      return false;
    }).finally(() => {
      if (pendingUnlock === attempt) pendingUnlock = null;
    });
    pendingUnlock = attempt;
    return attempt;
  }

  function setSettings(value) {
    if (disposed) return getStatus();
    const previous = settings;
    settings = normalizeAudioSettings({ ...settings, ...(value && typeof value === 'object' ? value : {}) });
    if (!settings.enabled) {
      generation += 1;
      pendingUnlock = null;
      unlocked = false;
      blocked = false;
      stopLoop();
      stopVoices();
      quietContext();
    } else {
      if (!previous.enabled) blocked = false;
      updateVolumes();
      if (settings.musicVolume === 0) stopLoop();
      else startLoop();
      if (settings.effectsVolume === 0) stopVoices('effects');
    }
    report();
    return getStatus();
  }

  function setScene(value) {
    if (disposed || !Object.hasOwn(SCENE_VOLUME, value)) return getStatus();
    scene = value;
    updateVolumes();
    report();
    return getStatus();
  }

  function setHidden(value) {
    if (disposed) return Promise.resolve(false);
    const next = Boolean(value);
    if (hidden === next) return Promise.resolve(getStatus().ready);
    hidden = next;
    if (hidden) {
      generation += 1;
      pendingUnlock = null;
      stopLoop();
      stopVoices();
      quietContext();
      report();
      return Promise.resolve(false);
    }
    report();
    // Only a context previously unlocked by the player may try to resume on
    // visibility change. Failure is surfaced as blocked, never called playing.
    if (settings.enabled && unlocked && context) return unlock();
    return Promise.resolve(false);
  }

  function play(name) {
    if (!getStatus().ready || settings.effectsVolume === 0 || !Object.hasOwn(EFFECTS, name)) return false;
    const now = context.currentTime;
    if (now - (lastEffects.get(name) ?? -Infinity) < 0.07) return false;
    lastEffects.set(name, now);
    for (const [midi, offset, duration, volume] of EFFECTS[name]) {
      tone({ midi, at: now + 0.008 + offset, duration, volume, kind: 'effects', wave: 'sine' });
    }
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    generation += 1;
    pendingUnlock = null;
    stopLoop();
    stopVoices();
    if (context) {
      context.onstatechange = null;
      for (const node of [musicBus, effectsBus, master]) {
        try { node?.disconnect(); } catch {}
      }
      try { Promise.resolve(context.close()).catch(() => {}); } catch {}
    }
    report();
  }

  report();
  return { unlock, setSettings, setScene, setHidden, play, dispose, getStatus };
}
