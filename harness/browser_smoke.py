"""浏览器侧冒烟：真点击开局 + 真键盘走子，验证判断层三条模式不炸、能接敌、遥测有数。
   用法：py -3.12 harness/browser_smoke.py   （需先起桥：JEV_UPSTREAM=stub py -3.12 jev_bridge.py）"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8731"
OUT = Path(__file__).resolve().parent.parent / ".smoke"
KEYS = {"up": "w", "down": "s", "left": "a", "right": "d"}

PROBE = """() => {
  const alive = enemies.filter(e => e.hp > 0);
  if (!alive.length) return { done: true };
  const near = alive.reduce((a, b) => (Math.abs(a.x - player.x) + Math.abs(a.y - player.y)) < (Math.abs(b.x - player.x) + Math.abs(b.y - player.y)) ? a : b);
  // 只朝合法格走：撞墙会让 move() 早退、整个回合不推进，冒烟就白跑了
  const cand = [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => ({ dx, dy, nx: player.x + dx, ny: player.y + dy }))
    .filter(c => JEVCore.isFloor(JEV_WORLD, c.nx, c.ny) && !alive.some(e => e.x === c.nx && e.y === c.ny));
  if (!cand.length) return { done: false, stuck: true, dx: 0, dy: 0, hp: player.hp, floor, chip: document.getElementById('jev-chip').innerText, stats: { ...jev.stats }, adjacent: false };
  const best = cand.sort((a, b) => (Math.abs(near.x - a.nx) + Math.abs(near.y - a.ny)) - (Math.abs(near.x - b.nx) + Math.abs(near.y - b.ny)))[0];
  return { done: false, dx: best.dx, dy: best.dy, hp: player.hp, floor,
           blocked: (typeof tutOpen !== 'undefined' && tutOpen) || (typeof draftPending !== 'undefined' && draftPending) || (typeof elderPending !== 'undefined' && elderPending),
           chip: document.getElementById('jev-chip').innerText, stats: { ...jev.stats },
           adjacent: alive.some(e => Math.abs(e.x - player.x) + Math.abs(e.y - player.y) === 1) };
}"""


DISMISS = """() => {
  const open = (id) => !document.getElementById(id).classList.contains('hidden');
  if (open('tut-modal')) { closeTutorial(); return 'tutorial'; }
  if (open('draft-modal')) { document.querySelector('#draft-items .shop-item').click(); return 'draft'; }
  if (open('elder-modal')) { document.querySelector('#elder-items .shop-item').click(); return 'elder'; }
  return null;
}"""


def dismiss(page) -> None:
    """教程 / 煞气三选 / 长老都会吃掉按键：真人会点掉，机器人也得点，否则测的是弹窗不是战斗。"""
    for _ in range(6):
        if not page.evaluate(DISMISS):
            return
        page.wait_for_timeout(60)


def run_mode(page, mode: str) -> dict:
    page.goto(f"{BASE}/?jev={mode}", wait_until="load")
    page.get_by_role("heading", name="⚔️ 武痴").click()
    page.wait_for_timeout(150)
    dismiss(page)
    hurt = False
    adjacent_seen = False
    last_hp = page.evaluate(PROBE)["hp"]
    steps = 0
    for _ in range(120):
        st = page.evaluate(PROBE)
        if st.get("done"):
            break
        if st.get("blocked"):
            dismiss(page)
            continue
        if st["hp"] < last_hp:
            hurt = True
        last_hp = st["hp"]
        adjacent_seen = adjacent_seen or st["adjacent"]
        dx, dy = st["dx"], st["dy"]
        key = KEYS["right"] if dx > 0 else KEYS["left"] if dx < 0 else KEYS["down"] if dy > 0 else KEYS["up"]
        page.keyboard.press(key)
        page.wait_for_timeout(25)
        steps += 1
    final = page.evaluate(PROBE)
    return {"mode": mode, "steps": steps, "hurt": hurt, "adjacent_seen": adjacent_seen, "chip": final.get("chip"), "stats": final.get("stats"), "floor": final.get("floor")}


def main() -> int:
    OUT.mkdir(exist_ok=True)
    errors: list[str] = []
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 860})
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        for mode in ("local", "off", "bridge"):
            results.append(run_mode(page, mode))
        page.goto(f"{BASE}/?jev=local", wait_until="load")
        page.get_by_role("heading", name="⚔️ 武痴").click()
        dismiss(page)
        for _ in range(18):
            st = page.evaluate(PROBE)
            if st.get("done"):
                break
            if st.get("blocked"):
                dismiss(page)
                continue
            page.keyboard.press(KEYS["right"] if st["dx"] > 0 else KEYS["left"] if st["dx"] < 0 else KEYS["down"] if st["dy"] > 0 else KEYS["up"])
            page.wait_for_timeout(30)
        page.screenshot(path=str(OUT / "play.png"))
        browser.close()

    print(json.dumps(results, ensure_ascii=False, indent=2))
    print("\n控制台错误：", len(errors))
    for e in errors[:10]:
        print("  -", e[:200])
    # 各模式各验其责：local/off 验"能接敌并造成伤害"；bridge 走 stub 固定假答案，
    # 它本就不追人，只验链路通（有调用、零错误、零回退），不验模型水平。
    def passes(r):
        s = r["stats"]
        if r["mode"] == "bridge":
            return s["calls"] > 0 and s["errors"] == 0 and s["fallbacks"] == 0
        return r["adjacent_seen"] and r["hurt"]

    verdicts = {r["mode"]: passes(r) for r in results}
    for mode, ok in verdicts.items():
        print(f"  {mode}: {'PASS' if ok else 'FAIL'}")
    ok = not errors and all(verdicts.values())
    print("\n结果：", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
