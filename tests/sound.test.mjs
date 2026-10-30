import test from 'node:test';
import assert from 'node:assert/strict';
import { NoiseGenerator } from '../public/sound/noise-processor.js';
import { SoundEngine, prepareRainLoop } from '../lib/sound-engine.ts';
import { readSoundPreferences, soundSources } from '../lib/sound-sources.ts';
import { statSync } from 'node:fs';

test('noise colors have distinct spectra and comparable output levels', () => {
  const stats = {};
  for (const kind of ['white', 'pink', 'brown']) {
    let seed = 42;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const generator = new NoiseGenerator(kind);
    for (let i = 0; i < 4800; i++) generator.next(random);
    let mean = 0, energy = 0, difference = 0, last = 0;
    for (let i = 0; i < 96000; i++) {
      const value = generator.next(random);
      assert.ok(Number.isFinite(value));
      mean += value; energy += value * value; difference += (value - last) ** 2; last = value;
    }
    const rms = Math.sqrt(energy / 96000);
    assert.ok(rms > .15 && rms < .25, `${kind} RMS ${rms}`);
    assert.ok(Math.abs(mean / 96000) < .04, `${kind} DC offset`);
    stats[kind] = difference / energy;
  }
  assert.ok(stats.white > 1.8 && stats.white < 2.2, 'white samples are uncorrelated');
  assert.ok(stats.pink > .2 && stats.pink < .6, 'pink has less high-frequency energy');
  assert.ok(stats.brown < .1, 'brown has the strongest low-frequency emphasis');
});

test('saved sound preferences validate IDs, clamp volume and discard legacy favorites', () => {
  assert.deepEqual(readSoundPreferences('{bad'), { sourceId: 'pink', volume: 25, muted: false });
  assert.deepEqual(readSoundPreferences(JSON.stringify({ sourceId: 'missing', volume: 130, muted: true, favorites: ['light-rain-05', 'light-rain-05', 'missing'] })), { sourceId: 'pink', volume: 100, muted: true });
  assert.deepEqual(readSoundPreferences(JSON.stringify({ sourceId: 'pink', volume: 40, favorites: ['pink', 'nightride'] })), { sourceId: 'pink', volume: 40, muted: false });
  assert.equal(readSoundPreferences(JSON.stringify({ volume: -10 })).volume, 0);
  assert.equal(readSoundPreferences(JSON.stringify({ volume: 'loud' })).volume, 25);
});

test('community catalog has three local generated sounds and packaged covers', () => {
  assert.deepEqual(soundSources.map(source => source.kind), ['white', 'pink', 'brown']);
  for (const source of soundSources) {
    assert.equal(source.mode, 'ambient');
    assert.equal(source.url, undefined);
    assert.equal(source.fallbackUrl, undefined);
    assert.equal(source.homepage, undefined);
    assert.ok(source.cover.startsWith('/assets/'));
    assert.ok(statSync(new URL('../public' + source.cover, import.meta.url)).size > 0);
  }
});

const syntheticRecordings = [
  { id: 'fixture-one', mode: 'ambient', url: '/sound/synthetic-one.wav' },
  { id: 'fixture-two', mode: 'ambient', url: '/sound/synthetic-two.wav' },
];

class TestBuffer {
  constructor(channels, length, rate) { this.numberOfChannels = channels; this.length = length; this.sampleRate = rate; this.duration = length / rate; this.channels = Array.from({ length: channels }, () => new Float32Array(length)); }
  getChannelData(channel) { return this.channels[channel]; }
}
class TestContext {
  currentTime = 0; destination = {}; nodes = []; gains = []; decodes = 0;
  async resume() {}
  async close() {}
  createBuffer(...args) { return new TestBuffer(...args); }
  async decodeAudioData() { this.decodes++; return this.createBuffer(2, 94000, 1000); }
  createBufferSource() {
    const node = { connect: gain => gain, start(time, offset) { this.offset = offset; }, stop() { this.stopped = true; }, disconnect() {} };
    this.nodes.push(node); return node;
  }
  createGain() {
    const gain = { gain: { value: 0, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} };
    this.gains.push(gain); return gain;
  }
}

