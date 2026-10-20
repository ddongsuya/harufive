import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_STORAGE_KEY, normalizeAudioSettings, createAudioController } from '../legacy/v040/audio.js';

function mockAudioClass({ resumeMode = 'normal' } = {}) {
  class Parameter {
    constructor() { this.value = 0; this.events = []; }
    add(method, value, at) { this.value = value; this.events.push({ method, value, at }); }
    setValueAtTime(value, at) { this.add('set', value, at); }
    linearRampToValueAtTime(value, at) { this.add('linear', value, at); }
    exponentialRampToValueAtTime(value, at) { assert.ok(value > 0); this.add('exponential', value, at); }
    setTargetAtTime(value, at) { this.add('target', value, at); }
    cancelScheduledValues(at) { this.events.push({ method: 'cancel', at }); }
  }
  class Node {
    constructor() { this.connections = []; this.disconnected = false; }
    connect(node) { this.connections.push(node); }
    disconnect() { this.disconnected = true; this.connections = []; }
  }
  class Context {
    static instances = [];
    constructor() {
      this.state = 'suspended'; this.currentTime = 0; this.destination = {};
      this.gains = []; this.oscillators = []; this.resumeCalls = 0; this.suspendCalls = 0;
      this.closeCalls = 0; this.mode = resumeMode; this.pendingResumes = [];
      Context.instances.push(this);
    }
    createGain() { const node = new Node(); node.gain = new Parameter(); this.gains.push(node); return node; }
    createOscillator() {
      const context = this, node = new Node();
      node.frequency = new Parameter(); node.type = 'sine'; node.startAt = null; node.stopAt = null; node.ended = false;
      node.start = at => { assert.ok(at >= context.currentTime); node.startAt = at; };
      node.stop = at => { node.stopAt = at; if (at <= context.currentTime && !node.ended) { node.ended = true; node.onended?.(); } };
      this.oscillators.push(node); return node;
    }
    changeState(state) { this.state = state; this.onstatechange?.(); }
    resume() {
      this.resumeCalls += 1;
      if (this.mode === 'reject') return Promise.reject(new Error('user activation required'));
      if (this.mode === 'blocked') return Promise.resolve();
      if (this.mode === 'deferred') return new Promise(resolve => this.pendingResumes.push(() => { this.changeState('running'); resolve(); }));
      this.changeState('running'); return Promise.resolve();
    }
    suspend() { this.suspendCalls += 1; this.changeState('suspended'); return Promise.resolve(); }
    close() { this.closeCalls += 1; this.changeState('closed'); return Promise.resolve(); }
    advance(seconds) {
      if (this.state === 'running') this.currentTime += seconds;
      for (const node of this.oscillators) {
        if (!node.ended && node.stopAt !== null && node.stopAt <= this.currentTime) { node.ended = true; node.onended?.(); }
      }
    }
    get liveVoices() { return this.oscillators.filter(node => !node.disconnected); }
  }
  return Context;
}

test('sound defaults to off and malformed preferences cannot enable it accidentally', () => {
  assert.match(AUDIO_STORAGE_KEY, /^haru-five-/);
  assert.deepEqual(normalizeAudioSettings(), { enabled: false, musicVolume: 0.25, effectsVolume: 0.5 });
  assert.deepEqual(normalizeAudioSettings({ enabled: 'true', musicVolume: NaN, effectsVolume: '1' }), { enabled: false, musicVolume: 0.25, effectsVolume: 0.5 });
  assert.deepEqual(normalizeAudioSettings({ enabled: true, musicVolume: 2, effectsVolume: -0.5 }), { enabled: true, musicVolume: 1, effectsVolume: 0 });
});

test('audio starts only after an explicit unlock, and repeated unlocks never duplicate the loop', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const AudioContextClass = mockAudioClass(), statuses = [];
  const audio = createAudioController({ AudioContextClass, onStatus: value => statuses.push(value) });
  t.after(() => audio.dispose());
  assert.equal(audio.play('tap'), false);
  assert.equal(await audio.unlock(), false);
  assert.equal(AudioContextClass.instances.length, 0);
  audio.setSettings({ enabled: true });
  assert.equal(AudioContextClass.instances.length, 0, 'saved settings alone must not create an audio context');
  assert.equal(audio.getStatus().state, 'locked');
  const opening = audio.unlock();
  const context = AudioContextClass.instances[0];
  assert.equal(context.resumeCalls, 1, 'resume must be called synchronously inside the click handler');
  assert.equal(await opening, true);
  const openingVoices = context.oscillators.length;
  assert.ok(openingVoices >= 4, 'a melody, harmony and bass start together');
  for (let index = 0; index < 20; index += 1) assert.equal(await audio.unlock(), true);
  assert.equal(context.oscillators.length, openingVoices, 'unlocking an already running context must not start another arrangement');
  assert.equal(context.resumeCalls, 1);
  assert.equal(audio.getStatus().ready, true);
  assert.equal(statuses.at(-1).state, 'running');
  audio.setSettings({ enabled: false });
  assert.equal(audio.getStatus().state, 'off');
  assert.equal(context.state, 'suspended');
  assert.equal(context.liveVoices.length, 0);
  t.mock.timers.tick(10000);
  assert.equal(context.oscillators.length, openingVoices);
  audio.setSettings({ enabled: true });
  assert.equal(audio.getStatus().ready, false);
  assert.equal(context.oscillators.length, openingVoices, 'toggling settings still waits for the button-triggered unlock');
  assert.equal(await audio.unlock(), true);
  assert.equal(AudioContextClass.instances.length, 1, 'settings toggles reuse the same context');
});

