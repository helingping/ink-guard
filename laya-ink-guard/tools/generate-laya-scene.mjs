/**
 * Writes the LayaAir 3.4.2 startup scene, HUD prefabs, and UI texture copies.
 * Run from anywhere: node laya-ink-guard/tools/generate-laya-scene.mjs
 *
 * Skins use res:// UUIDs that point at assets/ui copies. Those copies exist so
 * the IDE can import Laya metas without rewriting the Cocos metas that live
 * behind the resources/ symlinks. The browser preview does not load this scene.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..");
const repo = join(project, "..");
const shared = join(repo, "ink-guard/assets/resources");
const board = JSON.parse(readFileSync(join(project, "assets/resources/configs/board.json"), "utf8"));

export const SCENE_UUID = "c0ffee00-0000-4000-8000-000000000001";
export const SCRIPT_UUID = "c0ffee00-0000-4000-8000-000000000002";

const PREFAB = {
  paper: "c0ffee00-0000-4000-8000-000000000010",
  recruit: "c0ffee00-0000-4000-8000-000000000011",
  speed: "c0ffee00-0000-4000-8000-000000000012",
  cell: "c0ffee00-0000-4000-8000-000000000013",
  seal: "c0ffee00-0000-4000-8000-000000000014",
  glyph: "c0ffee00-0000-4000-8000-000000000015",
};

const IMAGE = {
  bg: ["bg-paper.png", "textures/bg-paper.png", "c0ffee00-0000-4000-8000-000000000101"],
  mountain: ["mountain-top.png", "textures/mountain-top.png", "c0ffee00-0000-4000-8000-000000000102"],
  bamboo: ["bamboo.png", "textures/bamboo.png", "c0ffee00-0000-4000-8000-000000000103"],
  river: ["river.png", "textures/river.png", "c0ffee00-0000-4000-8000-000000000104"],
  cell: ["cell.png", "textures/cell.png", "c0ffee00-0000-4000-8000-000000000105"],
  seal: ["seal-adou.png", "textures/seal-adou.png", "c0ffee00-0000-4000-8000-000000000106"],
  panel: ["panel-paper.png", "textures/panel-paper.png", "c0ffee00-0000-4000-8000-000000000107"],
  cinnabar: ["btn-cinnabar.png", "textures/btn-cinnabar.png", "c0ffee00-0000-4000-8000-000000000108"],
  muted: ["btn-muted.png", "textures/btn-muted.png", "c0ffee00-0000-4000-8000-000000000109"],
  kou: ["kou.png", "foes/kou.png", "c0ffee00-0000-4000-8000-00000000010a"],
  dao: ["unit-dao.png", "textures/unit-dao.png", "c0ffee00-0000-4000-8000-00000000010b"],
};

const TITLE = "MaShanZheng-Regular";
const BODY = "NotoSansCJKsc-Regular";
const INK = "#1d2b38";
const CINNABAR = "#b4332a";
const BROWN = "#4a3728";
const CREAM = "#f7f1e4";
const PAPER = "#f3e6c8";
const WIDTH = board.designWidth;
const HEIGHT = board.designHeight;

let serial = 0;
function nid(prefix) {
  serial += 1;
  return `${prefix}-${serial}`;
}

function skin(key) {
  return `res://${IMAGE[key][2]}`;
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function meta(uuid, importer) {
  return importer ? { uuid, importer } : { uuid };
}

function imageMeta(uuid) {
  return meta(uuid, {
    textureType: 0,
    sRGB: true,
    generateMipmap: false,
    wrapMode: 1,
    filterMode: 1,
    anisoLevel: 1,
    premultiplyAlpha: false,
    hdrEncodeFormat: 0,
  });
}

function toStage(x, y) {
  return { x: WIDTH / 2 + x, y: HEIGHT / 2 - y };
}

function gridPosition(index) {
  const col = index % board.gridCols;
  const row = Math.floor(index / board.gridCols);
  const step = board.cellSize + board.cellGap;
  return {
    x: board.gridOrigin.x + col * step,
    y: board.gridOrigin.y - row * step,
  };
}

function benchPosition(index) {
  return {
    x: board.benchOrigin.x + index * board.benchStep,
    y: board.benchOrigin.y,
  };
}

function label(name, text, options) {
  return {
    _$id: nid("label"),
    _$type: "Label",
    name,
    text,
    font: options.font ?? BODY,
    fontSize: options.size,
    color: options.color ?? INK,
    align: options.align ?? "center",
    valign: "middle",
    width: options.width,
    height: options.height ?? options.size + 10,
    anchorX: options.anchorX ?? 0.5,
    anchorY: options.anchorY ?? 0.5,
    x: options.x ?? 0,
    y: options.y ?? 0,
    stroke: options.stroke ?? 0,
    strokeColor: PAPER,
    wordWrap: Boolean(options.wordWrap),
    bold: Boolean(options.bold),
    mouseEnabled: false,
    visible: options.visible ?? true,
  };
}

function button(name, text, width, height, skinUrl, labelSize) {
  return {
    _$id: nid("button"),
    _$type: "Button",
    name,
    skin: skinUrl,
    label: text,
    labelSize,
    labelColors: `${CREAM},#ffffff,${PAPER}`,
    labelFont: BODY,
    labelBold: true,
    stateNum: 1,
    sizeGrid: "40,48,40,48",
    width,
    height,
    x: 0,
    y: 0,
    mouseEnabled: true,
  };
}

function image(name, key, width, height, options = {}) {
  return {
    _$id: nid("image"),
    _$type: "Image",
    name,
    skin: skin(key),
    width,
    height,
    anchorX: options.anchor ?? 0,
    anchorY: options.anchor ?? 0,
    x: options.x ?? 0,
    y: options.y ?? 0,
    alpha: options.alpha ?? 1,
    mouseEnabled: false,
    ...(options.sizeGrid ? { sizeGrid: options.sizeGrid } : {}),
  };
}

function sprite(name, children, options = {}) {
  return {
    _$id: nid("sprite"),
    _$type: "Sprite",
    name,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 0,
    height: options.height ?? 0,
    mouseEnabled: options.mouseEnabled ?? false,
    mouseThrough: options.mouseThrough ?? true,
    visible: options.visible ?? true,
    _$child: children,
  };
}

function prefabInstance(uuid, name, options = {}) {
  return {
    _$id: nid("prefab"),
    _$prefab: uuid,
    name,
    ...options,
  };
}

function paperPrefab() {
  return {
    _$ver: 1,
    _$id: nid("paper"),
    _$type: "Image",
    name: "PaperPanel",
    skin: skin("panel"),
    width: 688,
    height: 248,
    sizeGrid: "40,40,40,40",
    mouseEnabled: false,
  };
}

function recruitPrefab() {
  return {
    _$ver: 1,
    _$id: nid("recruit"),
    _$type: "Box",
    name: "RecruitButton",
    width: 188,
    height: 58,
    mouseEnabled: true,
    _$child: [button("Button", "招募", 188, 58, skin("cinnabar"), 26)],
  };
}

function speedPrefab() {
  return {
    _$ver: 1,
    _$id: nid("speed"),
    _$type: "Box",
    name: "SpeedButton",
    width: 160,
    height: 52,
    mouseEnabled: true,
    _$child: [button("Button", "常速", 160, 52, skin("muted"), 24)],
  };
}

function cellPrefab() {
  return {
    _$ver: 1,
    _$id: nid("cell"),
    _$type: "Image",
    name: "CellMarker",
    skin: skin("cell"),
    width: board.cellSize,
    height: board.cellSize,
    anchorX: 0.5,
    anchorY: 0.5,
    mouseEnabled: false,
  };
}

function sealPrefab() {
  return {
    _$ver: 1,
    _$id: nid("seal"),
    _$type: "Image",
    name: "SealMark",
    skin: skin("seal"),
    width: 108,
    height: 108,
    anchorX: 0.5,
    anchorY: 0.5,
    mouseEnabled: false,
  };
}

function glyphPrefab() {
  return {
    _$ver: 1,
    _$id: nid("glyph"),
    _$type: "Sprite",
    name: "UnitGlyph",
    width: 78,
    height: 78,
    mouseEnabled: false,
    mouseThrough: true,
    _$child: [
      image("Body", "dao", 78, 78, { anchor: 0.5 }),
      label("Glyph", "刀", {
        size: 36,
        color: CREAM,
        width: 72,
        font: TITLE,
        stroke: 0,
      }),
      label("Rank", "一品", { size: 16, color: BROWN, width: 72, y: -50, stroke: 3 }),
      label("Style", "近战·斩", { size: 14, color: INK, width: 92, y: 50, stroke: 3 }),
      sprite("Rings", []),
      sprite("Hp", []),
    ],
  };
}

function cells() {
  const nodes = [];
  const gridCount = board.gridCols * board.gridRows;
  for (let index = 0; index < gridCount; index += 1) {
    const at = toStage(gridPosition(index).x, gridPosition(index).y);
    nodes.push(prefabInstance(PREFAB.cell, `Cell${index}`, { x: at.x, y: at.y }));
  }
  for (let index = 0; index < board.benchSlots; index += 1) {
    const at = toStage(benchPosition(index).x, benchPosition(index).y);
    nodes.push(prefabInstance(PREFAB.cell, `Bench${index}`, { x: at.x, y: at.y, alpha: 0.72 }));
  }
  return nodes;
}

function captions() {
  const nodes = [];
  const rowCaption = ["前排", "枪", "弓", "后排"];
  for (let row = 0; row < board.gridRows; row += 1) {
    const point = gridPosition(row * board.gridCols);
    const at = toStage(point.x - 78, point.y);
    nodes.push(label(`Row${row}`, rowCaption[row] ?? "", {
      size: 16,
      color: BROWN,
      width: 70,
      x: at.x,
      y: at.y,
      stroke: 3,
    }));
  }
  const bench = benchPosition(0);
  const benchAt = toStage(bench.x - 70, bench.y);
  nodes.push(label("BenchCaption", "席位", {
    size: 16,
    color: BROWN,
    width: 70,
    x: benchAt.x,
    y: benchAt.y,
    stroke: 3,
  }));
  return nodes;
}

function seals() {
  const camp = board.camp ?? { x: 0, y: 312 };
  const campAt = toStage(camp.x, camp.y);
  const center = board.lanes[Math.min(1, board.lanes.length - 1)] ?? [];
  const end = center[center.length - 1] ?? { x: 0, y: -8 };
  const endAt = toStage(end.x, end.y);
  return [
    prefabInstance(PREFAB.seal, "CampSeal", { x: campAt.x, y: campAt.y, skin: skin("kou") }),
    label("CampCaption", "北营", { size: 18, color: BROWN, width: 80, x: campAt.x, y: campAt.y + 68, stroke: 3 }),
    prefabInstance(PREFAB.seal, "AdouSeal", { x: endAt.x, y: endAt.y }),
    label("AdouCaption", "南岸", { size: 18, color: BROWN, width: 80, x: endAt.x, y: endAt.y + 68, stroke: 3 }),
  ];
}

function riverNode() {
  const river = board.river;
  const at = toStage(river.x, river.y);
  return image("River", "river", river.w, river.h, { anchor: 0.5, x: at.x, y: at.y });
}

function scene() {
  const hud = {
    _$id: nid("hud"),
    _$type: "Box",
    name: "Hud",
    x: 0,
    y: 0,
    width: WIDTH,
    height: 280,
    mouseEnabled: true,
    _$child: [
      prefabInstance(PREFAB.paper, "Paper", { x: 16, y: 12 }),
      label("Title", "墨卫", {
        size: 56,
        font: TITLE,
        width: 220,
        x: 36,
        y: 48,
        anchorX: 0,
        align: "left",
      }),
      label("Wave", "第 1 / 5 波", {
        size: 26,
        width: 460,
        x: 36,
        y: 108,
        anchorX: 0,
        align: "left",
        stroke: 3,
      }),
      label("Kinds", "寇 近战 · 矛 近战 · 矢 远程", {
        size: 20,
        color: BROWN,
        width: 640,
        x: 36,
        y: 146,
        anchorX: 0,
        align: "left",
        stroke: 2,
      }),
      sprite("HpTrack", [], { x: 36, y: 184, width: 280, height: 20, mouseThrough: false }),
      sprite("HpFill", [], { x: 36, y: 184, width: 280, height: 20, mouseThrough: false }),
      label("HpText", "阿斗", {
        size: 18,
        width: 420,
        x: 328,
        y: 194,
        anchorX: 0,
        align: "left",
        stroke: 3,
      }),
      label("Mantou", "馒头", {
        size: 24,
        color: BROWN,
        width: 340,
        x: 36,
        y: 230,
        anchorX: 0,
        align: "left",
        stroke: 3,
      }),
      prefabInstance(PREFAB.recruit, "Recruit", { x: 500, y: 176 }),
      prefabInstance(PREFAB.speed, "Speed", { x: 528, y: 22 }),
    ],
  };

  const tutorial = {
    _$id: nid("tutorial"),
    _$type: "Box",
    name: "Tutorial",
    x: 16,
    y: 1148,
    width: 688,
    height: 118,
    visible: false,
    mouseEnabled: true,
    _$child: [
      label("TutorialLabel", "开局有两枚「刀」。拖到一起就升品，圈纹会变。刀骑放前排，弓放后排。", {
        size: 22,
        width: 520,
        height: 52,
        x: 344,
        y: 36,
        wordWrap: true,
      }),
      button("GuideOk", "知道了", 160, 44, skin("muted"), 22),
    ],
  };
  tutorial._$child[1].x = 264;
  tutorial._$child[1].y = 64;

  const overlay = {
    _$id: nid("overlay"),
    _$type: "Box",
    name: "Overlay",
    x: 0,
    y: 0,
    width: WIDTH,
    height: HEIGHT,
    visible: false,
    mouseEnabled: true,
    _$child: [
      {
        _$id: nid("card"),
        _$type: "Box",
        name: "OverlayCard",
        x: (WIDTH - 520) / 2,
        y: 430,
        width: 520,
        height: 320,
        mouseEnabled: true,
        _$child: [
          label("OverlayTitle", "墨阵已稳", { size: 48, font: TITLE, width: 480, x: 260, y: 78 }),
          label("OverlayBody", "守住了这一阵。", {
            size: 24,
            color: BROWN,
            width: 460,
            height: 90,
            x: 260,
            y: 160,
            wordWrap: true,
          }),
          button("Again", "再守一阵", 220, 58, skin("cinnabar"), 26),
        ],
      },
    ],
  };
  overlay._$child[0]._$child[2].x = 150;
  overlay._$child[0]._$child[2].y = 230;

  return {
    _$ver: 1,
    _$id: nid("scene"),
    _$type: "Scene",
    name: "Main",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    width: WIDTH,
    height: HEIGHT,
    mouseThrough: false,
    _$comp: [
      {
        _$id: nid("main"),
        _$type: SCRIPT_UUID,
      },
    ],
    _$child: [
      image("Background", "bg", WIDTH, HEIGHT),
      image("Mountain", "mountain", WIDTH, 340, { alpha: 0.92 }),
      image("Bamboo", "bamboo", 110, 160, { anchor: 0.5, x: 668, y: 520, alpha: 0.8 }),
      sprite("World", [
        sprite("Board", [riverNode(), ...cells(), ...seals(), ...captions()], { mouseThrough: true }),
        sprite("Range", [], { mouseThrough: true }),
        sprite("Actors", [], { mouseThrough: true }),
        sprite("Shots", [], { mouseThrough: true }),
        sprite("Drag", [], { mouseThrough: true }),
        sprite("Floats", [], { mouseThrough: true }),
      ], { width: WIDTH, height: HEIGHT, mouseThrough: true }),
      hud,
      label("Hint", "北营沿墨路南下。刀骑守前排，枪靠前，弓放后排。点空处取消射程。", {
        size: 20,
        color: BROWN,
        width: 660,
        height: 64,
        x: WIDTH / 2,
        y: 1236,
        wordWrap: true,
        stroke: 3,
      }),
      label("Banner", "", {
        size: 42,
        font: TITLE,
        color: CINNABAR,
        width: 420,
        x: WIDTH / 2,
        y: 390,
        visible: false,
      }),
      tutorial,
      overlay,
      prefabInstance(PREFAB.glyph, "UnitGlyph", { x: 48, y: 360, visible: false }),
    ],
  };
}

function copyUi() {
  const dir = join(project, "assets/ui");
  mkdirSync(dir, { recursive: true });
  for (const [file, source, uuid] of Object.values(IMAGE)) {
    copyFileSync(join(shared, source), join(dir, file));
    writeJson(join(dir, `${file}.meta`), imageMeta(uuid));
  }
  writeJson(join(project, "assets/ui.meta"), meta("c0ffee00-0000-4000-8000-0000000000a3"));
}

function writePrefabs() {
  const dir = join(project, "assets/prefabs");
  mkdirSync(dir, { recursive: true });
  const files = [
    ["PaperPanel.lh", PREFAB.paper, paperPrefab()],
    ["RecruitButton.lh", PREFAB.recruit, recruitPrefab()],
    ["SpeedButton.lh", PREFAB.speed, speedPrefab()],
    ["CellMarker.lh", PREFAB.cell, cellPrefab()],
    ["SealMark.lh", PREFAB.seal, sealPrefab()],
    ["UnitGlyph.lh", PREFAB.glyph, glyphPrefab()],
  ];
  for (const [name, uuid, data] of files) {
    writeJson(join(dir, name), data);
    writeJson(join(dir, `${name}.meta`), meta(uuid));
  }
  writeJson(join(project, "assets/prefabs.meta"), meta("c0ffee00-0000-4000-8000-0000000000a2"));
}

function writeScene() {
  const dir = join(project, "assets/scenes");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "Main.ls"), scene());
  writeJson(join(dir, "Main.ls.meta"), meta(SCENE_UUID));
  writeJson(join(project, "assets/scenes.meta"), meta("c0ffee00-0000-4000-8000-0000000000a1"));
}

function writeScriptMeta() {
  writeJson(join(project, "src/Main.ts.meta"), meta(SCRIPT_UUID));
}

copyUi();
writePrefabs();
writeScene();
writeScriptMeta();
console.log(`Wrote Main.ls (${SCENE_UUID}) and prefabs. Script ${SCRIPT_UUID}.`);
