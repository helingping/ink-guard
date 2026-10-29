import { RESOURCE_BASES } from "../config/loadConfig";

export interface ArtBook {
  /** First URL that actually loaded, keyed by the path under resources/. */
  url: Record<string, string>;
  tex: Record<string, Laya.Texture>;
}

const WANTED = [
  "textures/bg-paper.png",
  "textures/mountain-top.png",
  "textures/mountain-bottom.png",
  "textures/bamboo.png",
  "textures/river.png",
  "textures/cell.png",
  "textures/seal-adou.png",
  "textures/panel-paper.png",
  "textures/btn-cinnabar.png",
  "textures/btn-muted.png",
  "textures/hp-fill.png",
  "textures/hp-track.png",
  "textures/unit-dao.png",
  "textures/unit-qiang.png",
  "textures/unit-gong.png",
  "textures/unit-qi.png",
  "foes/kou.png",
  "foes/mao.png",
  "foes/shi.png",
  "fx/gong-arrow.png",
  ...poseSheet("dao"),
  ...poseSheet("qiang"),
  ...poseSheet("gong"),
  ...poseSheet("qi"),
  ...poseSheet("kou"),
  ...poseSheet("mao"),
  ...poseSheet("shi"),
  ...poseSheet("dao", "fx"),
  ...poseSheet("qiang", "fx"),
  ...poseSheet("gong", "fx"),
  ...poseSheet("qi", "fx"),
];

function poseSheet(id: string, folder: "pose" | "fx" = "pose"): string[] {
  return [0, 1, 2, 3].map((frame) => `${folder}/${id}-${frame}.png`);
}

export async function loadArt(): Promise<ArtBook> {
  const book: ArtBook = { url: {}, tex: {} };
  await Promise.all(WANTED.map(async (path) => {
    const found = await loadOne(path);
    if (!found) {
      return;
    }
    book.url[path] = found.url;
    book.tex[path] = found.tex;
  }));
  return book;
}

export async function loadFonts(): Promise<{ title: string; body: string }> {
  const title = await loadFont("fonts/MaShanZheng-Regular.ttf", "MaShanZheng-Regular");
  const body = await loadFont("fonts/NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Regular");
  return {
    title: title ?? "serif",
    body: body ?? "sans-serif",
  };
}

async function loadFont(path: string, family: string): Promise<string | null> {
  for (const base of RESOURCE_BASES) {
    try {
      const loaded = await Laya.loader.load(`${base}${path}`, Laya.Loader.TTF);
      if (loaded) {
        return family;
      }
    } catch {
      /* try the next base; glyphs still fall back to a system face */
    }
  }
  return null;
}

async function loadOne(path: string): Promise<{ url: string; tex: Laya.Texture } | null> {
  for (const base of RESOURCE_BASES) {
    const url = `${base}${path}`;
    try {
      const loaded = await Laya.loader.load(url, Laya.Loader.IMAGE);
      if (isTexture(loaded)) {
        return { url, tex: loaded };
      }
    } catch {
      /* missing frame is normal; pose sheets are not all four frames for every id */
    }
  }
  return null;
}

function isTexture(value: unknown): value is Laya.Texture {
  return !!value && typeof value === "object" && "width" in value && "height" in value;
}
