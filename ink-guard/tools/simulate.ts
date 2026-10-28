/**
 * Headless replay of the Ink Guard rules. Run from the repo root:
 *   npx --yes tsx ink-guard/tools/simulate.ts
 * or compile with tools/tsconfig.sim.json and run the emitted JS.
 */
import type { GameConfig } from '../assets/scripts/config/ConfigTypes';
import { normalizeConfig } from '../assets/scripts/config/validateConfig';
import type { Token } from '../assets/scripts/logic/GameSim';
import { GameSim } from '../assets/scripts/logic/GameSim';
import { benchPosition, buildPath, dropSlotAt, gridPosition, pointOnPath } from '../assets/scripts/logic/geometry';

declare function require(name: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
};

declare const process: { exitCode?: number; cwd(): string };

const fs = require('fs');

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message);
    console.error(`FAIL ${message}`);
    return;
  }
  console.log(`PASS ${message}`);
}

function configDir(): string {
  const candidates = [
    'ink-guard/assets/resources/configs',
    'assets/resources/configs',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(`${candidate}/units.json`)) {
      return candidate;
    }
  }
  throw new Error(`Config directory not found from ${process.cwd()}`);
}

function loadRaw(): Record<string, unknown> {
  const dir = configDir();
  const raw: Record<string, unknown> = {};
  for (const name of ['units', 'economy', 'adou', 'waves', 'board']) {
    raw[name] = JSON.parse(fs.readFileSync(`${dir}/${name}.json`, 'utf8')) as unknown;
  }
  return raw;
}

function cloneRaw(raw: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
}

function bestToken(sim: GameSim, bench: Token[]): Token {
  return [...bench].sort((a, b) => {
    const sa = sim.statOf(a.type, a.level);
    const sb = sim.statOf(b.type, b.level);
    if (b.level !== a.level) {
      return b.level - a.level;
    }
    if (sb.range !== sa.range) {
      return sb.range - sa.range;
    }
    return sb.atk - sa.atk;
  })[0];
}

function mergeOnce(sim: GameSim): boolean {
  const tokens = [...sim.tokens].sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
  for (let i = 0; i < tokens.length; i += 1) {
    for (let j = i + 1; j < tokens.length; j += 1) {
      const source = tokens[i];
      const target = tokens[j];
      if (source.type === target.type && source.level === target.level && source.level < sim.config.units.maxLevel) {
        const result = sim.drop(source.id, target.place, target.slot);
        return result.ok && result.action === 'merge';
      }
    }
  }
  return false;
}

function deployOne(sim: GameSim, smart: boolean): boolean {
  const bench = sim.tokens.filter((token) => token.place === 'bench');
  if (bench.length === 0) {
    return false;
  }
  const used = new Set(sim.tokens.filter((token) => token.place === 'grid').map((token) => token.slot));
  const count = sim.config.board.gridCols * sim.config.board.gridRows;
  let slot = -1;
  for (let i = 0; i < count; i += 1) {
    if (!used.has(i)) {
      slot = i;
      break;
    }
  }
  if (slot < 0) {
    return false;
  }
  const token = smart ? bestToken(sim, bench) : bench[0];
  const result = sim.drop(token.id, 'grid', slot);
  return result.ok && result.action === 'move';
}

type Mode = 'idle' | 'place' | 'smart';

function decide(sim: GameSim, mode: Mode): void {
  if (mode === 'idle') {
    return;
  }
  const smart = mode === 'smart';
  if (smart) {
    let guard = 0;
    while (mergeOnce(sim) && guard < 40) {
      guard += 1;
    }
  }
  let placed = 0;
  while (deployOne(sim, smart) && placed < 40) {
    placed += 1;
  }
  if (sim.recruit().ok && smart) {
    let guard = 0;
    while (mergeOnce(sim) && guard < 40) {
      guard += 1;
    }
    placed = 0;
    while (deployOne(sim, smart) && placed < 40) {
      placed += 1;
    }
  }
}

