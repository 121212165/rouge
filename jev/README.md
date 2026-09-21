/* 判断层（Jev layer）——把敌人 AI 从"一条硬编码贪心"换成"确定性世界 + typed 决策"。

## 一句话职责表

代码决定**有什么**（可走格、视线、绕行步数、反甲会不会把自己弹死），
判断层决定**怎么办**（压上 / 绕行 / 脱离 / 攻击 / 原地）。
模型永远只输出编号（`step_3`、`strike`、`hold`），落地前还要过一次真实格子校验。

## 三档模式（按 J 键循环，或 ?jev=local|off|bridge）

| 模式 | 干什么 | 用途 |
|---|---|---|
| `off` | 逐条复刻重构前的旧贪心（单一曼哈顿方向、撞墙即停） | **免费消融基线**，不调任何 API |
| `local` | 零网络确定性启发式，吃同一份 state、同一套硬否决 | 默认档，也是 bridge 掉线时的降级路径 |
| `bridge` | POST `/decide` 问 Jev（Choice + 两个 Noul 头，一次往返） | 真判断，需要桥 |

## 文件

- `core.js` — 纯函数世界：`legalActions` / `observe` / `fingerprint` / `applyStep` / `flowField`。无 DOM、无网络、无 `Math.random`，浏览器与 Node 同构。
- `questions.js` — typed 问题包 + "代码决定何时问"（超出接战半径或无可选项就不发请求）。
- `policies.js` — `baseline` / `local` / `gate`。`gate` 是纯函数，可用合成答案离线单测。
- `client.js` — 三档出口、置信度门、指纹复用、执行前重校验、遥测与降级计数。
- `../jev_bridge.py` — 静态服务器 + `/decide`，上游可切 `adapter`（开源 drop-in）/ `typesafe`（官方云）/ `stub`（零 key 验管道）。
- `../harness/` — 夹具与消融跑器、浏览器冒烟。

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

## 已知边界（别当成已验证）

- 真模型（`JEV_UPSTREAM=typesafe`，实测 `jev-1.13.0`）在 7 条夹具上**与 `local` 贴脸回合数完全一致**：答案已在 state 内时，模型相对确定性启发式的边际增益为 0。实测代价 p50 479–550 ms、最差 1988 ms、约 700–900 输入 token/次，整轮消融约 17.8 万输入 token。
- 因此默认档是 `local`。`bridge` 只该用在约不成确定性规则的判断上（事件两难、叙事风险、观战自动通关），不该用在网格寻路上。
- `kite_ambiguous` 一列真模型直采率 0（置信不足 → 绕 Noul 头 → 落到启发式），这条也照报。
- 精英/BOSS 的**技能时机**（喷火、召唤、诅咒）仍是旧的随机/阈值逻辑，没进判断层——下一轮的活。
- 消融是**确定性单跑、无 seed 重复**，只比"够不够得到玩家"，不比战斗胜率（伤害结算没进夹具）。

## 怎么跑

```bash
node --test tests/test_core.js                  # 无网络、无模型，验真实控件
node harness/run_ablation.js --policies=off,local
JEV_UPSTREAM=stub py -3.12 jev_bridge.py        # 起桥（同进程兼作静态服务器）
node harness/run_ablation.js --policies=off,local,bridge
py -3.12 harness/browser_smoke.py               # 真键盘打一局，三模式各验各的
# 浏览器： http://127.0.0.1:8731/?jev=bridge    按 J 切档
```
