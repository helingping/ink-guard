/**
 * Headless check for the phone preview rules.
 * Run from anywhere: node web-preview/self-check.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  GameSim,
  benchPosition,
  buildPath,
  dropSlotAt,
  enemyKind,
  gridPosition,
  normalizeConfig,
  pointOnPath,
} from './sim.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonDir = path.join(root, 'ink-guard/assets/resources/configs');
const snapDir = path.join(root, 'web-preview/configs');
const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
    console.error(`FAIL ${message}`);
    return;
  }
  console.log(`PASS ${message}`);
}

function loadRaw(dir) {
  const raw = {};
  for (const name of ['units', 'economy', 'adou', 'waves', 'board']) {
    raw[name] = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  }
  return raw;
}

function cloneRaw(raw) {
  return JSON.parse(JSON.stringify(raw));
}

function soloPath(board, points) {
  board.path = points;
  delete board.lanes;
}

function bestToken(sim, bench) {
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

function mergeOnce(sim) {
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

function deployOne(sim, smart) {
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

function decide(sim, mode) {
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

function run(config, seed, mode, maxTime) {
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

function distanceToPath(points, x, y) {
  const path = buildPath(points);
  let best = Infinity;
  const steps = Math.max(1, Math.ceil(path.total / 3));
  for (let i = 0; i <= steps; i += 1) {
    const point = pointOnPath(path, (path.total * i) / steps);
    best = Math.min(best, Math.hypot(point.x - x, point.y - y));
  }
  return best;
}

function ruleTests(raw) {
  const config = normalizeConfig(raw);
  check(config.units.order.length === 4, 'four calligraphy tokens');
  check(config.waves.waves.length === 5, 'five authored waves');
  const styles = config.units.order.map((id) => config.units.types[id].style);
  const motions = config.units.order.map((id) => config.units.types[id].motion);
  check(styles.includes('melee') && styles.includes('ranged'), 'the roster has both melee and ranged tokens');
  check(new Set(motions).size === motions.length, 'each token has its own attack motion');
  check(config.units.types.dao.style === 'melee' && config.units.types.gong.style === 'ranged', 'blade is melee and bow is ranged');
  check(config.units.types.gong.motion === 'arrow', 'the bow fires an arrow');

  const center = gridPosition(config.board, 2);
  check(Math.abs(center.x) < 0.001, 'middle column is centered');
  const inset = config.board.cellSize / 2 - 1;
  let slotsOk = true;
  const gridCount = config.board.gridCols * config.board.gridRows;
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

  const costs = new GameSim(config, 1);
  const first = costs.nextCost();
  check(first === config.economy.recruitCostBase, 'first recruit uses the base cost');
  check(costs.recruit().ok, 'opening recruit succeeds');
  check(costs.nextCost() === first + config.economy.recruitCostGrowth, 'cost grows after each recruit');
  const before = costs.mantou;
  costs.tick(1);
  check(Math.abs(costs.mantou - (before + config.economy.incomePerSecond)) < 1e-6, 'mantou income is per second');

  const same = new GameSim(config, () => 0);
  const a = same.recruit();
  const b = same.recruit();
  check(a.ok && b.ok && a.token.type === 'dao' && b.token.type === 'dao', 'rng 0 recruits dao');
  if (a.ok && b.ok) {
    const merged = same.drop(b.token.id, 'bench', a.token.slot);
    check(merged.ok && merged.action === 'merge' && same.tokens.length === 1 && same.tokens[0].level === 2, 'same type and level merge to level + 1');
  }

  const mixed = new GameSim(config, () => 0);
  mixed.recruit();
  mixed.tokens.push({ id: 'foreign', type: 'qi', level: 1, place: 'bench', slot: 1 });
  const swapped = mixed.drop('foreign', 'bench', mixed.tokens[0].slot);
  check(swapped.ok && swapped.action === 'swap', 'different tokens swap places');

  const capped = new GameSim(config, () => 0);
  capped.recruit();
  capped.recruit();
  capped.tokens[0].level = config.units.maxLevel;
  capped.tokens[1].level = config.units.maxLevel;
  const cappedResult = capped.drop(capped.tokens[1].id, 'bench', capped.tokens[0].slot);
  check(!cappedResult.ok && cappedResult.reason === 'max-level', 'max level does not merge');

  const lanes = config.board.lanes;
  check(lanes.length >= 3, 'the march has several lanes');
  const front = gridPosition(config.board, 2);
  const second = gridPosition(config.board, config.board.gridCols + 2);
  const back = gridPosition(config.board, config.board.gridCols * (config.board.gridRows - 1) + 2);
  const centerLane = lanes[Math.min(1, lanes.length - 1)];
  const ford = centerLane[centerLane.length - 2];
  const mouth = centerLane[0];
  const dao1 = config.units.types.dao.byLevel[1].range;
  const spear1 = config.units.types.qiang.byLevel[1].range;
  const bow1 = config.units.types.gong.byLevel[1].range;
  const gap = (point, from) => Math.hypot(point.x - from.x, point.y - from.y);
  check(gap(mouth, front) > dao1 && gap(mouth, front) <= bow1, 'melee misses the north mouth and the bow can reach it');
  check(gap(ford, front) <= dao1 && gap(ford, second) > dao1, 'only the front rank blade reaches the ford');
  check(gap(ford, second) <= spear1, 'a second-rank spear reaches the ford');
  check(gap(ford, back) <= bow1 && gap(mouth, back) > bow1, 'a back-rank bow covers the ford but not the spawn mouth');

  deliveryTests(raw);
  enemyTests(raw);
  return config;
}

function deliveryTests(raw) {
  const meleeRaw = cloneRaw(raw);
  soloPath(meleeRaw.board, [{ x: 0, y: 120 }, { x: 0, y: 0 }]);
  meleeRaw.board.projectileSpeed = 1;
  meleeRaw.waves.firstDelay = 0;
  meleeRaw.waves.gapSeconds = 0;
  meleeRaw.waves.waves = [{ id: 1, count: 1, hp: 30, speed: 8, damage: 1, interval: 5 }];
  meleeRaw.units.types.dao.levels[0].atk = 30;
  meleeRaw.units.types.dao.levels[0].range = 400;
  meleeRaw.units.types.dao.levels[0].aspd = 1;
  const melee = new GameSim(normalizeConfig(meleeRaw), () => 0);
  const recruitedMelee = melee.recruit();
  check(recruitedMelee.ok && recruitedMelee.token.type === 'dao', 'delivery setup recruits a blade');
  if (recruitedMelee.ok) {
    melee.drop(recruitedMelee.token.id, 'grid', 2);
  }
  melee.tick(0.04);
  check(
    melee.enemies[0]?.hp === 30 && melee.shots.length === 1 && melee.shots[0].style === 'melee' && melee.shots[0].motion === 'slash',
    'a melee slash is in the air before it connects',
  );
  melee.tick(0.08);
  check(melee.enemies.length === 0 || melee.enemies[0].hp <= 0, 'melee damage lands when the strike finishes');

  const rangedRaw = cloneRaw(raw);
  soloPath(rangedRaw.board, [{ x: 0, y: 200 }, { x: 0, y: 0 }]);
  rangedRaw.waves.firstDelay = 0;
  rangedRaw.waves.gapSeconds = 0;
  rangedRaw.waves.waves = [{ id: 1, count: 1, hp: 40, speed: 6, damage: 1, interval: 5 }];
  rangedRaw.units.types.gong.shotSpeed = 80;
  rangedRaw.units.types.gong.levels[0].atk = 40;
  rangedRaw.units.types.gong.levels[0].range = 800;
  rangedRaw.units.types.gong.levels[0].aspd = 1;
  const ranged = new GameSim(normalizeConfig(rangedRaw), () => 0.5);
  const recruitedRanged = ranged.recruit();
  check(recruitedRanged.ok && recruitedRanged.token.type === 'gong', 'delivery setup recruits a bow');
  if (recruitedRanged.ok) {
    ranged.drop(recruitedRanged.token.id, 'grid', 2);
  }
  ranged.tick(0.05);
  const flyer = ranged.shots[0];
  check(
    !!flyer && flyer.style === 'ranged' && flyer.motion === 'arrow' && flyer.speed === 80 && ranged.enemies[0]?.hp === 40,
    'a ranged shot is still flying and has not hit yet',
  );
  ranged.tick(5);
  check(ranged.enemies.length === 0 || ranged.enemies[0].hp <= 0, 'the arrow hits after it travels');
}

function enemyTests(raw) {
  const glyphs = new GameSim(normalizeConfig(cloneRaw(raw)), 1);
  glyphs.config.waves.firstDelay = 0;
  glyphs.config.waves.waves = [{ id: 1, count: 3, hp: 5000, speed: 1, damage: 1, interval: 0.001 }];
  glyphs.betweenWaves = false;
  glyphs.betweenTimer = 0;
  glyphs.tick(0.05);
  const kinds = glyphs.enemies.map((enemy) => enemy.kind);
  check(kinds.join(',') === 'kou,mao,shi', 'enemies cycle kou, mao, shi');
  check(enemyKind('kou').glyph === '寇' && enemyKind('kou').style === 'melee', '寇 is melee');
  check(enemyKind('mao').glyph === '矛' && enemyKind('mao').style === 'melee', '矛 is melee');
  check(enemyKind('shi').glyph === '矢' && enemyKind('shi').style === 'ranged', '矢 is ranged');

  const shotRaw = cloneRaw(raw);
  shotRaw.waves.firstDelay = 0;
  shotRaw.waves.gapSeconds = 0;
  shotRaw.waves.waves = [{ id: 1, count: 3, hp: 5000, speed: 420, damage: 3, interval: 0.02 }];
  shotRaw.adou.maxHp = 40;
  const shot = new GameSim(normalizeConfig(shotRaw), 1);
  let sawArrow = false;
  let arrowDamage = null;
  const step = 1 / 60;
  for (let i = 0; i < 60 * 12 && shot.phase === 'playing'; i += 1) {
    shot.tick(step);
    if (shot.enemyShots.length > 0) {
      sawArrow = true;
      arrowDamage = shot.enemyShots[0].damage;
    }
  }
  check(sawArrow && arrowDamage === 3, '矢 looses one arrow that carries the wave damage');
  check(shot.killCount === 0 && shot.leakCount === 3 && shot.adouHp === 31, 'three seals deal their damage once and are not kills');

  const killRaw = cloneRaw(raw);
  killRaw.waves.firstDelay = 0;
  killRaw.waves.gapSeconds = 0;
  killRaw.waves.waves = [{ id: 1, count: 3, hp: 40, speed: 30, damage: 4, interval: 0.2 }];
  for (const type of Object.values(killRaw.units.types)) {
    type.levels[0].atk = 200;
    type.levels[0].aspd = 8;
    type.levels[0].range = 5000;
  }
  const kill = new GameSim(normalizeConfig(killRaw), () => 0);
  const recruited = kill.recruit();
  if (recruited.ok) {
    kill.drop(recruited.token.id, 'grid', 2);
  }
  for (let i = 0; i < 60 * 8 && kill.phase === 'playing'; i += 1) {
    kill.tick(step);
  }
  check(kill.phase === 'win' && kill.killCount === 3 && kill.leakCount === 0 && kill.enemyShots.length === 0, 'a deployed token can fell 矢 before the arrow leaves');
}

function scenarioTests(config) {
  const idle = run(config, 1, 'idle', 240);
  console.log('idle', idle);
  check(idle.phase === 'lose', 'doing nothing loses');

  for (const seed of [1, 2, 3, 20261028]) {
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

function snapshotTests() {
  for (const name of ['units', 'economy', 'adou', 'waves', 'board']) {
    const left = fs.readFileSync(path.join(canonDir, `${name}.json`), 'utf8');
    const right = fs.readFileSync(path.join(snapDir, `${name}.json`), 'utf8');
    check(left === right, `${name}.json snapshot matches the Creator config`);
  }
}

const raw = loadRaw(canonDir);
snapshotTests();
const config = ruleTests(raw);
scenarioTests(config);
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nAll Ink Guard preview checks passed.');
}
