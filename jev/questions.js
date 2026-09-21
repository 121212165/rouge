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

  // 无规则决策的问题包：这些地方代码本来就没有更好的规则，正是该花钱问 Jev 的地方
  function elderPacket(w) {
    const p = w.player;
    return {
      state: {
        scene: '太乙长老授业', floor: w.floor, final_floor: w.finalFloor,
        player: {
          hp_ratio: +(p.hp / p.maxHp).toFixed(2), gold: p.gold, atk: p.atk, def: p.def,
          realm_index: p.level, cursed: !!p.cursed, curse: (w.curseName || null), class: p.class,
        },
        note: '三个选项互斥且不可撤销；考验是 30% 中诅咒、70% 得灵气的赌局。',
      },
      questions: {
        elder: {
          type: 'choice',
          instructions: '作为天师，为该玩家选一条修炼机缘。',
          criteria: {
            transmit: '传功：攻击 +3（永久）',
            heal: '疗伤：立刻恢复 50 气血（不超过上限）',
            gamble: '考验：30% 中「道心不稳」诅咒（升级所需经验 +50%），70% 得 50 灵气',
          },
        },
      },
    };
  }

  function skillPacket(u, w, skills) {
    const dist = C.manhattan(u, w.player);
    const criteria = { hold: '本回合不出技能' };
    for (const s of skills) criteria['skill_' + s.name] = s.desc;
    return {
      state: {
        scene: u.isBoss ? 'BOSS 技能时机' : '精英技能时机',
        unit: { kind: u.name, boss: !!u.isBoss, hp_ratio: +(u.hp / u.maxHp).toFixed(2), atk: u.atk, skill_used: !!u.usedSkill },
        player: { hp_ratio: +(w.player.hp / w.player.maxHp).toFixed(2), distance: dist, cursed: !!w.player.cursed, line_of_sight: C.lineOfSight(u.x, u.y, w.player.x, w.player.y, w) },
        world: { floor: w.floor, final_floor: w.finalFloor },
        note: '技能整局只能用一次（usedSkill 后不再询问）。',
      },
      questions: { skill: { type: 'choice', instructions: '为这名敌人决定本回合是否出技能、出哪个。', criteria } },
    };
  }

  return { build, needsJudgment, elderPacket, skillPacket };
});
