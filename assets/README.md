# 资源

运行时不要直接读这个目录。进游戏的图和配置放在 `ink-guard/assets/`，由 Cocos Creator 导入。

## 命名

- 只用英文文件名，小写，单词之间用连字符：`battlefield-caimo.jpg`。
- 不要用中文、空格或商业游戏里的专有名字做文件名。
- 概念图放在 `concepts/`，表示「只供看」。真要在游戏里显示，另存一份到 `ink-guard/assets/`，并提交 Creator 生成的 `.meta`。

## 现在有什么

| 文件 | 用途 |
| --- | --- |
| `concepts/battlefield-caimo.jpg` | 宣纸、远山、河道、上下两座空棋盘的气氛稿。MVP 只用一座阵 |
| `concepts/units-caimo.jpg` | 刀、枪、弓、骑四字的笔墨参考 |
| `concepts/vfx-caimo-mid.jpg` | 命中时的彩墨溅射参考 |

这三张还没有切成序列帧。游戏里的「刀」「枪」「弓」「骑」是 Creator 里的 Label，印章和河道是代码绘制的。等有了切图，再按上面的英文 kebab-case 放进 Cocos 工程。
