/**
 * ReconnectCore 单元测试
 *
 * 测试目标：验证 WebSocket 重连核心模块的状态机、过期事件过滤、并发防护、
 * 服务器未启动提示、服务器重启后重连等关键行为。
 *
 * 运行方式：node --test tests/reconnect.test.js
 */
const { test, describe } = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const ReconnectCore = require('../public/js/reconnect-core');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 创建测试用 WebSocket 服务器
 * @param {number} port
 */
function createTestServer(port) {
    const wss = new WebSocket.Server({ port });
    const clients = [];
    wss.on('connection', (ws) => {
        clients.push(ws);
        ws.on('close', () => {
            const idx = clients.indexOf(ws);
            if (idx !== -1) clients.splice(idx, 1);
        });
    });
    return {
        wss,
        clients,
        close() {
            return new Promise((resolve) => wss.close(resolve));
        },
        dropAll() {
            clients.forEach(ws => ws.close());
        }
    };
}

describe('ReconnectCore', () => {
    test('正常连接后状态为 connected', async () => {
        const server = createTestServer(19001);
        const states = [];
        const client = new ReconnectCore({
            url: 'ws://localhost:19001',
            createWebSocket: (url) => new WebSocket(url),
            checkAlive: () => Promise.resolve(true),
            onStateChange: (state) => states.push(state)
        });

        client.connect();
        await delay(200);

        assert.ok(states.includes('connected'), `期望状态包含 connected，实际为 ${states.join(', ')}`);

        client.disconnect();
        await server.close();
    });

    test('服务器主动关闭连接后自动重连', async () => {
        const server = createTestServer(19002);
        const states = [];
        const client = new ReconnectCore({
            url: 'ws://localhost:19002',
            createWebSocket: (url) => new WebSocket(url),
            checkAlive: () => Promise.resolve(true),
            onStateChange: (state) => states.push(state)
        });

        client.connect();
        await delay(200);
        assert.ok(states.includes('connected'));

        states.length = 0;
        server.dropAll();
        await delay(200);

        assert.ok(states.includes('checking') || states.includes('reconnecting'),
            `断开后期望进入 checking 或 reconnecting，实际为 ${states.join(', ')}`);

        // 等待自动重连（默认 1000ms 退避）
        await delay(1500);
        assert.ok(states.includes('connected'), `期望自动重连成功，实际状态为 ${states.join(', ')}`);

        client.disconnect();
        await server.close();
    });

    test('服务器完全停止后进入 server-down', async () => {
        const server = createTestServer(19003);
        const states = [];
        const client = new ReconnectCore({
            url: 'ws://localhost:19003',
            createWebSocket: (url) => new WebSocket(url),
            checkAlive: () => Promise.resolve(false),
            onStateChange: (state) => states.push(state)
        });

        client.connect();
        await delay(200);
        server.dropAll();
        await delay(500);

        assert.ok(states.includes('server-down'), `期望进入 server-down，实际为 ${states.join(', ')}`);
        assert.strictEqual(client.state, 'server-down');

        client.disconnect();
        await server.close();
    });

    test('server-down 状态下手动连接失败后回到 server-down', async () => {
        const states = [];
        const client = new ReconnectCore({
            // 使用未占用的端口模拟服务器未启动
            url: 'ws://localhost:19099',
            createWebSocket: (url) => new WebSocket(url),
            checkAlive: () => Promise.resolve(false),
            onStateChange: (state) => states.push(state)
        });

        client.connect();
        await delay(500);
        assert.strictEqual(client.state, 'server-down');

        states.length = 0;
        client.connect(); // 手动重连
        await delay(100);
        assert.ok(states.includes('connecting'), `手动重连后期望进入 connecting，实际为 ${states.join(', ')}`);

        // 等待连接失败和 checkAlive 完成
        await delay(1500);
        assert.strictEqual(client.state, 'server-down',
            `手动重连失败后期望回到 server-down，实际为 ${client.state}`);

        client.disconnect();
    });

    test('服务器重启后手动连接可恢复', async () => {
        let server = createTestServer(19005);
        const states = [];
        const client = new ReconnectCore({
            url: 'ws://localhost:19005',
            createWebSocket: (url) => new WebSocket(url),
            checkAlive: () => Promise.resolve(false),
            onStateChange: (state) => states.push(state)
        });

        client.connect();
        await delay(200);
        server.dropAll();
        await delay(500);
        assert.strictEqual(client.state, 'server-down');

        await server.close();
        await delay(200);

        // 重启服务器
        server = createTestServer(19005);
        states.length = 0;
        client.connect();
        await delay(500);

        assert.ok(states.includes('connected'), `服务器重启后手动重连期望恢复 connected，实际为 ${states.join(', ')}`);

        client.disconnect();
        await server.close();
    });

    test('连续快速调用 connect 只产生一个活动连接', async () => {
        const server = createTestServer(19006);
        const connectionCount = { value: 0 };
        server.wss.on('connection', () => {
            connectionCount.value += 1;
        });

        const client = new ReconnectCore({
            url: 'ws://localhost:19006',
            createWebSocket: (url) => new WebSocket(url),
            checkAlive: () => Promise.resolve(true),
            onStateChange: () => {}
        });

        client.connect();
        client.connect();
        client.connect();
        await delay(300);

        assert.strictEqual(connectionCount.value, 1,
            `快速多次 connect 应只产生 1 个连接，实际产生了 ${connectionCount.value} 个`);

        client.disconnect();
        await server.close();
    });
});
