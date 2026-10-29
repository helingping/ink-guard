/**
 * Headless check that the Laya port still speaks the Cocos rules.
 * Run from laya-ink-guard/: npx --yes tsx tools/self-check.ts
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameConfig } from "../src/config/ConfigTypes";
import { normalizeConfig } from "../src/config/validateConfig";
import type { Token } from "../src/logic/GameSim";
import { GameSim } from "../src/logic/GameSim";
import { benchPosition, boardLanes, dropSlotAt, gridPosition, inRange } from "../src/logic/geometry";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const canon = join(root, "ink-guard/assets/resources/configs");
const local = join(root, "laya-ink-guard/assets/resources/configs");
const files = ["units", "foes", "economy", "adou", "waves", "board"] as const;
const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) {
    failures.push(message);
    console.error(`FAIL ${message}`);
    return;
  }
  console.log(`PASS ${message}`);
}

function loadRaw(dir: string): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const name of files) {
    raw[name] = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")) as unknown;
  }
  return raw;
}

function bestToken(sim: GameSim, bench: Token[]): Token {
  return [...bench].sort((a, b) => {
    const left = sim.statOf(a.type, a.level);
    const right = sim.statOf(b.type, b.level);
    if (b.level !== a.level) {
      return b.level - a.level;
    }
    if (right.range !== left.range) {
      return right.range - left.range;
    }
    return right.atk - left.atk;
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
        return result.ok && result.action === "merge";
      }
    }
  }
  return false;
}

function deployOne(sim: GameSim, smart: boolean): boolean {
  const bench = sim.tokens.filter((token) => token.place === "bench");
  if (bench.length === 0) {
    return false;
  }
  const used = new Set(sim.tokens.filter((token) => token.place === "grid").map((token) => token.slot));
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
  const result = sim.drop(token.id, "grid", slot);
  return result.ok && result.action === "move";
}

function decide(sim: GameSim, mode: "idle" | "place" | "smart"): void {
  if (mode === "idle") {
    return;
  }
  const smart = mode === "smart";
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

function run(config: GameConfig, seed: number, mode: "idle" | "place" | "smart", maxTime: number): { phase: string; hp: number; merges: number } {
  const sim = new GameSim(config, seed);
  let next = 0;
  const step = 1 / 60;
  while (sim.phase === "playing" && sim.time < maxTime) {
    if (sim.time + 1e-6 >= next) {
      decide(sim, mode);
      next += 0.5;
    }
    sim.tick(step);
  }
  return { phase: sim.phase, hp: sim.adouHp, merges: sim.mergeCount };
}

for (const name of files) {
  const left = readFileSync(join(canon, `${name}.json`), "utf8");
  const right = readFileSync(join(local, `${name}.json`), "utf8");
  check(left === right, `${name}.json matches the Cocos config`);
}

const config = normalizeConfig(loadRaw(canon));
check(config.board.gridCols === 5 && config.board.gridRows === 4, "south bank is 5x4");
check(config.board.lanes.length === 3, "three ink lanes");
const ends = boardLanes(config.board).map((lane) => lane[lane.length - 1]);
check(ends.every((end) => Math.hypot(end.x - ends[0].x, end.y - ends[0].y) < 1), "lanes meet on the seal");
check(config.foes.types.kou.style === "melee" && config.foes.types.shi.style === "ranged", "寇 is melee and 矢 is ranged");
check(config.units.types.dao.style === "melee" && config.units.types.gong.style === "ranged", "刀 is melee and 弓 is ranged");

const front = gridPosition(config.board, 2);
const second = gridPosition(config.board, 2 + config.board.gridCols);
const back = gridPosition(config.board, 2 + config.board.gridCols * 3);
const ford = { x: 0, y: 45 };
const mouth = { x: 0, y: 268 };
check(inRange(front.x, front.y, ford.x, ford.y, config.units.types.dao.byLevel[1].range), "front blade reaches the ford");
check(!inRange(second.x, second.y, ford.x, ford.y, config.units.types.dao.byLevel[1].range), "second-rank blade does not reach the ford");
check(inRange(second.x, second.y, ford.x, ford.y, config.units.types.qiang.byLevel[1].range), "second-rank spear reaches the ford");
check(inRange(back.x, back.y, ford.x, ford.y, config.units.types.gong.byLevel[1].range), "back bow covers the ford");
check(inRange(front.x, front.y, mouth.x, mouth.y, config.units.types.gong.byLevel[1].range), "front bow reaches the north mouth");
check(!inRange(back.x, back.y, mouth.x, mouth.y, config.units.types.gong.byLevel[1].range), "back bow does not reach the north mouth");

const sim = new GameSim(config, 1);
const broke = sim.recruit();
check(broke.ok, "opening recruit succeeds");
if (broke.ok) {
  const again = sim.recruit();
  check(again.ok, "second recruit succeeds");
  if (again.ok && again.token.type === broke.token.type) {
    const merged = sim.drop(broke.token.id, "bench", again.token.slot);
    check(merged.ok && merged.action === "merge" && again.token.level === 2, "same token and tier merge");
  } else if (again.ok) {
    const swapped = sim.drop(broke.token.id, "bench", again.token.slot);
    check(swapped.ok && swapped.action === "swap", "different tokens swap");
  }
}
const slot = dropSlotAt(config.board, front.x, front.y);
check(slot?.place === "grid" && slot.slot === 2, "a tap on the front center cell hits that cell");

const idle = run(config, 1, "idle", 240);
check(idle.phase === "lose", "doing nothing loses");
const smart = run(config, 1, "smart", 420);
check(smart.phase === "win" && smart.hp > 0 && smart.merges > 0, "merging clears the five waves");
const placed = run(config, 1, "place", 420);
check(placed.phase === "lose", "level-1 tokens alone lose");

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("\nLaya port rules match the Cocos config.");
}
