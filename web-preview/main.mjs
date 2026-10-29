import {
  GameSim,
  SHI_WINDUP,
  benchPosition,
  dropSlotAt,
  enemyKind,
  gridPosition,
  normalizeConfig,
  tokenPosition,
} from './sim.mjs';

const GUIDE_KEY = 'ink-guard-merge-guide';
const HINT = '北营沿墨路南下。刀骑守前排，枪靠前，弓放后排。点空处取消射程。';
const GUIDE_HINT = '把两枚「刀」叠在一起。升品后圈纹会变。点空处可取消射程。';
const RANK = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const MARK = { move: '#2f6b4f', merge: '#c6a15a', swap: '#3d6f8a' };
const SCRIPT_SRC = document.currentScript?.src || '';
const CDN_REFS = ['cursor/h5-web-preview-232e', 'main'];
const CONFIG_FILES = ['units', 'economy', 'adou', 'waves', 'board'];

function cdn(ref, path) {
  return `https://cdn.jsdelivr.net/gh/helingping/ink-guard@${ref}/${path}`;
}

function resourceBases() {
  const bases = [];
  if (SCRIPT_SRC) {
    bases.push(new URL('../ink-guard/assets/resources/', SCRIPT_SRC).href);
  }
  for (const ref of CDN_REFS) {
    bases.push(cdn(ref, 'ink-guard/assets/resources/'));
  }
  return bases;
}

function configBases() {
  const bases = [];
  if (SCRIPT_SRC) {
    bases.push(new URL('../ink-guard/assets/resources/configs/', SCRIPT_SRC).href);
    bases.push(new URL('./configs/', SCRIPT_SRC).href);
  }
  for (const ref of CDN_REFS) {
    bases.push(cdn(ref, 'ink-guard/assets/resources/configs/'));
    bases.push(cdn(ref, 'web-preview/configs/'));
  }
  return bases;
}

const stage = document.querySelector('#stage');
const canvas = document.querySelector('#board');
const ctx = canvas.getContext('2d');
const ui = {
  loading: document.querySelector('#loading'),
  loadingText: document.querySelector('#loading-text'),
  title: document.querySelector('#title'),
  wave: document.querySelector('#wave'),
  kinds: document.querySelector('#kinds'),
  hpText: document.querySelector('#hp-text'),
  hpFill: document.querySelector('#hp-fill'),
  mantou: document.querySelector('#mantou'),
  recruit: document.querySelector('#recruit'),
  speed: document.querySelector('#speed'),
  hint: document.querySelector('#hint'),
  banner: document.querySelector('#banner'),
  tutorial: document.querySelector('#tutorial'),
  tutorialOk: document.querySelector('#tutorial-ok'),
  overlay: document.querySelector('#overlay'),
  overlayTitle: document.querySelector('#overlay-title'),
  overlayBody: document.querySelector('#overlay-body'),
  restart: document.querySelector('#restart'),
};

const art = {
  paper: null,
  mountain: null,
  bamboo: null,
  cell: null,
  seal: null,
  river: null,
  arrow: null,
  units: {},
  pose: {},
  fx: {},
};
const poses = new Map();
const impacts = [];
let config = null;
let sim = null;
let timeScale = 1;
let toast = '';
let toastTimer = 0;
let guidePending = false;
let drag = null;
let selectedId = null;
let lastFrame = 0;
let clock = 0;
let shownPhase = 'playing';
let reduceMotion = false;

function seed() {
  return Date.now() % 2147483647;
}

function guideSeen() {
  try {
    return localStorage.getItem(GUIDE_KEY) === '1';
  } catch {
    return false;
  }
}

function completeGuide() {
  guidePending = false;
  ui.tutorial.hidden = true;
  try {
    localStorage.setItem(GUIDE_KEY, '1');
  } catch {
    /* the card still stays hidden for this visit */
  }
}

function grantGuide() {
  sim?.placeGuideToken('dao', 'bench', 0);
  sim?.placeGuideToken('dao', 'bench', 1);
  ui.tutorial.hidden = false;
}

function showToast(message) {
  toast = message;
  toastTimer = 1.8;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`missing ${url}`);
  }
  return response.json();
}

