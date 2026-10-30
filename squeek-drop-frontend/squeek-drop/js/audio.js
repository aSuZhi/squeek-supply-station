// Tiny WebAudio synth for squeaks & pops. Muted until the first user gesture.
let ctx = null, muted = localStorage.getItem('sd.mute') === '1';
const ensure = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } return ctx; };
function tone(freq, dur, type = 'sine', vol = 0.08, slide = 0) {
  if (muted || !ensure()) return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + dur);
}
export const sfx = {
  get muted() { return muted; },
  toggle() { muted = !muted; localStorage.setItem('sd.mute', muted ? '1' : '0'); return muted; },
  unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); },
  drop() { tone(520, 0.08, 'triangle', 0.05, 0.6); },
  merge(lv) { tone(380 + lv * 70, 0.14, 'sine', 0.08, 1.6); setTimeout(() => tone(900 + lv * 60, 0.08, 'sine', 0.04, 1.3), 50); },
  block() { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'square', 0.035), i * 70)); },
  shake() { tone(140, 0.25, 'sawtooth', 0.04, 0.5); },
  over() { [500, 400, 300].forEach((f, i) => setTimeout(() => tone(f, 0.22, 'triangle', 0.06), i * 140)); },
  swap() { tone(700, 0.06, 'sine', 0.04, 1.4); },
};