interface RunSummary {
  phase: string;
  hp: number;
  time: number;
  kills: number;
  leaks: number;
  recruits: number;
  merges: number;
  mantou: number;
}

function run(config: GameConfig, seed: number, mode: Mode, maxTime: number): RunSummary {
  const sim = new GameSim(config, seed);
  let next = 0;
  const step = 1 / 60;
  while (sim.phase === 'playing' && sim.time < maxTime) {
    if (sim.time + 1e-6 >= next) {
      decide(sim, mode);
      next += 0.5;
    }
    sim.tick(step);
  }
  return {
    phase: sim.phase,
    hp: sim.adouHp,
    time: sim.time,
    kills: sim.killCount,
    leaks: sim.leakCount,
    recruits: sim.recruitCount,
    merges: sim.mergeCount,
    mantou: sim.mantou,
  };
}

function ruleTests(raw: Record<string, unknown>): void {
  const config = normalizeConfig(raw);
  check(config.units.order.length === 4, 'four calligraphy tokens');
  check(config.waves.waves.length === 5, 'five authored waves');
  const center = gridPosition(config.board, 2);
  check(Math.abs(center.x) < 0.001, 'middle column is centered');
  const inset = config.board.cellSize / 2 - 1;
  const gridCount = config.board.gridCols * config.board.gridRows;
  let slotsOk = true;
  for (let i = 0; i < gridCount; i += 1) {
    const p = gridPosition(config.board, i);
    const corners = [
      dropSlotAt(config.board, p.x, p.y),
      dropSlotAt(config.board, p.x + inset, p.y + inset),
      dropSlotAt(config.board, p.x - inset, p.y - inset),
    ];
    if (corners.some((slot) => !slot || slot.place !== 'grid' || slot.slot !== i)) {
      slotsOk = false;
    }
  }
  for (let i = 0; i < config.board.benchSlots; i += 1) {
    const p = benchPosition(config.board, i);
    const corners = [
      dropSlotAt(config.board, p.x, p.y),
      dropSlotAt(config.board, p.x + inset, p.y),
      dropSlotAt(config.board, p.x - inset, p.y),
    ];
    if (corners.some((slot) => !slot || slot.place !== 'bench' || slot.slot !== i)) {
      slotsOk = false;
    }
  }
  check(slotsOk, 'releasing on a cell center or corner selects that cell');
  check(dropSlotAt(config.board, 0, 480) === null, 'a point in the HUD is not a slot');

  const styles = config.units.order.map((id) => config.units.types[id].style);
  const motions = config.units.order.map((id) => config.units.types[id].motion);
  check(styles.filter((style) => style === 'melee').length >= 1 && styles.includes('ranged'), 'the roster has both melee and ranged tokens');
  check(new Set(motions).size === motions.length, 'each token has its own attack motion');
  check(config.units.types.dao.style === 'melee' && config.units.types.gong.style === 'ranged', 'blade is melee and bow is ranged');
  deliveryTests(raw);

  const costs = new GameSim(config, 1);
  const first = costs.nextCost();
  check(first === config.economy.recruitCostBase, 'first recruit uses the base cost');
  check(costs.recruit().ok, 'opening recruit succeeds');
  check(costs.nextCost() === first + config.economy.recruitCostGrowth, 'cost grows after each recruit');
  const before = costs.mantou;
  costs.tick(1);
  check(Math.abs(costs.mantou - (before + config.economy.incomePerSecond)) < 1e-6, 'mantou income is per second');

  const brokeRaw = cloneRaw(raw);
  const brokeEconomy = brokeRaw.economy as Record<string, unknown>;
  brokeEconomy.startMantou = 0;
  brokeEconomy.incomePerSecond = 0;
  const broke = new GameSim(normalizeConfig(brokeRaw), 1);
  const brokeResult = broke.recruit();
  check(!brokeResult.ok && brokeResult.reason === 'broke', 'recruit refuses when mantou is short');

  const same = new GameSim(config, () => 0);
  const a = same.recruit();
  const b = same.recruit();
  check(a.ok && b.ok, 'two seeded recruits');
  if (a.ok && b.ok) {
    check(a.token.type === 'dao' && b.token.type === 'dao', 'rng 0 recruits dao');
    const merged = same.drop(b.token.id, 'bench', a.token.slot);
    check(merged.ok && merged.action === 'merge', 'same type and level merge');
    check(same.tokens.length === 1 && same.tokens[0].level === 2, 'merge keeps one token at level + 1');
  }

  const mixed = new GameSim(config, () => 0);
  mixed.recruit();
  const other = new GameSim(config, () => 0.99);
  other.recruit();
  const dao = mixed.tokens[0];
  const qi = other.tokens[0];
  mixed.tokens.push({ ...qi, id: 'foreign', slot: 1 });
  const daoSlot = dao.slot;
  const swapped = mixed.drop('foreign', 'bench', daoSlot);
  check(swapped.ok && swapped.action === 'swap', 'different tokens swap places');
  const swappedDao = mixed.tokens.find((token) => token.id === dao.id);
  const swappedQi = mixed.tokens.find((token) => token.id === 'foreign');
  check(
    swappedDao?.slot === 1 && swappedQi?.slot === daoSlot && swappedDao.level === 1 && swappedQi?.level === 1,
    'swap exchanges slots and keeps both levels',
  );
  check(mixed.previewDrop('foreign', 'bench', swappedDao?.slot ?? -1) === 'swap', 'preview matches a cross-type drop');

  const ranked = new GameSim(config, () => 0);
  ranked.recruit();
  ranked.recruit();
  ranked.tokens[1].level = 2;
  const rankedSwap = ranked.drop(ranked.tokens[1].id, 'bench', ranked.tokens[0].slot);
  check(rankedSwap.ok && rankedSwap.action === 'swap', 'same token at a different level swaps instead of merging');

  const capped = new GameSim(config, () => 0);
  capped.recruit();
  capped.recruit();
  capped.tokens[0].level = config.units.maxLevel;
  capped.tokens[1].level = config.units.maxLevel;
  const cappedResult = capped.drop(capped.tokens[1].id, 'bench', capped.tokens[0].slot);
  check(!cappedResult.ok && cappedResult.reason === 'max-level', 'max level does not merge');

  const leakRaw = cloneRaw(raw);
  const leakBoard = leakRaw.board as Record<string, unknown>;
  leakBoard.path = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
  const leakWaves = leakRaw.waves as Record<string, unknown>;
  leakWaves.firstDelay = 0;
  leakWaves.gapSeconds = 0;
  leakWaves.waves = [{ id: 1, count: 1, hp: 5000, speed: 100, damage: 10, interval: 1 }];
  const leakAdou = leakRaw.adou as Record<string, unknown>;
  leakAdou.maxHp = 10;
  const leak = new GameSim(normalizeConfig(leakRaw), 1);
  for (let i = 0; i < 90; i += 1) {
    leak.tick(1 / 60);
  }
  check(leak.phase === 'lose' && leak.adouHp === 0 && leak.leakCount === 1, 'a reaching enemy drops Adou to 0');

  const chipRaw = cloneRaw(raw);
  const chipBoard = chipRaw.board as Record<string, unknown>;
  chipBoard.path = [{ x: 0, y: 0 }, { x: 80, y: 0 }];
  const chipWaves = chipRaw.waves as Record<string, unknown>;
  chipWaves.firstDelay = 0;
  chipWaves.gapSeconds = 0;
  chipWaves.waves = [{ id: 1, count: 1, hp: 5000, speed: 80, damage: 1, interval: 1 }];
  const chip = new GameSim(normalizeConfig(chipRaw), 1);
  for (let i = 0; i < 120; i += 1) {
    chip.tick(1 / 60);
  }
  check(chip.phase === 'win' && chip.adouHp === config.adou.maxHp - 1, 'surviving the wave set wins after a chip of damage');

  const killRaw = cloneRaw(raw);
  const killBoard = killRaw.board as Record<string, unknown>;
  killBoard.path = [{ x: 0, y: 400 }, { x: 0, y: 72 }];
  killBoard.projectileSpeed = 5000;
  const killWaves = killRaw.waves as Record<string, unknown>;
  killWaves.firstDelay = 0;
  killWaves.gapSeconds = 0;
  killWaves.waves = [{ id: 1, count: 1, hp: 30, speed: 20, damage: 5, interval: 1 }];
  const killUnits = killRaw.units as { types: Record<string, { levels: Array<Record<string, number>> }> };
  for (const type of Object.values(killUnits.types)) {
    for (const level of type.levels) {
      level.atk = 100;
      level.aspd = 5;
      level.range = 2000;
    }
  }
  const kill = new GameSim(normalizeConfig(killRaw), () => 0);
  const recruited = kill.recruit();
  check(recruited.ok, 'kill setup recruits');
  if (recruited.ok) {
    check(kill.drop(recruited.token.id, 'grid', 2).ok, 'kill setup deploys on the center column');
  }
  for (let i = 0; i < 240 && kill.phase === 'playing'; i += 1) {
    kill.tick(1 / 60);
  }
  check(kill.phase === 'win' && kill.killCount === 1 && kill.leakCount === 0, 'a deployed token can clear an enemy before it reaches Adou');

  check(config.waves.firstDelay >= 10, 'opening prep leaves time to recruit and merge');
  const backCenter = gridPosition(config.board, config.board.gridCols * 2 + 2);
  const backCorner = gridPosition(config.board, config.board.gridCols * 2);
  const midCenter = gridPosition(config.board, config.board.gridCols + 2);
  const backD = distanceToPath(config.board.path, backCenter.x, backCenter.y);
  const cornerD = distanceToPath(config.board.path, backCorner.x, backCorner.y);
  const midD = distanceToPath(config.board.path, midCenter.x, midCenter.y);
  const dao1 = config.units.types.dao.byLevel[1].range;
  const dao2 = config.units.types.dao.byLevel[2].range;
  check(config.units.types.gong.byLevel[1].range >= cornerD, 'back-row corners sit inside bow level-1 range');
  check(config.units.types.qiang.byLevel[1].range >= cornerD, 'back-row corners sit inside spear level-1 range');
  check(dao1 >= midD && dao1 < backD, 'level-1 blade reaches the middle row and still needs a merge for the back row');
  check(dao2 >= backD, 'blade reaches the back row after one merge');
}

