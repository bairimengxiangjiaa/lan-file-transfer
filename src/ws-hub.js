const os = require('os');
const WebSocket = require('ws');
const { getLocalIP } = require('./network');

/**
 * 创建 WebSocket 中心：管理设备连接、心跳、设备列表与 IP 变化广播
 * @param {import('http').Server} server
 * @param {Object} [options]
 * @param {number} [options.heartbeatInterval=30000] - 心跳检查间隔
 * @param {number} [options.heartbeatTimeout=60000] - 无活动断开阈值
 */
function createWsHub(server, options = {}) {
    const heartbeatInterval = options.heartbeatInterval || 30000;
    const heartbeatTimeout = options.heartbeatTimeout || 60000;

    const wss = new WebSocket.Server({ server });
    const clients = new Map();
    let currentIP = getLocalIP();

    // 心跳检测：超时无活动则断开
    const sweeper = setInterval(() => {
        const now = Date.now();
        wss.clients.forEach(ws => {
            if (ws.lastActivity && now - ws.lastActivity > heartbeatTimeout) {
                clients.delete(ws);
                ws.terminate();
            }
        });
    }, heartbeatInterval);

    function generateDeviceId() {
        return Math.random().toString(36).substring(2, 15);
    }

    function broadcast(obj) {
        const message = JSON.stringify(obj);
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    function broadcastDeviceList() {
        broadcast({
            type: 'device-list',
            devices: Array.from(clients.values()).map(c => ({
                id: c.id,
                name: c.name,
                ip: c.ip
            }))
        });
    }

    function handleMessage(ws, data) {
        switch (data.type) {
            case 'ping':
                ws.send(JSON.stringify({ type: 'pong' }));
                break;

            case 'set-name': {
                const client = clients.get(ws);
                if (client && typeof data.name === 'string' && data.name.trim()) {
                    client.name = data.name.trim().slice(0, 30);
                    broadcastDeviceList();
                }
                break;
            }
        }
    }

    wss.on('connection', (ws, req) => {
        const deviceId = generateDeviceId();
        const clientIP = (req.socket.remoteAddress || '').replace('::ffff:', '');
        // 初始名用短 ID 区分，避免所有设备都显示服务器主机名
        const deviceName = '设备-' + deviceId.slice(-4);

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
            ip: currentIP,
            hostname: os.hostname(),
            mDNS: os.hostname() + '.local'
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
            if (clients.delete(ws)) {
                broadcastDeviceList();
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket错误:', error);
        });
    });

    return {
        wss,
        getIP: () => currentIP,
        /** 更新当前 IP，变化时广播给所有客户端 */
        setIP(ip) {
            if (ip && ip !== currentIP) {
                currentIP = ip;
                broadcast({ type: 'ip-update', ip });
            }
        },
        /** 关闭所有连接并停止心跳检测 */
        close() {
            clearInterval(sweeper);
            wss.clients.forEach(ws => ws.close());
        }
    };
}

module.exports = { createWsHub };
