import {
  _decorator,
  Button,
  Canvas,
  Color,
  Component,
  EventTouch,
  Font,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Node,
  Overflow,
  ResolutionPolicy,
  resources,
  Sprite,
  SpriteFrame,
  sys,
  UIOpacity,
  UITransform,
  Vec3,
  VerticalTextAlignment,
  view,
} from 'cc';
import { loadGameConfig } from './config/ConfigService';
import type { GameConfig } from './config/ConfigTypes';
import { dropSlotAt } from './logic/geometry';
import { GameSim, tokenPosition, type DropResult, type Place, type Token } from './logic/GameSim';
import { Ink, RANK, inkColor, paintRange } from './view/InkWidgets';

const { ccclass, property } = _decorator;

interface TokenView {
  id: string;
  typeId: string;
  root: Node;
  body: Sprite;
  rank: Label;
  idle: SpriteFrame | null;
  poseFrames: SpriteFrame[];
  poseTime: number;
  poseDuration: number;
  shownLevel: number;
}

interface ShotView {
  node: Node;
  sprite: Sprite;
  style: string;
  typeId: string;
  frames: SpriteFrame[];
}

interface BurstView {
  node: Node;
  sprite: Sprite;
  frames: SpriteFrame[];
  age: number;
  life: number;
}

interface EnemyView {
  root: Node;
  hp: Label;
  shownHp: number;
}

interface SlotMark {
  place: Place;
  slot: number;
  node: Node;
  sprite: Sprite;
}

interface PointerEvent {
  getLocation(): { x: number; y: number };
  getID?: () => number;
}

const HINT = '招募字令，拖上阵。相同字令叠在一起升品，不同字令可以换位。';
const GUIDE_HINT = '把两枚「刀」叠在一起。拖动时金色可合成，青色可换位，绿色是空位。';
const GUIDE_KEY = 'ink-guard-merge-guide';
const UNIT_ORDER = ['dao', 'qiang', 'gong', 'qi'] as const;

const MARK_COLOR: Record<'move' | 'merge' | 'swap', string> = {
  move: Ink.moss,
  merge: Ink.gold,
  swap: Ink.mist,
};

/**
 * Binds the scene HUD and drives the simulation.
 * Chrome (board slots, recruit, speed, win/lose panel) lives in main.scene.
 * This class does not build that tree. Tokens, enemies and shots are runtime
 * actors because they come and go; the range ring stays on the scene Graphics.
 */
@ccclass('GameApp')
export class GameApp extends Component {
  @property(Node)
  boardLayer: Node | null = null;

  @property(Node)
  actorLayer: Node | null = null;

  @property(Node)
  hudLayer: Node | null = null;

  @property(Label)
  loadingLabel: Label | null = null;

  @property(Label)
  titleLabel: Label | null = null;

  @property(Label)
  waveLabel: Label | null = null;

  @property(Label)
  hpLabel: Label | null = null;

  @property(Sprite)
  hpFill: Sprite | null = null;

  @property(Label)
  mantouLabel: Label | null = null;

  @property(Label)
  hintLabel: Label | null = null;

  @property(Button)
  recruitButton: Button | null = null;

  @property(Label)
  recruitLabel: Label | null = null;

  @property(Sprite)
  recruitSprite: Sprite | null = null;

  @property(Label)
  speedLabel: Label | null = null;

  @property(Node)
  bannerNode: Node | null = null;

  @property(Label)
  bannerLabel: Label | null = null;

  @property(Node)
  overlay: Node | null = null;

  @property(Label)
  overlayTitle: Label | null = null;

  @property(Label)
  overlayBody: Label | null = null;

  @property(Node)
  tutorialNode: Node | null = null;

  @property(Label)
  tutorialLabel: Label | null = null;

  @property(Node)
  adouSeal: Node | null = null;

  @property(Node)
  rangeNode: Node | null = null;

  @property(Graphics)
  rangeGraphics: Graphics | null = null;

  @property(Font)
  titleFont: Font | null = null;

  @property(Font)
  bodyFont: Font | null = null;

  @property(SpriteFrame)
  btnCinnabar: SpriteFrame | null = null;

  @property(SpriteFrame)
  btnMuted: SpriteFrame | null = null;

  @property(SpriteFrame)
  enemyFrame: SpriteFrame | null = null;

  @property(SpriteFrame)
  shotFrame: SpriteFrame | null = null;

  @property([SpriteFrame])
  unitFrames: SpriteFrame[] = [];

