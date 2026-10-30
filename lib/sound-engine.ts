import { translate as t } from '../app/i18n-core.ts';
import type { SoundSource } from './sound-sources';
export type SoundPhase = 'paused' | 'loading' | 'playing' | 'error';
export type SoundStatus = { phase: SoundPhase; error?: string };

// Mix the decoded tail into the head with equal-power weights, then rotate the
// loop so its sample boundary lies within the original recording. This also
// keeps codec padding away from the playback boundary.
export function prepareRainLoop(input: AudioBuffer, context: BaseAudioContext): AudioBuffer {
  const overlap = Math.min(Math.round(input.sampleRate * .5), Math.floor(input.length / 4));
  if (overlap < 2) return input;
  const length = input.length - overlap, middle = input.length - overlap * 2;
  const output = context.createBuffer(input.numberOfChannels, length, input.sampleRate);
  let peak = 0;
  for (let channel = 0; channel < input.numberOfChannels; channel++) {
    const original = input.getChannelData(channel), samples = output.getChannelData(channel);
    samples.set(original.subarray(overlap, input.length - overlap));
    for (let index = 0; index < overlap; index++) {
      const angle = index / (overlap - 1) * Math.PI / 2;
      samples[middle + index] = original[input.length - overlap + index] * Math.cos(angle) + original[index] * Math.sin(angle);
    }
    for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  }
  // Retain headroom if overlapping unrelated transients raises the peak.
  if (peak > .95) for (let channel = 0; channel < output.numberOfChannels; channel++) {
    const samples = output.getChannelData(channel), scale = .95 / peak;
    for (let index = 0; index < samples.length; index++) samples[index] *= scale;
  }
  return output;
}

