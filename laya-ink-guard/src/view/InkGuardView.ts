import type { GameConfig } from "../config/ConfigTypes";
import { boardLanes, benchPosition, dropSlotAt, gridPosition, pathMarksWithin, slotsWithin } from "../logic/geometry";
import { GameSim, tokenPosition, type Place, type Shot, type Token } from "../logic/GameSim";
import type { ArtBook } from "./assets";
import { Ink, MARK, RANK, hexAlpha, paintTier, tierRankColor, tierScale } from "./theme";

const HINT = "北营沿墨路南下。刀骑守前排，枪靠前，弓放后排。点空处取消射程。";
const GUIDE_HINT = "把两枚「刀」叠在一起。升品后圈纹会变。点空处可取消射程。";
const GUIDE_KEY = "ink-guard-merge-guide";
const ROW_CAPTION = ["前排", "枪", "弓", "后排"];

interface Fonts {
  title: string;
  body: string;
}

interface Drag {
  id: string;
  x: number;
  y: number;
  touch: boolean;
}

interface TokenView {
  root: Laya.Sprite;
  body: Laya.Sprite;
  glyph: Laya.Label | null;
  rings: Laya.Sprite;
  style: Laya.Label;
  rank: Laya.Label;
  hp: Laya.Sprite;
  level: number;
  poseStart: number;
}

interface EnemyView {
  root: Laya.Sprite;
  body: Laya.Sprite;
  glyph: Laya.Label | null;
  style: Laya.Label;
  hp: Laya.Sprite;
  poseStart: number;
}

interface ShotView {
  root: Laya.Sprite;
  arrow: Laya.Image | null;
}

interface FloatView {
  label: Laya.Label;
}

interface SlotMark {
  place: Place;
  slot: number;
  node: Laya.Sprite;
}

interface Impact {
  node: Laya.Sprite;
  age: number;
}

/**
 * Screen built from LayaAir's own 2D components: Box, Button, Label, Image, Sprite.
 * FairyGUI is not used. Tokens and foes are created as they spawn; the HUD is a Box.
 */
export class InkGuardView {
  private readonly sim: GameSim;
  private readonly width: number;
  private readonly height: number;
  private readonly tokens = new Map<string, TokenView>();
  private readonly enemies = new Map<string, EnemyView>();
  private readonly shots = new Map<string, ShotView>();
  private readonly floats = new Map<string, FloatView>();
  private readonly slotMarks: SlotMark[] = [];
  private readonly impacts: Impact[] = [];
  private readonly seenShots = new Set<string>();

  private readonly world = new Laya.Sprite();
  private readonly boardLayer = new Laya.Sprite();
  private readonly rangeLayer = new Laya.Sprite();
  private readonly actorLayer = new Laya.Sprite();
  private readonly shotLayer = new Laya.Sprite();
  private readonly dragLayer = new Laya.Sprite();
  private readonly floatLayer = new Laya.Sprite();
  private readonly hud = new Laya.Box();
  private readonly tutorial = new Laya.Box();
  private readonly overlay = new Laya.Box();
  private readonly banner: Laya.Label;

  private readonly waveLabel: Laya.Label;
  private readonly hpText: Laya.Label;
  private readonly hpFill = new Laya.Sprite();
  private readonly mantouLabel: Laya.Label;
  private readonly hintLabel: Laya.Label;
  private readonly recruitButton: Laya.Button;
  private readonly recruitPlate: Laya.Box;
  private readonly speedButton: Laya.Button;
  private readonly speedPlate: Laya.Box;
  private readonly tutorialLabel: Laya.Label;
  private readonly overlayTitle: Laya.Label;
  private readonly overlayBody: Laya.Label;

  private drag: Drag | null = null;
  private selectedId: string | null = null;
  private timeScale = 1;
  private toast = "";
  private toastTimer = 0;
  private guidePending = false;
  private shownPhase = "playing";
  private clock = 0;

  constructor(
    private readonly config: GameConfig,
    private readonly art: ArtBook,
    private readonly fonts: Fonts,
  ) {
    this.width = config.board.designWidth;
    this.height = config.board.designHeight;
    this.sim = new GameSim(config, seed());
    this.banner = this.makeLabel("", 42, fonts.title, Ink.cinnabar, 420, 0);
    this.waveLabel = this.makeLabel("", 26, fonts.body, Ink.ink, 460, 3);
    this.hpText = this.makeLabel("", 18, fonts.body, Ink.cream, 420, 3);
    this.mantouLabel = this.makeLabel("", 24, fonts.body, Ink.brown, 340, 3);
    this.hintLabel = this.makeLabel(HINT, 20, fonts.body, Ink.brown, 660, 3);
    this.tutorialLabel = this.makeLabel("", 22, fonts.body, Ink.ink, 520, 0);
    this.overlayTitle = this.makeLabel("", 48, fonts.title, Ink.ink, 480, 0);
    this.overlayBody = this.makeLabel("", 24, fonts.body, Ink.brown, 460, 0);
    const recruit = this.makeButton("招募", 188, 58, Ink.cinnabar);
    this.recruitPlate = recruit.plate;
    this.recruitButton = recruit.button;
    const speed = this.makeButton("常速", 160, 52, Ink.ink);
    this.speedButton = speed.button;
    this.speedPlate = speed.plate;
  }

