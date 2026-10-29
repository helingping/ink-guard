/**
 * Ink Guard rules for the phone preview.
 * Recruit, merge, waves, and token combat follow the Cocos simulation.
 * Enemy seals cycle 寇 / 矛 / 矢. 寇 and 矛 walk into the ward.
 * 矢 is ranged: it stops short of the seal, looses one arrow, and that arrow
 * deals the wave's damage once. The arrow is timed to arrive when a walker
 * would have, so the JSON damage budget stays the same.
 */

export const ENEMY_KINDS = [
  { id: 'kou', glyph: '寇', style: 'melee', styleLabel: '近战', ink: '#243044' },
  { id: 'mao', glyph: '矛', style: 'melee', styleLabel: '近战', ink: '#1b4f45' },
  { id: 'shi', glyph: '矢', style: 'ranged', styleLabel: '远程', ink: '#8d2e2a' },
];

/** Remaining path length, in board pixels, where 矢 plants and shoots. */
export const SHI_STANDOFF = 150;
/** Seconds of draw before the arrow leaves. */
export const SHI_WINDUP = 0.32;

export function enemyKind(id) {
  return ENEMY_KINDS.find((kind) => kind.id === id) ?? ENEMY_KINDS[0];
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fail(file, message) {
  throw new Error(`${file}：${message}`);
}

function asRecord(value, file) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, '必须是 JSON 对象');
  }
  return value;
}

function needNumber(obj, key, file) {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, `${key} 必须是有限数字`);
  }
  return value;
}

function needString(obj, key, file) {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(file, `${key} 必须是非空字符串`);
  }
  return value;
}

function needArray(obj, key, file) {
  const value = obj[key];
  if (!Array.isArray(value)) {
    fail(file, `${key} 必须是数组`);
  }
  return value;
}

function needPoint(value, file) {
  const obj = asRecord(value, file);
  return { x: needNumber(obj, 'x', file), y: needNumber(obj, 'y', file) };
}

function parseUnits(raw) {
  const file = 'units.json';
  const obj = asRecord(raw, file);
  const maxLevel = needNumber(obj, 'maxLevel', file);
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 9) {
    fail(file, 'maxLevel 必须是 1 到 9 的整数');
  }
  const order = needArray(obj, 'order', file).map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(file, `order[${index}] 必须是字令 id`);
    }
    return entry;
  });
  if (new Set(order).size !== order.length) {
    fail(file, 'order 里有重复字令');
  }
  const typesRaw = asRecord(obj.types, file);
  const types = {};
  for (const id of order) {
    if (!(id in typesRaw)) {
      fail(file, `缺少字令 ${id}`);
    }
    const entry = asRecord(typesRaw[id], file);
    const byLevel = new Array(maxLevel + 1);
    const seen = new Set();
    for (const levelRaw of needArray(entry, 'levels', file)) {
      const levelObj = asRecord(levelRaw, file);
      const level = needNumber(levelObj, 'level', file);
      const atk = needNumber(levelObj, 'atk', file);
      const aspd = needNumber(levelObj, 'aspd', file);
      const range = needNumber(levelObj, 'range', file);
      if (!Number.isInteger(level) || level < 1 || level > maxLevel) {
        fail(file, `${id} 的 level ${level} 超出 1..${maxLevel}`);
      }
      if (seen.has(level)) {
        fail(file, `${id} 的 ${level} 品重复了`);
      }
      if (atk < 0 || aspd <= 0 || range <= 0) {
        fail(file, `${id} ${level} 品的 atk/aspd/range 不合法`);
      }
      seen.add(level);
      byLevel[level] = { level, atk, aspd, range };
    }
    for (let level = 1; level <= maxLevel; level += 1) {
      if (!byLevel[level]) {
        fail(file, `${id} 缺少 ${level} 品`);
      }
    }
    const ink = needString(entry, 'ink', file);
    if (!/^#[0-9a-fA-F]{6}$/.test(ink)) {
      fail(file, `${id} 的 ink 必须是 #RRGGBB`);
    }
    const style = needString(entry, 'style', file);
    if (style !== 'melee' && style !== 'ranged') {
      fail(file, `${id} 的 style 只能是 melee 或 ranged`);
    }
    const motion = needString(entry, 'motion', file);
    const strike = needNumber(entry, 'strike', file);
    const shotSpeed = needNumber(entry, 'shotSpeed', file);
    if (style === 'melee') {
      if (strike <= 0 || strike > 1) {
        fail(file, `${id} 的近战 strike 必须大于 0 且不超过 1 秒`);
      }
      if (shotSpeed !== 0) {
        fail(file, `${id} 是近战，shotSpeed 必须是 0`);
      }
    } else if (shotSpeed <= 0 || strike !== 0) {
      fail(file, `${id} 是远程，strike 必须是 0，shotSpeed 必须大于 0`);
    }
    types[id] = {
      id,
      displayName: needString(entry, 'displayName', file),
      glyph: needString(entry, 'glyph', file),
      ink,
      style,
      motion,
      styleLabel: needString(entry, 'styleLabel', file),
      motionLabel: needString(entry, 'motionLabel', file),
      strike,
      shotSpeed,
      byLevel,
    };
  }
  const motions = Object.values(types).map((type) => type.motion);
  if (new Set(motions).size !== motions.length) {
    fail(file, '每种字令的 motion 必须不同，攻击方式才能分开');
  }
  const extra = Object.keys(typesRaw).filter((id) => !order.includes(id));
  if (extra.length > 0) {
    fail(file, `order 未列出 ${extra.join(', ')}`);
  }
  return { maxLevel, order, types };
}

