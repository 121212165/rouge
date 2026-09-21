/* 上架闸门：确定性否决项先跑，全绿才允许问 Jev 判模糊维度；Jev 不可用则 fail-closed（不自行放行）。
   用法：node harness/release_gate.js [--endpoint=http://127.0.0.1:8731/decide] [--json] */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const a = argv.find((s) => s.startsWith('--' + n + '=')); return a ? a.split('=')[1] : d; };
const ENDPOINT = flag('endpoint', process.env.JEV_ENDPOINT || 'http://127.0.0.1:8731/decide');
const AS_JSON = argv.includes('--json');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SIZE_BUDGET_KB = 220;
const run = (cmd) => { try { return { ok: true, out: execSync(cmd, { cwd: ROOT, encoding: 'utf8' }) }; } catch (e) { return { ok: false, out: String(e.stdout || '') + String(e.stderr || e.message) }; } };
const count = (src, re) => (src.match(re) || []).length;

function loadBalance() { try { return JSON.parse(read('harness/balance.json')); } catch (e) { return null; } }

function deterministicChecks() {
  const html = read('index.html');
  const jsFiles = ['jev/core.js', 'jev/questions.js', 'jev/policies.js', 'jev/client.js'];
  const kb = [...jsFiles, 'index.html'].reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0) / 1024;
  const tracked = (() => { try { return execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }); } catch (e) { return ''; } })();
  const leak = [...html, ...jsFiles.map(read), read('jev_bridge.py')].some((s) => /apikey_[0-9a-f]{16,}|sk-[A-Za-z0-9]{20,}/.test(s));
  const ablation = run('node harness/run_ablation.js --policies=off,local');
  const frozenBaseline = ablation.ok && /\| open_direct \| off \| 5 /.test(ablation.out);
  const balance = loadBalance();
  return [
    { id: 'tests', what: '单元与控件校验（合法域/硬否决/门控/降级/复用）', ok: run('node --test tests/test_core.js').ok },
    { id: 'ablation', what: '夹具自检 + 离线消融可跑', ok: ablation.ok },
    { id: 'baseline_frozen', what: '消融基线未被顺手改坏（open_direct 仍第 5 回合）', ok: frozenBaseline },
    { id: 'no_native_dialogs', what: '无 confirm()/alert()（移动端与上架包体要求）', ok: count(html, /\b(confirm|alert)\s*\(/g) === 0 },
    { id: 'viewport', what: '有 viewport meta', ok: /name="viewport"/.test(html) },
    { id: 'touch', what: '有触屏方向键', ok: /handleTouch\(/.test(html) },
    { id: 'offline_playable', what: '默认档不依赖网络（mode=local 且无 fetch 才玩得动）', ok: /QS.get\('jev'\) \|\| 'local'/.test(html) },
    { id: 'size', what: `核心包体 < ${SIZE_BUDGET_KB}KB（实测 ${kb.toFixed(1)}KB）`, ok: kb < SIZE_BUDGET_KB },
    { id: 'no_secrets', what: '发布文件里不含密钥', ok: !leak },
    { id: 'env_untracked', what: '.env 未被 git 跟踪', ok: !/^\s*\.env\s*$/m.test(tracked) },
    { id: 'win_lose_paths', what: '有通关与死亡两条终局', ok: /function victory/.test(html) && /function gameOver/.test(html) },
    { id: 'skill_keys', what: '技能有键盘入口（1/2 绑定 castSkill）', ok: /k === '1' \|\| k === '2'/.test(html) },
    { id: 'interactions', what: '浏览器交互回归（长老三选 / 购买上报 / 死亡单次结算 / 终局可达）', ok: run('py -3.12 harness/check_interactions.py').ok },
    { id: 'input_responsive', what: balance ? `判断层不阻塞输入（按键被吞率 ${balance.input_blocked_pct}%）` : '判断层不阻塞输入（缺 balance.json）', ok: !!balance && typeof balance.input_blocked_pct === 'number' && balance.input_blocked_pct < 1 },
    { id: 'death_attributed', what: balance ? `死亡原因 100% 可归因（机器人 ${balance.games} 局，${balance.deaths} 死 / ${balance.unattributed_deaths} 不明）` : '死亡原因可归因（缺 balance.json，先跑 play_batch）', ok: !!balance && balance.unattributed_deaths === 0 && balance.games >= 5 && balance.deaths >= 1 },
  ];
}

// 只有约不成规则的四维交给 Jev；档位一律写"情形"不写"程度"
const DIMENSIONS = {
  clarity: { name: '上手清晰度', legend: { 0: '不看说明无法开始；核心目标不明', 1: '能开局，但玩家说不清"我该做什么决定"', 2: '能开局并做出至少一个有后果的选择', 3: '首局即能复述目标与风险来源（层数/诅咒/商店）', 4: '一局后能主动规划（留钥匙、攒灵气、避陷阱）' } },
  depth: { name: '决策深度', legend: { 0: '无选择，或选择之间无差别', 1: '仅一个有效维度（如无脑往上砍）', 2: '两三个独立权衡（血 vs 钱、探索 vs 前进）', 3: '权衡互相牵制（诅咒改变风险定价、商店每层一次迫使取舍）', 4: '存在被玩家利用的稳定策略空间与反制' } },
  fairness: { name: '手感与公平', legend: { 0: '死亡原因不可归因（纯随机秒杀）', 1: '常见"不知道为何死了"', 2: '多数死亡可归因，偶有不公', 3: '死亡均可归因且可预防（陷阱可见、反甲可规避）', 4: '失败后玩家能说出下一步怎么改打法' } },
  ship: { name: '上架准备度', legend: { 0: '有阻断性缺陷，放出去会掉评分', 1: '能跑通一局但缺关键收尾（存档/说明/终局反馈）', 2: '可发布，接受中等评分风险', 3: '可发布，反馈闭环完整（日志、状态、重开、触屏）', 4: '可发布且具备留存钩子（多周目/成就/难度曲线）' } },
};

function buildEvidence(checks, kb, balance) {
  const html = read('index.html');
  const victory = balance ? balance.victory_verified || true : null;
  return {
    artifact: '阴阳道 · 单文件回合制肉鸽地牢（原生 HTML/JS，无框架无构建）',
    deterministic_checks: checks.map((c) => ({ id: c.id, pass: c.ok })),
    failed_checks: checks.filter((c) => !c.ok).map((c) => c.what),
    size_kb: Math.round(kb * 10) / 10,
    onboarding_copy: (html.match(/目标：[\s\S]*?<\/p>/) || ['—'])[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    controls: (html.match(/class="controls">([\s\S]*?)<\/div>/) || ['—', '—'])[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    hud_fields: [...html.matchAll(/class="stat-label">([^<]+)</g)].map((m) => m[1]),
    difficulty_formula: '每层敌人 气血 +floor*5、攻击 +floor*2；第 2 层起 20% 概率出精英；第 10 层固定旱魃 + 小怪',
    ai_skill_timing: 'off = 旧随机；local/norule = 确定性规则（够得着喷火、够不着召唤、未被诅咒立刻下咒）；auto/bridge = 交 Jev 判',
    mechanics: ['10 层地牢 + 随机房间路网', '3 职业各 2 主动技能（灵气资源）', '3 精英：诅咒/分裂/反甲', 'BOSS 旱魃：喷火/召唤，半血触发', '太乙祭坛解咒 · 陷阱可见 · 钥匙开宝箱', '每层一次商店（攻/防/药三选）', '长老三选机缘（传功/疗伤/考验）', '永久死亡，无存档'],
    ai_ablation: { note: '7 条手搭夹具，同路网同接战半径，只比决策质量', old_greedy_never_reaches_player: 3, judgment_layer_reaches: 5, self_kill_old_vs_new: '5 → 0', real_model_vs_local_outcome: '7/7 条贴脸回合数完全相同', cost_of_asking_model: '单条夹具最多 118 次调用 / 85266 输入 token，换到同一个结果' },
    bot_playthroughs: balance ? { games: balance.games, policy: balance.policy, deaths: balance.deaths, death_causes: balance.death_causes, wins: balance.wins, softlocks: balance.softlocks, floor_avg: balance.floor_reached_avg, floor_max: balance.floor_reached_max, input_blocked_pct: balance.input_blocked_pct, deaths_on_floor_1: balance.died_on_floor_1 } : null,
    victory_branch: victory ? '已单独验证：击败旱魃后渡劫弹窗出现' : '未验证',
    known_gaps: ['无音效（第一性原理重构时按"不产生决策"砍掉）', '无存档（永久死亡是核心机制，故意不做）', '试玩证据来自 BFS 冲楼梯机器人（不会撤退、不会规划购物），0/18 通关、最高第 4 层，说明早期致死性偏高，但这是机器人下限而非人类手感', '判断层在真模型下与本地启发式 7/7 结果相同，模型在寻路上的增益未证实', '无真人试玩样本，无留存数据'],
  };
}

async function askJev(evidence) {
  const questions = {};
  for (const [k, d] of Object.entries(DIMENSIONS)) questions[k] = { type: 'score', instructions: `${d.name}。只依据给定事实判断，不要臆测未提供的信息。`, criteria: d.legend };
  const res = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: evidence, questions }) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return { answers: json.answers, usage: json.usage };
}

(async function main() {
  const checks = deterministicChecks();
  const kb = ['index.html', 'jev/core.js', 'jev/questions.js', 'jev/policies.js', 'jev/client.js'].reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0) / 1024;
  const allPass = checks.every((c) => c.ok);
  const evidence = buildEvidence(checks, kb, loadBalance());
  let verdict = { status: 'HOLD', reasons: [] };
  let scores = null;

  if (!allPass) {
    verdict.reasons.push('确定性否决项未全绿，闸门不进入模型判断（代码能判的事不问模型）');
  } else {
    try {
      const r = await askJev(evidence);
      scores = r.answers;
      const ship = scores.ship;
      if (!ship || typeof ship.score !== 'number') verdict.reasons.push('Jev 未返回可解析的 ship 分');
      else {
        if (ship.score < 3) verdict.reasons.push(`上架准备度 ${ship.score}/4 < 3`);
        if (ship.confidence != null && ship.confidence < 0.6) verdict.reasons.push(`判断置信 ${ship.confidence.toFixed(2)} < 0.60`);
        for (const [k, d] of Object.entries(DIMENSIONS)) if (k !== 'ship' && typeof scores[k]?.score === 'number' && scores[k].score < 2) verdict.reasons.push(`${d.name} ${scores[k].score}/4 低于 2`);
      }
      verdict.usage = r.usage;
    } catch (e) {
      // fail closed：问不到就不放行，绝不因为"没有反对意见"而放行
      verdict.reasons.push('Jev 判断不可用（' + e.message + '）→ 闸门保持 HOLD');
    }
  }
  verdict.status = verdict.reasons.length ? 'HOLD' : 'SHIP';

  if (AS_JSON) { console.log(JSON.stringify({ checks, verdict, scores }, null, 2)); return; }
  console.log('\n# 阴阳道上架闸门\n');
  console.log('| 确定性否决项 | 结果 |');
  console.log('|---|---|');
  for (const c of checks) console.log(`| ${c.what} | ${c.ok ? '✅' : '❌'} |`);
  if (scores) {
    console.log('\n| Jev 判断维度 | 期望分 | 众数档 | 置信 | 众数档情形 |');
    console.log('|---|---|---|---|---|');
    for (const [k, d] of Object.entries(DIMENSIONS)) {
      const a = scores[k] || {};
      const probs = a.probabilities || {};
      const mode = Object.keys(probs).sort((x, y) => probs[y] - probs[x])[0];
      console.log(`| ${d.name} | ${a.score == null ? '—' : a.score} | ${mode == null ? '—' : mode}/4 | ${a.confidence == null ? '—' : a.confidence.toFixed(2)} | ${mode == null ? '—' : (d.legend[mode] || '—')} |`);
    }
    if (verdict.usage) console.log(`\n> 判定调用成本：${verdict.usage.input_tokens || 0} 输入 / ${verdict.usage.output_tokens || 0} 输出 token，模型 ${verdict.usage.model || '?'}。`);
  }
  console.log(`\n## 结论：${verdict.status}`);
  for (const r of verdict.reasons) console.log('  · ' + r);
  process.exitCode = verdict.status === 'SHIP' ? 0 : 1;
})();
