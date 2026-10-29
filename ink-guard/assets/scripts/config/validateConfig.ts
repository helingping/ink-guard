import type {
  AdouConfig,
  AttackStyle,
  BoardConfig,
  BoardPoint,
  EconomyConfig,
  FoeTypeConfig,
  FoesConfig,
  GameConfig,
  LevelStat,
  UnitTypeConfig,
  UnitsConfig,
  WaveDef,
  WavesConfig,
} from './ConfigTypes';

function fail(file: string, message: string): never {
  throw new Error(`${file}：${message}`);
}

function asRecord(value: unknown, file: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, '必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function needNumber(obj: Record<string, unknown>, key: string, file: string): number {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(file, `${key} 必须是有限数字`);
  }
  return value;
}

function needString(obj: Record<string, unknown>, key: string, file: string): string {
  const value = obj[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(file, `${key} 必须是非空字符串`);
  }
  return value;
}

function needArray(obj: Record<string, unknown>, key: string, file: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) {
    fail(file, `${key} 必须是数组`);
  }
  return value;
}

function needPoint(value: unknown, file: string): BoardPoint {
  const obj = asRecord(value, file);
  return { x: needNumber(obj, 'x', file), y: needNumber(obj, 'y', file) };
}

function parsePolyline(value: unknown, file: string, label: string): BoardPoint[] {
  if (!Array.isArray(value) || value.length < 2) {
    fail(file, `${label} 至少要有两个点`);
  }
  return value.map((entry) => needPoint(entry, file));
}

function parseUnits(raw: unknown): UnitsConfig {
  const file = 'units.json';
  const obj = asRecord(raw, file);
  const maxLevel = needNumber(obj, 'maxLevel', file);
  if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 9) {
    fail(file, 'maxLevel 必须是 1 到 9 的整数');
  }
  const orderRaw = needArray(obj, 'order', file);
  const order = orderRaw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(file, `order[${index}] 必须是字令 id`);
    }
    return entry;
  });
  if (new Set(order).size !== order.length) {
    fail(file, 'order 里有重复字令');
  }
  const typesRaw = asRecord(obj.types, file);
  const types: Record<string, UnitTypeConfig> = {};
  for (const id of order) {
    if (!(id in typesRaw)) {
      fail(file, `缺少字令 ${id}`);
    }
    const entry = asRecord(typesRaw[id], file);
    const levelsRaw = needArray(entry, 'levels', file);
    const byLevel: LevelStat[] = new Array(maxLevel + 1);
    const seen = new Set<number>();
    for (const levelRaw of levelsRaw) {
      const levelObj = asRecord(levelRaw, file);
      const level = needNumber(levelObj, 'level', file);
      const atk = needNumber(levelObj, 'atk', file);
      const aspd = needNumber(levelObj, 'aspd', file);
      const range = needNumber(levelObj, 'range', file);
      const hp = needNumber(levelObj, 'hp', file);
      if (!Number.isInteger(level) || level < 1 || level > maxLevel) {
        fail(file, `${id} 的 level ${level} 超出 1..${maxLevel}`);
      }
      if (seen.has(level)) {
        fail(file, `${id} 的 ${level} 品重复了`);
      }
      if (atk < 0 || aspd <= 0 || range <= 0 || hp <= 0) {
        fail(file, `${id} ${level} 品的 atk/aspd/range/hp 不合法`);
      }
      seen.add(level);
      byLevel[level] = { level, atk, aspd, range, hp };
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
      style: style as AttackStyle,
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

function parseFoes(raw: unknown, units: UnitsConfig): FoesConfig {
  const file = 'foes.json';
  const obj = asRecord(raw, file);
  const orderRaw = needArray(obj, 'order', file);
  const order = orderRaw.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(file, `order[${index}] 必须是墨寇 id`);
    }
    return entry;
  });
  if (order.length === 0 || new Set(order).size !== order.length) {
    fail(file, 'order 不能空，也不能重复');
  }
  const typesRaw = asRecord(obj.types, file);
  const types: Record<string, FoeTypeConfig> = {};
  for (const id of order) {
    if (!(id in typesRaw)) {
      fail(file, `缺少墨寇 ${id}`);
    }
    const entry = asRecord(typesRaw[id], file);
    const vfxId = needString(entry, 'vfx', file);
    const vfx = units.types[vfxId];
    if (!vfx) {
      fail(file, `${id} 的 vfx 必须是已有字令`);
    }
    const ink = needString(entry, 'ink', file);
    if (!/^#[0-9a-fA-F]{6}$/.test(ink)) {
      fail(file, `${id} 的 ink 必须是 #RRGGBB`);
    }
    const atk = needNumber(entry, 'atk', file);
    const aspd = needNumber(entry, 'aspd', file);
    if (atk <= 0 || aspd <= 0) {
      fail(file, `${id} 的 atk/aspd 必须大于 0`);
    }
    const level1 = vfx.byLevel[1];
    types[id] = {
      id,
      displayName: needString(entry, 'displayName', file),
      glyph: needString(entry, 'glyph', file),
      ink,
      style: vfx.style,
      motion: vfx.motion,
      styleLabel: vfx.styleLabel,
      motionLabel: vfx.motionLabel,
      strike: vfx.strike,
      shotSpeed: vfx.shotSpeed,
      range: level1.range,
      atk,
      aspd,
      vfx: vfxId,
    };
  }
  const extra = Object.keys(typesRaw).filter((id) => !order.includes(id));
  if (extra.length > 0) {
    fail(file, `order 未列出 ${extra.join(', ')}`);
  }
  if (!order.some((id) => types[id].style === 'melee') || !order.some((id) => types[id].style === 'ranged')) {
    fail(file, '墨寇里要同时有近战和远程，远程复用字令的 shotSpeed');
  }
  return { order, types };
}

