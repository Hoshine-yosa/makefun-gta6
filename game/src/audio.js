(function (global) {
  'use strict';
  var SC = global.SC;
  function AudioEngine() {
    this.ctx = null; this.master = null; this.muted = false;
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
    this.sirenOsc = null; this.sirenGain = null; this.sirenTimer = null;
    this.musicTimer = null; this.musicStep = 0; this.musicOn = false;
    this.noiseState = 0x51f15e5d;
  }
  AudioEngine.prototype.ensure = function () {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (e) { return false; }
  };
  AudioEngine.prototype.setMuted = function (m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.55;
  };
  AudioEngine.prototype._noiseBuffer = function (seconds) {
    var len = Math.floor(this.ctx.sampleRate * seconds);
    var buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var x = this.noiseState | 0;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this.noiseState = x >>> 0;
      data[i] = (this.noiseState / 4294967295) * 2 - 1;
    }
    return buf;
  };
  AudioEngine.prototype._tone = function (type, freq, t0, dur, vol, slideTo, slideDur) {
    var o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + (slideDur || dur));
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  };
  AudioEngine.prototype._noise = function (dur, cutoff, vol, t0) {
    var t = t0 || this.ctx.currentTime;
    var s = this.ctx.createBufferSource(); s.buffer = this._noiseBuffer(dur);
    var f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff;
    var g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  };
  AudioEngine.prototype.blip = function (type) {
    if (!this.ensure()) return;
    var t = this.ctx.currentTime, i;
    if (type === 'shot') {
      this._noise(0.18, 1800, 0.9, t);
      this._tone('square', 160, t, 0.14, 0.5, 50, 0.12);
    } else if (type === 'pickup' || type === 'mission' || type === 'alarm') {
      var notes = type === 'pickup' ? [660, 880, 1320] : (type === 'alarm' ? [880, 660, 880, 660] : [523, 659, 784, 1046]);
      for (i = 0; i < notes.length; i++) this._tone('sine', notes[i], t + i * 0.09, 0.35, 0.35);
    } else if (type === 'shotgun') {
      this._noise(0.25, 900, 1.0, t);
      this._tone('sine', 120, t, 0.22, 0.7, 35, 0.2);
    } else if (type === 'crash') {
      this._noise(0.3, 500, 0.8, t);
    } else if (type === 'step') {
      this._noise(0.06, 700, 0.12, t);
    } else if (type === 'click') {
      this._tone('square', 1200, t, 0.05, 0.12);
    } else if (type === 'arrest') {
      var o = this.ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(440, t);
      o.frequency.linearRampToValueAtTime(220, t + 0.5);
      var g = this.ctx.createGain();
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.6);
    }
  };
  AudioEngine.prototype.setEngine = function (speed01, on) {
    if (!this.ensure()) return;
    if (!on || speed01 <= 0.01) {
      if (this.engineOsc) { try { this.engineOsc.stop(); } catch (e) {} this.engineOsc = null; }
      return;
    }
    if (!this.engineOsc) {
      var ctx = this.ctx;
      this.engineOsc = ctx.createOscillator(); this.engineOsc.type = 'sawtooth';
      this.engineFilter = ctx.createBiquadFilter(); this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 400;
      this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(this.engineFilter); this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, this.ctx.currentTime, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + speed01 * 900, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.09, this.ctx.currentTime, 0.1);
  };
  AudioEngine.prototype.setSiren = function (on) {
    if (!this.ensure()) return;
    if (!on) {
      if (this.sirenTimer) { clearInterval(this.sirenTimer); this.sirenTimer = null; }
      if (this.sirenOsc) { try { this.sirenOsc.stop(); } catch (e) {} this.sirenOsc = null; }
      return;
    }
    if (this.sirenOsc) return;
    var ctx = this.ctx, self = this;
    this.sirenOsc = ctx.createOscillator(); this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0.05;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    var high = true;
    this.sirenTimer = setInterval(function () {
      if (!self.sirenOsc) return;
      high = !high;
      self.sirenOsc.frequency.setTargetAtTime(high ? 950 : 650, ctx.currentTime, 0.05);
    }, 450);
  };
  AudioEngine.prototype.startMusic = function () {
    if (!this.ensure() || this.musicOn) return;
    this.musicOn = true;
    var ctx = this.ctx, self = this;
    var bassNotes = [55, 43.65, 65.41, 49];
    this.musicTimer = setInterval(function () {
      if (!self.musicOn || !self.ctx) return;
      var t = ctx.currentTime;
      var step = self.musicStep++;
      var bar = Math.floor(step / 8) % 4;
      var beat = step % 8;
      if (beat === 0 || beat === 3 || beat === 4 || beat === 6) {
        self._tone('triangle', bassNotes[bar], t, 0.5, 0.22);
      }
      if (beat % 2 === 0) {
        var n = ctx.createBufferSource(); n.buffer = self._noiseBuffer(0.03);
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
        var hg = ctx.createGain(); hg.gain.value = 0.05;
        n.connect(hp); hp.connect(hg); hg.connect(self.master); n.start(t);
      }
      if (beat === 0) {
        var arp = [440, 523.25, 659.25, 880];
        for (var i = 0; i < 4; i++) self._tone('sine', arp[i] * (bar === 1 ? 0.89 : 1), t + i * 0.12, 0.3, 0.06);
      }
    }, 240);
  };
  AudioEngine.prototype.stopMusic = function () {
    this.musicOn = false;
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  };
  SC.audio = { AudioEngine: AudioEngine };
})(typeof window !== 'undefined' ? window : globalThis);
