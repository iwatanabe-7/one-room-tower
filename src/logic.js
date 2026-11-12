// 描画に依存しない純粋なロジック（node --test でテストする）
// Unity 版の RoomPlacement / RoomPicker / FloorCounter / 落下判定に対応する

// シード付き乱数（0〜1）
export function mulberry32(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// RoomPicker: 次のレイアウト番号。直前と同じ番号は返さない（1種類なら常に 0）
export function makePicker(rng, count) {
  let last = -1;
  return () => {
    if (count <= 1) return 0;
    let n = Math.floor(rng() * (last >= 0 ? count - 1 : count));
    if (last >= 0 && n >= last) n++;
    last = n;
    return n;
  };
}

// RoomPlacement: 前の部屋の Exit のワールド位置と、新しい部屋の Entrance のローカル位置から、新しい部屋の原点を出す
export function nextOrigin(prevExitWorld, entranceLocal) {
  return { x: prevExitWorld.x - entranceLocal.x, y: prevExitWorld.y - entranceLocal.y, z: prevExitWorld.z - entranceLocal.z };
}

// 規格どおりの部屋の Exit（ローカル）: +Z の壁際、RoomRiseHeight 高い所
export const exitLocal = (bal) => ({ x: 0, y: bal.RoomRiseHeight, z: bal.RoomSize });
// 規格どおりの部屋どうしをつなぐときの、入口側の接続点（ローカル原点）
export const entranceAnchor = { x: 0, y: 0, z: 0 };

// 落下判定: 入口の高さから depth 以上下にいれば落下
export const isFalling = (y, entranceY, depth) => y < entranceY - depth;

export const isRestFloor = (n, bal) => n % bal.RestFloorInterval === 0 && n < bal.TowerFloorCount;

export const difficultyBudget = (n, bal) => bal.DifficultyBudgetBase + bal.DifficultyBudgetPerFloor * (n - 1);

// 部屋の規格から計算する位置（S = RoomSize）。出口まわりの直書きはここに集める
export function roomStandard(bal) {
  const S = bal.RoomSize, W = bal.ExitFloorWidth;
  return {
    exitPlat: [0, S - bal.ExitFloorDepth, S, W, bal.RoomRiseHeight],
    gateZ: S - bal.ExitGateInset,
    gatePostX: W / 2 + 0.1,
    doorZ: S - bal.ExitDoorInset,
    doorHalfWidth: W / 2,
    trigger: { halfWidth: W / 2, minZ: S - bal.ExitTriggerInset, minY: bal.RoomRiseHeight - bal.ExitTriggerYSlack },
    entrance: { x: 0, y: 0, z: 1 },
  };
}

// 床の定義が同じか（参照ではなく値で比べる）
export const samePlat = (a, b) => a.length >= 5 && b.length >= 5 && [0, 1, 2, 3, 4].every((i) => a[i] === b[i]);

// その部屋に置ける仕掛けの候補（スロット単位）: { type, slot }
export function gimmickCandidates(layout) {
  const out = [];
  (layout.bars || []).forEach((_, i) => out.push({ type: 'bar', slot: i }));
  const tags = [];
  for (const p of layout.plats) if (p[5] && !tags.includes(p[5])) tags.push(p[5]);
  for (const t of tags) out.push({ type: 'crumble', slot: t });
  if (layout.key) out.push({ type: 'key', slot: 0 });
  (layout.lifts || []).forEach((_, i) => out.push({ type: 'lift', slot: i }));
  return out;
}

// 難易度予算の範囲でスロットを選ぶ。1F と休憩部屋は仕掛けなし。何も選べなければ一番軽い候補を1つ
export function chooseGimmicks(n, layout, rng, bal, cost) {
  if (layout.rest || n === 1) return [];
  let budget = difficultyBudget(n, bal);
  const cands = shuffle(gimmickCandidates(layout), rng);
  const out = [];
  const types = new Set();
  let bars = 0;
  for (const c of cands) {
    if (cost[c.type] > budget + 1e-9) continue;
    if (out.length >= bal.MaxGimmicksPerRoom) continue;
    if (!types.has(c.type) && types.size >= bal.MaxGimmickTypesPerRoom) continue;
    if (c.type === 'bar' && bars >= bal.MaxBarsPerRoom) continue;
    out.push(c);
    types.add(c.type);
    if (c.type === 'bar') bars++;
    budget -= cost[c.type];
  }
  if (!out.length && cands.length) out.push(cands.slice().sort((a, b) => cost[a.type] - cost[b.type])[0]);
  return out;
}

// 動く足場の始点からの移動量。往復1回 = period 秒、両端で pause 秒止まり、間はコサインで加減速
export function liftOffset(t, period, dist, pause) {
  const u = ((t % period) + period) % period;
  const half = period / 2;
  const move = half - pause;
  if (u < pause) return 0;
  if (u < half) return dist * (1 - Math.cos(Math.PI * ((u - pause) / move))) / 2;
  if (u < half + pause) return dist;
  return dist * (1 + Math.cos(Math.PI * ((u - half - pause) / move))) / 2;
}

// 回転バーの角速度（絶対値）。先端速度で決め、短いバーが回りすぎないよう上限をかける
export function barAngularSpeed(n, r, bal) {
  const tip = Math.min(bal.BarTipSpeedMax, bal.BarTipSpeedBase + bal.BarTipSpeedPerFloor * (n - 1));
  return Math.min(bal.BarAngularSpeedMax, tip / r);
}

// 落下ダメージ: 無敵時間が残っていれば 0
export const fallDamage = (invRemaining) => (invRemaining > 0 ? 0 : 1);

export const jumpVelocity = (height, gravity) => Math.sqrt(2 * height * -gravity);

// 速度を目標へ、1ステップ最大 step だけ近づける
export const approach = (v, target, step) => v + Math.max(-step, Math.min(step, target - v));

// 強化の候補: 重ねられないものは持っていたら除く
export function upgradeChoices(upgrades, owned, rng, count) {
  const pool = upgrades.filter((u) => u.stack || !owned.includes(u.name));
  return shuffle(pool.slice(), rng).slice(0, count);
}

// FloorCounter
export class FloorCounter {
  constructor() { this.floor = 1; }
  advance() { return ++this.floor; }
}
