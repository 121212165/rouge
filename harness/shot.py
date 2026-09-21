"""截图看渲染：桌面 + 窄屏各一张，附带元素对齐自检（每格宽度是否一致）。
   用法：py -3.12 harness/shot.py [tag]   （需先起桥：py -3.12 jev_bridge.py）"""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"
OUT = Path(__file__).resolve().parent.parent / ".shots"
KEYS = {"up": "w", "down": "s", "left": "a", "right": "d"}

# 墙体是否真的连成实心块：同色相邻格的左边缘必须无缝（宽度一致 + 无换行错位）
ALIGN = """() => {
  const cells = [...document.querySelectorAll('#game i')];
  const w = cells.map(c => Math.round(c.getBoundingClientRect().width * 100) / 100);
  const h = cells.map(c => Math.round(c.getBoundingClientRect().height * 100) / 100);
  const rows = new Set(); for (let i = 0; i < cells.length; i += 25) rows.add(cells[i].getBoundingClientRect().top);
  return { n: cells.length, uniqW: [...new Set(w)].sort((a,b)=>a-b), uniqH: [...new Set(h)].sort((a,b)=>a-b), rowCount: rows.size };
}"""


def main() -> int:
    tag = sys.argv[1] if len(sys.argv) > 1 else "play"
    OUT.mkdir(exist_ok=True)
    errors: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, vp in (("desk", {"width": 1280, "height": 900}), ("narrow", {"width": 390, "height": 844})):
            page = browser.new_page(viewport=vp)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{BASE}/?jev=local", wait_until="load")
            page.get_by_role("heading", name="⚔️ 武痴").click()
            page.wait_for_timeout(200)
            # 教程是首次弹窗，截图要拍真实战场而不是它
            if page.locator("text=开始修行").count():
                page.locator("text=开始修行").first.click()
                page.wait_for_timeout(120)
            for k in ("d", "d", "s", "d", "w", "a", "s", "s", "d", "d"):
                page.keyboard.press(k)
                page.wait_for_timeout(40)
            if label == "desk":
                print("对齐自检：", ALIGN and page.evaluate(ALIGN))
            page.screenshot(path=str(OUT / f"{tag}-{label}.png"), full_page=(label == "narrow"))
        browser.close()
    print("页面错误：", len(errors))
    for e in errors[:6]:
        print("  -", e[:200])
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
