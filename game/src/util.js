// Shared helpers for Solmar City: a seeded RNG (mulberry32) so screenshot runs
// are reproducible, plus small math helpers used by every other module.
(function (global) {
  'use strict';

  // Seeded pseudo-random generator. Same seed -> same sequence, every run.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    var next = mulberry32(seed);
    return {
      next: next,
      range: function (lo, hi) { return lo + (hi - lo) * next(); },
      int: function (lo, hi) { return Math.floor(lo + (hi - lo + 1) * next()); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length)]; },
      chance: function (p) { return next() < p; },
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  // Shortest signed angle difference (radians).
  function angleDiff(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function lerpAngle(a, b, t) { return a + angleDiff(a, b) * t; }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }

  global.SC = global.SC || {};
  global.SC.util = { mulberry32: mulberry32, makeRng: makeRng, clamp: clamp, lerp: lerp, angleDiff: angleDiff, lerpAngle: lerpAngle, dist2: dist2 };
})(typeof window !== 'undefined' ? window : globalThis);
