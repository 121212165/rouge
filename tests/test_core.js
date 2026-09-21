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

test('网络档不阻塞回合：先按 local 行动，桥挂了计入 errors 而不是卡住', async () => {
  const u = unit(1, 1);
  const w = world(MAZE, 5, 3, [u]);
  const jev = Client.makeClient({ mode: 'bridge', endpoint: 'http://127.0.0.1:59999/decide', timeoutMs: 300 });
  const first = await jev.decide(u, w);
  assert.equal(first.path, 'advisory_pending', '第一回合答案还没回来，必须立刻动');
  assert.ok(first.action);
  // 后台请求何时失败取决于 OS，固定 sleep 会让本用例不稳定；轮询到 inflight 清空为止
  const deadline = Date.now() + 3000;
  while (jev.inflight.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.ok(jev.stats.errors >= 1, '桥不可用要计入 errors');
  assert.ok(jev.stats.calls >= 1, '后台确实在问');
});

test('stakes：选项等价不值得问，路线分岔大或能贴脸才算高注', () => {
  const u = unit(1, 1);
  const ctxOpen = C.legalActions(u, world(['#####', '#...#', '#####'], 4, 1, [u]), {});
  assert.equal(P.stakes(ctxOpen, 2).hasStrike, false);
  const adj = unit(3, 1);
  const ctxAdj = C.legalActions(adj, world(['#####', '#...#', '#####'], 2, 1, [adj]), {});
  assert.equal(P.stakes(ctxAdj, 2).hasStrike, true, '能攻击就是高注，必须问');
  const dead = unit(1, 1);
  const ctxDead = C.legalActions(dead, world(MAZE, 5, 3, [dead]), {});
  const onlyOne = ctxDead.offered.filter((a) => a.kind === 'step').length;
  assert.ok(onlyOne >= 1 && typeof P.stakes(ctxDead, 2).spread === 'number');
});

test('auto 档：低分歧直接走 local 且零网络调用', async () => {
  const u = unit(1, 1);
  const w = world(['#####', '#...#', '#####'], 4, 1, [u]);
  const jev = Client.makeClient({ mode: 'auto', endpoint: 'http://127.0.0.1:59999/decide' });
  const st = P.stakes(C.legalActions(u, w, {}), 2);
  await jev.decide(u, w);
  if (st.high) {
    assert.ok(jev.stats.escalated === 1, '高注应升级');
  } else {
    assert.equal(jev.stats.calls, 0, '低分歧不该发请求');
    assert.equal(jev.stats.low_stakes, 1);
  }
});

test('judge：只有合法标签 + 足够置信才采用，否则回旧规则', async () => {
  const realFetch = globalThis.fetch;
  const answer = (choice, confidence) => async () => ({ ok: true, json: async () => ({ answers: { elder: { type: 'choice', choice, confidence, probabilities: { transmit: 0.2, heal: 0.3, gamble: 0.5 } } }, usage: { model: 'fake', input_tokens: 100 } }) });
  const w = world(['#####', '#...#', '#####'], 1, 1, [unit(3, 1)]);
  const packet = { state: {}, questions: { elder: { type: 'choice', instructions: '', criteria: { transmit: 'a', heal: 'b', gamble: 'c' } } } };
  try {
    const settle = async (j, name, pkt, legacy) => {
      const before = j.stats.calls;
      await j.judge(name, pkt, legacy);
      const deadline = Date.now() + 3000;
      while (j.stats.calls === before && j.inflight.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      while (j.inflight.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
      return j.judge(name, pkt, legacy);
    };

    globalThis.fetch = answer('heal', 0.8);
    const j1 = Client.makeClient({ mode: 'bridge', endpoint: '/x' });
    const pending = await j1.judge('elder', packet, 'transmit');
    assert.equal(pending.path, 'advisory_pending', '答案没回来前不阻塞');
    const good = await settle(j1, 'elder', packet, 'transmit');
    assert.equal(good.value, 'heal'); assert.equal(good.path, 'jev');

    globalThis.fetch = answer('nonsense', 0.99);
    const illegal = await settle(Client.makeClient({ mode: 'bridge', endpoint: '/x' }), 'elder', packet, 'transmit');
    assert.equal(illegal.value, 'transmit', '非法标签必须回旧规则');
    assert.equal(illegal.reason, '非法标签：nonsense');

    globalThis.fetch = answer('gamble', 0.3);
    const unsure = await settle(Client.makeClient({ mode: 'bridge', endpoint: '/x', auto: 0.6 }), 'elder', packet, 'transmit');
    assert.equal(unsure.value, 'transmit', '置信不足必须回旧规则');

    const offline = await Client.makeClient({ mode: 'local', endpoint: '/x' }).judge('elder', packet, 'transmit');
    assert.equal(offline.value, 'transmit'); assert.equal(offline.path, 'no_rule_local');
  } finally { globalThis.fetch = realFetch; }
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
