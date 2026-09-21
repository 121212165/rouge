/* 判断层的"世界"侧：代码决定有什么，Jev 决定怎么办。
   纯函数、无 DOM、无网络、无 Math.random，浏览器与 Node 同构。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JEVCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const WALL = '#';
  // 方向表带固定序号：模型只看"编号 + 后果"，永不产出坐标
  const DIRS = [
    { i: 0, name: '东', dx: 1, dy: 0 },
    { i: 1, name: '南', dx: 0, dy: 1 },
    { i: 2, name: '西', dx: -1, dy: 0 },
    { i: 3, name: '北', dx: 0, dy: -1 },
    { i: 4, name: '东南', dx: 1, dy: 1 },
    { i: 5, name: '西南', dx: -1, dy: 1 },
    { i: 6, name: '西北', dx: -1, dy: -1 },
    { i: 7, name: '东北', dx: 1, dy: -1 },
  ];
  // 与线上旧贪心同值，保证消融只比"决策质量"，不把"跑得更远"混进增益
  const DEFAULT_ENGAGE_RADIUS = 6;
  const engageRadius = (w) => (w && w.engageRadius) || DEFAULT_ENGAGE_RADIUS;
  const HOLD = 'hold';
  const STRIKE = 'strike';

  const inBounds = (w, x, y) => y >= 0 && x >= 0 && y < w.height && x < w.width && !!w.map[y];
  const isFloor = (w, x, y) => inBounds(w, x, y) && w.map[y][x] !== WALL;
  const occupied = (w, u, x, y) => (w.player.x === x && w.player.y === y) || w.enemies.some((e) => e !== u && e.x === x && e.y === y);
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const ratio = (v, total) => (total > 0 ? Math.round((v / total) * 100) / 100 : 0);
  const dmgTo = (atk, def) => Math.max(1, atk - Math.max(0, def));
  const fmt = (v) => (v == null ? '不可达' : v);
  const mapSignature = (w) => w.mapSig || (w.mapSig = w.map.flat().reduce((n, c) => n + (c === WALL ? 1 : 0), 0));

  // Bresenham 视线：墙后有没有玩家，是"压上还是绕行"的判定依据，必须在 state 内
  function lineOfSight(ax, ay, bx, by, w) {
    let x = ax, y = ay;
    const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
    let err = dx + dy;
    for (let guard = 0; guard < 1024; guard++) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === bx && y === by) return true;
      if (!isFloor(w, x, y)) return false;
    }
    return false;
  }

  // 反甲自残是可证明的物理否决：置信度再高也不放行
  function reflectLethal(u, w) {
    if (u.skill !== '反甲') return false;
    return u.hp <= Math.floor(dmgTo(u.atk, w.player.def) * 0.3);
  }

  // 流场：曼哈顿距离在迷宫里不是答案，"绕行几步可达"才是。忽略单位占据，故只在玩家/地图变化时重算
  function flowField(w) {
    const key = w.player.x + ',' + w.player.y + ':' + mapSignature(w);
    if (w._flowKey === key) return w._flow;
    const d = Array.from({ length: w.height }, () => Array(w.width).fill(Infinity));
    d[w.player.y][w.player.x] = 0;
    const q = [[w.player.x, w.player.y]];
    while (q.length) {
      const [x, y] = q.shift();
      for (const dd of DIRS) {
        const nx = x + dd.dx, ny = y + dd.dy;
        if (!isFloor(w, nx, ny) || d[ny][nx] <= d[y][x] + 1) continue;
        d[ny][nx] = d[y][x] + 1; q.push([nx, ny]);
      }
    }
    w._flowKey = key; w._flow = d;
    return d;
  }

  function estimate(u, w) {
    const theirDmg = dmgTo(w.player.atk, u.def);
    const ourDmg = dmgTo(u.atk, w.player.def);
    return { theirDmg, ourDmg, turnsToDieStanding: Math.ceil(u.hp / theirDmg), turnsToKillPlayer: Math.ceil(w.player.hp / ourDmg) };
  }

  // 物理合法性与风险否决分开：墙体/越界/占据 = 不可用；自残、BOSS 脱离 = 可用但不该问
  function legalActions(u, w, ctx) {
    const memory = (ctx && ctx.memory) || {};
    const est = estimate(u, w);
    const dist = manhattan(u, w.player);
    const flow = flowField(w);
    const via = (x, y) => (flow[y][x] === Infinity ? null : flow[y][x]);
    const vetoes = [];
    const actions = [{ id: HOLD, kind: 'hold', x: u.x, y: u.y, distAfter: dist, viaAfter: via(u.x, u.y), label: `原地不动（绕行尚需 ${fmt(via(u.x, u.y))} 步）` }];
    for (const d of DIRS) {
      const nx = u.x + d.dx, ny = u.y + d.dy;
      if (!isFloor(w, nx, ny) || occupied(w, u, nx, ny)) continue;
      const distAfter = Math.abs(w.player.x - nx) + Math.abs(w.player.y - ny);
      actions.push({
        id: 'step_' + d.i, kind: 'step', dir: d.i, dx: d.dx, dy: d.dy, x: nx, y: ny, distAfter,
        viaAfter: via(nx, ny), losAfter: lineOfSight(nx, ny, w.player.x, w.player.y, w),
        label: `向${d.name}走 1 格到 (${nx},${ny})，绕行尚需 ${fmt(via(nx, ny))} 步`,
      });
    }
    if (dist === 1) {
      actions.push({ id: STRIKE, kind: 'strike', distAfter: 1, label: '近战攻击', ourTurnsToKill: est.turnsToKillPlayer, ourTurnsToDie: est.turnsToDieStanding });
      if (reflectLethal(u, w)) vetoes.push({ scope: 'action', id: STRIKE, reason: '反甲反弹致死' });
    }
    if (u.isBoss) vetoes.push({ scope: 'head', id: 'disengage', reason: 'BOSS 不脱离' });
    const offered = actions.filter((a) => !vetoes.some((v) => v.scope === 'action' && v.id === a.id));
    if (memory.frozenTurns >= 2) {
      const warning = `已连续 ${memory.frozenTurns} 回合未缩短绕行步数，直线方向可能被墙挡住`;
      for (const a of actions) if (a.kind === 'step') a.note = warning;
      offered.warning = warning;
    }
    return { actions, offered, vetoes, dist, via: via(u.x, u.y), est, reflectLethal: reflectLethal(u, w), los: lineOfSight(u.x, u.y, w.player.x, w.player.y, w) };
  }

  function observe(u, w, ctx) {
    const kind = u.isBoss ? '旱魃（BOSS）' : u.isElite ? `${u.name}（精英·${u.skill || '无'}）` : u.name;
    return {
      world: { width: w.width, height: w.height, floor: w.floor, final_floor: w.finalFloor },
      unit: { id: u.id, kind, hp_ratio: ratio(u.hp, u.maxHp), atk: u.atk, def: u.def, boss: !!u.isBoss, skill_used: !!u.usedSkill },
      player: { hp_ratio: ratio(w.player.hp, w.player.maxHp), atk: w.player.atk, def: w.player.def },
      judgment: {
        distance: ctx.dist, adjacent: ctx.dist === 1, in_engage_radius: ctx.dist <= engageRadius(w),
        line_of_sight: ctx.los, reachable_via_steps: ctx.via, their_turns_to_kill_us: ctx.est.turnsToDieStanding,
        our_turns_to_kill_them: ctx.est.turnsToKillPlayer, strike_lethal_to_self: ctx.reflectLethal,
        frozen_turns: (ctx.memory && ctx.memory.frozenTurns) || 0, last_action: (ctx.memory && ctx.memory.lastAction) || null,
      },
      options: { ids: ctx.offered.map((a) => a.id), warning: ctx.offered.warning || null },
      vetoed: ctx.vetoes.map((v) => ({ id: v.id, scope: v.scope, reason: v.reason })),
    };
  }

  // 场景指纹：state 未变则复用上轮判断以省调用（只用于生产 gate，不用于评测采样）
  function fingerprint(u, w, ctx) {
    return [u.x, u.y, w.player.x, w.player.y, u.hp, w.floor, mapSignature(w), ctx.offered.map((a) => a.id).join(',')].join('|');
  }

  // 执行前重校验：模型只出编号，落地前用真实格子再验一次新鲜度与合法性
  function applyStep(u, action, w) {
    if (!action || action.kind !== 'step') return false;
    if (!isFloor(w, action.x, action.y) || occupied(w, u, action.x, action.y)) return false;
    u.x = action.x; u.y = action.y;
    return true;
  }

  const find = (actions, id) => actions.find((a) => a.id === id) || null;

  return {
    DIRS, HOLD, STRIKE, WALL, DEFAULT_ENGAGE_RADIUS,
    isFloor, occupied, manhattan, lineOfSight, flowField, legalActions, observe, fingerprint, applyStep, estimate, reflectLethal, find, engageRadius,
  };
});
