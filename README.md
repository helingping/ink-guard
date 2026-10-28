# 墨卫 Ink Guard
原创的水墨字令合成塔防 MVP，给 Cocos Creator **3.8.x** 打开。不是任何商业微信小游戏的复刻：标题、数值、代码和概念图都是这套仓库自己的。

竖屏单机。花馒头招募「刀 / 枪 / 弓 / 骑」，把相同字令叠成品级 +1，再拖上阵守阿斗。清完五波墨寇即胜，阿斗气血归零即败。

## 手机上直接玩

Cocos Creator 的场景和 web-mobile 出包都要编辑器。没有 Creator 时，用 `web-preview/` 里的 Canvas 竖屏页，手机浏览器就能玩。招募、合成、上阵、守波的数值读 `ink-guard/assets/resources/configs/`（旁边的 `web-preview/configs/` 是同一份拷贝，父路径读不到时才用）。

手机现在就能打开（页面按真正的网页返回，不是源码）：

https://html-preview.github.io/?url=https://github.com/helingping/ink-guard/blob/cursor/h5-web-preview-232e/web-preview/index.html

合并进 `main` 之后，把地址里的 `cursor/h5-web-preview-232e` 换成 `main`。

GitHub Pages 需要仓库管理员点一次才会有 `github.io` 地址，见下面。打开之后是：

- https://helingping.github.io/ink-guard/
- https://helingping.github.io/ink-guard/web-preview/

设计分辨率 720×1280，页面会按手机宽度缩进竖屏。刀、枪、骑是近战（斩、刺、冲，挥到才命中），弓是远程（射，箭飞到才命中）。来敌三种墨印：**寇**、**矛**走近战，沿河道走到「斗」印才扣血；**矢**是远程，在尽头前停步射一箭，伤害仍是这一波的 `damage`，只扣一次。右上角可在常速和三倍之间切换。

### 打开 GitHub Pages

仓库是公开的。`.github/workflows/pages.yml` 用 GitHub Actions 发布整仓，入口是根目录的 `index.html`，它会跳到 `web-preview/`。仓库根上有 `.nojekyll`，避免 Jekyll 改写静态文件。

创建 Pages 的接口返回 403（当前令牌不能替你打开站点）。管理员用浏览器点一次即可，大约一分钟后生效。

1. 打开 https://github.com/helingping/ink-guard/settings/pages （手机登录 GitHub 后也能点）。
2. **Build and deployment** 里，Source 选 **Deploy from a branch**。
3. Branch 选 **`cursor/h5-web-preview-232e`**，Folder 选 **`/ (root)`**，点 **Save**。
4. 等状态变成 Ready，打开 https://helingping.github.io/ink-guard/web-preview/ 。
5. 这个 PR 合并进 `main` 之后，回到同一页把 Branch 改成 **`main`**，再 Save。否则预览分支删掉后地址会断。

不想选分支、想用已经写好的 Actions 工作流时：Source 改成 **GitHub Actions**。`.github/workflows/pages.yml` 会在推到 `main` 或当前预览分支时发布。站点一旦打开，工作流里的 `enablement` 才不会再被 403 挡住。

本地查看要在仓库根目录起服务。`file://` 读不了 JSON。

```bash
python3 -m http.server 8765
```

浏览器打开 http://127.0.0.1:8765/web-preview/ 。不画画面、只复核规则：

```bash
node web-preview/self-check.mjs
```

## 目录

| 路径 | 内容 |
| --- | --- |
| `design/mvp-gdd.md` | MVP 策划案，数值和 JSON 的对应关系 |
| `assets/concepts/` | 英文文件名的概念图，只供看，不进运行时 |
| `assets/README.md` | 资源命名约定 |
| `ink-guard/` | Cocos Creator 3.8 工程 |
| `web-preview/` | 不依赖 Creator 的手机浏览器预览 |

调数值只改 `ink-guard/assets/resources/configs/` 里的 JSON。Creator 只能动态加载 `resources` 目录，所以配置放在这里，而不是 `assets/configs/`。

## 用 Cocos Creator 3.8 打开

1. 安装 Cocos Creator **3.8.8**。工程在 `package.json` 里标的是 3.8.8；若编辑器提示升级资源，按提示迁移即可。
2. 在 Creator 启动器里打开 **`ink-guard` 这个文件夹**，不要打开仓库根目录。
3. 等资源导入和脚本编译结束（右下角进度走完，控制台没有红色报错）。
4. 在资源管理器双击 `assets/scenes/main.scene`。
5. 点编辑器顶部的播放按钮。设计分辨率是 720×1280，项目设置里 Fit Width 已勾上。预览窗口请用竖屏。

`main.scene` 里已经摆好界面，不靠运行时 `new Node` 画整屏 UI。层级大致是：

`Canvas / GameRoot / Background、Decor、Board（Cell0–14、Bench0–7、AdouSeal）、Actors、Hud`

Hud 里有标题、倍速、血条、招募、底部提示、合成引导和胜负面板（`Overlay` 默认未激活，在层级里勾上就能改）。格子坐标跟 `board.json` 一致，播放时会再按 JSON 对齐一次。字令、墨寇和弹道仍是运行时生成的，因为它们会增减；拖动时的射程圈用场景里的 `Range`（Graphics）来画。