function deliveryTests(raw: Record<string, unknown>): void {
  const meleeRaw = cloneRaw(raw);
  const meleeBoard = meleeRaw.board as Record<string, unknown>;
  meleeBoard.path = [{ x: 0, y: 120 }, { x: 0, y: 0 }];
  meleeBoard.projectileSpeed = 1;
  const meleeWaves = meleeRaw.waves as Record<string, unknown>;
  meleeWaves.firstDelay = 0;
  meleeWaves.gapSeconds = 0;
  meleeWaves.waves = [{ id: 1, count: 1, hp: 30, speed: 8, damage: 1, interval: 5 }];
  const meleeUnits = meleeRaw.units as { types: Record<string, { levels: Array<Record<string, number>> }> };
  meleeUnits.types.dao.levels[0].atk = 30;
  meleeUnits.types.dao.levels[0].range = 400;
  meleeUnits.types.dao.levels[0].aspd = 1;
  const melee = new GameSim(normalizeConfig(meleeRaw), () => 0);
  const recruitedMelee = melee.recruit();
  check(recruitedMelee.ok && recruitedMelee.token.type === 'dao', 'delivery setup recruits a blade');
  if (recruitedMelee.ok) {
    melee.drop(recruitedMelee.token.id, 'grid', 2);
  }
  melee.tick(0.04);
  const waiting = melee.enemies[0];
  check(!!waiting && waiting.hp === 30 && melee.shots.length === 1 && melee.shots[0].style === 'melee', 'a melee swing is in the air before it connects');
  melee.tick(0.08);
  check(melee.enemies.length === 0 || melee.enemies[0].hp <= 0, 'melee damage lands when the strike finishes, ignoring projectile speed');

  const rangedRaw = cloneRaw(raw);
  const rangedBoard = rangedRaw.board as Record<string, unknown>;
  rangedBoard.path = [{ x: 0, y: 360 }, { x: 0, y: 0 }];
  rangedBoard.projectileSpeed = 5000;
  const rangedWaves = rangedRaw.waves as Record<string, unknown>;
  rangedWaves.firstDelay = 0;
  rangedWaves.gapSeconds = 0;
  rangedWaves.waves = [{ id: 1, count: 1, hp: 40, speed: 6, damage: 1, interval: 5 }];
  const rangedUnits = rangedRaw.units as {
    types: Record<string, { shotSpeed: number; levels: Array<Record<string, number>> }>;
  };
  rangedUnits.types.gong.shotSpeed = 80;
  rangedUnits.types.gong.levels[0].atk = 40;
  rangedUnits.types.gong.levels[0].range = 800;
  rangedUnits.types.gong.levels[0].aspd = 1;
  const ranged = new GameSim(normalizeConfig(rangedRaw), () => 0.5);
  const recruitedRanged = ranged.recruit();
  check(recruitedRanged.ok && recruitedRanged.token.type === 'gong', 'delivery setup recruits a bow');
  if (recruitedRanged.ok) {
    ranged.drop(recruitedRanged.token.id, 'grid', 2);
  }
  ranged.tick(0.05);
  const flyer = ranged.shots[0];
  const target = ranged.enemies[0];
  check(
    !!flyer && flyer.style === 'ranged' && flyer.motion === 'arrow' && flyer.speed === 80 && !!target && target.hp === 40,
    'a ranged shot is still flying and has not hit yet',
  );
  ranged.tick(5);
  check(ranged.enemies.length === 0 || ranged.enemies[0].hp <= 0, 'the arrow hits after it travels');
}

