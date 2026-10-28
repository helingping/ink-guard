"""Cut Ink Guard UI sprites out of the concept JPGs.

Source images live in /tmp/ink-src when regenerated from the asset tarball,
and also at the repo's assets/concepts/. Outputs land in
ink-guard/assets/resources/textures/.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
CONCEPTS = ROOT / "assets" / "concepts"
OUT = ROOT / "ink-guard" / "assets" / "resources" / "textures"
FONTS_OUT = ROOT / "ink-guard" / "assets" / "resources" / "fonts"
CONCEPTS_OUT = ROOT / "ink-guard" / "assets" / "concepts"
SRC = Path("/tmp/ink-src")


def load_concept(name: str) -> Image.Image:
    packaged = SRC / "concepts" / name
    if packaged.exists():
        return Image.open(packaged).convert("RGB")
    return Image.open(CONCEPTS / name).convert("RGB")


def estimate_paper(rgb: np.ndarray) -> np.ndarray:
    height, width = rgb.shape[:2]
    ys = range(6, height - 6, max(6, height // 28))
    xs = range(6, width - 6, max(6, width // 28))
    samples = np.array([rgb[y, x] for y in ys for x in xs], dtype=np.float32)
    lum = samples.mean(axis=1)
    sat = samples.max(axis=1) - samples.min(axis=1)
    bright = lum >= np.percentile(lum, 60)
    pool = samples[bright]
    sats = sat[bright]
    keep = sats <= np.percentile(sats, 45)
    picked = pool[keep]
    if len(picked) == 0:
        return np.array([238, 226, 200], np.float32)
    return np.median(picked, axis=0)


def unpaper(im: Image.Image, low: float = 22, high: float = 40) -> Image.Image:
    rgb = np.array(im.convert("RGB")).astype(np.float32)
    paper = estimate_paper(rgb)
    dist = np.sqrt(((rgb - paper) ** 2).sum(axis=2))
    span = max(1.0, high - low)
    t = np.clip((dist - low) / span, 0, 1)
    alpha = t * t * (3 - 2 * t)
    rgb_u8 = np.clip(rgb, 0, 255).astype(np.uint8)
    alpha_im = Image.fromarray((alpha * 255).astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(0.45))
    out = Image.fromarray(rgb_u8, "RGB").convert("RGBA")
    out.putalpha(alpha_im)
    return out


def trim(im: Image.Image, pad: int = 8, alpha_at: int = 16) -> Image.Image:
    arr = np.array(im)
    ys, xs = np.where(arr[:, :, 3] > alpha_at)
    if len(xs) == 0:
        return im
    left = max(0, int(xs.min()) - pad)
    top = max(0, int(ys.min()) - pad)
    right = min(im.width, int(xs.max()) + 1 + pad)
    bottom = min(im.height, int(ys.max()) + 1 + pad)
    return im.crop((left, top, right, bottom))


def circle_mask(size: int, feather: int = 2) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((1, 1, size - 2, size - 2), fill=255)
    if feather:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    return mask


def rounded_mask(w: int, h: int, radius: int) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    return mask


def paper_tile(field: Image.Image) -> Image.Image:
    # Interior of a clean grid cell on the battlefield sheet.
    cell = field.crop((296, 406, 354, 462))
    grain = cell.resize((128, 128), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (720, 1280))
    for y in range(0, 1280, 128):
        for x in range(0, 720, 128):
            canvas.paste(grain, (x, y))
    wash = field.resize((720, 1280), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(18))
    wash = ImageEnhance.Color(wash).enhance(0.55)
    return Image.blend(canvas, wash, 0.08).convert("RGB")


def save_rgba(im: Image.Image, name: str) -> None:
    im.save(OUT / name, "PNG")
    print(name, im.size)


def export_seal(field: Image.Image) -> None:
    crop = field.crop((18, 575, 175, 735))
    arr = np.array(crop).astype(np.int16)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    ring = (r > 115) & (g > 80) & (g < 190) & (b < 150) & ((r - b) > 25) & (np.abs(r - g) < 90)
    ys, xs = np.where(ring)
    if len(xs) < 30:
        raise SystemExit("seal ring not found")
    pad = 8
    left, top = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    right, bottom = min(crop.width, int(xs.max()) + pad), min(crop.height, int(ys.max()) + pad)
    medal = crop.crop((left, top, right, bottom)).convert("RGBA")
    side = max(medal.width, medal.height)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(medal, ((side - medal.width) // 2, (side - medal.height) // 2))
    # Hug the ring. The detected bbox includes a halo of river wash.
    radius = int(min(xs.max() - xs.min(), ys.max() - ys.min()) * 0.48)
    mask = Image.new("L", (side, side), 0)
    cx = side // 2
    cy = side // 2
    ImageDraw.Draw(mask).ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(1.2))
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(square, (0, 0), mask)
    save_rgba(trim(out, 2, 8), "seal-adou.png")


def export_cell(field: Image.Image) -> None:
    cell = field.crop((291, 400, 360, 468))
    cell = cell.resize((cell.width * 3, cell.height * 3), Image.Resampling.LANCZOS)
    cell = ImageEnhance.Sharpness(cell).enhance(1.25)
    save_rgba(cell.convert("RGBA"), "cell.png")


def export_units() -> None:
    sheet = load_concept("units-caimo.jpg")
    boxes = {
        "unit-dao.png": (0, 0, 512, 512),
        "unit-qiang.png": (512, 0, 1024, 512),
        "unit-gong.png": (0, 512, 512, 1024),
        "unit-qi.png": (512, 512, 1024, 1024),
    }
    for name, box in boxes.items():
        l, t, r, b = box
        glyph = unpaper(sheet.crop((l + 8, t + 8, r - 8, b - 8)), low=16, high=32)
        save_rgba(trim(glyph, 12), name)


def export_splash() -> None:
    vfx = load_concept("vfx-caimo-mid.jpg")
    burst = unpaper(vfx, low=18, high=34)
    burst = trim(burst, 6)
    burst.thumbnail((640, 640), Image.Resampling.LANCZOS)
    save_rgba(burst, "ink-splash.png")


def export_scenery(field: Image.Image) -> None:
    save_rgba(paper_tile(field).convert("RGBA"), "bg-paper.png")
    mountain = trim(unpaper(field.crop((0, 0, 480, 300)), low=20, high=38), 2)
    save_rgba(mountain, "mountain-top.png")
    foothills = trim(unpaper(field.crop((80, 1060, 560, 1276)), low=18, high=36), 2)
    save_rgba(foothills, "mountain-bottom.png")
    bamboo = trim(unpaper(field.crop((500, 0, 720, 300)), low=18, high=34), 2)
    save_rgba(bamboo, "bamboo.png")
    river = trim(unpaper(field.crop((170, 575, 555, 735)), low=18, high=36), 2)
    save_rgba(river, "river.png")
    blot_src = unpaper(field.crop((40, 1140, 210, 1275)), low=12, high=32)
    side = 128
    blot = blot_src.resize((side, side), Image.Resampling.LANCZOS)
    mask = circle_mask(side, 2)
    enemy = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    enemy.paste(blot, (0, 0), mask)
    save_rgba(enemy, "enemy-ink.png")


def speckle(draw: ImageDraw.ImageDraw, color: tuple[int, int, int, int], n: int, w: int, h: int, rng: np.random.Generator) -> None:
    for _ in range(n):
        x = int(rng.integers(8, w - 8))
        y = int(rng.integers(8, h - 8))
        rad = int(rng.integers(1, 4))
        draw.ellipse((x - rad, y - rad, x + rad, y + rad), fill=color)


def export_chrome(field: Image.Image) -> None:
    rng = np.random.default_rng(7)
    paper = field.crop((300, 410, 350, 460)).resize((32, 32), Image.Resampling.LANCZOS)

    def fill_round(w: int, h: int, radius: int, color: tuple[int, int, int, int], stroke: tuple[int, int, int, int], stroke_w: int = 6) -> Image.Image:
        im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        base = Image.new("RGBA", (w, h), color)
        tex = Image.new("RGBA", (w, h))
        for y in range(0, h, 32):
            for x in range(0, w, 32):
                tex.paste(paper, (x, y))
        tex.putalpha(70)
        base = Image.alpha_composite(base, tex)
        mask = rounded_mask(w, h, radius)
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        out.paste(base, (0, 0), mask)
        draw = ImageDraw.Draw(out)
        draw.rounded_rectangle((3, 3, w - 4, h - 4), radius=radius - 2, outline=stroke, width=stroke_w)
        speckle(draw, (255, 244, 220, 90), 18, w, h, rng)
        return out

    save_rgba(fill_round(320, 160, 56, (180, 51, 42, 255), (92, 24, 18, 255), 10), "btn-cinnabar.png")
    save_rgba(fill_round(320, 160, 56, (122, 110, 96, 255), (74, 64, 54, 255), 10), "btn-muted.png")
    save_rgba(fill_round(480, 280, 36, (243, 232, 206, 245), (48, 58, 72, 230), 8), "panel-paper.png")
    save_rgba(fill_round(560, 300, 28, (236, 224, 196, 230), (48, 58, 72, 180), 8), "board-plate.png")

    track = Image.new("RGBA", (64, 24), (0, 0, 0, 0))
    ImageDraw.Draw(track).rounded_rectangle((0, 0, 63, 23), radius=12, fill=(74, 55, 40, 90))
    save_rgba(track, "hp-track.png")
    fill = Image.new("RGBA", (64, 24), (0, 0, 0, 0))
    ImageDraw.Draw(fill).rounded_rectangle((0, 0, 63, 23), radius=12, fill=(180, 51, 42, 255))
    save_rgba(fill, "hp-fill.png")

    ring = Image.new("RGBA", (96, 96), (0, 0, 0, 0))
    pen = ImageDraw.Draw(ring)
    pen.ellipse((6, 6, 89, 89), outline=(255, 255, 255, 230), width=6)
    pen.ellipse((14, 14, 81, 81), outline=(255, 255, 255, 80), width=2)
    save_rgba(ring, "mark-ring.png")

    dot = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    pen = ImageDraw.Draw(dot)
    pen.ellipse((6, 6, 25, 25), fill=(255, 255, 255, 255))
    pen.ellipse((4, 12, 10, 18), fill=(255, 255, 255, 180))
    save_rgba(dot, "shot-dot.png")

    white = Image.new("RGBA", (8, 8), (255, 255, 255, 255))
    save_rgba(white, "pixel-white.png")


def copy_sources() -> None:
    CONCEPTS_OUT.mkdir(parents=True, exist_ok=True)
    FONTS_OUT.mkdir(parents=True, exist_ok=True)
    for name in ("battlefield-caimo.jpg", "units-caimo.jpg", "vfx-caimo-mid.jpg"):
        src = SRC / "concepts" / name
        if not src.exists():
            src = CONCEPTS / name
        shutil.copy(src, CONCEPTS_OUT / name)
    if SRC.exists():
        for name in ("MaShanZheng-Regular.ttf", "NotoSansCJKsc-Regular.otf", "OFL-MaShanZheng.txt", "OFL-NotoSansCJK.txt"):
            shutil.copy(SRC / "fonts" / name, FONTS_OUT / name)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    field = load_concept("battlefield-caimo.jpg")
    export_seal(field)
    export_cell(field)
    export_scenery(field)
    export_units()
    export_splash()
    export_chrome(field)
    copy_sources()


if __name__ == "__main__":
    main()
