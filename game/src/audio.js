// Synthesized sound for Solmar City: everything is WebAudio, no audio files.
// Engine hum, police siren, gunshot, pickup chime, and a looping synthwave-ish
// bassline. All nodes are created lazily on the first user gesture (autoplay
// policy), and M toggles mute.
(function (global) {
  'use strict';
  var SC = global.SC;

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicOn = false;
    // deterministic noise state: the xorshift32 stream below makes every
    // gunshot and crash sound identical on every run, and it never touches
    // the gameplay RNG
    this.noiseState = 0x51f15e5d;
  }

  AudioEngine.prototype.ensure = function () {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
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
      // small xorshift32 stream: repeatable sound texture, no Math.random,
      // and it never touches the gameplay RNG
      var x = this.noiseState | 0;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      this.noiseState = x >>> 0;
      data[i] = (this.noiseState / 4294967295) * 2 - 1;
    }
    return buf;
  };

  // Short one-shot blips. type: 'shot' | 'pickup' | 'crash' | 'click' | 'arrest' | 'mission'.
  AudioEngine.prototype.blip = function (type) {
    if (!this.ensure()) return;
    var ctx = this.ctx, t = ctx.currentTime;
    if (type === 'shot') {
      var src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(0.18);
      var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.2);
      var o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
      var og = ctx.createGain();
      og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.15);
    } else if (type === 'pickup' || type === 'mission' || type === 'alarm') {
      var notes = type === 'pickup' ? [660, 880, 1320] : (type === 'alarm' ? [880, 660, 880, 660] : [523, 659, 784, 1046]);
      for (var i = 0; i < notes.length; i++) {
        var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = notes[i];
        var g2 = ctx.createGain();
        var t0 = t + i * 0.09;
        g2.gain.setValueAtTime(0.0001, t0);
        g2.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.35);
        o2.connect(g2); g2.connect(this.master); o2.start(t0); o2.stop(t0 + 0.4);
      }
    } else if (type === 'shotgun') {
      // a deeper boom: low thump + a burst of noise
      var s3 = ctx.createBufferSource(); s3.buffer = this._noiseBuffer(0.25);
      var f3 = ctx.createBiquadFilter(); f3.type = 'lowpass'; f3.frequency.value = 900;
      var g6 = ctx.createGain();
      g6.gain.setValueAtTime(1.0, t); g6.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      s3.connect(f3); f3.connect(g6); g6.connect(this.master); s3.start(t); s3.stop(t + 0.27);
      var o5 = ctx.createOscillator(); o5.type = 'sine'; o5.frequency.setValueAtTime(120, t);
      o5.frequency.exponentialRampToValueAtTime(35, t + 0.2);
      var og2 = ctx.createGain();
      og2.gain.setValueAtTime(0.7, t); og2.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o5.connect(og2); og2.connect(this.master); o5.start(t); o5.stop(t + 0.25);
    } else if (type === 'crash') {
      var s2 = ctx.createBufferSource(); s2.buffer = this._noiseBuffer(0.3);
      var f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 500;
      var g3 = ctx.createGain();
      g3.gain.setValueAtTime(0.8, t); g3.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      s2.connect(f2); f2.connect(g3); g3.connect(this.master); s2.start(t); s2.stop(t + 0.32);
    } else if (type === 'click') {
      var o3 = ctx.createOscillator(); o3.type = 'square'; o3.frequency.value = 1200;
      var g4 = ctx.createGain();
      g4.gain.setValueAtTime(0.12, t); g4.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o3.connect(g4); g4.connect(this.master); o3.start(t); o3.stop(t + 0.06);
    } else if (type === 'arrest') {
      var o4 = ctx.createOscillator(); o4.type = 'sawtooth';
      o4.frequency.setValueAtTime(440, t);
      o4.frequency.linearRampToValueAtTime(220, t + 0.5);
      var g5 = ctx.createGain();
      g5.gain.setValueAtTime(0.3, t); g5.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      o4.connect(g5); g5.connect(this.master); o4.start(t); o4.stop(t + 0.6);
    }
  };

  // Continuous engine hum. speed01: 0..1 (0 = idle/off).
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
    var freq = 55 + speed01 * 130;
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.06);
    this.engineFilter.frequency.setTargetAtTime(300 + speed01 * 900, this.ctx.currentTime, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + speed01 * 0.09, this.ctx.currentTime, 0.1);
  };

  // Two-tone police siren while wanted > 0.
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

  // Simple synthwave loop: Am – F – C – G bassline with a hat tick.
  AudioEngine.prototype.startMusic = function () {
    if (!this.ensure() || this.musicOn) return;
    this.musicOn = true;
    var ctx = this.ctx, self = this;
    var bassNotes = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1
    this.musicTimer = setInterval(function () {
      if (!self.musicOn || !self.ctx) return;
      var t = ctx.currentTime;
      var step = self.musicStep++;
      var bar = Math.floor(step / 8) % 4;
      var beat = step % 8;
      // Bass on beats 0, 3, 4, 6.
      if (beat === 0 || beat === 3 || beat === 4 || beat === 6) {
        var o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.value = bassNotes[bar];
        var g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        o.connect(g); g.connect(self.master); o.start(t); o.stop(t + 0.55);
      }
      // Hat tick every other beat.
      if (beat % 2 === 0) {
        var n = ctx.createBufferSource(); n.buffer = self._noiseBuffer(0.03);
        var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
        var hg = ctx.createGain(); hg.gain.value = 0.05;
        n.connect(hp); hp.connect(hg); hg.connect(self.master); n.start(t);
      }
      // Sparkle arpeggio on the bar's first beat.
      if (beat === 0) {
        var arp = [440, 523.25, 659.25, 880];
        for (var i = 0; i < 4; i++) {
          var a = ctx.createOscillator(); a.type = 'sine';
          a.frequency.value = arp[i] * (bar === 1 ? 0.89 : 1);
          var ag = ctx.createGain();
          var t0 = t + i * 0.12;
          ag.gain.setValueAtTime(0.0001, t0);
          ag.gain.exponentialRampToValueAtTime(0.06, t0 + 0.02);
          ag.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
          a.connect(ag); ag.connect(self.master); a.start(t0); a.stop(t0 + 0.35);
        }
      }
    }, 240);
  };

  AudioEngine.prototype.stopMusic = function () {
    this.musicOn = false;
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  };

  SC.audio = { AudioEngine: AudioEngine };
})(typeof window !== 'undefined' ? window : globalThis);
