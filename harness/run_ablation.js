/* 零 key 消融跑器：同一夹具、同一接战半径下比 off(baseline) / local / bridge。
   用法：node harness/run_ablation.js [--policies=off,local,bridge] [--only=id1,id2] [--json]
   桥未就绪时 bridge 列记 N/A —— 与 B2 报告 §4「零 key 不可复跑」同因，不伪造对照数字。 */
const path = require('path');
const g = globalThis;
const here = (f) => require(path.join(__dirname, '..', 'jev', f));
here('core.js'); here('policies.js'); here('questions.js'); here('client.js');
const C = g.JEVCore, Client = g.JEVClient;
const { scenarios } = require(path.join(__dirname, 'scenarios.js'));

const argv = process.argv.slice(2);
const flag = (name, dflt) => { const a = argv.find((s) => s.startsWith('--' + name + '=')); return a ? a.split('=')[1] : dflt; };
const POLICIES = flag('policies', 'off,local,bridge').split(',').filter(Boolean);
const ONLY = flag('only', '').split(',').filter(Boolean);
const AS_JSON = argv.includes('--json');
const ENDPOINT = process.env.JEV_ENDPOINT || 'http://127.0.0.1:8731/decide';

// 夹具自检：行等长、单位与玩家落在地面、八邻域可达（引擎允许斜走与切角）
function validate(sc) {
  const w = sc.build();
  const errs = [];
  if (new Set(w.map.map((r) => r.length)).size !== 1) errs.push('地图行长度不一致');
  if (!C.isFloor(w, w.player.x, w.player.y)) errs.push(`玩家 (${w.player.x},${w.player.y}) 不在地面`);
  for (const u of w.enemies) {
    if (!C.isFloor(w, u.x, u.y)) { errs.push(`${u.id} (${u.x},${u.y}) 不在地面`); continue; }
    const seen = new Set([`${u.x},${u.y}`]), q = [[u.x, u.y]];
    let hit = false;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === w.player.x && y === w.player.y) { hit = true; break; }
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const k = `${x + dx},${y + dy}`;
        if (!seen.has(k) && C.isFloor(w, x + dx, y + dy)) { seen.add(k); q.push([x + dx, y + dy]); }
      }
    }
    if (!hit) errs.push(`${u.id} 到玩家不可达`);
  }
  return { world: w, errs };
}

function movePlayer(model, w, tick) {
  if (model.kind === 'static') return;
  if (model.kind === 'patrol') { const p = model.path[tick % model.path.length]; if (C.isFloor(w, p[0], p[1]) && !w.enemies.some((e) => e.x === p[0] && e.y === p[1])) { w.player.x = p[0]; w.player.y = p[1]; } return; }
  const cur = Math.min(...w.enemies.map((e) => C.manhattan(e, w.player)));
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx = w.player.x + dx, ny = w.player.y + dy;
    if (!C.isFloor(w, nx, ny) || w.enemies.some((e) => e.x === nx && e.y === ny)) continue;
    const d = Math.min(...w.enemies.map((e) => Math.abs(e.x - nx) + Math.abs(e.y - ny)));
    if (d > cur && (!best || d > best.d)) best = { x: nx, y: ny, d };
  }
  if (best) { w.player.x = best.x; w.player.y = best.y; }
}

async function runOne(sc, mode) {
  const w = validate(sc).world;
  w.engageRadius = sc.radius;
  const client = Client.makeClient({ mode, endpoint: ENDPOINT, timeoutMs: +(process.env.JEV_TIMEOUT || 8000) });
  const m = { contactTick: null, minDist: null, stuckTicks: 0, adjacentTicks: 0, strikes: 0, suicides: 0, illegal: 0 };
  for (let tick = 1; tick <= sc.maxTicks; tick++) {
    movePlayer(sc.model, w, tick);
    const before = Math.min(...w.enemies.map((e) => C.manhattan(e, w.player)));
    for (const u of w.enemies) {
      const { action: a } = await client.decide(u, w);
      if (!a) continue;
      if (a.kind === 'strike') { m.strikes++; if (C.legalActions(u, w, {}).reflectLethal) m.suicides++; }
      else if (a.kind === 'step' && !C.applyStep(u, a, w)) m.illegal++;
    }
    const now = Math.min(...w.enemies.map((e) => C.manhattan(e, w.player)));
    if (m.minDist == null || now < m.minDist) m.minDist = now;
    if (now <= 1) { if (m.contactTick == null) m.contactTick = tick; m.adjacentTicks++; } else if (now >= before) m.stuckTicks++;
  }
  return Object.assign(m, client.summary());
}

