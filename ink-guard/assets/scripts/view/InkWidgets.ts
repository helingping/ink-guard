import {
  Color,
  Graphics,
  HorizontalTextAlignment,
  Label,
  Layers,
  Node,
  Overflow,
  UITransform,
  VerticalTextAlignment,
} from 'cc';
import type { BoardConfig } from '../config/ConfigTypes';

/** Chrome colors. Unit inks come from units.json so tuning does not require a code edit. */
export const Ink = {
  paper: '#f3e6c8',
  ink: '#1d2b38',
  cinnabar: '#b4332a',
  moss: '#2f6b4f',
  mist: '#7ea0b8',
  gold: '#c6a15a',
  brown: '#4a3728',
};

export const UI_FONT = 'PingFang SC, Microsoft YaHei, Noto Sans SC, sans-serif';

export const RANK = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function inkColor(hex: string, alpha = 255): Color {
  const color = new Color();
  Color.fromHEX(color, hex);
  color.a = alpha;
  return color;
}

export function inkNode(name: string, width: number, height: number): Node {
  const node = new Node(name);
  node.layer = Layers.Enum.UI_2D;
  const transform = node.addComponent(UITransform);
  transform.setContentSize(width, height);
  transform.setAnchorPoint(0.5, 0.5);
  return node;
}

export function addLabel(
  parent: Node,
  name: string,
  text: string,
  size: number,
  color: Color,
  width: number,
  height: number,
): Label {
  const node = inkNode(name, width, height);
  parent.addChild(node);
  const label = node.addComponent(Label);
  label.string = text;
  label.fontSize = size;
  label.lineHeight = size + 8;
  label.fontFamily = UI_FONT;
  label.isBold = true;
  label.horizontalAlign = HorizontalTextAlignment.CENTER;
  label.verticalAlign = VerticalTextAlignment.CENTER;
  label.overflow = Overflow.SHRINK;
  label.color = color;
  return label;
}

type RoundGraphics = Graphics & {
  roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
};

function traceRoundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
  const graphics = g as RoundGraphics;
  if (typeof graphics.roundRect === 'function') {
    graphics.roundRect(x, y, w, h, r);
    return;
  }
  g.rect(x, y, w, h);
}

export function fillRoundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
  traceRoundRect(g, x, y, w, h, r);
  g.fill();
}

export function strokeRoundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
  traceRoundRect(g, x, y, w, h, r);
  g.stroke();
}

export function paintSeal(g: Graphics, hex: string, level: number, radius: number): void {
  g.clear();
  g.fillColor = inkColor('#f7f1e4');
  g.circle(0, 0, radius);
  g.fill();
  const dots: Array<[number, number, number]> = [
    [0.72, -0.28, 0.14],
    [-0.66, 0.24, 0.11],
    [0.28, 0.68, 0.08],
    [-0.18, -0.72, 0.07],
  ];
  g.fillColor = inkColor(hex, 150);
  for (const [nx, ny, nr] of dots) {
    g.circle(nx * radius, ny * radius, Math.max(3, nr * radius));
    g.fill();
  }
  g.lineWidth = 3 + level;
  g.strokeColor = inkColor(hex);
  g.circle(0, 0, radius - 1);
  g.stroke();
}

export function paintCell(g: Graphics, width: number, height: number, faint: boolean): void {
  g.clear();
  g.fillColor = inkColor(faint ? '#efe4cc' : '#f7f0df', faint ? 150 : 220);
  fillRoundRect(g, -width / 2, -height / 2, width, height, 10);
  g.lineWidth = faint ? 2 : 3;
  g.strokeColor = inkColor(Ink.ink, faint ? 70 : 140);
  strokeRoundRect(g, -width / 2, -height / 2, width, height, 10);
}

export function paintButton(g: Graphics, width: number, height: number, enabled: boolean): void {
  g.clear();
  g.fillColor = inkColor(enabled ? Ink.cinnabar : '#8d8172');
  fillRoundRect(g, -width / 2, -height / 2, width, height, 16);
  g.lineWidth = 3;
  g.strokeColor = inkColor(enabled ? '#6e1c16' : '#5c5348');
  strokeRoundRect(g, -width / 2, -height / 2, width, height, 16);
}

