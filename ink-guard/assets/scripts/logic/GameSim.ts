import type { AttackStyle, GameConfig, LevelStat, WaveDef } from '../config/ConfigTypes';
import { benchPosition, buildPath, gridPosition, pointOnPath, type Polyline } from './geometry';
import { mulberry32 } from './rng';

export type Place = 'bench' | 'grid';
export type Phase = 'playing' | 'win' | 'lose';

export interface Token {
  id: string;
  type: string;
  level: number;
  place: Place;
  slot: number;
}

export interface Enemy {
  id: string;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  distance: number;
  x: number;
  y: number;
  waveId: number;
}

export interface Shot {
  id: string;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  damage: number;
  targetId: string;
  ink: string;
  typeId: string;
  sourceId: string;
  style: AttackStyle;
  motion: string;
  /** Melee windup in seconds. Ranged shots leave this at 0 and fly at `speed`. */
  strike: number;
  speed: number;
  age: number;
}

export interface FloatText {
  id: string;
  x: number;
  y: number;
  text: string;
  age: number;
}

export type DropResult =
  | { ok: true; action: 'move' | 'merge' | 'stay' | 'swap' }
  | { ok: false; reason: 'mismatch' | 'max-level' };

export type DropPreview = 'stay' | 'move' | 'merge' | 'swap' | 'blocked';

export type RecruitResult =
  | { ok: true; token: Token }
  | { ok: false; reason: 'broke' | 'bench-full' };

/**
 * Pure rules for Ink Guard: recruit, merge, waves, and combat.
 * No engine imports, so `tools/simulate.ts` can replay the same loop.
 */
export class GameSim {
  phase: Phase = 'playing';
  mantou = 0;
  adouHp = 0;
  recruitCount = 0;
  mergeCount = 0;
  killCount = 0;
  leakCount = 0;
  time = 0;
  waveCursor = 0;
  spawnedInWave = 0;
  betweenWaves = true;
  betweenTimer = 0;
  banner = '';
  bannerTimer = 0;
  tokens: Token[] = [];
  enemies: Enemy[] = [];
  shots: Shot[] = [];
  floats: FloatText[] = [];

  private rng: () => number;
  private seq = 1;
  private path: Polyline;
  private spawnCooldown = 0;
  private cooldown = new Map<string, number>();

  constructor(readonly config: GameConfig, seed: number | (() => number)) {
    this.rng = typeof seed === 'function' ? seed : mulberry32(seed);
    this.path = buildPath(config.board.path);
    this.resetState();
  }

  reset(seed: number | (() => number)): void {
    this.rng = typeof seed === 'function' ? seed : mulberry32(seed);
    this.resetState();
  }

  get waveNumber(): number {
    return Math.min(this.waveCursor + 1, this.config.waves.waves.length);
  }

  get waveTotal(): number {
    return this.config.waves.waves.length;
  }

  nextCost(): number {
    const economy = this.config.economy;
    return economy.recruitCostBase + economy.recruitCostGrowth * this.recruitCount;
  }

  hasBenchRoom(): boolean {
    return this.firstEmpty('bench') >= 0;
  }

  statOf(type: string, level: number): LevelStat {
    const row = this.config.units.types[type]?.byLevel[level];
    if (!row) {
      throw new Error(`Missing stat for ${type} level ${level}`);
    }
    return row;
  }

  recruit(): RecruitResult {
    if (this.phase !== 'playing') {
      return { ok: false, reason: 'bench-full' };
    }
    const slot = this.firstEmpty('bench');
    if (slot < 0) {
      return { ok: false, reason: 'bench-full' };
    }
    const cost = this.nextCost();
    if (this.mantou < cost) {
      return { ok: false, reason: 'broke' };
    }
    this.mantou -= cost;
    this.recruitCount += 1;
    const order = this.config.units.order;
    const index = Math.min(order.length - 1, Math.floor(this.rng() * order.length));
    const token: Token = {
      id: this.nextId('u'),
      type: order[index],
      level: 1,
      place: 'bench',
      slot,
    };
    this.tokens.push(token);
    return { ok: true, token };
  }

  drop(tokenId: string, place: Place, slot: number): DropResult {
    if (this.phase !== 'playing') {
      return { ok: false, reason: 'mismatch' };
    }
    const token = this.tokens.find((entry) => entry.id === tokenId);
    if (!token || slot < 0 || slot >= this.slotCount(place)) {
      return { ok: false, reason: 'mismatch' };
    }
    const occupant = this.tokens.find((entry) => entry.place === place && entry.slot === slot);
    if (!occupant || occupant.id === token.id) {
      if (occupant && occupant.id === token.id) {
        return { ok: true, action: 'stay' };
      }
      token.place = place;
      token.slot = slot;
      return { ok: true, action: 'move' };
    }
    if (occupant.type === token.type && occupant.level === token.level) {
      if (token.level >= this.config.units.maxLevel) {
        return { ok: false, reason: 'max-level' };
      }
      occupant.level += 1;
      this.tokens = this.tokens.filter((entry) => entry.id !== token.id);
      this.cooldown.delete(token.id);
      this.cooldown.set(occupant.id, 0.15);
      this.mergeCount += 1;
      return { ok: true, action: 'merge' };
    }
    const fromPlace = token.place;
    const fromSlot = token.slot;
    token.place = occupant.place;
    token.slot = occupant.slot;
    occupant.place = fromPlace;
    occupant.slot = fromSlot;
    return { ok: true, action: 'swap' };
  }

