// Rootlight · звук без файлов (Web Audio, процедурный): рост, зрелость, ожидание, дрон, ветер.
// Стартует после первого жеста пользователя (политика автовоспроизведения браузера).
(function (root) {
  'use strict';
  const BASE = 392;                                  // соль первой октавы
  const STEPS = [0, 2, 4, 7, 9, 12];                 // пентатоника: любая последовательность звучит мирно
  const VAR_OFFSET = { sapling: 0, spreading: 3, tall: 7 };
  const hz = (steps) => BASE * Math.pow(2, steps / 12);

  class Sfx {
    constructor() {
      this.ctx = null; this.master = null; this.muted = false; this.voices = 0;
      this.L = { x: 0, z: 0, yaw: 0 }; this.windGain = null;
      this.supported = !!(root.AudioContext || root.webkitAudioContext);
    }
    start() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      if (!this.supported) return;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        this.master.connect(this.ctx.destination);
        this._startWind();
      } catch (e) { this.ctx = null; this.supported = false; }
    }
    setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; }
    setListener(x, z, yaw) { this.L.x = x; this.L.z = z; this.L.yaw = yaw; }
    setAmbient(night) {                              // ветер тише и ниже ночью
      if (this.windGain && this.ctx) this.windGain.gain.setTargetAtTime(0.05 - 0.03 * night, this.ctx.currentTime, 1.0);
    }
    _startWind() {
      const ctx = this.ctx, len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.7;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.1;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 200;
      lfo.connect(lfoGain); lfoGain.connect(bp.frequency);
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0.04;
      src.connect(bp); bp.connect(this.windGain); this.windGain.connect(this.master);
      src.start(); lfo.start();
      this._startRain();
    }
    _startRain() {                                   // шум дождя: всегда играет, громкость = сила дождя
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 0.3;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      src.connect(bp); bp.connect(this.rainGain); this.rainGain.connect(this.master);
      src.start();
    }
    setRain(level) { if (this.rainGain && this.ctx) this.rainGain.gain.setTargetAtTime(level * 0.07, this.ctx.currentTime, 0.8); }
    _noiseBurst(dur, type, freq, q, gain, delay, freqTo) {
      if (!this.ctx || this.muted || !this.noiseBuf) return;
      const ctx = this.ctx, t = ctx.currentTime + (delay || 0);
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
      if (freqTo) f.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t); e.gain.linearRampToValueAtTime(gain, t + Math.min(0.15, dur / 4)); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f); f.connect(e); e.connect(this.master);
      src.start(t); src.stop(t + dur + 0.05);
    }
    thunder(delay) { this._noiseBurst(3.0, 'lowpass', 160, 0.7, 0.5, delay || 0, 55); }
    pour() { this._noiseBurst(0.6, 'bandpass', 1500, 1.0, 0.15, 0); }
    fill() { this._tone(330, 0.4, 'sine', 0.08, null, 0, 660); this._noiseBurst(0.35, 'bandpass', 900, 1.2, 0.1, 0); }
    scan() { this._tone(300, 0.7, 'triangle', 0.08, null, 0, 1200); }
    echo(k) {                                         // эхо-видения: каждая глава звучит по-своему
      const chords = { 1: [0, 7, 12, 16], 2: [-5, 2, 7, 14], 3: [0, 4, 7, 11, 14] };
      (chords[k] || chords[1]).forEach((s, i) => this._tone(hz(s - 12), 2.2, 'sine', 0.09, null, i * 0.2));
    }
    answer() { [0, 4, 7, 12, 16, 19].forEach((s, i) => this._tone(hz(s - 12), 3.5, 'sine', 0.09, null, i * 0.18)); }
    _out(pos) {                                      // громкость по расстоянию и панорама
      const ctx = this.ctx, g = ctx.createGain();
      let vol = 1, pan = 0;
      if (pos) {
        const dx = pos.x - this.L.x, dz = pos.z - this.L.z, d = Math.hypot(dx, dz);
        vol = 1 / (1 + d / 12);
        const rx = Math.cos(this.L.yaw), rz = -Math.sin(this.L.yaw);
        pan = d > 0.01 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) : 0;
      }
      g.gain.value = vol;
      if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(this.master); }
      else g.connect(this.master);
      return g;
    }
    _tone(freq, dur, type, gain, pos, delay, slideTo) {
      if (!this.ctx || this.muted || this.voices >= 12) return;
      const ctx = this.ctx, t = ctx.currentTime + (delay || 0);
      this.voices++;
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, t);
      e.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(e); e.connect(this._out(pos));
      o.start(t); o.stop(t + dur + 0.05);
      o.onended = () => { this.voices--; };
    }
    grow(stage, variant, pos) {                      // стадии роста: восходящая пентатоника
      this._tone(hz((VAR_OFFSET[variant] || 0) + STEPS[Math.min(stage, STEPS.length) - 1]), 0.5, 'triangle', 0.12, pos);
    }
    mature(variant, pos) {                           // зрелость: мягкий аккорд
      const o = VAR_OFFSET[variant] || 0;
      [0, 4, 7, 12].forEach((s, i) => this._tone(hz(o + s), 1.4, 'sine', 0.10, pos, i * 0.08));
    }
    dormant(pos) { this._tone(220, 0.7, 'sine', 0.08, pos, 0, 170); }    // «просит воды/света»: тихий опускающийся тон
    droneReact() { this._tone(880, 0.25, 'sine', 0.07, null); this._tone(1320, 0.35, 'sine', 0.06, null, 0.12); }
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { Sfx };
  else root.RL.Sfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
