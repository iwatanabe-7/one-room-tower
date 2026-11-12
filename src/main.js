// ワンルームタワー Web 版（docs/prototype/web-prototype.html を Vite + モジュールに移したもの）
import * as THREE from 'three';
import './style.css';
import { BAL, GIMMICK_COST, GIMMICK_NAME } from './balance.js';
import { LAYOUTS, REST, STD, ENTRANCE, EXIT_TRIGGER, DOOR, UPGRADES } from './data.js';
import {
  mulberry32, makePicker, nextOrigin, exitLocal, entranceAnchor, isFalling, isRestFloor,
  chooseGimmicks, gimmickCandidates, jumpVelocity, approach, upgradeChoices,
  samePlat, liftOffset, barAngularSpeed, fallDamage,
} from './logic.js';

const HARNESS = !!window.__harness;
const $ = (id) => document.getElementById(id);

// ===== Three.js =====
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: HARNESS });
renderer.setPixelRatio(HARNESS ? 1 : Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const SKY = [new THREE.Color('#8fcdf0'), new THREE.Color('#f0a06c'), new THREE.Color('#1c2152')];
const skyColor = SKY[0].clone();
const skyTarget = SKY[0].clone();
scene.background = skyColor;
scene.fog = new THREE.Fog(skyColor, 22, 62);

// r155 以降は物理ベースのライト単位なので、プロトタイプ（r128）の明るさに π を掛けて合わせる
const LIGHT = Math.PI;
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
const hemi = new THREE.HemisphereLight(0xffffff, 0x7d88a8, 0.7 * LIGHT);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 0.85 * LIGHT);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// 影の範囲は部屋の大きさから決める（24m の部屋の先まで届くように）
const SHADOW_HALF = BAL.RoomSize * 0.75;
Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 60 });
scene.add(sun, sun.target);

const MAT = {
  plat: new THREE.MeshStandardMaterial({ color: 0xeef1f7, roughness: 0.9 }),
  exit: new THREE.MeshStandardMaterial({ color: 0xf7f8fb, roughness: 0.8 }),
  lift: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
  rail: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }),
  warn: new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: BAL.BarWarnRingOpacity, depthWrite: false }),
  crumble: new THREE.MeshStandardMaterial({ color: 0xd6b88f, roughness: 1 }),
  danger: new THREE.MeshStandardMaterial({ color: 0xe5484d, roughness: 0.55 }),
  post: new THREE.MeshStandardMaterial({ color: 0x2a2d40, roughness: 0.6 }),
  goal: new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.4, emissive: 0x6b5200, emissiveIntensity: 0.5 }),
  door: new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.3, transparent: true, opacity: 0.55, emissive: 0x5a4500 }),
  hero: new THREE.MeshStandardMaterial({ color: 0x3a5bff, roughness: 0.45 }),
  heroDark: new THREE.MeshStandardMaterial({ color: 0x1b2a8a, roughness: 0.5 }),
};
const SHARED_MATS = new Set(Object.values(MAT));
const CRUMBLE_COLOR = 0xd6b88f;
const CRUMBLE_WARN = 0xc49867;

function labelSprite(text, color = '#141624', bg = 'rgba(243,245,250,0.92)') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect ? g.roundRect(8, 16, 240, 96, 22) : g.rect(8, 16, 240, 96);
  g.fill();
  g.fillStyle = color;
  g.font = '64px "Dela Gothic One", "Hiragino Sans", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sp.scale.set(2.4, 1.2, 1);
  return sp;
}

// ===== プレイヤー =====
const hero = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 1.0, 16), MAT.hero);
  body.position.y = 0.6;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), MAT.hero);
  head.position.y = 1.32;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.1), MAT.heroDark);
  visor.position.set(0, 1.36, 0.26);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.42, 0.18), MAT.heroDark);
  pack.position.set(0, 0.75, -0.3);
  [body, head, visor, pack].forEach((m) => { m.castShadow = true; hero.add(m); });
}
const heroModel = new THREE.Group();
heroModel.add(hero);
scene.add(heroModel);

// ===== 状態 =====
const S = { floor: 1, hp: 0, maxHp: 0, seed: 0, owned: [], runTime: 0, roomTime: 0, falls: 0, hits: 0, roomLog: [] };
const P = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), grounded: false, ground: null,
  groundPlat: null, sinceGround: 9, sinceJump: 9, airJumps: 0, stun: 0, inv: 0, squash: 0, yaw: 0 };
let rng = Math.random;
let pick = () => 0;
let rooms = [];
let phase = 'loading';
let freeze = 0;
let shake = 0;
// force: { layout: 番号, gimmicks: 'all' | 'none' } | null（ハーネス用。all = 全スロットを予算・上限を無視して置く）
const debug = { god: false, force: null };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function seedFromUrl() {
  const v = Number(new URLSearchParams(location.search).get('seed'));
  return Number.isInteger(v) && v > 0 ? v : 0;
}