  /**
   * What a drop would do, without changing the board.
   * Used to light legal cells while a token is being dragged.
   */
  previewDrop(tokenId: string, place: Place, slot: number): DropPreview {
    if (this.phase !== 'playing') {
      return 'blocked';
    }
    const token = this.tokens.find((entry) => entry.id === tokenId);
    if (!token || slot < 0 || slot >= this.slotCount(place)) {
      return 'blocked';
    }
    const occupant = this.tokens.find((entry) => entry.place === place && entry.slot === slot);
    if (!occupant) {
      return 'move';
    }
    if (occupant.id === token.id) {
      return 'stay';
    }
    if (occupant.type === token.type && occupant.level === token.level) {
      return token.level >= this.config.units.maxLevel ? 'blocked' : 'merge';
    }
    return 'swap';
  }

  /** Places a level-1 token without spending mantou. The first-run guide uses this. */
  placeGuideToken(type: string, place: Place, slot: number): Token | null {
    if (this.phase !== 'playing' || !this.config.units.types[type]) {
      return null;
    }
    if (slot < 0 || slot >= this.slotCount(place)) {
      return null;
    }
    if (this.tokens.some((entry) => entry.place === place && entry.slot === slot)) {
      return null;
    }
    const token: Token = {
      id: this.nextId('u'),
      type,
      level: 1,
      place,
      slot,
    };
    this.tokens.push(token);
    return token;
  }