  private canvas: Canvas | null = null;
  private config: GameConfig | null = null;
  private sim: GameSim | null = null;
  private slotMarks: SlotMark[] = [];
  private tokenViews = new Map<string, TokenView>();
  private enemyViews = new Map<string, EnemyView>();
  private shotViews = new Map<string, ShotView>();
  private bursts: BurstView[] = [];
  private poseFrames = new Map<string, SpriteFrame[]>();
  private swingFrames = new Map<string, SpriteFrame[]>();
  private arrowFrames = new Map<string, SpriteFrame>();
  private lastDt = 0;
  private floatViews = new Map<string, { node: Node; label: Label }>();

  private pointerDown = false;
  private dragId: string | null = null;
  private dragTouch = -1;
  private dragPos = { x: 0, y: 0 };
  private uiLockUntil = 0;
  private lastUiClaim = 0;
  private timeScale = 1;
  private clock = 0;
  private toast = '';
  private toastTimer = 0;
  private shownHp = -1;
  private recruitEnabled = true;
  private overlayPhase = 'playing';
  private guidePending = false;
  private hpFillWidth = 440;

  onLoad(): void {
    this.canvas = this.node.parent?.getComponent(Canvas) ?? null;
    this.zeroHitbox(this.boardLayer);
    this.zeroHitbox(this.actorLayer);
    this.zeroHitbox(this.hudLayer);
    const decor = this.node.getChildByName('Decor');
    this.zeroHitbox(decor);
    if (this.loadingLabel) {
      this.loadingLabel.node.active = true;
      this.loadingLabel.string = '研墨中…';
    }
    void this.boot();
  }

  update(dt: number): void {
    this.lastDt = dt;
    this.clock += dt;
    if (this.toastTimer > 0) {
      this.toastTimer = Math.max(0, this.toastTimer - dt);
    }
    if (!this.sim) {
      return;
    }
    if (this.sim.phase === 'playing') {
      let left = Math.min(dt, 0.05) * this.timeScale;
      const step = 1 / 60;
      while (left > 0 && this.sim.phase === 'playing') {
        const slice = Math.min(step, left);
        this.sim.tick(slice);
        left -= slice;
      }
    }
    this.syncAll();
  }

  public onRecruitClick(): void {
    if (!this.sim || this.sim.phase !== 'playing' || !this.claimUi()) {
      return;
    }
    const result = this.sim.recruit();
    if (!result.ok) {
      this.showToast(result.reason === 'broke' ? '馒头不够' : '席位已满');
    }
    this.syncTokens();
    this.syncHud();
  }

  public onSpeedClick(): void {
    if (!this.claimUi()) {
      return;
    }
    this.timeScale = this.timeScale === 1 ? 3 : 1;
    if (this.speedLabel) {
      this.speedLabel.string = this.timeScale === 1 ? '常速' : '三倍';
    }
  }

  public onRestartClick(): void {
    this.restart();
  }

  public onTutorialClick(): void {
    if (this.tutorialNode) {
      this.tutorialNode.active = false;
    }
  }