function newRun(seed = 0) {
  rooms.forEach(disposeRoom);
  rooms = [];
  S.seed = seed || BAL.RoomSeed || seedFromUrl() || Math.floor(Math.random() * 90000) + 10000;
  rng = mulberry32(S.seed);
  pick = makePicker(rng, LAYOUTS.length);
  S.maxHp = BAL.PlayerMaxHp;
  S.hp = S.maxHp;
  S.mods = { speed: 1, jump: 1, airJumps: 0, ukemi: false, keyRadius: BAL.KeyPickupRadius, knock: 1 };
  S.owned = [];
  S.floor = 1;
  S.runTime = 0;
  S.roomTime = 0;
  S.falls = 0;
  S.hits = 0;
  S.roomLog = [];
  S.roomStats = { hits: 0, falls: 0 };
  spawnRoom(true);
  respawn();
  camera.position.copy(P.pos).add(CAM_OFFSET);
  $('seed').textContent = 'SEED ' + S.seed;
  updateHud();
  announce(S.floor, cur().gimmicks, cur().layout);
}
const cur = () => rooms[rooms.length - 1];

// ===== 部屋の生成 =====
const tmpV = new THREE.Vector3();
function spawnRoom(first) {
  const prev = cur();
  const n = prev ? prev.n + 1 : 1;
  let origin = new THREE.Vector3();
  if (prev) {
    // RoomPlacement: 前の部屋の Exit = 新しい部屋の入口側の接続点
    const ex = exitLocal(BAL);
    const o = nextOrigin({ x: prev.origin.x + ex.x, y: prev.origin.y + ex.y, z: prev.origin.z + ex.z }, entranceAnchor);
    origin = new THREE.Vector3(o.x, o.y, o.z);
  }
  const f = debug.force;
  const rest = isRestFloor(n, BAL);
  const layout = rest ? REST : f ? LAYOUTS[f.layout] : LAYOUTS[pick()];
  const slots = rest ? [] : f ? (f.gimmicks === 'all' ? gimmickCandidates(layout) : []) : chooseGimmicks(n, layout, rng, BAL, GIMMICK_COST);
  const gimmicks = slots.map((c) => c.type);
  const has = (type, slot) => slots.some((c) => c.type === type && c.slot === slot);

  const group = new THREE.Group();
  group.position.copy(origin);
  if (!first) group.position.y -= BAL.RoomAppearDepth;
  const room = { n, origin, group, layout, gimmicks, slots, plats: [], bars: [], lifts: [], key: null, door: null, t: 0,
    appear: first ? 1 : 0, exited: false };

  const addPlat = (def, extra) => {
    const [x, z0, z1, w, top, tag] = def;
    const crumble = !!tag && has('crumble', tag);
    const isExit = samePlat(def, STD.exitPlat);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, z1 - z0),
      crumble ? MAT.crumble.clone() : extra ? MAT.lift : isExit ? MAT.exit : MAT.plat);
    mesh.position.set(x, top - 0.3, (z0 + z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const p = { id: `${n}:${room.plats.length}`, mesh, crumble, state: 'idle', t: 0, off: 0, vy: 0, home: mesh.position.clone(), lift: null,
      min: new THREE.Vector3(x - w / 2, top - 0.6, z0), max: new THREE.Vector3(x + w / 2, top, z1) };
    room.plats.push(p);
    return p;
  };
  for (const def of layout.plats) addPlat(def);
  (layout.lifts || []).forEach((l, i) => {
    if (!has('lift', i)) { l.static.forEach((def) => addPlat(def)); return; }
    const p = addPlat([l.x, l.z0, l.z1, l.w, l.top], true);
    p.lift = { axis: l.axis, dist: l.dist, period: l.period, off: 0, delta: 0,
      baseMinX: p.min.x, baseMaxX: p.max.x, baseMinZ: p.min.z, baseMaxZ: p.max.z };
    room.lifts.push(p);
    // 移動範囲を示すレール（動く範囲の全長。足場の下にも通る細い線）
    const alongX = l.axis === 'x';
    const len = Math.abs(l.dist) + (alongX ? l.w : l.z1 - l.z0);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : BAL.LiftRailWidth, BAL.LiftRailHeight, alongX ? BAL.LiftRailWidth : len), MAT.rail);
    rail.position.set(l.x + (alongX ? l.dist / 2 : 0), l.top - BAL.LiftRailHeight, (l.z0 + l.z1) / 2 + (alongX ? 0 : l.dist / 2));
    group.add(rail);
  });

  // 出口のゲート
  const gate = new THREE.Group();
  for (const sx of [-STD.gatePostX, STD.gatePostX]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.25, DOOR.height, 0.25), MAT.goal);
    p.position.set(sx, BAL.RoomRiseHeight + DOOR.height / 2, STD.gateZ);
    p.castShadow = true;
    gate.add(p);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(STD.gatePostX * 2 + 0.25, 0.3, 0.3), MAT.goal);
  lintel.position.set(0, BAL.RoomRiseHeight + DOOR.height, STD.gateZ);
  gate.add(lintel);
  group.add(gate);

  const sign = labelSprite(n + 'F', '#141624');
  sign.position.set(-3.8, 1.5, 0.8);
  group.add(sign);
  if (layout.rest) {
    const restSign = labelSprite('休憩', '#141624', 'rgba(245,197,24,0.95)');
    restSign.position.set(0, 2.2, 6);
    group.add(restSign);
  }

  (layout.bars || []).forEach((b, i) => {
    if (!has('bar', i)) return;
    const pivot = new THREE.Group();
    pivot.position.set(b.x, b.top, b.z);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.0, 14), MAT.post);
    post.position.y = 0.5;
    post.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(b.r * 2, 0.28, 0.28), MAT.danger);
    arm.position.y = BAL.BarArmHeight;
    arm.castShadow = true;
    pivot.add(post, arm);
    group.add(pivot);
    // 届く範囲を示す赤い円（影は落とさない）
    const ring = new THREE.Mesh(new THREE.CircleGeometry(b.r, 48), MAT.warn);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(b.x, b.top + 0.02, b.z);
    group.add(ring);
    room.bars.push({ ...b, pivot, angle: rng() * Math.PI, speed: barAngularSpeed(n, b.r, BAL) * (rng() < 0.5 ? -1 : 1) });
  });
  if (has('key', 0)) {
    const [kx, ky, kz] = layout.key;
    const key = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), MAT.goal);
    key.position.set(kx, ky, kz);
    key.castShadow = true;
    group.add(key);
    room.key = { mesh: key, base: ky, got: false };
    const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR.halfWidth * 2, DOOR.height, DOOR.thick), MAT.door);
    door.position.set(0, BAL.RoomRiseHeight + DOOR.height / 2, DOOR.z);
    group.add(door);
    room.door = { mesh: door, open: 0, opened: false };
  }

  scene.add(group);
  rooms.push(room);
  // 古い部屋を消す（プレイヤーは常に新しい部屋の入口側にいるので、乗っている部屋は消えない）
  while (rooms.length > BAL.MaxRoomsAlive) disposeRoom(rooms.shift());
  return room;
}