async function bridgeAlive() {
  try { const r = await fetch(ENDPOINT.replace(/\/decide$/, '/health'), { method: 'GET' }); return r.ok ? await r.json() : false; } catch (e) { return false; }
}

(async function main() {
  const bad = [];
  for (const sc of scenarios) { const v = validate(sc); if (v.errs.length) bad.push(`${sc.id}: ${v.errs.join('; ')}`); }
  if (bad.length) { console.error('夹具自检失败：\n  ' + bad.join('\n  ')); process.exit(1); }
  const health = POLICIES.includes('bridge') ? await bridgeAlive() : false;
  const up = !!health;
  const list = ONLY.length ? scenarios.filter((s) => ONLY.includes(s.id)) : scenarios;
  const rows = [];
  for (const mode of POLICIES) for (const sc of list) {
    if (mode === 'bridge' && !up) { rows.push({ scenario: sc.id, policy: mode, na: 'N/A' }); continue; }
    rows.push(Object.assign({ scenario: sc.id, policy: mode, title: sc.title }, await runOne(sc, mode)));
  }
  if (AS_JSON) { console.log(JSON.stringify({ rows, bridgeUp: up }, null, 2)); return; }
  const n = (v) => (v == null ? '—' : v);
  console.log(`\n# 阴阳道敌人 AI 消融表 · 夹具 ${list.length} 条 · 策略 ${POLICIES.join('/')} · 确定性单跑（无随机种子）\n`);
  if (health) console.log(`> bridge 列上游 = ${health.upstream}${health.upstream === 'adapter' ? '/' + health.model : ''}${health.samples > 1 ? ' ×' + health.samples + ' 采样' : ''}` + (health.upstream === 'stub' ? '：stub 是固定假答案，只证明链路通，不代表模型水平。' : '：真实模型，延迟与 token 为实测。') + '\n');
  console.log('| 场景 | 策略 | 首次贴脸回合 | 最短距离 | 贴脸回合 | 未接敌无进展 | 攻击 | 自杀 | 非法落地 | 决策 | 提问 | 调用 | 复用 | 直采率 | 延迟min/p50/max | 输入tok | 上游模型 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.scenario} | ${r.policy} | ${r.na || n(r.contactTick)} | ${n(r.minDist)} | ${n(r.adjacentTicks)} | ${n(r.stuckTicks)} | ${n(r.strikes)} | ${n(r.suicides)} | ${n(r.illegal)} | ${n(r.decisions)} | ${n(r.asks)} | ${n(r.calls)} | ${n(r.reused)} | ${n(r.auto_rate)} | ${n(r.lat_min)}/${n(r.lat_p50)}/${n(r.lat_max)} | ${n(r.tokens_in)} | ${r.models || '—'} |`);
  console.log(`\n> 测量边界：延迟仅含 /decide 往返（含桥内模型调用，不含渲染与输入等待）；单跑、无 seed 重复，不做统计显著性宣称。`);
  console.log(`> 直采率 = Choice 过阈值直接采用的占比，其余走同请求 Noul 头门控或 local fallback；自杀 = 选中已被硬否决的 strike。`);
  console.log(`> 各条 claim 见 harness/scenarios.js；kite_ambiguous 标注为 muddy，不作增益证据。`);
  if (POLICIES.includes('bridge') && !up) console.log(`> bridge 列 N/A：零 key 不可复跑（同 B2 §4）。起桥：py -3.12 jev_bridge.py`);
})();
