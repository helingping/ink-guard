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
import { dropSlotAt, pathMarksWithin, slotsWithin } from './logic/geometry';
import { GameSim, tokenPosition, type DropResult, type Place, type Shot, type Token } from './logic/GameSim';
import { Ink, RANK, inkColor, paintRanges, type RangeDot, type RangeRing } from './view/InkWidgets';

const { ccclass, property } = _decorator;

interface PoseBody {
  poseKey: string;
  body: Sprite;
  idle: SpriteFrame | null;
  poseFrames: SpriteFrame[];
  poseTime: number;
  poseDuration: number;
}

interface TokenView extends PoseBody {
  id: string;
  root: Node;
  rank: Label;
  shownLevel: number;
}

interface ShotView {
  node: Node;
  sprite: Sprite;
  style: string;
  vfx: string;
  frames: SpriteFrame[];
}

interface BurstView {
  node: Node;
  sprite: Sprite;
  frames: SpriteFrame[];
  age: number;
  life: number;
}

interface EnemyView extends PoseBody {
  root: Node;
  hp: Label;
  glyph: Label;
  shownHp: number;
}

interface ActorRef {
  kind: 'token' | 'foe';
  id: string;
}

interface RangeFocus {
  key: string;
  x: number;
  y: number;
  range: number;
  ink: string;
  caption: string;
  shotAge: number;
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

const HINT = '招募字令，拖上阵。点选或悬停可看射程。相同字令叠成品，不同字令可换位。';
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
 * actors because they come and go. The range ring stays on the scene Graphics
 * and is redrawn for the hovered, selected, or attacking unit.
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
  private foeIdles = new Map<string, SpriteFrame>();
  private swingFrames = new Map<string, SpriteFrame[]>();
  private arrowFrames = new Map<string, SpriteFrame>();
  private hover: ActorRef | null = null;
  private selected: ActorRef | null = null;
  private rangeCaption: Label | null = null;
  /** Keeps a unit's range readable after a short melee strike. Values are clock expiry. */
  private rangePing = new Map<string, number>();
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
    this.ensureRangeCaption();
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
    await Promise.all(config.foes.order.map(async (id) => {
      const poses = await this.loadSequence(`pose/${id}`, 4);
      if (poses.length > 0) {
        this.poseFrames.set(id, poses);
      }
      const idle = await this.loadFrame(`foes/${id}`);
      if (idle) {
        this.foeIdles.set(id, idle);
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
      const pos = tokenPosition(config, { place: 'grid', slot: i });
      cell?.setPosition(pos.x, pos.y, 0);
    }
    for (let i = 0; i < config.board.benchSlots; i += 1) {
      const slot = board.getChildByName(`Bench${i}`);
      const pos = tokenPosition(config, { place: 'bench', slot: i });
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
    this.syncRange();
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
    this.syncRange();
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
    this.selected = { kind: 'token', id: tokenId };
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
    this.syncRange();
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
    this.syncRange();
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
      const idle = this.frameFor(token.type);
      if (viewToken.poseTime < 0 && idle && viewToken.idle !== idle) {
        viewToken.idle = idle;
        viewToken.body.spriteFrame = idle;
      }
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
    const onEnter = () => {
      this.hover = { kind: 'token', id: token.id };
    };
    const onLeave = () => {
      if (this.hover?.kind === 'token' && this.hover.id === token.id) {
        this.hover = null;
      }
    };
    root.on(Node.EventType.MOUSE_ENTER, onEnter, this);
    root.on(Node.EventType.MOUSE_LEAVE, onLeave, this);
    return {
      id: token.id,
      poseKey: token.type,
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

  private advancePose(view: PoseBody): void {
    if (view.poseTime < 0) {
      return;
    }
    const frames = this.poseFrames.get(view.poseKey) ?? view.poseFrames;
    view.poseFrames = frames;
    view.poseTime += this.lastDt;
    if (frames.length === 0 || view.poseTime >= view.poseDuration) {
      view.poseTime = -1;
      if (view.idle) {
        view.body.spriteFrame = view.idle;
      }
      return;
    }
    const index = Math.min(frames.length - 1, Math.floor((view.poseTime / view.poseDuration) * frames.length));
    view.body.spriteFrame = frames[index];
  }

  private startPose(sourceId: string): void {
    const token = this.tokenViews.get(sourceId);
    if (token) {
      this.playPose(token);
      return;
    }
    const enemy = this.enemyViews.get(sourceId);
    if (enemy) {
      this.playPose(enemy);
    }
  }

  private playPose(view: PoseBody): void {
    const frames = this.poseFrames.get(view.poseKey);
    if (!frames || frames.length === 0) {
      return;
    }
    view.poseFrames = frames;
    view.poseTime = 0;
    view.poseDuration = 0.34;
    view.body.spriteFrame = frames[0];
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
        viewEnemy = this.createEnemy(enemy.id, enemy.kind);
        this.enemyViews.set(enemy.id, viewEnemy);
      }
      const idle = this.foeIdles.get(enemy.kind) ?? null;
      if (viewEnemy.poseTime < 0 && idle && viewEnemy.idle !== idle) {
        viewEnemy.idle = idle;
        viewEnemy.body.spriteFrame = idle;
        viewEnemy.glyph.node.active = false;
      }
      this.advancePose(viewEnemy);
      const bob = Math.sin(this.clock * 3 + index) * 2;
      viewEnemy.root.setPosition(enemy.x, enemy.y + bob, 0);
      const hp = Math.max(0, Math.ceil(enemy.hp));
      if (viewEnemy.shownHp !== hp) {
        viewEnemy.shownHp = hp;
        viewEnemy.hp.string = `${hp}`;
      }
    });
  }

  private createEnemy(id: string, kind: string): EnemyView {
    const foe = this.config?.foes.types[kind];
    const root = this.actorNode(`Enemy-${id}`, 84, 84);
    this.actorLayer!.addChild(root);
    const sprite = root.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.type = Sprite.Type.SIMPLE;
    const idle = this.foeIdles.get(kind) ?? null;
    if (idle) {
      sprite.spriteFrame = idle;
    } else if (this.enemyFrame) {
      sprite.spriteFrame = this.enemyFrame;
    }
    root.getComponent(UITransform)?.setContentSize(84, 84);
    const glyph = this.addText(root, foe?.glyph ?? '寇', 40, inkColor(foe?.ink ?? Ink.ink), this.titleFont, 76, 56);
    glyph.node.setPosition(0, 2, 0);
    glyph.node.active = !idle;
    const style = this.addText(root, foe?.styleLabel ?? '', 14, inkColor(foe?.ink ?? Ink.ink), this.bodyFont, 72, 20);
    style.node.setPosition(0, -52, 0);
    const hp = this.addText(root, '', 16, inkColor('#f4efe4'), this.bodyFont, 72, 22);
    hp.node.setPosition(0, -72, 0);
    const onEnter = () => {
      this.hover = { kind: 'foe', id };
    };
    const onLeave = () => {
      if (this.hover?.kind === 'foe' && this.hover.id === id) {
        this.hover = null;
      }
    };
    root.on(Node.EventType.MOUSE_ENTER, onEnter, this);
    root.on(Node.EventType.MOUSE_LEAVE, onLeave, this);
    return {
      poseKey: kind,
      root,
      body: sprite,
      hp,
      glyph,
      shownHp: -1,
      idle,
      poseFrames: [],
      poseTime: -1,
      poseDuration: 0.34,
    };
  }

  private syncShots(): void {
    if (!this.sim || !this.actorLayer) {
      return;
    }
    const alive = new Set(this.sim.shots.map((shot) => shot.id));
    for (const [id, view] of this.shotViews) {
      if (!alive.has(id)) {
        if (view.style === 'ranged') {
          this.spawnBurst(view.vfx, view.node.position.x, view.node.position.y);
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
        this.startPose(shot.sourceId);
        this.rangePing.set(shot.side === 'foe' ? `foe:${shot.sourceId}` : `token:${shot.sourceId}`, this.clock + 0.85);
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

  private createShotView(shot: Shot): ShotView {
    const ranged = shot.style === 'ranged';
    const node = this.actorNode(`Shot-${shot.id}`, ranged ? 72 : 150, ranged ? 36 : 150);
    this.actorLayer!.addChild(node);
    const sprite = node.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    const arrow = this.arrowFrames.get(shot.vfx) ?? null;
    const frames = this.swingFrames.get(shot.vfx) ?? [];
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
    return { node, sprite, style: shot.style, vfx: shot.vfx, frames };
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
    this.hover = null;
    this.selected = null;
    this.rangePing.clear();
    if (this.rangeNode) {
      this.rangeNode.active = false;
    }
    if (this.rangeCaption) {
      this.rangeCaption.node.active = false;
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

  private syncRange(): void {
    if (!this.sim || !this.config || !this.rangeNode || !this.rangeGraphics) {
      return;
    }
    const strong = this.strongFocus() ?? this.latestAttack();
    const attackers = this.attackFocuses();
    const rings: RangeRing[] = [];
    const dots: RangeDot[] = [];
    const seen = new Set<string>();
    const push = (focus: RangeFocus, emphasized: boolean) => {
      if (seen.has(focus.key)) {
        return;
      }
      seen.add(focus.key);
      rings.push({
        x: focus.x,
        y: focus.y,
        radius: focus.range,
        hex: focus.ink,
        fillAlpha: emphasized ? 36 : 16,
        strokeAlpha: emphasized ? 160 : 88,
        lineWidth: emphasized ? 3 : 1.5,
      });
      if (!emphasized) {
        return;
      }
      for (const point of pathMarksWithin(this.config!.board.path, focus.x, focus.y, focus.range)) {
        dots.push({ x: point.x, y: point.y, hex: focus.ink });
      }
    };
    const emphasized = strong;
    if (strong) {
      push(strong, true);
    }
    for (const focus of attackers) {
      push(focus, false);
    }
    paintRanges(this.rangeGraphics, rings, dots);
    this.rangeNode.setPosition(0, 0, 0);
    this.rangeNode.active = rings.length > 0;
    this.placeRangeCaption(emphasized);
    if (!this.pointerDown) {
      this.paintRangeCells(emphasized);
    }
  }

  private strongFocus(): RangeFocus | null {
    if (this.pointerDown && this.dragId) {
      return this.focusFor({ kind: 'token', id: this.dragId }, this.dragPos.x, this.dragPos.y, 0);
    }
    if (this.hover && this.refAlive(this.hover)) {
      return this.focusFor(this.hover, null, null, 0);
    }
    if (this.selected && this.refAlive(this.selected)) {
      return this.focusFor(this.selected, null, null, 0);
    }
    return null;
  }

  private attackFocuses(): RangeFocus[] {
    if (!this.sim) {
      return [];
    }
    const refs = new Map<string, ActorRef>();
    for (const shot of this.sim.shots) {
      const ref: ActorRef = shot.side === 'foe'
        ? { kind: 'foe', id: shot.sourceId }
        : { kind: 'token', id: shot.sourceId };
      refs.set(`${ref.kind}:${ref.id}`, ref);
    }
    for (const [key, until] of this.rangePing) {
      if (until < this.clock) {
        this.rangePing.delete(key);
        continue;
      }
      if (refs.has(key)) {
        continue;
      }
      const sep = key.indexOf(':');
      const kind = key.slice(0, sep);
      if (kind !== 'token' && kind !== 'foe') {
        continue;
      }
      refs.set(key, { kind, id: key.slice(sep + 1) });
    }
    const focuses: RangeFocus[] = [];
    for (const ref of refs.values()) {
      const focus = this.focusFor(ref, null, null, 0);
      if (focus) {
        focuses.push(focus);
      }
    }
    return focuses;
  }

  /** The attacker whose range should stay up when nothing is selected. */
  private latestAttack(): RangeFocus | null {
    let bestKey = '';
    let bestUntil = -1;
    for (const [key, until] of this.rangePing) {
      if (until >= this.clock && until > bestUntil) {
        bestUntil = until;
        bestKey = key;
      }
    }
    if (!bestKey) {
      return null;
    }
    const sep = bestKey.indexOf(':');
    const kind = bestKey.slice(0, sep);
    if (kind !== 'token' && kind !== 'foe') {
      return null;
    }
    return this.focusFor({ kind, id: bestKey.slice(sep + 1) }, null, null, 0);
  }

  private focusFor(ref: ActorRef, x: number | null, y: number | null, shotAge: number): RangeFocus | null {
    if (!this.sim || !this.config) {
      return null;
    }
    if (ref.kind === 'token') {
      const token = this.sim.tokens.find((entry) => entry.id === ref.id && entry.hp > 0);
      if (!token) {
        return null;
      }
      const pos = x !== null && y !== null ? { x, y } : tokenPosition(this.config, token);
      const stat = this.sim.statOf(token.type, token.level);
      const type = this.config.units.types[token.type];
      const rank = RANK[token.level] ?? `${token.level}`;
      return {
        key: `token:${token.id}`,
        x: pos.x,
        y: pos.y,
        range: stat.range,
        ink: type.ink,
        caption: `${type.glyph} ${rank}品 ${type.styleLabel} 射程 ${stat.range}`,
        shotAge,
      };
    }
    const enemy = this.sim.enemies.find((entry) => entry.id === ref.id && entry.hp > 0);
    if (!enemy) {
      return null;
    }
    const foe = this.config.foes.types[enemy.kind];
    if (!foe) {
      return null;
    }
    return {
      key: `foe:${enemy.id}`,
      x: x ?? enemy.x,
      y: y ?? enemy.y,
      range: foe.range,
      ink: foe.ink,
      caption: `${foe.glyph} ${foe.styleLabel} 射程 ${foe.range}`,
      shotAge,
    };
  }

  private refAlive(ref: ActorRef): boolean {
    if (!this.sim) {
      return false;
    }
    if (ref.kind === 'token') {
      return this.sim.tokens.some((entry) => entry.id === ref.id && entry.hp > 0);
    }
    return this.sim.enemies.some((entry) => entry.id === ref.id && entry.hp > 0);
  }

  private paintRangeCells(focus: RangeFocus | null): void {
    if (!this.config) {
      return;
    }
    const slots = new Set(
      focus ? slotsWithin(this.config.board, focus.x, focus.y, focus.range) : [],
    );
    for (const mark of this.slotMarks) {
      if (mark.place !== 'grid') {
        mark.node.active = false;
        mark.node.setScale(1, 1, 1);
        continue;
      }
      const on = slots.has(mark.slot);
      mark.node.active = on;
      if (on && focus) {
        mark.sprite.color = inkColor(focus.ink, 230);
        mark.node.setScale(1.06, 1.06, 1);
      } else {
        mark.node.setScale(1, 1, 1);
      }
    }
  }

  private ensureRangeCaption(): void {
    if (this.rangeCaption || !this.rangeNode) {
      return;
    }
    this.rangeCaption = this.addText(this.rangeNode, '', 18, inkColor(Ink.ink), this.bodyFont, 320, 28);
    this.rangeCaption.node.active = false;
  }

  private placeRangeCaption(focus: RangeFocus | null): void {
    this.ensureRangeCaption();
    if (!this.rangeCaption) {
      return;
    }
    if (!focus) {
      this.rangeCaption.node.active = false;
      return;
    }
    this.rangeCaption.node.active = true;
    this.rangeCaption.string = focus.caption;
    this.rangeCaption.color = inkColor(focus.ink);
    this.rangeCaption.node.setPosition(focus.x, focus.y + 74, 0);
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