function disposeRoom(room) {
  scene.remove(room.group);
  room.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    // 共有マテリアル（MAT）は残し、部屋ごとに作ったもの（崩れる床・看板）だけ捨てる
    if (o.material && !SHARED_MATS.has(o.material)) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

// 衝突判定用の箱（ワールド座標）。毎フレームの生成を避けるため使い回す
const boxes = [];
let boxN = 0;
function addBox(minX, maxX, minY, maxY, minZ, maxZ, plat) {
  let b = boxes[boxN];
  if (!b) { b = {}; boxes[boxN] = b; }
  b.minX = minX; b.maxX = maxX; b.minY = minY; b.maxY = maxY; b.minZ = minZ; b.maxZ = maxZ; b.plat = plat;
  boxN++;
}
function collectBoxes() {
  boxN = 0;
  for (const r of rooms) {
    // 当たり判定は最終位置で行う（せり上がり中の床に横から押し出されて落ちる不具合の対策。動くのは見た目だけ）
    const o = r.origin;
    for (const p of r.plats) {
      if (p.state === 'falling' || p.state === 'gone') continue;
      addBox(o.x + p.min.x, o.x + p.max.x, o.y + p.min.y, o.y + p.max.y, o.z + p.min.z, o.z + p.max.z, p);
    }
    for (const b of r.bars) addBox(o.x + b.x - 0.28, o.x + b.x + 0.28, o.y + b.top, o.y + b.top + 1.0, o.z + b.z - 0.28, o.z + b.z + 0.28, null);
    if (r.door && !r.door.opened) {
      const y0 = o.y + BAL.RoomRiseHeight;
      addBox(o.x - DOOR.halfWidth, o.x + DOOR.halfWidth, y0, y0 + DOOR.height, o.z + DOOR.z - DOOR.thick / 2, o.z + DOOR.z + DOOR.thick / 2, null);
    }
  }
}

const R = 0.3, H = 1.6, EPS = 1e-4;
function overlaps(b) {
  return P.pos.x + R > b.minX && P.pos.x - R < b.maxX &&
         P.pos.z + R > b.minZ && P.pos.z - R < b.maxZ &&
         P.pos.y + H > b.minY + EPS && P.pos.y < b.maxY - EPS;
}
function resolve(axis, v) {
  for (let i = 0; i < boxN; i++) {
    const b = boxes[i];
    if (!overlaps(b)) continue;
    if (axis === 'x') { P.pos.x = v > 0 ? b.minX - R : b.maxX + R; P.vel.x = 0; }
    else if (axis === 'z') { P.pos.z = v > 0 ? b.minZ - R : b.maxZ + R; P.vel.z = 0; }
    else if (v <= 0) { P.pos.y = b.maxY; P.vel.y = 0; P.grounded = true; P.ground = b; }
    else { P.pos.y = b.minY - H; P.vel.y = 0; }
  }
}

// ===== 入力 =====
const keys = new Set();
let jumpQueued = false;
const touch = { x: 0, y: 0 };
// ハーネス（自動操縦）からの入力。x, z はワールドの向き
let bot = null;
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (phase === 'choose' && /^Digit[1-3]$/.test(e.code)) { choose(+e.code.slice(5) - 1); return; }
  if ((phase === 'title' || phase === 'over' || phase === 'clear') && e.code === 'Enter') { start(); return; }
  if (phase === 'play' && e.code === 'KeyR') { newRun(); return; }
  if (!keys.has(e.code) && e.code === 'Space') jumpQueued = true;
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

// タッチ: 左スティック + ジャンプボタン
if ('ontouchstart' in window || matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
{
  const stick = $('stick'), knob = $('knob');
  let stickId = null, stickC = null;
  const moveStick = (e) => {
    let dx = e.clientX - stickC.x, dy = e.clientY - stickC.y;
    const len = Math.hypot(dx, dy), max = 50;
    if (len > max) { dx *= max / len; dy *= max / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    touch.x = dx / max;
    touch.y = -dy / max;
  };
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    const r = stick.getBoundingClientRect();
    stickC = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    stick.setPointerCapture(e.pointerId);
    moveStick(e);
  });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  const endStick = (e) => { if (e.pointerId === stickId) { stickId = null; touch.x = touch.y = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  $('jumpBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); jumpQueued = true; });
}

// ===== ゲーム進行 =====
function respawn() {
  const r = cur();
  P.pos.copy(r.origin).add(tmpV.set(ENTRANCE.x, ENTRANCE.y, ENTRANCE.z));
  P.vel.set(0, 0, 0);
  P.groundPlat = null;
  P.stun = 0;
  P.yaw = 0;
  for (const p of r.plats) if (!p.lift) resetPlat(p);
}
function resetPlat(p) {
  p.state = 'idle'; p.t = 0; p.off = 0; p.vy = 0;
  p.mesh.position.copy(p.home);
  p.mesh.visible = true;
  if (p.crumble) p.mesh.material.color.setHex(CRUMBLE_COLOR);
}

function damage(kind) {
  if (kind === 'fall') {
    S.falls++;
    S.roomStats.falls++;
    // 無敵時間中の落下はダメージなし（リスポーンだけ）
    if (fallDamage(P.inv) === 0) return false;
    if (!S.mods.ukemi && !debug.god) S.hp--;
  } else {
    if (P.inv > 0) return false;
    S.hits++;
    S.roomStats.hits++;
    if (!debug.god) S.hp--;
  }
  P.inv = BAL.InvincibleSeconds;
  freeze = BAL.HitStopSeconds + 0.03;
  if (!reduceMotion) shake = 0.3;
  updateHud();
  if (S.hp <= 0) { gameOver(); return true; }
  return true;
}

// 1部屋ごとの記録（ハーネスの集計用）。cleared = false はその部屋で力尽きた
function logRoom(r, cleared) {
  S.roomLog.push({ floor: r.n, layout: r.layout.name, gimmicks: r.gimmicks.slice(), seconds: +S.roomTime.toFixed(2), cleared, ...S.roomStats });
}

function onExit() {
  const r = cur();
  r.exited = true;
  logRoom(r, true);
  S.roomStats = { hits: 0, falls: 0 };
  if (r.n >= BAL.TowerFloorCount) { finish(); return; }
  const next = spawnRoom(false);
  S.floor = next.n;
  S.roomTime = 0;
  updateHud();
  if (next.layout.rest) openChoice();
  else announce(next.n, next.gimmicks, next.layout);
}

let toastTimer = 0;
function announce(n, gimmicks, layout) {
  let html;
  const counts = {};
  for (const g of gimmicks) counts[g] = (counts[g] || 0) + 1;
  const names = Object.keys(counts).map((g) => GIMMICK_NAME[g] + (counts[g] > 1 ? ` ×${counts[g]}` : '')).join(' ＋ ');
  if (n === BAL.TowerFloorCount) html = `<b>${n}F 最上階</b> — ${names || '仕掛けなし'}`;
  else if (!gimmicks.length) html = `<b>${n}F</b> ${layout.name} — 仕掛けなし`;
  else html = `<b>${n}F</b> ${layout.name} — <span class="d">${names}</span>`;
  showToast(html, 2.6);
}
function showToast(html, sec = 1.8) {
  const t = $('toast');
  t.innerHTML = html;
  t.classList.add('show');
  toastTimer = sec;
}

// ===== 更新（固定のゲーム時間 dt で進める） =====
const keyWorld = new THREE.Vector3();
function update(dt) {
  S.runTime += dt;
  S.roomTime += dt;

  // 部屋のせり上がり
  for (const r of rooms) {
    if (r.appear < 1) {
      r.appear = BAL.RoomAppearSeconds > 0 ? Math.min(1, r.appear + dt / BAL.RoomAppearSeconds) : 1;
      const e = 1 - Math.pow(1 - r.appear, 3);
      r.group.position.y = r.origin.y - BAL.RoomAppearDepth * (1 - e);
    }
  }

  // 仕掛け
  for (const r of rooms) {
    for (const b of r.bars) { b.angle += b.speed * dt; b.pivot.rotation.y = b.angle; }
    r.t += dt;
    for (const p of r.lifts) {
      const l = p.lift;
      const off = liftOffset(r.t, l.period, l.dist, BAL.LiftEndPauseSeconds);
      l.delta = off - l.off;
      l.off = off;
      if (l.axis === 'x') {
        p.min.x = l.baseMinX + off; p.max.x = l.baseMaxX + off;
        p.mesh.position.x = p.home.x + off;
      } else {
        p.min.z = l.baseMinZ + off; p.max.z = l.baseMaxZ + off;
        p.mesh.position.z = p.home.z + off;
      }
    }
    if (r.key && !r.key.got) {
      r.key.mesh.rotation.y += dt * 2;
      r.key.mesh.position.y = r.key.base + Math.sin(S.runTime * 3) * 0.12;
    }
    if (r.door && r.door.opened && r.door.open < 1) {
      r.door.open = Math.min(1, r.door.open + dt * 3);
      r.door.mesh.scale.y = Math.max(0.001, 1 - r.door.open);
      r.door.mesh.position.y = BAL.RoomRiseHeight + (DOOR.height / 2) * (1 - r.door.open);
    }
    for (const p of r.plats) {
      if (!p.crumble) continue;
      if (p.state === 'shaking') {
        p.t += dt;
        p.mesh.position.x = p.home.x + (reduceMotion ? 0 : Math.sin(p.t * 70) * 0.05);
        p.mesh.material.color.setHex(p.t > 0.3 ? CRUMBLE_WARN : CRUMBLE_COLOR);
        if (p.t > BAL.CrumbleShakeSeconds) { p.state = 'falling'; p.vy = 0; }
      } else if (p.state === 'falling') {
        p.vy += BAL.Gravity * dt;
        p.off += p.vy * dt;
        p.mesh.position.y = p.home.y + p.off;
        if (p.off < -14) { p.state = 'gone'; p.mesh.visible = false; p.t = 0; }
      } else if (p.state === 'gone') {
        p.t += dt;
        if (p.t > BAL.CrumbleRespawnSeconds) resetPlat(p);
      }
    }
  }

  // 入力（画面の右 = ワールドの -X。カメラは -Z 側から +Z を見ている）
  let mx, mz, sprint;
  if (bot) {
    mx = bot.x; mz = bot.z; sprint = bot.sprint;
    if (bot.jump) { jumpQueued = true; bot.jump = false; }
  } else {
    let ix = 0, iz = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
    ix += touch.x; iz += touch.y;
    mx = -ix; mz = iz;
    sprint = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(touch.x, touch.y) > 0.92;
  }
  const len = Math.hypot(mx, mz);
  if (len > 1) { mx /= len; mz /= len; }
  const speed = BAL.MoveSpeed * S.mods.speed * (sprint ? BAL.SprintMultiplier : 1);

  if (P.stun > 0) P.stun -= dt;
  else {
    const step = BAL.Acceleration * dt;
    P.vel.x = approach(P.vel.x, mx * speed, step);
    P.vel.z = approach(P.vel.z, mz * speed, step);
  }
  if (len > 0.1) P.yaw = Math.atan2(mx, mz);

  // ジャンプ（コヨーテタイムと先行入力）
  const jumpV = jumpVelocity(BAL.JumpHeight * S.mods.jump, BAL.Gravity);
  P.sinceGround = P.grounded ? 0 : P.sinceGround + dt;
  if (P.grounded) P.airJumps = S.mods.airJumps;
  if (jumpQueued) P.sinceJump = 0; else P.sinceJump += dt;
  if (P.sinceJump <= BAL.JumpBufferTime && P.sinceGround <= BAL.CoyoteTime) {
    P.vel.y = jumpV; P.sinceJump = 9; P.sinceGround = 9;
  } else if (jumpQueued && P.sinceGround > BAL.CoyoteTime && P.airJumps > 0) {
    P.vel.y = jumpV * 0.92; P.airJumps--; P.sinceJump = 9; P.squash = -0.25;
  }
  jumpQueued = false;

  P.vel.y = Math.max(-BAL.MaxFallSpeed, P.vel.y + BAL.Gravity * dt);

  // 動く足場に立っていたら、足場のこのフレームの移動量だけ運ぶ（速度には足さない）
  if (P.grounded && P.groundPlat && P.groundPlat.lift) {
    const l = P.groundPlat.lift;
    if (l.axis === 'x') P.pos.x += l.delta; else P.pos.z += l.delta;
  }

  // 移動と衝突
  collectBoxes();
  const wasGrounded = P.grounded;
  P.grounded = false; P.ground = null; P.groundPlat = null;
  P.pos.x += P.vel.x * dt; resolve('x', P.vel.x);
  P.pos.z += P.vel.z * dt; resolve('z', P.vel.z);
  const vy = P.vel.y;
  P.pos.y += P.vel.y * dt; resolve('y', vy);
  if (P.ground) P.groundPlat = P.ground.plat;
  if (P.grounded && !wasGrounded && vy < -6) P.squash = 0.25;
  if (P.groundPlat && P.groundPlat.crumble && P.groundPlat.state === 'idle') {
    P.groundPlat.state = 'shaking'; P.groundPlat.t = 0;
  }

  // 回転バー
  for (const r of rooms) {
    const o = r.origin;
    for (const b of r.bars) {
      const px = o.x + b.x, pz = o.z + b.z, py = o.y + b.top + BAL.BarArmHeight;
      if (P.pos.y > py + BAL.BarHitHalfHeight || P.pos.y + H < py - BAL.BarHitHalfHeight) continue;
      const dx = Math.cos(b.angle), dz = -Math.sin(b.angle);
      const rx = P.pos.x - px, rz = P.pos.z - pz;
      const t = Math.max(-b.r, Math.min(b.r, rx * dx + rz * dz));
      const cx = rx - dx * t, cz = rz - dz * t;
      const dist = Math.hypot(cx, cz);
      if (dist < BAL.BarHitRadius && P.inv <= 0) {
        if (damage('hit') && phase === 'play') {
          // 回転方向に弾き飛ばす
          const sgn = Math.sign(b.speed) * Math.sign(t || 1);
          const kx = cx / (dist || 1) + -dz * sgn * 0.8, kz = cz / (dist || 1) + dx * sgn * 0.8;
          const kl = Math.hypot(kx, kz) || 1;
          const k = BAL.BarKnockbackSpeed * S.mods.knock;
          P.vel.set((kx / kl) * k, BAL.KnockbackUpSpeed * Math.max(0.5, S.mods.knock), (kz / kl) * k);
          P.stun = BAL.StunSeconds;
          showToast('<span class="d">回転バーに当たった！</span>');
        }
      }
    }
  }
  if (phase !== 'play') return;

  // 鍵
  for (const rm of rooms) {
    if (!rm.key || rm.key.got) continue;
    rm.key.mesh.getWorldPosition(keyWorld);
    const d = Math.hypot(keyWorld.x - P.pos.x, keyWorld.y - (P.pos.y + 0.8), keyWorld.z - P.pos.z);
    if (d < S.mods.keyRadius) {
      rm.key.got = true;
      rm.key.mesh.visible = false;
      rm.door.opened = true;
      showToast('<b>鍵を取った！</b> 出口の扉が開いた');
    }
  }

  // 出口（1部屋につき1回だけ）
  const room = cur();
  const o = room.group.position;
  if (!room.exited && room.appear >= 1 && Math.abs(P.pos.x - o.x) < EXIT_TRIGGER.halfWidth &&
      P.pos.z - o.z > EXIT_TRIGGER.minZ && P.pos.y - o.y > EXIT_TRIGGER.minY) onExit();

  // 落下
  if (phase === 'play' && isFalling(P.pos.y, cur().origin.y + ENTRANCE.y, BAL.FallRespawnDepth)) {
    const hit = damage('fall');
    if (phase === 'play') {
      respawn();
      if (hit) showToast(S.mods.ukemi ? '<b>受け身！</b> 落下ダメージなし' : '<span class="d">落ちた！</span> 入口に戻る');
    }
  }

  if (P.inv > 0) P.inv -= dt;
}

// ===== 見た目（カメラ・空・プレイヤーの動き） =====
const CAM_OFFSET = new THREE.Vector3(0, BAL.CameraOffsetY, BAL.CameraOffsetZ);
const LOOK_OFFSET = new THREE.Vector3(0, 1, 4);
const camGoal = new THREE.Vector3();
const lookAt = new THREE.Vector3();
let skyFloor = -1;
function animate(dt) {
  heroModel.position.copy(P.pos);
  let dy = P.yaw - hero.rotation.y;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  hero.rotation.y += dy * Math.min(1, dt * 14);
  P.squash *= Math.pow(0.0001, dt);
  hero.scale.set(1 + P.squash * 0.5, 1 - P.squash, 1 + P.squash * 0.5);
  hero.visible = !(P.inv > 0 && Math.floor(P.inv * 14) % 2 === 0);

  // カメラ（後方上空からジオラマを見下ろす）
  camGoal.copy(P.pos).add(CAM_OFFSET);
  camera.position.lerp(camGoal, 1 - Math.exp(-dt * 5));
  lookAt.copy(P.pos).add(LOOK_OFFSET);
  camera.lookAt(lookAt);
  if (shake > 0) {
    shake -= dt;
    // ハーネス中は画像が揺れないよう、揺れは乱数でなく時間で決める
    const n = HARNESS ? Math.sin(S.runTime * 97) : Math.random() - 0.5;
    camera.position.x += n * shake * 0.8;
    camera.position.y += (HARNESS ? Math.cos(S.runTime * 89) : Math.random() - 0.5) * shake * 0.8;
  }

  sun.position.copy(P.pos).add(tmpV.set(7, 16, -5));
  sun.target.position.copy(P.pos).add(tmpV.set(0, 0, 4));

  // 上のフロアほど夕方 → 夜
  if (S.floor !== skyFloor) {
    skyFloor = S.floor;
    const t = (S.floor - 1) / (BAL.TowerFloorCount - 1);
    if (t < 0.55) skyTarget.copy(SKY[0]).lerp(SKY[1], t / 0.55);
    else skyTarget.copy(SKY[1]).lerp(SKY[2], (t - 0.55) / 0.45);
  }
  skyColor.lerp(skyTarget, 1 - Math.exp(-dt * 1.5));
  const night = Math.max(0, (S.floor - 11) / 9);
  sun.intensity = (0.85 - night * 0.45) * LIGHT;
  hemi.intensity = (0.7 - night * 0.25) * LIGHT;

  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.remove('show');
  }
}

// 1ステップ分ゲームを進める
function tick(dt) {
  if (phase === 'play') {
    if (freeze > 0) freeze -= dt;
    else update(dt);
  } else if (phase === 'title') {
    // タイトル画面の背景: 部屋の仕掛けだけ動かす
    for (const r of rooms) for (const b of r.bars) { b.angle += b.speed * dt; b.pivot.rotation.y = b.angle; }
  }
  animate(dt);
}

let shownTime = '';
function draw() {
  renderer.render(scene, camera);
  const txt = S.roomTime.toFixed(1);
  if (txt !== shownTime) {
    shownTime = txt;
    const rt = $('roomTime');
    rt.innerHTML = txt + '<small>s</small>';
    rt.classList.toggle('late', S.roomTime > BAL.RoomParTime);
  }
}

const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.4-4.5-9.4-9C1.1 8.2 3.2 4.5 6.8 4.5c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.6 0 5.7 3.7 4.2 7-2 4.5-9.4 9-9.4 9z"/></svg>';
function updateHud() {
  $('floorNum').textContent = S.floor;
  document.querySelector('.floor .of').textContent = '/ ' + BAL.TowerFloorCount;
  const h = $('hearts');
  h.innerHTML = '';
  for (let i = 0; i < S.maxHp; i++) {
    const s = document.createElement('span');
    s.className = i < S.hp ? 'on' : 'off';
    s.innerHTML = HEART;
    h.appendChild(s);
  }
  h.setAttribute('aria-label', `HP ${S.hp} / ${S.maxHp}`);
  $('ups').innerHTML = S.owned.map((u) => `<span class="chip">${u}</span>`).join('');
  document.querySelector('.par').textContent = `目安 ${BAL.RoomParTime}s`;
}

// ===== オーバーレイ =====
const overlay = $('overlay');
function show(html) { overlay.innerHTML = html; overlay.hidden = false; }
function hide() { overlay.hidden = true; overlay.innerHTML = ''; }

function titleScreen() {
  phase = 'title';
  show(`
    <div class="card" role="dialog" aria-labelledby="t">
      <div class="tower-mark" aria-hidden="true">
        <i style="height:20%"></i><i style="height:35%"></i><i class="r" style="height:50%"></i><i style="height:65%"></i><i class="y" style="height:80%"></i><i style="height:100%"></i>
      </div>
      <span class="eyebrow">PROTOTYPE · 1 ROOM = 1 FLOOR</span>
      <h1 id="t">ワンルームタワー</h1>
      <p>1部屋30秒。毎回ちがう仕掛けの部屋を抜けて、出口のゲートをくぐると次の部屋がせり上がってくる。HP ${BAL.PlayerMaxHp} で ${BAL.TowerFloorCount}F の最上階を目指す。</p>
      <div class="legend">
        <div><span class="sw" style="background:#e5484d"></span>赤 = 危険（回転バー）</div>
        <div><span class="sw" style="background:#d6b88f"></span>茶 = 乗ると崩れる床</div>
        <div><span class="sw" style="background:#f5c518"></span>黄 = 目標（出口・鍵）</div>
        <div><span class="sw" style="background:#eef1f7"></span>白 = 足場</div>
      </div>
      <div class="keys">
        <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span><span>移動（矢印キーでも可）</span>
        <span><kbd>Space</kbd></span><span>ジャンプ（端から少し遅れても跳べる）</span>
        <span><kbd>Shift</kbd></span><span>押している間ダッシュ</span>
        <span><kbd>R</kbd></span><span>最初からやり直す</span>
      </div>
      <button class="btn" id="go" type="button">塔に入る <small>Enter</small></button>
      <p class="note">Unity 版（games/one-room-tower）の GDD と GameBalance の数値を使った、ブラウザ用の手触り確認版です。${BAL.RestFloorInterval}F ごとの休憩部屋で強化を1つ選べます。</p>
    </div>`);
  $('go').addEventListener('click', () => start());
  $('go').focus();
}

function start(seed = 0) {
  hide();
  newRun(seed);
  phase = 'play';
}

let choices = [];
function openChoice() {
  phase = 'choose';
  choices = upgradeChoices(UPGRADES, S.owned, rng, BAL.UpgradeChoiceCount);
  const nextRest = Math.min(S.floor + BAL.RestFloorInterval, BAL.TowerFloorCount);
  show(`
    <div class="card" role="dialog" aria-labelledby="c">
      <span class="eyebrow">${S.floor}F · 休憩部屋</span>
      <h2 id="c">強化を1つ選ぶ</h2>
      <p>このランの間だけ有効。次の休憩は ${nextRest}F${nextRest >= BAL.TowerFloorCount ? '（最上階）' : ''}。</p>
      <div class="picks">
        ${choices.map((u, i) => `<button class="pick" type="button" data-i="${i}"><span class="k">${i + 1}</span><span class="n">${u.name}</span><span class="d">${u.desc}</span></button>`).join('')}
      </div>
    </div>`);
  overlay.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => choose(+b.dataset.i)));
  overlay.querySelector('.pick').focus();
}
function choose(i) {
  const u = choices[i];
  if (!u || phase !== 'choose') return;
  u.apply(S);
  S.owned.push(u.name);
  updateHud();
  hide();
  keys.clear();
  phase = 'play';
  showToast(`<b>${u.name}</b> を手に入れた`);
}

function fmt(t) {
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
}
function results(kind) {
  const win = kind === 'clear';
  show(`
    <div class="card" role="dialog" aria-labelledby="r">
      <span class="eyebrow">${win ? 'CLEAR' : 'GAME OVER'} · SEED ${S.seed}</span>
      <h2 id="r">${win ? `${BAL.TowerFloorCount}F 踏破！` : `${S.floor}F で力尽きた`}</h2>
      <p>${win ? '最上階の扉をくぐった。もう一度、別の並びの塔に挑戦できる。' : 'ランは 1F からやり直し。部屋の並びと仕掛けは毎回変わる。'}</p>
      <div class="stats">
        <div><span class="v">${S.floor}F</span><span class="l">到達フロア</span></div>
        <div><span class="v">${fmt(S.runTime)}</span><span class="l">タイム</span></div>
        <div><span class="v">${S.falls} / ${S.hits}</span><span class="l">落下 / 被弾</span></div>
      </div>
      ${S.owned.length ? `<p class="note">強化: ${S.owned.join('・')}</p>` : ''}
      <button class="btn" id="again" type="button">もう一度登る <small>Enter</small></button>
    </div>`);
  $('again').addEventListener('click', () => start());
  $('again').focus();
}
function gameOver() { logRoom(cur(), false); phase = 'over'; results('over'); }
function finish() { phase = 'clear'; results('clear'); }

// ===== ループ =====
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 68 : 55;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// manual = true の間は、時間は step() でだけ進む（ハーネスの自動操縦を毎回同じ結果にするため）
let manual = false;
let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!manual) tick(dt);
  draw();
  requestAnimationFrame(loop);
}

