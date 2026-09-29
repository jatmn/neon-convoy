const SONGS = [
  { root: 36, bpm: 96, progression: [0, 5, 8, 7], melody: [0, 7, 12, 7, 3, 10, 7, 5], bass: [0, 0, 7, 0, 5, 5, 7, 10] },
  { root: 38, bpm: 102, progression: [0, 3, 8, 5], melody: [0, 3, 7, 10, 12, 10, 7, 3], bass: [0, 7, 0, 3, 8, 8, 5, 7] },
  { root: 41, bpm: 106, progression: [0, 7, 5, 3], melody: [12, 10, 7, 5, 3, 5, 7, 10], bass: [0, 0, 7, 7, 5, 5, 3, 3] },
  { root: 33, bpm: 110, progression: [0, 8, 3, 7], melody: [0, 12, 7, 15, 10, 7, 3, 7], bass: [0, 7, 0, 8, 3, 10, 7, 3] },
  { root: 39, bpm: 112, progression: [0, 5, 10, 7], melody: [0, 5, 7, 12, 10, 7, 5, 2], bass: [0, 0, 5, 7, 10, 10, 7, 5] },
  { root: 35, bpm: 116, progression: [0, 3, 7, 10], melody: [12, 7, 3, 0, 10, 7, 15, 12], bass: [0, 7, 3, 7, 10, 5, 7, 3] },
  { root: 40, bpm: 118, progression: [0, 8, 5, 10], melody: [0, 4, 8, 12, 15, 12, 8, 4], bass: [0, 0, 8, 8, 5, 12, 10, 8] },
  { root: 37, bpm: 122, progression: [0, 7, 10, 3], melody: [0, 7, 10, 14, 17, 14, 10, 7], bass: [0, 7, 0, 10, 3, 10, 7, 3] },
  { root: 34, bpm: 124, progression: [0, 5, 1, 8], melody: [12, 8, 5, 1, 0, 5, 8, 13], bass: [0, 0, 5, 1, 8, 8, 1, 5] },
  { root: 36, bpm: 128, progression: [0, 8, 10, 7], melody: [0, 7, 12, 15, 19, 15, 12, 7], bass: [0, 7, 8, 15, 10, 17, 7, 12] },
];

function frequency(note: number) {
  return 440 * 2 ** ((note - 69) / 12);
}

function audioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

/** Original procedural score and short game effects. Audio starts only after unlock(). */
export class AudioEngine {
  context: AudioContext | null;
  master: GainNode | null;
  music: GainNode | null;
  effects: GainNode | null;
  noise: AudioBuffer | null;
  timer: ReturnType<typeof setInterval> | null;
  muted: boolean;
  volume: number;
  paused: boolean;
  level: number;
  step: number;
  nextTime: number;
  destroyed: boolean;
  constructor() {
    this.context = null;
    this.master = null;
    this.music = null;
    this.effects = null;
    this.noise = null;
    this.timer = null;
    this.muted = false;
    this.volume = 0.72;
    this.paused = false;
    this.level = 0;
    this.step = 0;
    this.nextTime = 0;
    this.destroyed = false;
  }

