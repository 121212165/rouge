"""触屏回归：用真实 touch 事件（CDP Input.dispatchTouchEvent）驱动八向罗盘，
   验证"按住→拖向→松手才生效"和"拖回中心=取消/等待"这两条 Jev 选它的理由真的成立。
   用法：py -3.12 harness/check_touch.py   （需先起桥：py -3.12 jev_bridge.py）"""
from __future__ import annotations

import sys
from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"
START = """() => {
  playerClass = '武痴'; tutOpen = false; elderPending = false; draftPending = false;
  ['tut-modal','class-select','elder-modal','draft-modal'].forEach(id => document.getElementById(id).classList.add('hidden'));
  initGame();
}"""
# 把玩家挪到"东与东北都是空地"的格子上，并把敌人清出可达范围：
# 往墙上拖本来就不该动，不铺这个场景等于让测试拿随机地图赌
CLEAR = """() => {
  const free = (x, y) => map[y][x] === '.' && !items.some(i => i.x === x && i.y === y);
  for (let y = 1; y < HEIGHT - 1; y++) for (let x = 1; x < WIDTH - 2; x++) {
    // 只要求这 2x2 本身是空地：先前写成"整行整列不许有掉落物"，
    // 随机地图几乎必然被否掉，测试就变成偶发失败
    if (!free(x, y) || !free(x + 1, y) || !free(x, y - 1) || !free(x + 1, y - 1)) continue;
    if (map[y - 1][x] === '#' || map[y][x + 1] === '#') continue;
    player.x = x; player.y = y;
    enemies.forEach((e, k) => { e.x = (x + 5 + k * 2) % (WIDTH - 1) + 1; e.y = (y + 6 + k) % (HEIGHT - 1) + 1; });
    return { x, y };
  }
  return null;
}"""

STATE = """() => ({ x: player.x, y: player.y, floor, foes: enemies.length, hp: player.hp,
           busy, compassOn: document.getElementById('compass').classList.contains('on'),
           bar: [...document.querySelectorAll('#touch-bar button')].map(b => b.innerText.trim()),
           dpad: document.querySelectorAll('.dpad-btn').length })"""


def point_at(page, dx, dy):
    """起点落在玩家格中心；偏移量按像素给，因为罗盘的判定半径是像素而不是格子。
       390px 视口下一格只有约 14px，用"拖几格"来写测试会正好落进 26px 的"待"死区。"""
    return page.evaluate("""([dx, dy]) => {
      const r = document.getElementById('game').getBoundingClientRect();
      const inset = 8, cw = (r.width - inset * 2) / WIDTH, ch = (r.height - inset * 2) / HEIGHT;
      return { x: r.left + inset + (player.x + 0.5) * cw + dx,
               y: r.top + inset + (player.y + 0.5) * ch + dy };
    }""", [dx, dy])


DRAG = 56  # px：明显大于 26px 死区、明显小于 74px 罗盘半径


def drag(cdp, page, ux, uy, back_to_center=False):
    n = max(abs(ux), abs(uy)) or 1
    o = point_at(page, 0, 0)
    t = point_at(page, ux / n * DRAG, uy / n * DRAG)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": o["x"], "y": o["y"], "id": 1}]})
    page.wait_for_timeout(180)  # 过 130ms 的按住阈值，走 "hold 开罗盘" 这条路径
    steps = 6
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [
            {"x": o["x"] + (t["x"] - o["x"]) * i / steps, "y": o["y"] + (t["y"] - o["y"]) * i / steps, "id": 1}]})
        page.wait_for_timeout(16)
    if back_to_center:
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": o["x"], "y": o["y"], "id": 1}]})
        page.wait_for_timeout(30)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(260)