function parseEconomy(raw: unknown): EconomyConfig {
  const file = 'economy.json';
  const obj = asRecord(raw, file);
  const economy: EconomyConfig = {
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

function parseAdou(raw: unknown): AdouConfig {
  const file = 'adou.json';
  const obj = asRecord(raw, file);
  const maxHp = needNumber(obj, 'maxHp', file);
  if (maxHp <= 0) {
    fail(file, 'maxHp 必须大于 0');
  }
  return { maxHp, name: needString(obj, 'name', file) };
}

function parseWaves(raw: unknown): WavesConfig {
  const file = 'waves.json';
  const obj = asRecord(raw, file);
  const firstDelay = needNumber(obj, 'firstDelay', file);
  const gapSeconds = needNumber(obj, 'gapSeconds', file);
  if (firstDelay < 0 || gapSeconds < 0) {
    fail(file, '备波时间不能为负');
  }
  const waves = needArray(obj, 'waves', file).map((entry, index) => {
    const waveObj = asRecord(entry, file);
    let roster: string[] = [];
    if (waveObj.roster !== undefined) {
      const rosterRaw = waveObj.roster;
      if (!Array.isArray(rosterRaw) || rosterRaw.length === 0) {
        fail(file, `第 ${index + 1} 波 roster 必须是非空数组`);
      }
      roster = rosterRaw.map((entry, rosterIndex) => {
        if (typeof entry !== 'string' || entry.trim() === '') {
          fail(file, `第 ${index + 1} 波 roster[${rosterIndex}] 必须是墨寇 id`);
        }
        return entry;
      });
    }
    const wave: WaveDef = {
      id: needNumber(waveObj, 'id', file),
      count: needNumber(waveObj, 'count', file),
      hp: needNumber(waveObj, 'hp', file),
      speed: needNumber(waveObj, 'speed', file),
      damage: needNumber(waveObj, 'damage', file),
      interval: needNumber(waveObj, 'interval', file),
      roster,
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

function inside(board: BoardConfig, point: BoardPoint, pad: number, file: string, label: string): void {
  const limitX = board.designWidth / 2 - pad;
  const limitY = board.designHeight / 2 - pad;
  if (Math.abs(point.x) > limitX || Math.abs(point.y) > limitY) {
    fail(file, `${label} (${point.x}, ${point.y}) 超出设计分辨率`);
  }
}

function parseBoard(raw: unknown): BoardConfig {
  const file = 'board.json';
  const obj = asRecord(raw, file);
  const board: BoardConfig = {
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
  board.lanes = lanes ?? [explicitPath as BoardPoint[]];
  if (board.lanes.length < 1) {
    fail(file, '至少要有一条墨路');
  }
  const seal = board.lanes[0][board.lanes[0].length - 1];
  for (let i = 1; i < board.lanes.length; i += 1) {
    const end = board.lanes[i][board.lanes[i].length - 1];
    if (Math.hypot(end.x - seal.x, end.y - seal.y) > 1) {
      fail(file, '各条墨路必须汇入同一个终点');
    }
  }
  board.path = board.lanes[Math.min(1, board.lanes.length - 1)];
  if (obj.river !== undefined) {
    const river = asRecord(obj.river, file);
    const rect = {
      x: needNumber(river, 'x', file),
      y: needNumber(river, 'y', file),
      w: needNumber(river, 'w', file),
      h: needNumber(river, 'h', file),
    };
    if (rect.w <= 0 || rect.h <= 0) {
      fail(file, 'river 宽高必须大于 0');
    }
    board.river = rect;
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

function linkFoes(waves: WavesConfig, foes: FoesConfig): void {
  const known = new Set(foes.order);
  for (const wave of waves.waves) {
    for (const id of wave.roster) {
      if (!known.has(id)) {
        fail('waves.json', `roster 里的 ${id} 不是墨寇`);
      }
    }
  }
}

export function normalizeConfig(raw: unknown): GameConfig {
  const root = asRecord(raw, 'configs');
  const units = parseUnits(root.units);
  const foes = parseFoes(root.foes, units);
  const waves = parseWaves(root.waves);
  linkFoes(waves, foes);
  return {
    units,
    foes,
    economy: parseEconomy(root.economy),
    adou: parseAdou(root.adou),
    waves,
    board: parseBoard(root.board),
  };
}
