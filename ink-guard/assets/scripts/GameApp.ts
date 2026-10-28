import {
  _decorator,
  Canvas,
  Component,
  EventMouse,
  EventTouch,
  Graphics,
  Input,
  input,
  Label,
  Node,
  ResolutionPolicy,
  UIOpacity,
  UITransform,
  Vec3,
  view,
} from 'cc';
import { loadGameConfig } from './config/ConfigService';
import type { GameConfig } from './config/ConfigTypes';
import { nearestIndex } from './logic/geometry';
import { GameSim, tokenPosition, type DropResult, type Token } from './logic/GameSim';
import {
  Ink,
  RANK,
  addLabel,
  inkColor,
  inkNode,
  paintBackground,
  paintBar,
  paintButton,
  paintCell,
  paintEnemy,
  paintRange,
  paintSeal,
  paintShot,
} from './view/InkWidgets';

const { ccclass } = _decorator;

interface TokenView {
  id: string;
  root: Node;
  glyph: Label;
  rank: Label;
  graphics: Graphics;
  shownLevel: number;
}

interface EnemyView {
  root: Node;
  hp: Label;
  shownHp: number;
}

interface PointerEvent {
  getLocation(): { x: number; y: number };
  getID?: () => number;
}

const HINT = '招募字令，拖上阵。相同字令且同品，叠在一起升一品。';

/**
 * Runtime board for the ink-guard MVP.
 * The serialized scene only holds Canvas / Camera / GameRoot; widgets are built
 * here so Creator 3.8 can press Play without a hand-authored node per cell.
 *
 * Hit testing: Board and Actors use a 0-size transform so they do not swallow
 * clicks. Interactive children (tokens, buttons) keep their own sizes. Overlay
 * is last and inactive until the round ends.
 */
@ccclass('GameApp')
export class GameApp extends Component {
  private canvas: Canvas | null = null;
  private config: GameConfig | null = null;
  private sim: GameSim | null = null;
  private boardLayer: Node | null = null;
  private actorLayer: Node | null = null;
  private hudLayer: Node | null = null;
  private loading: Label | null = null;

  private titleLabel: Label | null = null;
  private waveLabel: Label | null = null;
  private hpLabel: Label | null = null;
  private hpGraphics: Graphics | null = null;
  private shownHp = -1;
  private mantouLabel: Label | null = null;
  private hintLabel: Label | null = null;
  private recruitLabel: Label | null = null;
  private recruitGraphics: Graphics | null = null;
  private recruitEnabled = true;
  private speedLabel: Label | null = null;
  private bannerNode: Node | null = null;
  private bannerLabel: Label | null = null;
  private overlay: Node | null = null;
  private overlayTitle: Label | null = null;
  private overlayBody: Label | null = null;
  private overlayPhase = 'playing';
  private rangeNode: Node | null = null;
  private rangeGraphics: Graphics | null = null;

  private tokenViews = new Map<string, TokenView>();
  private enemyViews = new Map<string, EnemyView>();
  private shotViews = new Map<string, Node>();
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
  private inputBound = false;

  onLoad(): void {
    this.canvas = this.node.parent?.getComponent(Canvas) ?? null;
    this.boardLayer = this.ensureLayer('Board');
    this.actorLayer = this.ensureLayer('Actors');
    this.hudLayer = this.ensureLayer('Hud');
    this.zeroHitbox(this.boardLayer);
    this.zeroHitbox(this.actorLayer);
    this.zeroHitbox(this.hudLayer);
    this.loading = addLabel(this.hudLayer, 'Loading', '研墨中…', 32, inkColor(Ink.brown), 420, 80);
    void this.boot();
  }

  onDestroy(): void {
    this.unbindInput();
  }

