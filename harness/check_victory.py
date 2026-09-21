"""终局可达性检查：走真实代码路径打出"击败旱魃 → 渡劫飞升"，验证胜利分支不是死代码。
   用法：py -3.12 harness/check_victory.py   （退出码 0 = 通关分支可用）"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"

# 用游戏自己的函数造出终局态：第 10 层、旱魃在场、玩家贴脸，然后走一次真实 attack()
SETUP = """() => {
  floor = FINAL_FLOOR; player.level = 6; player.maxHp = 400; player.hp = 400; player.atk = 500; player.def = 50;
  generateMap(); spawnPlayer(); spawnEnemies(); spawnItems(); syncWorld(); updateUI();
  const boss = enemies.find(e => e.isBoss);
  if (!boss) return { ok: false, why: '第 10 层没有生成旱魃' };
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  const slot = dirs.map(([dx, dy]) => [boss.x + dx, boss.y + dy]).find(([x, y]) => JEVCore.isFloor(JEV_WORLD, x, y) && !(x === boss.x && y === boss.y));
  if (!slot) return { ok: false, why: '旱魃四周无路，贴不上脸' };
  player.x = slot[0]; player.y = slot[1];
  items = items.filter(i => !(i.x === player.x && i.y === player.y));
  return { ok: true, bossHp: boss.hp, foes: enemies.length };
}"""

STRIKE = """() => { const b = enemies.find(e => e.isBoss); if (!b) return { gone: true }; attack(b); updateUI(); return { gone: false, hp: b.hp }; }"""


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"{BASE}/?jev=norule", wait_until="load")
        page.locator(".class-card").nth(2).click()
        page.wait_for_timeout(150)
        setup = page.evaluate(SETUP)
        if not setup["ok"]:
            print("FAIL:", setup["why"])
            browser.close()
            return 1
        for _ in range(40):
            if page.evaluate(STRIKE)["gone"]:
                break
            page.wait_for_timeout(20)
        page.wait_for_timeout(1400)  # victory() 在 attack 里被 setTimeout(…, 1000) 推迟
        shown = page.evaluate("() => !!document.getElementById('victory-modal')")
        log = page.evaluate("() => logs.slice(0, 3).map(l => l.msg)")
        browser.close()
    if shown and not errors:
        print("PASS 终局分支可达：击败旱魃后渡劫弹窗已出现")
        print("     日志：", " | ".join(log))
        return 0
    print("FAIL 通关分支未触发" if not shown else "FAIL 过程中有页面错误")
    for e in errors[:5]:
        print("     ", e[:160])
    return 1


if __name__ == "__main__":
    sys.exit(main())