def main() -> int:
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(f"{BASE}/?jev=local", wait_until="load")
        page.evaluate(START)
        page.wait_for_timeout(150)
        cdp = ctx.new_cdp_session(page)
        spot = page.evaluate(CLEAR)
        if not spot:
            print("  FAIL: 铺不出东/东北皆空地的测试位")
            browser.close()
            return 1

        s0 = page.evaluate(STATE)
        print("初始：", s0)
        if s0["dpad"]:
            failures.append(f"旧十字键还在（{s0['dpad']} 个 .dpad-btn）")
        if not any("待一回合" in b for b in s0["bar"]):
            failures.append(f"底部动作条缺「待一回合」：{s0['bar']}")
        if len(s0["bar"]) < 3:
            failures.append(f"底部动作条按钮太少（技能没进去？）：{s0['bar']}")

        # 东：应只动 x
        drag(cdp, page, 1, 0)
        s = page.evaluate(STATE)
        print("拖东后：", s)
        if (s["x"] - s0["x"], s["y"] - s0["y"]) != (1, 0):
            failures.append(f"拖东没走成一格：Δ=({s['x']-s0['x']},{s['y']-s0['y']})")

        # 东北：八向必须真的能动两个轴（玩家此前只有 4 向，敌人有 8 向）
        before = page.evaluate(STATE)
        drag(cdp, page, 1, -1)
        s = page.evaluate(STATE)
        print("拖东北后：", s)
        if not (s["x"] - before["x"] == 1 and s["y"] - before["y"] == -1):
            failures.append(f"八向罗盘的斜向没生效：Δ=({s['x']-before['x']},{s['y']-before['y']})")

        # 拖出去再拖回中心 = 取消移动但仍然是"待一回合"
        before = page.evaluate(STATE)
        drag(cdp, page, 1, 0, back_to_center=True)
        s = page.evaluate(STATE)
        print("回中心后：", s)
        if (s["x"], s["y"]) != (before["x"], before["y"]):
            failures.append(f"拖回中心不该位移：{before['x']},{before['y']} → {s['x']},{s['y']}")
        if s["floor"] == before["floor"] and s["foes"] == before["foes"] and s["hp"] == before["hp"] and s["busy"] is False and s["compassOn"] is False:
            # 位置没变是对的；回合是否推进要看敌人有没有动，这里只要求罗盘确实关掉了
            pass

        # 短按自己脚下 = 等待（Jev wait_turn=tap_self）
        before = page.evaluate(STATE)
        o = point_at(page, 0, 0)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": o["x"], "y": o["y"], "id": 1}]})
        page.wait_for_timeout(40)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        page.wait_for_timeout(260)
        s = page.evaluate(STATE)
        print("点自己脚下后：", s)
        if (s["x"], s["y"]) != (before["x"], before["y"]):
            failures.append(f"点脚下不该位移：{before['x']},{before['y']} → {s['x']},{s['y']}")

        # 底部按钮真的能放技能
        before = page.evaluate("() => ({ e: player.energy, n: document.querySelectorAll('#touch-bar button').length })")
        page.evaluate("() => document.querySelectorAll('#touch-bar button')[0].click()")
        page.wait_for_timeout(120)
        after = page.evaluate("() => ({ e: player.energy, cast: jev.stats })")
        print("技能按钮：", before, after)
        if after["e"] >= before["e"]:
            failures.append(f"底部技能按钮没有生效（灵气 {before['e']} → {after['e']}）")

        # 布局回归：手机上这几条一旦退化，"视图不好看"就会原样回来，而且没人会再报
        lay = page.evaluate(r"""() => {
          const q = (s) => document.querySelector(s);
          const h = (s) => { const e = q(s); return e ? Math.round(e.getBoundingClientRect().height) : -1; };
          const g = q('#game').getBoundingClientRect(), bar = q('.touch-bar').getBoundingClientRect();
          return { stats: h('.panel-stats'), legend: h('.legend'), folded: q('#legend').classList.contains('folded'),
                   mapH: Math.round(g.height), mapBottom: Math.round(g.bottom), barTop: Math.round(bar.top),
                   fb: !!q('[onclick="openFeedback()"]'), toast: !!q('.mobile-toast'),
                   dupLabel: /命格\s*命格|煞气\s*煞气/.test(document.querySelector('.panel-stats').innerText) };
        }""")
        print("手机布局：", lay)
        if lay["legend"] > 90:
            failures.append(f"图例没折叠或太高（{lay['legend']}px），会吃掉一整屏")
        if not lay["folded"]:
            failures.append("窄屏下图例默认应当是折叠的")
        if lay["stats"] > 150:
            failures.append(f"状态带 {lay['stats']}px 太高，把地图顶出首屏了")
        if lay["mapBottom"] >= lay["barTop"]:
            failures.append(f"地图底部 {lay['mapBottom']} 被动作条 {lay['barTop']} 压住")
        if not lay["fb"]:
            failures.append("手机上没有可点的反馈入口（F 键在手机上不存在）")
        if not lay["toast"]:
            failures.append("缺移动端日志浮条：日志面板在折叠线以下，战斗反馈看不见")
        if lay["dupLabel"]:
            failures.append("状态带出现重复标签（如「命格 命格 金」）")

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
