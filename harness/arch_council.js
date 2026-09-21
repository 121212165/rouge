/* 架构议会：用户建议"重构换架构"，让 Jev 连判五轮，每轮九个互斥选项。
   分工照旧：候选与事实由我按本仓可量到的数字生成，Jev 只做约不成规则的取舍；
   任何一轮置信低于 0.34 视为未收敛，必须补一轮两两对决，不许拿硬币正面当决策。
   用法：node harness/arch_council.js --round=1..5 [--endpoint=...] [--json] */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const a = argv.find((s) => s.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const ROUND = +flag('round', 1);
const ENDPOINT = flag('endpoint', process.env.JEV_ENDPOINT || 'http://127.0.0.1:8731/decide');
const AS_JSON = argv.includes('--json');

/* 事实：全部是本仓可复算的数字，不写形容词 */
const BASE = {
  product: '阴阳道 · 回合制网格肉鸽（25x15，10 层，永久死亡），已上线 GitHub Pages，手机浏览器直接打开',
  measured_architecture: {
    index_html_total_lines: 1160,
    inline_script_lines: 839,
    inline_functions: 90,
    inline_top_level_bindings: 172,
    modular_jev_lines: 499,
    inline_to_modular_ratio: '1.7 : 1（不可测的部分比可测的部分还多）',
    render: '每回合重建 #game 的 375 个 <i>（innerHTML 全量替换）',
    randomness: 'Math.random 直接散落在生成/掉落/暴击/分裂等 10+ 处，无注入点，无 seed',
    state: 'player / map / enemies / items / floor / logs / curse / busy / dead 等顶层可变全局，任意函数可改',
    build: '无构建步骤、无依赖、无框架；Pages 直接服务仓库根的 index.html + jev/*.js',
  },
  test_reality: {
    node_unit_tests: 19,
    what_they_cover: '只有 jev/*（判断层与数据表）。node 测试把 index.html 当文本 grep，从不执行游戏逻辑',
    game_rules_unit_coverage: 0,
    how_rules_are_verified: 'Playwright 起真浏览器 + CDP 真 touch 事件（check_mechanics / check_touch / check_interactions / browser_smoke）',
    release_gate: '22 项确定性否决全绿后，才允许问 Jev 判四个模糊维度',
  },
  defect_attribution_this_session: {
    total_real_defects_found: 9,
    attributable_to_inline_blob_and_mutable_globals: 5,
    cases: [
      'TDZ：insight 引用尚未初始化的 jev → 整段内联脚本静默中止，游戏看起来"打不开"但没有任何报错',
      'TDZ 同类复发：renderLegend() 在 const LEGEND 声明之前被调用',
      '补丁错锚：shop_buy 遥测被插进 applyElder，每次长老三选抛 ReferenceError，商店购买永远不上报',
      '一次转义事故把 render() 写成跨行字符串 → SyntaxError，整个游戏无法启动；只有手工 node --check 抓得到',
      '一气连环吸错属性（吸玩家命格而非目标属性）→ 链长恒为 1，玩法表面存在、实际永不触发；因为逻辑 import 不进来，任何单测都无法覆盖',
    ],
    other_defects: '其余 4 个（提示被遮罩挡住 ×2、商店无限购买、诊断数据陈旧）与架构无关，是设计与取证问题',
  },
  hard_constraints: [
    '永久死亡、无存档是刻意的核心设计，不是遗漏（第一性原理重构时按"不产生决策就砍"定的）',
    '默认判断层必须离线可玩：mode=local 且不依赖任何 fetch，这是闸门的一条硬否决',
    '单文件/零构建是它能上 GitHub Pages 且 325KB 首屏的前提之一',
    '已有 22 项确定性闸门 + 4 套浏览器回归，重构期间不能出现"检查还在但已经不再测同一件事"',
  ],
  reported_request: '用户建议：重构换架构。要求连判五次、每次九个选项。',
};

const R = {};

R[1] = {
  out: 'arch-1-target.json',
  title: '第一轮：换成哪种架构',
  questions: {
    target_arch: {
      type: 'choice',
      instructions: '按给定事实，这一轮要把架构换成哪一种？只依据事实判断，不要臆测未提供的信息。',
      criteria: {
        keep_as_is: '不重构：继续只加闸门与回归，接受规则层永远只能靠起浏览器来验',
        esm_split: '拆原生 ES modules（<script type="module">）：只加文件边界与显式 import，零构建零依赖',
        headless_rules: '抽无头规则层：战斗/掉落/气/煞/楼层生成变成可 require 的纯函数，index.html 只剩渲染与输入',
        reducer_state: '单一 state + reducer + action：所有变更走 dispatch，天然可快照可回放',
        ecs: '重构成 ECS（world / component / system），实体与行为彻底解耦',
        framework_build: '上框架与构建（React 或 PixiJS + Vite），换来生态但引入 build 步骤与依赖',
        canvas_render: '逻辑结构不动，只把 DOM 网格换成 canvas 绘制',
        deterministic_first: '先只做确定性 RNG 注入 + 录像回放层，拿到数据后再决定要不要拆、怎么拆',
        data_driven: '把敌人/法宝/楼层/煞气全搬进 JSON 数据表，代码只留一个解释器',
      },
    },
    testability_gain: {
      type: 'score',
      instructions: '所选架构对"让游戏规则能被进程内单测覆盖"这一项的实际收益。',
      criteria: [
        '几乎无收益：规则仍然只能通过起浏览器间接验',
        '小收益：文件边界清楚了，但状态仍全局可变，单测要造大量前置',
        '中收益：核心结算可纯函数化，多数规则缺陷能在毫秒级被抓到',
        '大收益：规则层完全无 DOM 无随机，可枚举输入做表驱动测试',
        '决定性收益：配合确定性 RNG，可以整局回放并逐回合断言',
      ],
    },
    ship_risk: {
      type: 'score',
      instructions: '所选架构在"这一轮做完仍能安全上线"上的风险（分越高越安全）。',
      criteria: [
        '风险极高：触及全部代码，回归面等于整个游戏',
        '风险高：需要重连多处全局状态，现有 22 项闸门有失效风险',
        '风险中：局部搬迁，可分次提交并逐项复验',
        '风险低：只加边界不改行为，现有闸门原样复用',
        '几乎无风险：纯增量，不碰现有执行路径',
      ],
    },
    cost_vs_fun: { type: 'noul', instructions: '这次重构会提升玩家能感觉到的东西（手感、玩法、可读性），而不只是开发者舒适度。' },
    keep_zero_build: { type: 'noul', instructions: '所选架构能保住"零构建、单入口、Pages 直接服务"这三条。' },
  },
};

R[2] = {
  out: 'arch-2-migration.json',
  title: '第二轮：怎么迁过去',
  questions: {
    migration: {
      type: 'choice',
      instructions: '选定目标架构后，用哪种迁移路径？',
      criteria: {
        big_bang: '一次性重写整个 index.html',
        strangler: '绞杀者：一块一块把规则抽出去，页面逐步变薄，每步都可发布',
        parallel_flag: '新旧两套并存，用 URL 参数切换，线上对比一段时间再切默认',
        golden_master: '先用当前版本录一批「固定输入 → 逐回合状态摘要」金样，重构后逐条比对才允许合并',
        tests_before_move: '先给现状补满浏览器级断言，把行为钉死，再动结构',
        vertical_slice: '只先重构一条竖切（例如法宝系统全链路），验证方法学成立再推广',
        freeze_content: '冻结一切内容与玩法开发，直到迁移完成',
        ship_while_migrating: '边上线边迁，每轮只动一个文件，玩法继续推进',
        new_repo: '新仓库重写，老仓库继续只修 bug，直到新版追平',
      },
    },
    rollback: {
      type: 'score',
      instructions: '所选迁移路径的"出问题能多快退回可发布状态"（分越高越易回退）。',
      criteria: ['几乎不可回退：中间态无法运行', '难回退：需要 revert 大量交叉改动', '可回退：每步独立提交且各自可发布', '易回退：新旧并存，一行开关切回', '零风险：纯增量，不删旧路径'],
    },
    steps: {
      type: 'score',
      instructions: '所选路径在"不冻结玩法开发"的前提下需要多少个可发布里程碑。',
      criteria: ['1 个大版本', '2-3 个', '4-6 个', '7-12 个', '12 个以上'],
    },
    gate_integrity: { type: 'noul', instructions: '迁移过程中现有 22 项闸门与 4 套浏览器回归不会出现"还在跑但已不再测同一件事"。' },
    worth_it: { type: 'noul', instructions: '以本作的规模（约 1600 行有效代码），走这条迁移路径的净收益为正。' },
  },
};

R[3] = {
  out: 'arch-3-verification.json',
  title: '第三轮：重构后靠什么保证不弄坏',
  questions: {
    test_arch: {
      type: 'choice',
      instructions: '重构后的验证体系以哪一项为主干？（其余可作补充，但要选出一个真真相来源）',
      criteria: {
        pure_rules_unit: '规则层 node:test 全覆盖：表驱动枚举输入，毫秒级反馈（当前此项覆盖为 0）',
        golden_replay: '固定 seed 跑 N 局，逐回合状态摘要与金样比对',
        headless_dom: 'jsdom/happy-dom 里跑整页，不开浏览器也能验渲染与输入',
        contract_gate: '保持现有 Playwright 闸门为唯一真相，只加断言不改结构',
        property_tests: '随机性质测试：血量单调、资源守恒、可达性不被破坏等不变量',
        mutation_check: '定期故意注入 bug，验证测试确实会红（测"测试有没有用"）',
        dual_run_diff: '新旧实现在同一输入下并跑，diff 每一回合的输出',
        typecheck: '上 TypeScript，把状态形状与非法动作在编译期挡掉',
        runtime_invariants: '运行时不变量断言，线上违约即写进诊断包，靠真实玩家暴露',
      },
    },
    catches_this_session_bugs: {
      type: 'score',
      instructions: '主干验证体系能抓住本会话那 5 个架构归因缺陷中的几个（0-4 分对应 0/1-2/3/4/5 个）。',
      criteria: ['抓住 0 个', '抓住 1-2 个', '抓住 3 个', '抓住 4 个', '抓住全部 5 个'],
    },
    feedback_speed: {
      type: 'score',
      instructions: '主干验证体系给出"红/绿"反馈的速度（分越高越快）。',
      criteria: ['分钟级以上且依赖起浏览器', '分钟级', '十秒级', '秒级', '亚秒级'],
    },
    browser_still_needed: { type: 'noul', instructions: '即使主干换成进程内测试，仍必须保留 Playwright 真浏览器回归才算可发布。' },
    tests_will_lie: { type: 'noul', instructions: '新验证体系会出现"测试还在跑但已经不测原来那件事"的情况（本会话已发生 3 次夹具失真）。' },
  },
};

R[4] = {
  out: 'arch-4-state.json',
  title: '第四轮：状态与随机性模型',
  questions: {
    state_model: {
      type: 'choice',
      instructions: '状态与随机性怎么改？注意"永久死亡、无存档"是刻意设计，不是待补功能。',
      criteria: {
        mutable_ok: '保留顶层可变全局，只加访问边界',
        single_state: '收敛成单一 state 对象，仍然就地修改',
        immutable_reducer: '不可变 state + reducer，历史天然可查',
        seeded_rng: '注入确定性 RNG（替掉散落的 Math.random），可复现任意一局',
        command_log: '只记录玩家指令流，状态由指令重放得出（存档=存指令）',
        snapshot_save: '做状态快照存档 —— 与永久死亡设计直接冲突，需先改设计',
        step_engine: '把回合推进做成显式纯函数 step(state, actions) -> state',
        effect_queue: '结算走效果队列：先算完全部再一次性落地，消除中途读到半更新状态',
        entity_behaviour: '每个实体自带行为对象，敌人 AI 与玩家技能同构',
      },
    },
    reproducible_bugs: {
      type: 'score',
      instructions: '所选模型让"线上报来的某一局能精确复现"的可达程度。',
      criteria: ['无法复现（现状：随机散落且无 seed）', '勉强：需要大量环境假设', '可以：需 seed + 指令流', '容易：仅需指令流', '完全：状态即数据，可直接载入'],
    },
    conflicts_death: { type: 'noul', instructions: '所选模型与"永久死亡、无存档"的核心设计存在冲突，需要同时改设计。' },
    enables_balance_data: { type: 'noul', instructions: '所选模型能直接支撑数值/平衡的批量模拟（现在机器人试玩必须起浏览器，慢且不稳）。' },
    refactor_dependency: { type: 'noul', instructions: '第一轮的架构选择里，若不先做这轮的状态改造，就无法真正落地。' },
  },
};

R[5] = {
  out: 'arch-5-render.json',
  title: '第五轮：渲染架构（素材已经来了）',
  questions: {
    render_arch: {
      type: 'choice',
      instructions: '渲染层换成哪种？事实：CSS 网格 375 格、每回合 innerHTML 全量重建；豆包素材缩到手机实际格宽 14px 会糊，因此当前只用在特效/图例/图标。',
      criteria: {
        keep_dom_grid: '保持现状：CSS 网格 + 每回合全量 innerHTML',
        dom_diff: '复用节点，只重写变化的格子（375 → 通常 <20 个 DOM 写）',
        canvas_2d: '地图改 canvas 2D 绘制，UI 仍是 DOM',
        webgl_pixi: 'WebGL / PixiJS，为缩放与粒子特效铺路',
        sprites_in_cells: '保留 DOM 网格，把字形换成素材底图（需先解决 14px 糊的问题）',
        hybrid_layers: '分层：静态地形一层、实体一层、特效一层，各自独立重绘',
        fx_layer_only: '只把引爆/飘字/震屏挪到独立特效层，其余不动',
        responsive_board: '按视口动态调整行列（会改动关卡结构与既有夹具）',
        offscreen_worker: 'OffscreenCanvas + worker 渲染，主线程只管输入与规则',
      },
    },
    perf_headroom: {
      type: 'score',
      instructions: '所选渲染层给"同屏实体与特效数量"留出的余量（分越高余量越大）。',
      criteria: ['无余量，当前已接近上限', '小', '中', '大', '基本不是瓶颈了'],
    },
    legibility_risk: { type: 'noul', instructions: '所选渲染层会让格子可读性变差（本会话 Jev 选 pixel_dao 的唯一理由就是格子边界清晰）。' },
    fx_payoff: { type: 'noul', instructions: '所选渲染层能显著提升"一气连环"这类招牌玩法的可见性（Jev 判 verb_final_clear 仅 0.18）。' },
    final_verdict: { type: 'score', instructions: '综合五轮，现在做这次架构重构的总体净收益。', criteria: ['净负：会引入新缺陷且玩家无感', '接近零', '小正', '明确正', '显著正：不做会成为后续内容扩张的瓶颈'],
    },
    ship_now: { type: 'noul', instructions: '在动任何架构之前，本作当前状态就可以直接放给真人试玩收集数据（重构会推迟这件事）。' },
  },
};


R[6] = {
  out: 'arch-6-tiebreak.json',
  title: '第六轮：两两对决（第一、二轮未收敛）+ 顺序问题',
  questions: {
    target_final: {
      type: 'choice',
      instructions: '三选一。判据只用一条："下一个功能加进来时，不打开浏览器就能知道自己把它弄坏了"。',
      criteria: {
        headless_rules: '抽无头规则层（第一轮 0.36）',
        esm_split: '只拆原生 ES modules（第一轮 0.34）',
        keep_as_is: '不拆，继续只加闸门（第一轮 0.21）',
      },
    },
    migration_final: {
      type: 'choice',
      instructions: '二选一。判据只用一条："做到一半停下来，当天还能不能发布"。',
      criteria: {
        strangler: '绞杀者：一块块抽，每步可发布（第二轮 0.37）',
        golden_master: '先录金样再改，逐条比对才允许合并（第二轮 0.30）',
      },
    },
    do_now: {
      type: 'choice',
      instructions: '这一轮实际做什么？第四轮已收敛于 seeded_rng（0.56），第五轮收敛于 dom_diff（0.51），第一轮的目标架构未收敛且 ship_risk 判为极高（0.29/4，置信 0.76）。',
      criteria: {
        ship_first: '什么都不改，先把当前版本推给真人收数据（ship_now 0.67）',
        seed_only: '只做确定性 RNG 注入：最小、可回退、让"这一局"可复现',
        seed_and_diff: 'seeded_rng + dom_diff：加上渲染层只重绘变化的格子',
        seed_then_rules: '先 seeded_rng，紧接着抽无头规则层（把 seed 当成金样回放的前置）',
        full_refactor: '直接按第一轮结论做架构重构',
      },
    },
    order_wrong: { type: 'noul', instructions: '在拿到真人试玩数据之前先做架构重构，是错的顺序。' },
    seed_enables_safety: { type: 'noul', instructions: '有了确定性 seed，金样回放才可能成立，后续任何重构才有安全网 —— 即 seed 是重构的前置而非替代。' },
    big_bang_rejected: { type: 'noul', instructions: '对这个规模（约 1600 行有效代码）的项目，一次性换架构的期望收益低于其引入新缺陷的概率。' },
  },
};

const SPEC = R[ROUND];
if (!SPEC) { console.error('只有 --round=1..6'); process.exit(2); }

(async function main() {
  const t0 = Date.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: { ...BASE, round: ROUND, title: SPEC.title }, questions: SPEC.questions }),
  });
  if (!res.ok) { console.error('桥不可用：HTTP ' + res.status + '（先起 JEV_UPSTREAM=typesafe py -3.12 jev_bridge.py）'); process.exit(1); }
  const json = await res.json();
  const a = json.answers || {};
  const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(2) : v);
  const rows = [];
  for (const key of Object.keys(SPEC.questions)) {
    const x = a[key] || {};
    const probs = x.probabilities || {};
    const ranked = Object.entries(probs).sort((p, q) => q[1] - p[1]);
    const val = x.choice || (x.score != null ? `${x.score} / 4 档` : fmt(x.noul));
    rows.push({ key, val, conf: x.confidence, top: ranked.slice(0, 3).map(([k, v]) => `${k} ${fmt(v)}`).join('  ') });
  }
  const plan = { round: ROUND, title: SPEC.title, at: new Date().toISOString(),
    model: (json.usage && json.usage.model) || null, latency_ms: Date.now() - t0,
    answers: Object.fromEntries(rows.map((r) => [r.key, r.val])),
    confidence: Object.fromEntries(rows.map((r) => [r.key, r.conf])), raw: a };
  fs.writeFileSync(path.join(__dirname, SPEC.out), JSON.stringify(plan, null, 2));

  if (AS_JSON) { console.log(JSON.stringify(plan, null, 2)); return; }
  console.log(`\n# 架构议会 · ${SPEC.title}\n`);
  console.log('| 问题 | 结论 | 置信 | 前三分布 |');
  console.log('|---|---|---|---|');
  for (const r of rows) {
    const low = r.conf != null && r.conf < 0.34 ? ' ⚠未收敛' : '';
    console.log(`| ${r.key} | ${r.val} | ${r.conf == null ? '—' : fmt(r.conf)}${low} | ${r.top} |`);
  }
  console.log(`\n> 写 harness/${SPEC.out}；模型 ${plan.model}，一次请求 ${plan.latency_ms}ms，`
    + `${(json.usage && json.usage.input_tokens) || '?'} 输入 token。`);
  console.log('> 带 ⚠ 的行置信低于 0.34：视为未收敛，需要补一轮两两对决，不能直接照办。');
})();