function parseEconomy(raw) {
  const file = 'economy.json';
  const obj = asRecord(raw, file);
  const economy = {
    startMantou: needNumber(obj, 'startMantou', file),
    recruitCostBase: needNumber(obj, 'recruitCostBase', file),
    recruitCostGrowth: needNumber(obj, 'recruitCostGrowth', file),
    incomePerSecond: needNumber(obj, 'incomePerSecond', file),
    killReward: needNumber(obj, 'killReward', file),
    waveClearBonus: needNumber(obj, 'waveClearBonus', file),
  };
  if (economy.startMantou < 0 || economy.recruitCostBase <= 0 || economy.recruitCostGrowth < 0) {
    fail(file, '初始馒头或招募花费不合法');
  }
  if (economy.incomePerSecond < 0 || economy.killReward < 0 || economy.waveClearBonus < 0) {
    fail(file, '收入不能为负');
  }
  return economy;
}

function parseAdou(raw) {
  const file = 'adou.json';
  const obj = asRecord(raw, file);
  const maxHp = needNumber(obj, 'maxHp', file);
  if (maxHp <= 0) {
    fail(file, 'maxHp 必须大于 0');
  }
  return { maxHp, name: needString(obj, 'name', file) };
}

function parseWaves(raw) {
  const file = 'waves.json';
  const obj = asRecord(raw, file);
  const firstDelay = needNumber(obj, 'firstDelay', file);
  const gapSeconds = needNumber(obj, 'gapSeconds', file);
  if (firstDelay < 0 || gapSeconds < 0) {
    fail(file, '备波时间不能为负');
  }
  const waves = needArray(obj, 'waves', file).map((entry, index) => {
    const waveObj = asRecord(entry, file);
    const wave = {
      id: needNumber(waveObj, 'id', file),
      count: needNumber(waveObj, 'count', file),
      hp: needNumber(waveObj, 'hp', file),
      speed: needNumber(waveObj, 'speed', file),
      damage: needNumber(waveObj, 'damage', file),
      interval: needNumber(waveObj, 'interval', file),
    };
    if (!Number.isInteger(wave.count) || wave.count <= 0) {
      fail(file, `第 ${index + 1} 波 count 必须是正整数`);
    }
    if (wave.hp <= 0 || wave.speed <= 0 || wave.damage <= 0 || wave.interval <= 0) {
      fail(file, `第 ${index + 1} 波的 hp/speed/damage/interval 必须大于 0`);
    }
    return wave;
  });
  if (waves.length === 0) {
    fail(file, '至少要有一波');
  }
  return { firstDelay, gapSeconds, waves };
}

