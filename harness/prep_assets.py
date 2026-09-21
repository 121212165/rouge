"""把豆包出的 128x128 素材抠成透明底并接进游戏。

为什么不能直接铺：模型没按提示词给纯色 #080d1c 背景，实测每张的角落色从
(12,30,54) 到 (35,52,59) 不等 —— 直接当 background-image 会在每格上露出一圈
比地面更亮的方块，25x15 网格下会变成新的"墙噪声"。

做法：从四条边洪水填充，只把**与边界连通**且接近该图背景中位色的像素置为透明。
不做全局色差阈值，否则角色身上的暗部（描边本就是 #04060e）会被打穿成洞。

原图不动，处理结果写回 assets/<同名>.png；重跑幂等。
用法：py -3.12 harness/prep_assets.py
"""
from __future__ import annotations

import os
from collections import deque
from pathlib import Path
from statistics import median

from PIL import Image

if hasattr(__import__("sys").stdout, "reconfigure"):
    __import__("sys").stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "assets" / "raw"
OUT = ROOT / "assets"
TOL = 46          # 与背景中位色的曼哈顿距离阈值
SPLIT_SHEET = {"tile-floors.png": ["tile-wall.png", "tile-floor.png", "tile-walltop.png"]}


def background_color(img: Image.Image) -> tuple[int, int, int]:
    w, h = img.size
    px = img.convert("RGB").load()
    edge = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] \
        + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    return (int(median(c[0] for c in edge)), int(median(c[1] for c in edge)), int(median(c[2] for c in edge)))


def key_out(img: Image.Image) -> Image.Image:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    bg = background_color(rgba)
    seen = [[False] * w for _ in range(h)]
    q = deque()

    def close(x: int, y: int) -> bool:
        r, g, b, _ = px[x, y]
        return abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) <= TOL

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y][x] and close(x, y):
                q.append((x, y)); seen[y][x] = True
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y][x] and close(x, y):
                q.append((x, y)); seen[y][x] = True
    removed = 0
    while q:
        x, y = q.popleft()
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        removed += 1
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and close(nx, ny):
                seen[ny][nx] = True
                q.append((nx, ny))
    return rgba, removed, bg


def main() -> None:
    RAW.mkdir(exist_ok=True)
    names = sorted(f for f in os.listdir(OUT) if f.endswith(".png"))
    for fn in names:
        src = RAW / fn if (RAW / fn).exists() else OUT / fn
        img = Image.open(src)
        if (RAW / fn).exists() is False and src == OUT / fn:
            img.save(RAW / fn)
        keyed, removed, bg = key_out(img)
        keyed.save(OUT / fn)
        print(f"{fn:22s} 背景≈{bg} 抠掉 {removed:5d} px ({100*removed//(img.size[0]*img.size[1]):2d}%)")
        if fn in SPLIT_SHEET:
            w, h = img.size
            cw = w // len(SPLIT_SHEET[fn])
            for i, out_name in enumerate(SPLIT_SHEET[fn]):
                piece = img.crop((i * cw, 0, (i + 1) * cw, h))
                pk, n, b = key_out(piece)
                pk.save(OUT / out_name)
                print(f"  ↳ {out_name:20s} 抠掉 {n:5d} px")
    kb = sum(f.stat().st_size for f in OUT.glob("*.png")) / 1024
    print(f"\nassets/ 共 {len(list(OUT.glob('*.png')))} 张，合计 {kb:.0f}KB")


if __name__ == "__main__":
    main()
