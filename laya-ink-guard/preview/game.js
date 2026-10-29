"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __decorateClass = (decorators, target, key, kind) => {
    var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
    for (var i = decorators.length - 1, decorator; i >= 0; i--)
      if (decorator = decorators[i])
        result = (kind ? decorator(target, key, result) : decorator(result)) || result;
    if (kind && result) __defProp(target, key, result);
    return result;
  };

  // src/config/ConfigTypes.ts
  var CONFIG_FILES = ["units", "foes", "economy", "adou", "waves", "board"];

  // src/config/validateConfig.ts
  function fail(file, message) {
    throw new Error(`${file}\uFF1A${message}`);
  }
  function asRecord(value, file) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(file, "\u5FC5\u987B\u662F JSON \u5BF9\u8C61");
    }
    return value;
  }
  function needNumber(obj, key, file) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(file, `${key} \u5FC5\u987B\u662F\u6709\u9650\u6570\u5B57`);
    }
    return value;
  }
  function needString(obj, key, file) {
    const value = obj[key];
    if (typeof value !== "string" || value.trim() === "") {
      fail(file, `${key} \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32`);
    }
    return value;
  }
  function needArray(obj, key, file) {
    const value = obj[key];
    if (!Array.isArray(value)) {
      fail(file, `${key} \u5FC5\u987B\u662F\u6570\u7EC4`);
    }
    return value;
  }
  function needPoint(value, file) {
    const obj = asRecord(value, file);
    return { x: needNumber(obj, "x", file), y: needNumber(obj, "y", file) };
  }
  function parsePolyline(value, file, label) {
    if (!Array.isArray(value) || value.length < 2) {
      fail(file, `${label} \u81F3\u5C11\u8981\u6709\u4E24\u4E2A\u70B9`);
    }
    return value.map((entry) => needPoint(entry, file));
  }
  function parseUnits(raw) {
    const file = "units.json";
    const obj = asRecord(raw, file);
    const maxLevel = needNumber(obj, "maxLevel", file);
    if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 9) {
      fail(file, "maxLevel \u5FC5\u987B\u662F 1 \u5230 9 \u7684\u6574\u6570");
    }
    const orderRaw = needArray(obj, "order", file);
    const order = orderRaw.map((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        fail(file, `order[${index}] \u5FC5\u987B\u662F\u5B57\u4EE4 id`);
      }
      return entry;
    });
    if (new Set(order).size !== order.length) {
      fail(file, "order \u91CC\u6709\u91CD\u590D\u5B57\u4EE4");
    }
    const typesRaw = asRecord(obj.types, file);
    const types = {};
    for (const id of order) {
      if (!(id in typesRaw)) {
        fail(file, `\u7F3A\u5C11\u5B57\u4EE4 ${id}`);
      }
      const entry = asRecord(typesRaw[id], file);
      const levelsRaw = needArray(entry, "levels", file);
      const byLevel = new Array(maxLevel + 1);
      const seen = /* @__PURE__ */ new Set();
      for (const levelRaw of levelsRaw) {
        const levelObj = asRecord(levelRaw, file);
        const level = needNumber(levelObj, "level", file);
        const atk = needNumber(levelObj, "atk", file);
        const aspd = needNumber(levelObj, "aspd", file);
        const range = needNumber(levelObj, "range", file);
        const hp = needNumber(levelObj, "hp", file);
        if (!Number.isInteger(level) || level < 1 || level > maxLevel) {
          fail(file, `${id} \u7684 level ${level} \u8D85\u51FA 1..${maxLevel}`);
        }
        if (seen.has(level)) {
          fail(file, `${id} \u7684 ${level} \u54C1\u91CD\u590D\u4E86`);
        }
        if (atk < 0 || aspd <= 0 || range <= 0 || hp <= 0) {
          fail(file, `${id} ${level} \u54C1\u7684 atk/aspd/range/hp \u4E0D\u5408\u6CD5`);
        }
        seen.add(level);
        byLevel[level] = { level, atk, aspd, range, hp };
      }
      for (let level = 1; level <= maxLevel; level += 1) {
        if (!byLevel[level]) {
          fail(file, `${id} \u7F3A\u5C11 ${level} \u54C1`);
        }
      }
      const ink = needString(entry, "ink", file);
      if (!/^#[0-9a-fA-F]{6}$/.test(ink)) {
        fail(file, `${id} \u7684 ink \u5FC5\u987B\u662F #RRGGBB`);
      }
      const style = needString(entry, "style", file);
      if (style !== "melee" && style !== "ranged") {
        fail(file, `${id} \u7684 style \u53EA\u80FD\u662F melee \u6216 ranged`);
      }
      const motion = needString(entry, "motion", file);
      const strike = needNumber(entry, "strike", file);
      const shotSpeed = needNumber(entry, "shotSpeed", file);
      if (style === "melee") {
        if (strike <= 0 || strike > 1) {
          fail(file, `${id} \u7684\u8FD1\u6218 strike \u5FC5\u987B\u5927\u4E8E 0 \u4E14\u4E0D\u8D85\u8FC7 1 \u79D2`);
        }
        if (shotSpeed !== 0) {
          fail(file, `${id} \u662F\u8FD1\u6218\uFF0CshotSpeed \u5FC5\u987B\u662F 0`);
        }
      } else if (shotSpeed <= 0 || strike !== 0) {
        fail(file, `${id} \u662F\u8FDC\u7A0B\uFF0Cstrike \u5FC5\u987B\u662F 0\uFF0CshotSpeed \u5FC5\u987B\u5927\u4E8E 0`);
      }
      types[id] = {
        id,
        displayName: needString(entry, "displayName", file),
        glyph: needString(entry, "glyph", file),
        ink,
        style,
        motion,
        styleLabel: needString(entry, "styleLabel", file),
        motionLabel: needString(entry, "motionLabel", file),
        strike,
        shotSpeed,
        byLevel
      };
    }
    const motions = Object.values(types).map((type) => type.motion);
    if (new Set(motions).size !== motions.length) {
      fail(file, "\u6BCF\u79CD\u5B57\u4EE4\u7684 motion \u5FC5\u987B\u4E0D\u540C\uFF0C\u653B\u51FB\u65B9\u5F0F\u624D\u80FD\u5206\u5F00");
    }
    const extra = Object.keys(typesRaw).filter((id) => !order.includes(id));
    if (extra.length > 0) {
      fail(file, `order \u672A\u5217\u51FA ${extra.join(", ")}`);
    }
    return { maxLevel, order, types };
  }
  function parseFoes(raw, units) {
    const file = "foes.json";
    const obj = asRecord(raw, file);
    const orderRaw = needArray(obj, "order", file);
    const order = orderRaw.map((entry, index) => {
      if (typeof entry !== "string" || entry.trim() === "") {
        fail(file, `order[${index}] \u5FC5\u987B\u662F\u58A8\u5BC7 id`);
      }
      return entry;
    });
    if (order.length === 0 || new Set(order).size !== order.length) {
      fail(file, "order \u4E0D\u80FD\u7A7A\uFF0C\u4E5F\u4E0D\u80FD\u91CD\u590D");
    }
    const typesRaw = asRecord(obj.types, file);
    const types = {};
    for (const id of order) {
      if (!(id in typesRaw)) {
        fail(file, `\u7F3A\u5C11\u58A8\u5BC7 ${id}`);
      }
      const entry = asRecord(typesRaw[id], file);
      const vfxId = needString(entry, "vfx", file);
      const vfx = units.types[vfxId];
      if (!vfx) {
        fail(file, `${id} \u7684 vfx \u5FC5\u987B\u662F\u5DF2\u6709\u5B57\u4EE4`);
      }
      const ink = needString(entry, "ink", file);
      if (!/^#[0-9a-fA-F]{6}$/.test(ink)) {
        fail(file, `${id} \u7684 ink \u5FC5\u987B\u662F #RRGGBB`);
      }
      const atk = needNumber(entry, "atk", file);
      const aspd = needNumber(entry, "aspd", file);
      if (atk <= 0 || aspd <= 0) {
        fail(file, `${id} \u7684 atk/aspd \u5FC5\u987B\u5927\u4E8E 0`);
      }
      const level1 = vfx.byLevel[1];
      types[id] = {
        id,
        displayName: needString(entry, "displayName", file),
        glyph: needString(entry, "glyph", file),
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
        vfx: vfxId
      };
    }
    const extra = Object.keys(typesRaw).filter((id) => !order.includes(id));
    if (extra.length > 0) {
      fail(file, `order \u672A\u5217\u51FA ${extra.join(", ")}`);
    }
    if (!order.some((id) => types[id].style === "melee") || !order.some((id) => types[id].style === "ranged")) {
      fail(file, "\u58A8\u5BC7\u91CC\u8981\u540C\u65F6\u6709\u8FD1\u6218\u548C\u8FDC\u7A0B\uFF0C\u8FDC\u7A0B\u590D\u7528\u5B57\u4EE4\u7684 shotSpeed");
    }
    return { order, types };
  }
  function parseEconomy(raw) {
    const file = "economy.json";
    const obj = asRecord(raw, file);
    const economy = {
      startMantou: needNumber(obj, "startMantou", file),
      recruitCostBase: needNumber(obj, "recruitCostBase", file),
      recruitCostGrowth: needNumber(obj, "recruitCostGrowth", file),
      incomePerSecond: needNumber(obj, "incomePerSecond", file),
      killReward: needNumber(obj, "killReward", file),
      waveClearBonus: needNumber(obj, "waveClearBonus", file)
    };
    if (economy.startMantou < 0 || economy.recruitCostBase <= 0 || economy.recruitCostGrowth < 0) {
      fail(file, "\u521D\u59CB\u9992\u5934\u6216\u62DB\u52DF\u82B1\u8D39\u4E0D\u5408\u6CD5");
    }
    if (economy.incomePerSecond < 0 || economy.killReward < 0 || economy.waveClearBonus < 0) {
      fail(file, "\u6536\u5165\u4E0D\u80FD\u4E3A\u8D1F");
    }
    return economy;
  }
  function parseAdou(raw) {
    const file = "adou.json";
    const obj = asRecord(raw, file);
    const maxHp = needNumber(obj, "maxHp", file);
    if (maxHp <= 0) {
      fail(file, "maxHp \u5FC5\u987B\u5927\u4E8E 0");
    }
    return { maxHp, name: needString(obj, "name", file) };
  }
  function parseWaves(raw) {
    const file = "waves.json";
    const obj = asRecord(raw, file);
    const firstDelay = needNumber(obj, "firstDelay", file);
    const gapSeconds = needNumber(obj, "gapSeconds", file);
    if (firstDelay < 0 || gapSeconds < 0) {
      fail(file, "\u5907\u6CE2\u65F6\u95F4\u4E0D\u80FD\u4E3A\u8D1F");
    }
    const waves = needArray(obj, "waves", file).map((entry, index) => {
      const waveObj = asRecord(entry, file);
      let roster = [];
      if (waveObj.roster !== void 0) {
        const rosterRaw = waveObj.roster;
        if (!Array.isArray(rosterRaw) || rosterRaw.length === 0) {
          fail(file, `\u7B2C ${index + 1} \u6CE2 roster \u5FC5\u987B\u662F\u975E\u7A7A\u6570\u7EC4`);
        }
        roster = rosterRaw.map((entry2, rosterIndex) => {
          if (typeof entry2 !== "string" || entry2.trim() === "") {
            fail(file, `\u7B2C ${index + 1} \u6CE2 roster[${rosterIndex}] \u5FC5\u987B\u662F\u58A8\u5BC7 id`);
          }
          return entry2;
        });
      }
      const wave = {
        id: needNumber(waveObj, "id", file),
        count: needNumber(waveObj, "count", file),
        hp: needNumber(waveObj, "hp", file),
        speed: needNumber(waveObj, "speed", file),
        damage: needNumber(waveObj, "damage", file),
        interval: needNumber(waveObj, "interval", file),
        roster
      };
      if (!Number.isInteger(wave.count) || wave.count <= 0) {
        fail(file, `\u7B2C ${index + 1} \u6CE2 count \u5FC5\u987B\u662F\u6B63\u6574\u6570`);
      }
      if (wave.hp <= 0 || wave.speed <= 0 || wave.damage <= 0 || wave.interval <= 0) {
        fail(file, `\u7B2C ${index + 1} \u6CE2\u7684 hp/speed/damage/interval \u5FC5\u987B\u5927\u4E8E 0`);
      }
      return wave;
    });
    if (waves.length === 0) {
      fail(file, "\u81F3\u5C11\u8981\u6709\u4E00\u6CE2");
    }
    return { firstDelay, gapSeconds, waves };
  }
  function inside(board, point, pad, file, label) {
    const limitX = board.designWidth / 2 - pad;
    const limitY = board.designHeight / 2 - pad;
    if (Math.abs(point.x) > limitX || Math.abs(point.y) > limitY) {
      fail(file, `${label} (${point.x}, ${point.y}) \u8D85\u51FA\u8BBE\u8BA1\u5206\u8FA8\u7387`);
    }
  }
  function parseBoard(raw) {
    const file = "board.json";
    const obj = asRecord(raw, file);
    const board = {
      designWidth: needNumber(obj, "designWidth", file),
      designHeight: needNumber(obj, "designHeight", file),
      gridCols: needNumber(obj, "gridCols", file),
      gridRows: needNumber(obj, "gridRows", file),
      benchSlots: needNumber(obj, "benchSlots", file),
      cellSize: needNumber(obj, "cellSize", file),
      cellGap: needNumber(obj, "cellGap", file),
      gridOrigin: needPoint(obj.gridOrigin, file),
      benchOrigin: needPoint(obj.benchOrigin, file),
      benchStep: needNumber(obj, "benchStep", file),
      lanes: [],
      path: [],
      river: null,
      camp: null,
      projectileSpeed: needNumber(obj, "projectileSpeed", file),
      hitRadius: needNumber(obj, "hitRadius", file)
    };
    const lanes = obj.lanes === void 0 ? null : needArray(obj, "lanes", file).map((entry, index) => parsePolyline(entry, file, `lanes[${index}]`));
    const explicitPath = obj.path === void 0 ? null : parsePolyline(obj.path, file, "path");
    if (!lanes && !explicitPath) {
      fail(file, "\u9700\u8981 path \u6216 lanes");
    }
    board.lanes = lanes != null ? lanes : [explicitPath];
    if (board.lanes.length < 1) {
      fail(file, "\u81F3\u5C11\u8981\u6709\u4E00\u6761\u58A8\u8DEF");
    }
    const seal = board.lanes[0][board.lanes[0].length - 1];
    for (let i = 1; i < board.lanes.length; i += 1) {
      const end = board.lanes[i][board.lanes[i].length - 1];
      if (Math.hypot(end.x - seal.x, end.y - seal.y) > 1) {
        fail(file, "\u5404\u6761\u58A8\u8DEF\u5FC5\u987B\u6C47\u5165\u540C\u4E00\u4E2A\u7EC8\u70B9");
      }
    }
    board.path = board.lanes[Math.min(1, board.lanes.length - 1)];
    if (obj.river !== void 0) {
      const river = asRecord(obj.river, file);
      const rect = {
        x: needNumber(river, "x", file),
        y: needNumber(river, "y", file),
        w: needNumber(river, "w", file),
        h: needNumber(river, "h", file)
      };
      if (rect.w <= 0 || rect.h <= 0) {
        fail(file, "river \u5BBD\u9AD8\u5FC5\u987B\u5927\u4E8E 0");
      }
      board.river = rect;
    }
    if (obj.camp !== void 0) {
      board.camp = needPoint(obj.camp, file);
    }
    if (board.designWidth < 320 || board.designHeight < 480) {
      fail(file, "\u8BBE\u8BA1\u5206\u8FA8\u7387\u8FC7\u5C0F");
    }
    if (!Number.isInteger(board.gridCols) || !Number.isInteger(board.gridRows) || board.gridCols < 1 || board.gridRows < 1) {
      fail(file, "\u683C\u5B50\u884C\u5217\u5FC5\u987B\u662F\u6B63\u6574\u6570");
    }
    if (!Number.isInteger(board.benchSlots) || board.benchSlots < 1) {
      fail(file, "benchSlots \u5FC5\u987B\u662F\u6B63\u6574\u6570");
    }
    if (board.cellSize <= 0 || board.cellGap < 0 || board.benchStep <= 0) {
      fail(file, "\u683C\u5B50\u5C3A\u5BF8\u4E0D\u5408\u6CD5");
    }
    if (board.projectileSpeed <= 0 || board.hitRadius <= 0) {
      fail(file, "\u5F39\u9053\u901F\u5EA6\u548C\u547D\u4E2D\u534A\u5F84\u5FC5\u987B\u5927\u4E8E 0");
    }
    const step = board.cellSize + board.cellGap;
    const lastCell = {
      x: board.gridOrigin.x + (board.gridCols - 1) * step,
      y: board.gridOrigin.y - (board.gridRows - 1) * step
    };
    inside(board, lastCell, board.cellSize / 2, file, "\u6700\u8FDC\u683C\u5B50");
    inside(board, board.gridOrigin, board.cellSize / 2, file, "\u683C\u5B50\u539F\u70B9");
    const lastBench = {
      x: board.benchOrigin.x + (board.benchSlots - 1) * board.benchStep,
      y: board.benchOrigin.y
    };
    inside(board, board.benchOrigin, 28, file, "\u5E2D\u4F4D");
    inside(board, lastBench, 28, file, "\u672B\u4F4D\u5E2D\u4F4D");
    board.lanes.forEach((lane, laneIndex) => {
      lane.forEach((point, index) => inside(board, point, 8, file, `\u58A8\u8DEF ${laneIndex} \u70B9 ${index}`));
    });
    if (board.camp) {
      inside(board, board.camp, 8, file, "\u5317\u8425");
    }
    return board;
  }
  function linkFoes(waves, foes) {
    const known = new Set(foes.order);
    for (const wave of waves.waves) {
      for (const id of wave.roster) {
        if (!known.has(id)) {
          fail("waves.json", `roster \u91CC\u7684 ${id} \u4E0D\u662F\u58A8\u5BC7`);
        }
      }
    }
  }
  function normalizeConfig(raw) {
    const root = asRecord(raw, "configs");
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
      board: parseBoard(root.board)
    };
  }

  // src/config/loadConfig.ts
  var RESOURCE_BASES = [
    "../../ink-guard/assets/resources/",
    "../assets/resources/",
    "resources/"
  ];
  async function loadGameConfig() {
    let last = null;
    for (const base of RESOURCE_BASES) {
      try {
        const raw = {};
        for (const name of CONFIG_FILES) {
          raw[name] = await fetchJson(`${base}configs/${name}.json`);
        }
        return normalizeConfig(raw);
      } catch (error) {
        last = error;
      }
    }
    const detail = last instanceof Error ? last.message : String(last != null ? last : "unknown");
    throw new Error(`\u914D\u7F6E\u6CA1\u6709\u8BFB\u51FA\u6765\uFF1A${detail}`);
  }
  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(url);
    }
    return response.json();
  }

  // src/view/assets.ts
  var WANTED = [
    "textures/bg-paper.png",
    "textures/mountain-top.png",
    "textures/mountain-bottom.png",
    "textures/bamboo.png",
    "textures/river.png",
    "textures/cell.png",
    "textures/seal-adou.png",
    "textures/panel-paper.png",
    "textures/btn-cinnabar.png",
    "textures/btn-muted.png",
    "textures/hp-fill.png",
    "textures/hp-track.png",
    "textures/unit-dao.png",
    "textures/unit-qiang.png",
    "textures/unit-gong.png",
    "textures/unit-qi.png",
    "foes/kou.png",
    "foes/mao.png",
    "foes/shi.png",
    "fx/gong-arrow.png",
    ...poseSheet("dao"),
    ...poseSheet("qiang"),
    ...poseSheet("gong"),
    ...poseSheet("qi"),
    ...poseSheet("kou"),
    ...poseSheet("mao"),
    ...poseSheet("shi"),
    ...poseSheet("dao", "fx"),
    ...poseSheet("qiang", "fx"),
    ...poseSheet("gong", "fx"),
    ...poseSheet("qi", "fx")
  ];
  function poseSheet(id, folder = "pose") {
    return [0, 1, 2, 3].map((frame) => `${folder}/${id}-${frame}.png`);
  }
  async function loadArt() {
    const book = { url: {}, tex: {} };
    await Promise.all(WANTED.map(async (path) => {
      const found = await loadOne(path);
      if (!found) {
        return;
      }
      book.url[path] = found.url;
      book.tex[path] = found.tex;
    }));
    return book;
  }
  async function loadFonts() {
    const title = await loadFont("fonts/MaShanZheng-Regular.ttf", "MaShanZheng-Regular");
    const body = await loadFont("fonts/NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Regular");
    return {
      title: title != null ? title : "serif",
      body: body != null ? body : "sans-serif"
    };
  }
  async function loadFont(path, family) {
    for (const base of RESOURCE_BASES) {
      try {
        const loaded = await Laya.loader.load(`${base}${path}`, Laya.Loader.TTF);
        if (loaded) {
          return family;
        }
      } catch (e) {
      }
    }
    return null;
  }
  async function loadOne(path) {
    for (const base of RESOURCE_BASES) {
      const url = `${base}${path}`;
      try {
        const loaded = await Laya.loader.load(url, Laya.Loader.IMAGE);
        if (isTexture(loaded)) {
          return { url, tex: loaded };
        }
      } catch (e) {
      }
    }
    return null;
  }
  function isTexture(value) {
    return !!value && typeof value === "object" && "width" in value && "height" in value;
  }

  // src/logic/geometry.ts
  function boardLanes(board) {
    return board.lanes.length > 0 ? board.lanes : [board.path];
  }
  function buildPath(points) {
    const segLens = [];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
      segLens.push(d);
      total += d;
    }
    return { points, segLens, total };
  }
  function pointOnPath(path, distance) {
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
  function gridPosition(board, index) {
    const col = index % board.gridCols;
    const row = Math.floor(index / board.gridCols);
    const step = board.cellSize + board.cellGap;
    return {
      x: board.gridOrigin.x + col * step,
      y: board.gridOrigin.y - row * step
    };
  }
  function benchPosition(board, index) {
    return {
      x: board.benchOrigin.x + index * board.benchStep,
      y: board.benchOrigin.y
    };
  }
  function slotReach(board, place) {
    if (place === "grid") {
      const step = board.cellSize + board.cellGap;
      return Math.hypot(step / 2, step / 2) + 6;
    }
    return Math.hypot(board.benchStep / 2, board.cellSize / 2) + 6;
  }
  function dropSlotAt(board, x, y) {
    const grid = nearestIndex(board, "grid", x, y, slotReach(board, "grid"));
    const bench = nearestIndex(board, "bench", x, y, slotReach(board, "bench"));
    if (grid < 0 && bench < 0) {
      return null;
    }
    if (grid >= 0 && bench >= 0) {
      const gridPos = gridPosition(board, grid);
      const benchPos = benchPosition(board, bench);
      const gridD = Math.hypot(gridPos.x - x, gridPos.y - y);
      const benchD = Math.hypot(benchPos.x - x, benchPos.y - y);
      return gridD <= benchD ? { place: "grid", slot: grid } : { place: "bench", slot: bench };
    }
    if (grid >= 0) {
      return { place: "grid", slot: grid };
    }
    return { place: "bench", slot: bench };
  }
  function inRange(ax, ay, bx, by, range) {
    return Math.hypot(ax - bx, ay - by) <= range;
  }
  function slotsWithin(board, x, y, range) {
    const count = board.gridCols * board.gridRows;
    const slots = [];
    for (let i = 0; i < count; i += 1) {
      const point = gridPosition(board, i);
      if (inRange(x, y, point.x, point.y, range)) {
        slots.push(i);
      }
    }
    return slots;
  }
  function pathMarksWithin(points, x, y, range, step = 28) {
    const path = buildPath(points);
    const marks = [];
    if (path.total <= 0) {
      const only = path.points[0];
      if (only && inRange(x, y, only.x, only.y, range)) {
        marks.push(only);
      }
      return marks;
    }
    const count = Math.max(1, Math.ceil(path.total / step));
    for (let i = 0; i <= count; i += 1) {
      const point = pointOnPath(path, path.total * i / count);
      if (inRange(x, y, point.x, point.y, range)) {
        marks.push(point);
      }
    }
    return marks;
  }
  function nearestIndex(board, place, x, y, maxDist) {
    const count = place === "grid" ? board.gridCols * board.gridRows : board.benchSlots;
    let best = -1;
    let bestD = maxDist;
    for (let i = 0; i < count; i += 1) {
      const p = place === "grid" ? gridPosition(board, i) : benchPosition(board, i);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d <= bestD && (best < 0 || d < bestD)) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // src/logic/rng.ts
  function mulberry32(seed2) {
    let a = seed2 >>> 0;
    return () => {
      a |= 0;
      a = a + 1831565813 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // src/logic/GameSim.ts
  var GameSim = class {
    constructor(config, seed2) {
      this.config = config;
      this.phase = "playing";
      this.mantou = 0;
      this.adouHp = 0;
      this.recruitCount = 0;
      this.mergeCount = 0;
      this.killCount = 0;
      this.leakCount = 0;
      this.time = 0;
      this.waveCursor = 0;
      this.spawnedInWave = 0;
      this.betweenWaves = true;
      this.betweenTimer = 0;
      this.banner = "";
      this.bannerTimer = 0;
      this.tokens = [];
      this.enemies = [];
      this.shots = [];
      this.floats = [];
      this.seq = 1;
      this.lanes = [];
      this.spawnCooldown = 0;
      this.cooldown = /* @__PURE__ */ new Map();
      this.foeCooldown = /* @__PURE__ */ new Map();
      this.rng = typeof seed2 === "function" ? seed2 : mulberry32(seed2);
      this.resetState();
    }
    reset(seed2) {
      this.rng = typeof seed2 === "function" ? seed2 : mulberry32(seed2);
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
      return this.firstEmpty("bench") >= 0;
    }
    statOf(type, level) {
      var _a;
      const row = (_a = this.config.units.types[type]) == null ? void 0 : _a.byLevel[level];
      if (!row) {
        throw new Error(`Missing stat for ${type} level ${level}`);
      }
      return row;
    }
    recruit() {
      if (this.phase !== "playing") {
        return { ok: false, reason: "bench-full" };
      }
      const slot = this.firstEmpty("bench");
      if (slot < 0) {
        return { ok: false, reason: "bench-full" };
      }
      const cost = this.nextCost();
      if (this.mantou < cost) {
        return { ok: false, reason: "broke" };
      }
      this.mantou -= cost;
      this.recruitCount += 1;
      const order = this.config.units.order;
      const index = Math.min(order.length - 1, Math.floor(this.rng() * order.length));
      const token = this.spawnToken(order[index], 1, "bench", slot);
      return { ok: true, token };
    }
    drop(tokenId, place, slot) {
      if (this.phase !== "playing") {
        return { ok: false, reason: "mismatch" };
      }
      const token = this.tokens.find((entry) => entry.id === tokenId);
      if (!token || slot < 0 || slot >= this.slotCount(place)) {
        return { ok: false, reason: "mismatch" };
      }
      const occupant = this.tokens.find((entry) => entry.place === place && entry.slot === slot);
      if (!occupant || occupant.id === token.id) {
        if (occupant && occupant.id === token.id) {
          return { ok: true, action: "stay" };
        }
        token.place = place;
        token.slot = slot;
        return { ok: true, action: "move" };
      }
      if (occupant.type === token.type && occupant.level === token.level) {
        if (token.level >= this.config.units.maxLevel) {
          return { ok: false, reason: "max-level" };
        }
        occupant.level += 1;
        const raised = this.statOf(occupant.type, occupant.level);
        occupant.maxHp = raised.hp;
        occupant.hp = raised.hp;
        this.tokens = this.tokens.filter((entry) => entry.id !== token.id);
        this.cooldown.delete(token.id);
        this.cooldown.set(occupant.id, 0.15);
        this.mergeCount += 1;
        return { ok: true, action: "merge" };
      }
      const fromPlace = token.place;
      const fromSlot = token.slot;
      token.place = occupant.place;
      token.slot = occupant.slot;
      occupant.place = fromPlace;
      occupant.slot = fromSlot;
      return { ok: true, action: "swap" };
    }
    /**
     * What a drop would do, without changing the board.
     * Used to light legal cells while a token is being dragged.
     */
    previewDrop(tokenId, place, slot) {
      if (this.phase !== "playing") {
        return "blocked";
      }
      const token = this.tokens.find((entry) => entry.id === tokenId);
      if (!token || slot < 0 || slot >= this.slotCount(place)) {
        return "blocked";
      }
      const occupant = this.tokens.find((entry) => entry.place === place && entry.slot === slot);
      if (!occupant) {
        return "move";
      }
      if (occupant.id === token.id) {
        return "stay";
      }
      if (occupant.type === token.type && occupant.level === token.level) {
        return token.level >= this.config.units.maxLevel ? "blocked" : "merge";
      }
      return "swap";
    }
    /** Places a level-1 token without spending mantou. The first-run guide uses this. */
    placeGuideToken(type, place, slot) {
      if (this.phase !== "playing" || !this.config.units.types[type]) {
        return null;
      }
      if (slot < 0 || slot >= this.slotCount(place)) {
        return null;
      }
      if (this.tokens.some((entry) => entry.place === place && entry.slot === slot)) {
        return null;
      }
      return this.spawnToken(type, 1, place, slot);
    }
    tick(dt) {
      if (this.phase !== "playing" || dt <= 0) {
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
      this.tickFoes(dt);
      this.tickShots(dt);
      this.tickEnemies(dt);
      this.enemies = this.enemies.filter((enemy) => enemy.hp > 0);
      this.tokens = this.tokens.filter((token) => token.hp > 0);
      this.shots = this.shots.filter((shot) => this.shotHasTarget(shot));
      if (this.adouHp <= 0) {
        this.adouHp = 0;
        this.phase = "lose";
        this.bannerTimer = 0;
        return;
      }
      this.maybeAdvanceWave();
    }
    resetState() {
      const delay = this.config.waves.firstDelay;
      this.phase = "playing";
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
      this.banner = "";
      this.bannerTimer = 0;
      this.tokens = [];
      this.enemies = [];
      this.shots = [];
      this.floats = [];
      this.seq = 1;
      this.spawnCooldown = 0;
      this.cooldown.clear();
      this.foeCooldown.clear();
      this.lanes = boardLanes(this.config.board).map((points) => buildPath(points));
    }
    laneOf(enemy) {
      var _a;
      return (_a = this.lanes[enemy.lane]) != null ? _a : this.lanes[0];
    }
    nextId(prefix) {
      const id = `${prefix}${this.seq}`;
      this.seq += 1;
      return id;
    }
    slotCount(place) {
      const board = this.config.board;
      return place === "grid" ? board.gridCols * board.gridRows : board.benchSlots;
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
        this.banner = `\u7B2C ${this.waveNumber} \u6CE2`;
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
      var _a;
      const roster = wave.roster.length > 0 ? wave.roster : [this.defaultFoe()];
      const kind = roster[this.spawnedInWave % roster.length];
      const lane = (wave.id + this.spawnedInWave) % Math.max(1, this.lanes.length);
      const road = (_a = this.lanes[lane]) != null ? _a : this.lanes[0];
      const point = pointOnPath(road, 0);
      this.enemies.push({
        id: this.nextId("e"),
        kind,
        hp: wave.hp,
        maxHp: wave.hp,
        speed: wave.speed,
        damage: wave.damage,
        distance: 0,
        x: point.x,
        y: point.y,
        waveId: wave.id,
        lane
      });
    }
    defaultFoe() {
      const foes = this.config.foes;
      const melee = foes.order.find((id) => foes.types[id].style === "melee");
      return melee != null ? melee : foes.order[0];
    }
    spawnToken(type, level, place, slot) {
      const stat = this.statOf(type, level);
      const token = {
        id: this.nextId("u"),
        type,
        level,
        place,
        slot,
        hp: stat.hp,
        maxHp: stat.hp
      };
      this.tokens.push(token);
      return token;
    }
    tickAttacks(dt) {
      var _a;
      const active = /* @__PURE__ */ new Set();
      for (const token of this.tokens) {
        if (token.place !== "grid" || token.hp <= 0) {
          continue;
        }
        active.add(token.id);
        const stat = this.statOf(token.type, token.level);
        let readyIn = ((_a = this.cooldown.get(token.id)) != null ? _a : 0) - dt;
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
          id: this.nextId("s"),
          x: origin.x,
          y: origin.y,
          fromX: origin.x,
          fromY: origin.y,
          damage: stat.atk,
          targetId: target.id,
          side: "player",
          ink: type.ink,
          typeId: token.type,
          vfx: token.type,
          sourceId: token.id,
          style: type.style,
          motion: type.motion,
          strike: type.style === "melee" ? type.strike : 0,
          speed: type.style === "ranged" ? type.shotSpeed : 0,
          age: 0
        });
      }
      for (const id of this.cooldown.keys()) {
        if (!active.has(id)) {
          this.cooldown.delete(id);
        }
      }
    }
    tickFoes(dt) {
      var _a;
      const alive = /* @__PURE__ */ new Set();
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) {
          continue;
        }
        alive.add(enemy.id);
        const foe = this.config.foes.types[enemy.kind];
        if (!foe) {
          continue;
        }
        let readyIn = ((_a = this.foeCooldown.get(enemy.id)) != null ? _a : 0) - dt;
        if (readyIn > 0) {
          this.foeCooldown.set(enemy.id, readyIn);
          continue;
        }
        const target = this.nearestToken(enemy.x, enemy.y, foe.range);
        if (!target) {
          this.foeCooldown.set(enemy.id, 0);
          continue;
        }
        this.foeCooldown.set(enemy.id, 1 / foe.aspd);
        this.shots.push({
          id: this.nextId("s"),
          x: enemy.x,
          y: enemy.y,
          fromX: enemy.x,
          fromY: enemy.y,
          damage: foe.atk,
          targetId: target.id,
          side: "foe",
          ink: foe.ink,
          typeId: enemy.kind,
          vfx: foe.vfx,
          sourceId: enemy.id,
          style: foe.style,
          motion: foe.motion,
          strike: foe.style === "melee" ? foe.strike : 0,
          speed: foe.style === "ranged" ? foe.shotSpeed : 0,
          age: 0
        });
      }
      for (const id of this.foeCooldown.keys()) {
        if (!alive.has(id)) {
          this.foeCooldown.delete(id);
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
        if (inRange(x, y, enemy.x, enemy.y, range) && d < bestD) {
          bestD = d;
          best = enemy;
        }
      }
      return best;
    }
    nearestToken(x, y, range) {
      let best = null;
      let bestD = Infinity;
      for (const token of this.tokens) {
        if (token.place !== "grid" || token.hp <= 0) {
          continue;
        }
        const pos = tokenPosition(this.config, token);
        const d = Math.hypot(pos.x - x, pos.y - y);
        if (inRange(x, y, pos.x, pos.y, range) && d < bestD) {
          bestD = d;
          best = token;
        }
      }
      return best;
    }
    tickShots(dt) {
      const hitRadius = this.config.board.hitRadius;
      const kept = [];
      for (const shot of this.shots) {
        const target = this.shotPoint(shot);
        if (!target) {
          continue;
        }
        if (shot.style === "melee") {
          shot.age += dt;
          const duration = Math.max(1e-3, shot.strike);
          const t = Math.min(1, shot.age / duration);
          shot.x = shot.fromX + (target.x - shot.fromX) * t;
          shot.y = shot.fromY + (target.y - shot.fromY) * t;
          if (shot.age >= shot.strike) {
            target.hit(shot.damage);
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
          target.hit(shot.damage);
        } else {
          shot.x += dx / dist * step;
          shot.y += dy / dist * step;
          shot.age += dt;
          kept.push(shot);
        }
      }
      this.shots = kept;
    }
    shotPoint(shot) {
      if (shot.side === "foe") {
        const token = this.tokens.find((entry) => entry.id === shot.targetId && entry.hp > 0 && entry.place === "grid");
        if (!token) {
          return null;
        }
        const pos = tokenPosition(this.config, token);
        return { x: pos.x, y: pos.y, hit: (amount) => this.applyTokenDamage(token, amount) };
      }
      const enemy = this.enemies.find((entry) => entry.id === shot.targetId && entry.hp > 0);
      if (!enemy) {
        return null;
      }
      return { x: enemy.x, y: enemy.y, hit: (amount) => this.applyDamage(enemy, amount) };
    }
    shotHasTarget(shot) {
      return this.shotPoint(shot) !== null;
    }
    applyTokenDamage(token, amount) {
      if (token.hp <= 0) {
        return;
      }
      token.hp -= amount;
      const pos = tokenPosition(this.config, token);
      this.pushFloat(pos.x, pos.y, `${Math.round(amount)}`);
      if (token.hp <= 0) {
        token.hp = 0;
        this.cooldown.delete(token.id);
      }
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
        enemy.distance += enemy.speed * dt;
        if (enemy.distance >= road.total) {
          this.leak(enemy);
        } else {
          const point = pointOnPath(road, enemy.distance);
          enemy.x = point.x;
          enemy.y = point.y;
        }
      }
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
      if (this.phase !== "playing" || this.betweenWaves) {
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
        this.phase = "win";
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
      this.floats.push({ id: this.nextId("f"), x, y, text, age: 0 });
      if (this.floats.length > 20) {
        this.floats.shift();
      }
    }
  };
  function tokenPosition(config, token) {
    return token.place === "grid" ? gridPosition(config.board, token.slot) : benchPosition(config.board, token.slot);
  }

  // src/view/theme.ts
  var Ink = {
    paper: "#f3e6c8",
    paperDeep: "#e7d3ae",
    ink: "#1d2b38",
    cinnabar: "#b4332a",
    moss: "#2f6b4f",
    mist: "#3d6f8a",
    gold: "#c6a15a",
    brown: "#4a3728",
    cream: "#f7f1e4"
  };
  var RANK = ["", "\u4E00", "\u4E8C", "\u4E09", "\u56DB", "\u4E94", "\u516D", "\u4E03", "\u516B", "\u4E5D"];
  var MARK = {
    move: Ink.moss,
    merge: Ink.gold,
    swap: Ink.mist
  };
  function tierScale(level) {
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
  function tierRankColor(level) {
    if (level >= 4) {
      return "#8a5a12";
    }
    if (level >= 3) {
      return "#8d2e2a";
    }
    if (level >= 2) {
      return Ink.ink;
    }
    return Ink.brown;
  }
  function hexAlpha(hex, alpha) {
    const raw = hex.replace("#", "");
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function paintTier(g, level, ink) {
    g.clear();
    const rings = Math.min(4, Math.max(1, level));
    const gold = level >= 4;
    for (let i = 0; i < rings; i += 1) {
      const outer = i === rings - 1;
      g.drawCircle(0, 0, 34 + i * 5, null, outer && gold ? Ink.gold : ink, outer ? 2.2 + level : 1.4);
    }
    if (level >= 2) {
      const orbit = 30 + rings * 5;
      const mark = gold ? Ink.gold : ink;
      const marks = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1]
      ];
      for (const [sx, sy] of marks) {
        g.drawCircle(sx * orbit * 0.7, sy * orbit * 0.7, level >= 3 ? 3.4 : 2.2, mark, null, 0);
      }
    }
    if (level >= 3) {
      g.drawCircle(0, 0, 16, null, gold ? Ink.gold : ink, 2);
    }
  }

  // src/view/InkGuardView.ts
  var HINT = "\u5317\u8425\u6CBF\u58A8\u8DEF\u5357\u4E0B\u3002\u5200\u9A91\u5B88\u524D\u6392\uFF0C\u67AA\u9760\u524D\uFF0C\u5F13\u653E\u540E\u6392\u3002\u70B9\u7A7A\u5904\u53D6\u6D88\u5C04\u7A0B\u3002";
  var GUIDE_HINT = "\u628A\u4E24\u679A\u300C\u5200\u300D\u53E0\u5728\u4E00\u8D77\u3002\u5347\u54C1\u540E\u5708\u7EB9\u4F1A\u53D8\u3002\u70B9\u7A7A\u5904\u53EF\u53D6\u6D88\u5C04\u7A0B\u3002";
  var GUIDE_KEY = "ink-guard-merge-guide";
  var ROW_CAPTION = ["\u524D\u6392", "\u67AA", "\u5F13", "\u540E\u6392"];
  var InkGuardView = class {
    constructor(config, art, fonts) {
      this.config = config;
      this.art = art;
      this.fonts = fonts;
      this.tokens = /* @__PURE__ */ new Map();
      this.enemies = /* @__PURE__ */ new Map();
      this.shots = /* @__PURE__ */ new Map();
      this.floats = /* @__PURE__ */ new Map();
      this.slotMarks = [];
      this.impacts = [];
      this.seenShots = /* @__PURE__ */ new Set();
      this.world = new Laya.Sprite();
      this.boardLayer = new Laya.Sprite();
      this.rangeLayer = new Laya.Sprite();
      this.actorLayer = new Laya.Sprite();
      this.shotLayer = new Laya.Sprite();
      this.dragLayer = new Laya.Sprite();
      this.floatLayer = new Laya.Sprite();
      this.hud = new Laya.Box();
      this.tutorial = new Laya.Box();
      this.overlay = new Laya.Box();
      this.hpFill = new Laya.Sprite();
      this.drag = null;
      this.selectedId = null;
      this.timeScale = 1;
      this.toast = "";
      this.toastTimer = 0;
      this.guidePending = false;
      this.shownPhase = "playing";
      this.clock = 0;
      this.width = config.board.designWidth;
      this.height = config.board.designHeight;
      this.sim = new GameSim(config, seed());
      this.banner = this.makeLabel("", 42, fonts.title, Ink.cinnabar, 420, 0);
      this.waveLabel = this.makeLabel("", 26, fonts.body, Ink.ink, 460, 3);
      this.hpText = this.makeLabel("", 18, fonts.body, Ink.cream, 420, 3);
      this.mantouLabel = this.makeLabel("", 24, fonts.body, Ink.brown, 340, 3);
      this.hintLabel = this.makeLabel(HINT, 20, fonts.body, Ink.brown, 660, 3);
      this.tutorialLabel = this.makeLabel("", 22, fonts.body, Ink.ink, 520, 0);
      this.overlayTitle = this.makeLabel("", 48, fonts.title, Ink.ink, 480, 0);
      this.overlayBody = this.makeLabel("", 24, fonts.body, Ink.brown, 460, 0);
      const recruit = this.makeButton("\u62DB\u52DF", 188, 58, Ink.cinnabar);
      this.recruitPlate = recruit.plate;
      this.recruitButton = recruit.button;
      const speed = this.makeButton("\u5E38\u901F", 160, 52, Ink.ink);
      this.speedButton = speed.button;
      this.speedPlate = speed.plate;
    }
    start() {
      this.buildWorld();
      this.buildHud();
      this.buildTutorial();
      this.buildOverlay();
      this.guidePending = !guideSeen();
      if (this.guidePending) {
        this.grantGuide();
      }
      Laya.stage.on(Laya.Event.MOUSE_DOWN, this, this.onDown);
      Laya.stage.on(Laya.Event.MOUSE_MOVE, this, this.onMove);
      Laya.stage.on(Laya.Event.MOUSE_UP, this, this.onUp);
      this.recruitButton.on(Laya.Event.CLICK, this, this.onRecruit);
      this.speedButton.on(Laya.Event.CLICK, this, this.onSpeed);
      Laya.timer.frameLoop(1, this, this.onFrame);
      this.syncHud();
    }
    buildWorld() {
      const bg = this.makeImage("textures/bg-paper.png", this.width, this.height, 0);
      if (bg) {
        bg.pos(0, 0);
        Laya.stage.addChild(bg);
      } else {
        const wash = new Laya.Sprite();
        wash.graphics.drawRect(0, 0, this.width, this.height, Ink.paper, null, 0);
        wash.mouseEnabled = false;
        Laya.stage.addChild(wash);
      }
      const mountain = this.makeImage("textures/mountain-top.png", this.width, 340, 0);
      if (mountain) {
        mountain.pos(0, 0);
        mountain.alpha = 0.92;
        Laya.stage.addChild(mountain);
      }
      const bamboo = this.makeImage("textures/bamboo.png", 110, 160, 0.5);
      if (bamboo) {
        bamboo.pos(668, 520);
        bamboo.alpha = 0.8;
        Laya.stage.addChild(bamboo);
      }
      this.world.mouseEnabled = false;
      this.world.mouseThrough = true;
      Laya.stage.addChild(this.world);
      for (const layer of [this.boardLayer, this.rangeLayer, this.actorLayer, this.shotLayer, this.dragLayer, this.floatLayer]) {
        layer.mouseEnabled = false;
        layer.mouseThrough = true;
        this.world.addChild(layer);
      }
      this.paintRiver();
      this.paintLanes();
      this.paintSlots();
      this.paintSeals();
      this.paintRowCaptions();
    }
    buildHud() {
      this.hud.size(this.width, 280);
      this.hud.mouseEnabled = true;
      const panel = this.makeImage("textures/panel-paper.png", 688, 248, 0);
      if (panel) {
        panel.pos(16, 12);
        panel.alpha = 0.94;
        panel.mouseEnabled = false;
        this.hud.addChild(panel);
      } else {
        this.hud.graphics.drawRoundRect(16, 12, 688, 248, 18, 18, 18, 18, hexAlpha(Ink.paper, 0.92), Ink.brown, 2);
      }
      const title = this.makeLabel("\u58A8\u536B", 56, this.fonts.title, Ink.ink, 220, 0);
      title.anchorX = 0;
      title.align = "left";
      title.pos(36, 48);
      this.hud.addChild(title);
      this.waveLabel.anchorX = 0;
      this.waveLabel.align = "left";
      this.waveLabel.pos(36, 108);
      this.hud.addChild(this.waveLabel);
      const kinds = this.makeLabel(this.kindLine(), 20, this.fonts.body, Ink.brown, 640, 2);
      kinds.anchorX = 0;
      kinds.align = "left";
      kinds.pos(36, 146);
      this.hud.addChild(kinds);
      const track = new Laya.Sprite();
      track.pos(36, 184);
      track.mouseEnabled = false;
      track.graphics.drawRoundRect(0, 0, 280, 20, 8, 8, 8, 8, "#d5c4a4", Ink.brown, 2);
      this.hpFill.pos(36, 184);
      this.hpFill.mouseEnabled = false;
      this.hud.addChild(track);
      this.hud.addChild(this.hpFill);
      this.hpText.anchorX = 0;
      this.hpText.align = "left";
      this.hpText.color = Ink.ink;
      this.hpText.pos(328, 194);
      this.hud.addChild(this.hpText);
      this.mantouLabel.anchorX = 0;
      this.mantouLabel.align = "left";
      this.mantouLabel.pos(36, 230);
      this.hud.addChild(this.mantouLabel);
      this.recruitPlate.pos(500, 176);
      this.hud.addChild(this.recruitPlate);
      this.speedPlate.pos(528, 22);
      this.hud.addChild(this.speedPlate);
      this.hintLabel.wordWrap = true;
      this.hintLabel.height = 64;
      this.hintLabel.pos(this.width / 2, 1236);
      Laya.stage.addChild(this.hud);
      Laya.stage.addChild(this.hintLabel);
      this.banner.pos(this.width / 2, 390);
      this.banner.visible = false;
      this.banner.mouseEnabled = false;
      Laya.stage.addChild(this.banner);
    }
    buildTutorial() {
      this.tutorial.size(688, 118);
      this.tutorial.pos(16, 1148);
      this.tutorial.graphics.drawRoundRect(0, 0, 688, 118, 16, 16, 16, 16, hexAlpha(Ink.paper, 0.96), Ink.gold, 3);
      this.tutorialLabel.text = "\u5F00\u5C40\u6709\u4E24\u679A\u300C\u5200\u300D\u3002\u62D6\u5230\u4E00\u8D77\u5C31\u5347\u54C1\uFF0C\u5708\u7EB9\u4F1A\u53D8\u3002\u5200\u9A91\u653E\u524D\u6392\uFF0C\u5F13\u653E\u540E\u6392\u3002";
      this.tutorialLabel.wordWrap = true;
      this.tutorialLabel.height = 52;
      this.tutorialLabel.pos(344, 36);
      this.tutorial.addChild(this.tutorialLabel);
      const ok = this.makeButton("\u77E5\u9053\u4E86", 160, 44, Ink.moss);
      ok.plate.pos(264, 64);
      ok.button.on(Laya.Event.CLICK, this, this.onGuideDismiss);
      this.tutorial.addChild(ok.plate);
      this.tutorial.visible = this.guidePending;
      Laya.stage.addChild(this.tutorial);
    }
    buildOverlay() {
      this.overlay.size(this.width, this.height);
      this.overlay.graphics.drawRect(0, 0, this.width, this.height, hexAlpha(Ink.ink, 0.55), null, 0);
      this.overlay.mouseEnabled = true;
      this.overlay.visible = false;
      const card = new Laya.Box();
      card.size(520, 320);
      card.pos((this.width - 520) / 2, 430);
      card.graphics.drawRoundRect(0, 0, 520, 320, 18, 18, 18, 18, Ink.paper, Ink.gold, 3);
      card.mouseEnabled = true;
      this.overlayTitle.pos(260, 78);
      this.overlayBody.wordWrap = true;
      this.overlayBody.height = 90;
      this.overlayBody.pos(260, 160);
      card.addChild(this.overlayTitle);
      card.addChild(this.overlayBody);
      const again = this.makeButton("\u518D\u5B88\u4E00\u9635", 220, 58, Ink.cinnabar);
      again.plate.pos(150, 230);
      again.button.on(Laya.Event.CLICK, this, this.onRestart);
      card.addChild(again.plate);
      this.overlay.addChild(card);
      Laya.stage.addChild(this.overlay);
    }
    paintRiver() {
      const river = this.config.board.river;
      if (!river) {
        return;
      }
      const image = this.makeImage("textures/river.png", river.w, river.h, 0.5);
      const at = this.toStage(river.x, river.y);
      if (image) {
        image.pos(at.x, at.y);
        this.boardLayer.addChild(image);
      }
    }
    paintLanes() {
      const pen = new Laya.Sprite();
      pen.mouseEnabled = false;
      const lanes = boardLanes(this.config.board);
      for (const lane of lanes) {
        const points = [];
        for (const point of lane) {
          const at = this.toStage(point.x, point.y);
          points.push(at.x, at.y);
        }
        if (points.length < 4) {
          continue;
        }
        pen.graphics.drawLines(0, 0, points, hexAlpha("#4f7c90", 0.45), 26);
        pen.graphics.drawLines(0, 0, points, hexAlpha(Ink.cream, 0.92), 9);
      }
      this.boardLayer.addChild(pen);
    }
    paintSlots() {
      const board = this.config.board;
      const gridCount = board.gridCols * board.gridRows;
      for (let i = 0; i < gridCount; i += 1) {
        this.addSlot("grid", i, gridPosition(board, i), board.cellSize);
      }
      for (let i = 0; i < board.benchSlots; i += 1) {
        this.addSlot("bench", i, benchPosition(board, i), board.cellSize);
      }
    }
    addSlot(place, slot, point, size) {
      const at = this.toStage(point.x, point.y);
      const image = this.makeImage("textures/cell.png", size, size, 0.5);
      if (image) {
        image.pos(at.x, at.y);
        image.alpha = place === "bench" ? 0.72 : 1;
        this.boardLayer.addChild(image);
      } else {
        const cell = new Laya.Sprite();
        cell.graphics.drawRoundRect(-size / 2, -size / 2, size, size, 8, 8, 8, 8, hexAlpha(Ink.cream, 0.8), Ink.brown, 2);
        cell.pos(at.x, at.y);
        cell.mouseEnabled = false;
        this.boardLayer.addChild(cell);
      }
      const mark = new Laya.Sprite();
      mark.pos(at.x, at.y);
      mark.mouseEnabled = false;
      this.boardLayer.addChild(mark);
      this.slotMarks.push({ place, slot, node: mark });
    }
    paintSeals() {
      var _a, _b;
      const board = this.config.board;
      const camp = (_a = board.camp) != null ? _a : { x: 0, y: 312 };
      this.addSeal(camp.x, camp.y, "\u5BC7", "\u5317\u8425", "foes/kou.png");
      const end = (_b = board.path[board.path.length - 1]) != null ? _b : { x: 0, y: -8 };
      this.addSeal(end.x, end.y, "\u6597", "\u5357\u5CB8", "textures/seal-adou.png");
    }
    addSeal(x, y, glyph, caption, path) {
      const at = this.toStage(x, y);
      const root = new Laya.Sprite();
      root.pos(at.x, at.y);
      root.mouseEnabled = false;
      const image = this.makeImage(path, 108, 108, 0.5);
      if (image) {
        root.addChild(image);
      } else {
        root.graphics.drawCircle(0, 0, 48, Ink.cream, Ink.cinnabar, 4);
        const text = this.makeLabel(glyph, 40, this.fonts.title, Ink.cinnabar, 80, 0);
        root.addChild(text);
      }
      const cap = this.makeLabel(caption, 18, this.fonts.body, Ink.brown, 80, 3);
      cap.pos(0, 68);
      root.addChild(cap);
      this.boardLayer.addChild(root);
    }
    paintRowCaptions() {
      var _a;
      const board = this.config.board;
      for (let row = 0; row < board.gridRows; row += 1) {
        const point = gridPosition(board, row * board.gridCols);
        const at = this.toStage(point.x - 78, point.y);
        const caption = this.makeLabel((_a = ROW_CAPTION[row]) != null ? _a : "", 16, this.fonts.body, Ink.brown, 70, 3);
        caption.pos(at.x, at.y);
        this.boardLayer.addChild(caption);
      }
      const bench = benchPosition(board, 0);
      const benchAt = this.toStage(bench.x - 70, bench.y);
      const seat = this.makeLabel("\u5E2D\u4F4D", 16, this.fonts.body, Ink.brown, 70, 3);
      seat.pos(benchAt.x, benchAt.y);
      this.boardLayer.addChild(seat);
    }
    onFrame() {
      const real = Math.min(0.05, Math.max(0, Laya.timer.delta / 1e3));
      this.clock += real;
      if (this.toastTimer > 0) {
        this.toastTimer = Math.max(0, this.toastTimer - real);
      }
      if (this.sim.phase === "playing") {
        let left = real * this.timeScale;
        const step = 1 / 60;
        while (left > 0 && this.sim.phase === "playing") {
          const slice = Math.min(step, left);
          this.sim.tick(slice);
          left -= slice;
        }
      }
      this.noteAttacks();
      this.syncTokens();
      this.syncEnemies();
      this.syncShots();
      this.syncFloats();
      this.syncImpacts(real);
      this.paintRange();
      this.paintDragMarks();
      this.syncHud();
    }
    noteAttacks() {
      const live = /* @__PURE__ */ new Set();
      for (const shot of this.sim.shots) {
        live.add(shot.id);
        if (!this.seenShots.has(shot.id)) {
          const token = this.tokens.get(shot.sourceId);
          if (token) {
            token.poseStart = this.clock;
          }
          const enemy = this.enemies.get(shot.sourceId);
          if (enemy) {
            enemy.poseStart = this.clock;
          }
        }
      }
      this.seenShots.clear();
      for (const id of live) {
        this.seenShots.add(id);
      }
    }
    syncTokens() {
      var _a, _b, _c;
      const live = /* @__PURE__ */ new Set();
      for (const token of this.sim.tokens) {
        live.add(token.id);
        const view = (_a = this.tokens.get(token.id)) != null ? _a : this.createToken(token);
        this.tokens.set(token.id, view);
        const drag = this.drag;
        const dragging = (drag == null ? void 0 : drag.id) === token.id;
        const point = dragging && drag ? { x: drag.x, y: drag.y + (drag.touch ? 64 : 0) } : tokenPosition(this.config, token);
        const at = this.toStage(point.x, point.y);
        view.root.pos(at.x, at.y);
        const scale = tierScale(token.level) * (dragging ? 1.08 : 1);
        view.root.scaleX = scale;
        view.root.scaleY = scale;
        const parent = dragging ? this.dragLayer : this.actorLayer;
        if (view.root.parent !== parent) {
          parent.addChild(view.root);
        }
        if (view.level !== token.level) {
          view.level = token.level;
          const type = this.config.units.types[token.type];
          paintTier(view.rings.graphics, token.level, type.ink);
          view.rank.text = `${(_b = RANK[token.level]) != null ? _b : token.level}\u54C1`;
          view.rank.color = tierRankColor(token.level);
        }
        const pose = this.poseTexture(token.type, view.poseStart);
        const idle = (_c = this.art.tex[`textures/unit-${token.type}.png`]) != null ? _c : null;
        const tex = pose != null ? pose : idle;
        if (tex && view.body.texture !== tex) {
          view.body.texture = tex;
        }
        this.paintHp(view.hp, token.place === "grid" ? token.hp / token.maxHp : -1);
      }
      for (const [id, view] of this.tokens) {
        if (!live.has(id)) {
          view.root.removeSelf();
          view.root.destroy();
          this.tokens.delete(id);
        }
      }
    }
    createToken(token) {
      var _a, _b;
      const type = this.config.units.types[token.type];
      const root = new Laya.Sprite();
      root.mouseEnabled = false;
      root.name = `Token-${token.type}`;
      const body = new Laya.Sprite();
      body.anchorX = 0.5;
      body.anchorY = 0.5;
      body.size(78, 78);
      body.mouseEnabled = false;
      body.texture = (_a = this.art.tex[`textures/unit-${token.type}.png`]) != null ? _a : null;
      root.addChild(body);
      let glyph = null;
      if (!body.texture) {
        root.graphics.drawCircle(0, 0, 36, type.ink, Ink.cream, 2);
        glyph = this.makeLabel(type.glyph, 36, this.fonts.title, Ink.cream, 72, 0);
        root.addChild(glyph);
      }
      const rings = new Laya.Sprite();
      rings.mouseEnabled = false;
      paintTier(rings.graphics, token.level, type.ink);
      root.addChild(rings);
      const style = this.makeLabel(`${type.styleLabel}\xB7${type.motionLabel}`, 14, this.fonts.body, Ink.ink, 92, 3);
      style.pos(0, 50);
      const rank = this.makeLabel(`${(_b = RANK[token.level]) != null ? _b : token.level}\u54C1`, 16, this.fonts.body, tierRankColor(token.level), 72, 3);
      rank.pos(0, -50);
      const hp = new Laya.Sprite();
      hp.mouseEnabled = false;
      root.addChild(style);
      root.addChild(rank);
      root.addChild(hp);
      this.actorLayer.addChild(root);
      return { root, body, glyph, rings, style, rank, hp, level: token.level, poseStart: 0 };
    }
    syncEnemies() {
      const live = /* @__PURE__ */ new Set();
      this.sim.enemies.forEach((enemy, index) => {
        var _a, _b;
        live.add(enemy.id);
        const view = (_a = this.enemies.get(enemy.id)) != null ? _a : this.createEnemy(enemy.kind);
        this.enemies.set(enemy.id, view);
        const bob = Math.sin(this.clock * 3 + index) * 2;
        const at = this.toStage(enemy.x, enemy.y + bob);
        view.root.pos(at.x, at.y);
        const pose = this.poseTexture(enemy.kind, view.poseStart);
        const idle = (_b = this.art.tex[`foes/${enemy.kind}.png`]) != null ? _b : null;
        const tex = pose != null ? pose : idle;
        if (tex && view.body.texture !== tex) {
          view.body.texture = tex;
        }
        this.paintHp(view.hp, enemy.maxHp <= 0 ? 0 : enemy.hp / enemy.maxHp);
      });
      for (const [id, view] of this.enemies) {
        if (!live.has(id)) {
          view.root.removeSelf();
          view.root.destroy();
          this.enemies.delete(id);
        }
      }
    }
    createEnemy(kind) {
      var _a, _b, _c, _d;
      const foe = this.config.foes.types[kind];
      const root = new Laya.Sprite();
      root.mouseEnabled = false;
      root.name = `Foe-${kind}`;
      const body = new Laya.Sprite();
      body.anchorX = 0.5;
      body.anchorY = 0.5;
      body.size(56, 56);
      body.mouseEnabled = false;
      body.texture = (_a = this.art.tex[`foes/${kind}.png`]) != null ? _a : null;
      root.addChild(body);
      let glyph = null;
      if (!body.texture) {
        root.graphics.drawCircle(0, 0, 24, (_b = foe == null ? void 0 : foe.ink) != null ? _b : Ink.ink, Ink.cream, 2);
        glyph = this.makeLabel((_c = foe == null ? void 0 : foe.glyph) != null ? _c : "\u5BC7", 22, this.fonts.title, Ink.cream, 48, 0);
        root.addChild(glyph);
      }
      const style = this.makeLabel((_d = foe == null ? void 0 : foe.styleLabel) != null ? _d : "", 13, this.fonts.body, Ink.ink, 64, 3);
      style.pos(0, 40);
      const hp = new Laya.Sprite();
      hp.mouseEnabled = false;
      root.addChild(style);
      root.addChild(hp);
      this.actorLayer.addChild(root);
      return { root, body, glyph, style, hp, poseStart: 0 };
    }
    syncShots() {
      var _a;
      const live = /* @__PURE__ */ new Set();
      for (const shot of this.sim.shots) {
        live.add(shot.id);
        const view = (_a = this.shots.get(shot.id)) != null ? _a : this.createShot(shot);
        this.shots.set(shot.id, view);
        this.paintShot(view, shot);
      }
      for (const [id, view] of this.shots) {
        if (!live.has(id)) {
          this.spawnImpact(view.root.x, view.root.y, Ink.cinnabar);
          view.root.removeSelf();
          view.root.destroy();
          this.shots.delete(id);
        }
      }
    }
    createShot(shot) {
      const root = new Laya.Sprite();
      root.mouseEnabled = false;
      const arrow = shot.style === "ranged" ? this.makeImage("fx/gong-arrow.png", 72, 28, 0.5) : null;
      if (arrow) {
        root.addChild(arrow);
      }
      this.shotLayer.addChild(root);
      return { root, arrow };
    }
    paintShot(view, shot) {
      var _a;
      const at = this.toStage(shot.x, shot.y);
      const from = this.toStage(shot.fromX, shot.fromY);
      view.root.pos(at.x, at.y);
      const aim = (_a = this.shotAim(shot)) != null ? _a : { x: shot.x, y: shot.y };
      const aimStage = this.toStage(aim.x, aim.y);
      view.root.rotation = Math.atan2(aimStage.y - from.y, aimStage.x - from.x) * 180 / Math.PI;
      const g = view.root.graphics;
      g.clear();
      if (shot.style === "ranged") {
        if (view.arrow) {
          view.arrow.visible = true;
          return;
        }
        g.drawLine(-28, 0, 16, 0, shot.ink, 3);
        g.drawLine(16, 0, 6, -7, shot.ink, 3);
        g.drawLine(16, 0, 6, 7, shot.ink, 3);
        return;
      }
      if (view.arrow) {
        view.arrow.visible = false;
      }
      const reach = Math.hypot(at.x - from.x, at.y - from.y);
      if (shot.motion === "thrust" || shot.motion === "charge") {
        g.drawLine(-reach, 0, 10, 0, shot.ink, shot.motion === "charge" ? 8 : 4);
        g.drawLine(14, 0, 0, -8, shot.ink, 3);
        g.drawLine(14, 0, 0, 8, shot.ink, 3);
        return;
      }
      g.drawLine(-18, 14, 20, -16, shot.ink, 5);
      g.drawCircle(16, -12, 5, null, shot.ink, 3);
    }
    shotAim(shot) {
      if (shot.side === "foe") {
        const token = this.sim.tokens.find((entry) => entry.id === shot.targetId && entry.place === "grid");
        return token ? tokenPosition(this.config, token) : null;
      }
      const enemy = this.sim.enemies.find((entry) => entry.id === shot.targetId);
      return enemy ? { x: enemy.x, y: enemy.y } : null;
    }
    syncFloats() {
      const live = /* @__PURE__ */ new Set();
      for (const floater of this.sim.floats) {
        live.add(floater.id);
        let view = this.floats.get(floater.id);
        if (!view) {
          const label = this.makeLabel(floater.text, 20, this.fonts.body, Ink.cinnabar, 80, 3);
          this.floatLayer.addChild(label);
          view = { label };
          this.floats.set(floater.id, view);
        }
        const at = this.toStage(floater.x, floater.y);
        view.label.pos(at.x, at.y - floater.age * 36);
        view.label.alpha = 1 - floater.age / 0.7;
      }
      for (const [id, view] of this.floats) {
        if (!live.has(id)) {
          view.label.removeSelf();
          view.label.destroy();
          this.floats.delete(id);
        }
      }
    }
    syncImpacts(dt) {
      for (const impact of this.impacts) {
        impact.age += dt;
        impact.node.alpha = Math.max(0, 1 - impact.age / 0.2);
        impact.node.scaleX = 1 + impact.age * 3;
        impact.node.scaleY = 1 + impact.age * 3;
      }
      for (let i = this.impacts.length - 1; i >= 0; i -= 1) {
        const impact = this.impacts[i];
        if (impact.age >= 0.2) {
          impact.node.removeSelf();
          impact.node.destroy();
          this.impacts.splice(i, 1);
        }
      }
    }
    spawnImpact(x, y, color) {
      const node = new Laya.Sprite();
      node.graphics.drawCircle(0, 0, 10, null, color, 3);
      node.pos(x, y);
      node.mouseEnabled = false;
      this.floatLayer.addChild(node);
      this.impacts.push({ node, age: 0 });
    }
    paintRange() {
      var _a, _b;
      const g = this.rangeLayer.graphics;
      g.clear();
      const id = (_b = (_a = this.drag) == null ? void 0 : _a.id) != null ? _b : this.selectedId;
      if (!id) {
        return;
      }
      const token = this.sim.tokens.find((entry) => entry.id === id);
      if (!token) {
        this.selectedId = null;
        return;
      }
      const stat = this.sim.statOf(token.type, token.level);
      const type = this.config.units.types[token.type];
      const at = this.drag ? { x: this.drag.x, y: this.drag.y } : tokenPosition(this.config, token);
      const center = this.toStage(at.x, at.y);
      g.drawCircle(center.x, center.y, stat.range, hexAlpha(type.ink, 0.1), hexAlpha(type.ink, 0.55), 3);
      g.drawCircle(center.x, center.y, Math.max(4, stat.range - 8), null, hexAlpha(type.ink, 0.22), 1);
      for (const lane of boardLanes(this.config.board)) {
        for (const mark of pathMarksWithin(lane, at.x, at.y, stat.range)) {
          const point = this.toStage(mark.x, mark.y);
          g.drawCircle(point.x, point.y, 4.5, type.ink, null, 0);
        }
      }
      for (const slot of slotsWithin(this.config.board, at.x, at.y, stat.range)) {
        const point = gridPosition(this.config.board, slot);
        const stage = this.toStage(point.x, point.y);
        g.drawCircle(stage.x, stage.y, 5, hexAlpha(type.ink, 0.4), null, 0);
      }
    }
    paintDragMarks() {
      const active = this.drag ? dropSlotAt(this.config.board, this.drag.x, this.drag.y) : null;
      for (const mark of this.slotMarks) {
        mark.node.graphics.clear();
        if (!this.drag) {
          continue;
        }
        const kind = this.sim.previewDrop(this.drag.id, mark.place, mark.slot);
        if (kind !== "move" && kind !== "merge" && kind !== "swap") {
          continue;
        }
        const hot = (active == null ? void 0 : active.place) === mark.place && active.slot === mark.slot;
        const radius = this.config.board.cellSize / 2 + (hot ? 6 : 2);
        mark.node.graphics.drawCircle(0, 0, radius, null, hexAlpha(MARK[kind], hot ? 0.95 : 0.55), hot ? 5 : 3);
      }
    }
    syncHud() {
      const hp = Math.max(0, Math.round(this.sim.adouHp));
      const maxHp = this.config.adou.maxHp;
      const ratio = maxHp <= 0 ? 0 : hp / maxHp;
      this.hpFill.graphics.clear();
      this.hpFill.graphics.drawRoundRect(0, 0, Math.max(0, 280 * ratio), 20, 8, 8, 8, 8, ratio > 0.35 ? Ink.moss : Ink.cinnabar, null, 0);
      this.hpText.text = `\u963F\u6597 ${hp}/${maxHp}`;
      this.mantouLabel.text = `\u9992\u5934 ${Math.floor(this.sim.mantou)}  +${this.config.economy.incomePerSecond}/\u79D2`;
      const cost = this.sim.nextCost();
      this.recruitButton.label = `\u62DB\u52DF ${cost}`;
      const ready = this.sim.phase === "playing" && this.sim.mantou >= cost && this.sim.hasBenchRoom();
      this.paintPlate(this.recruitPlate, 188, 58, ready ? Ink.cinnabar : "#8d8274");
      const head = `\u7B2C ${this.sim.waveNumber} / ${this.sim.waveTotal} \u6CE2`;
      if (this.sim.phase !== "playing") {
        this.waveLabel.text = head;
      } else if (this.sim.betweenWaves) {
        this.waveLabel.text = `${head} \xB7 \u5907\u58A8 ${Math.ceil(this.sim.betweenTimer)}s`;
      } else {
        this.waveLabel.text = `${head} \xB7 \u6765\u654C ${this.sim.enemies.length}`;
      }
      this.hintLabel.visible = !this.guidePending || this.toastTimer > 0;
      this.hintLabel.text = this.toastTimer > 0 ? this.toast : this.guidePending ? GUIDE_HINT : HINT;
      this.hintLabel.color = this.toastTimer > 0 ? Ink.cinnabar : Ink.brown;
      const showBanner = this.sim.phase === "playing" && this.sim.bannerTimer > 0;
      this.banner.visible = showBanner;
      if (showBanner) {
        this.banner.text = this.sim.banner;
        this.banner.alpha = Math.min(1, this.sim.bannerTimer / 0.25);
      }
      this.speedButton.label = this.timeScale === 1 ? "\u5E38\u901F" : "\u4E09\u500D";
      if (this.sim.phase !== "playing" && this.shownPhase !== this.sim.phase) {
        this.shownPhase = this.sim.phase;
        this.overlay.visible = true;
        if (this.sim.phase === "win") {
          this.overlayTitle.text = "\u58A8\u9635\u5DF2\u7A33";
          this.overlayBody.text = `\u5B88\u4F4F\u4E86\u5168\u90E8 ${this.sim.waveTotal} \u6CE2\uFF0C\u963F\u6597\u8FD8\u5269 ${hp} \u70B9\u6C14\u8840\u3002`;
        } else {
          this.overlayTitle.text = "\u58A8\u9635\u7834\u4E86";
          this.overlayBody.text = "\u963F\u6597\u6C14\u8840\u89C1\u5E95\u3002\u91CD\u6574\u65D7\u9F13\uFF0C\u518D\u5B88\u4E00\u9635\u3002";
        }
      }
    }
    onDown(event) {
      var _a;
      if (this.overlay.visible || this.sim.phase !== "playing" || this.drag) {
        return;
      }
      if (this.isChrome(event.target)) {
        this.selectedId = null;
        return;
      }
      const point = this.boardPointer();
      const token = this.tokenAt(point.x, point.y);
      if (!token) {
        this.selectedId = null;
        return;
      }
      this.selectedId = token.id;
      const touch = ((_a = event.nativeEvent) == null ? void 0 : _a.pointerType) === "touch";
      this.drag = { id: token.id, x: point.x, y: point.y, touch };
    }
    onMove() {
      if (!this.drag) {
        return;
      }
      const point = this.boardPointer();
      this.drag.x = point.x;
      this.drag.y = point.y;
    }
    onUp() {
      if (!this.drag) {
        return;
      }
      const point = this.boardPointer();
      const tokenId = this.drag.id;
      this.drag = null;
      const slot = dropSlotAt(this.config.board, point.x, point.y);
      if (!slot) {
        return;
      }
      const result = this.sim.drop(tokenId, slot.place, slot.slot);
      if (!result.ok) {
        this.showToast(result.reason === "max-level" ? "\u5DF2\u662F\u6700\u9AD8\u54C1" : "\u8FD9\u91CC\u653E\u4E0D\u4E0B");
        return;
      }
      if (result.action === "merge" && this.guidePending) {
        this.completeGuide();
      }
    }
    onRecruit() {
      this.selectedId = null;
      if (this.sim.phase !== "playing" || this.drag) {
        return;
      }
      const result = this.sim.recruit();
      if (!result.ok) {
        this.showToast(result.reason === "broke" ? "\u9992\u5934\u4E0D\u591F" : "\u5E2D\u4F4D\u5DF2\u6EE1");
      }
    }
    onSpeed() {
      this.selectedId = null;
      this.timeScale = this.timeScale === 1 ? 3 : 1;
      this.speedButton.label = this.timeScale === 1 ? "\u5E38\u901F" : "\u4E09\u500D";
    }
    onGuideDismiss() {
      this.completeGuide();
    }
    onRestart() {
      this.drag = null;
      this.selectedId = null;
      this.timeScale = 1;
      this.toast = "";
      this.toastTimer = 0;
      this.shownPhase = "playing";
      this.overlay.visible = false;
      this.speedButton.label = "\u5E38\u901F";
      this.sim.reset(seed());
      if (this.guidePending) {
        this.grantGuide();
      }
    }
    grantGuide() {
      this.sim.placeGuideToken("dao", "bench", 0);
      this.sim.placeGuideToken("dao", "bench", 1);
      this.tutorial.visible = true;
    }
    completeGuide() {
      this.guidePending = false;
      this.tutorial.visible = false;
      try {
        localStorage.setItem(GUIDE_KEY, "1");
      } catch (e) {
      }
    }
    showToast(message) {
      this.toast = message;
      this.toastTimer = 1.8;
    }
    tokenAt(x, y) {
      let best = null;
      let bestD = 46;
      for (const token of this.sim.tokens) {
        const pos = tokenPosition(this.config, token);
        const distance = Math.hypot(pos.x - x, pos.y - y);
        if (distance <= bestD) {
          bestD = distance;
          best = token;
        }
      }
      return best;
    }
    boardPointer() {
      return {
        x: Laya.stage.mouseX - this.width / 2,
        y: this.height / 2 - Laya.stage.mouseY
      };
    }
    toStage(x, y) {
      return { x: this.width / 2 + x, y: this.height / 2 - y };
    }
    isChrome(target) {
      return this.isUnder(target, this.hud) || this.isUnder(target, this.tutorial) || this.isUnder(target, this.overlay);
    }
    isUnder(node, root) {
      let current = node;
      while (current) {
        if (current === root) {
          return true;
        }
        current = current.parent;
      }
      return false;
    }
    kindLine() {
      return this.config.foes.order.map((id) => {
        const foe = this.config.foes.types[id];
        return `${foe.glyph} ${foe.styleLabel}`;
      }).join(" \xB7 ");
    }
    poseTexture(id, start) {
      var _a;
      if (start <= 0) {
        return null;
      }
      const age = this.clock - start;
      if (age < 0 || age > 0.36) {
        return null;
      }
      const frames = [0, 1, 2, 3].map((frame) => this.art.tex[`pose/${id}-${frame}.png`]).filter((tex) => !!tex);
      if (frames.length === 0) {
        return null;
      }
      const index = Math.min(frames.length - 1, Math.floor(age / 0.36 * frames.length));
      return (_a = frames[index]) != null ? _a : null;
    }
    paintHp(node, ratio) {
      node.graphics.clear();
      if (ratio < 0) {
        return;
      }
      node.graphics.drawRect(-18, -46, 36, 5, hexAlpha(Ink.ink, 0.35), null, 0);
      node.graphics.drawRect(-18, -46, 36 * Math.max(0, Math.min(1, ratio)), 5, ratio > 0.35 ? Ink.moss : Ink.cinnabar, null, 0);
    }
    paintPlate(plate, w, h, fill) {
      plate.graphics.clear();
      plate.graphics.drawRoundRect(0, 0, w, h, 14, 14, 14, 14, fill, Ink.brown, 2);
    }
    makeLabel(text, size, font, color, width, stroke) {
      const label = new Laya.Label();
      label.text = text;
      label.fontSize = size;
      label.font = font;
      label.color = color;
      label.align = "center";
      label.valign = "middle";
      label.width = width;
      label.height = size + 10;
      label.anchorX = 0.5;
      label.anchorY = 0.5;
      label.stroke = stroke;
      label.strokeColor = Ink.paper;
      label.mouseEnabled = false;
      return label;
    }
    makeButton(text, w, h, fill) {
      const plate = new Laya.Box();
      plate.size(w, h);
      this.paintPlate(plate, w, h, fill);
      const button = new Laya.Button(null, text);
      button.labelSize = Math.min(28, Math.floor(h * 0.46));
      button.labelColors = `${Ink.cream},#ffffff,${Ink.paper}`;
      button.labelFont = this.fonts.body;
      button.labelBold = true;
      button.stateNum = 1;
      button.size(w, h);
      plate.addChild(button);
      return { plate, button };
    }
    makeImage(path, w, h, anchor) {
      const tex = this.art.tex[path];
      if (!tex) {
        return null;
      }
      const image = new Laya.Image();
      image.source = tex;
      image.anchorX = anchor;
      image.anchorY = anchor;
      image.mouseEnabled = false;
      const sw = tex.sourceWidth || tex.width || w;
      const sh = tex.sourceHeight || tex.height || h;
      if (sw > 0 && sh > 0) {
        image.scaleX = w / sw;
        image.scaleY = h / sh;
      }
      return image;
    }
  };
  function seed() {
    return Date.now() % 2147483647;
  }
  function guideSeen() {
    try {
      return localStorage.getItem(GUIDE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  // src/Main.ts
  var { regClass } = Laya;
  var Main = class extends Laya.Script {
    onAwake() {
      bootInkGuard();
    }
  };
  Main = __decorateClass([
    regClass()
  ], Main);
  var started = false;
  function bootInkGuard() {
    if (started) {
      return;
    }
    started = true;
    if (Laya.stage) {
      fitStage();
      void launch();
      return;
    }
    void Laya.init(720, 1280).then(() => {
      fitStage();
      return launch();
    }).catch((error) => {
      started = false;
      report(error);
    });
  }
  function fitStage() {
    Laya.stage.scaleMode = Laya.Stage.SCALE_FIXED_WIDTH;
    Laya.stage.screenMode = Laya.Stage.SCREEN_VERTICAL;
    Laya.stage.alignH = Laya.Stage.ALIGN_CENTER;
    Laya.stage.alignV = Laya.Stage.ALIGN_MIDDLE;
    Laya.stage.bgColor = "#f3e6c8";
    if (Laya.stage.width !== 720 || Laya.stage.height !== 1280) {
      Laya.stage.size(720, 1280);
    }
  }
  async function launch() {
    const loading = statusLabel("\u7814\u58A8\u4E2D\u2026");
    try {
      const fonts = await loadFonts();
      const config = await loadGameConfig();
      const art = await loadArt();
      loading.removeSelf();
      loading.destroy();
      new InkGuardView(config, art, fonts).start();
    } catch (error) {
      loading.text = error instanceof Error ? error.message : "\u914D\u7F6E\u6CA1\u6709\u8BFB\u51FA\u6765";
      loading.color = "#b4332a";
    }
  }
  function statusLabel(text) {
    const label = new Laya.Label();
    label.text = text;
    label.fontSize = 28;
    label.color = "#1d2b38";
    label.align = "center";
    label.valign = "middle";
    label.width = 640;
    label.height = 80;
    label.anchorX = 0.5;
    label.anchorY = 0.5;
    label.pos(360, 640);
    label.wordWrap = true;
    Laya.stage.addChild(label);
    return label;
  }
  function report(error) {
    const message = error instanceof Error ? error.message : "LayaAir \u6CA1\u6709\u542F\u52A8";
    if (Laya.stage) {
      statusLabel(message);
      return;
    }
    const node = document.createElement("p");
    node.textContent = message;
    document.body.appendChild(node);
  }
  if (typeof window !== "undefined" && window.__INK_GUARD_STANDALONE__) {
    bootInkGuard();
  }
})();