function inside(board, point, pad, file, label) {
  const limitX = board.designWidth / 2 - pad;
  const limitY = board.designHeight / 2 - pad;
  if (Math.abs(point.x) > limitX || Math.abs(point.y) > limitY) {
    fail(file, `${label} (${point.x}, ${point.y}) 超出设计分辨率`);
  }
}

function parsePolyline(value, file, label) {
  if (!Array.isArray(value) || value.length < 2) {
    fail(file, `${label} 至少要有两个点`);
  }
  return value.map((entry) => needPoint(entry, file));
}

function parseBoard(raw) {
  const file = 'board.json';
  const obj = asRecord(raw, file);
  const board = {
    designWidth: needNumber(obj, 'designWidth', file),
    designHeight: needNumber(obj, 'designHeight', file),
    gridCols: needNumber(obj, 'gridCols', file),
    gridRows: needNumber(obj, 'gridRows', file),
    benchSlots: needNumber(obj, 'benchSlots', file),
    cellSize: needNumber(obj, 'cellSize', file),
    cellGap: needNumber(obj, 'cellGap', file),
    gridOrigin: needPoint(obj.gridOrigin, file),
    benchOrigin: needPoint(obj.benchOrigin, file),
    benchStep: needNumber(obj, 'benchStep', file),
    lanes: [],
    path: [],
    river: null,
    camp: null,
    projectileSpeed: needNumber(obj, 'projectileSpeed', file),
    hitRadius: needNumber(obj, 'hitRadius', file),
  };
  const lanes = obj.lanes === undefined
    ? null
    : needArray(obj, 'lanes', file).map((entry, index) => parsePolyline(entry, file, `lanes[${index}]`));
  const explicitPath = obj.path === undefined ? null : parsePolyline(obj.path, file, 'path');
  if (!lanes && !explicitPath) {
    fail(file, '需要 path 或 lanes');
  }
  board.lanes = lanes ?? [explicitPath];
  const seal = board.lanes[0][board.lanes[0].length - 1];
  board.lanes.forEach((lane, index) => {
    if (index === 0) {
      return;
    }
    const end = lane[lane.length - 1];
    if (Math.hypot(end.x - seal.x, end.y - seal.y) > 1) {
      fail(file, '各条墨路必须汇入同一个终点');
    }
  });
  board.path = board.lanes[Math.min(1, board.lanes.length - 1)];
  if (obj.river !== undefined) {
    const river = asRecord(obj.river, file);
    board.river = {
      x: needNumber(river, 'x', file),
      y: needNumber(river, 'y', file),
      w: needNumber(river, 'w', file),
      h: needNumber(river, 'h', file),
    };
    if (board.river.w <= 0 || board.river.h <= 0) {
      fail(file, 'river 宽高必须大于 0');
    }
  }
  if (obj.camp !== undefined) {
    board.camp = needPoint(obj.camp, file);
  }
  if (board.designWidth < 320 || board.designHeight < 480) {
    fail(file, '设计分辨率过小');
  }
  if (!Number.isInteger(board.gridCols) || !Number.isInteger(board.gridRows) || board.gridCols < 1 || board.gridRows < 1) {
    fail(file, '格子行列必须是正整数');
  }
  if (!Number.isInteger(board.benchSlots) || board.benchSlots < 1) {
    fail(file, 'benchSlots 必须是正整数');
  }
  if (board.cellSize <= 0 || board.cellGap < 0 || board.benchStep <= 0) {
    fail(file, '格子尺寸不合法');
  }
  if (board.projectileSpeed <= 0 || board.hitRadius <= 0) {
    fail(file, '弹道速度和命中半径必须大于 0');
  }
  const step = board.cellSize + board.cellGap;
  const lastCell = {
    x: board.gridOrigin.x + (board.gridCols - 1) * step,
    y: board.gridOrigin.y - (board.gridRows - 1) * step,
  };
  inside(board, lastCell, board.cellSize / 2, file, '最远格子');
  inside(board, board.gridOrigin, board.cellSize / 2, file, '格子原点');
  const lastBench = {
    x: board.benchOrigin.x + (board.benchSlots - 1) * board.benchStep,
    y: board.benchOrigin.y,
  };
  inside(board, board.benchOrigin, 28, file, '席位');
  inside(board, lastBench, 28, file, '末位席位');
  board.lanes.forEach((lane, laneIndex) => {
    lane.forEach((point, index) => inside(board, point, 8, file, `墨路 ${laneIndex} 点 ${index}`));
  });
  if (board.camp) {
    inside(board, board.camp, 8, file, '北营');
  }
  return board;
}

