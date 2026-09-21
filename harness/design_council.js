/* 设计议事堂：把候选方案连同"它增加什么决策"一起交给 Jev 做比较判断，产出可执行的设计决定。
   分工：候选由我按本仓的第一性原理（Musk's Razor：不增加决策的系统一律砍）生成；
   Jev 只做约不成规则的取舍与量级判断 —— 上一轮已证明它在"答案已在 state 内"时与规则等价。
   用法：node harness/design_council.js [--endpoint=...]   → 打印判定表并写 harness/design-plan.json */
const fs = require('fs');
const path = require('path');

const ENDPOINT = (process.argv.find((a) => a.startsWith('--endpoint=')) || '').split('=')[1]
  || process.env.JEV_ENDPOINT || 'http://127.0.0.1:8731/decide';

const FACTS = {
  game: '阴阳道 · 单文件回合制 ASCII 肉鸽地牢（25x15，10 层，永久死亡）',
  current_systems: ['3 职业各 2 主动技能（消耗灵气值）', '7 种敌人：僵尸/毒虫/煞尸/幽魂(分裂)/盾卫(反甲)/魍魉(诅咒)/旱魃(喷火+召唤)',
    '4 种掉落：丹药/灵气/钥匙/宝箱', '3 件商店商品（攻/防/血，每层限买 1 件）', '1 种地图（随机房间+走廊）',
    '地形：楼梯 >、陷阱 v（可见）、祭坛 X（解咒）、长老 O（三选机缘）、诅咒系统'],
  design_doctrine: 'Musk\'s Razor：任何只加代码不加决策的系统一律砍掉。第一性原理重构时已按此删掉音效/成就/周目/存档/宠物/剧情。',
  measured_player_data: {
    human_clears: '2 局通关（第 10 层），用时 3 分 40 秒与 5 分 09 秒，击杀 58 / 72',
    death_causes: '主要死于魍魉与毒虫（第 2-3 层）',
    skill_usage: 'skill_cast 占事件比高，医师毒针被反复释放（灵气见底）→ 存在单一技能主导',
    purchase_behavior: '修复前 0.7 秒内连买 6 把同种武器（无上限时玩家会无脑堆数值）',
    turn_latency: 'p50 2ms / p95 14ms（判断层非阻塞）',
  },
  reported_problem: '玩法有限、玩一会就腻；缺少机制深度；界面看着头疼（墙是密集的 # 字符，房间形状难辨）',
};