test('decoded rain loops on the audio clock, resumes from its position and reuses decoded audio', async () => {
  const originalContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  const context = new TestContext(); let requests = 0;
  globalThis.AudioContext = class { constructor() { return context; } };
  globalThis.fetch = async () => { requests++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) }; };
  const notifications = [], engine = new SoundEngine(status => notifications.push(status));
  const rain = syntheticRecordings;
  try {
    await engine.play(rain[0], 25, false);
    const node = context.nodes[0], duration = node.buffer.duration;
    assert.equal(node.loop, true); assert.equal(node.loopEnd, duration);
    context.currentTime = duration * 3 + 17;
    assert.equal(engine.elapsed, 17); assert.equal(context.nodes.length, 1, 'looping does not stop or create another source');
    engine.pause(); assert.equal(engine.elapsed, 17); assert.ok(node.stopped);
    await engine.play(rain[0], 35, false);
    assert.equal(context.nodes[1].offset, 17); assert.equal(requests, 1); assert.equal(context.decodes, 1);
    assert.equal(context.gains[1].gain.value, .35);
    engine.setVolume(60, true); assert.equal(context.gains[1].gain.value, 0);
    await engine.play(rain[1], 40, false);
    assert.equal(context.nodes[2].offset, 0); assert.ok(context.nodes[1].stopped);
    assert.equal(requests, 2); assert.equal(context.gains[2].gain.value, .4);
    assert.ok(!notifications.some(status => status.phase === 'error'));
  } finally { engine.dispose(); globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; }
});

test('crossfade removes padded boundaries without a silent dip or clipping', () => {
  const context = new TestContext(), rate = 1000, input = context.createBuffer(2, 4000, rate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = input.getChannelData(channel);
    for (let index = 0; index < samples.length; index++) samples[index] = .7 * Math.cos(index * Math.PI / 7 + channel * .3);
    samples.fill(0, 0, 20); samples.fill(0, samples.length - 20);
  }
  const loop = prepareRainLoop(input, context);
  assert.equal(loop.length, 3500); assert.equal(loop.numberOfChannels, 2);
  const samples = loop.getChannelData(0), boundary = samples.slice(0, 50);
  assert.ok(boundary.some(sample => Math.abs(sample) > .5));
  assert.ok(Math.abs(samples[0] - samples.at(-1)) < .4, 'boundary is one normal adjacent sample step');
  assert.ok(Math.max(...samples.map(Math.abs)) <= .950001);
  // No run of silence caused by the original codec padding survives the mix.
  for (let index = 0; index < samples.length; index += 10) assert.ok(samples.slice(index,index + 10).some(sample => Math.abs(sample) > .01));
});

test('pausing during rain decoding prevents late playback and stale errors', async () => {
  const originalContext = globalThis.AudioContext, originalFetch = globalThis.fetch;
  const context = new TestContext(); let finishDecode;
  context.decodeAudioData = () => new Promise(resolve => { finishDecode = resolve; });
  globalThis.AudioContext = class { constructor() { return context; } };
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) });
  const notifications = [], engine = new SoundEngine(status => notifications.push(status));
  try {
    const play = engine.play(syntheticRecordings[0], 25, false);
    await new Promise(resolve => setImmediate(resolve));
    engine.pause(); finishDecode(context.createBuffer(2, 4000, 1000)); await play;
    assert.equal(context.nodes.length, 0); assert.equal(notifications.at(-1).phase, 'paused');
  } finally { engine.dispose(); globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; }
});

