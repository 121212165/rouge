/* 设计议事堂：把候选方案连同"它增加什么决策"一起交给 Jev 做比较判断，产出可执行的设计决定。
   分工：候选由我按本仓的第一性原理（Musk's Razor：不增加决策的系统一律砍）生成；
   Jev 只做约不成规则的取舍与量级判断 —— 上一轮已证明它在"答案已在 state 内"时与规则等价。
   用法：node harness/design_council.js [--round=1|2] [--endpoint=...]
        → 打印判定表并写 harness/design-plan.json / fun-plan.json */
const fs = require('fs');
const path = require('path');

const ENDPOINT = (process.argv.find((a) => a.startsWith('--endpoint=')) || '').split('=')[1]
  || process.env.JEV_ENDPOINT || 'http://127.0.0.1:8731/decide';
const ROUND = +((process.argv.find((a) => a.startsWith('--round=')) || '').split('=')[1] || 1);

const FACTS_R1 = {
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

const QUESTIONS_R1 = {
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


/* ── 第二轮：用户反馈"不太好玩、没有一个亮眼的玩法" ─────────────────────
   第一轮把构筑轴补齐了，但核心动词没变：还是"撞上去打一下"。
   这一轮问的是招牌玩法与美术方向，喂进去的是第一轮落地后的真实测量值。 */
const FACTS_R2 = {
  game: '阴阳道 · 单文件回合制肉鸽地牢（25x15 网格，10 层，永久死亡，已上线 GitHub Pages）',
  first_round_shipped: ['五行命格（相克 ±30%，描边即属性）', '10 件法宝：5 主动带充能 / 5 被动改规则',
    '煞气构筑：每攒满 4 点强制三选一，8 种异变各带好处+代价并改写命格',
    '风险定价掉落：实测落点危险度 凡品 0.91 < 灵品 2.40 < 仙品 4.08',
    '地图从 <pre> 文本流改成 CSS 网格 + 实色墙体 + 分组图例 + 8 步教程'],
  measured_after_round1: {
    bot_12_runs: '死亡 12/12、通关 0、平均到第 2.83 层、每局击杀 1.17、每局捡到法宝 0.08 件、煞气三选触发 8/12 局',
    human_before_round1: '2 局通关第 10 层，用时 3 分 40 秒与 5 分 09 秒，击杀 58 / 72',
    human_implied_rate: '约 15-20 次击杀/分钟，且击杀只有一个操作：走向相邻格',
    core_verb_count: 1,
    systems_now: '职业+技能 / 五行 / 法宝 / 煞气 / 诅咒 / 商店 / 长老 / 祭坛 / 陷阱 / 钥匙宝箱 / 精英 3 种 / BOSS 1 种',
    release_gate: '19 项确定性检查全绿；Jev 自己判 HOLD（上架准备度 2.31/4，置信 0.51），卡点=缺真人证据',
  },
  reported_problem: '"不太好玩，没有一个亮眼的玩法"；"界面不太好看"',
  design_doctrine: 'Musk\'s Razor：不增加决策的系统一律砍。本轮硬约束：新玩法必须改变核心动词本身，而不是在第 N 个系统上再加一层。',
  tension: '系统数量已经很多（12 类），但玩家一局只做一个动作。加第 13 个系统大概率不解决"腻"。',
};

const QUESTIONS_R2 = {
  core_verb: {
    type: 'choice',
    instructions: '要把"撞上去打一下"换成一局可复述的招牌玩法，押哪一条？只依据给定事实判断。',
    criteria: {
      qi_chain: '一气连环：每次以相克命中吸一口该属性气，五行按相生串成链，链满吐气放一次大范围爆发 → 走位与选目标变成资源运营',
      time_debt: '时间借贷：可主动"借"额外半步/额外一击，但之后必须连续空过等量回合 → 回合制本身成为可交易资源',
      possession: '夺舍：击杀后收其魂魄，花一回合附身到另一只怪身上替打 → 敌人从纯威胁变成弹药',
      one_burst: '一击必杀：默认不造成伤害，只累积"势"，找机会一次性打出 → 全部决策变成"什么时候出手"',
      terrain_bind: '阵眼：把战斗改写成占格谜题（站阵眼得加成、引怪压陷阱、封走廊） → 决策发生在地图而不是数值',
      more_content: '维持现核心动词，继续加道具/敌人/层数 → 决策数不增加',
    },
  },
  signature_moment: {
    type: 'choice',
    instructions: '"亮眼"要能被一句话复述。哪一句最可能被玩家主动讲给别人听？',
    criteria: {
      chain_flash: '"我把五行串成一条链，一口气清了半个房间"',
      gamble_call: '"我借了两步，赌这两步内打死它，结果差一点"',
      turn_enemy: '"我夺舍了那只盾卫，让它替我把门堵住"',
      one_hit: '"我攒了 12 回合势，一锤秒了旱魃"',
      none_yet: '以上都不成立，当前没有任何可复述时刻',
    },
  },
  cut_candidates: {
    type: 'choice',
    instructions: '为给招牌玩法腾出注意力，先砍/合并哪一类现有系统？（砍错了会掉决策数，按事实判）',
    criteria: {
      keep_all: '都不砍，招牌玩法叠加在上',
      merge_loot: '钥匙+宝箱+灵气+丹药合并成一种掉落，去掉"找钥匙"这条无趣支线',
      cut_shop: '砍每层商店，把取舍全部搬进煞气三选与法宝',
      cut_elder_altar: '砍长老与祭坛两个弹窗，诅咒只由战斗与煞气产生',
      cut_passives: '被动法宝砍半，只留会改变走位/路线的那几件',
    },
  },
  pacing: {
    type: 'score',
    instructions: '招牌玩法要成立，单局目标时长应当往哪一档压？（现状：人类 3-5 分钟通关，机器人 20-60 秒死）',
    criteria: [
      '更短（1-2 分钟一局）：招牌玩法要高频出现，靠快节奏反复触发',
      '维持现状（3-5 分钟）：不改节奏，只把决策密度提上去',
      '更长（8-15 分钟）：招牌玩法需要铺垫期，太短攒不出链/势',
      '分层：前 5 层短、后 5 层长，压力曲线递增',
      '不确定，取决于招牌玩法选哪条',
    ],
  },
  ui_art_direction: {
    type: 'choice',
    instructions: '用户会用文生图模型做界面素材。哪个方向最可能同时解决"不好看"和"看不清"？',
    criteria: {
      ink_seal: '水墨 + 朱红印章 + 宣纸底：道气足，但小格子里对比度容易糊',
      pixel_dao: '16-bit 像素 + 高饱和符箓色块：格子边界天然清晰，可读性最好',
      glass_neon: '深色玻璃拟态 + 霓虹青紫描边：现代感强，但"阴阳道"题材会漂',
      paper_cut: '剪纸/皮影式剪影 + 强轮廓：形状差异大，敌我一眼分得开',
      tile_relief: '每格做成小浮雕/珐琅质感方块：色块分明、有触感，代价是素材量大',
    },
  },
  readability_after: { type: 'noul', instructions: '在已经叠加 12 类系统的界面上再加一条招牌玩法，可读性会变差而不是变好。' },
  verb_still_one: { type: 'noul', instructions: '若不改变核心动词，仅靠继续增加系统数量，"腻"的问题不会缓解。' },
  worth_building: { type: 'noul', instructions: '所选招牌玩法的实现成本，能在一次迭代内做完并通过本仓的确定性闸门。' },
};


/* ── 第三轮：第二轮 core_verb 0.34 vs 0.30、cut 0.31 vs 0.29，都是硬币正面 ──
   按"按问题选原语"的做法，把模糊的多选一压成两两对决，并换一个更利的判据。 */
const FACTS_R3 = {
  ...FACTS_R2,
  round2_result: { core_verb: 'terrain_bind 0.34 vs qi_chain 0.30（置信 0.21，未收敛）',
    cut_candidates: 'cut_elder_altar 0.31 vs merge_loot 0.29（置信 0.14，未收敛）',
    signature_moment: 'none_yet 0.83（当前没有任何可复述的招牌时刻）',
    verb_still_one: 0.87, worth_building: 0.30, readability_after: 0.78 },
  implementation_facts: {
    qi_chain: '复用已有五行表：相克命中吸一口该属性气，按相生（金→水→木→火→土→金）串链，链满 5 口吐气放一次全屏同属性爆发。不改地图、不改敌人 AI、不加输入。',
    terrain_bind: '需要房间类型化 + 阵眼格 + 敌人愿意抢格 + 玩家能看懂"为什么这个格子值钱"。与第一轮 map_count=m0（不加新地图）冲突。',
  },
};

const QUESTIONS_R3 = {
  verb_final: {
    type: 'choice',
    instructions: '两两对决。判据只用一条：一个完全没读教程、只玩 60 秒的玩家，能不能凭屏幕变化感觉到这个玩法在生效？',
    criteria: {
      qi_chain: '一气连环（复用五行数据，不改地图与敌人 AI）',
      terrain_bind: '阵眼占格（需房间类型化与敌人抢格）',
    },
  },
  cut_final: {
    type: 'choice',
    instructions: '两两对决。判据只用一条：砍掉之后，玩家每局仍然要做的取舍数量是否真的不下降？',
    criteria: {
      cut_elder_altar: '砍长老与祭坛两个弹窗（诅咒只由战斗与煞气产生）',
      merge_loot: '钥匙+宝箱+灵气+丹药合并成一种掉落（去掉找钥匙支线）',
      cut_none: '都不砍',
    },
  },
  same_round: {
    type: 'score',
    instructions: '一条招牌玩法 + 一次界面美术换向（16-bit 像素符箓），应当同轮做完还是分开？',
    criteria: [
      '同轮做完：两者互相成就，分开做会出现"新玩法配旧皮肤"的半成品期',
      '先玩法后美术：玩法没成立之前换皮是白干',
      '先美术后玩法：可读性不解决，玩家根本看不到玩法在发生',
      '拆成两轮，但先做哪一轮取决于哪一轮风险更低',
      '不确定',
    ],
  },
  verb_final_clear: { type: 'noul', instructions: '选定的招牌玩法在 60 秒内可被无教程玩家感知。' },
};


/* ── 第四轮：手机端交互（用户："点击太老了"）──────────────────────────
   判据先给外部事实，再让模型在候选里选；候选由我按本仓的回合制不可逆性生成。 */
const FACTS_R4 = {
  game: '阴阳道 · 回合制肉鸽地牢，25x15 网格，浏览器单文件 HTML（无框架、无构建、无手势库）',
  mobile_current: '屏幕下方固定十字虚拟键（↑←↓→），点一次走一步；地图在 390px 视口下每格约 26px',
  hard_constraints: [
    '回合制不可逆：每走一步所有敌人才动一步，误触一步可能直接换来一次死亡，不能靠"撤销"兜底',
    '撞上敌人即攻击，没有独立攻击键；踩楼梯即进入商店并强制下潜，回不来',
    '已上线 GitHub Pages，玩家用手机浏览器直接打开，不装 App',
  ],
  board_metrics: { cells: '25x15 = 375 格', cell_px_at_390: 26, thumb_target_recommended_min_px: 44,
    consequence: '整屏同时只显示 1 个玩家 + 最多 11 个敌人 + 若干掉落，一屏全图可见，无需滚动' },
  external_evidence: [
    'Shattered Pixel Dungeon v4.0.0（2026-09-09，移动端网格肉鸽的参照物）至今仍是 tap-to-move 为主，没有改成摇杆或手势',
    '但 2026-02 有玩家开帖问 "Is there an alternative to tap to move?"：主流方案并非无人抱怨',
    'MDN 移动端触控文档（2025-07 更新）与 Unity/GDevelop 的通行建议一致：触屏方向输入要么给可见锚点，要么给即时回显，纯隐形手势误判率高',
    '虚拟摇杆在 Unity/UX 社区长期被批"手感差"，主要问题是中性区抖动与拇指遮挡，而非概念本身',
  ],
  reported_problem: '"手机版换交互方式，点击太老了"',
  design_doctrine: 'Musk\'s Razor：换交互必须减少"想到—做到"之间的摩擦或增加可控性；只是看起来更炫的输入一律不采纳。',
};

const QUESTIONS_R4 = {
  move_scheme: {
    type: 'choice',
    instructions: '替换屏幕十字键的移动方案，选哪一个？只依据给定事实判断，不要臆测未提供的信息。',
    criteria: {
      tap_path: '点任意可达格 → 自动寻路逐格走过去（每格消耗一回合，途中可再点打断）：Shattered PD 同款',
      swipe_dir: '在地图上朝四向滑动 = 走一步，连续快滑 = 连续走；手指不遮挡地图中心',
      drag_path: '按住拖出一条折线轨迹，松手按轨迹逐格走；路径实时高亮，走前可看清每一步',
      radial_hold: '长按任意位置弹出四/八向罗盘，滑到方向松手；方向键跟着手指出现在屏幕任意位置',
      floating_stick: '浮动摇杆：手指落点即摇杆原点，按倾角决定方向与连走步数',
      tap_adjacent: '只允许点相邻格（把地图本身当方向键），远处目标不支持一步直达',
      keep_dpad: '保留固定十字键，只把它做小、做半透明、挪到拇指热区',
    },
  },
  secondary_actions: {
    type: 'choice',
    instructions: '技能（2 个）、法宝（最多 3 个主动）、引爆/等待这些非移动操作，在手机上放哪？',
    criteria: {
      bottom_bar: '底部工具条：移动区与动作区分层，动作按钮固定可肌肉记忆',
      right_rail: '右侧竖排浮动按钮：拇指自然落点，但会遮地图右半边',
      radial_menu: '长按地图弹罗盘，方向=移动、中心=动作菜单：屏最干净，但藏得深',
      edge_gesture: '边缘手势（右滑技能、上滑法宝）：无按钮，但完全不可见、依赖记忆',
      context_button: '只保留一个"上一件用过的事"智能按钮，其余收进可展开抽屉',
    },
  },
  wait_turn: {
    type: 'choice',
    instructions: '回合制里"原地等待/观察"是刚需（等敌人走过来占位）。手机上怎么给？',
    criteria: {
      explicit_btn: '一个明确的"待一回合"按钮',
      double_tap: '双击地图空地 = 等待',
      tap_self: '点自己脚下那格 = 等待（与 tap_path 天然一致）',
      swipe_back: '朝来路方向滑动 = 等待兼后退',
      drop: '不提供：本作没有需要等待的实时要素',
    },
  },
  board_zoom: {
    type: 'choice',
    instructions: '390px 视口下每格 26px，低于通行 44px 拇指目标。怎么办？',
    criteria: {
      keep: '不动：一屏全图可见比格子大小更重要，靠手势精度而不是点击精度绕开',
      pinch: '支持双指缩放 + 拖动视口：小图看全局，放大点格子',
      bigger_scroll: '默认放大到 44px，地图超出屏幕则允许滚动，玩家自己挪视野',
      auto_focus: '自动放大到玩家周围 15x9 区域，远处只留小地图',
    },
  },
  misinput_risk: { type: 'noul', instructions: '所选移动方案在不可逆的回合制里会造成"手指滑过头/点错格"这类无法挽回的误操作。' },
  one_handed: { type: 'noul', instructions: '单手拇指可以完成本作的全部操作（移动、技能、法宝、弹窗选择）。' },
  older_than_tap: { type: 'noul', instructions: '所选方案真的比现在的固定十字键更现代，而不只是把同样的点击换了个手势外壳。' },
  impl_one_round: { type: 'noul', instructions: '这套交互能在一次迭代内用原生 JS + Pointer Events 做完，并通过本仓的确定性闸门。' },
};

/* ── 第五轮：第四轮若没收敛，两两对决 + 换成"误触代价"判据 ── */
const FACTS_R5 = {
  ...FACTS_R4,
  round4_result: '见 harness/mobile-plan.json；未收敛的候选进入本轮两两对决',
  tiebreak_rule: '回合制不可逆 → 判据从"哪个更现代"换成"哪个错了还能救"：误触后玩家有没有机会在敌人行动前停下',
};

const QUESTIONS_R5 = {
  move_final: {
    type: 'choice',
    instructions: '两两对决。判据只用一条：手指滑过头或点错时，玩家还有没有机会止损。',
    criteria: {
      tap_path: '点格自动寻路（一次输入 = 多步，途中每步都会推进回合）',
      swipe_dir: '四向滑动走一步（一次输入 = 一步，随时可停）',
      drag_path: '拖折线再走（走前可看清整条路径，但一次输入 = 多步）',
      radial_hold: '长按弹罗盘（松手才生效，按住期间可反悔）',
    },
  },
  zoom_final: {
    type: 'choice',
    instructions: '两两对决。判据只用一条：哪个更不容易让玩家"看不清敌人从哪来"。',
    criteria: {
      keep: '保持一屏全图',
      pinch: '双指缩放 + 拖动视口',
      bigger_scroll: '放大到 44px 并允许滚动',
      auto_focus: '自动聚焦玩家周围 + 小地图',
    },
  },
  needs_confirm_step: { type: 'noul', instructions: '无论选哪种移动方案，跨多格的输入都必须先预览路径再确认，否则会因不可逆误触直接掉评分。' },
};


/* ── 第六轮：手机视图与数据回传（用户三个具体问题，实测数字先摆出来）── */
const FACTS_R6 = {
  game: '阴阳道 · 回合制网格肉鸽，25x15 = 375 格，单文件 HTML，已上线 GitHub Pages（手机浏览器直接打开）',
  measured_on_390x844: {
    cell_px: 14, map_box: '367x220', legend_box: '367x214（与地图几乎等高）',
    doc_height: 1683, viewport: 844, map_share_of_page: '13%',
    panels_order: '地图 → 图例 → 状态面板 → 技能/日志面板（全在折叠线以下）',
    touch_bar: '390x62 常驻底部，含技能×2 + 待一回合（能放，但无提示）',
    feedback_tap_target: false, telemetry_endpoint: null,
  },
  hard_facts: [
    '反馈弹窗只能用键盘 F 键打开：手机上没有任何入口，诊断数据交不回来（此前 4 个真 bug 全靠这份数据发现）',
    '遥测只在 URL 带 ?tlUrl= 时才上传；Pages 上没人带这个参数，所以事件只堆在 localStorage',
    '移动端移动输入已换成跟随手指的八向罗盘：不再需要点中 14px 的格子，点按精度不再是约束',
    '回合制不可逆，但罗盘"松手才生效 + 拖回中心取消"已经把误触代价压掉了',
  ],
  reported_problem: '"手机版怎么提交数据 / 怎么释放技能 / 看视图不太好看"',
  design_doctrine: 'Musk\'s Razor：手机上屏幕是最稀缺资源；不产生决策也不提供反馈的常驻 UI 应当让位给地图。',
};

const QUESTIONS_R6 = {
  board_fit: {
    type: 'choice',
    instructions: '14px 格子是视图问题的根。先修哪一条？',
    criteria: {
      landscape: '横屏优先：844px 宽下格子约 33px，代价是要提示玩家转屏且竖屏体验变差',
      legend_folds: '把图例折叠成一个按钮：立刻回收 214px，地图可放大到接近满屏高',
      hud_strip: '把血/灵气/煞气/一气压成地图上方一条 40px 细带，面板移到地图下方',
      smaller_board: '缩小地图本身（25x15 → 19x11）：格子变大但关卡结构要重做，风险最高',
      pinch_now: '现在加双指缩放：第五轮 zoom_final=keep(0.95) 已否掉，除非有新事实',
    },
  },
  legend_on_mobile: {
    type: 'choice',
    instructions: '图例（367x214，与地图等高）在手机上怎么处理？',
    criteria: {
      fold_button: '折叠：默认收起，一个"图例"按钮点开',
      keep_short: '常驻但砍到两行（只留敌人 + 法宝品阶）',
      first_run_only: '首局强制看完后自动折叠，之后靠按钮召回',
      keep_as_is: '保持现状：新手不看图例就玩不动',
    },
  },
  data_channel: {
    type: 'choice',
    instructions: '手机上怎么把诊断数据交回来？（此前 4 个真 bug 全部来自这份数据，交不回来等于瞎做）',
    criteria: {
      tap_entry: '给反馈一个可点入口（底部动作条或地图角落常驻小按钮），复用现有弹窗',
      auto_endpoint: '内置一个默认遥测端点，不靠 ?tlUrl= 参数',
      death_share: '死亡结算画面直接给"一键带走本局数据"，因为那一刻玩家最有动机',
      screenshot_code: '生成短码让玩家截图回传：零后端，但样本量极小',
    },
  },
  skill_discovery: {
    type: 'choice',
    instructions: '技能在手机上"能放但没人知道"，怎么办？',
    criteria: {
      label_hint: '按钮上直接写清"耗灵气"，并在首次获得灵气时让按钮闪一次',
      inline: '把技能按钮挪进地图内浮层（贴着玩家），视线不用下移',
      auto_cast: '关键技能自动释放，玩家只管走：减少操作但也减少决策',
      first_battle_tutorial: '第一场战斗强制分步引导点一次技能和一次法宝',
    },
  },
  feedback_unreachable: { type: 'noul', instructions: '当前手机玩家完全无法提交反馈与诊断数据。' },
  map_dominates: { type: 'noul', instructions: '做完所选改动后，地图会重新成为手机第一眼的主体而不是页面的 13%。' },
  one_screen: { type: 'noul', instructions: '改动后手机上"地图 + 必要状态 + 动作条"能同屏，不需要滚动就能开局战斗。' },
};

const PLAN = ROUND === 6
  ? { FACTS: FACTS_R6, QUESTIONS: QUESTIONS_R6, OUT: 'mobile-view-plan.json' }
  : ROUND === 5
  ? { FACTS: FACTS_R5, QUESTIONS: QUESTIONS_R5, OUT: 'mobile-tiebreak.json' }
  : ROUND === 4
  ? { FACTS: FACTS_R4, QUESTIONS: QUESTIONS_R4, OUT: 'mobile-plan.json' }
  : ROUND === 3
  ? { FACTS: FACTS_R3, QUESTIONS: QUESTIONS_R3, OUT: 'fun-tiebreak.json' }
  : ROUND === 2  ? { FACTS: FACTS_R2, QUESTIONS: QUESTIONS_R2, OUT: 'fun-plan.json' }
  : { FACTS: FACTS_R1, QUESTIONS: QUESTIONS_R1, OUT: 'design-plan.json' };
const { FACTS, QUESTIONS } = PLAN;

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
    round: ROUND, at: new Date().toISOString(), model: (json.usage && json.usage.model) || null, latency_ms: Date.now() - t0,
    ...(ROUND === 6 ? {
      board_fit: a.board_fit?.choice, legend_on_mobile: a.legend_on_mobile?.choice,
      data_channel: a.data_channel?.choice, skill_discovery: a.skill_discovery?.choice,
      feedback_unreachable: a.feedback_unreachable?.noul, map_dominates: a.map_dominates?.noul, one_screen: a.one_screen?.noul,
    } : ROUND === 5 ? {
      move_final: a.move_final?.choice, zoom_final: a.zoom_final?.choice,
      needs_confirm_step: a.needs_confirm_step?.noul,
    } : ROUND === 4 ? {
      move_scheme: a.move_scheme?.choice, secondary_actions: a.secondary_actions?.choice,
      wait_turn: a.wait_turn?.choice, board_zoom: a.board_zoom?.choice,
      misinput_risk: a.misinput_risk?.noul, one_handed: a.one_handed?.noul,
      older_than_tap: a.older_than_tap?.noul, impl_one_round: a.impl_one_round?.noul,
    } : ROUND === 3 ? {
      verb_final: a.verb_final?.choice, cut_final: a.cut_final?.choice,
      same_round: a.same_round?.score, verb_final_clear: a.verb_final_clear?.noul,
    } : ROUND === 2 ? {
      core_verb: a.core_verb?.choice, signature_moment: a.signature_moment?.choice,
      cut_candidates: a.cut_candidates?.choice, pacing: a.pacing?.score, ui_art_direction: a.ui_art_direction?.choice,
      readability_after: a.readability_after?.noul, verb_still_one: a.verb_still_one?.noul, worth_building: a.worth_building?.noul,
    } : {
      fun_axis: a.fun_axis?.choice, mech_priority: a.mech_priority?.choice,
      mech_count: a.mech_count?.score, item_count: a.item_count?.score, map_count: a.map_count?.choice,
      spawn_rule: a.spawn_rule?.choice, render_first: a.render_first?.choice,
      readability_risk: a.readability_risk?.noul, needs_tutorial_update: a.needs_tutorial_update?.noul,
    }),
    raw: a,
  };
  fs.writeFileSync(path.join(__dirname, PLAN.OUT), JSON.stringify(plan, null, 2));
  console.log(`\n> 判定已写 harness/${PLAN.OUT}；模型 ` + plan.model + '，一次请求 ' + plan.latency_ms + 'ms。');
  console.log('> 分工：候选是我按本仓"不增加决策就砍掉"的原则生成的，Jev 只做取舍与量级判断；' +
    '它说 4 档不代表一定照办 —— 若与第一性原理冲突，以冲突记录的形式写出来，不静默覆盖。');
})();
