# ipet 🐾

Rust 桌面宠物：3D 建模 + Agent 具身化 + 健康提醒引擎。

- **3D 宠物**：小狐狸（Khronos 官方示例，CC0+CC-BY），透明窗口浮在桌面上，待机环顾动画、可拖拽；也支持换成自己的 VRM 模型（表情/视线全功能）
- **Agent 连接**：通过 MCP（官方 `rmcp` Rust SDK）以 stdio 接入用户本地安装的智能 agent，agent 跑完任务由宠物"走过来"播报结果
- **提醒引擎**：喝水 / 远眺护眼（20-20-20）/ 定时休息，支持中文自然语言自定义（"每45分钟提醒我喝水"）

## 预览

| 待机 | 喝水提醒 | 远眺提醒 |
|---|---|---|
| ![待机](preview/shots/shot_idle.jpg) | ![喝水提醒](preview/shots/shot_water.jpg) | ![远眺提醒](preview/shots/shot_eye.jpg) |

| 设置面板（提醒 / Agent / 宠物） |
|---|
| ![设置面板](preview/shots/shot_settings.jpg) |

> 预览页用 Khronos 官方示例小狐狸渲染，与 `ui/` 正式渲染器同构。用 `preview/` 独立预览页在浏览器里可实时查看三种状态。

## 架构

```
┌───────────── ui/ ─────────────┐      ┌────────── src-tauri/ ──────────┐
│ Three.js + @pixiv/three-vrm   │      │ Tauri 2：透明/置顶/无边框窗口     │
│ 透明画布 · VRM 渲染 · 表情 · 气泡 │◄────►│ 命令桥接 · 事件转发 · 点击穿透    │
└──────────────────────────────┘      └──────────────┬──────────────────┘
                                                     │ 调用
                                    ┌────────────────▼──────────────────┐
                                    │        crates/ipet-core           │
                                    │  reminder  cron 调度 + 自然语言解析 │
                                    │  agent     MCP client（rmcp）     │
                                    │  config    JSON 配置 / i18n       │
                                    └─────────────────────────────────┘
```

技术路线：Windows 首发，**Rust Core + Tauri 2 + Three.js/VRM** 渲染。
（VRM 生态在 Three.js 侧最成熟：弹簧骨骼、表情、VRMA 动作开箱即用；纯 Rust wgpu 为备选路线。）

## 目录结构

```
ipet/
├── Cargo.toml                  # workspace
├── Cargo.lock
├── crates/ipet-core/           # 纯 Rust 核心库（可独立编译测试）
│   ├── src/
│   │   ├── lib.rs
│   │   ├── config.rs           # 配置加载/保存（~/.config/ipet/config.json）
│   │   ├── reminder.rs         # 提醒引擎 + 中文自然语言解析
│   │   ├── agent.rs            # MCP agent 桥接（rmcp client）
│   │   └── i18n.rs             # 中/英文案
│   └── tests/
│       ├── agent_bridge.rs     # Agent 端到端集成测试
│       └── fake_mcp_server.py  # 测试用最小 MCP server（Python stdio）
├── src-tauri/                  # Tauri 2 主程序（透明窗口 + 命令桥接）
├── ui/                         # 前端渲染器（Three.js + three-vrm）
├── preview/                    # 独立浏览器预览页（与 ui 同构，无需 Tauri）
└── README.md
```

## 运行

### 1. 验证 Rust 核心（任何平台，需先安装 Rust）

```bash
cargo test -p ipet-core
# 16 个测试：13 个单元测试 + 3 个 Agent 端到端集成测试
```

### 2. 浏览器里直接看宠物（无需 Tauri）

```bash
cd preview
# 下载默认宠物模型（小狐狸，Khronos 官方示例）：
curl -fSL -o pet.glb "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Fox/glTF-Binary/Fox.glb"

python3 -m http.server 8123
# 浏览器打开 http://127.0.0.1:8123/index.html
# 左上角演示控制台可触发喝水/远眺提醒与表情
```

### 3. 完整桌面应用（建议 Windows）

```bash
# 安装依赖
cargo install tauri-cli
cd ui && npm install && cd ..

# 准备模型：下载默认小狐狸 pet.glb 放到 ui/public/assets/
curl -fSL -o ui/public/assets/pet.glb "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Fox/glTF-Binary/Fox.glb"
# （想换宠物：任意 GLB 都可直接替换；VRM 模型则自动启用表情/视线全功能管线）

# 开发运行
cargo tauri dev

# 打包
cargo tauri build
```

> Linux 构建 Tauri 需要 webkit2gtk 等系统依赖；macOS / Windows 按 Tauri 官方文档安装依赖即可。

### 4. 接入你的 agent（MCP）

宠物启动后，通过前端设置或调用命令注册本地 MCP server：

```json
// 示例：接入一个本地 MCP server（任意支持 MCP 的 agent 均可）
{ "name": "my-agent", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"], "persona": "assistant" }
```

调用流程：`agent_register` → `agent_connect`（拉起子进程 + MCP 握手，返回 tool 列表）→ `agent_call_tool`。

### 5. 提醒

- 内置：喝水（工作日每 45 分钟）/ 远眺（每 20 分钟）/ 休息（每 50 分钟），首次启动自动载入
- 自定义：前端调用 `add_reminder_natural("每45分钟提醒我喝水")`，或按 cron 写 `add_reminder`
- 提醒分级：gentle（只做动作）→ normal（气泡）→ strong（弹窗 + 语音播报，可在设置里关闭）

## 路线图

- [x] 语音播报（TTS，强提醒自动播报）
- [x] 亲密度 / 情绪养成系统
- [x] 番茄钟工作流（25/5/15 分钟，设置面板可控）
- [ ] 语音指令（本地 whisper）
- [ ] 勿扰模式（全屏检测）
- [ ] 换装 / 皮肤包、社区市场
- [ ] macOS / Linux 适配

## 模型来源与署名

- **默认宠物**：[Fox](https://github.com/KhronosGroup/glTF-Sample-Models/tree/main/2.0/Fox)（Khronos glTF 官方示例）
  - 模型本体：CC0，by [PixelMannen](https://opengameart.org/content/fox-and-shiba)
  - 骨骼与动画：CC-BY 4.0，by [@tomkranis](https://sketchfab.com/models/371dea88d7e04a76af5763f2a36866bc)（Sketchfab）
- 想换宠物：任意 GLB 直接替换 `pet.glb` 即可；VRM 模型会自动启用表情/视线全功能管线（可用 VRoid Studio 免费制作导出）
- 注意：使用他人模型请确认授权许可