  async unlock() {
    if (this.destroyed) return false;
    if (!this.context) {
      const Context = audioContextClass();
      if (!Context) return false;
      try {
        const ctx = new Context();
        this.context = ctx;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -20;
        compressor.knee.value = 18;
        compressor.ratio.value = 3;
        compressor.attack.value = .003;
        compressor.release.value = .22;
        this.master = ctx.createGain();
        this.music = ctx.createGain();
        this.effects = ctx.createGain();
        this.music.gain.value = this.paused ? 0 : .62;
        this.effects.gain.value = .85;
        this.music.connect(this.master);
        this.effects.connect(this.master);
        this.master.connect(compressor);
        compressor.connect(ctx.destination);
        this.updateVolume();
        const length = Math.round(ctx.sampleRate * .5);
        this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        let seed = 0x1a2b3c4d;
        for (let i = 0; i < length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
          data[i] = (seed / 2147483648) * .45;
        }
      } catch (_) {
        this.context = null;
        return false;
      }
    }
    try {
      if (this.context.state === 'suspended') await this.context.resume();
      if (this.context.state !== 'running') return false;
      if (!this.timer) {
        this.nextTime = this.context.currentTime + .08;
        this.timer = setInterval(() => this.schedule(), 25);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  updateVolume() {
    if (!this.master || !this.context) return;
    const value = this.muted ? 0 : .24 * this.volume;
    this.master.gain.setTargetAtTime(value, this.context.currentTime, .025);
  }

  setLevel(index: number) {
    const next = Math.max(0, Math.min(SONGS.length - 1, Math.trunc(Number(index) || 0)));
    if (this.level === next) return;
    this.level = next;
    this.step = 0;
    if (this.context) this.nextTime = this.context.currentTime + .08;
  }

  setMuted(value: boolean) {
    this.muted = Boolean(value);
    this.updateVolume();
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, Number(value) || 0));
    this.updateVolume();
  }

  setPaused(value: boolean) {
    this.paused = Boolean(value);
    if (!this.context || !this.music) return;
    const now = this.context.currentTime;
    this.music.gain.setTargetAtTime(this.paused ? 0 : .62, now, .04);
    if (!this.paused) this.nextTime = now + .08;
  }

  schedule() {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.paused || this.destroyed) return;
    const song = SONGS[this.level];
    const duration = 60 / song.bpm / 4;
    if (this.nextTime < ctx.currentTime - duration) this.nextTime = ctx.currentTime + .025;
    while (this.nextTime < ctx.currentTime + .15) {
      this.scheduleStep(song, this.step, this.nextTime, duration);
      this.step++;
      this.nextTime += duration;
    }
  }

