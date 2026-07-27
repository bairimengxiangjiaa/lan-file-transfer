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

1. **首次访问**: 设置设备名称（点击左上角设备名可随时修改）
2. **上传文件**: 拖拽文件/文件夹到页面任意位置，或点击选择
3. **管理文件**: 搜索/排序/勾选后批量下载（自动打包 ZIP）或删除
4. **预览图片**: 点击图片文件名或 👁️ 按钮

## 🧪 测试

```bash
npm test
```

使用 Node 内置 `node:test`，覆盖重连核心与服务端全部 HTTP 接口（路径遍历防护、中文文件名、同名不覆盖、批量下载去重等）。

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
└── uploads/               # 上传文件存储目录（自动创建）
```

## ⚙️ 配置

在 `src/config.js` 中可以修改以下配置：

```javascript
DEFAULT_PORT: 3000,                        // 默认端口（占用时自动 +1 探测）
UPLOAD_DIR: path.join(__dirname, '..', 'uploads'), // 上传目录
MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024,     // 单文件大小限制（默认 2GB）
```

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