  start(): void {
    this.buildWorld();
    this.buildHud();
    this.buildTutorial();
    this.buildOverlay();
    this.guidePending = !guideSeen();
    if (this.guidePending) {
      this.grantGuide();
    }
    Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onDown);
    Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onMove);
    Laya.stage.on(Laya.Event.MOUSE_UP, this, this.onUp);
    this.recruitButton.on(Laya.Event.CLICK, this, this.onRecruit);
    this.speedButton.on(Laya.Event.CLICK, this, this.onSpeed);
    Laya.timer.frameLoop(1, this, this.onFrame);
    this.syncHud();
  }

  private buildWorld(): void {
    const bg = this.makeImage("textures/bg-paper.png", this.width, this.height, 0);
    if (bg) {
      bg.pos(0, 0);
      Laya.stage.addChild(bg);
    } else {
      const wash = new Laya.Sprite();
      wash.graphics.drawRect(0, 0, this.width, this.height, Ink.paper, null, 0);
      wash.mouseEnabled = false;
      Laya.stage.addChild(wash);
    }
    const mountain = this.makeImage("textures/mountain-top.png", this.width, 340, 0);
    if (mountain) {
      mountain.pos(0, 0);
      mountain.alpha = 0.92;
      Laya.stage.addChild(mountain);
    }
    const bamboo = this.makeImage("textures/bamboo.png", 110, 160, 0.5);
    if (bamboo) {
      bamboo.pos(668, 520);
      bamboo.alpha = 0.8;
      Laya.stage.addChild(bamboo);
    }

    this.world.mouseEnabled = false;
    this.world.mouseThrough = true;
    Laya.stage.addChild(this.world);
    for (const layer of [this.boardLayer, this.rangeLayer, this.actorLayer, this.shotLayer, this.dragLayer, this.floatLayer]) {
      layer.mouseEnabled = false;
      layer.mouseThrough = true;
      this.world.addChild(layer);
    }
    this.paintRiver();
    this.paintLanes();
    this.paintSlots();
    this.paintSeals();
    this.paintRowCaptions();
  }

  private buildHud(): void {
    this.hud.size(this.width, 280);
    this.hud.mouseEnabled = true;
    const panel = this.makeImage("textures/panel-paper.png", 688, 248, 0);
    if (panel) {
      panel.pos(16, 12);
      panel.alpha = 0.94;
      panel.mouseEnabled = false;
      this.hud.addChild(panel);
    } else {
      this.hud.graphics.drawRoundRect(16, 12, 688, 248, 18, 18, 18, 18, hexAlpha(Ink.paper, 0.92), Ink.brown, 2);
    }
    const title = this.makeLabel("墨卫", 56, this.fonts.title, Ink.ink, 220, 0);
    title.anchorX = 0;
    title.align = "left";
    title.pos(36, 48);
    this.hud.addChild(title);

    this.waveLabel.anchorX = 0;
    this.waveLabel.align = "left";
    this.waveLabel.pos(36, 108);
    this.hud.addChild(this.waveLabel);

    const kinds = this.makeLabel(this.kindLine(), 20, this.fonts.body, Ink.brown, 640, 2);
    kinds.anchorX = 0;
    kinds.align = "left";
    kinds.pos(36, 146);
    this.hud.addChild(kinds);

    const track = new Laya.Sprite();
    track.pos(36, 184);
    track.mouseEnabled = false;
    track.graphics.drawRoundRect(0, 0, 280, 20, 8, 8, 8, 8, "#d5c4a4", Ink.brown, 2);
    this.hpFill.pos(36, 184);
    this.hpFill.mouseEnabled = false;
    this.hud.addChild(track);
    this.hud.addChild(this.hpFill);
    this.hpText.anchorX = 0;
    this.hpText.align = "left";
    this.hpText.color = Ink.ink;
    this.hpText.pos(328, 194);
    this.hud.addChild(this.hpText);

    this.mantouLabel.anchorX = 0;
    this.mantouLabel.align = "left";
    this.mantouLabel.pos(36, 230);
    this.hud.addChild(this.mantouLabel);

    this.recruitPlate.pos(500, 176);
    this.hud.addChild(this.recruitPlate);
    this.speedPlate.pos(528, 22);
    this.hud.addChild(this.speedPlate);

    this.hintLabel.wordWrap = true;
    this.hintLabel.height = 64;
    this.hintLabel.pos(this.width / 2, 1236);
    Laya.stage.addChild(this.hud);
    Laya.stage.addChild(this.hintLabel);

    this.banner.pos(this.width / 2, 390);
    this.banner.visible = false;
    this.banner.mouseEnabled = false;
    Laya.stage.addChild(this.banner);
  }

  private buildTutorial(): void {
    this.tutorial.size(688, 118);
    this.tutorial.pos(16, 1148);
    this.tutorial.graphics.drawRoundRect(0, 0, 688, 118, 16, 16, 16, 16, hexAlpha(Ink.paper, 0.96), Ink.gold, 3);
    this.tutorialLabel.text = "开局有两枚「刀」。拖到一起就升品，圈纹会变。刀骑放前排，弓放后排。";
    this.tutorialLabel.wordWrap = true;
    this.tutorialLabel.height = 52;
    this.tutorialLabel.pos(344, 36);
    this.tutorial.addChild(this.tutorialLabel);
    const ok = this.makeButton("知道了", 160, 44, Ink.moss);
    ok.plate.pos(264, 64);
    ok.button.on(Laya.Event.CLICK, this, this.onGuideDismiss);
    this.tutorial.addChild(ok.plate);
    this.tutorial.visible = this.guidePending;
    Laya.stage.addChild(this.tutorial);
  }

  private buildOverlay(): void {
    this.overlay.size(this.width, this.height);
    this.overlay.graphics.drawRect(0, 0, this.width, this.height, hexAlpha(Ink.ink, 0.55), null, 0);
    this.overlay.mouseEnabled = true;
    this.overlay.visible = false;
    const card = new Laya.Box();
    card.size(520, 320);
    card.pos((this.width - 520) / 2, 430);
    card.graphics.drawRoundRect(0, 0, 520, 320, 18, 18, 18, 18, Ink.paper, Ink.gold, 3);
    card.mouseEnabled = true;
    this.overlayTitle.pos(260, 78);
    this.overlayBody.wordWrap = true;
    this.overlayBody.height = 90;
    this.overlayBody.pos(260, 160);
    card.addChild(this.overlayTitle);
    card.addChild(this.overlayBody);
    const again = this.makeButton("再守一阵", 220, 58, Ink.cinnabar);
    again.plate.pos(150, 230);
    again.button.on(Laya.Event.CLICK, this, this.onRestart);
    card.addChild(again.plate);
    this.overlay.addChild(card);
    Laya.stage.addChild(this.overlay);
  }

  private paintRiver(): void {
    const river = this.config.board.river;
    if (!river) {
      return;
    }
    const image = this.makeImage("textures/river.png", river.w, river.h, 0.5);
    const at = this.toStage(river.x, river.y);
    if (image) {
      image.pos(at.x, at.y);
      this.boardLayer.addChild(image);
    }
  }

  private paintLanes(): void {
    const pen = new Laya.Sprite();
    pen.mouseEnabled = false;
    const lanes = boardLanes(this.config.board);
    for (const lane of lanes) {
      const points: number[] = [];
      for (const point of lane) {
        const at = this.toStage(point.x, point.y);
        points.push(at.x, at.y);
      }
      if (points.length < 4) {
        continue;
      }
      pen.graphics.drawLines(0, 0, points, hexAlpha("#4f7c90", 0.45), 26);
      pen.graphics.drawLines(0, 0, points, hexAlpha(Ink.cream, 0.92), 9);
    }
    this.boardLayer.addChild(pen);
  }

  private paintSlots(): void {
    const board = this.config.board;
    const gridCount = board.gridCols * board.gridRows;
    for (let i = 0; i < gridCount; i += 1) {
      this.addSlot("grid", i, gridPosition(board, i), board.cellSize);
    }
    for (let i = 0; i < board.benchSlots; i += 1) {
      this.addSlot("bench", i, benchPosition(board, i), board.cellSize);
    }
  }

  private addSlot(place: Place, slot: number, point: { x: number; y: number }, size: number): void {
    const at = this.toStage(point.x, point.y);
    const image = this.makeImage("textures/cell.png", size, size, 0.5);
    if (image) {
      image.pos(at.x, at.y);
      image.alpha = place === "bench" ? 0.72 : 1;
      this.boardLayer.addChild(image);
    } else {
      const cell = new Laya.Sprite();
      cell.graphics.drawRoundRect(-size / 2, -size / 2, size, size, 8, 8, 8, 8, hexAlpha(Ink.cream, 0.8), Ink.brown, 2);
      cell.pos(at.x, at.y);
      cell.mouseEnabled = false;
      this.boardLayer.addChild(cell);
    }
    const mark = new Laya.Sprite();
    mark.pos(at.x, at.y);
    mark.mouseEnabled = false;
    this.boardLayer.addChild(mark);
    this.slotMarks.push({ place, slot, node: mark });
  }

  private paintSeals(): void {
    const board = this.config.board;
    const camp = board.camp ?? { x: 0, y: 312 };
    this.addSeal(camp.x, camp.y, "寇", "北营", "foes/kou.png");
    const end = board.path[board.path.length - 1] ?? { x: 0, y: -8 };
    this.addSeal(end.x, end.y, "斗", "南岸", "textures/seal-adou.png");
  }

  private addSeal(x: number, y: number, glyph: string, caption: string, path: string): void {
    const at = this.toStage(x, y);
    const root = new Laya.Sprite();
    root.pos(at.x, at.y);
    root.mouseEnabled = false;
    const image = this.makeImage(path, 108, 108, 0.5);
    if (image) {
      root.addChild(image);
    } else {
      root.graphics.drawCircle(0, 0, 48, Ink.cream, Ink.cinnabar, 4);
      const text = this.makeLabel(glyph, 40, this.fonts.title, Ink.cinnabar, 80, 0);
      root.addChild(text);
    }
    const cap = this.makeLabel(caption, 18, this.fonts.body, Ink.brown, 80, 3);
    cap.pos(0, 68);
    root.addChild(cap);
    this.boardLayer.addChild(root);
  }

  private paintRowCaptions(): void {
    const board = this.config.board;
    for (let row = 0; row < board.gridRows; row += 1) {
      const point = gridPosition(board, row * board.gridCols);
      const at = this.toStage(point.x - 78, point.y);
      const caption = this.makeLabel(ROW_CAPTION[row] ?? "", 16, this.fonts.body, Ink.brown, 70, 3);
      caption.pos(at.x, at.y);
      this.boardLayer.addChild(caption);
    }
    const bench = benchPosition(board, 0);
    const benchAt = this.toStage(bench.x - 70, bench.y);
    const seat = this.makeLabel("席位", 16, this.fonts.body, Ink.brown, 70, 3);
    seat.pos(benchAt.x, benchAt.y);
    this.boardLayer.addChild(seat);
  }

  private onFrame(): void {
    const real = Math.min(0.05, Math.max(0, Laya.timer.delta / 1000));
    this.clock += real;
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - real);
    }
    if (this.sim.phase === "playing") {
      let left = real * this.timeScale;
      const step = 1 / 60;
      while (left > 0 && this.sim.phase === "playing") {
        const slice = Math.min(step, left);
        this.sim.tick(slice);
        left -= slice;
      }
    }
    this.noteAttacks();
    this.syncTokens();
    this.syncEnemies();
    this.syncShots();
    this.syncFloats();
    this.syncImpacts(real);
    this.paintRange();
    this.paintDragMarks();
    this.syncHud();
  }

  private noteAttacks(): void {
    const live = new Set<string>();
    for (const shot of this.sim.shots) {
      live.add(shot.id);
      if (!this.seenShots.has(shot.id)) {
        const token = this.tokens.get(shot.sourceId);
        if (token) {
          token.poseStart = this.clock;
        }
        const enemy = this.enemies.get(shot.sourceId);
        if (enemy) {
          enemy.poseStart = this.clock;
        }
      }
    }
    this.seenShots.clear();
    for (const id of live) {
      this.seenShots.add(id);
    }
  }

  private syncTokens(): void {
    const live = new Set<string>();
    for (const token of this.sim.tokens) {
      live.add(token.id);
      const view = this.tokens.get(token.id) ?? this.createToken(token);
      this.tokens.set(token.id, view);
      const drag = this.drag;
      const dragging = drag?.id === token.id;
      const point = dragging && drag
        ? { x: drag.x, y: drag.y + (drag.touch ? 64 : 0) }
        : tokenPosition(this.config, token);
      const at = this.toStage(point.x, point.y);
      view.root.pos(at.x, at.y);
      const scale = tierScale(token.level) * (dragging ? 1.08 : 1);
      view.root.scaleX = scale;
      view.root.scaleY = scale;
      const parent = dragging ? this.dragLayer : this.actorLayer;
      if (view.root.parent !== parent) {
        parent.addChild(view.root);
      }
      if (view.level !== token.level) {
        view.level = token.level;
        const type = this.config.units.types[token.type];
        paintTier(view.rings.graphics, token.level, type.ink);
        view.rank.text = `${RANK[token.level] ?? token.level}品`;
        view.rank.color = tierRankColor(token.level);
      }
      const pose = this.poseTexture(token.type, view.poseStart);
      const idle = this.art.tex[`textures/unit-${token.type}.png`] ?? null;
      const tex = pose ?? idle;
      if (tex && view.body.texture !== tex) {
        view.body.texture = tex;
      }
      this.paintHp(view.hp, token.place === "grid" ? token.hp / token.maxHp : -1);
    }
    for (const [id, view] of this.tokens) {
      if (!live.has(id)) {
        view.root.removeSelf();
        view.root.destroy();
        this.tokens.delete(id);
      }
    }
  }

  private createToken(token: Token): TokenView {
    const type = this.config.units.types[token.type];
    const root = new Laya.Sprite();
    root.mouseEnabled = false;
    root.name = `Token-${token.type}`;
    const body = new Laya.Sprite();
    body.anchorX = 0.5;
    body.anchorY = 0.5;
    body.size(78, 78);
    body.mouseEnabled = false;
    body.texture = this.art.tex[`textures/unit-${token.type}.png`] ?? null;
    root.addChild(body);
    let glyph: Laya.Label | null = null;
    if (!body.texture) {
      root.graphics.drawCircle(0, 0, 36, type.ink, Ink.cream, 2);
      glyph = this.makeLabel(type.glyph, 36, this.fonts.title, Ink.cream, 72, 0);
      root.addChild(glyph);
    }
    const rings = new Laya.Sprite();
    rings.mouseEnabled = false;
    paintTier(rings.graphics, token.level, type.ink);
    root.addChild(rings);
    const style = this.makeLabel(`${type.styleLabel}·${type.motionLabel}`, 14, this.fonts.body, Ink.ink, 92, 3);
    style.pos(0, 50);
    const rank = this.makeLabel(`${RANK[token.level] ?? token.level}品`, 16, this.fonts.body, tierRankColor(token.level), 72, 3);
    rank.pos(0, -50);
    const hp = new Laya.Sprite();
    hp.mouseEnabled = false;
    root.addChild(style);
    root.addChild(rank);
    root.addChild(hp);
    this.actorLayer.addChild(root);
    return { root, body, glyph, rings, style, rank, hp, level: token.level, poseStart: 0 };
  }

  private syncEnemies(): void {
    const live = new Set<string>();
    this.sim.enemies.forEach((enemy, index) => {
      live.add(enemy.id);
      const view = this.enemies.get(enemy.id) ?? this.createEnemy(enemy.kind);
      this.enemies.set(enemy.id, view);
      const bob = Math.sin(this.clock * 3 + index) * 2;
      const at = this.toStage(enemy.x, enemy.y + bob);
      view.root.pos(at.x, at.y);
      const pose = this.poseTexture(enemy.kind, view.poseStart);
      const idle = this.art.tex[`foes/${enemy.kind}.png`] ?? null;
      const tex = pose ?? idle;
      if (tex && view.body.texture !== tex) {
        view.body.texture = tex;
      }
      this.paintHp(view.hp, enemy.maxHp <= 0 ? 0 : enemy.hp / enemy.maxHp);
    });
    for (const [id, view] of this.enemies) {
      if (!live.has(id)) {
        view.root.removeSelf();
        view.root.destroy();
        this.enemies.delete(id);
      }
    }
  }

  private createEnemy(kind: string): EnemyView {
    const foe = this.config.foes.types[kind];
    const root = new Laya.Sprite();
    root.mouseEnabled = false;
    root.name = `Foe-${kind}`;
    const body = new Laya.Sprite();
    body.anchorX = 0.5;
    body.anchorY = 0.5;
    body.size(56, 56);
    body.mouseEnabled = false;
    body.texture = this.art.tex[`foes/${kind}.png`] ?? null;
    root.addChild(body);
    let glyph: Laya.Label | null = null;
    if (!body.texture) {
      root.graphics.drawCircle(0, 0, 24, foe?.ink ?? Ink.ink, Ink.cream, 2);
      glyph = this.makeLabel(foe?.glyph ?? "寇", 22, this.fonts.title, Ink.cream, 48, 0);
      root.addChild(glyph);
    }
    const style = this.makeLabel(foe?.styleLabel ?? "", 13, this.fonts.body, Ink.ink, 64, 3);
    style.pos(0, 40);
    const hp = new Laya.Sprite();
    hp.mouseEnabled = false;
    root.addChild(style);
    root.addChild(hp);
    this.actorLayer.addChild(root);
    return { root, body, glyph, style, hp, poseStart: 0 };
  }

  private syncShots(): void {
    const live = new Set<string>();
    for (const shot of this.sim.shots) {
      live.add(shot.id);
      const view = this.shots.get(shot.id) ?? this.createShot(shot);
      this.shots.set(shot.id, view);
      this.paintShot(view, shot);
    }
    for (const [id, view] of this.shots) {
      if (!live.has(id)) {
        this.spawnImpact(view.root.x, view.root.y, Ink.cinnabar);
        view.root.removeSelf();
        view.root.destroy();
        this.shots.delete(id);
      }
    }
  }

  private createShot(shot: Shot): ShotView {
    const root = new Laya.Sprite();
    root.mouseEnabled = false;
    const arrow = shot.style === "ranged" ? this.makeImage("fx/gong-arrow.png", 72, 28, 0.5) : null;
    if (arrow) {
      root.addChild(arrow);
    }
    this.shotLayer.addChild(root);
    return { root, arrow };
  }

  private paintShot(view: ShotView, shot: Shot): void {
    const at = this.toStage(shot.x, shot.y);
    const from = this.toStage(shot.fromX, shot.fromY);
    view.root.pos(at.x, at.y);
    const aim = this.shotAim(shot) ?? { x: shot.x, y: shot.y };
    const aimStage = this.toStage(aim.x, aim.y);
    view.root.rotation = (Math.atan2(aimStage.y - from.y, aimStage.x - from.x) * 180) / Math.PI;
    const g = view.root.graphics;
    g.clear();
    if (shot.style === "ranged") {
      if (view.arrow) {
        view.arrow.visible = true;
        return;
      }
      g.drawLine(-28, 0, 16, 0, shot.ink, 3);
      g.drawLine(16, 0, 6, -7, shot.ink, 3);
      g.drawLine(16, 0, 6, 7, shot.ink, 3);
      return;
    }
    if (view.arrow) {
      view.arrow.visible = false;
    }
    const reach = Math.hypot(at.x - from.x, at.y - from.y);
    if (shot.motion === "thrust" || shot.motion === "charge") {
      g.drawLine(-reach, 0, 10, 0, shot.ink, shot.motion === "charge" ? 8 : 4);
      g.drawLine(14, 0, 0, -8, shot.ink, 3);
      g.drawLine(14, 0, 0, 8, shot.ink, 3);
      return;
    }
    g.drawLine(-18, 14, 20, -16, shot.ink, 5);
    g.drawCircle(16, -12, 5, null, shot.ink, 3);
  }

  private shotAim(shot: Shot): { x: number; y: number } | null {
    if (shot.side === "foe") {
      const token = this.sim.tokens.find((entry) => entry.id === shot.targetId && entry.place === "grid");
      return token ? tokenPosition(this.config, token) : null;
    }
    const enemy = this.sim.enemies.find((entry) => entry.id === shot.targetId);
    return enemy ? { x: enemy.x, y: enemy.y } : null;
  }

  private syncFloats(): void {
    const live = new Set<string>();
    for (const floater of this.sim.floats) {
      live.add(floater.id);
      let view = this.floats.get(floater.id);
      if (!view) {
        const label = this.makeLabel(floater.text, 20, this.fonts.body, Ink.cinnabar, 80, 3);
        this.floatLayer.addChild(label);
        view = { label };
        this.floats.set(floater.id, view);
      }
      const at = this.toStage(floater.x, floater.y);
      view.label.pos(at.x, at.y - floater.age * 36);
      view.label.alpha = 1 - floater.age / 0.7;
    }
    for (const [id, view] of this.floats) {
      if (!live.has(id)) {
        view.label.removeSelf();
        view.label.destroy();
        this.floats.delete(id);
      }
    }
  }

  private syncImpacts(dt: number): void {
    for (const impact of this.impacts) {
      impact.age += dt;
      impact.node.alpha = Math.max(0, 1 - impact.age / 0.2);
      impact.node.scaleX = 1 + impact.age * 3;
      impact.node.scaleY = 1 + impact.age * 3;
    }
    for (let i = this.impacts.length - 1; i >= 0; i -= 1) {
      const impact = this.impacts[i];
      if (impact.age >= 0.2) {
        impact.node.removeSelf();
        impact.node.destroy();
        this.impacts.splice(i, 1);
      }
    }
  }

  private spawnImpact(x: number, y: number, color: string): void {
    const node = new Laya.Sprite();
    node.graphics.drawCircle(0, 0, 10, null, color, 3);
    node.pos(x, y);
    node.mouseEnabled = false;
    this.floatLayer.addChild(node);
    this.impacts.push({ node, age: 0 });
  }

  private paintRange(): void {
    const g = this.rangeLayer.graphics;
    g.clear();
    const id = this.drag?.id ?? this.selectedId;
    if (!id) {
      return;
    }
    const token = this.sim.tokens.find((entry) => entry.id === id);
    if (!token) {
      this.selectedId = null;
      return;
    }
    const stat = this.sim.statOf(token.type, token.level);
    const type = this.config.units.types[token.type];
    const at = this.drag ? { x: this.drag.x, y: this.drag.y } : tokenPosition(this.config, token);
    const center = this.toStage(at.x, at.y);
    g.drawCircle(center.x, center.y, stat.range, hexAlpha(type.ink, 0.1), hexAlpha(type.ink, 0.55), 3);
    g.drawCircle(center.x, center.y, Math.max(4, stat.range - 8), null, hexAlpha(type.ink, 0.22), 1);
    for (const lane of boardLanes(this.config.board)) {
      for (const mark of pathMarksWithin(lane, at.x, at.y, stat.range)) {
        const point = this.toStage(mark.x, mark.y);
        g.drawCircle(point.x, point.y, 4.5, type.ink, null, 0);
      }
    }
    for (const slot of slotsWithin(this.config.board, at.x, at.y, stat.range)) {
      const point = gridPosition(this.config.board, slot);
      const stage = this.toStage(point.x, point.y);
      g.drawCircle(stage.x, stage.y, 5, hexAlpha(type.ink, 0.4), null, 0);
    }
  }

  private paintDragMarks(): void {
    const active = this.drag ? dropSlotAt(this.config.board, this.drag.x, this.drag.y) : null;
    for (const mark of this.slotMarks) {
      mark.node.graphics.clear();
      if (!this.drag) {
        continue;
      }
      const kind = this.sim.previewDrop(this.drag.id, mark.place, mark.slot);
      if (kind !== "move" && kind !== "merge" && kind !== "swap") {
        continue;
      }
      const hot = active?.place === mark.place && active.slot === mark.slot;
      const radius = this.config.board.cellSize / 2 + (hot ? 6 : 2);
      mark.node.graphics.drawCircle(0, 0, radius, null, hexAlpha(MARK[kind], hot ? 0.95 : 0.55), hot ? 5 : 3);
    }
  }

  private syncHud(): void {
    const hp = Math.max(0, Math.round(this.sim.adouHp));
    const maxHp = this.config.adou.maxHp;
    const ratio = maxHp <= 0 ? 0 : hp / maxHp;
    this.hpFill.graphics.clear();
    this.hpFill.graphics.drawRoundRect(0, 0, Math.max(0, 280 * ratio), 20, 8, 8, 8, 8, ratio > 0.35 ? Ink.moss : Ink.cinnabar, null, 0);
    this.hpText.text = `阿斗 ${hp}/${maxHp}`;
    this.mantouLabel.text = `馒头 ${Math.floor(this.sim.mantou)}  +${this.config.economy.incomePerSecond}/秒`;
    const cost = this.sim.nextCost();
    this.recruitButton.label = `招募 ${cost}`;
    const ready = this.sim.phase === "playing" && this.sim.mantou >= cost && this.sim.hasBenchRoom();
    this.paintPlate(this.recruitPlate, 188, 58, ready ? Ink.cinnabar : "#8d8274");
    const head = `第 ${this.sim.waveNumber} / ${this.sim.waveTotal} 波`;
    if (this.sim.phase !== "playing") {
      this.waveLabel.text = head;
    } else if (this.sim.betweenWaves) {
      this.waveLabel.text = `${head} · 备墨 ${Math.ceil(this.sim.betweenTimer)}s`;
    } else {
      this.waveLabel.text = `${head} · 来敌 ${this.sim.enemies.length}`;
    }
    this.hintLabel.visible = !this.guidePending || this.toastTimer > 0;
    this.hintLabel.text = this.toastTimer > 0 ? this.toast : this.guidePending ? GUIDE_HINT : HINT;
    this.hintLabel.color = this.toastTimer > 0 ? Ink.cinnabar : Ink.brown;
    const showBanner = this.sim.phase === "playing" && this.sim.bannerTimer > 0;
    this.banner.visible = showBanner;
    if (showBanner) {
      this.banner.text = this.sim.banner;
      this.banner.alpha = Math.min(1, this.sim.bannerTimer / 0.25);
    }
    this.speedButton.label = this.timeScale === 1 ? "常速" : "三倍";
    if (this.sim.phase !== "playing" && this.shownPhase !== this.sim.phase) {
      this.shownPhase = this.sim.phase;
      this.overlay.visible = true;
      if (this.sim.phase === "win") {
        this.overlayTitle.text = "墨阵已稳";
        this.overlayBody.text = `守住了全部 ${this.sim.waveTotal} 波，阿斗还剩 ${hp} 点气血。`;
      } else {
        this.overlayTitle.text = "墨阵破了";
        this.overlayBody.text = "阿斗气血见底。重整旗鼓，再守一阵。";
      }
    }
  }

  private onDown(event: Laya.Event): void {
    if (this.overlay.visible || this.sim.phase !== "playing" || this.drag) {
      return;
    }
    if (this.isChrome(event.target)) {
      this.selectedId = null;
      return;
    }
    const point = this.boardPointer();
    const token = this.tokenAt(point.x, point.y);
    if (!token) {
      this.selectedId = null;
      return;
    }
    this.selectedId = token.id;
    const touch = event.nativeEvent?.pointerType === "touch";
    this.drag = { id: token.id, x: point.x, y: point.y, touch };
  }

  private onMove(): void {
    if (!this.drag) {
      return;
    }
    const point = this.boardPointer();
    this.drag.x = point.x;
    this.drag.y = point.y;
  }

  private onUp(): void {
    if (!this.drag) {
      return;
    }
    const point = this.boardPointer();
    const tokenId = this.drag.id;
    this.drag = null;
    const slot = dropSlotAt(this.config.board, point.x, point.y);
    if (!slot) {
      return;
    }
    const result = this.sim.drop(tokenId, slot.place, slot.slot);
    if (!result.ok) {
      this.showToast(result.reason === "max-level" ? "已是最高品" : "这里放不下");
      return;
    }
    if (result.action === "merge" && this.guidePending) {
      this.completeGuide();
    }
  }

  private onRecruit(): void {
    this.selectedId = null;
    if (this.sim.phase !== "playing" || this.drag) {
      return;
    }
    const result = this.sim.recruit();
    if (!result.ok) {
      this.showToast(result.reason === "broke" ? "馒头不够" : "席位已满");
    }
  }

  private onSpeed(): void {
    this.selectedId = null;
    this.timeScale = this.timeScale === 1 ? 3 : 1;
    this.speedButton.label = this.timeScale === 1 ? "常速" : "三倍";
  }

  private onGuideDismiss(): void {
    this.completeGuide();
  }

  private onRestart(): void {
    this.drag = null;
    this.selectedId = null;
    this.timeScale = 1;
    this.toast = "";
    this.toastTimer = 0;
    this.shownPhase = "playing";
    this.overlay.visible = false;
    this.speedButton.label = "常速";
    this.sim.reset(seed());
    if (this.guidePending) {
      this.grantGuide();
    }
  }

  private grantGuide(): void {
    this.sim.placeGuideToken("dao", "bench", 0);
    this.sim.placeGuideToken("dao", "bench", 1);
    this.tutorial.visible = true;
  }

  private completeGuide(): void {
    this.guidePending = false;
    this.tutorial.visible = false;
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      /* the card still stays hidden for this visit */
    }
  }

  private showToast(message: string): void {
    this.toast = message;
    this.toastTimer = 1.8;
  }

  private tokenAt(x: number, y: number): Token | null {
    let best: Token | null = null;
    let bestD = 46;
    for (const token of this.sim.tokens) {
      const pos = tokenPosition(this.config, token);
      const distance = Math.hypot(pos.x - x, pos.y - y);
      if (distance <= bestD) {
        bestD = distance;
        best = token;
      }
    }
    return best;
  }

  private boardPointer(): { x: number; y: number } {
    return {
      x: Laya.stage.mouseX - this.width / 2,
      y: this.height / 2 - Laya.stage.mouseY,
    };
  }

  private toStage(x: number, y: number): { x: number; y: number } {
    return { x: this.width / 2 + x, y: this.height / 2 - y };
  }

  private isChrome(target: Laya.Node | null): boolean {
    return this.isUnder(target, this.hud) || this.isUnder(target, this.tutorial) || this.isUnder(target, this.overlay);
  }

  private isUnder(node: Laya.Node | null, root: Laya.Node): boolean {
    let current = node;
    while (current) {
      if (current === root) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private kindLine(): string {
    return this.config.foes.order
      .map((id) => {
        const foe = this.config.foes.types[id];
        return `${foe.glyph} ${foe.styleLabel}`;
      })
      .join(" · ");
  }

  private poseTexture(id: string, start: number): Laya.Texture | null {
    if (start <= 0) {
      return null;
    }
    const age = this.clock - start;
    if (age < 0 || age > 0.36) {
      return null;
    }
    const frames = [0, 1, 2, 3]
      .map((frame) => this.art.tex[`pose/${id}-${frame}.png`])
      .filter((tex): tex is Laya.Texture => !!tex);
    if (frames.length === 0) {
      return null;
    }
    const index = Math.min(frames.length - 1, Math.floor((age / 0.36) * frames.length));
    return frames[index] ?? null;
  }

  private paintHp(node: Laya.Sprite, ratio: number): void {
    node.graphics.clear();
    if (ratio < 0) {
      return;
    }
    node.graphics.drawRect(-18, -46, 36, 5, hexAlpha(Ink.ink, 0.35), null, 0);
    node.graphics.drawRect(-18, -46, 36 * Math.max(0, Math.min(1, ratio)), 5, ratio > 0.35 ? Ink.moss : Ink.cinnabar, null, 0);
  }

  private paintPlate(plate: Laya.Box, w: number, h: number, fill: string): void {
    plate.graphics.clear();
    plate.graphics.drawRoundRect(0, 0, w, h, 14, 14, 14, 14, fill, Ink.brown, 2);
  }

  private makeLabel(text: string, size: number, font: string, color: string, width: number, stroke: number): Laya.Label {
    const label = new Laya.Label();
    label.text = text;
    label.fontSize = size;
    label.font = font;
    label.color = color;
    label.align = "center";
    label.valign = "middle";
    label.width = width;
    label.height = size + 10;
    label.anchorX = 0.5;
    label.anchorY = 0.5;
    label.stroke = stroke;
    label.strokeColor = Ink.paper;
    label.mouseEnabled = false;
    return label;
  }

  private makeButton(text: string, w: number, h: number, fill: string): { plate: Laya.Box; button: Laya.Button } {
    const plate = new Laya.Box();
    plate.size(w, h);
    this.paintPlate(plate, w, h, fill);
    const button = new Laya.Button(null, text);
    button.labelSize = Math.min(28, Math.floor(h * 0.46));
    button.labelColors = `${Ink.cream},#ffffff,${Ink.paper}`;
    button.labelFont = this.fonts.body;
    button.labelBold = true;
    button.stateNum = 1;
    button.size(w, h);
    plate.addChild(button);
    return { plate, button };
  }

  private makeImage(path: string, w: number, h: number, anchor: number): Laya.Image | null {
    const tex = this.art.tex[path];
    if (!tex) {
      return null;
    }
    const image = new Laya.Image();
    image.source = tex;
    image.anchorX = anchor;
    image.anchorY = anchor;
    image.mouseEnabled = false;
    const sw = tex.sourceWidth || tex.width || w;
    const sh = tex.sourceHeight || tex.height || h;
    if (sw > 0 && sh > 0) {
      image.scaleX = w / sw;
      image.scaleY = h / sh;
    }
    return image;
  }
}

function seed(): number {
  return Date.now() % 2147483647;
}

function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
}
