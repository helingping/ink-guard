/** Same ink as the Cocos widgets. Unit inks still come from units.json. */

export const Ink = {
  paper: "#f3e6c8",
  paperDeep: "#e7d3ae",
  ink: "#1d2b38",
  cinnabar: "#b4332a",
  moss: "#2f6b4f",
  mist: "#3d6f8a",
  gold: "#c6a15a",
  brown: "#4a3728",
  cream: "#f7f1e4",
};

export const RANK = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

export const MARK = {
  move: Ink.moss,
  merge: Ink.gold,
  swap: Ink.mist,
} as const;

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

export function tierRankColor(level: number): string {
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

export function hexAlpha(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function paintTier(g: Laya.Graphics, level: number, ink: string): void {
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
    const marks: Array<[number, number]> = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [sx, sy] of marks) {
      g.drawCircle(sx * orbit * 0.7, sy * orbit * 0.7, level >= 3 ? 3.4 : 2.2, mark, null, 0);
    }
  }
  if (level >= 3) {
    g.drawCircle(0, 0, 16, null, gold ? Ink.gold : ink, 2);
  }
}
