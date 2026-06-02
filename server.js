const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { exec } = require('child_process');
const archiver = require('archiver');

// 配置
let PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// 路径安全检查：防止路径遍历攻击
function isPathSafe(targetPath) {
    const resolved = path.resolve(targetPath);
    const baseResolved = path.resolve(UPLOAD_DIR);
    return resolved.startsWith(baseResolved + path.sep) || resolved === baseResolved;
}

// 安全地构建路径，如果不安全返回 null
function safePath(...segments) {
    const joined = path.join(UPLOAD_DIR, ...segments);
    return isPathSafe(joined) ? joined : null;
}

// 文件上传：使用磁盘存储（避免大文件占用内存）
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // 临时目录，后续根据 relativePath 移动
        const tmpDir = path.join(UPLOAD_DIR, '.tmp');
        fs.mkdirSync(tmpDir, { recursive: true });
        cb(null, tmpDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 } // 2GB
});

// 创建Express应用
const app = express();
const server = http.createServer(app);

// WebSocket服务器
const wss = new WebSocket.Server({ server });

// 存储连接的客户端
const clients = new Map();

// 获取本机局域网IP地址（排除VPN和虚拟接口）
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const vpnKeywords = ['vpn', 'virtual', 'vmware', 'docker', 'tailscale', 'wireguard', 'tap', 'tun'];
    const preferredNames = ['wlan', 'wi-fi', 'ethernet', '以太网', '无线'];

    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        if (preferredNames.some(p => lowerName.includes(p))) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.')) {
                    return iface.address;
                }
            }
        }
    }

    for (const name of Object.keys(interfaces)) {
        const lowerName = name.toLowerCase();
        const isVPN = vpnKeywords.some(k => lowerName.includes(k));
        if (!isVPN) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.')) {
                    return iface.address;
                }
            }
        }
    }

    return 'localhost';
}

// 当前IP地址
let currentIP = getLocalIP();

// 定期检测IP变化（每30秒）
setInterval(() => {
    const newIP = getLocalIP();
    if (newIP !== currentIP) {
        currentIP = newIP;
        broadcastIPUpdate();
    }
}, 30000);

// 生成设备ID
function generateDeviceId() {
    return Math.random().toString(36).substring(2, 15);
}

// 获取设备名称
function getDeviceName() {
    return os.hostname() || 'Unknown Device';
}

// WebSocket心跳检测（每30秒检查一次，60秒无活动则断开）
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000;

setInterval(() => {
    const now = Date.now();
    wss.clients.forEach(ws => {
        if (ws.lastActivity && now - ws.lastActivity > HEARTBEAT_TIMEOUT) {
            clients.delete(ws);
            ws.terminate();
        }
    });
}, HEARTBEAT_INTERVAL);