test('music and effects have separate volume controls and submission uses a neutral cue', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const AudioContextClass = mockAudioClass(), audio = createAudioController({ AudioContextClass });
  t.after(() => audio.dispose());
  audio.setSettings({ enabled: true }); await audio.unlock();
  const context = AudioContextClass.instances[0], homeVolume = context.gains[1].gain.value;
  audio.setScene('challenge');
  assert.ok(context.gains[1].gain.value < homeVolume / 2, 'questions use a quieter arrangement');
  audio.setScene('shop');
  assert.equal(context.gains[1].gain.value, homeVolume);
  audio.setSettings({ musicVolume: 0 });
  assert.equal(context.liveVoices.length, 0);
  assert.equal(audio.play('submit'), true);
  assert.equal(context.liveVoices.length, 2);
  assert.equal(audio.play('correct'), false, 'there is no answer-revealing live correctness cue');
  assert.equal(audio.play('submit'), false, 'rapid repeated clicks cannot stack the same sound');
  context.advance(1);
  for (const name of ['tap', 'complete', 'perfect', 'purchase', 'equip', 'greet']) {
    assert.equal(audio.play(name), true, name);
    context.advance(2);
  }
  assert.equal(context.liveVoices.length, 0, 'finished effect oscillators and envelopes disconnect');
  audio.setSettings({ effectsVolume: 0 });
  assert.equal(audio.play('tap'), false);
  assert.equal(context.liveVoices.length, 0);
});

test('a hidden tab becomes silent and resumes only an already unlocked context', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const AudioContextClass = mockAudioClass(), audio = createAudioController({ AudioContextClass });
  t.after(() => audio.dispose());
  audio.setSettings({ enabled: true });
  await audio.setHidden(true); await audio.setHidden(false);
  assert.equal(AudioContextClass.instances.length, 0, 'visibility cannot create an unrequested context');
  await audio.unlock();
  const context = AudioContextClass.instances[0];
  audio.play('perfect');
  await audio.setHidden(true);
  assert.equal(audio.getStatus().state, 'paused');
  assert.equal(context.state, 'suspended');
  assert.equal(context.liveVoices.length, 0);
  assert.equal(audio.play('tap'), false);
  const silentCount = context.oscillators.length;
  t.mock.timers.tick(60000);
  assert.equal(context.oscillators.length, silentCount);
  assert.equal(await audio.setHidden(false), true);
  assert.equal(audio.getStatus().state, 'running');
  assert.ok(context.liveVoices.length > 0);
  context.mode = 'reject';
  await audio.setHidden(true);
  assert.equal(await audio.setHidden(false), false);
  assert.equal(audio.getStatus().state, 'blocked');
  assert.equal(audio.getStatus().ready, false);
  assert.equal(context.liveVoices.length, 0);
});

test('unsupported, rejected and unresolved resume attempts never report playback', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const unsupported = createAudioController({ AudioContextClass: null });
  unsupported.setSettings({ enabled: true });
  assert.equal(await unsupported.unlock(), false);
  assert.equal(unsupported.getStatus().state, 'unsupported');
  unsupported.dispose();
  for (const resumeMode of ['reject', 'blocked']) {
    const AudioContextClass = mockAudioClass({ resumeMode }), audio = createAudioController({ AudioContextClass });
    audio.setSettings({ enabled: true });
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.getStatus().ready, false);
    assert.equal(audio.getStatus().state, 'blocked');
    const context = AudioContextClass.instances[0];
    assert.equal(context.oscillators.length, 0);
    context.mode = 'normal';
    assert.equal(await audio.unlock(), true, 'a new player gesture may recover playback');
    audio.dispose();
  }
});

test('turning sound off or disposing during an in-flight resume cannot resurrect audio', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const action of ['off', 'hidden', 'dispose']) {
    const AudioContextClass = mockAudioClass({ resumeMode: 'deferred' });
    const audio = createAudioController({ AudioContextClass });
    audio.setSettings({ enabled: true });
    const opening = audio.unlock(), context = AudioContextClass.instances[0];
    if (action === 'off') audio.setSettings({ enabled: false });
    else if (action === 'hidden') await audio.setHidden(true);
    else audio.dispose();
    context.pendingResumes.shift()();
    assert.equal(await opening, false);
    assert.equal(audio.getStatus().ready, false);
    assert.equal(context.oscillators.length, 0);
    if (action !== 'dispose') assert.equal(context.state, 'suspended');
    audio.dispose();
    assert.equal(await audio.unlock(), false);
    assert.equal(audio.play('tap'), false);
    assert.equal(audio.getStatus().state, 'disposed');
  }
});

test('long playback releases finished voices and delayed timers discard missed notes', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const AudioContextClass = mockAudioClass(), audio = createAudioController({ AudioContextClass });
  t.after(() => audio.dispose());
  audio.setSettings({ enabled: true }); await audio.unlock();
  const context = AudioContextClass.instances[0];
  for (let tick = 0; tick < 900; tick += 1) {
    context.advance(0.1); t.mock.timers.tick(100);
    assert.ok(context.liveVoices.length < 18, 'the arrangement must not retain finished nodes');
  }
  assert.ok(context.oscillators.length > 150, 'several complete arrangements were exercised');
  const beforeDelay = context.oscillators.length;
  context.advance(3600); t.mock.timers.tick(100);
  const recovered = context.oscillators.slice(beforeDelay);
  assert.ok(recovered.length <= 5, 'an hour of missed beats must not be scheduled together');
  for (const oscillator of recovered) assert.ok(oscillator.startAt >= context.currentTime);
  audio.dispose();
  assert.equal(context.liveVoices.length, 0);
  assert.equal(context.closeCalls, 1);
});