test('cancelled or replaced radio requests cannot restart playback or report old errors', async () => {
  const original = globalThis.Audio, instances = [];
  class TestAudio {
    currentTime = 0; volume = 1; muted = false; paused = false;
    constructor(url) { this.url = url; instances.push(this); }
    play() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
    pause() { this.paused = true; }
    removeAttribute() { this.url = ''; }
    load() {}
  }
  globalThis.Audio = TestAudio;
  const notifications = [], engine = new SoundEngine(status => notifications.push(status));
  try {
    const source = { mode: 'radio', url: 'https://example.test/radio' };
    const first = engine.play(source, 25, false), stalePlaying = instances[0].onplaying;
    const second = engine.play(source, 40, true);
    assert.ok(instances[0].paused);
    stalePlaying(); instances[0].reject(new Error('old connection failed'));
    await first;
    assert.equal(notifications.at(-1).phase, 'loading');
    assert.equal(instances[1].volume, .4); assert.equal(instances[1].muted, true);
    instances[1].onplaying(); instances[1].currentTime = 8;
    assert.equal(engine.elapsed, 8);
    engine.pause(); instances[1].resolve(); await second;
    assert.equal(notifications.at(-1).phase, 'paused');
    assert.ok(instances[1].paused); assert.equal(engine.elapsed, 8);
    engine.pause(true); assert.equal(engine.elapsed, 0);
    assert.ok(!notifications.some(status => status.phase === 'error'));
  } finally { engine.dispose(); if (original === undefined) delete globalThis.Audio; else globalThis.Audio = original; }
});

test('community sounds play through the local worklet and stop without external audio', async () => {
  const originals = { context: globalThis.AudioContext, node: globalThis.AudioWorkletNode, fetch: globalThis.fetch, audio: globalThis.Audio };
  const loaded = [], nodes = [], gains = [], contexts = [];
  class NoiseContext {
    currentTime = 0; destination = {};
    audioWorklet = { addModule: async url => { loaded.push(url); } };
    constructor() { contexts.push(this); }
    async resume() {}
    async close() { this.closed = true; }
    createGain() {
      const gain = { gain: { value: 0, setTargetAtTime(value) { this.value = value; }, cancelScheduledValues() {} }, connect() {}, disconnect() { this.disconnected = true; } };
      gains.push(gain); return gain;
    }
  }
  globalThis.AudioContext = NoiseContext;
  globalThis.AudioWorkletNode = class {
    constructor(_context, name, options) { this.name = name; this.options = options; this.messages = []; this.port = { postMessage: message => this.messages.push(message) }; nodes.push(this); }
    connect(gain) { return gain; }
    disconnect() { this.disconnected = true; }
  };
  globalThis.fetch = async () => { throw new Error('Community noise must not fetch recordings'); };
  globalThis.Audio = class { constructor() { throw new Error('Community noise must not open radio streams'); } };
  const notifications = [], engine = new SoundEngine(status => notifications.push(status));
  try {
    for (const source of soundSources) {
      await engine.play(source, 30, false);
      assert.equal(notifications.at(-1).phase, 'playing');
      assert.equal(nodes.at(-1).name, 'lumior-noise');
      assert.equal(nodes.at(-1).options.processorOptions.kind, source.kind);
      assert.equal(gains.at(-1).gain.value, .3);
      engine.setVolume(40, true);
      assert.equal(gains.at(-1).gain.value, 0);
      engine.pause();
      assert.equal(notifications.at(-1).phase, 'paused');
    }
    assert.deepEqual(loaded, ['/sound/noise-processor.js']);
    engine.dispose();
    await new Promise(resolve => setTimeout(resolve, 210));
    assert.ok(nodes.every(node => node.disconnected && node.messages.includes('stop')));
    assert.ok(contexts.every(context => context.closed));
  } finally {
    engine.dispose();
    for (const [name, value] of Object.entries({ AudioContext: originals.context, AudioWorkletNode: originals.node, fetch: originals.fetch, Audio: originals.audio })) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});

test('cancelling a pending community noise worklet cannot start late playback', async () => {
  const originalContext = globalThis.AudioContext, originalNode = globalThis.AudioWorkletNode;
  let finish, created = 0;
  const context = { currentTime: 0, destination: {}, resume: async () => {}, close: async () => {}, audioWorklet: { addModule: () => new Promise(resolve => { finish = resolve; }) } };
  globalThis.AudioContext = class { constructor() { return context; } };
  globalThis.AudioWorkletNode = class { constructor() { created++; } };
  const statuses = [], engine = new SoundEngine(status => statuses.push(status));
  try {
    const pending = engine.play(soundSources[0], 25, false);
    await new Promise(resolve => setImmediate(resolve));
    engine.pause(); finish(); await pending;
    assert.equal(created, 0);
    assert.equal(statuses.at(-1).phase, 'paused');
  } finally { engine.dispose(); globalThis.AudioContext = originalContext; globalThis.AudioWorkletNode = originalNode; }
});