  tick(dt: number): void {
    if (this.phase !== 'playing' || dt <= 0) {
      return;
    }
    this.time += dt;
    this.mantou += this.config.economy.incomePerSecond * dt;
    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    }
    this.tickFloats(dt);
    this.spawnPending(dt);
    this.tickAttacks(dt);
    this.tickShots(dt);
    this.tickEnemies(dt);
    this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
    this.shots = this.shots.filter((shot) => this.enemies.some((enemy) => enemy.id === shot.targetId));
    if (this.adouHp <= 0) {
      this.adouHp = 0;
      this.phase = 'lose';
      this.bannerTimer = 0;
      return;
    }
    this.maybeAdvanceWave();
  }

  private resetState(): void {
    const delay = this.config.waves.firstDelay;
    this.phase = 'playing';
    this.mantou = this.config.economy.startMantou;
    this.adouHp = this.config.adou.maxHp;
    this.recruitCount = 0;
    this.mergeCount = 0;
    this.killCount = 0;
    this.leakCount = 0;
    this.time = 0;
    this.waveCursor = 0;
    this.spawnedInWave = 0;
    this.betweenWaves = delay > 0;
    this.betweenTimer = delay;
    this.banner = '';
    this.bannerTimer = 0;
    this.tokens = [];
    this.enemies = [];
    this.shots = [];
    this.floats = [];
    this.seq = 1;
    this.spawnCooldown = 0;
    this.cooldown.clear();
    this.path = buildPath(this.config.board.path);
  }

  private nextId(prefix: string): string {
    const id = `${prefix}${this.seq}`;
    this.seq += 1;
    return id;
  }

  private slotCount(place: Place): number {
    const board = this.config.board;
    return place === 'grid' ? board.gridCols * board.gridRows : board.benchSlots;
  }

  private firstEmpty(place: Place): number {
    const used = new Set(this.tokens.filter((token) => token.place === place).map((token) => token.slot));
    const count = this.slotCount(place);
    for (let i = 0; i < count; i += 1) {
      if (!used.has(i)) {
        return i;
      }
    }
    return -1;
  }

  private spawnPending(dt: number): void {
    const waves = this.config.waves.waves;
    if (this.waveCursor >= waves.length) {
      return;
    }
    if (this.betweenWaves) {
      this.betweenTimer -= dt;
      if (this.betweenTimer > 0) {
        return;
      }
      this.betweenWaves = false;
      this.spawnedInWave = 0;
      this.spawnCooldown = 0;
      this.banner = `第 ${this.waveNumber} 波`;
      this.bannerTimer = 1.4;
    }
    const wave = waves[this.waveCursor];
    if (this.spawnedInWave >= wave.count) {
      return;
    }
    this.spawnCooldown -= dt;
    while (this.spawnedInWave < wave.count && this.spawnCooldown <= 0) {
      this.spawnEnemy(wave);
      this.spawnedInWave += 1;
      this.spawnCooldown += wave.interval;
    }
  }

  private spawnEnemy(wave: WaveDef): void {
    const point = pointOnPath(this.path, 0);
    this.enemies.push({
      id: this.nextId('e'),
      hp: wave.hp,
      maxHp: wave.hp,
      speed: wave.speed,
      damage: wave.damage,
      distance: 0,
      x: point.x,
      y: point.y,
      waveId: wave.id,
    });
  }

  private tickAttacks(dt: number): void {
    const active = new Set<string>();
    for (const token of this.tokens) {
      if (token.place !== 'grid') {
        continue;
      }
      active.add(token.id);
      const stat = this.statOf(token.type, token.level);
      let readyIn = (this.cooldown.get(token.id) ?? 0) - dt;
      if (readyIn > 0) {
        this.cooldown.set(token.id, readyIn);
        continue;
      }
      const origin = gridPosition(this.config.board, token.slot);
      const target = this.nearestEnemy(origin.x, origin.y, stat.range);
      if (!target) {
        this.cooldown.set(token.id, 0);
        continue;
      }
      const type = this.config.units.types[token.type];
      this.cooldown.set(token.id, 1 / stat.aspd);
      this.shots.push({
        id: this.nextId('s'),
        x: origin.x,
        y: origin.y,
        fromX: origin.x,
        fromY: origin.y,
        damage: stat.atk,
        targetId: target.id,
        ink: type.ink,
        typeId: token.type,
        sourceId: token.id,
        style: type.style,
        motion: type.motion,
        strike: type.style === 'melee' ? type.strike : 0,
        speed: type.style === 'ranged' ? type.shotSpeed : 0,
        age: 0,
      });
    }
    for (const id of this.cooldown.keys()) {
      if (!active.has(id)) {
        this.cooldown.delete(id);
      }
    }
  }

  private nearestEnemy(x: number, y: number, range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const d = Math.hypot(enemy.x - x, enemy.y - y);
      if (d <= range && d < bestD) {
        bestD = d;
        best = enemy;
      }
    }
    return best;
  }

  private tickShots(dt: number): void {
    const hitRadius = this.config.board.hitRadius;
    const kept: Shot[] = [];
    for (const shot of this.shots) {
      const target = this.enemies.find((enemy) => enemy.id === shot.targetId && enemy.hp > 0);
      if (!target) {
        continue;
      }
      if (shot.style === 'melee') {
        shot.age += dt;
        const duration = Math.max(0.001, shot.strike);
        const t = Math.min(1, shot.age / duration);
        shot.x = shot.fromX + (target.x - shot.fromX) * t;
        shot.y = shot.fromY + (target.y - shot.fromY) * t;
        if (shot.age >= shot.strike) {
          this.applyDamage(target, shot.damage);
        } else {
          kept.push(shot);
        }
        continue;
      }
      const dx = target.x - shot.x;
      const dy = target.y - shot.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.max(0, shot.speed) * dt;
      if (dist <= step || dist <= hitRadius) {
        this.applyDamage(target, shot.damage);
      } else {
        shot.x += (dx / dist) * step;
        shot.y += (dy / dist) * step;
        shot.age += dt;
        kept.push(shot);
      }
    }
    this.shots = kept;
  }

  private applyDamage(enemy: Enemy, amount: number): void {
    if (enemy.hp <= 0) {
      return;
    }
    enemy.hp -= amount;
    this.pushFloat(enemy.x, enemy.y, `${Math.round(amount)}`);
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      this.mantou += this.config.economy.killReward;
      this.killCount += 1;
    }
  }

  private tickEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      enemy.distance += enemy.speed * dt;
      if (enemy.distance >= this.path.total) {
        this.leak(enemy);
      } else {
        const point = pointOnPath(this.path, enemy.distance);
        enemy.x = point.x;
        enemy.y = point.y;
      }
    }
  }

  private leak(enemy: Enemy): void {
    const end = this.path.points[this.path.points.length - 1];
    enemy.x = end.x;
    enemy.y = end.y;
    this.adouHp = Math.max(0, this.adouHp - enemy.damage);
    this.leakCount += 1;
    this.pushFloat(end.x, end.y + 36, `-${enemy.damage}`);
    enemy.hp = 0;
  }

  private maybeAdvanceWave(): void {
    if (this.phase !== 'playing' || this.betweenWaves) {
      return;
    }
    const waves = this.config.waves.waves;
    if (this.waveCursor >= waves.length) {
      return;
    }
    const wave = waves[this.waveCursor];
    if (this.spawnedInWave < wave.count || this.enemies.length > 0) {
      return;
    }
    this.mantou += this.config.economy.waveClearBonus;
    this.waveCursor += 1;
    if (this.waveCursor >= waves.length) {
      this.phase = 'win';
      this.bannerTimer = 0;
      return;
    }
    this.betweenWaves = true;
    this.betweenTimer = this.config.waves.gapSeconds;
    this.spawnedInWave = 0;
  }

  private tickFloats(dt: number): void {
    for (const floater of this.floats) {
      floater.age += dt;
    }
    this.floats = this.floats.filter((floater) => floater.age < 0.7);
  }

  private pushFloat(x: number, y: number, text: string): void {
    this.floats.push({ id: this.nextId('f'), x, y, text, age: 0 });
    if (this.floats.length > 20) {
      this.floats.shift();
    }
  }
}

export function tokenPosition(config: GameConfig, token: Token): { x: number; y: number } {
  return token.place === 'grid'
    ? gridPosition(config.board, token.slot)
    : benchPosition(config.board, token.slot);
}
