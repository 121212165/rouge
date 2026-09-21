/* typed 问题包：一次请求并行问"选哪个动作 + 该不该压上 + 该不该脱离"（投机多头单往返） */
(function (root, factory) {
  const C = typeof globalThis !== 'undefined' && globalThis.JEVCore ? globalThis.JEVCore : require('./core.js');
  const api = factory(C);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JEVQuestions = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C) {
  const ADJACENT_ONLY = '只在给出的编号中选择，不要发明新动作。';

  // 代码决定何时问：距离超圈或无动作可选时不发请求（省调用，也是延迟预算的入口）
  function needsJudgment(u, w, ctx) {
    if (ctx.dist > C.engageRadius(w)) return { ask: false, reason: '超出接战半径' };
    if (ctx.offered.length < 2) return { ask: false, reason: '无可选项' };
    return { ask: true, reason: null };
  }

  function build(u, w, ctx, memory) {
    const state = C.observe(u, w, Object.assign({}, ctx, { memory: memory || {} }));
    const criteria = {};
    for (const a of ctx.offered) criteria[a.id] = a.label;
    const questions = {
      action: { type: 'choice', instructions: `这名敌人本回合该采取哪个动作？${ADJACENT_ONLY}`, criteria },
      press: { type: 'noul', instructions: '在当前局势下，向玩家靠近比保持距离更有利。' },
    };
    const disengageVetoed = ctx.vetoes.some((v) => v.scope === 'head' && v.id === 'disengage');
    if (!disengageVetoed) questions.disengage = { type: 'noul', instructions: '在当前局势下，本回合应远离玩家以保全自己。' };
    return { unit: u.id, state, questions, heads: Object.keys(questions) };
  }

  return { build, needsJudgment };
});
