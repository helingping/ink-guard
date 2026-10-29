/** Normalized runtime config. Raw JSON is validated in `validateConfig.ts`. */

export type AttackStyle = 'melee' | 'ranged';

export interface LevelStat {
  level: number;
  atk: number;
  aspd: number;
  range: number;
  /** Hit points. Foes damage deployed tokens; a merge refills this. */
  hp: number;
}

export interface UnitTypeConfig {
  id: string;
  displayName: string;
  glyph: string;
  ink: string;
  /** melee connects at the end of `strike`; ranged fires a projectile at `shotSpeed`. */
  style: AttackStyle;
  /** Distinct delivery name. Each token in `order` must use a different one. */
  motion: string;
  styleLabel: string;
  motionLabel: string;
  /** Seconds from the swing until a melee hit. Zero for ranged. */
  strike: number;
  /** Pixels per second for a ranged shot. Zero for melee. */
  shotSpeed: number;
  byLevel: LevelStat[];
}

export interface UnitsConfig {
  maxLevel: number;
  order: string[];
  types: Record<string, UnitTypeConfig>;
}

/**
 * A foe borrows delivery from a player token (`vfx`): style, motion, strike,
 * shotSpeed, and level-1 range. Pose frames are its own glyph; fx frames are
 * the linked token's.
 */
export interface FoeTypeConfig {
  id: string;
  displayName: string;
  glyph: string;
  ink: string;
  style: AttackStyle;
  motion: string;
  styleLabel: string;
  motionLabel: string;
  strike: number;
  shotSpeed: number;
  range: number;
  atk: number;
  aspd: number;
  vfx: string;
}

export interface FoesConfig {
  order: string[];
  types: Record<string, FoeTypeConfig>;
}

export interface EconomyConfig {
  startMantou: number;
  recruitCostBase: number;
  recruitCostGrowth: number;
  incomePerSecond: number;
  killReward: number;
  waveClearBonus: number;
}

export interface AdouConfig {
  maxHp: number;
  name: string;
}

export interface WaveDef {
  id: number;
  count: number;
  hp: number;
  speed: number;
  damage: number;
  interval: number;
  /** Foe ids, cycled as the wave spawns. Empty means the first melee foe. */
  roster: string[];
}

export interface WavesConfig {
  firstDelay: number;
  gapSeconds: number;
  waves: WaveDef[];
}

export interface BoardPoint {
  x: number;
  y: number;
}

/** River sprite rect in board space. The lane polylines are traced in this rect. */
export interface RiverRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardConfig {
  designWidth: number;
  designHeight: number;
  gridCols: number;
  gridRows: number;
  benchSlots: number;
  cellSize: number;
  cellGap: number;
  gridOrigin: BoardPoint;
  benchOrigin: BoardPoint;
  benchStep: number;
  /**
   * Every march. Each polyline starts at a north mouth and ends on the same seal.
   * The middle lane is also copied to `path` for the seal anchor.
   */
  lanes: BoardPoint[][];
  /** Seal lane (the shared end point). Prefer `lanes` for movement. */
  path: BoardPoint[];
  /** Painted river the horizontal lane samples sit on. Omitted in headless fixtures. */
  river: RiverRect | null;
  /** North camp seal. Omitted in headless fixtures. */
  camp: BoardPoint | null;
  projectileSpeed: number;
  hitRadius: number;
}

export interface GameConfig {
  units: UnitsConfig;
  foes: FoesConfig;
  economy: EconomyConfig;
  adou: AdouConfig;
  waves: WavesConfig;
  board: BoardConfig;
}

/** `resources.load` paths, without extension, under `assets/resources/`. */
export const CONFIG_FILES = ['units', 'foes', 'economy', 'adou', 'waves', 'board'] as const;

export type ConfigFileName = (typeof CONFIG_FILES)[number];
