// Unity 版タスク（docs/tasks/2026-10-15-room-loop.md）の完了条件と同じテストを Web 版のロジックにも書く
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAL, GIMMICK_COST } from '../src/balance.js';
import { LAYOUTS, REST, UPGRADES } from '../src/data.js';
import {
  mulberry32, makePicker, nextOrigin, exitLocal, entranceAnchor, isFalling, isRestFloor,
  difficultyBudget, chooseGimmicks, gimmickCandidates, upgradeChoices, FloorCounter, approach,
  roomStandard, samePlat, liftOffset, barAngularSpeed, fallDamage,
} from '../src/logic.js';

test('RoomPlacement: 生成位置 + Entrance のローカル位置 = 前の Exit の位置', () => {
  const exit = { x: 1, y: 6, z: 32 };
  const ent = { x: 0.5, y: 0, z: 1 };
  const o = nextOrigin(exit, ent);
  assert.deepEqual({ x: o.x + ent.x, y: o.y + ent.y, z: o.z + ent.z }, exit);
});

test('RoomPlacement: 規格どおりなら次の原点は RoomRiseHeight 高く、+Z に RoomSize 進む', () => {
  const ex = exitLocal(BAL);
  const o = nextOrigin({ x: ex.x, y: ex.y, z: ex.z }, entranceAnchor);
  assert.deepEqual(o, { x: 0, y: BAL.RoomRiseHeight, z: BAL.RoomSize });
});

test('RoomPicker: 同じシードなら同じ並び', () => {
  const a = makePicker(mulberry32(42), 4);
  const b = makePicker(mulberry32(42), 4);
  const sa = Array.from({ length: 20 }, a);
  const sb = Array.from({ length: 20 }, b);
  assert.deepEqual(sa, sb);
});

test('RoomPicker: 直前と同じレイアウトは出ない・全レイアウトが出る', () => {
  const p = makePicker(mulberry32(7), LAYOUTS.length);
  let last = -1;
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const n = p();
    assert.ok(n >= 0 && n < LAYOUTS.length);
    assert.notEqual(n, last);
    seen.add(n);
    last = n;
  }
  assert.equal(seen.size, LAYOUTS.length);
});

test('RoomPicker: レイアウト1種類なら常に 0', () => {
  const p = makePicker(mulberry32(1), 1);
  for (let i = 0; i < 10; i++) assert.equal(p(), 0);
});

test('FloorCounter: 1 から始まり advance で +1', () => {
  const f = new FloorCounter();
  assert.equal(f.floor, 1);
  assert.equal(f.advance(), 2);
});

test('落下判定: 境界の前後で切り替わる', () => {
  assert.equal(isFalling(3 - 6.01, 3, 6), true);
  assert.equal(isFalling(3 - 5.99, 3, 6), false);
});

test('休憩部屋は 5F ごと、最上階は除く', () => {
  const rest = [];
  for (let n = 1; n <= BAL.TowerFloorCount; n++) if (isRestFloor(n, BAL)) rest.push(n);
  assert.deepEqual(rest, [5, 10, 15]);
});

test('強化候補: 重ねられない強化は持っていたら出ない', () => {
  const owned = UPGRADES.filter((u) => !u.stack).map((u) => u.name);
  for (let i = 0; i < 20; i++) {
    const c = upgradeChoices(UPGRADES, owned, mulberry32(i), BAL.UpgradeChoiceCount);
    assert.ok(c.every((u) => u.stack));
    assert.equal(new Set(c.map((u) => u.id)).size, c.length);
  }
});

test('approach: 1 ステップで最大 step だけ近づく', () => {
  assert.equal(approach(0, 10, 1), 1);
  assert.equal(approach(0, 0.5, 1), 0.5);
  assert.equal(approach(0, -10, 1), -1);
});


const STD = roomStandard(BAL);
const near = (a, b) => Math.abs(a - b) < 1e-9;
const ALL = [...LAYOUTS, REST];

test('規格: RoomSize 16 なら旧の値と一致する', () => {
  const s = roomStandard({ ...BAL, RoomSize: 16 });
  assert.deepEqual(s.exitPlat, [0, 13, 16, 6, 3]);
  assert.ok(near(s.gateZ, 15.8) && near(s.doorZ, 13.6) && near(s.trigger.minZ, 14.6) && near(s.trigger.minY, 2.9));
});

test('規格: RoomSize 24 の出口まわり', () => {
  assert.deepEqual(STD.exitPlat, [0, 21, 24, 6, 3]);
  assert.ok(near(STD.gateZ, 23.8) && near(STD.doorZ, 21.6) && near(STD.trigger.minZ, 22.6));
  assert.ok(STD.doorZ >= STD.exitPlat[1] && STD.doorZ <= STD.exitPlat[2] && STD.doorZ < STD.trigger.minZ);
});

