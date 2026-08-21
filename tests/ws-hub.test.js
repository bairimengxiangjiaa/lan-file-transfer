/**
 * WebSocket Hub 测试：设备列表广播、心跳剔除僵尸连接
 * 运行：node --test tests/ws-hub.test.js
 *
 * 注意：必须在创建 WebSocket 后立即挂载消息收集器。
 * 服务端在握手完成瞬间就会推送 welcome / device-list，
 * 客户端会在同一个事件循环 tick 内同步派发这些消息，
 * 等 await open 之后再挂监听会错过它们。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const WebSocket = require('ws');
const { createWsHub } = require('../src/ws-hub');

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** 立即挂载消息收集器（须在连接建立前调用） */
function attachCollector(ws) {
    const messages = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    return messages;
}

/** 轮询等待收集器中出现满足条件的消息，超时抛错（防止测试进程挂起） */
async function waitFor(messages, predicate, label, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const found = messages.find(predicate);
        if (found) return found;
        await delay(10);
    }
    throw new Error(`等待超时: ${label}`);
}

test('心跳超时剔除僵尸连接后，广播不含该设备的 device-list', async () => {
    // 独立实例：短心跳便于测试
    const server = http.createServer();
    const hub = createWsHub(server, { heartbeatInterval: 40, heartbeatTimeout: 150 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const wsA = new WebSocket(`ws://127.0.0.1:${port}`);
        const msgsA = attachCollector(wsA);
        await new Promise(resolve => wsA.once('open', resolve));
        wsA.send(JSON.stringify({ type: 'set-name', name: '僵尸设备' }));

        const wsB = new WebSocket(`ws://127.0.0.1:${port}`);
        const msgsB = attachCollector(wsB);
        await new Promise(resolve => wsB.once('open', resolve));

        // B 应看到 A 在线（共 2 台设备）
        const listWithA = await waitFor(msgsB,
            d => d.type === 'device-list' && d.devices.some(dev => dev.name === '僵尸设备'),
            '包含僵尸设备的列表');
        assert.strictEqual(listWithA.devices.length, 2);

        // 模拟 A 半开僵尸：不再发任何消息；B 持续发应用层 ping 保持自身活跃
        const keepAlive = setInterval(() => {
            if (wsB.readyState === WebSocket.OPEN) {
                wsB.send(JSON.stringify({ type: 'ping' }));
            }
        }, 50);

        try {
            // A 心跳超时被剔除后，B 必须收到不含 A 的广播（回归验证旧版漏广播 bug）
            const listWithoutA = await waitFor(msgsB,
                d => d.type === 'device-list' && !d.devices.some(dev => dev.name === '僵尸设备'),
                '剔除后的列表');
            assert.strictEqual(listWithoutA.devices.length, 1);
            assert.notStrictEqual(listWithoutA.devices[0].name, '僵尸设备');
        } finally {
            clearInterval(keepAlive);
        }

        wsA.close();
        wsB.close();
    } finally {
        hub.close();
        await new Promise(resolve => server.close(resolve));
    }
});

test('正常关闭连接后广播 device-list', async () => {
    const server = http.createServer();
    const hub = createWsHub(server, { heartbeatInterval: 1000, heartbeatTimeout: 5000 });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    try {
        const wsA = new WebSocket(`ws://127.0.0.1:${port}`);
        attachCollector(wsA);
        await new Promise(resolve => wsA.once('open', resolve));
        wsA.send(JSON.stringify({ type: 'set-name', name: '临时设备' }));

        const wsB = new WebSocket(`ws://127.0.0.1:${port}`);
        const msgsB = attachCollector(wsB);
        await new Promise(resolve => wsB.once('open', resolve));

        await waitFor(msgsB,
            d => d.type === 'device-list' && d.devices.some(dev => dev.name === '临时设备'),
            '包含临时设备的列表');

        wsA.close();
        const afterClose = await waitFor(msgsB,
            d => d.type === 'device-list' && !d.devices.some(dev => dev.name === '临时设备'),
            '关闭后的列表');
        assert.strictEqual(afterClose.devices.length, 1);
        wsB.close();
    } finally {
        hub.close();
        await new Promise(resolve => server.close(resolve));
    }
});
