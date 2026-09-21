"""机制回归：法宝效果、煞气三选、风险定价掉落，逐项在真浏览器里验，不靠肉眼。
   用法：py -3.12 harness/check_mechanics.py   （需先起桥：py -3.12 jev_bridge.py）"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"
WIDTH_CELLS = 375

RESET = """(cls) => { playerClass = cls || '武痴'; tutOpen = false; elderPending = false; draftPending = false;
  document.getElementById('class-select').classList.add('hidden');
  ['draft-modal','elder-modal','class-select','tut-modal'].forEach(id => document.getElementById(id).classList.add('hidden'));
  initGame(); }"""

# 风险定价：跑 80 层生成，统计各品阶落点的危险度均值。tier 越高必须越危险，
# 否则 Jev 的 spawn_rule=risk_reward 只是写在文档里的愿望。
PRICING = """() => {
  const acc = { 1: [], 2: [], 3: [] };
  for (let n = 0; n < 80; n++) {
    floor = 1 + (n % 9);
    generateMap(); spawnPlayer(); spawnEnemies(); spawnItems(); spawnRelics();
    for (const it of items) if (it.type === 'relic' && acc[it.tier]) acc[it.tier].push(dangerAt(it.x, it.y));
  }
  const mean = (a) => +(a.reduce((s, v) => s + v, 0) / (a.length || 1)).toFixed(2);
  return { n1: acc[1].length, n2: acc[2].length, n3: acc[3].length,
           m1: mean(acc[1]), m2: mean(acc[2]), m3: mean(acc[3]) };
}"""

# 每件主动法宝都要能触发且不抛错；用完后充能必须消耗（不然按钮是死的）。
# 先把两只怪挪到身边，否则"没有目标所以不消耗"会让断言假失败。
ACTIVES = """async () => {
  const stage = (n) => {
    let k = 0;
    for (let d = 1; d <= 5 && k < n; d++) for (const [dx, dy] of [[d,0],[0,d],[-d,0],[0,-d]]) {
      if (k >= n) break;
      const x = player.x + dx, y = player.y + dy;
      if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || map[y][x] === '#') continue;
      if (enemies.some((e, j) => j < k && e.x === x && e.y === y)) continue;
      enemies[k].x = x; enemies[k].y = y; enemies[k].stun = 0; k++;
    }
    return k;
  };
  const out = [];
  for (const id of ['ding', 'dun', 'jing', 'quan', 'bing']) {
    playerClass = '武痴'; initGame(); stage(2);
    player.bag = [{ id, charges: 1 }];
    let err = null;
    try { useRelic(id); await new Promise(r => setTimeout(r, 260)); } catch (e) { err = String(e); }
    out.push({ id, err, consumed: player.bag.length === 0, stunned: enemies.filter(e => e.stun > 0).length,
      moved: true, hp: player.hp, rooted: player.rooted, reveal: player.reveal });
  }
  return out;
}"""

PASSIVES = """async () => {
  const settle = async () => { await new Promise(r => setTimeout(r, 320)); };
  const r = {};
  playerClass = '武痴'; initGame();
  // 避毒珠：陷阱不伤
  player.passive = ['du']; player.hp = player.maxHp; enemies = []; map[2][1] = 'v'; player.x = 1; player.y = 1;
  const before = player.hp; move(0, 1); await settle();
  r.ward = { before, after: player.hp };
  // 聚宝盆：灵气 ×1.5
  playerClass = '武痴'; initGame(); player.passive = ['pen']; r.greed = gainGold(10);
  playerClass = '武痴'; initGame(); r.greedBase = gainGold(10);
  // 替身草人：免死一次并清空灵气
  playerClass = '武痴'; initGame(); player.passive = ['cao']; player.gold = 99; player.hp = 2;
  hurtPlayer(80, '测试');
  r.undying = { hp: player.hp, gold: player.gold, passive: player.passive.length };
  // 破阵锤：撞墙消耗一次并出现在墙后。自己造"地—墙—地"，
  // 不然随机地图刚好没有这种结构时，这条断言会被静默跳过。
  playerClass = '武痴'; initGame(); await settle();
  player.passive = ['bo']; player.phase = 1; enemies = [];
  let spot = null;
  for (let y = 1; y < HEIGHT - 1 && !spot; y++) for (let x = 2; x < WIDTH - 2; x++)
    if (map[y][x] === '.' && map[y][x + 1] === '.' && map[y][x + 2] === '.' && map[y][x - 1] === '.') { map[y][x + 1] = '#'; spot = { x, y }; break; }
  r.phaseFound = !!spot;
  if (spot) { player.x = spot.x; player.y = spot.y; move(1, 0); await settle();
    r.phase = { x: player.x, y: player.y, want: spot.x + 2, charges: player.phase }; }
  // 定风珠：免疫本层诅咒
  playerClass = '武痴'; initGame(); player.passive = ['feng']; curse = null;
  for (let i = 0; i < 40; i++) { floor = 3; nextFloorAfterShop(); }
  r.noCurse = curse;
  return r;
}"""

SHA = """() => {
  playerClass = '武痴'; initGame();
  const el0 = player.el, atk0 = playerAtk(), mod0 = JSON.stringify(player.mod);
  player.sha = GameData.SHA_EVERY; checkSha();
  const open = !document.getElementById('draft-modal').classList.contains('hidden');
  const cards = document.querySelectorAll('#draft-items .shop-item').length;
  document.querySelector('#draft-items .shop-item').click();
  return { el0, el1: player.el, atk0, atk1: playerAtk(), open, cards,
           pending: draftPending, sha: player.sha,
           changed: player.el !== el0 || playerAtk() !== atk0 || JSON.stringify(player.mod) !== mod0,
           mods: player.mod };
}"""


QI = """() => {
  playerClass = '武痴'; initGame();
  const mk = (el) => ({ el, type: 'z', name: el + '桩', hp: 99999, maxHp: 99999, atk: 0, def: 0, exp: 1, gold: 1, poison: 0 });
  const steps = [];
  for (const el of ['金', '水', '木']) { const f = mk(el); enemies = [f]; attack(f); steps.push({ el, chain: player.qi.chain.slice(), armed: player.qi.armed, lost: 99999 - f.hp }); }
  // 接不上相生应当重开成 1 口，而不是清零——清零会让一次失误抹掉全部进度
  player.qi.chain = []; player.qi.armed = false; qiAbsorb('金'); qiAbsorb('金');
  const broke = player.qi.chain.slice();
  player.qi.chain = []; qiAbsorb(null);
  return { steps, broke, nullSafe: player.qi.chain.slice(), need: GameData.QI_NEED };
}"""



# 确定性重放：同 seed 两次进层必须逐字节相同，不同 seed 必须分叉。
# 只验"页面上印了个种子"是不够的 —— 那正是最容易假装做到的事。
FINGERPRINT = """() => ({
  seed: RUN_SEED,
  map: map.map(r => r.join('')).join('/'),
  foes: enemies.map(e => e.type + e.x + ',' + e.y + '#' + e.hp).join('|'),
  loot: items.map(i => (i.type === 'relic' ? i.id : i.type) + i.x + ',' + i.y).join('|'),
  player: player.x + ',' + player.y
})"""

# DOM diff：节点必须被复用。若 render() 仍在全量 innerHTML 重建，标记会随旧节点一起消失
DIFF = """() => {
  updateUI();
  const cells = document.querySelectorAll('#game i');
  cells[7].__probe = 'kept';
  const before = cells.length;
  updateUI(); updateUI();
  const after = document.querySelectorAll('#game i');
  return { count: after.length, sameCount: after.length === before, reused: after[7].__probe === 'kept',
           rebuilt: cells[7] !== after[7] };
}"""


def determinism(page, seed):
    page.goto(f"{BASE}/?jev=local&seed={seed}", wait_until="load")
    page.evaluate(RESET)
    return page.evaluate(FINGERPRINT)


def main() -> int:
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(f"{BASE}/?jev=local", wait_until="load")
        page.evaluate(RESET)

        pr = page.evaluate(PRICING)
        print("风险定价：", pr)
        if not (pr["n1"] and pr["n2"] and pr["n3"]):
            failures.append(f"某品阶一次都没掉出来：{pr}")
        elif not (pr["m3"] > pr["m1"] and pr["m2"] >= pr["m1"]):
            failures.append(f"仙品并没有掉在更危险的地方：{pr}")

        acts = page.evaluate(ACTIVES)
        for a in acts:
            print("主动法宝：", a)
            if a["err"]:
                failures.append(f"{a['id']} 使用抛错：{a['err']}")
            elif not a["consumed"]:
                failures.append(f"{a['id']} 用完没有消耗充能")

        ps = page.evaluate(PASSIVES)
        print("被动法宝：", ps)
        if ps["ward"]["after"] != ps["ward"]["before"]:
            failures.append(f"避毒珠没能免疫陷阱：{ps['ward']}")
        if ps["greed"] <= ps["greedBase"]:
            failures.append(f"聚宝盆没有提高灵气：{ps['greed']} vs {ps['greedBase']}")
        if ps["undying"]["hp"] <= 0 or ps["undying"]["gold"] != 0 or ps["undying"]["passive"] != 0:
            failures.append(f"替身草人免死异常：{ps['undying']}")
        if not ps.get("phaseFound"):
            failures.append("造不出「地—墙—地」，破阵锤这一条根本没测到")
        elif ps["phase"]["x"] != ps["phase"]["want"] or ps["phase"]["charges"] != 0:
            failures.append(f"破阵锤穿墙异常：{ps['phase']}")
        if ps["noCurse"]:
            failures.append(f"定风珠没能挡住诅咒：{ps['noCurse']}")

        sh = page.evaluate(SHA)
        print("煞气三选：", sh)
        if not sh["open"] or sh["cards"] != 4:
            failures.append(f"煞气弹窗或选项数不对：{sh['open']}/{sh['cards']}")
        if sh["pending"]:
            failures.append("选完之后仍然卡住输入")
        if not sh["changed"]:
            failures.append(f"选了煞气但命格和数值都没变：{sh}")

        qi = page.evaluate(QI)
        print("一气连环：", qi)
        st = qi["steps"]
        if [s["chain"] for s in st[:2]] != [["金"], ["金", "水"]]:
            failures.append(f"相生链没按 金→水 续上：{st}")
        if not (st[0] and st[1] and st[2] and st[2]["armed"] is False and st[2]["chain"] == []):
            failures.append(f"串满 {qi['need']} 口没有引爆并清空：{st[2]}")
        elif st[2]["lost"] < st[0]["lost"] * 2:
            failures.append(f"引爆伤害没体现 2.2 倍：{[s['lost'] for s in st]}")
        if qi["broke"] != ["金"]:
            failures.append(f"断链应当重开成 1 口而不是清零：{qi['broke']}")
        if qi["nullSafe"] != []:
            failures.append(f"无属性目标污染了链条：{qi['nullSafe']}")

        det_a = determinism(page, "jin001")
        det_b = determinism(page, "jin001")
        det_c = determinism(page, "jin002")
        print("同 seed 重放：", det_a["seed"], "map 相同 =", det_a["map"] == det_b["map"],
              "| 敌人相同 =", det_a["foes"] == det_b["foes"], "| 掉落相同 =", det_a["loot"] == det_b["loot"])
        if det_a["seed"] != "jin001":
            failures.append(f"URL 上的 seed 没被采用，拿到的是 {det_a['seed']}")
        for key in ("map", "foes", "loot", "player"):
            if det_a[key] != det_b[key]:
                failures.append(f"同 seed 但 {key} 不一致 —— 重放是假的")
                break
        if det_a["map"] == det_c["map"] and det_a["foes"] == det_c["foes"]:
            failures.append("换 seed 地图与敌人完全一样 —— 生成根本没吃到种子")

        diff = page.evaluate(DIFF)
        print("DOM diff：", diff)
        if not diff["reused"]:
            failures.append("render() 仍在重建节点，DOM diff 没生效")
        if diff["count"] != WIDTH_CELLS:
            failures.append(f"格子数不对：{diff['count']}")

        if errs:
            failures.extend(f"页面错误: {e[:160]}" for e in errs[:5])
        browser.close()

    print()
    for f in failures:
        print("  FAIL:", f)
    print("结果:", "PASS" if not failures else "FAIL")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