const QUESTIONS = {
  fun_axis: {
    type: 'choice',
    instructions: '为"减少重复感"优先押注哪一个轴？只依据给定事实判断，不要臆测未提供的信息。',
    criteria: {
      build: '构筑：道具与技能互相咬合，玩家每局凑一套（决策发生在"这局走什么流派"）',
      risk: '风险定价：可交易的收益与代价（诅咒换奖励、贪刀换伤害），决策发生在"要不要再贪一次"',
      spatial: '空间谜题：地形与敌人位置构成谜题（拉怪、卡门、借地形），决策发生在"走哪条路、引哪只怪"',
      pressure: '节奏压制：随时间/回合恶化的压力（毒雾、增援），决策发生在"什么时候撤"',
      variety: '内容铺量：更多怪更多图更多道具，靠新鲜感撑（决策数量不增加）',
    },
  },
  mech_priority: {
    type: 'choice',
    instructions: '以下六条候选机制，哪一条用最小实现量换来最多新决策？（每条括号内是它增加的决策）',
    criteria: {
      wuxing: '五行克制：职业/道具/敌人各带属性，克制 ±30%（决策：选路线、选道具、挑对手打）',
      combo: '连击与破防条：连续命中累积增伤，被打断清零（决策：贪刀还是撤）',
      room_types: '房间类型化：宝箱房/炼丹房/伏击房/祭坛房，门口有可见标记（决策：进哪个门）',
      enemy_memory: '敌人求援：同类相邻时合击，先杀哪个成为问题（决策：拉怪还是分头）',
      env_rules: '环境规则：油桶可点燃、水池灭火减速（决策：用地形而不是用数值）',
      curse_draft: '进层前自选诅咒换奖励（决策：给这局定价多少风险）',
    },
  },
  mech_count: {
    type: 'score',
    instructions: '一次迭代里应当引入多少条新机制，才不至于压垮可读性与上手成本？',
    criteria: [
      '0 条：只调数值，不动结构',
      '1 条：单一新决策轴，教程只需加一句',
      '2 条：两个轴开始互相咬合，仍能一屏说明白',
      '3 条：三轴联动，需要图例与情境提示配合',
      '4 条以上：机制堆叠，玩家需自行归纳，界面与教程必须重做',
    ],
  },
  item_count: {
    type: 'score',
    instructions: '掉落与商店合计的道具池应有多大，才既支撑构筑又不沦为背板？',
    criteria: [
      '4-6 种：现状，掉落无期待感',
      '8-10 种：每局能遇到 3-5 种，开始有取舍',
      '12-16 种：足以形成 2-3 套可识别流派，但需要图鉴或清晰图标',
      '20-30 种：构筑深度足，但一局见不全，掉落感知稀释',
      '40 种以上：内容铺量，决策不增加，维护成本压垮收益',
    ],
  },
  map_count: {
    type: 'choice',
    instructions: '本轮加几种新地图（当前 1 种，共 10 层）？',
    criteria: {
      m0: '不加，只把现有地图的渲染与房间类型做深',
      m2: '加 2 种（每 3-4 层换一次），每种带一条自己的规则',
      m3: '加 3 种，与敌人族群绑定（水牢出幽魂、火窟出毒虫）',
      m5: '加 5 种，每两层换图，靠场景新鲜感撑',
    },
  },
  spawn_rule: {
    type: 'choice',
    instructions: '道具出现规律选哪一种？（目标是让"要不要绕过去拿"成为决策）',
    criteria: {
      uniform: '均匀随机撒点（现状）：位置无信息量，玩家不规划路线',
      risk_reward: '风险定价：好东西放在陷阱/精英密集区，门口有可见标记 → 绕不绕成为决策',
      shop_gated: '关键道具只进商店与宝箱，掉落只给消耗品 → 灵气成为唯一节奏阀',
      pity_curve: '按"最近 N 层没拿到道具"提高概率 → 保底，但玩家无需决策',
    },
  },
  render_first: {
    type: 'choice',
    instructions: '界面最该先修的一件事（玩家反馈"看着头疼"）？',
    criteria: {
      wall_noise: '墙体噪声：# 密集成片导致房间形状难辨 → 改实心块面/降低墙对比、提亮地面',
      scale: '尺度：格子太小、信息挤 → 提高字号与单元格对比，地图占据主视觉',
      feedback: '反馈缺失：受击、暴击、克制变化没有即时视觉语言 → 加飘字与闪色',
      hierarchy: '层级：状态/技能/日志三块面板权重接近，眼睛没有落点 → 重排信息层级',
    },
  },
  readability_risk: { type: 'noul', instructions: '在现有界面上增加这些机制与道具，会让可读性变差而不是变好。' },
  needs_tutorial_update: { type: 'noul', instructions: '加入所选数量的机制与道具后，现有首跑教程必须重写才能维持上手清晰度。' },
};

(async function main() {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: FACTS, questions: QUESTIONS }) });
  if (!res.ok) { console.error('桥不可用：HTTP ' + res.status + '（先起 JEV_UPSTREAM=typesafe py -3.12 jev_bridge.py）'); process.exit(1); }
  const json = await res.json();
  const a = json.answers;
  const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(2) : v);

  console.log('\n# Jev 设计议事堂 · 判定表\n');
  console.log('| 问题 | 结论 | 置信 | 分布 |');
  console.log('|---|---|---|---|');
  for (const key of Object.keys(QUESTIONS)) {
    const x = a[key] || {};
    const probs = x.probabilities ? Object.entries(x.probabilities).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([k, v]) => `${k} ${fmt(v)}`).join(' ') : '';
    const val = x.choice || (x.score != null ? `${x.score} / 4 档` : fmt(x.noul));
    console.log(`| ${key} | ${val} | ${fmt(x.confidence)} | ${probs} |`);
  }
  const plan = {
    at: new Date().toISOString(), model: (json.usage && json.usage.model) || null, latency_ms: Date.now() - t0,
    fun_axis: a.fun_axis?.choice, mech_priority: a.mech_priority?.choice,
    mech_count: a.mech_count?.score, item_count: a.item_count?.score, map_count: a.map_count?.choice,
    spawn_rule: a.spawn_rule?.choice, render_first: a.render_first?.choice,
    readability_risk: a.readability_risk?.noul, needs_tutorial_update: a.needs_tutorial_update?.noul,
    raw: a,
  };
  fs.writeFileSync(path.join(__dirname, 'design-plan.json'), JSON.stringify(plan, null, 2));
  console.log('\n> 判定已写 harness/design-plan.json；模型 ' + plan.model + '，一次请求 ' + plan.latency_ms + 'ms。');
  console.log('> 分工：候选是我按本仓"不增加决策就砍掉"的原则生成的，Jev 只做取舍与量级判断；' +
    '它说 4 档不代表一定照办 —— 若与第一性原理冲突，以冲突记录的形式写出来，不静默覆盖。');
})();
