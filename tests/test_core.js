/* 无网络、无模型即可验证真实控件（学 jev-ultrafast 的 check_guards.py）：node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const g = globalThis;
const path = require('path');
const here = (f) => require(path.join(__dirname, '..', 'jev', f));
here('core.js'); here('policies.js'); here('questions.js'); here('client.js');
const C = g.JEVCore, P = g.JEVPolicies, Q = g.JEVQuestions, Client = g.JEVClient;

const world = (rows, px, py, units) => {
  const map = rows.map((r) => r.split(''));
  return { map, width: map[0].length, height: map.length, floor: 1, finalFloor: 10, player: { x: px, y: py, hp: 100, maxHp: 100, atk: 10, def: 2 }, enemies: units };
};
const unit = (x, y, over) => Object.assign({ id: 'u1', x, y, name: '僵尸', atk: 6, def: 0, hp: 25, maxHp: 25 }, over || {});
const MAZE = ['#######', '#.....#', '#.###.#', '#.#...#', '#.###.#', '#.....#', '#######'];

test('合法域预过滤：给出的每个落点都可走且不被占据', () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u, unit(2, 1, { id: 'u2' })]);
  const ctx = C.legalActions(u, w, {});
  for (const a of ctx.offered) {
    if (a.kind !== 'step') continue;
    assert.ok(C.isFloor(w, a.x, a.y), '不应给出墙格 ' + a.id);
    assert.ok(!C.occupied(w, u, a.x, a.y), '不应给出被占据格 ' + a.id);
    assert.notEqual(`${a.x},${a.y}`, `${w.player.x},${w.player.y}`, '不应给出玩家格');
  }
  assert.ok(!ctx.offered.some((a) => a.id === 'step_4'), '东南 (2,2) 是墙，不该出现');
});

test('state 含答案：绕行步数与视线是判定依据，不是原始遥测', () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const ctx = C.legalActions(u, w, {});
  const st = C.observe(u, w, Object.assign({}, ctx, { memory: {} }));
  assert.equal(typeof st.judgment.reachable_via_steps, 'number');
  assert.equal(st.judgment.line_of_sight, false, '中间隔墙，视线应为断');
  assert.ok(st.options.ids.length === ctx.offered.length, 'state 里的选项集必须等于实际 offered 集');
});

test('baseline 逐条复刻旧行为：撞墙即永久卡死', async () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const jev = Client.makeClient({ mode: 'off' });
  for (let i = 0; i < 40; i++) { const { action } = await jev.decide(u, w); if (action.kind === 'step') C.applyStep(u, action, w); }
  assert.equal(C.manhattan(u, w.player), 6, '旧贪心应一步未进（斜向被墙挡住）');
});

test('local 在同一路网与同一半径下贴脸', async () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const jev = Client.makeClient({ mode: 'local' });
  let tick = null;
  for (let i = 1; i <= 40; i++) {
    const { action } = await jev.decide(u, w);
    if (action.kind === 'step') C.applyStep(u, action, w);
    if (tick == null && C.manhattan(u, w.player) === 1) { tick = i; break; }
  }
  assert.ok(tick != null && tick <= 6, '应在 6 回合内贴脸，实际 ' + tick);
});

test('反甲自残是硬否决：offered 不含 strike，baseline 仍能选到（对照口径一致）', () => {
  const u = unit(4, 1, { name: '盾卫', isElite: true, skill: '反甲', atk: 12, def: 15, hp: 3, maxHp: 100 });
  const w = world(['#########', '#.......#', '#########'], 3, 1, [u]);
  const ctx = C.legalActions(u, w, {});
  assert.ok(ctx.actions.some((a) => a.id === 'strike'), '物理上可攻击');
  assert.ok(!ctx.offered.some((a) => a.id === 'strike'), '但被否决，不该问模型');
  assert.ok(ctx.vetoes.some((v) => v.id === 'strike' && v.reason === '反甲反弹致死'));
});

test('BOSS 的 disengage 头不进问题包', () => {
  const u = unit(3, 1, { isBoss: true, name: '旱魃', skills: ['喷火'] });
  const w = world(['#########', '#.......#', '#########'], 5, 1, [u]);
  const packet = Q.build(u, w, C.legalActions(u, w, {}), {});
  assert.ok(packet.questions.action, 'Choice 头必须在');
  assert.equal(packet.questions.disengage, undefined);
  assert.ok(packet.questions.press);
});

test('gate：置信不足时不 argmax，改用同请求 Noul 头', () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const ctx = C.legalActions(u, w, {});
  const high = { action: { type: 'choice', choice: 'step_0', confidence: 0.9, probabilities: { step_0: 0.9, hold: 0.05, step_1: 0.05 } } };
  assert.equal(P.gate(high, u, w, ctx, {}).path, 'choice');
  const muddy = { action: { type: 'choice', choice: 'hold', confidence: 0.3, probabilities: { hold: 0.3, step_0: 0.28, step_1: 0.28 } }, press: { type: 'noul', noul: 0.8 }, disengage: { type: 'noul', noul: 0.1 } };
  const pressed = P.gate(muddy, u, w, ctx, {});
  assert.equal(pressed.path, 'noul_press');
  assert.ok(pressed.chosen.kind === 'step' && pressed.chosen.viaAfter < ctx.via, '压上头应选到更近的一步');
  const illegal = { action: { type: 'choice', choice: 'step_42', confidence: 0.99, probabilities: { step_42: 0.99, hold: 0.01 } } };
  assert.equal(P.gate(illegal, u, w, ctx, {}).reason, '非法标签');
});

test('桥不可用时降级到 local 并计入 errors（不静默、不卡回合）', async () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const jev = Client.makeClient({ mode: 'bridge', endpoint: 'http://127.0.0.1:59999/decide', timeoutMs: 300 });
  const { action, path: p } = await jev.decide(u, w);
  assert.equal(p, 'fallback');
  assert.ok(action);
  assert.equal(jev.stats.errors, 1);
});

test('执行前重校验：await 期间场景指纹变了就不落地', async () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const jev = Client.makeClient({ mode: 'bridge', endpoint: 'http://127.0.0.1:59999/decide', timeoutMs: 200 });
  const ctx = C.legalActions(u, w, { memory: jev.mem(u) });
  const before = C.fingerprint(u, w, ctx);
  w.player.x = 3; w.player.y = 3;
  assert.notEqual(C.fingerprint(u, w, C.legalActions(u, w, {})), before, '玩家移动必须改变指纹');
});
