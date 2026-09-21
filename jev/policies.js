/* 三个可离线跑的策略 + 从 typed 答案到动作的门控逻辑（无网络即可验证，含 gate 单测夹具） */
(function (root, factory) {
  const C = typeof globalThis !== 'undefined' && globalThis.JEVCore ? globalThis.JEVCore : require('./core.js');
  const api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JEVPolicies = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  const BIG = 1e9;
  const via = (a) => (a.viaAfter == null ? BIG : a.viaAfter);
  // 只从 offered 里按"绕行步数"排序：模型与启发式共用同一份合法域、同一份事实
  const stepsBy = (list, asc) => list.filter((a) => a.kind === 'step')
    .sort((a, b) => (asc ? via(a) - via(b) : via(b) - via(a)) || a.dir - b.dir)[0] || null;
  const hurtBadly = (u) => u.hp / u.maxHp <= 0.25;

  // baseline = 逐条复刻线上现行为（单一曼哈顿方向、撞墙即停），作为消融对照，不参与改进
  function baseline(u, w, ctx) {
    if (ctx.dist === 1) return C.find(ctx.actions, C.STRIKE) || C.find(ctx.actions, C.HOLD);
    if (ctx.dist > C.engageRadius(w)) return C.find(ctx.actions, C.HOLD);
    const dx = Math.sign(w.player.x - u.x), dy = Math.sign(w.player.y - u.y);
    const legacy = C.DIRS.find((d) => d.dx === dx && d.dy === dy);
    return (legacy && ctx.actions.find((a) => a.id === 'step_' + legacy.i)) || C.find(ctx.actions, C.HOLD);
  }

  // local = 零网络确定性启发式：吃同一份 state、同一套否决，同时是 bridge 掉线时的 fallback 路径
  function local(u, w, ctx) {
    const strike = C.find(ctx.offered, C.STRIKE);
    if (strike && !hurtBadly(u)) return strike;
    if ((ctx.reflectLethal || hurtBadly(u)) && !u.isBoss) {
      const away = stepsBy(ctx.offered, false);
      if (away) return away;
    }
    if (ctx.dist === 1) return C.find(ctx.offered, C.HOLD);
    return stepsBy(ctx.offered, true) || C.find(ctx.offered, C.HOLD);
  }

  const sortedEntries = (p) => Object.keys(p || {}).map((k) => [k, p[k]]).sort((a, b) => b[1] - a[1]);

  // gate = 按问题选原语：Choice 置信不足时不 argmax，改用同请求的 Noul 头做门控
  function gate(answers, u, w, ctx, cfg) {
    const t = cfg || {};
    const auto = t.auto == null ? 0.6 : t.auto;
    const margin = t.margin == null ? 0.15 : t.margin;
    const noulGate = t.noulGate == null ? 0.6 : t.noulGate;
    const action = answers && answers.action;
    const trace = { path: null, confidence: null, margin: null, reason: null };
    if (!action || action.type !== 'choice' || !action.probabilities) return Object.assign(trace, { path: 'fallback', reason: '缺 action 答案或无概率分布' });
    const top = sortedEntries(action.probabilities);
    trace.confidence = top.length ? top[0][1] : null;
    trace.margin = top.length > 1 ? top[0][1] - top[1][1] : (top.length ? top[0][1] : null);
    const chosen = C.find(ctx.offered, action.choice);
    if (!chosen) return Object.assign(trace, { path: 'fallback', reason: '非法标签' });
    if (trace.confidence >= auto && trace.margin >= margin) return Object.assign(trace, { path: 'choice', chosen });
    const disengage = answers.disengage && answers.disengage.noul;
    const press = answers.press && answers.press.noul;
    trace.noul = { disengage: disengage == null ? null : disengage, press: press == null ? null : press };
    if (typeof disengage === 'number' && disengage >= noulGate && !u.isBoss) {
      const away = stepsBy(ctx.offered, false);
      if (away) return Object.assign(trace, { path: 'noul_disengage', chosen: away });
    }
    if (typeof press === 'number' && press >= noulGate) {
      const best = stepsBy(ctx.offered, true);
      if (best) return Object.assign(trace, { path: 'noul_press', chosen: best });
    }
    return Object.assign(trace, { path: 'fallback', reason: '低于自动阈值且 Noul 头未过门' });
  }

  return { baseline, local, gate, stepsBy, sortedEntries };
});
