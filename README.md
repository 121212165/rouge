# ☯ 阴阳道（rouge）

单文件肉鸽地牢：10 层、三职业、精英怪带诅咒/分裂/反甲，顶层打旱魃渡劫。
零构建、零依赖，浏览器直接打开 `index.html` 就能玩。

---

## 30 秒了解这个项目

| 维度 | 内容 |
|------|------|
| 项目类型 | 游戏 / 回合制肉鸽地牢 |
| 技术栈 | 原生 HTML + CSS + JavaScript（无框架、无打包） |
| 判断层 | 可选的 Jev typed-decision 层（`jev/`），默认 `local` 档，零网络零 key |
| 核心不变量 | 确定性代码拥有世界；模型只出编号，不出坐标、不出可执行代码 |

## 快速开始

```bash
# 直接玩（判断层走本地启发式，不需要任何服务）
start index.html            # Windows；或 python -m http.server 8000

# 带判断层桥（消融、真模型）
JEV_UPSTREAM=stub py -3.12 jev_bridge.py     # http://127.0.0.1:8731/?jev=bridge
```

按 `J` 循环切换判断层：`local`（默认）→ `norule`（**推荐上架配置**：寻路零调用，只有没规则的地方问 Jev）→ `auto`（分歧大才问）→ `bridge`（都问）→ `off`（旧贪心，可对比手感）。

## 上架闸门

`node harness/release_gate.js` —— 15 项确定性否决（测试、夹具、包体、密钥、输入不被阻塞、死因可归因、终局可达…）全绿后，才让 Jev 对四个模糊维度打分。当前判定：**HOLD**（准备度 2.31/4，置信 0.56），Jev 指认的卡点是缺真人试玩证据，且明说加回成就/多周目也不足以放行。详见 `jev/README.md` 的"已知边界"。

## 验证

```bash
node --test tests/test_core.js                      # 无网络无模型，验真实控件
node harness/run_ablation.js --policies=off,local   # 夹具自检 + 消融表
py -3.12 harness/browser_smoke.py                   # 真键盘打一局，三模式
```

### 敌人 AI 消融（确定性单跑，无 seed）

7 条手搭夹具，同一路网、同一接战半径，只比决策质量。`bridge` 列是**真模型 `jev-1.13.0`**（TypeSafe 云端），非 stub：

| 夹具 | `off` 旧贪心 | `local` 零网络启发式 | `bridge` 真 Jev |
|---|---|---|---|
| open_direct（对照组） | 第 5 回合 | 第 5 回合 | 第 5 回合 |
| ring_detour（环形回廊） | **永不接敌**（卡 6 格） | 第 4 回合 | 第 4 回合 |
| snake_long（蛇形长廊） | **永不接敌**（卡 10 格） | 第 19 回合 | 第 19 回合 |
| gate_three（窄门三只互相占位） | **永不接敌**（卡 4 格） | 第 9 回合 | 第 9 回合 |
| reflect_suicide（反甲盾卫） | 攻击 5 次，**自杀 5 次** | 不攻击，自杀 0，保持距离 | 不攻击，自杀 0，但会压到脸上 |
| patrol_lose_contact（玩家巡逻） | 第 15 回合 | 第 5 回合 | 第 5 回合 |
| kite_ambiguous（放风筝，muddy） | 第 14 回合 | 第 15 回合 | 第 15 回合 |

两条结论，第二条是负面的：

1. **增益全部来自 state 设计，不来自模型。** 旧贪心卡死的根因是喂给它的东西里没有墙；补上"绕行几步可达"这一个事实后，4/7 场景从不可达变可达，反甲自残被硬否决清零。真 Jev 在**每一条**夹具上都和零网络的 `local` 给出同样的贴脸回合数——因为答案已经在 state 里，确定性规则就能取到。
2. **所以默认档是 `local`，不是 `bridge`。** 实测 `bridge` 每次决策 p50 479–550 ms（最差 1988 ms）、约 700–900 输入 token，整轮 7 夹具消融花掉约 17.8 万输入 token；且 `kite_ambiguous` 一列直采率 0（模型置信不足，绕回 Noul 头与启发式），等于付费买延迟、最后落到同一个动作。
3. 真模型该用的地方是**约不成确定性规则**的判断：事件两难、叙事风险定价、观战自动通关——不是网格寻路。

> 复现：`JEV_UPSTREAM=typesafe py -3.12 jev_bridge.py` 后 `node harness/run_ablation.js --policies=off,local,bridge`。
> `stub` 上游是固定假答案，只证明链路通，跑器会在表头标注上游身份。

## 项目结构

```
├── index.html            # 游戏本体（渲染、战斗、商店、事件）
├── jev/                  # 判断层：见 jev/README.md
│   ├── core.js           #   纯函数世界：合法域、视线、流场、硬否决
│   ├── questions.js      #   typed 问题包 + 何时该问
│   ├── policies.js       #   baseline / local / gate（Choice 犹豫时改用 Noul 头）
│   ├── client.js         #   三档出口、阈值、复用、重校验、遥测、降级
│   └── README.md         #   设计说明 + 从 JEV 生态搬来的模式与已知边界
├── jev_bridge.py         # 静态服务器 + /decide，上游 adapter|typesafe|stub
├── harness/              # 夹具、消融跑器、浏览器冒烟
├── tests/test_core.js    # node:test，无 key 无网络
├── SPEC.md               # 原始规格（ASCII 地牢那版）
├── FIRST-PRINCIPLES-RECONSTRUCTION.md
└── RECONSTRUCTION-PLAN.md
```

## 控制

`W/A/S/D` 或方向键移动 · `1-3` 技能 · `R` 重开 · `J` 切判断层 · 触屏有十字键

## 许可证

MIT License

---
*最后更新: 2026-09-21*
*作者: 121212165*