test('規格: 次の部屋の原点は +Z に RoomSize・上に RoomRiseHeight', () => {
  const ex = exitLocal(BAL);
  assert.deepEqual(nextOrigin(ex, entranceAnchor), { x: 0, y: BAL.RoomRiseHeight, z: BAL.RoomSize });
});

test('レイアウト: 5 種以上あり、どれも入口の床と規格どおりの出口の床を持つ', () => {
  assert.ok(LAYOUTS.length >= 5);
  for (const l of ALL) {
    assert.ok(l.plats.some((p) => p[1] === 0 && p[4] === 0), `${l.name} に入口の床がない`);
    assert.ok(l.plats.some((p) => samePlat(p, STD.exitPlat)), `${l.name} に出口の床がない`);
  }
});

test('レイアウト: すべての床が部屋の範囲内で、出口以外は z1 ≤ RoomSize - ExitFloorDepth', () => {
  const S = BAL.RoomSize;
  const chk = (name, p) => {
    const [x, z0, z1, w] = p;
    assert.ok(x - w / 2 >= -S / 2 - 1e-9 && x + w / 2 <= S / 2 + 1e-9 && z0 >= 0 && z1 <= S, `${name} ${p}`);
    if (!samePlat(p, STD.exitPlat)) assert.ok(z1 <= S - BAL.ExitFloorDepth + 1e-9, `${name} ${p}`);
  };
  for (const l of ALL) {
    l.plats.forEach((p) => chk(l.name, p));
    for (const f of l.lifts || []) {
      f.static.forEach((p) => chk(l.name, p));
      chk(l.name, liftBox(f, 0)); chk(l.name, liftBox(f, f.dist));
    }
  }
});

// 動く足場の始点から offset 動いた位置の床定義
function liftBox(f, off) {
  return f.axis === 'x' ? [f.x + off, f.z0, f.z1, f.w, f.top] : [f.x, f.z0 + off, f.z1 + off, f.w, f.top];
}
// 動く足場の移動範囲全体
function liftSweep(f) {
  const a = liftBox(f, 0), b = liftBox(f, f.dist);
  const x0 = Math.min(a[0] - a[3] / 2, b[0] - b[3] / 2), x1 = Math.max(a[0] + a[3] / 2, b[0] + b[3] / 2);
  return [(x0 + x1) / 2, Math.min(a[1], b[1]), Math.max(a[2], b[2]), x1 - x0, f.top];
}
const rect = (p) => ({ x0: p[0] - p[3] / 2, x1: p[0] + p[3] / 2, z0: p[1], z1: p[2], top: p[4] });
const gapOf = (a, b) => Math.hypot(Math.max(a.x0 - b.x1, b.x0 - a.x1, 0), Math.max(a.z0 - b.z1, b.z0 - a.z1, 0));
const overlapXZ = (a, b) => a.x0 < b.x1 - 1e-9 && b.x0 < a.x1 - 1e-9 && a.z0 < b.z1 - 1e-9 && b.z0 < a.z1 - 1e-9;

test('レイアウト: 床どうし（動く足場の移動範囲・代わりの床を含む）が xz で重ならない', () => {
  for (const l of ALL) {
    for (const withLift of [true, false]) {
      const list = l.plats.map(rect);
      for (const f of l.lifts || []) {
        if (withLift) list.push(rect(liftSweep(f)));
        else f.static.forEach((p) => list.push(rect(p)));
      }
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        assert.ok(!overlapXZ(list[i], list[j]), `${l.name} lift=${withLift}: ${i} と ${j} が重なる`);
      }
    }
  }
});

function canStep(a, b) {
  const g = gapOf(a, b), dh = b.top - a.top;
  if (dh > 1e-9) return dh <= 1.0 + 1e-9 && g <= 2.4 + 1e-9 && (dh <= 0.6 + 1e-9 || g <= 1.6 + 1e-9);
  return g <= 2.4 + 1e-9;
}
// 入口から届く床の集合（幅優先）。nodes: rect の配列、lifts は両端の2つのノードとして入れる
function reachable(nodes, startIdx) {
  const seen = new Set([startIdx]), q = [startIdx];
  while (q.length) {
    const u = q.shift();
    nodes.forEach((n, v) => { if (!seen.has(v) && canStep(nodes[u], n)) { seen.add(v); q.push(v); } });
  }
  return seen;
}
function graphs(l) {
  const out = [];
  for (const withLift of [true, false]) {
    const nodes = l.plats.map(rect);
    for (const f of l.lifts || []) {
      if (withLift) { nodes.push(rect(liftBox(f, 0)), rect(liftBox(f, f.dist))); }
      else f.static.forEach((p) => nodes.push(rect(p)));
    }
    out.push({ withLift, nodes });
  }
  return out;
}

