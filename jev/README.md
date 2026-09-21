/* 判断层（Jev layer）——把敌人 AI 从"一条硬编码贪心"换成"确定性世界 + typed 决策"。

## 一句话职责表

代码决定**有什么**（可走格、视线、绕行步数、反甲会不会把自己弹死），
判断层决定**怎么办**（压上 / 绕行 / 脱离 / 攻击 / 原地）。
模型永远只输出编号（`step_3`、`strike`、`hold`），落地前还要过一次真实格子校验。

## 三档模式（按 J 键循环，或 ?jev=local|off|bridge）

| 模式 | 干什么 | 用途 |
|---|---|---|
| `off` | 逐条复刻重构前的旧贪心（单一曼哈顿方向、撞墙即停、技能 30% 随机） | **免费消融基线**，不调任何 API |
| `local` | 零网络确定性启发式，吃同一份 state、同一套硬否决 | 默认档，也是网络档的降级路径 |
| `norule` | 寻路一律 `local`（0 次调用），只在"代码本来没规则"处问 Jev | **推荐的上架配置** |
| `auto` | 寻路在**模拟差值大**时才升级问 Jev（`?stake=N` 调阈值） | 研究用：量化"多花钱买到什么" |
| `bridge` | 每个决策都问 Jev | 上限对照 |

### 慢层只建议，快层立即行动

网络档**不 await 回合线程**。实测一次 `/decide` p50 ~470ms；早期版本把它放进敌人回合，
输入锁 `busy` 期间 **95% 的按键被丢弃**（机器人追踪：175 步里 166 步原地不动）。
现在答案晚一回合落地——本回合先按 `local` 行动，后台发问，下回合把回来的答案再过一遍
合法域与重校验才采用。这是 jev-drone 那张"500Hz 反射 / 2.5Hz Jev 建议"职责表的直接搬运。
回归防线：`harness/play_batch.py` 统计按键被吞率，闸门要求 < 1%（现测 0.0%）。

### 无规则决策走 `judge()`

长老三选（传功/疗伤/考验）与精英·BOSS 技能时机是代码本来就没规则的地方：`off` 保留旧随机作对照，
`local/norule` 用有理由的确定性规则（够得着喷火、够不着召唤、未被诅咒立刻下咒），
`auto/bridge` 交 Jev 判；问不到、标签非法或置信不足一律回旧规则，不猜。

## 文件

- `core.js` — 纯函数世界：`legalActions` / `observe` / `fingerprint` / `applyStep` / `flowField`。无 DOM、无网络、无 `Math.random`，浏览器与 Node 同构。
- `questions.js` — typed 问题包 + "代码决定何时问"（超出接战半径或无可选项就不发请求）。
- `policies.js` — `baseline` / `local` / `gate`。`gate` 是纯函数，可用合成答案离线单测。
- `client.js` — 三档出口、置信度门、指纹复用、执行前重校验、遥测与降级计数。
- `gamedata.js` — 五行相克环、10 件法宝、8 种煞气异变与品阶表。纯数据、浏览器与 Node 同构，渲染/结算/图例/掉落共用这一份。
- `../jev_bridge.py` — 静态服务器 + `/decide`，上游可切 `adapter`（开源 drop-in）/ `typesafe`（官方云）/ `stub`（零 key 验管道）。
- `../harness/` — 夹具与消融跑器、浏览器冒烟、机制回归（`check_mechanics.py`）、设计议会（`design_council.js`）、截图（`shot.py`）。

## 从 JEV 生态普查（B2 游戏/实时决策批）搬来的五件事

| 来源 | 搬过来的做法 | 落在哪 |
|---|---|---|
| `romanslack/jev-drone` | **state 必须包含答案**：旧贪心卡死不是模型笨，是喂进去的东西里没有"墙在哪" | `core.flowField` → 每个动作带 `viaAfter`（绕行几步可达），`observe.judgment.reachable_via_steps` |
| `romanslack/jev-drone` | **硬否决优先于置信度**：物理过不去的事，置信度 0.99 也不放行 | `legalActions` 的 `vetoes`（反甲反弹致死 → 不给 strike 选项，也不问） |
| `romanslack/jev-drone` | **免费消融基线**：宣称增益必须带无 Jev 对照，负面结果照报 | `?jev=off` + `harness/run_ablation.js` |
| `browser-use/jev-ultrafast` | **合法域预过滤**：只把兼容选项端给模型，不给它幻想的空间 | `offered` 集 = Choice 的 criteria，`gate` 拒绝任何不在集合里的标签 |
| `browser-use/jev-ultrafast` | **投机多头单往返**：一次请求同时问"选哪个动作 + 该不该压上 + 该不该脱离" | `questions.build` 的 `action`/`press`/`disengage` |
| `romanslack/jev-drone` | **按问题选原语**：Choice 犹豫时不 argmax，改用同请求的 Noul 头门控 | `policies.gate` 的 `noul_press` / `noul_disengage` 路径 |
| `owner-B/heist-one` | 决策遥测固定字段：evidence / proposed / applied / latency / fallback | `client.track` 写 `jev.telemetry`，顶栏 chip 显示调用与回退数 |

没搬的：ultrafast 的"单样本换延迟"用在评测采样上（我们要的是稳定校准分数）；
指纹复用在盲审协议里（会污染独立性）——这里只用于生产 gate。

## 内容扩充这一轮：数量与规则交给 Jev 定

用户诉求是"玩法有限、纯爽、加机制加道具加地图、让 Jev 决策"。`harness/design_council.js`
把 8 个问不成的问题一次发给 `jev-1.13.0`，结果写进 `harness/design-plan.json`：

| 问题 | 答案 | 置信 | 落地 |
|---|---|---|---|
| 爽点主轴 | `build`（构筑） | 0.63 / 0.71 | 五行命格 + 法宝 + 煞气三选，全部围绕"这局怎么组" |
| 加几条机制 | 2.04 | 0.27 | 只做 2 条：五行克制、煞气构筑 |
| 道具条数 | 1.3（=8-10 种） | 0.32 | 10 件法宝（5 主动带充能 / 5 被动改规则），不做第 11 件 |
| 新地图 | `m0`（0 张） | 0.30 | 一张不加，把渲染和机制密度先做好 |
| 掉落规则 | `risk_reward` | **1.00** | 见下 |
| 先修什么 | `wall_noise` | **1.00** | 地图从 `<pre>` 文本流改成 CSS 网格 + 实色墙体 |
| 可读性风险 | 0.68 | — | 闸门新增 `readability_sync`：新机制不进图例/教程就是缺陷 |

**风险定价是量出来的，不是写出来的。** `harness/check_mechanics.py` 跑 80 次楼层生成，
统计各品阶落点危险度：凡品 0.91 < 灵品 2.40 < 仙品 4.08。想拿 `❖` 就得穿过精英堆。

**这一轮最值钱的是一条负结果。** 煞气原本"每 6 杀触发"，12 局机器人试玩 **0 次触发**
（机器人平均一局只杀 1.5 个）——也就是说这个构筑轴对不主动找架打的玩家等于不存在。
改成单一计数器双来源（每杀 +1、每下一层 +2，满 4 触发）后 12 局 **10 次**。
第一层的法宝掉落也从纯随机改成保底一件凡品落在安全带，否则"道具驱动玩法"永远停在文档里。

顺带抓到一个自己写的 harness bug：机器人 BFS 用八向，但按键映射只有四向，
斜格首步被压成水平方向后正好撞墙 → `move()` 早退、回合不推进 → 状态不变 → 同一路径无限空转，
900 步原地踏步还把 floor 均值稀释成 1.0。BFS 改回四向，并加了"状态 60 步不变即判软锁"的兜底。

## 第二、三轮：用户说"不太好玩，没有亮眼玩法"

第一轮补齐了构筑轴，但**核心动词一个都没变**——还是"撞上去打一下"。
第二轮把这条如实写进事实里喂给 Jev（`--round=2` → `fun-plan.json`）：

| 问题 | 结论 | 置信 |
|---|---|---|
| signature_moment | **none_yet**（当前没有任何可复述的招牌时刻） | 0.79 |
| verb_still_one | 不改核心动词、只加系统数量，"腻"不会缓解 | **0.87** |
| core_verb | terrain_bind 0.34 vs qi_chain 0.30 | 0.21 —— 没收敛 |
| cut_candidates | cut_elder_altar 0.31 vs merge_loot 0.29 | 0.14 —— 没收敛 |
| ui_art_direction | pixel_dao（16-bit 像素 + 高饱和符箓色块） | 0.46 |

两个关键问题都是硬币正面，所以按"按问题选原语"的做法补了第三轮（`--round=3` →
`fun-tiebreak.json`）：**两两对决 + 换一个更利的判据**（"完全没读教程、只玩 60 秒的玩家
能不能凭屏幕变化感觉到它在生效"）。

| 问题 | 结论 | 置信 |
|---|---|---|
| verb_final | **qi_chain 0.91** vs terrain_bind 0.09 | 0.82 —— 收敛了 |
| cut_final | cut_none 0.41 | 0.12 —— 仍未收敛，按保守默认：这轮什么都不砍 |
| same_round | 玩法与美术**同轮**做完 | 0.86 |
| verb_final_clear | 选定玩法能在 60 秒内被无教程玩家感知 | **0.18 —— 它自己都不信** |

`worth_building 0.30` + `verb_final_clear 0.18` 是这一轮最该记住的两个数：
模型选了方向，但明说它怀疑这个方向**感知不到**。所以实现的一多半工作量花在可见性上
（链条仪表、命格描边、盈态脉冲、引爆闪屏与震屏），而不是数值。

落地的一气连环：每打中一个敌人吸**它**的属性，下一口必须被上一口**相生**
（金→水→木→火→土→金）才续得上，接不上重开成 1 口不清零；串满 3 口下一击自动引爆
2.2 倍 + 波及周围 2 格。实测 15 → 15 → 41。

> 实现过程中抓到自己一个真 bug：第一版吸的是**玩家**属性，而玩家命格在换煞气前是固定的
> → 相生条件永远不成立 → 链条长度恒为 1，玩法表面存在、实际永不触发。
> 改成吸目标属性才对。这条记在这里，因为"看起来跑通了"和"真的会触发"是两回事。

## 第四、五轮：手机端交互（用户："点击太老了"）

判据先补外部事实：Shattered Pixel Dungeon **v4.0.0（2026-09-09，移动端网格肉鸽的参照物）
至今仍是 tap-to-move**，而 2026-02 有玩家开帖问 "Is there an alternative to tap to move?"
—— 主流方案没被换掉，但确实有人在抱怨。

第四轮（`--round=4` → `mobile-plan.json`）七个问题四个候选：

| 问题 | 结论 | 置信 |
|---|---|---|
| secondary_actions | **bottom_bar 0.74** | 0.67 —— 收敛 |
| wait_turn | **tap_self 0.64**（点自己脚下 = 等待） | 0.54 —— 收敛 |
| move_scheme | drag_path 0.33 vs **keep_dpad 0.32** vs tap_path 0.15 | 0.21 —— 没收敛 |
| board_zoom | keep 0.35 vs auto_focus 0.34 | 0.13 —— 没收敛 |
| **older_than_tap** | 所选方案真的比固定十字键更现代，而不只是给同样的点击换个手势外壳 | **0.33** |
| misinput_risk | 会造成不可挽回的误触 | 0.58 |
| one_handed | 单手拇指可完成全部操作 | 0.36 |

`older_than_tap 0.33` 是直接打在用户前提上的：**模型认为"新手势比点击更现代"只有三成把握**，
而且它把"保留十字键"投到了和新方案几乎同分。第五轮（`--round=5` → `mobile-tiebreak.json`）
把判据从"哪个更现代"换成"哪个错了还能救"：

| 问题 | 结论 | 置信 |
|---|---|---|
| move_final | **radial_hold 0.87**（swipe_dir 0.12、drag_path 0.01） | 0.82 —— 收敛 |
| zoom_final | **keep 0.95**（保持一屏全图，不缩放） | 0.93 —— 收敛 |
| needs_confirm_step | 跨多格输入必须先预览再确认 | 0.61 |

落地：跟随手指的**八向罗盘**（按住 130ms 或拖过 10px 弹出，拖到方向**松手才生效**，
拖回中心 = 待一回合）+ 底部动作条（技能 / 法宝 / 待一回合）+ 点自己脚下 = 等待。
八向顺带补上了一个一直没被注意的不对称：**敌人 AI 用 `core.DIRS` 的 8 个方向，玩家只有 4 个**。
旧固定十字键是**删掉**而不是留着，否则只是把拇指热区挤得更满。

顺带两件事：
- 事实里我写的"每格 26px"是错的 —— 390px 视口下实测**每格只有 14px**，远低于 44px 拇指目标。
  罗盘恰好绕开这个问题（它不要求点中格子），但这条要如实记着，别拿错的尺寸去做后续决策。
- `check_touch.py` 第一版拿"拖 1.6 格"当输入，结果正好落进罗盘 26px 的"待"死区，
  测出"拖了不动"。罗盘判定半径是**像素**不是格子，测试必须按像素拖。

## 冒烟测试自己长期在说谎

`browser_smoke.py` 的 `bridge` 档原来要求"零回退"，实测是 asks 119 / calls 3 / **fallbacks 105（88%）**
—— 机器人 25ms 一步，网络档几乎每一步都等不到答案，那正是非阻塞建议层的既定行为，
拿它判 FAIL 是断言写错了，之前偶尔 PASS 纯属运气。`local/off` 档原来要求"这一局被打到"，
取决于随机地牢和机器人会不会半路死掉，实测 1/4 长尾失败。

现在按模式定责：`local/bridge` 要求"敌人动过 ≥3 种布局且零非法动作"（验判断层的契约），
`off` 只要求"不崩、零非法动作"（它是冻结对照组，追不上人正是它的既定行为）。
连跑 5 次 5/5 稳定。**网络档的回退率现在直接打印出来，因为那个数字本身就是"默认档必须是 local"的量化理由。**

## 已知边界（别当成已验证）

- 真模型（`JEV_UPSTREAM=typesafe`，实测 `jev-1.13.0`）在 7 条夹具上**与 `local` 贴脸回合数完全一致**：答案已在 state 内时，模型相对确定性启发式的边际增益为 0。实测代价 p50 479–550 ms、最差 1988 ms、约 700–900 输入 token/次，整轮消融约 17.8 万输入 token。
- 因此默认档是 `local`。`bridge` 只该用在约不成确定性规则的判断上（事件两难、叙事风险、观战自动通关），不该用在网格寻路上。
- `kite_ambiguous` 一列真模型直采率 0（置信不足 → 绕 Noul 头 → 落到启发式），这条也照报。
- 精英/BOSS 的技能时机已进判断层（`judge()`），但 `off` 档仍保留旧随机作对照。
- 指纹复用早期只会命中 `hold` → 原地锁死（`snake_long` 从第 19 回合退化为永不接敌）；
  现在 `hold` 不复用、改判 `local` 保底，`hold_breaks` 计数。
- **上架闸门（`harness/release_gate.js`）当前判 HOLD**：15 项确定性检查全绿，Jev 给"上架准备度"
  2.31/4（置信 0.56），指认卡点是**缺真人试玩证据**（0.53）；追问下它认为"加回成就/多周目"
  （0.19）与"补真人试玩数据"（0.17）都不足以变成无风险可发布。后两问用的是"无风险"口径，
  比闸门 3 档定义更严，但方向一致：**剩下的风险不在仓库里，靠改代码消不掉**。
- 消融是**确定性单跑、无 seed 重复**，只比"够不够得到玩家"，不比战斗胜率（伤害结算没进夹具）。

## 怎么跑

```bash
node --test tests/test_core.js tests/test_gamedata.js   # 无网络、无模型，验真实控件与数据表
node harness/run_ablation.js --policies=off,local
JEV_UPSTREAM=stub py -3.12 jev_bridge.py        # 起桥（同进程兼作静态服务器）
node harness/run_ablation.js --policies=off,local,bridge
py -3.12 harness/browser_smoke.py               # 真键盘打一局，三模式各验各的
py -3.12 harness/check_mechanics.py             # 法宝逐件生效 + 煞气三选 + 风险定价分布
py -3.12 harness/check_touch.py                 # 真 touch 事件驱动八向罗盘（走一格/斜向/取消/等待）
py -3.12 harness/play_batch.py 12               # 机器人试玩，写 harness/balance.json（含触发率）
py -3.12 harness/shot.py play                   # 桌面 + 390 窄屏截图，附带网格对齐自检
node harness/design_council.js --round=2         # 可玩性：招牌玩法与美术方向
node harness/design_council.js --round=3         # 两两对决打破第二轮的硬币正面
node harness/release_gate.js                    # 18 项确定性否决全绿才问 Jev 判模糊维度
# 浏览器： http://127.0.0.1:8731/?jev=bridge    按 J 切档
```
