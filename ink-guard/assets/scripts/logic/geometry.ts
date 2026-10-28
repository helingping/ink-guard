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
