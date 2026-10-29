/**
 * Ambient surface used by this port. LayaAir IDE replaces this file with the
 * full engine declarations for the IDE's exact version. The names below match
 * LayaAir 3.4.2.
 */
declare namespace Laya {
  function regClass(assetId?: string): ClassDecorator;
  function init(width: number, height: number): Promise<void>;

  const stage: Stage;
  const timer: Timer;
  const loader: Loader;

  class Node {
    name: string;
    parent: Node | null;
    mouseEnabled: boolean;
    destroy(destroyChild?: boolean): void;
    removeSelf(): Node;
    addChild<T extends Node>(node: T): T;
    on(type: string, caller: object, listener: Function, args?: unknown[]): void;
    off(type: string, caller: object, listener: Function): void;
  }

  class Graphics {
    clear(): void;
    drawLine(fromX: number, fromY: number, toX: number, toY: number, lineColor: string, lineWidth?: number): unknown;
    drawLines(x: number, y: number, points: number[], lineColor: string, lineWidth?: number): unknown;
    drawRect(x: number, y: number, width: number, height: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number): unknown;
    drawRoundRect(
      x: number,
      y: number,
      width: number,
      height: number,
      lt: number,
      rt: number,
      lb: number,
      rb: number,
      fillColor: string | null,
      lineColor?: string | null,
      lineWidth?: number,
    ): unknown;
    drawCircle(x: number, y: number, radius: number, fillColor: string | null, lineColor?: string | null, lineWidth?: number): unknown;
  }

  class Texture {
    sourceWidth: number;
    sourceHeight: number;
    width: number;
    height: number;
  }

  class Sprite extends Node {
    x: number;
    y: number;
    width: number;
    height: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    alpha: number;
    visible: boolean;
    anchorX: number;
    anchorY: number;
    mouseThrough: boolean;
    texture: Texture | null;
    graphics: Graphics;
    pos(x: number, y: number): this;
    size(width: number, height: number): this;
  }

  class Stage extends Sprite {
    static readonly SCALE_FIXED_WIDTH: string;
    static readonly SCREEN_VERTICAL: string;
    static readonly ALIGN_CENTER: string;
    static readonly ALIGN_MIDDLE: string;
    scaleMode: string;
    screenMode: string;
    alignH: string;
    alignV: string;
    bgColor: string;
    mouseX: number;
    mouseY: number;
  }

  class Text extends Sprite {
    text: string;
    font: string;
    fontSize: number;
    color: string;
    bold: boolean;
    align: string;
    valign: string;
    stroke: number;
    strokeColor: string;
    wordWrap: boolean;
    leading: number;
  }

  class Label extends Sprite {
    text: string;
    font: string;
    fontSize: number;
    color: string;
    bold: boolean;
    align: string;
    valign: string;
    stroke: number;
    strokeColor: string;
    wordWrap: boolean;
    leading: number;
  }

  class Image extends Sprite {
    skin: string;
    source: Texture | null;
  }

  class Box extends Sprite {}

  class Button extends Sprite {
    constructor(skin?: string | null, label?: string);
    label: string;
    labelSize: number;
    labelColors: string;
    labelFont: string;
    labelBold: boolean;
    skin: string;
    stateNum: number;
  }

  class Script {
    owner: Sprite;
    onAwake(): void;
    onStart(): void;
  }

  class Event {
    static readonly MOUSE_DOWN: string;
    static readonly MOUSE_MOVE: string;
    static readonly MOUSE_UP: string;
    static readonly CLICK: string;
    target: Node | null;
    nativeEvent?: { pointerType?: string };
    stopPropagation(): void;
  }

  class Loader {
    static readonly JSON: string;
    static readonly IMAGE: string;
    static readonly TTF: string;
    load(url: string, type?: string): Promise<unknown>;
    getRes(url: string): unknown;
  }

  class Timer {
    delta: number;
    frameLoop(delay: number, caller: object, method: Function, args?: unknown[]): void;
    clear(caller: object, method: Function): void;
  }
}
