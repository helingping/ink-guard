import { Color, Graphics } from 'cc';
import type { BoardPoint } from '../config/ConfigTypes';

/** Chrome colors. Unit inks come from units.json so tuning does not require a code edit. */
export const Ink = {
  paper: '#f3e6c8',
  ink: '#1d2b38',
  cinnabar: '#b4332a',
  moss: '#2f6b4f',
  mist: '#3d6f8a',
  gold: '#c6a15a',
  brown: '#4a3728',
};

export const RANK = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** Silhouette growth so a merged token is obvious before you read the rank. */
export function tierScale(level: number): number {
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

/** Sprite multiply. Higher ranks warm toward cinnabar and gold. */
export function tierTint(level: number): string {
  if (level >= 4) {
    return '#ffd56a';
  }
  if (level >= 3) {
    return '#ffd0b4';
  }
  if (level >= 2) {
    return '#fff1e4';
  }
  return '#ffffff';
}

export function tierRankColor(level: number): string {
  if (level >= 4) {
    return '#8a5a12';
  }
  if (level >= 3) {
    return '#8d2e2a';
  }
  if (level >= 2) {
    return '#1d2b38';
  }
  return '#4a3728';
}

export function inkColor(hex: string, alpha = 255): Color {
  const color = new Color();
  Color.fromHEX(color, hex);
  color.a = alpha;
  return color;
}

export interface RangeRing {
  x: number;
  y: number;
  radius: number;
  hex: string;
  fillAlpha: number;
  strokeAlpha: number;
  lineWidth: number;
}

export interface RangeDot {
  x: number;
  y: number;
  hex: string;
}

/**
 * Range circles and road marks in board space. The Graphics node stays at the origin.
 * Radii come from config; this only paints them.
 */
/**
 * Ink rings and corner seals around a token. Level 1 is a single thin stroke;
 * each merge adds a ring, and the fourth rank is gold.
 */
export function paintTier(g: Graphics, level: number, ink: string): void {
  g.clear();
  const rings = Math.min(4, Math.max(1, level));
  const gold = level >= 4;
  for (let i = 0; i < rings; i += 1) {
    const outer = i === rings - 1;
    g.lineWidth = outer ? 2.2 + level : 1.4;
    g.strokeColor = inkColor(outer && gold ? '#c6a15a' : ink, outer ? 235 : 170);
    g.circle(0, 0, 34 + i * 5);
    g.stroke();
  }
  if (level >= 2) {
    g.fillColor = inkColor(gold ? '#c6a15a' : ink, 230);
    const orbit = 30 + rings * 5;
    const marks: Array<[number, number]> = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [sx, sy] of marks) {
      g.circle(sx * orbit * 0.7, sy * orbit * 0.7, level >= 3 ? 3.4 : 2.2);
      g.fill();
    }
  }
  if (level >= 3) {
    g.lineWidth = 2;
    g.strokeColor = inkColor(gold ? '#c6a15a' : ink, 210);
    g.circle(0, 0, 16);
    g.stroke();
  }
}

/** Pale road stroked on the same polylines the simulation walks. */
export function paintLanes(g: Graphics, lanes: BoardPoint[][]): void {
  g.clear();
  g.lineJoin = 2;
  g.lineCap = 1;
  for (const lane of lanes) {
    if (lane.length < 2) {
      continue;
    }
    const trace = () => {
      g.moveTo(lane[0].x, lane[0].y);
      for (let i = 1; i < lane.length; i += 1) {
        g.lineTo(lane[i].x, lane[i].y);
      }
    };
    g.lineWidth = 26;
    g.strokeColor = inkColor('#4f7c90', 80);
    trace();
    g.stroke();
    g.lineWidth = 9;
    g.strokeColor = inkColor('#f7f1e4', 220);
    trace();
    g.stroke();
  }
}

export function paintRanges(g: Graphics, rings: RangeRing[], dots: RangeDot[]): void {
  g.clear();
  for (const ring of rings) {
    g.fillColor = inkColor(ring.hex, ring.fillAlpha);
    g.circle(ring.x, ring.y, ring.radius);
    g.fill();
    g.lineWidth = ring.lineWidth;
    g.strokeColor = inkColor(ring.hex, ring.strokeAlpha);
    g.circle(ring.x, ring.y, ring.radius);
    g.stroke();
    g.lineWidth = 1;
    g.strokeColor = inkColor(ring.hex, Math.max(24, Math.floor(ring.strokeAlpha * 0.35)));
    g.circle(ring.x, ring.y, Math.max(4, ring.radius - 8));
    g.stroke();
  }
  for (const dot of dots) {
    g.fillColor = inkColor(dot.hex, 210);
    g.circle(dot.x, dot.y, 4.5);
    g.fill();
  }
}