test('レイアウト: 動く足場あり・なしの両方で入口から出口へ届く', () => {
  for (const l of ALL) for (const { withLift, nodes } of graphs(l)) {
    const s = l.plats.findIndex((p) => p[1] === 0 && p[4] === 0);
    const e = l.plats.findIndex((p) => samePlat(p, STD.exitPlat));
    assert.ok(reachable(nodes, s).has(e), `${l.name} lift=${withLift}: 出口に届かない`);
  }
});

test('レイアウト: 鍵があれば、鍵の位置まで届き、鍵は床の上面 + 0.8m にある', () => {
  for (const l of LAYOUTS) {
    if (!l.key) continue;
    const [kx, ky, kz] = l.key;
    const idx = l.plats.findIndex((p) => { const r = rect(p); return kx >= r.x0 && kx <= r.x1 && kz >= r.z0 && kz <= r.z1 && near(ky, p[4] + 0.8); });
    assert.ok(idx >= 0, `${l.name}: 鍵が床の上面 + 0.8 にない`);
    for (const { withLift, nodes } of graphs(l)) {
      const s = l.plats.findIndex((p) => p[1] === 0 && p[4] === 0);
      assert.ok(reachable(nodes, s).has(idx), `${l.name} lift=${withLift}: 鍵に届かない`);
    }
  }
});

test('レイアウト: 回転バーの軸は同じ高さの床の上にあり、円が高さの違う床と重ならず、バーどうしの円も重ならない', () => {
  const circleHits = (b, r, m) => {
    const cx = Math.max(r.x0, Math.min(b.x, r.x1)), cz = Math.max(r.z0, Math.min(b.z, r.z1));
    return Math.hypot(b.x - cx, b.z - cz) < b.r + m;
  };
  for (const l of LAYOUTS) {
    const bars = l.bars || [];
    bars.forEach((b, i) => {
      const onFloor = l.plats.some((p) => { const r = rect(p); return near(p[4], b.top) && b.x >= r.x0 && b.x <= r.x1 && b.z >= r.z0 && b.z <= r.z1; });
      assert.ok(onFloor, `${l.name} bar${i}: 軸が同じ高さの床の上にない`);
      const others = l.plats.filter((p) => Math.abs(p[4] - b.top) > 0.05).map(rect);
      for (const f of l.lifts || []) { others.push(...f.static.filter((p) => Math.abs(p[4] - b.top) > 0.05).map(rect)); if (Math.abs(f.top - b.top) > 0.05) others.push(rect(liftSweep(f))); }
      for (const r of others) assert.ok(!circleHits(b, r, BAL.BarClearance), `${l.name} bar${i}: 円が高さの違う床と重なる`);
      for (let j = i + 1; j < bars.length; j++) assert.ok(Math.hypot(b.x - bars[j].x, b.z - bars[j].z) >= b.r + bars[j].r, `${l.name} bar${i}/${j}: 円が重なる`);
    });
  }
});

test('レイアウト: 動く足場の両端で、隣の床との隙間が同じ高さなら 0.1 以上・違う高さなら 0.7 以上', () => {
  for (const l of LAYOUTS) for (const f of l.lifts || []) {
    for (const off of [0, f.dist]) {
      const a = rect(liftBox(f, off));
      for (const p of l.plats) {
        const r = rect(p);
        const g = gapOf(a, r);
        if (g > 1.5) continue; // 近い床だけ見る
        // 動く足場と同じ範囲で並走する床（接して並ぶ床）だけでなく、すべての近い床で
        const min = Math.abs(r.top - a.top) < 0.05 ? 0.1 : 0.7;
        if (overlapXZ(a, r)) continue;
        assert.ok(g >= min - 1e-9, `${l.name} off=${off}: 隙間 ${g.toFixed(2)} < ${min}`);
      }
    }
  }
});

