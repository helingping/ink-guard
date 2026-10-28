"""Ink-style foe glyphs and attack poses.

Foes are calligraphy, like the player tokens. Poses reuse the same swing,
thrust, and draw offsets as export-attack-frames.py. Hit splashes and the
arrow stay on the player fx sheets; the game points each foe at that vfx id.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PROJECT = ROOT / "ink-guard"
FOES = PROJECT / "assets" / "resources" / "foes"
POSE = PROJECT / "assets" / "resources" / "pose"
FONT_PATH = PROJECT / "assets" / "resources" / "fonts" / "MaShanZheng-Regular.ttf"
ART = Path("/opt/cursor/artifacts/foe-glyphs")

SPEC = importlib.util.spec_from_file_location(
    "attack_frames",
    Path(__file__).with_name("export-attack-frames.py"),
)
frames = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(frames)


FOE_ART = {
    "kou": {"glyph": "寇", "ink": (107, 43, 40, 255), "splash": "red", "motion": "slash"},
    "mao": {"glyph": "矛", "ink": (20, 82, 72, 255), "splash": "green", "motion": "thrust"},
    "shi": {"glyph": "矢", "ink": (29, 58, 120, 255), "splash": "blue", "motion": "arrow"},
}


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_PATH), size)


def paper_disc(size: int) -> Image.Image:
    disc = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    pad = int(size * 0.12)
    draw.ellipse((pad, pad, size - pad, size - pad), fill=(243, 230, 200, 210))
    return disc.filter(ImageFilter.GaussianBlur(radius=size * 0.02))


def ink_glyph(char: str, color: tuple[int, int, int, int], size: int = 420) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    face = font(int(size * 0.62))
    draw = ImageDraw.Draw(canvas)
    box = draw.textbbox((0, 0), char, font=face)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1] - size * 0.02
    edge = tuple(max(0, int(c * 0.35)) for c in color[:3]) + (255,)
    for dx, dy in ((-3, 0), (3, 0), (0, -3), (0, 3), (-2, -2), (2, 2), (-2, 2), (2, -2)):
        draw.text((x + dx, y + dy), char, font=face, fill=edge)
    draw.text((x, y), char, font=face, fill=color)
    # A second, slightly smaller pass keeps the stroke thick like the player seals.
    draw.text((x, y), char, font=face, fill=color)
    return canvas


def compose(kind: str, splash: Image.Image) -> Image.Image:
    spec = FOE_ART[kind]
    side = 460
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.alpha_composite(paper_disc(side), (0, 0))
    blob = splash.copy()
    blob.thumbnail((int(side * 0.92), int(side * 0.92)), Image.Resampling.LANCZOS)
    faded = blob.copy()
    faded.putalpha(faded.getchannel("A").point(lambda p: int(p * 0.72)))
    canvas.alpha_composite(faded, ((side - faded.width) // 2, (side - faded.height) // 2))
    glyph = ink_glyph(spec["glyph"], spec["ink"])
    glyph.thumbnail((int(side * 0.78), int(side * 0.78)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(glyph, ((side - glyph.width) // 2, (side - glyph.height) // 2 - 6))
    return frames.fit(frames.trim(canvas, 6), 256)


def write_preview(idles: dict[str, Image.Image], poses: dict[str, list[Image.Image]]) -> None:
    ART.mkdir(parents=True, exist_ok=True)
    sheet = Image.new("RGBA", (1100, 860), (243, 230, 200, 255))
    draw = ImageDraw.Draw(sheet)
    title = font(42)
    label = font(28)
    draw.text((28, 18), "墨寇字形", font=title, fill=(29, 43, 56, 255))
    draw.text((28, 68), "左为静止字，右四帧是攻击动作。特效仍用刀、枪、弓的彩墨。", font=label, fill=(74, 55, 40, 255))
    for index, kind in enumerate(FOE_ART):
        y = 120 + index * 240
        spec = FOE_ART[kind]
        draw.text((24, y + 70), f"{spec['glyph']}  {kind}", font=label, fill=spec["ink"])
        idle = idles[kind].resize((160, 160), Image.Resampling.LANCZOS)
        sheet.alpha_composite(idle, (180, y))
        for i, frame in enumerate(poses[kind]):
            thumb = frame.resize((140, 140), Image.Resampling.LANCZOS)
            sheet.alpha_composite(thumb, (380 + i * 160, y + 10))
    sheet.convert("RGB").save(ART / "preview-foes.png", quality=95)


def main() -> None:
    FOES.mkdir(parents=True, exist_ok=True)
    concept = Image.open(PROJECT / "assets" / "concepts" / "vfx-caimo-mid.jpg")
    splashes = {name: frames.extract_ink(concept, name) for name in ("red", "green", "blue")}
    idles: dict[str, Image.Image] = {}
    poses: dict[str, list[Image.Image]] = {}
    for kind, spec in FOE_ART.items():
        idle = compose(kind, splashes[spec["splash"]])
        idle.save(FOES / f"{kind}.png", "PNG")
        motion_frames = frames.pose_sheet(idle, spec["motion"])
        frames.save_seq(motion_frames, POSE, kind)
        idles[kind] = idle
        poses[kind] = motion_frames
        print(kind, idle.size, motion_frames[0].size)
    write_preview(idles, poses)
    print("preview", ART / "preview-foes.png")


if __name__ == "__main__":
    main()
