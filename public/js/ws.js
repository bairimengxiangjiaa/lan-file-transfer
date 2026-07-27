/**
 * WebSocket 连接模块：基于 ReconnectCore 管理连接与状态栏 UI
 * ReconnectCore 由 reconnect-core.js（UMD）暴露在全局
 */

let wsClient = null;
let currentState = 'disconnected';

const statusEl = () => document.getElementById('connectionStatus');

/**
 * 统一更新连接状态栏
 * @param {string} state - connected | connecting | reconnecting | checking | disconnected | server-down
 */
function updateConnectionStatus(state) {
    currentState = state;
    const status = statusEl();
    status.classList.remove('disconnected', 'connecting', 'server-down');

    switch (state) {
        case 'connected':
            status.textContent = '● 已连接';
            break;
        case 'connecting':
            status.textContent = '● 连接中...';
            status.classList.add('connecting');
            break;
        case 'reconnecting':
            status.textContent = '● 重连中...';
            status.classList.add('connecting');
            break;
        case 'checking':
            status.textContent = '● 连接断开，检测中...';
            status.classList.add('disconnected');
            break;
        case 'server-down':
            status.textContent = '● 服务器未启动，点击重连';
            status.classList.add('server-down');
            break;
        case 'disconnected':
        default:
            status.textContent = '● 已断开，点击重连';
            status.classList.add('disconnected');
            break;
    }
}

// 检测服务器是否在线（轻量端点，不再拉取整个文件列表）
async function checkServerAlive() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch('/health', { method: 'GET', signal: controller.signal });
        clearTimeout(timeoutId);
        return res.ok;
    } catch (e) {
        return false;
    }
}

/**
 * 初始化 WebSocket 连接
 * @param {Object} handlers
 * @param {function} handlers.onWelcome - 收到 welcome 消息
 * @param {function} handlers.onDeviceList - 收到设备列表
 * @param {function} handlers.onIpUpdate - 收到 IP 更新
 * @param {function} [handlers.getDeviceName] - 获取本机设备名（连接成功后上报）
 */
export function connect(handlers) {
    if (wsClient) {
        wsClient.disconnect();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    wsClient = new ReconnectCore({
        url: `${protocol}//${window.location.host}`,
        checkAlive: checkServerAlive,
        onStateChange: updateConnectionStatus,
        onOpen: () => {
            const name = handlers.getDeviceName ? handlers.getDeviceName() : null;
            if (name) {
                wsClient.send({ type: 'set-name', name });
            }
        },
        onMessage: (rawData) => {
            try {
                const data = JSON.parse(rawData);
                switch (data.type) {
                    case 'welcome':
                        handlers.onWelcome(data);
                        break;
                    case 'device-list':
                        handlers.onDeviceList(data.devices);
                        break;
                    case 'ip-update':
                        handlers.onIpUpdate(data.ip);
                        break;
                    case 'pong':
                        break;
                }
            } catch (e) {
                console.error('消息解析错误:', e);
            }
        }
    });

    wsClient.connect();

    // 状态栏点击重连（基于状态变量判断，只绑定一次）
    if (!statusEl().dataset.bound) {
        statusEl().dataset.bound = '1';
        statusEl().addEventListener('click', () => {
            if (currentState === 'connected') return;
            wsClient.connect();
        });
    }
}

/** 发送消息（连接未建立时静默忽略） */
export function send(data) {
    if (wsClient) {
        wsClient.send(data);
    }
}