  private async boot(): Promise<void> {
    try {
      const config = await loadGameConfig();
      if (!this.isValid) {
        return;
      }
      this.begin(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      if (this.loadingLabel) {
        this.loadingLabel.node.active = true;
        this.loadingLabel.string = `配置没有读出来\n${message}`;
      }
      console.error('[InkGuard]', err);
    }
  }

  private begin(config: GameConfig): void {
    this.config = config;
    view.setDesignResolutionSize(config.board.designWidth, config.board.designHeight, ResolutionPolicy.FIXED_WIDTH);
    const camera = this.canvas?.cameraComponent;
    if (camera) {
      camera.clearColor = inkColor(Ink.paper);
    }
    if (this.loadingLabel) {
      this.loadingLabel.node.active = false;
    }
    if (this.titleLabel) {
      this.titleLabel.string = '墨卫';
    }
    if (this.tutorialLabel) {
      this.tutorialLabel.string = '开局有两枚「刀」。拖到一起就升品。\n金色合成，青色换位，绿色空位。';
    }
    this.layoutBoard(config);
    this.layoutHpFill();
    this.collectMarks();
    this.sim = new GameSim(config, Date.now() % 2147483647);
    this.guidePending = !this.guideSeen();
    if (this.guidePending) {
      this.grantGuide();
      if (this.tutorialNode) {
        this.tutorialNode.active = true;
      }
    } else if (this.tutorialNode) {
      this.tutorialNode.active = false;
    }
    void this.loadAttackArt(config);
    this.syncAll();
    console.log(`[InkGuard] ready, waves=${config.waves.waves.length}, adou=${config.adou.maxHp}`);
  }

  private loadFrame(base: string): Promise<SpriteFrame | null> {
    const once = (path: string) => new Promise<SpriteFrame | null>((resolve) => {
      resources.load(path, SpriteFrame, (err, asset) => {
        resolve(!err && asset ? asset : null);
      });
    });
    return once(`${base}/spriteFrame`).then((frame) => frame ?? once(base));
  }

  private async loadSequence(prefix: string, count: number): Promise<SpriteFrame[]> {
    const frames = await Promise.all(Array.from({ length: count }, (_, index) => this.loadFrame(`${prefix}-${index}`)));
    return frames.filter((frame): frame is SpriteFrame => frame !== null);
  }

  private async loadAttackArt(config: GameConfig): Promise<void> {
    await Promise.all(config.units.order.map(async (id) => {
      const poses = await this.loadSequence(`pose/${id}`, 4);
      const swings = await this.loadSequence(`fx/${id}`, 4);
      if (poses.length > 0) {
        this.poseFrames.set(id, poses);
      }
      if (swings.length > 0) {
        this.swingFrames.set(id, swings);
      }
      if (config.units.types[id].style === 'ranged') {
        const arrow = await this.loadFrame(`fx/${id}-arrow`);
        if (arrow) {
          this.arrowFrames.set(id, arrow);
        }
      }
    }));
  }

  private zeroHitbox(node: Node | null): void {
    if (!node) {
      return;
    }
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(0, 0);
    transform.setAnchorPoint(0.5, 0.5);
  }

  private layoutBoard(config: GameConfig): void {
    const board = this.boardLayer;
    if (!board) {
      return;
    }
    const count = config.board.gridCols * config.board.gridRows;
    for (let i = 0; i < count; i += 1) {
      const cell = board.getChildByName(`Cell${i}`);
      const pos = tokenPosition(config, { id: '', type: '', level: 1, place: 'grid', slot: i });
      cell?.setPosition(pos.x, pos.y, 0);
    }
    for (let i = 0; i < config.board.benchSlots; i += 1) {
      const slot = board.getChildByName(`Bench${i}`);
      const pos = tokenPosition(config, { id: '', type: '', level: 1, place: 'bench', slot: i });
      slot?.setPosition(pos.x, pos.y, 0);
    }
    const gate = config.board.path[config.board.path.length - 1];
    this.adouSeal?.setPosition(gate.x, gate.y, 0);
    if (this.rangeNode) {
      this.rangeNode.active = false;
    }
  }

  private layoutHpFill(): void {
    const fill = this.hpFill?.node;
    const parent = fill?.parent?.getComponent(UITransform);
    const ui = fill?.getComponent(UITransform);
    if (!fill || !parent || !ui) {
      return;
    }
    const width = Math.max(8, parent.contentSize.width - 8);
    this.hpFillWidth = width;
    ui.setAnchorPoint(0, 0.5);
    ui.setContentSize(width, Math.max(8, parent.contentSize.height - 6));
    fill.setPosition(-width / 2, 0, 0);
  }

  private collectMarks(): void {
    this.slotMarks = [];
    const board = this.boardLayer;
    const config = this.config;
    if (!board || !config) {
      return;
    }
    const gridCount = config.board.gridCols * config.board.gridRows;
    for (let i = 0; i < gridCount; i += 1) {
      this.takeMark('grid', i, board.getChildByName(`Cell${i}`));
    }
    for (let i = 0; i < config.board.benchSlots; i += 1) {
      this.takeMark('bench', i, board.getChildByName(`Bench${i}`));
    }
  }

  private takeMark(place: Place, slot: number, cell: Node | null): void {
    const node = cell?.getChildByName('Mark') ?? null;
    const sprite = node?.getComponent(Sprite) ?? null;
    if (!node || !sprite) {
      return;
    }
    node.active = false;
    // Mark has no pointer listener, so Creator's UI dispatcher never hit-tests it.
    // The ring cannot swallow the drag that the token already claimed.
    this.slotMarks.push({ place, slot, node, sprite });
  }

  private guideSeen(): boolean {
    try {
      return sys.localStorage.getItem(GUIDE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private grantGuide(): void {
    this.sim?.placeGuideToken('dao', 'bench', 0);
    this.sim?.placeGuideToken('dao', 'bench', 1);
  }

  private completeGuide(): void {
    this.guidePending = false;
    if (this.tutorialNode) {
      this.tutorialNode.active = false;
    }
    try {
      sys.localStorage.setItem(GUIDE_KEY, '1');
    } catch {
      /* this run still hides the card */
    }
  }

  private claimUi(): boolean {
    const now = Date.now();
    if (this.pointerDown || now < this.uiLockUntil || now - this.lastUiClaim < 140) {
      return false;
    }
    this.lastUiClaim = now;
    return true;
  }

  private beginDrag(id: string, event: PointerEvent): void {
    if (!this.sim || this.sim.phase !== 'playing' || this.pointerDown) {
      return;
    }
    const viewToken = this.tokenViews.get(id);
    const token = this.sim.tokens.find((entry) => entry.id === id);
    if (!viewToken || !token || !this.rangeNode || !this.rangeGraphics) {
      return;
    }
    this.pointerDown = true;
    this.dragId = id;
    this.dragTouch = this.pointerId(event);
    this.dragPos = this.readPointer(event);
    viewToken.root.setScale(1.08, 1.08, 1);
    viewToken.root.setSiblingIndex(999);
    viewToken.root.setPosition(this.dragPos.x, this.dragPos.y, 0);
    const stat = this.sim.statOf(token.type, token.level);
    paintRange(this.rangeGraphics, stat.range, this.sim.config.units.types[token.type].ink);
    this.rangeNode.active = true;
    this.rangeNode.setPosition(this.dragPos.x, this.dragPos.y, 0);
    this.updateMarks(id, this.dragPos.x, this.dragPos.y);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.pointerDown || !this.dragId) {
      return;
    }
    const id = this.pointerId(event);
    if (this.dragTouch !== -1 && id !== -1 && id !== this.dragTouch) {
      return;
    }
    this.dragPos = this.readPointer(event);
    const viewToken = this.tokenViews.get(this.dragId);
    if (viewToken) {
      viewToken.root.setPosition(this.dragPos.x, this.dragPos.y, 0);
    }
    this.rangeNode?.setPosition(this.dragPos.x, this.dragPos.y, 0);
    this.updateMarks(this.dragId, this.dragPos.x, this.dragPos.y);
  }

  private onPointerEnd(event: PointerEvent): void {
    if (!this.pointerDown || !this.dragId) {
      return;
    }
    const id = this.pointerId(event);
    if (this.dragTouch !== -1 && id !== -1 && id !== this.dragTouch) {
      return;
    }
    const tokenId = this.dragId;
    this.dragPos = this.readPointer(event);
    this.pointerDown = false;
    this.dragId = null;
    this.dragTouch = -1;
    this.uiLockUntil = Date.now() + 180;
    if (this.rangeNode) {
      this.rangeNode.active = false;
    }
    this.clearMarks();
    const viewToken = this.tokenViews.get(tokenId);
    if (viewToken) {
      viewToken.root.setScale(1, 1, 1);
    }
    const result = this.resolveDrop(tokenId, this.dragPos.x, this.dragPos.y);
    if (!result.ok) {
      this.showToast(result.reason === 'max-level' ? '已是最高品' : '这里放不下');
    }
    this.syncTokens();
  }

  private updateMarks(tokenId: string, x: number, y: number): void {
    if (!this.sim) {
      return;
    }
    let nearest: SlotMark | null = null;
    let nearestD = 78;
    for (const mark of this.slotMarks) {
      const kind = this.sim.previewDrop(tokenId, mark.place, mark.slot);
      const show = kind === 'move' || kind === 'merge' || kind === 'swap';
      mark.node.active = show;
      if (!show) {
        continue;
      }
      mark.sprite.color = inkColor(MARK_COLOR[kind]);
      mark.node.setScale(1, 1, 1);
      const parent = mark.node.parent;
      if (!parent) {
        continue;
      }
      const distance = Math.hypot(parent.position.x - x, parent.position.y - y);
      if (distance < nearestD) {
        nearestD = distance;
        nearest = mark;
      }
    }
    nearest?.node.setScale(1.12, 1.12, 1);
  }

  private clearMarks(): void {
    for (const mark of this.slotMarks) {
      mark.node.active = false;
      mark.node.setScale(1, 1, 1);
    }
  }

  private resolveDrop(id: string, x: number, y: number): DropResult {
    if (!this.sim || !this.config) {
      return { ok: true, action: 'stay' };
    }
    // Slots own their cells. drop() merges or swaps when the chosen slot is taken,
    // so the pointer only has to land inside the slot, not on the other token.
    const slot = dropSlotAt(this.config.board, x, y);
    if (!slot) {
      return { ok: true, action: 'stay' };
    }
    return this.sim.drop(id, slot.place, slot.slot);
  }

  private pointerId(event: PointerEvent): number {
    if (typeof event.getID !== 'function') {
      return -1;
    }
    const id = event.getID();
    return typeof id === 'number' ? id : -1;
  }

  private readPointer(event: PointerEvent): { x: number; y: number } {
    const camera = this.canvas?.cameraComponent;
    const transform = this.node.getComponent(UITransform);
    if (!camera || !transform) {
      return { x: 0, y: 0 };
    }
    const screen = event.getLocation();
    const world = new Vec3();
    camera.screenToWorld(new Vec3(screen.x, screen.y, 0), world);
    const local = new Vec3();
    transform.convertToNodeSpaceAR(world, local);
    return { x: local.x, y: local.y };
  }

  private syncAll(): void {
    this.syncTokens();
    this.syncEnemies();
    this.syncShots();
    this.syncFloats();
    this.syncHud();
  }

  private syncTokens(): void {
    if (!this.sim || !this.config || !this.actorLayer) {
      return;
    }
    const alive = new Set(this.sim.tokens.map((token) => token.id));
    for (const [id, viewToken] of this.tokenViews) {
      if (!alive.has(id)) {
        viewToken.root.destroy();
        this.tokenViews.delete(id);
      }
    }
    for (const token of this.sim.tokens) {
      let viewToken = this.tokenViews.get(token.id);
      if (!viewToken) {
        viewToken = this.createToken(token);
        this.tokenViews.set(token.id, viewToken);
      }
      if (viewToken.shownLevel !== token.level) {
        viewToken.shownLevel = token.level;
        viewToken.rank.string = `${RANK[token.level] ?? token.level}品`;
      }
      this.advancePose(viewToken);
      if (this.dragId !== token.id) {
        const pos = tokenPosition(this.config, token);
        viewToken.root.setPosition(pos.x, pos.y, 0);
        viewToken.root.setScale(1, 1, 1);
      }
    }
  }

  private createToken(token: Token): TokenView {
    const type = this.config!.units.types[token.type];
    const root = this.actorNode(`Token-${token.id}`, 108, 108);
    this.actorLayer!.addChild(root);
    const sprite = root.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = Sprite.Type.SIMPLE;
    const frame = this.frameFor(token.type);
    if (frame) {
      sprite.spriteFrame = frame;
    }
    const ui = root.getComponent(UITransform);
    ui?.setContentSize(108, 108);
    if (!frame) {
      this.addText(root, type.glyph, 48, inkColor(type.ink), this.titleFont, 96, 72).node.setPosition(0, 8, 0);
    }
    const rank = this.addText(root, `${RANK[token.level] ?? token.level}品`, 18, inkColor(Ink.brown), this.bodyFont, 88, 28);
    rank.node.setPosition(0, -46, 0);
    const style = this.addText(
      root,
      `${type.styleLabel}·${type.motionLabel}`,
      14,
      inkColor(type.ink),
      this.bodyFont,
      120,
      22,
    );
    style.node.setPosition(0, 40, 0);
    // Creator 3.8 turns a mouse press into a touch and the node that receives
    // TOUCH_START claims that id. Later move/up events are delivered here and
    // swallowed before global input listeners, including when the cursor has
    // left this rect (the engine then renames the end to TOUCH_CANCEL).
    // Listening on the node is what lets a mouse release land on a Cell.
    const onStart = (event: EventTouch) => this.beginDrag(token.id, event);
    const onMove = (event: EventTouch) => this.onPointerMove(event);
    const onEnd = (event: EventTouch) => this.onPointerEnd(event);
    root.on(Node.EventType.TOUCH_START, onStart, this);
    root.on(Node.EventType.TOUCH_MOVE, onMove, this);
    root.on(Node.EventType.TOUCH_END, onEnd, this);
    root.on(Node.EventType.TOUCH_CANCEL, onEnd, this);
    return {
      id: token.id,
      typeId: token.type,
      root,
      body: sprite,
      rank,
      idle: frame,
      poseFrames: [],
      poseTime: -1,
      poseDuration: 0.34,
      shownLevel: token.level,
    };
  }

  private advancePose(viewToken: TokenView): void {
    if (viewToken.poseTime < 0) {
      return;
    }
    const frames = this.poseFrames.get(viewToken.typeId) ?? viewToken.poseFrames;
    viewToken.poseFrames = frames;
    viewToken.poseTime += this.lastDt;
    if (frames.length === 0 || viewToken.poseTime >= viewToken.poseDuration) {
      viewToken.poseTime = -1;
      if (viewToken.idle) {
        viewToken.body.spriteFrame = viewToken.idle;
      }
      return;
    }
    const index = Math.min(frames.length - 1, Math.floor((viewToken.poseTime / viewToken.poseDuration) * frames.length));
    viewToken.body.spriteFrame = frames[index];
  }

  private startPose(tokenId: string, typeId: string): void {
    const viewToken = this.tokenViews.get(tokenId);
    const frames = this.poseFrames.get(typeId);
    if (!viewToken || !frames || frames.length === 0) {
      return;
    }
    viewToken.poseFrames = frames;
    viewToken.poseTime = 0;
    viewToken.poseDuration = 0.34;
    viewToken.body.spriteFrame = frames[0];
  }

  private frameFor(type: string): SpriteFrame | null {
    const index = UNIT_ORDER.indexOf(type as (typeof UNIT_ORDER)[number]);
    if (index < 0) {
      return null;
    }
    return this.unitFrames[index] ?? null;
  }

  private syncEnemies(): void {
    if (!this.sim || !this.actorLayer) {
      return;
    }
    const alive = new Set(this.sim.enemies.map((enemy) => enemy.id));
    for (const [id, viewEnemy] of this.enemyViews) {
      if (!alive.has(id)) {
        viewEnemy.root.destroy();
        this.enemyViews.delete(id);
      }
    }
    this.sim.enemies.forEach((enemy, index) => {
      let viewEnemy = this.enemyViews.get(enemy.id);
      if (!viewEnemy) {
        const root = this.actorNode(`Enemy-${enemy.id}`, 64, 64);
        this.actorLayer!.addChild(root);
        const sprite = root.addComponent(Sprite);
        sprite.sizeMode = Sprite.SizeMode.CUSTOM;
        sprite.spriteFrame = this.enemyFrame;
        const ui = root.getComponent(UITransform);
        ui?.setContentSize(64, 64);
        this.addText(root, '寇', 22, inkColor('#f7f1e4'), this.titleFont, 48, 32).node.setPosition(0, 6, 0);
        const hp = this.addText(root, '', 16, inkColor('#f4efe4'), this.bodyFont, 56, 22);
        hp.node.setPosition(0, -36, 0);
        viewEnemy = { root, hp, shownHp: -1 };
        this.enemyViews.set(enemy.id, viewEnemy);
      }
      const bob = Math.sin(this.clock * 3 + index) * 2;
      viewEnemy.root.setPosition(enemy.x, enemy.y + bob, 0);
      const hp = Math.max(0, Math.ceil(enemy.hp));
      if (viewEnemy.shownHp !== hp) {
        viewEnemy.shownHp = hp;
        viewEnemy.hp.string = `${hp}`;
      }
    });
  }

  private syncShots(): void {
    if (!this.sim || !this.actorLayer) {
      return;
    }
    const alive = new Set(this.sim.shots.map((shot) => shot.id));
    for (const [id, view] of this.shotViews) {
      if (!alive.has(id)) {
        if (view.style === 'ranged') {
          this.spawnBurst(view.typeId, view.node.position.x, view.node.position.y);
        }
        view.node.destroy();
        this.shotViews.delete(id);
      }
    }
    for (const shot of this.sim.shots) {
      let view = this.shotViews.get(shot.id);
      if (!view) {
        view = this.createShotView(shot);
        this.shotViews.set(shot.id, view);
        this.startPose(shot.sourceId, shot.typeId);
      }
      view.node.setPosition(shot.x, shot.y, 0);
      const dx = shot.x - shot.fromX;
      const dy = shot.y - shot.fromY;
      if (Math.hypot(dx, dy) > 4) {
        view.node.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      }
      const frames = view.frames;
      if (shot.style === 'melee' && frames.length > 0) {
        const t = Math.min(1, shot.age / Math.max(0.001, shot.strike));
        const index = Math.min(frames.length - 1, Math.floor(t * frames.length));
        view.sprite.spriteFrame = frames[index];
        const scale = 0.75 + t * 0.45;
        view.node.setScale(scale, scale, 1);
      }
    }
    this.advanceBursts();
  }

  private createShotView(shot: { id: string; style: string; typeId: string; ink: string }): ShotView {
    const ranged = shot.style === 'ranged';
    const node = this.actorNode(`Shot-${shot.id}`, ranged ? 72 : 150, ranged ? 36 : 150);
    this.actorLayer!.addChild(node);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const arrow = this.arrowFrames.get(shot.typeId) ?? null;
    const frames = this.swingFrames.get(shot.typeId) ?? [];
    if (ranged && arrow) {
      sprite.spriteFrame = arrow;
    } else if (frames.length > 0) {
      sprite.spriteFrame = frames[0];
    } else if (this.shotFrame) {
      sprite.spriteFrame = this.shotFrame;
      sprite.color = inkColor(shot.ink);
    }
    const ui = node.getComponent(UITransform);
    ui?.setContentSize(ranged ? 72 : 150, ranged ? 36 : 150);
    return { node, sprite, style: shot.style, typeId: shot.typeId, frames };
  }

  private spawnBurst(typeId: string, x: number, y: number): void {
    const frames = this.swingFrames.get(typeId) ?? [];
    if (!this.actorLayer || frames.length === 0) {
      return;
    }
    const node = this.actorNode(`Hit-${typeId}`, 120, 120);
    this.actorLayer.addChild(node);
    node.setPosition(x, y, 0);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.spriteFrame = frames[0];
    const ui = node.getComponent(UITransform);
    ui?.setContentSize(120, 120);
    this.bursts.push({ node, sprite, frames, age: 0, life: 0.32 });
  }

  private advanceBursts(): void {
    const kept: BurstView[] = [];
    for (const burst of this.bursts) {
      burst.age += this.lastDt;
      if (burst.age >= burst.life) {
        burst.node.destroy();
        continue;
      }
      const index = Math.min(burst.frames.length - 1, Math.floor((burst.age / burst.life) * burst.frames.length));
      burst.sprite.spriteFrame = burst.frames[index];
      const fade = 1 - burst.age / burst.life;
      burst.node.setScale(0.8 + burst.age * 1.4, 0.8 + burst.age * 1.4, 1);
      const opacity = burst.node.getComponent(UIOpacity) ?? burst.node.addComponent(UIOpacity);
      opacity.opacity = Math.max(0, Math.floor(255 * fade));
      kept.push(burst);
    }
    this.bursts = kept;
  }

  private syncFloats(): void {
    if (!this.sim || !this.hudLayer) {
      return;
    }
    const alive = new Set(this.sim.floats.map((floater) => floater.id));
    for (const [id, viewFloat] of this.floatViews) {
      if (!alive.has(id)) {
        viewFloat.node.destroy();
        this.floatViews.delete(id);
      }
    }
    for (const floater of this.sim.floats) {
      let viewFloat = this.floatViews.get(floater.id);
      if (!viewFloat) {
        const node = this.actorNode(`Float-${floater.id}`, 80, 32);
        this.hudLayer.addChild(node);
        const label = this.addText(node, floater.text, 20, inkColor(Ink.cinnabar), this.bodyFont, 80, 32);
        node.addComponent(UIOpacity);
        viewFloat = { node, label };
        this.floatViews.set(floater.id, viewFloat);
      }
      viewFloat.node.setPosition(floater.x, floater.y + floater.age * 46, 0);
      const opacity = viewFloat.node.getComponent(UIOpacity);
      if (opacity) {
        opacity.opacity = Math.max(0, Math.floor(255 * (1 - floater.age / 0.7)));
      }
    }
  }

  private syncHud(): void {
    if (!this.sim || !this.config) {
      return;
    }
    if (this.guidePending && this.sim.mergeCount > 0) {
      this.completeGuide();
    }
    const hp = Math.max(0, Math.round(this.sim.adouHp));
    const maxHp = this.config.adou.maxHp;
    if (this.hpLabel) {
      this.hpLabel.string = `阿斗 ${hp}/${maxHp}`;
    }
    if (this.hpFill && hp !== this.shownHp) {
      this.shownHp = hp;
      const ui = this.hpFill.node.getComponent(UITransform);
      const ratio = maxHp <= 0 ? 0 : hp / maxHp;
      if (ui) {
        ui.setContentSize(Math.max(0, this.hpFillWidth * ratio), ui.contentSize.height);
      }
    }
    if (this.mantouLabel) {
      const income = this.config.economy.incomePerSecond;
      this.mantouLabel.string = `馒头 ${Math.floor(this.sim.mantou)}   +${income}/秒`;
    }
    if (this.waveLabel) {
      const head = `第 ${this.sim.waveNumber} / ${this.sim.waveTotal} 波`;
      if (this.sim.phase !== 'playing') {
        this.waveLabel.string = head;
      } else if (this.sim.betweenWaves) {
        this.waveLabel.string = `${head} · 备墨 ${Math.ceil(this.sim.betweenTimer)}s`;
      } else {
        this.waveLabel.string = `${head} · 来敌 ${this.sim.enemies.length}`;
      }
    }
    const cost = this.sim.nextCost();
    const canRecruit = this.sim.phase === 'playing' && this.sim.mantou >= cost && this.sim.hasBenchRoom();
    if (this.recruitLabel) {
      this.recruitLabel.string = `招募 ${cost}`;
    }
    if (this.recruitSprite && canRecruit !== this.recruitEnabled) {
      this.recruitEnabled = canRecruit;
      const frame = canRecruit ? this.btnCinnabar : this.btnMuted;
      if (frame) {
        this.recruitSprite.spriteFrame = frame;
      }
    }
    if (this.hintLabel) {
      const idle = this.guidePending ? GUIDE_HINT : HINT;
      this.hintLabel.string = this.toastTimer > 0 ? this.toast : idle;
      this.hintLabel.color = this.toastTimer > 0 ? inkColor(Ink.cinnabar) : inkColor(Ink.brown);
    }
    if (this.bannerNode && this.bannerLabel) {
      const show = this.sim.phase === 'playing' && this.sim.bannerTimer > 0;
      this.bannerNode.active = show;
      if (show) {
        this.bannerLabel.string = this.sim.banner;
      }
    }
    if (this.overlay) {
      const ended = this.sim.phase !== 'playing';
      this.overlay.active = ended;
      if (ended && this.overlayPhase !== this.sim.phase && this.overlayTitle && this.overlayBody) {
        this.overlayPhase = this.sim.phase;
        if (this.sim.phase === 'win') {
          this.overlayTitle.string = '墨阵已稳';
          this.overlayBody.string = `守住了全部 ${this.sim.waveTotal} 波，阿斗还剩 ${hp} 点气血。`;
        } else {
          this.overlayTitle.string = '墨阵破了';
          this.overlayBody.string = '阿斗气血见底。重整旗鼓，再守一阵。';
        }
      }
    }
  }

  private showToast(message: string): void {
    this.toast = message;
    this.toastTimer = 1.8;
  }

  private restart(): void {
    if (!this.sim || !this.claimUi()) {
      return;
    }
    this.pointerDown = false;
    this.dragId = null;
    this.dragTouch = -1;
    if (this.rangeNode) {
      this.rangeNode.active = false;
    }
    this.clearMarks();
    this.timeScale = 1;
    if (this.speedLabel) {
      this.speedLabel.string = '常速';
    }
    this.toastTimer = 0;
    this.overlayPhase = 'playing';
    this.shownHp = -1;
    this.recruitEnabled = true;
    this.sim.reset(Date.now() % 2147483647);
    this.clearDynamics();
    if (this.guidePending) {
      this.grantGuide();
      if (this.tutorialNode) {
        this.tutorialNode.active = true;
      }
    }
    if (this.overlay) {
      this.overlay.active = false;
    }
    this.syncAll();
  }

  private clearDynamics(): void {
    for (const viewToken of this.tokenViews.values()) {
      viewToken.root.destroy();
    }
    for (const viewEnemy of this.enemyViews.values()) {
      viewEnemy.root.destroy();
    }
    for (const view of this.shotViews.values()) {
      view.node.destroy();
    }
    for (const burst of this.bursts) {
      burst.node.destroy();
    }
    for (const viewFloat of this.floatViews.values()) {
      viewFloat.node.destroy();
    }
    this.tokenViews.clear();
    this.enemyViews.clear();
    this.shotViews.clear();
    this.bursts = [];
    this.floatViews.clear();
  }

  private actorNode(name: string, width: number, height: number): Node {
    const node = new Node(name);
    node.layer = this.node.layer;
    const transform = node.addComponent(UITransform);
    transform.setContentSize(width, height);
    transform.setAnchorPoint(0.5, 0.5);
    return node;
  }

  private addText(parent: Node, text: string, size: number, color: Color, font: Font | null, width: number, height: number): Label {
    const node = this.actorNode('Text', width, height);
    parent.addChild(node);
    const label = node.addComponent(Label);
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 6;
    label.horizontalAlign = HorizontalTextAlignment.CENTER;
    label.verticalAlign = VerticalTextAlignment.CENTER;
    label.overflow = Overflow.SHRINK;
    label.color = color;
    if (font) {
      label.font = font;
      label.useSystemFont = false;
    } else {
      label.useSystemFont = true;
      label.fontFamily = 'sans-serif';
    }
    return label;
  }
}
