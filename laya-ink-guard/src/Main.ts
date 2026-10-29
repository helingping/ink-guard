import { loadGameConfig } from "./config/loadConfig";
import { loadArt, loadFonts } from "./view/assets";
import { InkGuardView } from "./view/InkGuardView";

const { regClass } = Laya;

/**
 * Startup script for LayaAir IDE. Attach it to any sprite in the startup scene,
 * or set the project entry to this file. The standalone preview sets
 * `window.__INK_GUARD_STANDALONE__` and calls `bootInkGuard` itself.
 * The screen is Laya.Box / Button / Label / Image / Sprite, not FairyGUI.
 */
@regClass()
export class Main extends Laya.Script {
  onAwake(): void {
    bootInkGuard();
  }
}

let started = false;

export function bootInkGuard(): void {
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
  }).catch((error: unknown) => {
    started = false;
    report(error);
  });
}

function fitStage(): void {
  Laya.stage.scaleMode = Laya.Stage.SCALE_FIXED_WIDTH;
  Laya.stage.screenMode = Laya.Stage.SCREEN_VERTICAL;
  Laya.stage.alignH = Laya.Stage.ALIGN_CENTER;
  Laya.stage.alignV = Laya.Stage.ALIGN_MIDDLE;
  Laya.stage.bgColor = "#f3e6c8";
  if (Laya.stage.width !== 720 || Laya.stage.height !== 1280) {
    Laya.stage.size(720, 1280);
  }
}

async function launch(): Promise<void> {
  const loading = statusLabel("研墨中…");
  try {
    const fonts = await loadFonts();
    const config = await loadGameConfig();
    const art = await loadArt();
    loading.removeSelf();
    loading.destroy();
    new InkGuardView(config, art, fonts).start();
  } catch (error) {
    loading.text = error instanceof Error ? error.message : "配置没有读出来";
    loading.color = "#b4332a";
  }
}

function statusLabel(text: string): Laya.Label {
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

function report(error: unknown): void {
  const message = error instanceof Error ? error.message : "LayaAir 没有启动";
  if (Laya.stage) {
    statusLabel(message);
    return;
  }
  const node = document.createElement("p");
  node.textContent = message;
  document.body.appendChild(node);
}

declare global {
  interface Window {
    __INK_GUARD_STANDALONE__?: boolean;
  }
}

if (typeof window !== "undefined" && window.__INK_GUARD_STANDALONE__) {
  bootInkGuard();
}
