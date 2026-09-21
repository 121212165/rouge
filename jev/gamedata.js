/* 五行、法宝、煞气三张表：数据驱动，渲染/结算/图例/掉落共用同一份，避免多处各写一套。
   条数按 Jev 设计议会：item_count 1.3（≈8-10 件）、mech_count 2.04（五行 + 煞气构筑）。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.GameData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  // 金克木 木克土 土克水 水克火 火克金
  const WUXING = { 金: '木', 木: '土', 土: '水', 水: '火', 火: '金' };
  // 相生环（一气连环用它串链）：金生水 水生木 木生火 火生土 土生金
  const SHENG = { 金: '水', 水: '木', 木: '火', 火: '土', 土: '金' };
  const QI_NEED = 3; // 串满 3 口入「盈」，下一击引爆。5 口一整圈太稀，Jev 判"60 秒感知不到"
  const WUXING_COLORS = { 金: '#facc15', 木: '#4ade80', 土: '#cbb28a', 水: '#60a5fa', 火: '#fb7185' };
  function elementFactor(atkEl, defEl) {
    if (!atkEl || !defEl) return 1;
    if (WUXING[atkEl] === defEl) return 1.3;
    if (WUXING[defEl] === atkEl) return 0.75;
    return 1;
  }
  function elementNote(atkEl, defEl) {
    const f = elementFactor(atkEl, defEl);
    if (f > 1) return `${atkEl}克${defEl} +30%`;
    if (f < 1) return `${defEl}克${atkEl} -25%`;
    return '';
  }
  const CLASS_ELEMENT = { 医师: '木', 炼药师: '火', 武痴: '金' };

  // tier 1/2/3 = 掉落风险定价的档位：越稀有只出现在精英/陷阱密集区
  // 每件都必须改变一个决策（纯数值堆叠不算道具）
  const RELICS = [
    { id: 'ding', name: '定身符', el: '土', kind: 'active', tier: 1, charges: 2, desc: '4 格内敌人定身 1 回合', fx: 'freeze' },
    { id: 'dun', name: '遁地符', kind: 'active', tier: 1, charges: 2, desc: '瞬移到 4 格外的空地', fx: 'blink' },
    { id: 'jing', name: '照妖镜', el: '金', kind: 'active', tier: 2, charges: 1, desc: '3 回合无视防御、伤害 +30%', fx: 'reveal' },
    { id: 'quan', name: '乾坤圈', el: '金', kind: 'active', tier: 2, charges: 1, desc: '相邻敌人被推开 2 格并眩晕', fx: 'sweep' },
    { id: 'bing', name: '玄冰丹', el: '水', kind: 'active', tier: 3, charges: 1, desc: '全场冻结 2 回合，你随后凝滞 1 回合', fx: 'freezeAll' },
    { id: 'pen', name: '聚宝盆', el: '土', kind: 'passive', tier: 2, desc: '灵气 +50%，但每层多 2 只怪', fx: 'greed' },
    { id: 'cao', name: '替身草人', el: '木', kind: 'passive', tier: 3, desc: '免死一次，代价是本层灵气清空', fx: 'undying' },
    { id: 'bo', name: '破阵锤', el: '金', kind: 'passive', tier: 1, desc: '撞墙可穿墙一次（消耗）', fx: 'phase' },
    { id: 'du', name: '避毒珠', el: '水', kind: 'passive', tier: 1, desc: '免疫陷阱与中毒', fx: 'ward' },
    { id: 'feng', name: '定风珠', el: '木', kind: 'passive', tier: 2, desc: '免疫诅咒，魍魉对你失效', fx: 'noCurse' },
  ];

  // 煞气构筑：入体时三选一，每项都同时给好处和代价，并改写命格五行
  const SHA = [
    { id: 'jin', name: '金煞入骨', el: '金', desc: '攻击 +7、无视半数防御，但防御 -3', atk: 7, pierce: 0.5, def: -3 },
    { id: 'mu', name: '木煞缠身', el: '木', desc: '每回合回 3 气血，但攻击 -3', hp_regen: 3, atk: -3 },
    { id: 'shui', name: '水煞浸脉', el: '水', desc: '灵气 +30%，但受伤 +10%', gold_mult: 0.3, hurt_mult: 0.1 },
    { id: 'huo', name: '火煞焚经', el: '火', desc: '攻击附带灼烧，但气血上限 -15', burn: 3, maxhp: -15 },
    { id: 'tu', name: '土煞镇体', el: '土', desc: '气血上限 +40，但攻击 -4', maxhp: 40, atk: -4 },
    { id: 'po', name: '煞眼通幽', el: '水', desc: '免疫精英技能，但经验 -25%', no_skill: true, exp_mult: -0.25 },
    { id: 'gu', name: '煞骨反噬', el: '金', desc: '反弹所受伤害 25%，但受伤 +15%', reflect: 0.25, hurt_mult: 0.15 },
    { id: 'qi', name: '煞气凌人', el: '火', desc: '攻击 +5 且商店半价，但每层掉 10 气血', atk: 5, shop_half: true, hp_leak: 10 },
  ];
  const SHA_EVERY = 4; // 每 4 杀引动一次煞气：机器人 8 局平均只杀 1.5 个，6 杀等于整局见不到构筑轴

  const TIER_NAMES = { 1: '凡品', 2: '灵品', 3: '仙品' };
  const TIER_COLORS = { 1: '#86efac', 2: '#7dd3fc', 3: '#ffd75e' };

  return {
    WUXING, SHENG, QI_NEED, WUXING_COLORS, elementFactor, elementNote, CLASS_ELEMENT,
    RELICS, TIER_NAMES, TIER_COLORS, SHA, SHA_EVERY,
    relic: (id) => RELICS.find((r) => r.id === id) || null,
  };
});