  tone(type: OscillatorType, pitch: number, start: number, duration: number, gain: number, destination: AudioNode | null, { attack = .005, release = .12, detune = 0, cutoff }: { attack?: number; release?: number; detune?: number; cutoff?: number } = {}) {
    const ctx = this.context;
    if (!ctx || !destination) throw new Error('Audio must be unlocked before playing a tone');
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(pitch, start);
    oscillator.detune.value = detune;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + attack);
    envelope.gain.setValueAtTime(gain * .72, start + Math.max(attack + .001, Math.min(duration * .6, .28)));
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration + release);
    if (cutoff) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, start);
      oscillator.connect(filter); filter.connect(envelope);
    } else oscillator.connect(envelope);
    envelope.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + release + .02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    return oscillator;
  }

  noiseHit(start: number, duration: number, gain: number, cutoff: number, highpass = true, destination: AudioNode | null = this.music) {
    if (!this.noise) return;
    const ctx = this.context;
    if (!ctx || !destination) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = highpass ? 'highpass' : 'lowpass';
    filter.frequency.value = cutoff;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter); filter.connect(envelope); envelope.connect(destination);
    source.start(start); source.stop(start + duration + .01);
    source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
  }

  kick(start: number, gain = .48) {
    const ctx = this.context;
    const osc = this.tone('sine', 142, start, .20, gain, this.music, { release: .02 });
    osc.frequency.exponentialRampToValueAtTime(46, start + .18);
  }

  snare(start: number) {
    this.noiseHit(start, .15, .18, 1550);
    const osc = this.tone('triangle', 180, start, .09, .065, this.music, { release: .02 });
    osc.frequency.exponentialRampToValueAtTime(105, start + .09);
  }

  scheduleStep(song: typeof SONGS[number], step: number, time: number, duration: number) {
    const beat = step % 16;
    const bar = Math.floor(step / 16);
    const chord = song.progression[bar % song.progression.length];
    const roots = song.bass;
    if (beat % 4 === 0 || (this.level > 3 && beat === 10)) this.kick(time, beat === 0 ? .52 : .39);
    if (beat === 4 || beat === 12) this.snare(time);
    this.noiseHit(time, beat % 4 === 2 ? .09 : .045, beat % 4 === 2 ? .055 : .032, 6900);
    if (beat % 2 === 0) {
      const bass = song.root + roots[(beat / 2) % roots.length];
      this.tone('sawtooth', frequency(bass), time, duration * 1.55, .092, this.music, {
        attack: .008, release: .09, cutoff: 410,
      });
      this.tone('sine', frequency(bass - 12), time, duration * 1.48, .09, this.music, { release: .1 });
    }
    if (beat % 2 === 1 || (this.level > 5 && beat % 4 === 0)) {
      const offset = song.melody[(step + Math.floor(step / 16)) % song.melody.length];
      const octave = this.level > 6 && beat % 8 === 7 ? 12 : 0;
      const note = song.root + 24 + chord + offset + octave;
      this.tone('triangle', frequency(note), time, duration * .82, .07, this.music, {
        attack: .006, release: .14,
      });
      this.tone('sine', frequency(note + 12), time, duration * .7, .025, this.music, {
        attack: .01, release: .16, detune: 4,
      });
    }
    if (beat === 0) {
      const base = song.root + 12 + chord;
      const minor = [0, 3, 7, 10];
      for (const interval of minor) {
        this.tone('sawtooth', frequency(base + interval), time, duration * 14, .018, this.music, {
          attack: .32, release: .65, detune: interval % 2 ? 4 : -4, cutoff: 650,
        });
      }
    }
  }

  playEffect(name: string) {
    const ctx = this.context;
    if (!ctx || ctx.state !== 'running' || this.muted || this.destroyed) return;
    const now = ctx.currentTime + .005;
    const effect = String(name || '').toLowerCase();
    if (effect.includes('laser')) {
      const o = this.tone('sawtooth', 960, now, .15, .20, this.effects, { release: .03, cutoff: 2800 });
      o.frequency.exponentialRampToValueAtTime(180, now + .14);
    } else if (effect.includes('drill') || effect.includes('dig')) {
      this.noiseHit(now, .14, .25, 950, false, this.effects);
      const o = this.tone('square', 110, now, .13, .10, this.effects, { release: .03 });
      o.frequency.linearRampToValueAtTime(72, now + .13);
    } else if (effect.includes('missile') || effect.includes('shoot')) {
      const o = this.tone('sawtooth', 330, now, .25, .15, this.effects, { release: .05, cutoff: 1800 });
      o.frequency.exponentialRampToValueAtTime(75, now + .23);
      this.noiseHit(now, .11, .15, 2300, true, this.effects);
    } else if (effect.includes('explod') || effect.includes('blast')) {
      this.noiseHit(now, .34, .30, 700, false, this.effects);
      const o = this.tone('sine', 105, now, .35, .23, this.effects, { release: .04 });
      o.frequency.exponentialRampToValueAtTime(38, now + .32);
    } else if (effect.includes('save') || effect.includes('exit') || effect.includes('win')) {
      [0, 4, 7, 12].forEach((n, i) => {
        this.tone('triangle', frequency(72 + n), now + i * .075, .23, .11, this.effects, { release: .17 });
      });
    } else if (effect.includes('lost') || effect.includes('lose') || effect.includes('dead') || effect.includes('fail')) {
      [0, -3, -7].forEach((n, i) => {
        this.tone('triangle', frequency(56 + n), now + i * .11, .23, .095, this.effects, { release: .12 });
      });
    } else if (effect.includes('bridge') || effect.includes('build')) {
      [0, 7, 12].forEach((n, i) => {
        this.tone('sine', frequency(67 + n), now + i * .04, .12, .10, this.effects, { release: .06 });
      });
    } else if (effect.includes('spawn') || effect.includes('start')) {
      [0, 7, 12].forEach((n, i) => {
        this.tone('triangle', frequency(60 + n), now + i * .08, .22, .10, this.effects, { release: .12 });
      });
    } else if (effect.includes('boost')) {
      const o = this.tone('sawtooth', 160, now, .17, .13, this.effects, { release: .04, cutoff: 1900 });
      o.frequency.exponentialRampToValueAtTime(610, now + .16);
    } else {
      this.tone('sine', frequency(78), now, .065, .08, this.effects, { release: .04 });
    }
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.context) this.context.close().catch(() => {});
    this.context = null;
    this.master = null;
    this.music = null;
    this.effects = null;
    this.noise = null;
  }
}

export default AudioEngine;