function distanceToPath(points: Array<{ x: number; y: number }>, x: number, y: number): number {
  const path = buildPath(points);
  let best = Infinity;
  const steps = Math.max(1, Math.ceil(path.total / 3));
  for (let i = 0; i <= steps; i += 1) {
    const point = pointOnPath(path, (path.total * i) / steps);
    best = Math.min(best, Math.hypot(point.x - x, point.y - y));
  }
  return best;
}

function scenarioTests(config: GameConfig): void {
  const idle = run(config, 1, 'idle', 240);
  console.log('idle', idle);
  check(idle.phase === 'lose', 'doing nothing loses');

  const seeds = [1, 2, 3, 20261028];
  for (const seed of seeds) {
    const smart = run(config, seed, 'smart', 420);
    console.log('smart', seed, smart);
    check(smart.phase === 'win' && smart.hp > 0 && smart.merges > 0, `smart seed ${seed} clears the waves by merging`);
  }

  for (const seed of [1, 7, 20261028]) {
    const placed = run(config, seed, 'place', 420);
    console.log('place-only', seed, placed);
    check(placed.phase === 'lose', `level-1 tokens alone lose on seed ${seed}`);
  }
}

function main(): void {
  const raw = loadRaw();
  const config = normalizeConfig(raw);
  ruleTests(raw);
  scenarioTests(config);
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll Ink Guard rule checks passed.');
}

main();