  update(dt: number): void {
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

  private async boot(): Promise<void> {
    try {
      const config = await loadGameConfig();
      if (!this.isValid) {
        return;
      }
      this.begin(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误';
      if (this.loading) {
        this.loading.string = `配置没有读出来\n${message}`;
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
    this.loading?.node.destroy();
    this.loading = null;
    this.buildStatic(config);
    this.sim = new GameSim(config, Date.now() % 2147483647);
    this.bindInput();
    this.boardLayer?.setSiblingIndex(1);
    this.actorLayer?.setSiblingIndex(2);
    this.hudLayer?.setSiblingIndex(3);
    this.overlay?.setSiblingIndex(999);
    this.syncAll();
    console.log(`[InkGuard] ready, waves=${config.waves.waves.length}, adou=${config.adou.maxHp}`);
  }

  private ensureLayer(name: string): Node {
    const existing = this.node.getChildByName(name);
    if (existing) {
      existing.layer = this.node.layer;
      return existing;
    }
    const created = inkNode(name, 0, 0);
    this.node.addChild(created);
    return created;
  }

  private zeroHitbox(node: Node): void {
    const transform = node.getComponent(UITransform) ?? node.addComponent(UITransform);
    transform.setContentSize(0, 0);
    transform.setAnchorPoint(0.5, 0.5);
  }

  private buildStatic(config: GameConfig): void {
    const board = this.boardLayer;
    const hud = this.hudLayer;
    if (!board || !hud) {
      return;
    }

    const background = inkNode('Background', config.board.designWidth, config.board.designHeight);
    this.node.addChild(background);
    background.setSiblingIndex(0);
    paintBackground(background.addComponent(Graphics), config.board);

    const cellW = config.board.cellSize;
    const cellH = config.board.cellSize - 8;
    for (let i = 0; i < config.board.gridCols * config.board.gridRows; i += 1) {
      const cell = inkNode(`Cell${i}`, cellW, cellH);
      board.addChild(cell);
      const pos = tokenPosition(config, { id: '', type: '', level: 1, place: 'grid', slot: i });
      cell.setPosition(pos.x, pos.y, 0);
      paintCell(cell.addComponent(Graphics), cellW - 8, cellH - 8, false);
    }
    for (let i = 0; i < config.board.benchSlots; i += 1) {
      const slot = inkNode(`Bench${i}`, 74, 74);
      board.addChild(slot);
      const pos = tokenPosition(config, { id: '', type: '', level: 1, place: 'bench', slot: i });
      slot.setPosition(pos.x, pos.y, 0);
      paintCell(slot.addComponent(Graphics), 70, 70, true);
    }

    const gate = config.board.path[config.board.path.length - 1];
    const adou = inkNode('AdouSeal', 88, 88);
    board.addChild(adou);
    adou.setPosition(gate.x, gate.y, 0);
    paintSeal(adou.addComponent(Graphics), Ink.cinnabar, 2, 36);
    addLabel(adou, 'Glyph', '斗', 40, inkColor(Ink.cinnabar), 72, 56).node.setPosition(0, 2, 0);

    this.rangeNode = inkNode('Range', 8, 8);
    board.addChild(this.rangeNode);
    this.rangeGraphics = this.rangeNode.addComponent(Graphics);
    this.rangeNode.active = false;

    this.titleLabel = addLabel(hud, 'Title', '墨卫', 40, inkColor(Ink.ink), 220, 56);
    this.titleLabel.node.setPosition(-220, 598, 0);
    this.speedLabel = this.makeSpeedButton(hud);
    this.waveLabel = addLabel(hud, 'Wave', '', 22, inkColor(Ink.brown), 640, 36);
    this.waveLabel.node.setPosition(0, 548, 0);
    this.hpLabel = addLabel(hud, 'HpText', '', 22, inkColor(Ink.brown), 640, 32);
    this.hpLabel.node.setPosition(0, 504, 0);
    const bar = inkNode('HpBar', 460, 22);
    hud.addChild(bar);
    bar.setPosition(0, 470, 0);
    this.hpGraphics = bar.addComponent(Graphics);

    this.mantouLabel = addLabel(hud, 'Mantou', '', 26, inkColor(Ink.brown), 340, 48);
    this.mantouLabel.node.setPosition(-150, 412, 0);
    this.makeRecruitButton(hud);

    this.hintLabel = addLabel(hud, 'Hint', HINT, 20, inkColor(Ink.brown), 680, 56);
    this.hintLabel.node.setPosition(0, -590, 0);

    this.bannerNode = inkNode('Banner', 360, 72);
    hud.addChild(this.bannerNode);
    this.bannerNode.setPosition(0, 200, 0);
    paintCell(this.bannerNode.addComponent(Graphics), 340, 64, false);
    this.bannerLabel = addLabel(this.bannerNode, 'BannerText', '', 36, inkColor(Ink.cinnabar), 320, 60);
    this.bannerNode.active = false;

    this.buildOverlay(hud, config);
  }

  private makeSpeedButton(hud: Node): Label {
    const node = inkNode('Speed', 120, 44);
    hud.addChild(node);
    node.setPosition(250, 598, 0);
    paintButton(node.addComponent(Graphics), 120, 44, true);
    const label = addLabel(node, 'SpeedText', '常速', 20, inkColor('#fff8ea'), 110, 40);
    node.on(Node.EventType.TOUCH_END, () => this.onSpeed(), this);
    node.on(Node.EventType.MOUSE_UP, () => this.onSpeed(), this);
    return label;
  }

  private makeRecruitButton(hud: Node): void {
    const node = inkNode('Recruit', 176, 64);
    hud.addChild(node);
    node.setPosition(190, 412, 0);
    this.recruitGraphics = node.addComponent(Graphics);
    paintButton(this.recruitGraphics, 176, 64, true);
    this.recruitLabel = addLabel(node, 'RecruitText', '招募', 24, inkColor('#fff8ea'), 160, 52);
    node.on(Node.EventType.TOUCH_END, () => this.onRecruit(), this);
    node.on(Node.EventType.MOUSE_UP, () => this.onRecruit(), this);
  }

  private buildOverlay(hud: Node, config: GameConfig): void {
    const overlay = inkNode('Overlay', config.board.designWidth, config.board.designHeight);
    hud.addChild(overlay);
    const dim = overlay.addComponent(Graphics);
    dim.fillColor = inkColor('#1d2b38', 150);
    dim.rect(-config.board.designWidth / 2, -config.board.designHeight / 2, config.board.designWidth, config.board.designHeight);
    dim.fill();
    const card = inkNode('Card', 520, 360);
    overlay.addChild(card);
    paintCell(card.addComponent(Graphics), 520, 340, false);
    this.overlayTitle = addLabel(card, 'ResultTitle', '', 40, inkColor(Ink.ink), 460, 64);
    this.overlayTitle.node.setPosition(0, 90, 0);
    this.overlayBody = addLabel(card, 'ResultBody', '', 22, inkColor(Ink.brown), 440, 120);
    this.overlayBody.node.setPosition(0, 10, 0);
    const button = inkNode('Restart', 220, 64);
    card.addChild(button);
    button.setPosition(0, -110, 0);
    paintButton(button.addComponent(Graphics), 220, 64, true);
    addLabel(button, 'RestartText', '再守一阵', 24, inkColor('#fff8ea'), 200, 52);
    button.on(Node.EventType.TOUCH_END, () => this.restart(), this);
    button.on(Node.EventType.MOUSE_UP, () => this.restart(), this);
    overlay.active = false;
    this.overlay = overlay;
  }

  private bindInput(): void {
    if (this.inputBound) {
      return;
    }
    this.inputBound = true;
    input.on(Input.EventType.TOUCH_MOVE, this.onPointerMove, this);
    input.on(Input.EventType.TOUCH_END, this.onPointerEnd, this);
    input.on(Input.EventType.TOUCH_CANCEL, this.onPointerEnd, this);
    input.on(Input.EventType.MOUSE_MOVE, this.onPointerMove, this);
    input.on(Input.EventType.MOUSE_UP, this.onPointerEnd, this);
  }

  private unbindInput(): void {
    if (!this.inputBound) {
      return;
    }
    this.inputBound = false;
    input.off(Input.EventType.TOUCH_MOVE, this.onPointerMove, this);
    input.off(Input.EventType.TOUCH_END, this.onPointerEnd, this);
    input.off(Input.EventType.TOUCH_CANCEL, this.onPointerEnd, this);
    input.off(Input.EventType.MOUSE_MOVE, this.onPointerMove, this);
    input.off(Input.EventType.MOUSE_UP, this.onPointerEnd, this);
  }

  private claimUi(): boolean {
    const now = Date.now();
    if (this.pointerDown || now < this.uiLockUntil || now - this.lastUiClaim < 140) {
      return false;
    }
    this.lastUiClaim = now;
    return true;
  }

  private onRecruit(): void {
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

  private onSpeed(): void {
    if (!this.claimUi()) {
      return;
    }
    this.timeScale = this.timeScale === 1 ? 3 : 1;
    if (this.speedLabel) {
      this.speedLabel.string = this.timeScale === 1 ? '常速' : '三倍';
    }
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
    this.dragTouch = typeof event.getID === 'function' ? event.getID() : -1;
    this.dragPos = this.readPointer(event);
    viewToken.root.setScale(1.12, 1.12, 1);
    viewToken.root.setSiblingIndex(999);
    viewToken.root.setPosition(this.dragPos.x, this.dragPos.y, 0);
    const stat = this.sim.statOf(token.type, token.level);
    paintRange(this.rangeGraphics, stat.range, this.sim.config.units.types[token.type].ink);
    this.rangeNode.active = true;
    this.rangeNode.setPosition(this.dragPos.x, this.dragPos.y, 0);
  }

  private onPointerMove(event: PointerEvent): void {
    if (!this.pointerDown || !this.dragId) {
      return;
    }
    const id = typeof event.getID === 'function' ? event.getID() : -1;
    if (this.dragTouch !== -1 && id !== -1 && id !== this.dragTouch) {
      return;
    }
    this.dragPos = this.readPointer(event);
    const viewToken = this.tokenViews.get(this.dragId);
    if (viewToken) {
      viewToken.root.setPosition(this.dragPos.x, this.dragPos.y, 0);
    }
    this.rangeNode?.setPosition(this.dragPos.x, this.dragPos.y, 0);
  }

  private onPointerEnd(event: PointerEvent): void {
    if (!this.pointerDown || !this.dragId) {
      return;
    }
    const id = typeof event.getID === 'function' ? event.getID() : -1;
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
    const viewToken = this.tokenViews.get(tokenId);
    if (viewToken) {
      viewToken.root.setScale(1, 1, 1);
    }
    const result = this.resolveDrop(tokenId, this.dragPos.x, this.dragPos.y);
    if (!result.ok) {
      this.showToast(result.reason === 'max-level' ? '已是最高品' : '字令或品级不同，合不了');
    }
    this.syncTokens();
  }

  private resolveDrop(id: string, x: number, y: number): DropResult {
    if (!this.sim || !this.config) {
      return { ok: true, action: 'stay' };
    }
    let best: Token | null = null;
    let bestD = 56;
    for (const token of this.sim.tokens) {
      if (token.id === id) {
        continue;
      }
      const pos = tokenPosition(this.config, token);
      const d = Math.hypot(pos.x - x, pos.y - y);
      if (d <= bestD) {
        bestD = d;
        best = token;
      }
    }
    if (best) {
      return this.sim.drop(id, best.place, best.slot);
    }
    const grid = nearestIndex(this.config.board, 'grid', x, y, 64);
    if (grid >= 0) {
      return this.sim.drop(id, 'grid', grid);
    }
    const bench = nearestIndex(this.config.board, 'bench', x, y, 48);
    if (bench >= 0) {
      return this.sim.drop(id, 'bench', bench);
    }
    return { ok: true, action: 'stay' };
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
        paintSeal(viewToken.graphics, this.config.units.types[token.type].ink, token.level, 40);
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
    const root = inkNode(`Token-${token.id}`, 96, 96);
    this.actorLayer!.addChild(root);
    const graphics = root.addComponent(Graphics);
    paintSeal(graphics, type.ink, token.level, 40);
    const glyph = addLabel(root, 'Glyph', type.glyph, 52, inkColor(type.ink), 84, 64);
    glyph.node.setPosition(0, 8, 0);
    const rank = addLabel(root, 'Rank', `${RANK[token.level] ?? token.level}品`, 18, inkColor(Ink.brown), 80, 28);
    rank.node.setPosition(0, -28, 0);
    root.on(Node.EventType.TOUCH_START, (event: EventTouch) => this.beginDrag(token.id, event), this);
    root.on(Node.EventType.MOUSE_DOWN, (event: EventMouse) => this.beginDrag(token.id, event), this);
    return { id: token.id, root, glyph, rank, graphics, shownLevel: token.level };
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
        const root = inkNode(`Enemy-${enemy.id}`, 52, 64);
        this.actorLayer!.addChild(root);
        paintEnemy(root.addComponent(Graphics));
        addLabel(root, 'Mark', '寇', 22, inkColor('#f4efe4'), 40, 30).node.setPosition(0, 2, 0);
        const hp = addLabel(root, 'Hp', '', 14, inkColor('#f4efe4'), 48, 20);
        hp.node.setPosition(0, -24, 0);
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
    for (const [id, node] of this.shotViews) {
      if (!alive.has(id)) {
        node.destroy();
        this.shotViews.delete(id);
      }
    }
    for (const shot of this.sim.shots) {
      let node = this.shotViews.get(shot.id);
      if (!node) {
        node = inkNode(`Shot-${shot.id}`, 16, 16);
        this.actorLayer.addChild(node);
        paintShot(node.addComponent(Graphics), shot.ink);
        this.shotViews.set(shot.id, node);
      }
      node.setPosition(shot.x, shot.y, 0);
    }
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
        const node = inkNode(`Float-${floater.id}`, 80, 32);
        this.hudLayer.addChild(node);
        const label = addLabel(node, 'Text', floater.text, 20, inkColor(Ink.cinnabar), 80, 32);
        const opacity = node.addComponent(UIOpacity);
        viewFloat = { node, label };
        this.floatViews.set(floater.id, viewFloat);
        opacity.opacity = 255;
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
    const hp = Math.max(0, Math.round(this.sim.adouHp));
    const maxHp = this.config.adou.maxHp;
    if (this.hpLabel) {
      this.hpLabel.string = `阿斗 ${hp}/${maxHp}`;
    }
    if (this.hpGraphics && hp !== this.shownHp) {
      this.shownHp = hp;
      paintBar(this.hpGraphics, 460, 22, maxHp <= 0 ? 0 : hp / maxHp);
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
    if (this.recruitGraphics && canRecruit !== this.recruitEnabled) {
      this.recruitEnabled = canRecruit;
      paintButton(this.recruitGraphics, 176, 64, canRecruit);
    }
    if (this.hintLabel) {
      this.hintLabel.string = this.toastTimer > 0 ? this.toast : HINT;
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
      if (ended) {
        this.overlay.setSiblingIndex(999);
      }
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
    this.timeScale = 1;
    if (this.speedLabel) {
      this.speedLabel.string = '常速';
    }
    this.toastTimer = 0;
    this.overlayPhase = 'playing';
    this.shownHp = -1;
    this.sim.reset(Date.now() % 2147483647);
    this.clearDynamics();
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
    for (const node of this.shotViews.values()) {
      node.destroy();
    }
    for (const viewFloat of this.floatViews.values()) {
      viewFloat.node.destroy();
    }
    this.tokenViews.clear();
    this.enemyViews.clear();
    this.shotViews.clear();
    this.floatViews.clear();
  }
}