async function loadConfig() {
  let lastError = null;
  for (const base of configBases()) {
    try {
      const raw = {};
      for (const name of CONFIG_FILES) {
        raw[name] = await fetchJson(new URL(`${name}.json`, base));
      }
      return normalizeConfig(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('missing ') || error instanceof SyntaxError || error instanceof TypeError) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  if (globalThis.INK_GUARD_CONFIGS) {
    return normalizeConfig(globalThis.INK_GUARD_CONFIGS);
  }
  throw lastError ?? new Error('configs missing');
}

function loadImage(path) {
  const bases = resourceBases();
  return new Promise((resolve) => {
    const tryNext = (index) => {
      if (index >= bases.length) {
        resolve(null);
        return;
      }
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => tryNext(index + 1);
      image.src = new URL(path, bases[index]).href;
    };
    tryNext(0);
  });
}

function knockOutBlack(image) {
  if (!image) {
    return null;
  }
  try {
    const surface = document.createElement('canvas');
    surface.width = image.naturalWidth || image.width;
    surface.height = image.naturalHeight || image.height;
    const g = surface.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0);
    const corner = g.getImageData(0, 0, 1, 1).data;
    if (corner[0] > 28 || corner[1] > 28 || corner[2] > 28) {
      return image;
    }
    const pixels = g.getImageData(0, 0, surface.width, surface.height);
    const data = pixels.data;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      if (max < 22) {
        data[i + 3] = 0;
      } else if (max < 64) {
        data[i + 3] = Math.min(data[i + 3], Math.floor(((max - 22) * 255) / 42));
      }
    }
    g.putImageData(pixels, 0, 0);
    return surface;
  } catch {
    return null;
  }
}

async function loadArt() {
  const [paper, mountain, cell, seal, river, arrow] = await Promise.all([
    loadImage('textures/bg-paper.png'),
    loadImage('textures/mountain-top.png'),
    loadImage('textures/cell.png'),
    loadImage('textures/seal-adou.png'),
    loadImage('textures/river.png'),
    loadImage('fx/gong-arrow.png'),
  ]);
  art.paper = paper;
  art.mountain = mountain;
  art.cell = cell;
  art.seal = seal;
  art.river = river;
  art.arrow = knockOutBlack(arrow);
  await Promise.all(
    config.units.order.map(async (id) => {
      art.units[id] = await loadImage(`textures/unit-${id}.png`);
      const poseFrames = await Promise.all([0, 1, 2, 3].map((frame) => loadImage(`pose/${id}-${frame}.png`)));
      const fxFrames = await Promise.all([0, 1, 2, 3].map((frame) => loadImage(`fx/${id}-${frame}.png`)));
      art.pose[id] = poseFrames.map(knockOutBlack).filter(Boolean);
      art.fx[id] = fxFrames.map(knockOutBlack).filter(Boolean);
    }),
  );
}

function resize() {
  if (!config) {
    return;
  }
  const board = config.board;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(board.designWidth * dpr);
  canvas.height = Math.round(board.designHeight * dpr);
  ctx.setTransform(canvas.width / board.designWidth, 0, 0, canvas.height / board.designHeight, 0, 0);
}

function toScreen(x, y) {
  const board = config.board;
  return {
    x: board.designWidth / 2 + x,
    y: board.designHeight / 2 - y,
  };
}

function clientToBoard(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const board = config.board;
  const x = ((clientX - rect.left) / rect.width) * board.designWidth;
  const y = ((clientY - rect.top) / rect.height) * board.designHeight;
  return { x: x - board.designWidth / 2, y: board.designHeight / 2 - y };
}