export class SoundEngine {
  private context: AudioContext | null = null;
  private module: Promise<void> | null = null;
  private noise: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private radio: HTMLAudioElement | null = null;
  private recording: AudioBufferSourceNode | null = null;
  private recordings = new Map<string, AudioBuffer>();
  private recordingOffset = 0;
  private request: AbortController | null = null;
  private revision = 0;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private frozenElapsed = 0;
  private active = false;
  private volume = 25;
  private muted = false;
  private lastSourceId: string | undefined;
  private resumePosition = 0;
  private notify: ((status: SoundStatus) => void) | null;
  constructor(notify: (status: SoundStatus) => void) { this.notify = notify; }
  get elapsed() {
    if (!this.active) return this.frozenElapsed;
    if (this.radio) return this.radio.currentTime;
    const passed = Math.max(0, (this.context?.currentTime || 0) - this.startedAt);
    const duration = this.recording?.buffer?.duration;
    return duration ? (this.recordingOffset + passed) % duration : passed;
  }
  private release() {
    this.frozenElapsed = this.elapsed;
    this.active = false;
    this.revision++;
    this.request?.abort(); this.request = null;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    if (this.recording) {
      this.resumePosition = this.frozenElapsed;
      this.recording.onended = null;
      this.recording.stop(); this.recording.disconnect(); this.recording = null;
      this.gain?.disconnect(); this.gain = null;
    }
    if (this.radio) {
      this.resumePosition = this.radio.loop ? this.radio.currentTime : 0;
      this.radio.onplaying = this.radio.onwaiting = this.radio.onerror = this.radio.onended = this.radio.onstalled = this.radio.onloadedmetadata = null;
      this.radio.pause(); this.radio.removeAttribute('src'); this.radio.load(); this.radio = null;
    }
    if (this.noise && this.gain && this.context) {
      const node = this.noise, gain = this.gain;
      gain.gain.cancelScheduledValues(this.context.currentTime);
      gain.gain.setTargetAtTime(0, this.context.currentTime, .035);
      setTimeout(() => { node.port.postMessage('stop'); node.disconnect(); gain.disconnect(); }, 180);
      this.noise = null; this.gain = null;
    }
  }
  pause(resetElapsed = false) { this.release(); if (resetElapsed) {this.frozenElapsed = 0; this.resumePosition = 0; this.lastSourceId = undefined;} this.notify?.({ phase: 'paused' }); }
  setVolume(volume: number, muted: boolean) {
    this.volume = volume; this.muted = muted;
    const level = Math.max(0, Math.min(100, volume)) / 100;
    if (this.radio) { this.radio.volume = level; this.radio.muted = muted; }
    if (this.gain && this.context) this.gain.gain.setTargetAtTime(muted ? 0 : level, this.context.currentTime, .06);
  }
  async play(source: SoundSource, volume: number, muted: boolean) {
    this.release();
    const resumeAt = source.mode === 'ambient' && source.id === this.lastSourceId ? this.resumePosition : 0;
    this.lastSourceId = source.id;
    this.resumePosition = resumeAt; this.frozenElapsed = resumeAt;
    const revision = this.revision;
    this.setVolume(volume, muted);
    this.notify?.({ phase: 'loading' });
    const fail = (error: string) => {
      if (revision !== this.revision) return;
      if (source.mode === 'radio' && source.fallbackUrl) { void this.play({ ...source, url: source.fallbackUrl, fallbackUrl: undefined }, this.volume, this.muted); return; }
      this.release(); this.notify?.({ phase: 'error', error });
    };
    try {
      if (source.mode === 'ambient' && source.url) {
        // Resume inside the click gesture, before fetching/decoding.
        const context = this.context ||= new AudioContext();
        await context.resume();
        if (revision !== this.revision) return;
        let buffer = this.recordings.get(source.url);
        if (!buffer) {
          const request = new AbortController(); this.request = request;
          this.deadline = setTimeout(() => fail(t('The rain recording is taking too long to load. Please retry.','雨声加载超时，请重试。')), 15000);
          const response = await fetch(source.url, { signal: request.signal });
          if (!response.ok) throw new Error('Unable to load rain');
          const bytes = await response.arrayBuffer();
          if (revision !== this.revision) return;
          const decoded = await context.decodeAudioData(bytes);
          if (revision !== this.revision) return;
          buffer = prepareRainLoop(decoded, context);
          // At most two decoded recordings remain cached, across source changes.
          if (this.recordings.size >= 2) this.recordings.delete(this.recordings.keys().next().value!);
          this.recordings.set(source.url, buffer);
        }
        if (revision !== this.revision) return;
        if (this.deadline) clearTimeout(this.deadline); this.deadline = null; this.request = null;
        const recording = context.createBufferSource(), gain = context.createGain();
        recording.buffer = buffer; recording.loop = true;
        recording.loopStart = 0; recording.loopEnd = buffer.duration;
        recording.connect(gain).connect(context.destination);
        this.recording = recording; this.gain = gain;
        this.recordingOffset = resumeAt % buffer.duration; this.startedAt = context.currentTime;
        gain.gain.value = this.muted ? 0 : Math.max(0, Math.min(100, this.volume)) / 100;
        recording.onended = () => fail(t('Sound playback stopped. Please try again.','声音播放已停止，请重试。'));
        recording.start(0, this.recordingOffset);
        this.active = true; this.notify?.({ phase: 'playing' });
      } else if (source.mode === 'ambient' && !source.url) {
        const context = this.context ||= new AudioContext();
        await context.resume();
        if (revision !== this.revision) return;
        this.module ||= context.audioWorklet.addModule('/sound/noise-processor.js').catch(error => { this.module = null; throw error; });
        await this.module;
        if (revision !== this.revision) return;
        const noise = new AudioWorkletNode(context, 'lumior-noise', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { kind: source.kind } });
        const gain = context.createGain(); gain.gain.value = 0;
        noise.connect(gain).connect(context.destination);
        this.noise = noise; this.gain = gain; this.startedAt = context.currentTime; this.active = true;
        this.setVolume(this.volume, this.muted);
        noise.onprocessorerror = () => fail(t('Sound playback stopped. Please try again.','声音播放已停止，请重试。'));
        this.notify?.({ phase: 'playing' });
      } else {
        if (!source.url) throw new Error('No audio source');
        const audio = new Audio(source.url); audio.preload = 'none'; audio.loop = false; this.radio = audio;
        this.setVolume(this.volume, this.muted);
        const loading = () => {
          if (revision !== this.revision) return;
          this.notify?.({ phase: 'loading' });
          if (this.deadline) clearTimeout(this.deadline);
          this.deadline = setTimeout(() => fail(source.mode === 'radio' ? t('This station is taking too long to connect. Retry or choose another station.','电台连接超时，请重试或选择其他电台。') : t('The rain recording is taking too long to load. Please retry.','雨声加载超时，请重试。')), 15000);
        };
        audio.onwaiting = loading;
        // A network stall does not necessarily interrupt already buffered audio.
        audio.onstalled = () => { if (audio.readyState < 3) loading(); };
        audio.onplaying = () => {
          if (revision !== this.revision) return;
          if (this.deadline) clearTimeout(this.deadline); this.deadline = null;
          this.active = true; this.notify?.({ phase: 'playing' });
        };
        audio.onerror = () => fail(source.mode === 'radio' ? t('Unable to connect to this station. Retry or choose another station.','无法连接此电台，请重试或选择其他电台。') : t('Unable to load this rain recording. Please retry.','无法加载雨声，请重试。'));
        audio.onended = () => {
          if (revision !== this.revision) return;
          fail(t('The live stream ended. Please reconnect.','直播已结束，请重新连接。'));
        };
        loading(); await audio.play();
        if (revision !== this.revision) { audio.pause(); return; }
      }
    } catch {
      fail(source.mode === 'radio' ? t('Unable to play this station. Retry or choose another station.','无法播放此电台，请重试或选择其他电台。') : t('Unable to start this recording. Please retry.','无法播放此录音，请重试。'));
    }
  }
  dispose() { this.notify = null; this.release(); this.recordings.clear(); void this.context?.close().catch(() => {}); this.context = null; }
}