export function paintBar(g: Graphics, width: number, height: number, ratio: number): void {
  g.clear();
  g.fillColor = inkColor('#4a3728', 70);
  fillRoundRect(g, -width / 2, -height / 2, width, height, 8);
  const fill = Math.max(0, Math.min(1, ratio)) * (width - 6);
  if (fill > 0) {
    g.fillColor = inkColor(ratio > 0.35 ? Ink.cinnabar : '#7a2a24');
    fillRoundRect(g, -width / 2 + 3, -height / 2 + 3, fill, height - 6, 6);
  }
}

export function paintRange(g: Graphics, radius: number, hex: string): void {
  g.clear();
  g.lineWidth = 3;
  g.strokeColor = inkColor(hex, 90);
  g.circle(0, 0, radius);
  g.stroke();
}

export function paintEnemy(g: Graphics): void {
  g.clear();
  g.fillColor = inkColor('#243044');
  g.circle(0, 0, 22);
  g.fill();
  g.fillColor = inkColor('#3e5670');
  g.circle(-6, 4, 5);
  g.circle(7, 3, 4);
  g.fill();
  g.lineWidth = 2;
  g.strokeColor = inkColor('#0e1720');
  g.circle(0, 0, 22);
  g.stroke();
}

export function paintShot(g: Graphics, hex: string): void {
  g.clear();
  g.fillColor = inkColor(hex);
  g.circle(0, 0, 7);
  g.fill();
}

function strokePolyline(g: Graphics, points: Array<{ x: number; y: number }>, width: number, hex: string, alpha: number): void {
  if (points.length < 2) {
    return;
  }
  g.lineWidth = width;
  g.strokeColor = inkColor(hex, alpha);
  g.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    g.lineTo(points[i].x, points[i].y);
  }
  g.stroke();
}

/**
 * Vector wash behind the board. Shapes are original scribbles in the same
 * mood as assets/concepts/battlefield-caimo.jpg — not a trace of that image.
 */
export function paintBackground(g: Graphics, board: BoardConfig): void {
  const halfW = board.designWidth / 2;
  const halfH = board.designHeight / 2;
  g.clear();
  g.fillColor = inkColor(Ink.paper);
  g.rect(-halfW, -halfH, board.designWidth, board.designHeight);
  g.fill();

  g.fillColor = inkColor(Ink.mist, 50);
  g.ellipse(-180, 280, 200, 70);
  g.ellipse(120, 180, 220, 64);
  g.ellipse(0, 80, 260, 48);
  g.fill();

  g.fillColor = inkColor('#8ea4b6', 90);
  g.moveTo(-halfW, 430);
  g.lineTo(-220, 560);
  g.lineTo(-80, 450);
  g.lineTo(40, 590);
  g.lineTo(180, 470);
  g.lineTo(halfW, 540);
  g.lineTo(halfW, 400);
  g.lineTo(-halfW, 400);
  g.close();
  g.fill();

  g.fillColor = inkColor('#6e8ea4', 80);
  g.moveTo(-halfW, -430);
  g.lineTo(-160, -360);
  g.lineTo(-20, -470);
  g.lineTo(140, -350);
  g.lineTo(halfW, -430);
  g.lineTo(halfW, -halfH);
  g.lineTo(-halfW, -halfH);
  g.close();
  g.fill();

  strokePolyline(g, board.path, 34, '#d7e7ee', 220);
  strokePolyline(g, board.path, 12, '#f8fcfd', 235);

  g.strokeColor = inkColor(Ink.moss, 180);
  g.lineWidth = 4;
  g.moveTo(300, 520);
  g.lineTo(318, 620);
  g.moveTo(332, 500);
  g.lineTo(348, 630);
  g.stroke();
  g.fillColor = inkColor('#3e8f62', 160);
  g.circle(300, 560, 8);
  g.circle(286, 540, 6);
  g.circle(348, 575, 7);
  g.circle(-300, -560, 7);
  g.circle(-318, -540, 5);
  g.fill();
}
