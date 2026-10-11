# ipet 预览页

独立于 Tauri 的 Three.js 预览,与 `ui/src/main.ts` 渲染逻辑同构,用于在浏览器里直接看宠物效果。

## 运行

```bash
cd preview
# 1. 准备 VRM 模型(任选其一):
#    a) 用 VRoid Studio 免费制作并导出 .vrm,改名为 model.vrm 放到本目录
#    b) 下载 three-vrm 官方示例模型:
curl -fSL -o model.vrm "https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm"

# 2. 起本地服务
python3 -m http.server 8123

# 3. 浏览器打开
#    http://127.0.0.1:8123/index.html
```

页面自带演示控制台,可一键触发「喝水提醒」「远眺提醒」气泡与表情;
URL 参数 `?demo=water` / `?demo=eye` / `?demo=idle` 可直接进入对应状态(方便截图)。

> 注意:示例模型仅用于开发预览,请勿用于正式发布;正式版请使用自有授权的模型。
