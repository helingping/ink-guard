# 资源

运行时不要直接读这个目录。进游戏的图、字体和配置放在 `ink-guard/assets/`，由 Cocos Creator 导入。

## 命名

- 只用英文文件名，小写，单词之间用连字符：`battlefield-caimo.jpg`。
- 不要用中文、空格或商业游戏里的专有名字做文件名。
- 概念图放在 `concepts/`，表示原稿。游戏里用的是从原稿切出来的 sprite。

## 现在有什么

| 文件 | 用途 |
| --- | --- |
| `concepts/battlefield-caimo.jpg` | 宣纸、远山、河道、棋盘和阿斗印的原稿 |
| `concepts/units-caimo.jpg` | 刀、枪、弓、骑四字的笔墨原稿 |
| `concepts/vfx-caimo-mid.jpg` | 命中和装饰用的彩墨溅射原稿 |

工程内的副本和切图：

| 路径 | 用途 |
| --- | --- |
| `ink-guard/assets/concepts/` | 同上三张原稿，方便只打开 Creator 工程时也能看到 |
| `ink-guard/assets/resources/textures/` | 棋盘格、阿斗印、河道、竹、山、字令、按钮、血条、落点环 |
| `ink-guard/assets/resources/pose/` | 刀、枪、弓、骑各自的 4 帧攻击动作 |
| `ink-guard/assets/resources/fx/` | 每种字令自己的 4 帧攻击特效，另有 `gong-arrow.png` |
| `ink-guard/assets/resources/fonts/` | 马善政、Noto Sans CJK SC Regular，以及 OFL 许可 |

切图脚本：`ink-guard/tools/export-ui-sprites.py`，攻击帧是 `ink-guard/tools/export-attack-frames.py`。