// WebSocket连接处理
wss.on('connection', (ws, req) => {
    const deviceId = generateDeviceId();
    const deviceName = getDeviceName();
    const clientIP = (req.socket.remoteAddress || '').replace('::ffff:', '');

    ws.lastActivity = Date.now();

    clients.set(ws, {
        id: deviceId,
        name: deviceName,
        ip: clientIP,
        connectedAt: new Date()
    });

    ws.send(JSON.stringify({
        type: 'welcome',
        deviceId,
        deviceName,
        ip: currentIP
    }));

    broadcastDeviceList();

    ws.on('message', (message) => {
        ws.lastActivity = Date.now();
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (e) {
            console.error('消息解析错误:', e);
        }
    });

    ws.on('close', () => {
        const client = clients.get(ws);
        if (client) {
            clients.delete(ws);
            broadcastDeviceList();
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket错误:', error);
    });
});

// 处理客户端消息
function handleMessage(ws, data) {
    switch (data.type) {
        case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

        case 'set-name':
            const client = clients.get(ws);
            if (client) {
                client.name = data.name;
                broadcastDeviceList();
            }
            break;

        case 'transfer-request':
            const sender = clients.get(ws);
            const targetClient = findClientById(data.targetId);
            if (targetClient && sender) {
                targetClient.ws.send(JSON.stringify({
                    type: 'transfer-request',
                    fromId: sender.id,
                    fromName: sender.name,
                    fileName: data.fileName,
                    fileSize: data.fileSize
                }));
            }
            break;

        case 'transfer-response':
            const responder = clients.get(ws);
            const senderClient = findClientById(data.senderId);
            if (senderClient && responder) {
                senderClient.ws.send(JSON.stringify({
                    type: 'transfer-response',
                    accepted: data.accepted,
                    fromName: responder.name
                }));
            }
            break;
    }
}

// 根据ID查找客户端
function findClientById(deviceId) {
    for (const [ws, client] of clients.entries()) {
        if (client.id === deviceId) {
            return { ws, ...client };
        }
    }
    return null;
}

// 广播设备列表
function broadcastDeviceList() {
    const deviceList = Array.from(clients.values()).map(c => ({
        id: c.id,
        name: c.name,
        ip: c.ip
    }));

    const message = JSON.stringify({
        type: 'device-list',
        devices: deviceList
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// 广播IP更新
function broadcastIPUpdate() {
    const message = JSON.stringify({
        type: 'ip-update',
        ip: currentIP
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// 文件上传接口
app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: '没有文件' });
    }

    try {
        const relativePath = req.body.relativePath || '';
        let savePath;

        if (relativePath) {
            // 安全检查：防止路径遍历
            savePath = safePath(relativePath);
            if (!savePath) {
                // 清理临时文件
                fs.unlinkSync(req.file.path);
                return res.status(403).json({ error: '非法路径' });
            }
            fs.mkdirSync(path.dirname(savePath), { recursive: true });
        } else {
            const ext = path.extname(req.file.originalname);
            const name = path.basename(req.file.originalname, ext);
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            savePath = path.join(UPLOAD_DIR, `${name}-${uniqueSuffix}${ext}`);
        }

        // 移动文件（从临时目录到目标目录）
        fs.renameSync(req.file.path, savePath);

        res.json({
            success: true,
            file: {
                originalName: req.file.originalname,
                filename: path.basename(savePath),
                size: req.file.size
            }
        });
    } catch (err) {
        console.error('保存文件失败:', err);
        // 清理临时文件
        try { fs.unlinkSync(req.file.path); } catch (e) { /* ignore */ }
        res.status(500).json({ error: '保存文件失败' });
    }
});

// 文件/文件夹下载接口
app.get('/download', (req, res) => {
    try {
        const filename = req.query.path;
        if (!filename) {
            return res.status(400).json({ error: '缺少文件路径' });
        }

        const filepath = safePath(filename);
        if (!filepath) {
            return res.status(403).json({ error: '禁止访问' });
        }

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        const stats = fs.statSync(filepath);

        if (stats.isDirectory()) {
            const folderName = path.basename(filename);

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(folderName) + '.zip"');

            const archive = new archiver.ZipArchive();

            archive.on('error', (err) => {
                console.error('压缩错误:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: '创建ZIP失败' });
                }
            });

            archive.pipe(res);
            archive.directory(filepath, false);
            archive.finalize();
        } else {
            const originalName = path.basename(filename);
            res.download(filepath, originalName);
        }
    } catch (err) {
        console.error('下载错误:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: '下载失败' });
        }
    }
});

// 清空所有文件接口
app.delete('/files-all', (req, res) => {
    try {
        const items = fs.readdirSync(UPLOAD_DIR);
        for (const item of items) {
            if (item.startsWith('.')) continue; // 跳过隐藏文件/临时目录
            const itemPath = path.join(UPLOAD_DIR, item);
            fs.rmSync(itemPath, { recursive: true, force: true });
        }
        res.json({ success: true });
    } catch (e) {
        console.error('清空失败:', e);
        res.status(500).json({ error: '清空失败' });
    }
});

// 批量下载接口
app.post('/download-batch', (req, res) => {
    try {
        const { files } = req.body;

        if (!files || !Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: '没有选择文件' });
        }

        // 安全检查：所有路径必须合法
        for (const file of files) {
            if (!safePath(file)) {
                return res.status(403).json({ error: '包含非法路径' });
            }
        }

        // 去重
        const resolvedFiles = [];
        const sortedPaths = [...files].sort();
        for (const file of sortedPaths) {
            const isInsideSelectedDir = resolvedFiles.some(existing => {
                if (file.startsWith(existing + '/') || file === existing) {
                    const existingPath = path.join(UPLOAD_DIR, existing);
                    try {
                        if (fs.existsSync(existingPath) && fs.statSync(existingPath).isDirectory()) {
                            return true;
                        }
                    } catch (e) { /* ignore */ }
                }
                return false;
            });
            if (!isInsideSelectedDir) {
                resolvedFiles.push(file);
            }
        }

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename="download.zip"');

        const archive = new archiver.ZipArchive();

        archive.on('error', (err) => {
            console.error('压缩错误:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: '创建ZIP失败' });
            }
        });

        archive.pipe(res);

        for (const file of resolvedFiles) {
            const filepath = path.join(UPLOAD_DIR, file);
            try {
                if (fs.existsSync(filepath)) {
                    const stats = fs.statSync(filepath);
                    if (stats.isDirectory()) {
                        archive.directory(filepath, file);
                    } else {
                        archive.file(filepath, { name: file });
                    }
                }
            } catch (err) {
                console.error(`添加文件到压缩包时出错: ${file}`, err);
            }
        }

        archive.finalize();
    } catch (err) {
        console.error('批量下载错误:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: '下载失败' });
        }
    }
});

