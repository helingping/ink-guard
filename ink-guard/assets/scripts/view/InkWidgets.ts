import { Color, Graphics } from 'cc';

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

export function inkColor(hex: string, alpha = 255): Color {
  const color = new Color();
  Color.fromHEX(color, hex);
  color.a = alpha;
  return color;
}

/** Range ring while a token is dragged. Static chrome is scene UI, not Graphics. */
export function paintRange(g: Graphics, radius: number, hex: string): void {
  g.clear();
  g.lineWidth = 3;
  g.strokeColor = inkColor(hex, 110);
  g.circle(0, 0, radius);
  g.stroke();
  g.lineWidth = 1;
  g.strokeColor = inkColor(hex, 40);
  g.circle(0, 0, Math.max(4, radius - 8));
  g.stroke();
}