export function boardLanes(board) {
  return board.lanes?.length ? board.lanes : [board.path];
}

export function normalizeConfig(raw) {
  const root = asRecord(raw, 'configs');
  return {
    units: parseUnits(root.units),
    economy: parseEconomy(root.economy),
    adou: parseAdou(root.adou),
    waves: parseWaves(root.waves),
    board: parseBoard(root.board),
  };
}

export function buildPath(points) {
  const segLens = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segLens.push(d);
    total += d;
  }
  return { points, segLens, total };
}

export function pointOnPath(path, distance) {
  let remain = Math.max(0, distance);
  for (let i = 0; i < path.segLens.length; i += 1) {
    const seg = path.segLens[i];
    if (remain <= seg || i === path.segLens.length - 1) {
      const t = seg <= 0 ? 0 : Math.min(1, remain / seg);
      const a = path.points[i];
      const b = path.points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remain -= seg;
  }
  const last = path.points[path.points.length - 1];
  return { x: last.x, y: last.y };
}

export function gridPosition(board, index) {
  const col = index % board.gridCols;
  const row = Math.floor(index / board.gridCols);
  const step = board.cellSize + board.cellGap;
  return {
    x: board.gridOrigin.x + col * step,
    y: board.gridOrigin.y - row * step,
  };
}

export function benchPosition(board, index) {
  return {
    x: board.benchOrigin.x + index * board.benchStep,
    y: board.benchOrigin.y,
  };
}

export function slotReach(board, place) {
  if (place === 'grid') {
    const step = board.cellSize + board.cellGap;
    return Math.hypot(step / 2, step / 2) + 6;
  }
  return Math.hypot(board.benchStep / 2, board.cellSize / 2) + 6;
}

function nearestIndex(board, place, x, y, maxDist) {
  const count = place === 'grid' ? board.gridCols * board.gridRows : board.benchSlots;
  let best = -1;
  let bestD = maxDist;
  for (let i = 0; i < count; i += 1) {
    const p = place === 'grid' ? gridPosition(board, i) : benchPosition(board, i);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= bestD && (best < 0 || d < bestD)) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function dropSlotAt(board, x, y) {
  const grid = nearestIndex(board, 'grid', x, y, slotReach(board, 'grid'));
  const bench = nearestIndex(board, 'bench', x, y, slotReach(board, 'bench'));
  if (grid < 0 && bench < 0) {
    return null;
  }
  if (grid >= 0 && bench >= 0) {
    const gridPos = gridPosition(board, grid);
    const benchPos = benchPosition(board, bench);
    const gridD = Math.hypot(gridPos.x - x, gridPos.y - y);
    const benchD = Math.hypot(benchPos.x - x, benchPos.y - y);
    return gridD <= benchD ? { place: 'grid', slot: grid } : { place: 'bench', slot: bench };
  }
  if (grid >= 0) {
    return { place: 'grid', slot: grid };
  }
  return { place: 'bench', slot: bench };
}

export function tokenPosition(config, token) {
  return token.place === 'grid'
    ? gridPosition(config.board, token.slot)
    : benchPosition(config.board, token.slot);
}

export class GameSim {
  constructor(config, seed) {
    this.config = config;
    this.rng = typeof seed === 'function' ? seed : mulberry32(seed);
    this.lanes = [];
    this.cooldown = new Map();
    this.resetState();
  }

  reset(seed) {
    this.rng = typeof seed === 'function' ? seed : mulberry32(seed);
    this.resetState();
  }

  get waveNumber() {
    return Math.min(this.waveCursor + 1, this.config.waves.waves.length);
  }

  get waveTotal() {
    return this.config.waves.waves.length;
  }

  nextCost() {
    const economy = this.config.economy;
    return economy.recruitCostBase + economy.recruitCostGrowth * this.recruitCount;
  }

  hasBenchRoom() {
    return this.firstEmpty('bench') >= 0;
  }

  statOf(type, level) {
    const row = this.config.units.types[type]?.byLevel[level];
    if (!row) {
      throw new Error(`Missing stat for ${type} level ${level}`);
    }
    return row;
  }

  recruit() {
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
    const token = {
      id: this.nextId('u'),
      type: order[index],
      level: 1,
      place: 'bench',
      slot,
    };
    this.tokens.push(token);
    return { ok: true, token };
  }

  drop(tokenId, place, slot) {
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

  previewDrop(tokenId, place, slot) {
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

  placeGuideToken(type, place, slot) {
    if (this.phase !== 'playing' || !this.config.units.types[type]) {
      return null;
    }
    if (slot < 0 || slot >= this.slotCount(place)) {
      return null;
    }
    if (this.tokens.some((entry) => entry.place === place && entry.slot === slot)) {
      return null;
    }
    const token = {
      id: this.nextId('u'),
      type,
      level: 1,
      place,
      slot,
    };
    this.tokens.push(token);
    return token;
  }

  tick(dt) {
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
    this.tickEnemyShots(dt);
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

  resetState() {
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
    this.enemyShots = [];
    this.floats = [];
    this.seq = 1;
    this.kindSerial = 0;
    this.spawnCooldown = 0;
    this.cooldown.clear();
    this.lanes = boardLanes(this.config.board).map((points) => buildPath(points));
  }

  laneOf(enemy) {
    return this.lanes[enemy.lane] ?? this.lanes[0];
  }

  nextId(prefix) {
    const id = `${prefix}${this.seq}`;
    this.seq += 1;
    return id;
  }

  slotCount(place) {
    const board = this.config.board;
    return place === 'grid' ? board.gridCols * board.gridRows : board.benchSlots;
  }

  firstEmpty(place) {
    const used = new Set(this.tokens.filter((token) => token.place === place).map((token) => token.slot));
    const count = this.slotCount(place);
    for (let i = 0; i < count; i += 1) {
      if (!used.has(i)) {
        return i;
      }
    }
    return -1;
  }

  spawnPending(dt) {
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

  spawnEnemy(wave) {
    const kind = ENEMY_KINDS[this.kindSerial % ENEMY_KINDS.length];
    this.kindSerial += 1;
    const lane = (wave.id + this.spawnedInWave) % Math.max(1, this.lanes.length);
    const road = this.lanes[lane] ?? this.lanes[0];
    const point = pointOnPath(road, 0);
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
      kind: kind.id,
      lane,
      planted: false,
      windup: 0,
      released: false,
      face: -Math.PI / 2,
    });
  }

  tickAttacks(dt) {
    const active = new Set();
    for (const token of this.tokens) {
      if (token.place !== 'grid') {
        continue;
      }
      active.add(token.id);
      const stat = this.statOf(token.type, token.level);
      const readyIn = (this.cooldown.get(token.id) ?? 0) - dt;
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

  nearestEnemy(x, y, range) {
    let best = null;
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

  tickShots(dt) {
    const hitRadius = this.config.board.hitRadius;
    const kept = [];
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
        shot.x = target.x;
        shot.y = target.y;
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

  applyDamage(enemy, amount) {
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

  tickEnemies(dt) {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0) {
        continue;
      }
      const road = this.laneOf(enemy);
      if (enemyKind(enemy.kind).style === 'ranged') {
        const remain = road.total - enemy.distance;
        if (!enemy.released && remain <= SHI_STANDOFF) {
          if (!enemy.planted) {
            enemy.planted = true;
            enemy.distance = Math.max(0, road.total - SHI_STANDOFF);
            const planted = pointOnPath(road, enemy.distance);
            enemy.x = planted.x;
            enemy.y = planted.y;
            enemy.windup = 0;
          }
          enemy.windup += dt;
          if (enemy.windup >= SHI_WINDUP) {
            this.releaseShi(enemy);
          }
          continue;
        }
      }
      const prevX = enemy.x;
      const prevY = enemy.y;
      enemy.distance += enemy.speed * dt;
      if (enemy.distance >= road.total) {
        this.leak(enemy);
      } else {
        const point = pointOnPath(road, enemy.distance);
        enemy.x = point.x;
        enemy.y = point.y;
        if (Math.hypot(enemy.x - prevX, enemy.y - prevY) > 0.01) {
          enemy.face = Math.atan2(enemy.y - prevY, enemy.x - prevX);
        }
      }
    }
  }

  releaseShi(enemy) {
    if (enemy.released || enemy.hp <= 0) {
      return;
    }
    enemy.released = true;
    const road = this.laneOf(enemy);
    const end = road.points[road.points.length - 1];
    const remain = Math.max(0, road.total - enemy.distance);
    const walkTime = remain / Math.max(1, enemy.speed);
    const flightTime = Math.max(0.16, walkTime - SHI_WINDUP);
    const dist = Math.max(1, Math.hypot(end.x - enemy.x, end.y - enemy.y));
    this.enemyShots.push({
      id: this.nextId('a'),
      x: enemy.x,
      y: enemy.y,
      fromX: enemy.x,
      fromY: enemy.y,
      targetX: end.x,
      targetY: end.y,
      damage: enemy.damage,
      speed: dist / flightTime,
      ink: enemyKind(enemy.kind).ink,
      age: 0,
    });
    enemy.hp = 0;
  }

  tickEnemyShots(dt) {
    const hitRadius = this.config.board.hitRadius;
    const kept = [];
    for (const shot of this.enemyShots) {
      const dx = shot.targetX - shot.x;
      const dy = shot.targetY - shot.y;
      const dist = Math.hypot(dx, dy);
      const step = shot.speed * dt;
      shot.age += dt;
      if (dist <= step || dist <= hitRadius) {
        shot.x = shot.targetX;
        shot.y = shot.targetY;
        this.adouHp = Math.max(0, this.adouHp - shot.damage);
        this.leakCount += 1;
        this.pushFloat(shot.targetX, shot.targetY + 36, `-${shot.damage}`);
      } else {
        shot.x += (dx / dist) * step;
        shot.y += (dy / dist) * step;
        kept.push(shot);
      }
    }
    this.enemyShots = kept;
  }

  leak(enemy) {
    const road = this.laneOf(enemy);
    const end = road.points[road.points.length - 1];
    enemy.x = end.x;
    enemy.y = end.y;
    this.adouHp = Math.max(0, this.adouHp - enemy.damage);
    this.leakCount += 1;
    this.pushFloat(end.x, end.y + 36, `-${enemy.damage}`);
    enemy.hp = 0;
  }

  maybeAdvanceWave() {
    if (this.phase !== 'playing' || this.betweenWaves) {
      return;
    }
    const waves = this.config.waves.waves;
    if (this.waveCursor >= waves.length) {
      return;
    }
    const wave = waves[this.waveCursor];
    if (this.spawnedInWave < wave.count || this.enemies.length > 0 || this.enemyShots.length > 0) {
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

  tickFloats(dt) {
    for (const floater of this.floats) {
      floater.age += dt;
    }
    this.floats = this.floats.filter((floater) => floater.age < 0.7);
  }

  pushFloat(x, y, text) {
    this.floats.push({ id: this.nextId('f'), x, y, text, age: 0 });
    if (this.floats.length > 20) {
      this.floats.shift();
    }
  }
}
