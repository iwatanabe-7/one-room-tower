// 効果音と BGM（音声ファイルを使わず、Web Audio でその場で作る）
// ブラウザは操作されるまで音を出せないので、unlock() を「塔に入る」などのクリック・キー入力の中で呼ぶ
import { BAL } from './balance.js';

const MUTE_KEY = 'one-room-tower:muted';
let ctx = null;
let master, sfxBus, musicBus, noiseBuf;
let muted = (() => { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } })();

function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : BAL.MasterVolume;
  // 音割れしないよう軽くコンプレッサーを挟む
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  sfxBus = ctx.createGain();
  sfxBus.gain.value = BAL.SfxVolume;
  sfxBus.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = BAL.MusicVolume;
  musicBus.connect(master);
  // ノイズ（着地・押し出し・ハイハット用）
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  let seed = 12345;
  for (let i = 0; i < d.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x3fffffff) - 1; }
}

export function unlock() {
  init();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export const isMuted = () => muted;
export function setMuted(on) {
  muted = on;
  try { localStorage.setItem(MUTE_KEY, on ? '1' : '0'); } catch { /* 保存できなくても続ける */ }
  if (ctx) master.gain.setTargetAtTime(on ? 0 : BAL.MasterVolume, ctx.currentTime, 0.03);
}

// ---------------------------------------------------------------- 部品
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// 音程のある音: type の波形で、f0 → f1 に滑らせる
function tone(bus, t, { type = 'square', f0, f1 = f0, dur = 0.1, gain = 0.3, attack = 0.005, curve = 'exp' }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) {
    if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    else o.frequency.linearRampToValueAtTime(f1, t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ノイズ: フィルターをかけた短い「ザッ」
function noise(bus, t, { dur = 0.1, gain = 0.3, type = 'lowpass', f0 = 1200, f1 = f0, q = 0.8 }) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------- 効果音
const SFX = {
  jump: (t) => tone(sfxBus, t, { type: 'square', f0: 330, f1: 660, dur: 0.12, gain: 0.12 }),
  airJump: (t) => { tone(sfxBus, t, { type: 'square', f0: 520, f1: 1040, dur: 0.12, gain: 0.1 }); tone(sfxBus, t + 0.04, { type: 'sine', f0: 1400, dur: 0.1, gain: 0.06 }); },
  land: (t, k = 1) => { noise(sfxBus, t, { dur: 0.08, gain: 0.18 * k, f0: 900, f1: 200 }); tone(sfxBus, t, { type: 'sine', f0: 140, f1: 60, dur: 0.1, gain: 0.25 * k }); },
  push: (t) => { tone(sfxBus, t, { type: 'triangle', f0: 260, f1: 110, dur: 0.18, gain: 0.3 }); noise(sfxBus, t, { dur: 0.12, gain: 0.15, type: 'bandpass', f0: 1800, f1: 600, q: 2 }); },
  fall: (t) => tone(sfxBus, t, { type: 'triangle', f0: 700, f1: 110, dur: 0.6, gain: 0.22 }),
  damage: (t) => { tone(sfxBus, t, { type: 'square', f0: 180, f1: 90, dur: 0.22, gain: 0.16 }); tone(sfxBus, t + 0.09, { type: 'square', f0: 140, f1: 70, dur: 0.22, gain: 0.14 }); },
  crumble: (t) => { for (let i = 0; i < 4; i++) noise(sfxBus, t + i * 0.06, { dur: 0.04, gain: 0.1, type: 'bandpass', f0: 700 + i * 150, q: 3 }); },
  key: (t) => [0, 4, 7, 12].forEach((s, i) => tone(sfxBus, t + i * 0.055, { type: 'sine', f0: mtof(84 + s), dur: 0.35, gain: 0.14 })),
  door: (t) => { tone(sfxBus, t, { type: 'triangle', f0: 220, f1: 440, dur: 0.35, gain: 0.18, curve: 'lin' }); noise(sfxBus, t, { dur: 0.35, gain: 0.06, type: 'bandpass', f0: 400, f1: 1600, q: 1 }); },
  exit: (t) => [0, 4, 7, 12, 16].forEach((s, i) => tone(sfxBus, t + i * 0.06, { type: 'square', f0: mtof(72 + s), dur: 0.16, gain: 0.08 })),
  rise: (t) => noise(sfxBus, t, { dur: BAL.RoomAppearSeconds + 0.2, gain: 0.12, type: 'bandpass', f0: 300, f1: 2400, q: 1.5 }),
  upgrade: (t) => { [0, 4, 7].forEach((s) => tone(sfxBus, t, { type: 'triangle', f0: mtof(72 + s), dur: 0.5, gain: 0.12 })); tone(sfxBus, t + 0.12, { type: 'sine', f0: mtof(91), dur: 0.4, gain: 0.08 }); },
  select: (t) => tone(sfxBus, t, { type: 'square', f0: 880, dur: 0.05, gain: 0.06 }),
  clear: (t) => [[0, 0.0], [4, 0.12], [7, 0.24], [12, 0.36], [7, 0.52], [12, 0.64]].forEach(([s, d]) => tone(sfxBus, t + d, { type: 'square', f0: mtof(72 + s), dur: d === 0.64 ? 0.7 : 0.14, gain: 0.1 })),
  over: (t) => [[7, 0], [3, 0.22], [0, 0.44], [-5, 0.66]].forEach(([s, d]) => tone(sfxBus, t + d, { type: 'triangle', f0: mtof(64 + s), dur: d === 0.66 ? 0.8 : 0.24, gain: 0.18 })),
};

export function sfx(name, k) {
  if (!ctx || ctx.state !== 'running' || muted) return;
  const fn = SFX[name];
  if (fn) fn(ctx.currentTime + 0.005, k);
}

// ---------------------------------------------------------------- BGM
// 4小節のコード進行を回す小さなシーケンサー。フロアが上がるほど空に合わせて昼 → 夕方 → 夜の曲調にする
// コードは MIDI のルート + 構成音。旋律は小節ごとにコードの音から決まった型で選ぶ（毎回同じ曲になる）
const SONGS = {
  day: { bpm: 118, root: 60, chords: [[0, 4, 7], [5, 9, 12], [7, 11, 14], [5, 9, 12]], lead: [0, 2, 1, 2, 0, 1, 2, -1], drums: true },
  dusk: { bpm: 112, root: 57, chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [7, 10, 14]], lead: [2, 1, 0, -1, 1, 2, 1, -1], drums: true },
  night: { bpm: 100, root: 62, chords: [[0, 3, 7], [-2, 2, 5], [-4, 0, 3], [-5, -1, 2]], lead: [0, -1, 2, -1, 1, -1, 0, -1], drums: true },
  rest: { bpm: 84, root: 65, chords: [[0, 4, 7, 11], [5, 9, 12, 16], [2, 5, 9, 12], [7, 11, 14, 17]], lead: [-1, -1, 2, -1, -1, -1, 1, -1], drums: false },
};
let song = null;
let songName = null;
let step = 0;
let nextTime = 0;
let timer = null;

function playStep(t, sp) {
  const bar = Math.floor(step / 8) % sp.chords.length;
  const s8 = step % 8;
  const ch = sp.chords[bar];
  const beat = 60 / sp.bpm / 2; // 8分音符
  // ベース: 1拍目と3拍目
  if (s8 === 0 || s8 === 4) tone(musicBus, t, { type: 'triangle', f0: mtof(sp.root - 24 + ch[0]), dur: beat * 3.5, gain: 0.32 });
  if (s8 === 6 && sp.drums) tone(musicBus, t, { type: 'triangle', f0: mtof(sp.root - 24 + ch[0] + 7), dur: beat * 1.5, gain: 0.22 });
  // 和音: 小節の頭に柔らかく
  if (s8 === 0) for (const n of ch) tone(musicBus, t, { type: 'sine', f0: mtof(sp.root + n), dur: beat * 7.5, gain: 0.05, attack: 0.08 });
  // 旋律: 型の番号 = コードの何番目の音か（-1 は休み）
  const li = sp.lead[s8];
  if (li >= 0) tone(musicBus, t, { type: 'square', f0: mtof(sp.root + 12 + ch[li % ch.length]), dur: beat * 0.9, gain: 0.045 });
  // ドラム
  if (sp.drums) {
    if (s8 === 0 || s8 === 4) tone(musicBus, t, { type: 'sine', f0: 150, f1: 45, dur: 0.18, gain: 0.35 });
    if (s8 === 2 || s8 === 6) noise(musicBus, t, { dur: 0.12, gain: 0.12, type: 'bandpass', f0: 1800, q: 0.7 });
    noise(musicBus, t, { dur: 0.03, gain: s8 % 2 ? 0.03 : 0.05, type: 'highpass', f0: 7000 });
  }
  step++;
}

function schedule() {
  if (!ctx || !song) return;
  // 先読み: 少し先までの音を予約しておく（タブの処理が詰まっても途切れにくい）
  while (nextTime < ctx.currentTime + 0.2) {
    playStep(nextTime, song);
    nextTime += 60 / song.bpm / 2;
  }
}

export function music(name) {
  if (!ctx) return;
  if (name === songName) return;
  songName = name;
  song = name ? SONGS[name] : null;
  if (!song) { clearInterval(timer); timer = null; return; }
  step = 0;
  nextTime = ctx.currentTime + 0.1;
  if (!timer) timer = setInterval(schedule, 50);
  schedule();
}

// フロアに合わせた曲の名前（空の色が変わるのと同じ区切り）
export function songForFloor(floor, rest) {
  if (rest) return 'rest';
  const t = (floor - 1) / (BAL.TowerFloorCount - 1);
  return t < 0.35 ? 'day' : t < 0.7 ? 'dusk' : 'night';
}

// 動作確認用（ハーネス・ブラウザから）: 音が出せる状態か、いま流れている曲
export const audioState = () => ({ context: ctx ? ctx.state : 'none', song: songName, muted });
