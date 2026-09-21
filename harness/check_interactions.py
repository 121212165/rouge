"""浏览器交互回归：四个用例全部来自真人诊断数据里实际崩掉或异常的地方。
   自带进程内静态服务器，不依赖外部服务。用法：py -3.12 harness/check_interactions.py [URL]"""
from __future__ import annotations

import functools
import http.server
import pathlib
import sys
import threading

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_a):
        pass


def serve_here() -> str:
    handler = functools.partial(Quiet, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


def boot(pg, url: str) -> None:
    pg.goto(url, wait_until="load")
    pg.locator(".class-card").nth(0).click()
    pg.wait_for_timeout(200)
    pg.evaluate("() => closeTutorial()")


# 把玩家贴到某个地形格上，走真实 move() 路径
STEP_ONTO = """(ch) => {
  const p = map.flatMap((row, y) => row.map((c, x) => c === ch ? [x, y] : null)).find(Boolean);
  if (!p) return false;
  const dirs = [[0,-1],[1,0],[0,1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
  const adj = dirs.map(([dx, dy]) => [p[0]+dx, p[1]+dy])
    .find(([x, y]) => JEVCore.isFloor(JEV_WORLD, x, y) && !enemies.some(e => e.x === x && e.y === y));
  if (!adj) return false;
  player.x = adj[0]; player.y = adj[1]; syncWorld(); return true;
}"""


def case_elder(pg, fails):
    """长老三选每一项都要能落地且不抛错：真人数据里选任何一项都 ReferenceError 崩掉。"""
    broke = False
    for pick in ("transmit", "heal", "gamble"):
        try:
            pg.evaluate("(k) => applyElder(k)", pick)
        except Exception as exc:  # 页面异常会让 evaluate 直接抛，要转成 FAIL 而不是让检查自己崩
            fails.append(f"applyElder('{pick}') 抛错：{str(exc)[:150]}")
            broke = True
            break
        pg.wait_for_timeout(60)
    return "FAIL" if broke else "PASS"


def case_shop(pg, fails):
    """购买必须扣款并上报 shop_buy：埋点曾被错插进 applyElder，导致购买零上报。"""
    try:
        pg.evaluate("() => { player.gold = 200; shopAllowed = true; openShop(); }")
        pg.wait_for_timeout(150)
        pg.click("#shop-items .shop-item")
        pg.wait_for_timeout(150)
    except Exception as exc:
        fails.append(f"购买操作抛错：{str(exc)[:150]}")
        return "FAIL"
    kinds = pg.evaluate("() => insight.state.events.map(e => e.ev)")
    gold = pg.evaluate("() => player.gold")
    if "shop_buy" not in kinds:
        fails.append(f"购买后没有 shop_buy 事件，末尾事件 = {kinds[-5:]}")
    if gold >= 200:
        fails.append(f"点击商品未扣款，gold={gold}")
    # 真人数据里 0.7 秒连买 6 把同种武器：一次商店必须只能买一件，否则攻/防/血的取舍消失
    for _ in range(4):
        pg.click("#shop-items .shop-item")
        pg.wait_for_timeout(60)
    gold2 = pg.evaluate("() => player.gold")
    buys = pg.evaluate("() => insight.state.events.filter(e => e.ev === 'shop_buy').length")
    if buys != 1 or gold2 != gold:
        fails.append(f"一次商店买了 {buys} 件（应 1 件），gold {gold}→{gold2}")
    return "PASS" if "shop_buy" in kinds and gold < 200 and buys == 1 and gold2 == gold else "FAIL"


def case_death(pg, fails):
    """死亡只结算一次、死后按键不再推进回合：真人数据里一次死亡报了 3-4 条 death。"""
    pg.evaluate("() => { player.hp = 1; deathBy = '回归检查'; gameOver(); }")
    pg.wait_for_timeout(120)
    before = pg.evaluate("() => [player.x, player.y]")
    for _ in range(6):
        pg.keyboard.press("d")
        pg.wait_for_timeout(40)
    deaths = pg.evaluate("() => insight.state.events.filter(e => e.ev === 'death').length")
    after = pg.evaluate("() => [player.x, player.y]")
    if deaths != 1:
        fails.append(f"death 事件应为 1，实际 {deaths}")
    if before != after:
        fails.append(f"死后仍在移动：{before} → {after}")
    return "PASS" if deaths == 1 and before == after else "FAIL"


def case_victory(pg, fails):
    """终局分支不是死代码：走真实 attack() 打死旱魃，渡劫弹窗必须出现。"""
    pg.evaluate("""() => {
      floor = FINAL_FLOOR; player.maxHp = 400; player.hp = 400; player.atk = 500; player.def = 50;
      generateMap(); spawnPlayer(); spawnEnemies(); spawnItems(); syncWorld(); updateUI();
      const boss = enemies.find(e => e.isBoss); if (!boss) return false;
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      const slot = dirs.map(([dx, dy]) => [boss.x + dx, boss.y + dy])
        .find(([x, y]) => JEVCore.isFloor(JEV_WORLD, x, y) && !(x === boss.x && y === boss.y));
      if (!slot) return false;
      player.x = slot[0]; player.y = slot[1]; return true;
    }""")
    gone = False
    for _ in range(30):
        if pg.evaluate("() => { const b = enemies.find(e => e.isBoss); if (!b) return true; attack(b); updateUI(); return false; }"):
            gone = True
            break
        pg.wait_for_timeout(20)
    pg.wait_for_timeout(1300)  # victory() 在 attack 里被 setTimeout(…, 1000) 推迟
    shown = pg.evaluate("() => !!document.getElementById('victory-modal')")
    if not shown:
        fails.append(f"击败旱魃后没有出现渡劫弹窗（boss 消失={gone}）")
    return "PASS" if shown else "FAIL"


CASES = (("1) 长老三选不崩", case_elder), ("2) 商店购买有扣款与上报", case_shop),
         ("3) 死亡单次结算且死后不推进", case_death), ("4) 终局分支可达", case_victory))


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else serve_here()
    fails: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for label, fn in CASES:
            ctx = b.new_context(viewport={"width": 1280, "height": 900})
            pg = ctx.new_page()
            errs: list[str] = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
            try:
                boot(pg, url)
                verdict = fn(pg, fails)
            except Exception as exc:
                fails.append(f"{label} 执行失败：{str(exc)[:160]}")
                verdict = "FAIL"
            extra = f"（{errs[0]}）" if errs else ""
            if errs:
                fails.append(f"{label} 页面报错：{errs[0]}")
            print(f"{label}: {verdict}{extra}")
            ctx.close()
        b.close()

    for f in fails:
        print("  ✗", f)
    print("\n结果:", "PASS" if not fails else f"FAIL（{len(fails)} 项）")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
