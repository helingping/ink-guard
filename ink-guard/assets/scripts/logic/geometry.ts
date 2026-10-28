import type { BoardConfig, BoardPoint } from '../config/ConfigTypes';

export interface Polyline {
  points: BoardPoint[];
  segLens: number[];
  total: number;
}

export function buildPath(points: BoardPoint[]): Polyline {
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segLens.push(d);
    total += d;
  }
  return { points, segLens, total };
}

export function pointOnPath(path: Polyline, distance: number): BoardPoint {
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

export function gridPosition(board: BoardConfig, index: number): BoardPoint {
  const col = index % board.gridCols;
  const row = Math.floor(index / board.gridCols);
  const step = board.cellSize + board.cellGap;
  return {
    x: board.gridOrigin.x + col * step,
    y: board.gridOrigin.y - row * step,
  };
}

export function benchPosition(board: BoardConfig, index: number): BoardPoint {
  return {
    x: board.benchOrigin.x + index * board.benchStep,
    y: board.benchOrigin.y,
  };
}

/** How far from a slot center a release still belongs to that slot. Covers the cell graphic, including its corner. */
export function slotReach(board: BoardConfig, place: 'grid' | 'bench'): number {
  if (place === 'grid') {
    const step = board.cellSize + board.cellGap;
    return Math.hypot(step / 2, step / 2) + 6;
  }
  return Math.hypot(board.benchStep / 2, board.cellSize / 2) + 6;
}

/**
 * Slot under a pointer in board space. Grid and bench do not overlap;
 * if a point is inside both catch radii, the nearer center wins.
 */
export function dropSlotAt(
  board: BoardConfig,
  x: number,
  y: number,
): { place: 'grid' | 'bench'; slot: number } | null {
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

export function nearestIndex(
  board: BoardConfig,
  place: 'grid' | 'bench',
  x: number,
  y: number,
  maxDist: number,
): number {
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
