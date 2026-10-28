# 墨卫 Ink Guard
原创的水墨字令合成塔防 MVP，给 Cocos Creator **3.8.x** 打开。不是任何商业微信小游戏的复刻：标题、数值、代码和概念图都是这套仓库自己的。

竖屏单机。花馒头招募「刀 / 枪 / 弓 / 骑」，把相同字令叠成品级 +1，再拖上阵守阿斗。清完五波墨寇即胜，阿斗气血归零即败。

## 目录

| 路径 | 内容 |
| --- | --- |
| `design/mvp-gdd.md` | MVP 策划案，数值和 JSON 的对应关系 |
| `assets/concepts/` | 英文文件名的概念图，只供看，不进运行时 |
| `assets/README.md` | 资源命名约定 |
| `ink-guard/` | Cocos Creator 3.8 工程 |

调数值只改 `ink-guard/assets/resources/configs/` 里的 JSON。Creator 只能动态加载 `resources` 目录，所以配置放在这里，而不是 `assets/configs/`。

## 用 Cocos Creator 3.8 打开

1. 安装 Cocos Creator **3.8.8**。工程在 `package.json` 里标的是 3.8.8；若编辑器提示升级资源，按提示迁移即可。
2. 在 Creator 启动器里打开 **`ink-guard` 这个文件夹**，不要打开仓库根目录。
3. 等资源导入和脚本编译结束（右下角进度走完，控制台没有红色报错）。
4. 在资源管理器双击 `assets/scenes/main.scene`。
5. 点编辑器顶部的播放按钮。设计分辨率是 720×1280，项目设置里 Fit Width 已勾上。预览窗口请用竖屏。

播放后 `GameApp` 会读 JSON，并在运行时搭出棋盘、阿斗血条、馒头和招募按钮。场景里预先放了 `Canvas`、`Camera`、`GameRoot`，以及 `Board` / `Hud` / `Actors` 三个空层。

## 现在能玩什么

- **招募**：花馒头随机得到一品刀、枪、弓、骑。花费是 `15 + 5 × 已招募次数`。馒头每秒 +5，击破墨寇 +2，清波 +16。
- **席位**：下方 8 个淡格是未上阵的字令。席位满了不能再招募。
- **合成**：把两枚相同字令、相同品级叠在一起，留下的那枚品级 +1，最高四品。
- **上阵**：拖到中间 5×3 的格子里。拖回席位可以撤回。上阵后自动攻击射程内最近的墨寇。拖动时会画出射程圈。
- **守波**：墨寇沿河道折线走向「斗」印。走到终点打掉阿斗气血。第一波前有 4 秒备墨。
- **胜负**：五波都清掉且阿斗还活着为胜；气血到 0 为败。点「再守一阵」重开。右上角可在「常速 / 三倍」之间切换。

刀、枪、弓、骑目前是程序里的 Label，不是切图。前排（靠河道）才打得着；一品后排大多够不着，合成后射程变长。

## 不改代码调数值

| 文件 | 管什么 |
| --- | --- |
| `ink-guard/assets/resources/configs/units.json` | 四种字令各品的攻击、攻速、射程 |
| `ink-guard/assets/resources/configs/economy.json` | 初始馒头、招募花费和收入 |
| `ink-guard/assets/resources/configs/adou.json` | 阿斗最大气血 |
| `ink-guard/assets/resources/configs/waves.json` | 每一波的数量、血量、速度、伤害 |
| `ink-guard/assets/resources/configs/board.json` | 格子、席位、河道折线、弹道 |

改完保存，回到预览再播放一次即可。字段说明见 `design/mvp-gdd.md`。JSON 里的 `comment` 只给人看，加载时会忽略。

没有 Creator 时，可以在仓库根目录复核规则（不会启动游戏画面）：

```bash
npx --yes -p typescript tsc -p ink-guard/tools/tsconfig.sim.json
node /tmp/ink-guard-sim/tools/simulate.js
```

`tsc` 的 `outDir` 写在这份 tsconfig 里，固定是 `/tmp/ink-guard-sim`。

## 已知缺口

- 没有正式切图和动画。概念图在 `assets/concepts/`，运行时没有导入。
- 只有单机波次，没有玩家对战。
- 没有广告、没有内购、没有账号。
- 墨寇沿固定折线走，不占格子，也不会被字令挡住。
- 还没配微信小游戏 AppID。要用微信包时，在 Creator 里自行「构建发布」，不要把密钥写进仓库。
- 项目设置里不要裁掉 2D、UI、Graphics，否则血条和字令画不出来。