// 自動操縦・検証用に、今いる部屋の形をワールド座標で返す
function world() {
  const plats = [];
  for (const r of rooms) {
    const o = r.origin;
    for (const p of r.plats) {
      plats.push({ id: p.id, floor: r.n, minX: o.x + p.min.x, maxX: o.x + p.max.x, minZ: o.z + p.min.z, maxZ: o.z + p.max.z,
        top: o.y + p.max.y, crumble: p.crumble, state: p.state, solid: p.state !== 'falling' && p.state !== 'gone',
        moving: !!p.lift,
        lift: p.lift ? { axis: p.lift.axis, dist: p.lift.dist, period: p.lift.period, pause: BAL.LiftEndPauseSeconds, off: p.lift.off, t: r.t } : null });
    }
  }
  const r = cur();
  const o = r.origin;
  const key = r.key && !r.key.got ? (r.key.mesh.getWorldPosition(keyWorld), { x: keyWorld.x, y: keyWorld.y, z: keyWorld.z }) : null;
  const bars = r.bars.map((b) => ({ x: o.x + b.x, z: o.z + b.z, top: o.y + b.top, r: b.r, angle: b.angle, speed: b.speed }));
  return {
    floor: r.n, appeared: r.appear >= 1, layout: r.layout.name, gimmicks: r.gimmicks.slice(),
    origin: { x: o.x, y: o.y, z: o.z },
    exit: { x: o.x, z: o.z + (EXIT_TRIGGER.minZ + BAL.RoomSize) / 2, y: o.y + BAL.RoomRiseHeight },
    key, bars, plats,
    player: { x: P.pos.x, y: P.pos.y, z: P.pos.z, vx: P.vel.x, vy: P.vel.y, vz: P.vel.z, grounded: P.grounded,
      ground: P.groundPlat ? P.groundPlat.id : null, inv: P.inv, stun: P.stun },
    jumpHeight: BAL.JumpHeight * S.mods.jump, speed: BAL.MoveSpeed * S.mods.speed * BAL.SprintMultiplier,
    airJumps: S.mods.airJumps,
  };
}

