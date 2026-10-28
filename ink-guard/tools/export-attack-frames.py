"""Build per-token attack poses and hit frames from the concept art.

Poses are the unit sprites themselves, shifted into a swing, thrust, draw, or charge.
Hit frames are color regions cut from concepts/vfx-caimo-mid.jpg, so each token's
effect keeps that ink. The bow's arrow is cut from the bow concept.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
CONCEPT = ROOT / "ink-guard" / "assets" / "concepts" / "vfx-caimo-mid.jpg"
UNITS = ROOT / "ink-guard" / "assets" / "resources" / "textures"
POSE = ROOT / "ink-guard" / "assets" / "resources" / "pose"
FX = ROOT / "ink-guard" / "assets" / "resources" / "fx"
ART = Path("/opt/cursor/artifacts/attack-frames")
PAPER = (243, 230, 200, 255)


def unpaper(im: Image.Image, low: float = 20, high: float = 36) -> Image.Image:
    rgb = np.array(im.convert("RGB")).astype(np.float32)
    height, width = rgb.shape[:2]
    ys = range(6, height - 6, max(6, height // 28))
    xs = range(6, width - 6, max(6, width // 28))
    samples = np.array([rgb[y, x] for y in ys for x in xs], dtype=np.float32)
    lum = samples.mean(axis=1)
    sat = samples.max(axis=1) - samples.min(axis=1)
    bright = lum >= np.percentile(lum, 55)
    pool = samples[bright]
    sats = sat[bright]
    keep = sats <= np.percentile(sats, 40)
    paper = np.median(pool[keep], axis=0) if np.any(keep) else np.array([236, 224, 198], np.float32)
    dist = np.sqrt(((rgb - paper) ** 2).sum(axis=2))
    t = np.clip((dist - low) / max(1.0, high - low), 0, 1)
    alpha = (t * t * (3 - 2 * t) * 255).astype(np.uint8)
    out = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    out.putalpha(Image.fromarray(alpha, "L").filter(ImageFilter.GaussianBlur(0.4)))
    return out


def trim(im: Image.Image, pad: int = 8) -> Image.Image:
    arr = np.array(im)
    ys, xs = np.where(arr[:, :, 3] > 16)
    if len(xs) == 0:
        return im
    box = (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(im.width, int(xs.max()) + 1 + pad),
        min(im.height, int(ys.max()) + 1 + pad),
    )
    return im.crop(box)


def fit(im: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = min((size - 8) / im.width, (size - 8) / im.height)
    resized = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - resized.width) // 2, (size - resized.height) // 2), resized)
    return canvas


def color_mask(rgb: np.ndarray, name: str) -> np.ndarray:
    r, g, b = rgb[:, :, 0].astype(np.int16), rgb[:, :, 1].astype(np.int16), rgb[:, :, 2].astype(np.int16)
    lum = (r + g + b) // 3
    if name == "red":
        return (r > g + 28) & (r > b + 18) & (r > 90)
    if name == "blue":
        return (b > r + 12) & (b > g - 4) & (b > 80)
    if name == "green":
        return (g > r + 8) & (g >= b - 10) & (g > 70) & (r < 180)
    return (r > 80) & (r > b + 20) & (g > 35) & (g < r + 15) & (lum < 170) & (lum > 35)


def extract_ink(src: Image.Image, name: str) -> Image.Image:
    rgb = np.array(src.convert("RGB"))
    alpha = np.array(unpaper(src).getchannel("A"))
    mask = color_mask(rgb, name) & (alpha > 24)
    out = np.zeros((*rgb.shape[:2], 4), np.uint8)
    out[:, :, :3] = rgb
    out[:, :, 3] = np.where(mask, np.maximum(alpha, 80), 0)
    if name == "green":
        out[:, :, 3] = np.array(Image.fromarray(out[:, :, 3], "L").filter(ImageFilter.MaxFilter(5)))
    blob = trim(Image.fromarray(out, "RGBA"), 4)
    if blob.getbbox() is None or blob.width < 8:
        raise SystemExit(f"no {name} ink in the concept splash")
    return blob


def pose_sheet(unit: Image.Image, motion: str) -> list[Image.Image]:
    glyph = trim(unit, 2)
    side = 220
    # rotation, dx, dy, scale
    motions = {
        "slash": [(-18, -10, 4, 0.92), (-6, -2, 0, 0.96), (24, 16, -6, 1.05), (8, 4, -2, 0.98)],
        "thrust": [(0, -6, 0, 0.94), (0, 10, 0, 0.98), (-4, 34, -2, 1.02), (0, 12, 0, 0.96)],
        "arrow": [(0, 4, 0, 1.0), (0, -16, 2, 0.98), (0, 10, -2, 1.02), (0, 0, 0, 1.0)],
        "charge": [(-8, -4, 2, 0.94), (-2, 14, -2, 1.0), (10, 32, -6, 1.06), (2, 8, 0, 0.98)],
    }
    frames = []
    for rot, dx, dy, scale in motions[motion]:
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        placed = fit(glyph, int(side * scale))
        placed = placed.rotate(rot, resample=Image.Resampling.BICUBIC, expand=False)
        canvas.alpha_composite(placed, ((side - placed.width) // 2 + dx, (side - placed.height) // 2 + dy))
        frames.append(canvas)
    return frames


def fx_frames(blob: Image.Image, kind: str) -> list[Image.Image]:
    side = 192
    frames = []
    if kind == "slash":
        specs = [(-36, 0.45, 200), (-12, 0.78, 255), (18, 1.05, 255), (34, 0.7, 120)]
        for rot, scale, alpha in specs:
            frame = blob.resize((int(blob.width * scale), int(blob.height * scale)), Image.Resampling.LANCZOS)
            frame = frame.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
            faded = frame.copy()
            faded.putalpha(faded.getchannel("A").point(lambda p, a=alpha: int(p * a / 255)))
            frames.append(fit(trim(faded, 2), side))
    elif kind == "thrust":
        scales = [0.35, 0.7, 1.15, 0.55]
        for i, scale in enumerate(scales):
            wide = blob.resize((max(8, int(blob.width * (0.8 + scale))), max(8, int(blob.height * 0.9))), Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
            wide.thumbnail((side - 8, side // 2), Image.Resampling.LANCZOS)
            # Grow toward +x so a rotation aims the thrust.
            canvas.alpha_composite(wide, (side // 2 - 8, (side - wide.height) // 2))
            if i == 3:
                canvas.putalpha(canvas.getchannel("A").point(lambda p: int(p * 0.45)))
            frames.append(canvas)
    elif kind == "hit":
        scales = [0.4, 0.75, 1.1, 0.62]
        alphas = [160, 230, 255, 90]
        for scale, alpha in zip(scales, alphas):
            frame = blob.resize((max(8, int(blob.width * scale)), max(8, int(blob.height * scale))), Image.Resampling.LANCZOS)
            frame.putalpha(frame.getchannel("A").point(lambda p, a=alpha: int(p * a / 255)))
            frames.append(fit(trim(frame, 2), side))
    else:
        scales = [0.42, 0.8, 1.2, 0.66]
        rots = [-8, 4, 12, 20]
        alphas = [180, 240, 255, 100]
        for scale, rot, alpha in zip(scales, rots, alphas):
            frame = blob.resize((max(8, int(blob.width * scale)), max(8, int(blob.height * scale))), Image.Resampling.LANCZOS)
            frame = frame.rotate(rot, resample=Image.Resampling.BICUBIC, expand=True)
            frame.putalpha(frame.getchannel("A").point(lambda p, a=alpha: int(p * a / 255)))
            frames.append(fit(trim(frame, 2), side))
    return frames


def crop_arrow(gong: Image.Image) -> Image.Image:
    # Arrowhead only. The shaft crosses the bow grip, so the head to the right
    # of that grip is the clean piece of the concept.
    head = trim(gong.crop((418, 158, 486, 194)).convert("RGBA"), 1)
    canvas = Image.new("RGBA", (96, 40), (0, 0, 0, 0))
    head.thumbnail((52, 32), Image.Resampling.LANCZOS)
    # A short shaft in the same ink, so the projectile reads as an arrow in flight.
    sample = np.array(head)
    opaque = sample[:, :, 3] > 40
    color = tuple(int(v) for v in np.median(sample[:, :, :3][opaque], axis=0)) if opaque.any() else (40, 24, 16)
    draw = ImageDraw.Draw(canvas)
    draw.line((8, 20, 40, 20), fill=color + (255,), width=3)
    canvas.paste(head, (36, (40 - head.height) // 2), head)
    return canvas


def save_seq(frames: list[Image.Image], folder: Path, prefix: str) -> list[Path]:
    folder.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, frame in enumerate(frames):
        path = folder / f"{prefix}-{i}.png"
        frame.save(path, "PNG")
        paths.append(path)
    return paths


def font(size: int) -> ImageFont.ImageFont:
    path = ROOT / "ink-guard" / "assets" / "resources" / "fonts" / "NotoSansCJKsc-Regular.otf"
    return ImageFont.truetype(str(path), size)


def composite_attack(pose: Image.Image, fx: Image.Image, motion: str) -> Image.Image:
    canvas = Image.new("RGBA", (280, 220), PAPER)
    unit = pose.resize((150, 150), Image.Resampling.LANCZOS)
    canvas.alpha_composite(unit, (8, 35))
    effect = fx.resize((130, 130), Image.Resampling.LANCZOS)
    canvas.alpha_composite(effect, (130, 40))
    if motion == "arrow":
        return canvas
    return canvas


def write_previews(bundles: dict[str, dict]) -> None:
    ART.mkdir(parents=True, exist_ok=True)
    title = font(36)
    label = font(22)
    sheet = Image.new("RGBA", (1180, 980), PAPER)
    draw = ImageDraw.Draw(sheet)
    draw.text((24, 16), "墨卫 · 兵种攻击帧", font=title, fill=(29, 43, 56, 255))
    draw.text((24, 58), "上排是本体攻击动作，下排是该兵种自己的特效。弓的飞行物是概念图里的箭。", font=label, fill=(74, 55, 40, 255))
    row_h = 210
    for index, (token, bundle) in enumerate(bundles.items()):
        y = 100 + index * row_h
        draw.text((16, y + 70), bundle["caption"], font=label, fill=bundle["ink"])
        for i, frame in enumerate(bundle["poses"]):
            thumb = frame.resize((120, 120), Image.Resampling.LANCZOS)
            sheet.alpha_composite(thumb, (150 + i * 128, y))
        for i, frame in enumerate(bundle["fx"]):
            thumb = frame.resize((100, 100), Image.Resampling.LANCZOS)
            sheet.alpha_composite(thumb, (150 + i * 128, y + 112))
        if bundle.get("arrow") is not None:
            arrow = bundle["arrow"].resize((90, 30), Image.Resampling.LANCZOS)
            sheet.alpha_composite(arrow, (700, y + 150))
            draw.text((800, y + 150), "箭", font=label, fill=bundle["ink"])
    sheet.convert("RGB").save(ART / "preview-attacks.png", quality=95)

    for token, bundle in bundles.items():
        frames = []
        for pose, fx in zip(bundle["poses"], bundle["fx"]):
            frame = composite_attack(pose, fx, bundle["motion"]).convert("RGBA")
            if bundle["motion"] == "arrow" and bundle.get("arrow") is not None:
                arrow = bundle["arrow"].resize((80, 26), Image.Resampling.LANCZOS)
                frame.alpha_composite(arrow, (180, 96))
            frames.append(frame.convert("P", palette=Image.ADAPTIVE))
        frames[0].save(
            ART / f"{token}-attack.gif",
            save_all=True,
            append_images=frames[1:],
            duration=140,
            loop=0,
            disposal=2,
        )


def main() -> None:
    if POSE.exists():
        shutil.rmtree(POSE)
    if FX.exists():
        shutil.rmtree(FX)
    splash = Image.open(CONCEPT)
    inks = {
        "dao": extract_ink(splash, "red"),
        "qiang": extract_ink(splash, "green"),
        "gong": extract_ink(splash, "blue"),
        "qi": extract_ink(splash, "warm"),
    }
    specs = {
        "dao": ("slash", "刀  近战·斩", (194, 59, 50, 255)),
        "qiang": ("thrust", "枪  近战·刺", (28, 122, 106, 255)),
        "gong": ("hit", "弓  远程·射", (42, 79, 158, 255)),
        "qi": ("charge", "骑  近战·冲", (161, 92, 30, 255)),
    }
    bundles = {}
    for token, (kind, caption, ink) in specs.items():
        unit = Image.open(UNITS / f"unit-{token}.png")
        motion = {"dao": "slash", "qiang": "thrust", "gong": "arrow", "qi": "charge"}[token]
        poses = pose_sheet(unit, motion)
        effects = fx_frames(inks[token], kind if token != "gong" else "hit")
        save_seq(poses, POSE, token)
        save_seq(effects, FX, token)
        arrow = crop_arrow(Image.open(UNITS / "unit-gong.png")) if token == "gong" else None
        if arrow is not None:
            FX.mkdir(parents=True, exist_ok=True)
            arrow.save(FX / "gong-arrow.png", "PNG")
        bundles[token] = {"poses": poses, "fx": effects, "caption": caption, "ink": ink, "motion": motion, "arrow": arrow}
        print(token, "pose", poses[0].size, "fx", effects[0].size)
    write_previews(bundles)
    print("previews", ART)


if __name__ == "__main__":
    main()
