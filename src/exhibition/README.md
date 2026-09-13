# 纯点地形预览

独立页面，不替换项目原有档案、五个模型或观测交互。

当前已按用户确认的第 2 张效果图实现：五处疏朗、大小不一的主要土丘，两个前景微小起伏，中央大面积低缓空地。视觉基准为 `../../../outputs/terrain-concepts-20260830-round-mounds/option-2.png`，该图片不参与运行时渲染。

## 打开

在项目目录运行：

```powershell
node node_modules/vite/bin/vite.js --config exhibition.vite.config.mjs
```

浏览器地址：`http://127.0.0.1:5191/exhibition.html`

- 默认顺时针慢转，180 秒一圈。
- 默认使用已确认的“戏剧光照”：低角度侧光、柔和地形投影、微弱冷色补光；右下角可切换“原光照 / 戏剧光照”。
- “暂停旋转”冻结画面；“参考视角”回到起始角度并暂停。
- 系统开启“减少动态效果”时默认暂停。
- 加 `?study=1`：隐藏界面，固定参考角度，便于截图。
- 加 `?debug=1`：增加 0°/90°/180°/270° 的检查菜单。
- 加 `?lighting=original`：以原光照打开；可与上述参数组合。

## 文件

- `terrain.js`：固定种子的圆钝土丘、细节噪声、点位置、遮挡几何和局部颜色。按用户最新反馈，已去掉平行长条山脊和顶部亮线强化。
- `TerrainPreview.jsx`：真实 3D 渲染、旋转、暂停、窗口适配、加载和错误处理。
- `lighting.js`：基于现有高度场计算低角度侧光和近似柔和投影。光照在初始化时预计算，随地形整体旋转；不是世界空间固定灯光或逐帧重算的阴影。
- `main.jsx`：独立 React 入口。
- `style.css`：最小化的桌面展示界面。
- `../../tests/exhibition-terrain.test.mjs`：几何和旋转测试。
- `design-qa.md`：当前第 2 张的对照与验证结论；历史版本记录在 `../../qa/exhibition/design-qa.md`。

## 构建与测试

```powershell
node --test tests/exhibition-terrain.test.mjs
node node_modules/vite/bin/vite.js build --config exhibition.vite.config.mjs
```

构建输出 `dist/exhibition`。可单独静态托管；不包含五个模型、参考图或视频。本次未发布至公网。

地形点和底层遮挡面在同一高度场采样；静态缓冲只创建一次。旋转只改整体变换，最多 60 次/秒重绘；页面不可见时不重绘。点数 111,636，DPR 上限 1.5。八项测试包含中央留空、主要土丘布局、光照遮挡，以及高度场、点位置和原光照缓冲完全不变的回归检查。

用户已确认当前戏剧光照。此次只调整点的颜色和明暗，没有增加地形高度或改变采样。光照版本的截图与验证记录见 `../../qa/exhibition/lighting-qa.md`。

这是参考风格的程序化三维重建，不是从单张图恢复出的唯一原始地形，也不宣称精确复刻所有山峰位置。
