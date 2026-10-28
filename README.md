# 📁 局域网文件传输

![Node.js >= 18](https://img.shields.io/badge/Node.js-%3E%3D18-brightgreen)
![License: MIT](https://img.shields.io/badge/License-MIT-blue)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-orange)

一个简单易用的局域网文件传输 Web 应用，支持拖拽上传、设备在线展示、实时传输状态显示、暗色模式与 mDNS 固定域名访问。手机扫码即用，无需安装任何客户端。

## ✨ 功能特性

- 🔄 局域网设备在线列表（WebSocket 实时同步）
- 📤 拖拽上传文件和文件夹（页面任意位置投放，并发队列 + 聚合进度 + 可取消）
- 📊 实时传输进度与速度显示，"清除已完成"一键整理
- 🗂️ 文件树管理：搜索、排序、多选下载（ZIP）、批量删除，刷新后保留展开/勾选状态
- 🖼️ 图片点击 Lightbox 预览
- 🌙 暗色模式（跟随系统 + 手动切换记忆），青蓝科技风配色
- 💻 桌面端两栏布局：左侧连接信息/传输状态/在线设备，右侧上传与文件列表首屏即见
- 📱 响应式设计 + PWA（手机“添加到桌面”获得独立 App 体验，手机端自动隐藏二维码板块）
- 🌐 mDNS 固定域名：`http://主机名.local:端口`（iOS/macOS/Windows 支持）
- 🚀 无需安装、无构建工具，浏览器即可使用；二维码扫码直达
- 🤖 Agent 接入：内置 Skill，可让 AI agent 按需拉起服务、把文件/报告推入共享区并发手机链接（用完自动关闭）

## 🚀 快速开始

> 要求 Node.js >= 18

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

或双击 `start.bat` / `lan-transfer.bat` 启动。

### 3. 访问应用

启动后会显示访问地址：
- 本机访问: `http://localhost:3000`
- 局域网访问: `http://你的IP:3000`
- 备用地址: `http://主机名.local:3000`（需系统支持 mDNS）

端口被其他程序占用时会自动切换到下一个可用端口；若占用者是本应用的旧实例，会直接复用提示地址。

## 📖 使用说明

1. **首次访问**: 设备名自动分配（`设备-XXXX`），无需填写；点击左上角设备名可随时自定义
2. **上传文件**: 拖拽文件/文件夹到页面任意位置，或点击选择
3. **管理文件**: 搜索/排序/勾选后批量下载（自动打包 ZIP）或删除
4. **预览图片**: 点击图片文件名或 👁️ 按钮

## 🧪 测试

```bash
npm test
```

使用 Node 内置 `node:test`，覆盖重连核心与服务端全部 HTTP 接口（路径遍历防护、中文文件名、同名不覆盖、批量下载去重等）。

## 🤖 Agent 接入（Skill）

本服务是纯 REST API，**无需引入 MCP 等额外协议**即可被 AI agent 调用。仓库内置一份开箱即用的 Agent Skill：

```
skills/lan-file-transfer/SKILL.md
```

**它能做什么**：对 agent 说「把这个 APK 传到手机」，agent 会自行完成整条链路——

1. 按需拉起服务（静默启动，不弹浏览器；已在运行则直接复用）
2. 上传文件到共享区
3. 在电脑屏幕上打开页面供手机扫码（并给出可手输的直链）
4. 5 分钟后自动关闭服务，用完即走、不常驻

**安装**：把 `skills/lan-file-transfer/` 复制到你的 agent 客户端 skills 目录：

| 客户端 | skills 目录 |
|---|---|
| CodeArts | `~/.codearts/skills/` |
| WorkBuddy | `~/.workbuddy/skills/` |
| CodeBuddy | `~/.codebuddy/skills/` |
| Trae CN | `~/.trae-cn/skills/` |
| Qoder CN | `~/.qoder-cn/skills/` |
| Claude Code | `~/.claude/skills/` |

> 安装后请把 `SKILL.md` 中的 `<项目路径>` 改成你的实际安装路径（例如 `D:\vibecoding\lan-file-transfer`）。

**为什么是 Skill 而不是 MCP**：agent 需要的三个操作为「推送本机文件 / 写入文本到共享区 / 生成下载链接」，现有 REST API 已全覆盖。服务端只需新增两个环境变量开关（见下方「配置」），**不引入任何新依赖**，且上下文占用远小于常驻的工具 schema。

> 注意：下载链接仅在局域网内可达，跨网段使用需自行配置内网穿透。

## 🛠️ 技术栈

- **后端**: Node.js + Express + ws + multer + archiver + bonjour-service
- **前端**: 原生 HTML/CSS/JavaScript（ES Modules，无构建工具）
- **通信**: WebSocket（设备与 IP 变化通知）+ HTTP（文件传输）

## 📁 项目结构

```
lan-file-transfer/
├── server.js              # 启动入口（端口探测、mDNS、优雅关闭）
├── src/
│   ├── config.js          # 端口/目录/上传限制等配置
│   ├── network.js         # 本机 IP、端口探测、mDNS 广播
│   ├── ws-hub.js          # WebSocket 连接与设备列表管理
│   ├── app.js             # Express 应用组装（可注入测试目录）
│   └── routes/files.js    # 上传/下载/批量下载/删除/列表/health
├── public/
│   ├── index.html         # 主页面
│   ├── manifest.json      # PWA 清单
│   ├── style.css          # 样式（含暗色模式变量）
│   ├── icons/             # 应用图标
│   └── js/
│       ├── main.js        # 前端入口（组装各模块）
│       ├── ws.js          # 连接与状态栏
│       ├── upload.js      # 上传队列与进度
│       ├── file-tree.js   # 文件树渲染与操作
│       ├── ui.js          # toast/对话框/lightbox/主题
│       ├── reconnect-core.js  # 断线重连核心（UMD）
│       └── qrcode.min.js  # 二维码库（本地化，离线可用）
├── tests/                 # node:test 测试
├── skills/                # Agent Skill（SKILL.md，复制到 agent 客户端 skills 目录即用）
└── uploads/               # 上传文件存储目录（自动创建）
```

## ⚙️ 配置

在 `src/config.js` 中可以修改以下配置：

```javascript
DEFAULT_PORT: 3000,                        // 默认端口（占用时自动 +1 探测）
UPLOAD_DIR: path.join(__dirname, '..', 'uploads'), // 上传目录
MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024,     // 单文件大小限制（默认 2GB）
```

也可通过环境变量控制运行行为（主要用于脚本/agent 按需启动）：

| 环境变量 | 作用 |
|---|---|
| `LAN_TRANSFER_NO_BROWSER=1` | 启动时不自动打开浏览器（静默运行） |
| `LAN_TRANSFER_AUTO_EXIT_MINUTES=5` | 运行指定分钟数后自动关闭（临时分享场景，用完即走） |

## 📝 注意事项

- 仅支持局域网内使用，建议在受信任的网络环境中使用
- 上传的文件存储在服务器本地 `uploads/` 目录
- `.local` 备用地址依赖 mDNS 解析，多数 Android 浏览器不支持（系统限制），IP 地址仍是主入口

## 🤝 贡献

欢迎提交 Issue 和 Pull Request：

1. Fork 本仓库并创建分支
2. 提交前运行 `npm test` 确保全部测试通过
3. 提交 PR 并描述改动内容

## 📄 许可证

[MIT](LICENSE)
