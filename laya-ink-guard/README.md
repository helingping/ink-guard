# 墨卫 · LayaAir

LayaAir **3.4.2** 工程，和 Cocos Creator 工程并排放。打开的是本目录（里面有 `InkGuard.laya`），不要打开仓库根目录。Cocos 的 `ink-guard/` 和 `web-preview/` 都还在，没有被换掉。

引擎版本以运行时 `LayaEnv.version` 为准，是 **3.4.2**（2026-10-23 的稳定标签 `v3.4.2`）。请装同一代的 LayaAir IDE 3.4.x。更早的 3.2 / 3.3 打开时，IDE 可能会改写 `engine/types`，脚本用的仍是 3.x 的 Sprite、Image、Label、Button、Box。

## 内置 UI，不用 FairyGUI

LayaAir IDE 自带的界面和 FairyGUI 都是可视化的组件编辑器：都能摆按钮、图片、文字、容器，也能把一块界面做成可复用的预制。上手的感觉接近，但**不是同一个产品**。FairyGUI 是另一套编辑器，发布目标里可以选 Laya。LayaAir IDE 自己有 Scene 和 2D 组件。

这一版用的是 LayaAir 内置 UI，没有接 FairyGUI：

- 宣纸面板、招募、倍速、知道了、再守一阵：`Laya.Box` + `Laya.Button` + `Laya.Label`
- 河道、格子、印章、字令图：`Laya.Image`
- 墨路、射程圈、品级圈：`Laya.Sprite.graphics`

界面在 `src/Main.ts` / `src/view/InkGuardView.ts` 里搭好。云端环境开不了 LayaAir 的图形 IDE，所以仓库里没有手摆的 `.ls` 场景。用 IDE 打开之后，可以把层级另存成场景；玩法仍由 `Main` 驱动。

## 没有 IDE 时先玩

在**仓库根目录**起服务（`file://` 读不到 JSON 和图片）：

```bash
python3 -m http.server 8765
```

浏览器打开：

http://127.0.0.1:8765/laya-ink-guard/preview/

`preview/` 里已经带上 LayaAir 3.4.2 的 `laya.core.js`、`laya.webgl_2D.js`、`laya.ui.js`（MIT，见 `preview/libs/LayaAir-LICENSE.txt`）和编好的 `game.js`。`bin/index.html` 只是跳到这个预览。IDE 播放时可能会改写 `bin/`，预览页在 `preview/`，不受影响。

改了 `src/` 之后，在本目录重新打包：

```bash
npm install
npm run build
npm run typecheck
npx --yes tsx tools/self-check.ts
```

## 在 Mac 上用 LayaAir IDE 打开

1. 从 https://layaair.com/#/engineDownload 安装 **LayaAir IDE 3.4.2**（或同代 3.4.x）。
2. 启动器里打开 **`laya-ink-guard` 这个文件夹**。
3. 等资源导入结束。IDE 可能会用自带的完整声明盖掉 `engine/types/LayaAir.d.ts`，这是正常的。
4. 设计分辨率设成 **720 × 1280**，缩放 **fixedwidth**（固定宽），屏幕 **vertical**，背景 `#f3e6c8`。`settings/PlayerSettings.json` 里写了同一套；若 IDE 没读进去，在项目设置里手改一次。
5. 新建或打开一个 2D 场景。在层级里放一个空的 Sprite，把脚本 **`Main`**（`src/Main.ts`）挂上去。把这个场景设为启动场景。脚本编译的入口也可以指到 `src/Main.ts`。
6. 点播放。预览窗口用竖屏。

图片和字体通过符号链接指向 `ink-guard/assets/resources/` 里的原件（`textures`、`pose`、`fx`、`foes`、`fonts`）。macOS 上 git 会保留这些链接。如果 IDE 里图是空的，在本目录执行：

```bash
node tools/copy-shared-assets.mjs
```

这会把链接换成真正的拷贝。数值 JSON 已经是实体文件，在 `assets/resources/configs/`。和 Cocos 不一致时：

```bash
node tools/sync-configs.mjs
```

浏览器预览会先读仓库里的 `ink-guard/assets/resources/`，读不到再用本目录的拷贝，所以两边不会各写一套数值。

## 和 Cocos 一样的部分

- 北营「寇」沿西墨、中墨、东墨贴着河道走到南端「斗」
- 南岸 5×4，席位 8。刀骑靠前，枪在第二排，弓在后排
- 拖动上阵、撤回、同字同品合成（最高四品，圈纹变多，四品金圈）、不同则换位
- 点选画射程，点空处收起。近战挥到才命中，远程（弓、矢）飞箭
- 五波、备墨、馒头、倍速、胜负和「再守一阵」
- 第一次会在席位放两枚「刀」。文案是简体中文，目录和文件名是英文

规则代码在 `src/logic/`、`src/config/`，从 Cocos 的纯逻辑脚本原样搬过来，不引用 Laya。`tools/self-check.ts` 会核对 JSON 是否和 Cocos 一致，并重放「什么都不做会输 / 会合成能守完 / 只铺一品会输」。

## 还没做的

- IDE 里还没有保存好的 `.ls` 场景，界面是运行时用内置组件搭的
- 攻击时会换成 `pose/` 里的帧，没有 Cocos 那套逐个 Widget 绑定
- 没有微信小游戏或原生发布配置
- 没有玩家对战、广告、账号
