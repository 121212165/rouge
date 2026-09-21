"""机器人批量试玩：贪心策略、非人类，用来测"致死性下限"与死因可归因性，不是用来测人类手感。
   用法：py -3.12 harness/play_batch.py [局数=8]   → 写 harness/balance.json 供闸门引用"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"
OUT = Path(__file__).resolve().parent / "balance.json"
GAMES = int(sys.argv[1]) if len(sys.argv) > 1 else 8
KEY = {0: "a", 1: "d", 2: "s", 3: "w"}

# 一步：先处理弹窗，再直冲本层楼梯口（沿途撞上什么就打什么）——这才测得出致死性与死因
STEP = """() => {
  const shop = document.getElementById('shop-modal');
  if (shop && !shop.classList.contains('hidden')) return { key: 'shop' };
  const elder = document.getElementById('elder-modal');
  if (elder && !elder.classList.contains('hidden')) return { key: 'elder' };
  const draft = document.getElementById('draft-modal');
  if (draft && !draft.classList.contains('hidden')) return { key: 'draft' };
  const over = document.getElementById('game-over');
  if (over && !over.classList.contains('hidden')) return { over: true, dead: true, floor, deathBy };
  if (document.getElementById('victory-modal')) return { over: true, dead: false, won: true, floor, deathBy };
  if (player.hp <= 0) return { over: true, dead: true, floor, deathBy };
  // busy 时按键一定被吞：这一项就是闸门里的"输入被阻塞率"，不能靠事后猜
  if (busy) return { blocked: true, key: 'w' };
  const alive = enemies.filter(e => e.hp > 0);
  let exit = null;
  for (let y = 0; y < HEIGHT && !exit; y++) for (let x = 0; x < WIDTH; x++) if (map[y][x] === '>') { exit = { x, y }; break; }
  const near = exit || alive.reduce((a, b) => (Math.abs(a.x - player.x) + Math.abs(a.y - player.y)) < (Math.abs(b.x - player.x) + Math.abs(b.y - player.y)) ? a : b, null);
  if (!near) return { stuck: true, key: 'w' };
  // BFS 最短路：机器人也不能靠"朝目标挪一格"走迷宫（这正是旧敌人 AI 卡死的同一个坑）
  // 只用四向：游戏本身只有四向移动，八向路径的首步若是斜格，映射成 WASD 后会撞墙空转
  const dirs = [[0,-1],[1,0],[0,1],[-1,0]];
  const seen = new Set([player.x + ',' + player.y]);
  let frontier = [[player.x, player.y, null]];
  let first = null;
  for (let depth = 0; depth < 400 && frontier.length && !first; depth++) {
    const next = [];
    for (const [x, y, head] of frontier) {
      if (x === near.x && y === near.y) { first = head; break; }
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (seen.has(k) || !JEVCore.isFloor(JEV_WORLD, nx, ny)) continue;
        seen.add(k); next.push([nx, ny, head || [dx, dy]]);
      }
    }
    frontier = next;
  }
  if (player.energy >= 30 && player.class === '炼药师' && alive.length && player.hp / player.maxHp < 0.8) { castSkill(SKILLS[player.class][0].id); return { key: 'wait' }; }
  const hpRatio = player.hp / player.maxHp;
  const near_threat = alive.filter(e => Math.abs(e.x - player.x) + Math.abs(e.y - player.y) <= 3);
  const atExit = exit && Math.abs(exit.x - player.x) + Math.abs(exit.y - player.y) <= 2;
  if (hpRatio < 0.3 && near_threat.length && !atExit) {
    // 残血先撤：人类会这么打；机器人不这么打，就测不出"死亡是否可预防"
    const ref = near_threat.reduce((a, b) => (Math.abs(a.x - player.x) + Math.abs(a.y - player.y)) < (Math.abs(b.x - player.x) + Math.abs(b.y - player.y)) ? a : b);
    let flee = null;
    for (const [dx, dy] of dirs) {
      const nx = player.x + dx, ny = player.y + dy;
      if (!JEVCore.isFloor(JEV_WORLD, nx, ny) || alive.some(e => e.x === nx && e.y === ny)) continue;
      const d = Math.abs(ref.x - nx) + Math.abs(ref.y - ny);
      if (!flee || d > flee.d) flee = { d, dx, dy };
    }
    if (flee && Math.abs(ref.x - player.x) + Math.abs(ref.y - player.y) <= 2) {
      return { key: flee.dx === 1 ? 'd' : flee.dx === -1 ? 'a' : flee.dy === 1 ? 's' : 'w' };
    }
  }
  if (!first) return { stuck: true, key: 'w' };
  const [dx, dy] = first;
  return { key: dx === 1 ? 'd' : dx === -1 ? 'a' : dy === 1 ? 's' : 'w' };
}"""

SNAPSHOT = """() => ({ class: player.class, floor, hp: player.hp, maxHp: player.maxHp, gold: player.gold, level: player.level,
            kills: player.kills, sha: player.sha, relics: player.passive.length + player.bag.length,
            deathBy, dead: player.hp <= 0, enemies: enemies.length, items: items.length })"""


CLASSES = [0, 1, 2]  # 按 .class-card 序号点，避免 emoji 可及名称对不上

DISMISS = """() => {
  const open = (id) => !document.getElementById(id).classList.contains('hidden');
  if (open('tut-modal')) { closeTutorial(); return true; }
  return false;
}"""


def play(page, cls: int) -> dict:
    page.goto(f"{BASE}/?jev=norule", wait_until="load")
    page.locator(".class-card").nth(cls).click()
    page.wait_for_timeout(120)
    # 首访必弹教程，它会吃掉所有按键；不点掉的话整局都在测弹窗
    while page.evaluate(DISMISS):
        page.wait_for_timeout(40)
    stuck = 0
    blocked = 0
    pressed = 0
    drafts = 0
    spin = 0
    prev_state = None
    for step in range(900):
        act = page.evaluate(STEP)
        if act.get("over"):
            return {**page.evaluate(SNAPSHOT), "won": act.get("won", False), "steps": step, "stuck": stuck, "blocked": blocked, "pressed": pressed, "drafts": drafts}
        if act["key"] == "shop":
            # 有钱先买血药：不购物的机器人测不出商店这一层取舍是否成立
            page.evaluate("""() => { const it = SHOP_ITEMS.find(i => i.effect.type === 'heal' && player.gold >= shopPrice(i) && player.hp < player.maxHp); if (it) buyItem(it); }""")
            page.get_by_role("button", name="离开商店").click()
            page.wait_for_timeout(30)
            continue
        if act["key"] == "elder":
            page.evaluate("() => pickElder('transmit')")
            page.wait_for_timeout(30)
            continue
        if act["key"] == "draft":
            # 煞气三选：机器人固定拿第一张，测的是"这个弹窗会不会把局卡住"，不是选得对不对
            drafts += 1
            page.evaluate("() => { const o = document.querySelector('#draft-items .shop-item'); if (o) o.click(); }")
            page.wait_for_timeout(30)
            continue
        if act.get("blocked"):
            blocked += 1
            page.wait_for_timeout(10)
            continue
        if act.get("stuck"):
            stuck += 1
            if stuck > 8:
                return {**page.evaluate(SNAPSHOT), "won": False, "steps": step, "stuck": stuck, "blocked": blocked, "pressed": pressed, "drafts": drafts, "softlock": True}
        # 状态完全没推进 = 这一局在空转。不记下来的话，floor 均值会被 900 步的假数据稀释
        now = (act.get("key"), page.evaluate("() => [player.x, player.y, player.hp, enemies.length, floor].join(',')"))
        if now == prev_state:
            spin += 1
            if spin > 60:
                return {**page.evaluate(SNAPSHOT), "won": False, "steps": step, "stuck": stuck, "blocked": blocked, "pressed": pressed, "drafts": drafts, "spin": spin, "softlock": True}
        else:
            spin = 0
        prev_state = now
        if act["key"] == "wait":
            page.wait_for_timeout(10)
            continue
        if page.evaluate("() => busy"):
            blocked += 1  # 判断层还在等网络时按的键会被输入锁丢掉
        page.keyboard.press(act["key"])
        pressed += 1
        page.wait_for_timeout(10)
    snap = page.evaluate(SNAPSHOT)
    return {**snap, "won": False, "steps": 900, "stuck": stuck, "blocked": blocked, "pressed": pressed, "drafts": drafts, "timeout": True}


def main() -> int:
    games = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        for i in range(GAMES):
            games.append(play(page, CLASSES[i % len(CLASSES)]))
        browser.close()

    dead = [g for g in games if g["dead"]]
    causes: dict[str, int] = {}
    for g in dead:
        causes[g.get("deathBy") or "不明"] = causes.get(g.get("deathBy") or "不明", 0) + 1
    summary = {
        "games": len(games),
        "policy": "BFS 冲楼梯机器人（非人类试玩）：走最短路下楼梯、血量<30% 且不在出口旁才撤、有钱买血药、有灵气放技能",
        "deaths": len(dead),
        "wins": sum(1 for g in games if g.get("won")),
        "softlocks": sum(1 for g in games if g.get("softlock")),
        "unattributed_deaths": sum(v for k, v in causes.items() if k == "不明"),
        "death_causes": causes,
        "floor_reached_avg": round(sum(g["floor"] for g in games) / len(games), 2),
        "floor_reached_max": max(g["floor"] for g in games),
        "died_on_floor_1": sum(1 for g in dead if g["floor"] == 1),
        "input_blocked_pct": round(100 * sum(g.get("blocked", 0) for g in games) / max(1, sum(g.get("blocked", 0) + g.get("pressed", 0) for g in games)), 2),
        "sha_drafts_seen": sum(g.get("drafts", 0) for g in games),
        "kills_avg": round(sum(g.get("kills", 0) for g in games) / len(games), 2),
        "relics_avg": round(sum(g.get("relics", 0) for g in games) / len(games), 2),
        "runs": games,
    }
    OUT.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "runs"}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
