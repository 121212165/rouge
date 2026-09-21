/* 手搭场景夹具（学 jev-drone）：小而可读，每条都写明"答案是否已在 state 内"与已知模糊处。
   夹具本身由 run_ablation.js 的 BFS 校验把关：单位/玩家必须落在地面且互相可达。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JEVScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const U = (id, x, y, over) => Object.assign({ id, x, y, name: '僵尸', atk: 6, def: 0, hp: 25, maxHp: 25 }, over || {});
  const mk = (rows, units, px, py, extra) => {
    const map = rows.map((r) => r.split(''));
    return Object.assign({
      map, width: map[0].length, height: map.length, floor: 3, finalFloor: 10,
      enemies: units, player: { x: px, y: py, hp: 100, maxHp: 100, atk: 10, def: 2 },
    }, extra || {});
  };

  const OPEN = ['.................', '.................', '.................'];
  const CORNER = ['#######', '#.....#', '#.###.#', '#.#...#', '#.###.#', '#.....#', '#######'];
  const SNAKE = ['.........', '#######.#', '........#', '#.#######', '#.......#', '#######.#', '........#'];
  const GATE = ['#########', '#...#...#', '#...#...#', '##.##.###', '##.##.###', '#.......#'];
  const HALL = ['#########', '#.......#', '#########'];

  return {
    scenarios: [
      {
        id: 'open_direct', title: '开阔地直线（对照组）', maxTicks: 30, radius: 6,
        build: () => mk(OPEN, [U('e1', 7, 1)], 1, 1),
        model: { kind: 'static' },
        claim: '初始距离 6 = 接战半径，无墙无歧义，两个策略都该在 5 回合内贴脸。此列差距应为 0；不为 0 即实现回归。',
      },
      {
        id: 'ring_detour', title: '环形回廊绕墙', maxTicks: 60, radius: 6,
        build: () => mk(CORNER, [U('e1', 1, 1)], 5, 3),
        model: { kind: 'static' },
        claim: '初始距离 6，通路是先右 4 再下 2。旧贪心只试斜向 (2,2) 一格，撞墙即永久卡死；答案在 state 内（逐格可走性 + 视线）。',
      },
      {
        id: 'snake_long', title: '蛇形长走廊（半径放宽后考纯追踪）', maxTicks: 120, radius: 99,
        build: () => mk(SNAKE, [U('e1', 8, 0)], 0, 6),
        model: { kind: 'static' },
        claim: 'radius=99 把"接战半径"这条政策变量摘掉，只比绕墙能力；图上只有一条蛇形通路。',
      },
      {
        id: 'gate_three', title: '窄门三只互相占位', maxTicks: 60, radius: 99,
        build: () => mk(GATE, [U('e1', 1, 1), U('e2', 2, 1), U('e3', 3, 1)], 8 - 1, 1),
        model: { kind: 'static' },
        claim: '三只同向试同一格会互相占据全卡住；考的是"合法域里换一条"，不是"更聪明"。',
      },
      {
        id: 'reflect_suicide', title: '反甲盾卫贴脸自残', maxTicks: 6, radius: 6,
        build: () => mk(HALL, [U('e1', 5, 1, { name: '盾卫', isElite: true, skill: '反甲', atk: 12, def: 15, hp: 3, maxHp: 100 })], 3, 1),
        model: { kind: 'static' },
        claim: '可证明的物理否决：反弹 = floor(max(1, 12-2) * 0.3) = 3 ≥ 自身 3 血 → 攻击即自杀。旧贪心无条件攻击，自杀率应 > 0。',
      },
      {
        id: 'patrol_lose_contact', title: '玩家巡逻后失联', maxTicks: 80, radius: 99,
        build: () => mk(CORNER, [U('e1', 1, 1)], 5, 1),
        model: { kind: 'patrol', path: [[5, 1], [5, 2], [5, 3], [5, 4], [5, 5]] },
        claim: '玩家沿中庭移动，目标位置持续变化；考指纹复用率与追踪稳定性，负面结果照报。',
      },
      {
        id: 'kite_ambiguous', title: '放风筝（已知 muddy 用例）', maxTicks: 80, radius: 99,
        build: () => mk(OPEN.map((r) => r), [U('e1', 1, 1)], 12, 1),
        model: { kind: 'kite' },
        claim: '目标会逃，"追哪条路最优"没有唯一正解 → 本条结论标注为 muddy，不作为增益证据。',
      },
    ],
    _internals: { U, mk, OPEN, CORNER, SNAKE, GATE, HALL },
  };
});
