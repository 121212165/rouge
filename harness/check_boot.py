"""首屏启动检查：内联脚本一崩就全崩（本会话已因 TDZ 静默中止过两次，症状是"游戏打不开但没报错"）。
   刻意不复用 browser_smoke —— 那个要跑三种判断层模式、其中 bridge 会打真模型，
   和同一批闸门里的其它浏览器套件抢桥，会把偶发抖动带进"能否启动"这条本该最稳的否决项。
   用法：py -3.12 harness/check_boot.py"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"


def main() -> int:
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
        page.goto(f"{BASE}/?jev=local", wait_until="load")
        if errs:
            failures.append("加载期报错（内联脚本可能整段没跑完）：" + " | ".join(errs[:3]))
        page.locator(".class-card").nth(2).click()
        page.wait_for_timeout(200)
        # 首访必弹教程，它会吃掉所有按键；不点掉的话测的就是弹窗不是回合推进
        if page.evaluate("() => !document.getElementById('tut-modal').classList.contains('hidden')"):
            page.evaluate("() => closeTutorial()")
            page.wait_for_timeout(120)
        boot = page.evaluate("""() => ({
          cells: document.querySelectorAll('#game i').length,
          painted: document.querySelectorAll('#game i[style]').length,
          legend: document.querySelectorAll('#lg-body .lg-row').length,
          bar: document.querySelectorAll('.touch-bar button').length,
          seed: typeof RUN_SEED === 'string' && RUN_SEED.length > 0,
          rng: typeof rng === 'function',
          booted: !!player && player.hp > 0 && enemies.length > 0,
        })""")
        print("启动状态：", boot)
        if boot["cells"] != 375:
            failures.append(f"地图格子数 {boot['cells']}，应为 375")
        if boot["painted"] != 375:
            failures.append(f"有 {375 - boot['painted']} 格没被上色 —— DOM diff 的 key 漏了初始态")
        if boot["legend"] < 5:
            failures.append(f"图例只有 {boot['legend']} 行")
        if boot["bar"] < 3:
            failures.append(f"底部动作条只有 {boot['bar']} 个按钮")
        if not boot["seed"]:
            failures.append("本局没有种子 —— 确定性重放失效")
        if not boot["rng"]:
            failures.append("rng() 不存在 —— Math.random 又漏回来了")
        if not boot["booted"]:
            failures.append("点职业后游戏没起来")

        # 走一步必须真的推进回合（敌人会动、日志会长），否则"能显示"不等于"能玩"
        # 安静地走一步本来就不产生日志，所以"日志变长"不是回合推进的判据。
        # 真正该验的是世界确实前进了：玩家位移、敌人位移，或者地图版本号变化。
        snap = "() => ({ px: player.x, py: player.y, foes: enemies.map(e => e.x + ',' + e.y).join('|'), ver: mapVersion })"
        before = page.evaluate(snap)
        page.keyboard.press("d")
        page.wait_for_timeout(250)
        after = page.evaluate(snap)
        advanced = (before["px"], before["py"]) != (after["px"], after["py"]) or before["foes"] != after["foes"]
        print("走一步：玩家位移 =", (before["px"], before["py"]), "->", (after["px"], after["py"]),
              "| 敌人布局变化 =", before["foes"] != after["foes"], "| 日志 =", after.get("logs", "-"))
        if not advanced:
            failures.append(f"按了一步世界没有前进：{before} -> {after}")
        if errs:
            failures.append("运行期报错：" + " | ".join(errs[:3]))
        browser.close()

    for f in failures:
        print("  FAIL:", f)
    print("结果:", "PASS" if not failures else "FAIL")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