// 递归获取文件列表
function getFilesRecursive(dir, basePath = '') {
    let files = [];

    try {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            if (item.startsWith('.')) continue; // 跳过隐藏文件

            const itemPath = path.join(dir, item);
            const relativePath = basePath ? `${basePath}/${item}` : item;
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                files.push({
                    name: relativePath,
                    originalName: item,
                    size: 0,
                    uploadedAt: stats.mtime,
                    isDirectory: true
                });
                files = files.concat(getFilesRecursive(itemPath, relativePath));
            } else {
                files.push({
                    name: relativePath,
                    originalName: item,
                    size: stats.size,
                    uploadedAt: stats.mtime,
                    isDirectory: false
                });
            }
        }
    } catch (e) {
        console.error('读取目录失败:', e);
    }

    return files;
}

// 获取文件列表
app.get('/files', (req, res) => {
    try {
        const files = getFilesRecursive(UPLOAD_DIR);
        files.sort((a, b) => b.uploadedAt - a.uploadedAt);
        res.json(files);
    } catch (e) {
        res.status(500).json({ error: '获取文件列表失败' });
    }
});

// 删除文件或文件夹
app.delete('/files/:filename(*)', (req, res) => {
    try {
        const filename = req.params.filename;
        const filepath = safePath(filename);

        if (!filepath) {
            return res.status(403).json({ error: '禁止访问' });
        }

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({ error: '文件不存在' });
        }

        const stats = fs.statSync(filepath);
        if (stats.isDirectory()) {
            fs.rmSync(filepath, { recursive: true, force: true });
        } else {
            fs.unlinkSync(filepath);
        }

        res.json({ success: true });
    } catch (e) {
        console.error('删除失败:', e);
        res.status(500).json({ error: '删除失败' });
    }
});

// 检测端口是否可用
function checkPort(port) {
    return new Promise((resolve) => {
        const testServer = http.createServer();
        testServer.listen(port, '0.0.0.0', () => {
            testServer.close(() => resolve(true));
        });
        testServer.on('error', () => resolve(false));
    });
}

// 查找可用端口
async function findAvailablePort(startPort) {
    let port = startPort;
    while (port < startPort + 100) {
        if (await checkPort(port)) {
            return port;
        }
        port++;
    }
    throw new Error('无法找到可用端口');
}

// 显示启动信息
function showStartupInfo(port, originalPort) {
    const lanIP = currentIP;

    console.log('');
    if (originalPort && port !== originalPort) {
        console.log(`  端口 ${originalPort} 已被占用，自动切换到 ${port}`);
    }
    console.log('  ╭─────────────────────────────╮');
    console.log('  │    局域网文件传输服务        │');
    console.log('  ├─────────────────────────────┤');
    console.log(`  │ 地址：http://localhost:${port}`.padEnd(30) + '│');
    console.log(`  │ 局域网：http://${lanIP}:${port}`.padEnd(30) + '│');
    console.log('  │                             │');
    console.log('  │ 浏览器将自动打开...         │');
    console.log('  │ 按 Ctrl+C 停止              │');
    console.log('  ╰─────────────────────────────╯');
    console.log('');
}

// 启动服务器
async function startServer() {
    const originalPort = PORT;

    if (!(await checkPort(PORT))) {
        PORT = await findAvailablePort(PORT);
    }

    server.listen(PORT, '0.0.0.0', () => {
        showStartupInfo(PORT, originalPort);

        const url = `http://localhost:${PORT}`;
        const start = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${start} ${url}`, () => {});
    });
}

startServer();