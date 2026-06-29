# 📁 局域网文件传输

一个简单易用的局域网文件传输Web应用，支持拖拽上传、设备自动发现、实时传输状态显示。

## ✨ 功能特性

- 🔄 局域网自动发现设备
- 📤 拖拽上传文件和文件夹
- 📊 实时传输进度
- 📱 响应式设计，支持手机访问
- 🚀 无需安装，浏览器即可使用
- 💾 文件管理（下载/删除）
- 🪟 支持 Windows 系统服务（开机自启）

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
npm start
```

### 3. 访问应用

启动后会显示访问地址：
- 本机访问: `http://localhost:3000`
- 局域网访问: `http://你的IP:3000`

在同一局域网内的其他设备可以通过局域网地址访问。

## 📖 使用说明

1. **首次访问**: 设置设备名称
2. **上传文件**: 拖拽文件或文件夹到上传区域，或点击选择
3. **下载文件**: 点击文件右侧的下载按钮
4. **删除文件**: 点击文件右侧的删除按钮

## 🪟 Windows 系统服务

可以将应用安装为 Windows 系统服务，实现开机自启、后台运行。

### 安装服务

```bash
# 方式一：使用 npm 脚本
npm run service:install

# 方式二：直接运行脚本
node service.js install

# 方式三：双击 install-service.bat
```

### 管理服务

```bash
npm run service:start      # 启动服务
npm run service:stop       # 停止服务
npm run service:restart    # 重启服务
npm run service:uninstall  # 卸载服务
```

也可以直接双击对应的 `.bat` 文件：
- `install-service.bat` - 安装服务
- `uninstall-service.bat` - 卸载服务
- `start-service.bat` - 启动服务
- `stop-service.bat` - 停止服务

> **注意**：安装/卸载服务需要管理员权限。

## 🛠️ 技术栈

- **后端**: Node.js + Express + WebSocket
- **前端**: 原生 HTML/CSS/JavaScript
- **通信**: WebSocket（设备发现）+ HTTP（文件传输）

## 📁 项目结构

```
lan-file-transfer/
├── server.js              # 服务器端代码
├── service.js             # Windows 服务管理脚本
├── package.json           # 项目配置
├── README.md              # 项目说明
├── start.bat              # 快速启动脚本
├── install-service.bat    # 安装服务脚本
├── uninstall-service.bat  # 卸载服务脚本
├── start-service.bat      # 启动服务脚本
├── stop-service.bat       # 停止服务脚本
├── public/                # 前端静态文件
│   ├── index.html         # 主页面
│   ├── style.css          # 样式文件
│   └── app.js             # 前端逻辑
└── uploads/               # 上传文件存储目录（自动创建）
```

## ⚙️ 配置

在 `server.js` 中可以修改以下配置：

```javascript
const PORT = 3000;                    // 服务端口
const UPLOAD_DIR = './uploads';       // 上传目录
limits: { fileSize: 1024 * 1024 * 1024 } // 文件大小限制（默认1GB）
```

## 📝 注意事项

- 仅支持局域网内使用
- 上传的文件存储在服务器本地
- 建议在受信任的网络环境中使用

## 📄 许可证

MIT