test('仕掛け: 候補はスロット単位（バーの本数・崩れる床のグループ数・鍵・動く足場の台数）', () => {
  const count = (l) => { const c = gimmickCandidates(l); const n = (t) => c.filter((x) => x.type === t).length; return [n('bar'), n('crumble'), n('key'), n('lift')]; };
  assert.deepEqual(count(LAYOUTS[0]), [3, 1, 1, 1]);
  assert.deepEqual(count(LAYOUTS[1]), [3, 2, 1, 1]);
  assert.deepEqual(count(LAYOUTS[2]), [2, 3, 1, 0]);
  assert.deepEqual(count(LAYOUTS[3]), [3, 1, 1, 1]);
  assert.deepEqual(count(LAYOUTS[4]), [3, 1, 1, 0]);
  assert.deepEqual(gimmickCandidates(LAYOUTS[0]).find((c) => c.type === 'crumble'), { type: 'crumble', slot: 'c1' });
});

test('仕掛け: 1F と休憩部屋はなし、それ以外は 1 個以上・個数・種類・バー・予算を守る', () => {
  assert.deepEqual(chooseGimmicks(1, LAYOUTS[0], mulberry32(3), BAL, GIMMICK_COST), []);
  assert.deepEqual(chooseGimmicks(5, REST, mulberry32(3), BAL, GIMMICK_COST), []);
  for (let n = 2; n <= 20; n++) for (const l of LAYOUTS) for (let seed = 1; seed <= 20; seed++) {
    const g = chooseGimmicks(n, l, mulberry32(seed), BAL, GIMMICK_COST);
    const tag = `${n}F ${l.name} seed${seed}`;
    assert.ok(g.length >= 1 && g.length <= BAL.MaxGimmicksPerRoom, tag);
    assert.ok(new Set(g.map((x) => x.type)).size <= BAL.MaxGimmickTypesPerRoom, tag);
    assert.ok(g.filter((x) => x.type === 'bar').length <= BAL.MaxBarsPerRoom, tag);
    assert.equal(new Set(g.map((x) => x.type + x.slot)).size, g.length, tag);
    if (g.length > 1) assert.ok(g.reduce((s, x) => s + GIMMICK_COST[x.type], 0) <= difficultyBudget(n, BAL) + 1e-9, tag);
  }
});

test('仕掛け: 同じシードなら同じ結果', () => {
  for (const l of LAYOUTS) assert.deepEqual(chooseGimmicks(12, l, mulberry32(9), BAL, GIMMICK_COST), chooseGimmicks(12, l, mulberry32(9), BAL, GIMMICK_COST));
});

test('仕掛け: 19F では 3 個以上置かれる部屋がある', () => {
  let found = false;
  for (const l of LAYOUTS) for (let seed = 1; seed <= 20; seed++) if (chooseGimmicks(19, l, mulberry32(seed), BAL, GIMMICK_COST).length >= 3) found = true;
  assert.ok(found);
});

test('動く足場: liftOffset は t=0 で 0、period/2 で dist、両端で止まり、period で 0 に戻る', () => {
  const P = 5, D = 4, W = BAL.LiftEndPauseSeconds;
  assert.equal(liftOffset(0, P, D, W), 0);
  assert.equal(liftOffset(W - 0.01, P, D, W), 0);
  assert.ok(liftOffset(W + 0.3, P, D, W) > 0);
  assert.ok(near(liftOffset(P / 2, P, D, W), D));
  assert.ok(near(liftOffset(P / 2 + W - 0.01, P, D, W), D));
  assert.ok(liftOffset(P / 2 + W + 0.3, P, D, W) < D);
  assert.ok(near(liftOffset(P, P, D, W), 0));
  assert.ok(near(liftOffset(P / 4 + W / 2, P, D, W), D / 2));
  assert.ok(near(liftOffset(P * 3 + 1, P, D, W), liftOffset(1, P, D, W)));
});

test('回転バー: 先端速度は 2F で 3.15、上限 5.0 で止まり、角速度は BarAngularSpeedMax を超えない', () => {
  assert.ok(near(barAngularSpeed(2, 3, BAL) * 3, 3.15));
  assert.ok(near(barAngularSpeed(40, 3, BAL) * 3, BAL.BarTipSpeedMax));
  for (let n = 1; n <= 40; n++) for (const r of [0.5, 1, 1.4, 2.5, 4]) assert.ok(barAngularSpeed(n, r, BAL) <= BAL.BarAngularSpeedMax + 1e-9);
});

test('回転バー: 半径が違っても、同じフロアなら先端速度が同じ', () => {
  const tips = [2, 2.5, 3].map((r) => barAngularSpeed(10, r, BAL) * r);
  tips.forEach((t) => assert.ok(near(t, tips[0])));
});

test('落下ダメージ: 無敵時間が残っていれば 0、切れていれば 1', () => {
  assert.equal(fallDamage(0.5), 0);
  assert.equal(fallDamage(0), 1);
  assert.equal(fallDamage(-0.1), 1);
});