function roundRect(x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hexAlpha(hex, alpha) {
  const value = hex.replace('#', '');
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function font(size, title) {
  const family = title
    ? '"Ink Title", "Songti SC", "STKaiti", "KaiTi", serif'
    : '"PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
  return `${size}px ${family}`;
}

function paintPlate(text, y, size) {
  ctx.font = font(size, false);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const width = Math.min(78, ctx.measureText(text).width + 10);
  ctx.fillStyle = 'rgba(247, 241, 228, 0.9)';
  roundRect(-width / 2, y - size / 2 - 2, width, size + 4, 6);
  ctx.fill();
  ctx.fillStyle = '#4a3728';
  ctx.fillText(text, 0, y);
}

function tokenAt(x, y) {
  let best = null;
  let bestD = 46;
  for (const token of sim.tokens) {
    const pos = tokenPosition(config, token);
    const d = Math.hypot(pos.x - x, pos.y - y);
    if (d <= bestD) {
      bestD = d;
      best = token;
    }
  }
  return best;
}

function clearSelection() {
  selectedId = null;
}

function onPointerDown(event) {
  if (!sim || sim.phase !== 'playing' || drag) {
    return;
  }
  const point = clientToBoard(event.clientX, event.clientY);
  const token = tokenAt(point.x, point.y);
  if (!token) {
    clearSelection();
    return;
  }
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  selectedId = token.id;
  drag = {
    id: token.id,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    x: point.x,
    y: point.y,
  };
}

function onPointerMove(event) {
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  event.preventDefault();
  const point = clientToBoard(event.clientX, event.clientY);
  drag.x = point.x;
  drag.y = point.y;
}

function onPointerUp(event) {
  if (!drag || event.pointerId !== drag.pointerId) {
    return;
  }
  const point = clientToBoard(event.clientX, event.clientY);
  const tokenId = drag.id;
  drag = null;
  const slot = dropSlotAt(config.board, point.x, point.y);
  if (!slot) {
    return;
  }
  const result = sim.drop(tokenId, slot.place, slot.slot);
  if (!result.ok) {
    showToast(result.reason === 'max-level' ? '已是最高品' : '这里放不下');
    return;
  }
  if (result.action === 'merge' && guidePending) {
    completeGuide();
  }
}

function recruit() {
  clearSelection();
  if (!sim || sim.phase !== 'playing' || drag) {
    return;
  }
  const result = sim.recruit();
  if (!result.ok) {
    showToast(result.reason === 'broke' ? '馒头不够' : '席位已满');
  }
}

function toggleSpeed() {
  clearSelection();
  if (!sim) {
    return;
  }
  timeScale = timeScale === 1 ? 3 : 1;
  ui.speed.textContent = timeScale === 1 ? '常速' : '三倍';
}

function restart() {
  if (!sim) {
    return;
  }
  drag = null;
  clearSelection();
  timeScale = 1;
  ui.speed.textContent = '常速';
  toastTimer = 0;
  shownPhase = 'playing';
  impacts.length = 0;
  poses.clear();
  sim.reset(seed());
  ui.overlay.hidden = true;
  if (guidePending) {
    grantGuide();
  } else {
    ui.tutorial.hidden = true;
  }
}

function updateHud() {
  if (!sim || !config) {
    return;
  }
  const hp = Math.max(0, Math.round(sim.adouHp));
  const maxHp = config.adou.maxHp;
  ui.hpText.textContent = `阿斗 ${hp}/${maxHp}`;
  ui.hpFill.style.width = `${maxHp <= 0 ? 0 : (hp / maxHp) * 100}%`;
  ui.mantou.textContent = `馒头 ${Math.floor(sim.mantou)}  +${config.economy.incomePerSecond}/秒`;
  const cost = sim.nextCost();
  ui.recruit.textContent = `招募 ${cost}`;
  const ready = sim.phase === 'playing' && sim.mantou >= cost && sim.hasBenchRoom();
  ui.recruit.classList.toggle('is-muted', !ready);
  const head = `第 ${sim.waveNumber} / ${sim.waveTotal} 波`;
  if (sim.phase !== 'playing') {
    ui.wave.textContent = head;
  } else if (sim.betweenWaves) {
    ui.wave.textContent = `${head} · 备墨 ${Math.ceil(sim.betweenTimer)}s`;
  } else {
    ui.wave.textContent = `${head} · 来敌 ${sim.enemies.length}`;
  }
  ui.hint.textContent = toastTimer > 0 ? toast : guidePending ? GUIDE_HINT : HINT;
  ui.hint.classList.toggle('is-alert', toastTimer > 0);
  const showBanner = sim.phase === 'playing' && sim.bannerTimer > 0;
  ui.banner.hidden = !showBanner;
  if (showBanner) {
    ui.banner.textContent = sim.banner;
    ui.banner.style.opacity = String(Math.min(1, sim.bannerTimer / 0.25));
  }
  if (sim.phase !== 'playing' && shownPhase !== sim.phase) {
    shownPhase = sim.phase;
    ui.overlay.hidden = false;
    if (sim.phase === 'win') {
      ui.overlayTitle.textContent = '墨阵已稳';
      ui.overlayBody.textContent = `守住了全部 ${sim.waveTotal} 波，阿斗还剩 ${hp} 点气血。`;
    } else {
      ui.overlayTitle.textContent = '墨阵破了';
      ui.overlayBody.textContent = '阿斗气血见底。重整旗鼓，再守一阵。';
    }
  }
}

function drawBackground() {
  const { designWidth: w, designHeight: h } = config.board;
  if (art.paper) {
    ctx.drawImage(art.paper, 0, 0, w, h);
  } else {
    const wash = ctx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, '#f7efd8');
    wash.addColorStop(1, '#e7d3ae');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
  }
  if (art.mountain) {
    const band = 340;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.drawImage(art.mountain, 0, 0, w, band);
    const fade = ctx.createLinearGradient(0, band * 0.35, 0, band);
    fade.addColorStop(0, 'rgba(243, 230, 200, 0)');
    fade.addColorStop(1, 'rgba(243, 230, 200, 0.92)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, band);
    ctx.restore();
  }
}

function traceLane(lane) {
  lane.forEach((point, index) => {
    const screen = toScreen(point.x, point.y);
    if (index === 0) {
      ctx.moveTo(screen.x, screen.y);
    } else {
      ctx.lineTo(screen.x, screen.y);
    }
  });
}

function drawRiver() {
  const river = config.board.river;
  if (art.river && river) {
    const top = toScreen(river.x - river.w / 2, river.y + river.h / 2);
    ctx.drawImage(art.river, top.x, top.y, river.w, river.h);
  }
  const lanes = config.board.lanes?.length ? config.board.lanes : [config.board.path];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const lane of lanes) {
    ctx.beginPath();
    traceLane(lane);
    ctx.strokeStyle = 'rgba(79, 124, 144, 0.34)';
    ctx.lineWidth = 26;
    ctx.stroke();
    ctx.beginPath();
    traceLane(lane);
    ctx.strokeStyle = 'rgba(247, 241, 228, 0.9)';
    ctx.lineWidth = 9;
    ctx.stroke();
  }
  ctx.restore();
}

function drawSlot(x, y, size) {
  if (art.cell) {
    ctx.drawImage(art.cell, x - size / 2, y - size / 2, size, size);
    return;
  }
  roundRect(x - size / 2, y - size / 2, size, size, 8);
  ctx.fillStyle = 'rgba(255, 250, 240, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(74, 55, 40, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawBoard() {
  const board = config.board;
  const count = board.gridCols * board.gridRows;
  for (let i = 0; i < count; i += 1) {
    const pos = gridPosition(board, i);
    const screen = toScreen(pos.x, pos.y);
    drawSlot(screen.x, screen.y, board.cellSize);
  }
  for (let i = 0; i < board.benchSlots; i += 1) {
    const pos = benchPosition(board, i);
    const screen = toScreen(pos.x, pos.y);
    drawSlot(screen.x, screen.y, board.cellSize - 6);
  }
}

function drawCamp() {
  const camp = config.board.camp;
  if (!camp) {
    return;
  }
  const screen = toScreen(camp.x, camp.y);
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.beginPath();
  ctx.arc(0, 0, 32, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244, 239, 228, 0.94)';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#243044';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#243044';
  ctx.font = font(30, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(247, 241, 228, 0.95)';
  ctx.strokeText('寇', 0, 1);
  ctx.fillText('寇', 0, 1);
  paintPlate('北营', 46, 15);
  ctx.restore();
}

function drawSeal() {
  drawCamp();
  const end = config.board.path[config.board.path.length - 1];
  const screen = toScreen(end.x, end.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, 34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(141, 46, 42, 0.12)';
  ctx.fill();
  if (art.seal) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 32, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(art.seal, screen.x - 32, screen.y - 32, 64, 64);
    ctx.restore();
  } else {
    ctx.fillStyle = '#f4efe4';
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#8d2e2a';
    ctx.stroke();
    ctx.fillStyle = '#8d2e2a';
    ctx.font = font(28, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('斗', screen.x, screen.y + 1);
  }
  ctx.restore();
}

function drawMarks() {
  if (!drag) {
    return;
  }
  const active = dropSlotAt(config.board, drag.x, drag.y);
  const places = [
    ['grid', config.board.gridCols * config.board.gridRows],
    ['bench', config.board.benchSlots],
  ];
  for (const [place, count] of places) {
    for (let slot = 0; slot < count; slot += 1) {
      const kind = sim.previewDrop(drag.id, place, slot);
      if (kind !== 'move' && kind !== 'merge' && kind !== 'swap') {
        continue;
      }
      const pos = place === 'grid' ? gridPosition(config.board, slot) : benchPosition(config.board, slot);
      const screen = toScreen(pos.x, pos.y);
      const hot = active && active.place === place && active.slot === slot;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, config.board.cellSize / 2 + (hot ? 6 : 2), 0, Math.PI * 2);
      ctx.strokeStyle = MARK[kind];
      ctx.globalAlpha = hot ? 0.95 : 0.55;
      ctx.lineWidth = hot ? 5 : 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

function tierScaleOf(level) {
  if (level >= 4) {
    return 1.36;
  }
  if (level >= 3) {
    return 1.22;
  }
  if (level >= 2) {
    return 1.1;
  }
  return 1;
}

function tierTintOf(level) {
  if (level >= 4) {
    return 'rgba(255, 213, 106, 0.55)';
  }
  if (level >= 3) {
    return 'rgba(255, 208, 180, 0.4)';
  }
  if (level >= 2) {
    return 'rgba(255, 241, 228, 0.28)';
  }
  return null;
}

function drawTier(level, ink) {
  const rings = Math.min(4, Math.max(1, level));
  const gold = level >= 4 ? '#c6a15a' : ink;
  for (let i = 0; i < rings; i += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, 30 + i * 5, 0, Math.PI * 2);
    ctx.lineWidth = i === rings - 1 ? 2.2 + level : 1.4;
    ctx.strokeStyle = i === rings - 1 ? gold : ink;
    ctx.globalAlpha = i === rings - 1 ? 0.95 : 0.65;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (level >= 2) {
    const orbit = 26 + rings * 5;
    ctx.fillStyle = gold;
    for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      ctx.beginPath();
      ctx.arc(sx * orbit * 0.7, sy * orbit * 0.7, level >= 3 ? 3.2 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (level >= 3) {
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = gold;
    ctx.stroke();
  }
}

function drawRange() {
  const id = drag?.id ?? selectedId;
  if (!id) {
    return;
  }
  const token = sim.tokens.find((entry) => entry.id === id);
  if (!token) {
    selectedId = null;
    return;
  }
  const stat = sim.statOf(token.type, token.level);
  const type = config.units.types[token.type];
  const at = drag ? { x: drag.x, y: drag.y } : tokenPosition(config, token);
  const screen = toScreen(at.x, at.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, stat.range, 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(type.ink, 0.45);
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, Math.max(4, stat.range - 8), 0, Math.PI * 2);
  ctx.strokeStyle = hexAlpha(type.ink, 0.18);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawToken(token, at) {
  const type = config.units.types[token.type];
  const size = token.place === 'bench' ? 74 : 84;
  const pose = poses.get(token.id);
  const frames = art.pose[token.type] ?? [];
  let sprite = art.units[token.type];
  if (pose && frames.length > 0) {
    const index = Math.min(frames.length - 1, Math.floor((pose.t / pose.dur) * frames.length));
    sprite = frames[index];
  }
  ctx.save();
  ctx.translate(at.x, at.y);
  const scale = tierScaleOf(token.level) * (drag && drag.id === token.id ? 1.08 : 1);
  ctx.scale(scale, scale);
  if (!sprite) {
    ctx.beginPath();
    ctx.arc(0, 0, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = type.ink;
    ctx.fill();
    ctx.fillStyle = '#f7f1e4';
    ctx.font = font(36, true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(type.glyph, 0, 2);
  } else {
    roundRect(-size / 2, -size / 2, size, size, 10);
    ctx.save();
    ctx.clip();
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
    ctx.strokeStyle = hexAlpha(type.ink, 0.85);
    ctx.lineWidth = token.level >= 3 ? 4 : 2;
    roundRect(-size / 2, -size / 2, size, size, 10);
    ctx.stroke();
    const wash = tierTintOf(token.level);
    if (wash) {
      ctx.fillStyle = wash;
      ctx.fill();
    }
  }
  drawTier(token.level, type.ink);
  paintPlate(`${type.styleLabel}·${type.motionLabel}`, -size / 2 + 12, 11);
  paintPlate(`${RANK[token.level] ?? token.level}品`, size / 2 - 12, 12);
  ctx.restore();
}

function drawTokens() {
  const ghost = drag && drag.pointerType === 'touch' ? { x: drag.x, y: drag.y + 64 } : drag;
  for (const token of sim.tokens) {
    if (drag && token.id === drag.id) {
      continue;
    }
    const pos = tokenPosition(config, token);
    drawToken(token, toScreen(pos.x, pos.y));
  }
  if (drag) {
    const token = sim.tokens.find((entry) => entry.id === drag.id);
    if (token && ghost) {
      drawToken(token, toScreen(ghost.x, ghost.y));
    }
  }
}

function drawEnemy(enemy, index) {
  const kind = enemyKind(enemy.kind);
  const bob = reduceMotion || enemy.planted ? 0 : Math.sin(clock * 3 + index) * 2;
  const screen = toScreen(enemy.x, enemy.y + bob);
  ctx.save();
  ctx.translate(screen.x, screen.y);
  const radius = kind.style === 'ranged' ? 24 : 22;
  const blot = ctx.createRadialGradient(0, 0, 4, 0, 0, radius);
  blot.addColorStop(0, hexAlpha(kind.ink, 0.95));
  blot.addColorStop(1, hexAlpha(kind.ink, 0.15));
  ctx.fillStyle = blot;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(247, 241, 228, 0.85)';
  ctx.stroke();
  if (kind.id === 'mao') {
    ctx.strokeStyle = '#f7f1e4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-16, 8);
    ctx.lineTo(16, -10);
    ctx.stroke();
  }
  if (kind.style === 'ranged') {
    ctx.strokeStyle = '#f7f1e4';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(-2, 2, 12, Math.PI * 0.15, Math.PI * 1.15);
    ctx.stroke();
    if (enemy.planted) {
      const pull = Math.min(1, enemy.windup / SHI_WINDUP);
      ctx.globalAlpha = 0.35 + pull * 0.65;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 4 + pull * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = '#f7f1e4';
  ctx.font = font(22, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(kind.glyph, 0, 1);
  ctx.font = font(11, false);
  ctx.fillText(kind.styleLabel, 0, radius + 10);
  const ratio = enemy.maxHp <= 0 ? 0 : Math.max(0, enemy.hp) / enemy.maxHp;
  ctx.fillStyle = 'rgba(29, 43, 56, 0.35)';
  ctx.fillRect(-16, -radius - 8, 32, 4);
  ctx.fillStyle = ratio > 0.35 ? '#2f6b4f' : '#b4332a';
  ctx.fillRect(-16, -radius - 8, 32 * ratio, 4);
  ctx.restore();
}

function screenAngle(dx, dy) {
  return Math.atan2(-dy, dx);
}

function drawUnitShot(shot) {
  const screen = toScreen(shot.x, shot.y);
  const from = toScreen(shot.fromX, shot.fromY);
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(screenAngle(shot.x - shot.fromX, shot.y - shot.fromY));
  ctx.strokeStyle = shot.ink;
  ctx.fillStyle = shot.ink;
  ctx.lineCap = 'round';
  if (shot.style === 'ranged') {
    if (art.arrow) {
      ctx.drawImage(art.arrow, -36, -14, 72, 28);
    } else {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-28, 0);
      ctx.lineTo(16, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(6, -7);
      ctx.lineTo(6, 7);
      ctx.closePath();
      ctx.fill();
    }
  } else if (shot.motion === 'thrust') {
    const reach = Math.hypot(screen.x - from.x, screen.y - from.y);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-reach, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-2, -7);
    ctx.lineTo(-2, 7);
    ctx.closePath();
    ctx.fill();
  } else if (shot.motion === 'charge') {
    ctx.globalAlpha = 0.85;
    ctx.fillRect(-46, -7, 52, 14);
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-4, -12);
    ctx.lineTo(-4, 12);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 26, -0.2, 2.2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEnemyArrow(shot) {
  const screen = toScreen(shot.x, shot.y);
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(screenAngle(shot.targetX - shot.fromX, shot.targetY - shot.fromY));
  ctx.strokeStyle = '#8d2e2a';
  ctx.fillStyle = '#8d2e2a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-22, 0);
  ctx.lineTo(12, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(4, -6);
  ctx.lineTo(4, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawImpacts() {
  for (const impact of impacts) {
    const screen = toScreen(impact.x, impact.y);
    const frames = art.fx[impact.typeId] ?? [];
    const t = impact.age / impact.life;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - t);
    if (frames.length > 0) {
      const index = Math.min(frames.length - 1, Math.floor(t * frames.length));
      const size = 90 + t * 40;
      ctx.drawImage(frames[index], screen.x - size / 2, screen.y - size / 2, size, size);
    } else {
      ctx.strokeStyle = impact.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, 12 + t * 28, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawFloats() {
  for (const floater of sim.floats) {
    const screen = toScreen(floater.x, floater.y);
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - floater.age / 0.7);
    ctx.fillStyle = '#b4332a';
    ctx.font = font(20, false);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(floater.text, screen.x, screen.y - floater.age * 46);
    ctx.restore();
  }
}

function draw() {
  if (!config || !sim) {
    return;
  }
  const { designWidth: w, designHeight: h } = config.board;
  ctx.clearRect(0, 0, w, h);
  drawBackground();
  drawRiver();
  drawBoard();
  drawSeal();
  drawRange();
  drawMarks();
  sim.enemies.forEach(drawEnemy);
  drawTokens();
  for (const shot of sim.shots) {
    drawUnitShot(shot);
  }
  for (const shot of sim.enemyShots) {
    drawEnemyArrow(shot);
  }
  drawImpacts();
  drawFloats();
}

function noteImpacts(before, afterIds) {
  for (const shot of before) {
    if (!afterIds.has(shot.id)) {
      impacts.push({
        x: shot.x,
        y: shot.y,
        typeId: shot.typeId,
        ink: shot.ink,
        age: 0,
        life: 0.32,
      });
    }
  }
  for (const shot of sim.shots) {
    if (!before.some((entry) => entry.id === shot.id)) {
      poses.set(shot.sourceId, { t: 0, dur: 0.34 });
    }
  }
}

function advanceView(scaledDt, realDt) {
  for (const [id, pose] of poses) {
    pose.t += scaledDt;
    if (pose.t >= pose.dur) {
      poses.delete(id);
    }
  }
  for (const impact of impacts) {
    impact.age += realDt;
  }
  for (let i = impacts.length - 1; i >= 0; i -= 1) {
    if (impacts[i].age >= impacts[i].life) {
      impacts.splice(i, 1);
    }
  }
  if (toastTimer > 0) {
    toastTimer = Math.max(0, toastTimer - realDt);
  }
}

function frame(now) {
  if (!lastFrame) {
    lastFrame = now;
  }
  const realDt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  clock += realDt;
  if (sim && sim.phase === 'playing') {
    let left = realDt * timeScale;
    const step = 1 / 60;
    let scaled = 0;
    while (left > 0 && sim.phase === 'playing') {
      const before = sim.shots.slice();
      const slice = Math.min(step, left);
      sim.tick(slice);
      noteImpacts(before, new Set(sim.shots.map((shot) => shot.id)));
      left -= slice;
      scaled += slice;
    }
    advanceView(scaled, realDt);
    if (guidePending && sim.mergeCount > 0) {
      completeGuide();
    }
  } else {
    advanceView(0, realDt);
  }
  updateHud();
  draw();
  requestAnimationFrame(frame);
}

function bind() {
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  ui.recruit.addEventListener('click', recruit);
  ui.speed.addEventListener('click', toggleSpeed);
  ui.restart.addEventListener('click', restart);
  ui.tutorialOk.addEventListener('click', () => {
    clearSelection();
    ui.tutorial.hidden = true;
  });
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'r' || event.key === 'R') {
      recruit();
    } else if (event.key === 'f' || event.key === 'F') {
      toggleSpeed();
    } else if (event.key === 'g' || event.key === 'G') {
      restart();
    }
  });
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function boot() {
  bind();
  ui.loading.hidden = false;
  ui.loadingText.textContent = '研墨中…';
  try {
    await Promise.race([
      document.fonts.load('32px "Ink Title"'),
      new Promise((resolve) => {
        window.setTimeout(resolve, 1200);
      }),
    ]);
    config = await loadConfig();
    sim = new GameSim(config, seed());
    guidePending = !guideSeen();
    if (guidePending) {
      grantGuide();
    }
    resize();
    ui.loading.hidden = true;
    void loadArt();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ui.loadingText.textContent = `配置没有读出来\n${message}`;
  }
  requestAnimationFrame(frame);
}

void boot();