## 现在能玩什么

- **招募**：花馒头随机得到一品刀、枪、弓、骑。花费是 `15 + 5 × 已招募次数`。馒头每秒 +5，击破墨寇 +2，清波 +16。
- **席位**：下方 8 个淡格是未上阵的字令。席位满了不能再招募。
- **合成**：把两枚相同字令、相同品级叠在一起，留下的那枚品级 +1，最高四品。
- **换位**：字令不同，或品级不同，松手会交换两格，不再弹回。
- **上阵**：拖到中间 5×3 的格子里。拖回席位可以撤回。拖动时画出射程圈，并高亮合法落点：绿色空位、金色合成、青色换位。
- **守波**：墨寇沿河道折线走向「斗」印。走到终点打掉阿斗气血。第一波前有 12 秒备墨。
- **首局引导**：第一次玩会在席位放两枚「刀」，并弹出合成说明。合成一次，或点「知道了」关掉说明。合成过后不再送。
- **胜负**：五波都清掉且阿斗还活着为胜；气血到 0 为败。点「再守一阵」重开。右上角可在「常速 / 三倍」之间切换。

刀、枪、弓、骑用概念图切出来的字令图。刀、枪、骑是近战（斩、刺、冲，挥到就打中），弓是远程（射，箭要飞到才打中）。字令身上写着「近战」或「远程」。攻击时本体播自己的动作帧，特效也按兵种分开，素材从概念图的彩墨和弓箭切出来。后排的弓和枪一品就能打到河道近处；刀和骑要合成到二品才够得到后排。攻击数字没变，波次气血提高了一档，所以只铺一品仍然守不住。

## 不改代码调数值

| 文件 | 管什么 |
| --- | --- |
| `ink-guard/assets/resources/configs/units.json` | 四种字令各品的攻击、攻速、射程 |
| `ink-guard/assets/resources/configs/economy.json` | 初始馒头、招募花费和收入 |
| `ink-guard/assets/resources/configs/adou.json` | 阿斗最大气血 |
| `ink-guard/assets/resources/configs/waves.json` | 每一波的数量、血量、速度、伤害 |
| `ink-guard/assets/resources/configs/board.json` | 格子、席位、河道折线、弹道 |

改完保存，回到预览再播放一次即可。字段说明见 `design/mvp-gdd.md`。JSON 里的 `comment` 只给人看，加载时会忽略。

## 字体和切图

| 用途 | 文件 |
| --- | --- |
| 标题、印章感、波次横幅 | `ink-guard/assets/resources/fonts/MaShanZheng-Regular.ttf`（马善政，OFL） |
| HUD 数字和正文 | `ink-guard/assets/resources/fonts/NotoSansCJKsc-Regular.otf`（Noto Sans CJK SC Regular，OFL） |
| 棋盘格、阿斗印、河道、竹、山、字令、按钮 | `ink-guard/assets/resources/textures/` |

许可全文在同目录的 `OFL-MaShanZheng.txt` 和 `OFL-NotoSansCJK.txt`。场景里的 Label 绑的是这两份字体资源，不是系统 `fontFamily`。

概念原图在仓库根 `assets/concepts/`，工程里也有一份 `ink-guard/assets/concepts/`。切图脚本是 `ink-guard/tools/export-ui-sprites.py`（需要 Pillow）。场景节点由 `node ink-guard/tools/generate-cocos-files.mjs` 按当前 `board.json` 重写；在编辑器里改过场景之后不要随便重跑，否则会盖掉手改。

## 在 Creator 里核对

1. 打开 `ink-guard/`，等导入结束。层级里应能看到上面的节点，而不是空的 Canvas。
2. 点开 `Title` 或胜负标题，检查字体是 Ma Shan Zheng；点开 `Wave` 或 `Hint`，字体是 Noto Sans CJK SC。
3. 点 `Board/Cell0`，Sprite 应是 `cell`。点 `AdouSeal`，应是印章图。
4. `Overlay` 默认关掉。在层级里勾上它，可以改胜负面板；播放后脚本会在胜负时再打开。
5. 播放：开局席位有两枚刀（若这台机器还没合成过）。拖动时看射程圈和绿/金/青落点。把两枚刀叠上，品级变成二品。

没有 Creator 时，在仓库根目录复核规则（不会启动游戏画面）：

```bash
npx --yes tsx ink-guard/tools/simulate.ts
```

也可以先编译再跑。`tsc` 的 `outDir` 写在 `ink-guard/tools/tsconfig.sim.json` 里，固定是 `/tmp/ink-guard-sim`：

```bash
npx --yes -p typescript tsc -p ink-guard/tools/tsconfig.sim.json
node /tmp/ink-guard-sim/tools/simulate.js
```

## 已知缺口

- 字令、墨寇和命中飘字仍是运行时节点，不是逐帧动画。
- 只有单机波次，没有玩家对战。
- 没有广告、没有内购、没有账号。
- 墨寇沿固定折线走，不占格子，也不会被字令挡住。
- 还没配微信小游戏 AppID。要用微信包时，在 Creator 里自行「构建发布」，不要把密钥写进仓库。
- 项目设置里不要裁掉 2D、UI、Graphics。血条和字令是 Sprite，拖动时的射程圈仍用 Graphics。
