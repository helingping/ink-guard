# Ink Guard

Cocos Creator **3.8.8** 工程。请用 Creator 打开本目录，不要打开上一级仓库根目录。

1. 等待资源导入和脚本编译完成。
2. 双击 `assets/scenes/main.scene`。
3. 点播放。设计分辨率 720×1280，竖屏。

界面在场景里，不在 `buildStatic` 里画。层级：

- `Background`：宣纸底，Widget 拉满
- `Decor`：山、竹、墨溅，从概念图切出
- `Board`：`Cell0`–`Cell14`、`Bench0`–`Bench7`、河道、棋盘底、`AdouSeal`、`Range`（Graphics，只画射程圈）
- `Actors`：运行时的字令、墨寇、弹道
- `Hud`：标题（马善政）、波次和血条（`StatusColumn` 上有 Layout）、馒头和招募（`MantouRow` 上有 Layout）、倍速、提示、合成引导、胜负 `Overlay`

`Overlay`、`Banner`、`Loading` 和每个格子的 `Mark` 默认未激活，方便在编辑器里看棋盘。勾上 `Overlay` 就能改胜负面板。

字体在 `assets/resources/fonts/`：马善政用于标题，Noto Sans CJK SC Regular 用于 HUD。Label 使用这两份字体资源。切图在 `assets/resources/textures/`，攻击帧在 `pose/` 和 `fx/`，墨寇静止字在 `foes/`。概念原图在 `assets/concepts/`。

玩法、数值和已知缺口写在上一级的 `README.md` 和 `design/mvp-gdd.md`。配置在 `assets/resources/configs/`，改完重新播放即可。格子位置以 `board.json` 为准，播放时脚本会把槽位再摆一次。
