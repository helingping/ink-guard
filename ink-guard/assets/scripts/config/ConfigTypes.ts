/** Normalized runtime config. Raw JSON is validated in `validateConfig.ts`. */

export type AttackStyle = 'melee' | 'ranged';

export interface LevelStat {
  level: number;
  atk: number;
  aspd: number;
  range: number;
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
  path: BoardPoint[];
  projectileSpeed: number;
  hitRadius: number;
}

export interface GameConfig {
  units: UnitsConfig;
  economy: EconomyConfig;
  adou: AdouConfig;
  waves: WavesConfig;
  board: BoardConfig;
}

/** `resources.load` paths, without extension, under `assets/resources/`. */
export const CONFIG_FILES = ['units', 'economy', 'adou', 'waves', 'board'] as const;

export type ConfigFileName = (typeof CONFIG_FILES)[number];