// ゲームスタジオのハーネス（harness/run.mjs）用の入口
window.__game = {
  state: S,
  ui: { talking: false, get modal() { return phase === 'choose'; } },
  phase: () => phase,
  act: () => (phase === 'choose' ? choose(0) : phase === 'play' ? (jumpQueued = true) : start()),
  // (x, y, z) にプレイヤーを置く（撮影用）。カメラもすぐ追いつかせる
  look: (x, y, z) => {
    P.pos.set(x, y, z);
    P.vel.set(0, 0, 0);
    camera.position.copy(P.pos).add(CAM_OFFSET);
  },
  focus: () => null,
  renderer,
  render: () => renderer.render(scene, camera),
  start: (seed) => start(seed),
  startSelector: '#go',
  ready: () => phase === 'title',
  // 自動操縦
  manual: (on = true) => { manual = on; },
  step: (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); },
  input: (x, z, sprint = true, jump = false) => { bot = { x, z, sprint, jump: jump || (bot && bot.jump) }; },
  release: () => { bot = null; },
  choose: (i) => choose(i),
  world,
  debug,
  bal: BAL,
  constants: { radius: R, height: H, coyote: BAL.CoyoteTime },
};

// タイトル背景用に1ラン分を用意しておく（2F まで見えるように）。看板の字体が読み込まれてから作る
(async () => {
  await document.fonts.load('64px "Dela Gothic One"').catch(() => {});
  newRun();
  const r2 = spawnRoom(false);
  r2.appear = 1;
  r2.group.position.y = r2.origin.y;
  P.pos.set(0, 0, 1);
  titleScreen();
  requestAnimationFrame(loop);
})();
