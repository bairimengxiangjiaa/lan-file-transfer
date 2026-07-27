const os = require('os');
const { exec } = require('child_process');
const config = require('./src/config');
const { createApp } = require('./src/app');
const { getLocalIP, checkPort, findAvailablePort, publishMdns } = require('./src/network');

// 检测端口是否已被本服务占用（通过轻量 /health 端点识别）
async function isPortOccupiedBySelf(port) {
    try {
        const res = await fetch(`http://localhost:${port}/health`, {
            method: 'GET',
            signal: AbortSignal.timeout(2000)
        });
        if (res.ok) {
            const data = await res.json();
            return data && data.service === 'lan-file-transfer';
        }
        return false;
    } catch (e) {
        return false;
    }
}

function openBrowser(url) {
    const start = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
    exec(`${start} ${url}`, () => {});
}

// 显示启动信息
function showStartupInfo(port, originalPort, lanIP) {
    console.log('');
    if (originalPort && port !== originalPort) {
        console.log(`  端口 ${originalPort} 已被占用，自动切换到 ${port}`);
    }
    console.log('  ╭─────────────────────────────────────╮');
    console.log('  │       局域网文件传输服务             │');
    console.log('  ├─────────────────────────────────────┤');
    console.log(`  │ 本机:   http://localhost:${port}`);
    console.log(`  │ 局域网: http://${lanIP}:${port}`);
    console.log(`  │ mDNS:   http://${os.hostname()}.local:${port}`);
    console.log('  │');
    console.log('  │ 浏览器将自动打开，按 Ctrl+C 停止');
    console.log('  ╰─────────────────────────────────────╯');
    console.log('');
}

async function main() {
    const originalPort = config.DEFAULT_PORT;
    let port = originalPort;

    // 先检查默认端口是否已经被我们自己的服务占用
    if (!(await checkPort(port))) {
        if (await isPortOccupiedBySelf(port)) {
            // 已经有一个在跑了，直接打开浏览器退出
            console.log('');
            console.log('  服务已在运行中，正在打开浏览器...');
            console.log(`  地址: http://localhost:${port}`);
            console.log('');
            openBrowser(`http://localhost:${port}`);
            setTimeout(() => process.exit(0), 1000);
            return;
        }
        // 被别的程序占了，自动找新端口
        port = await findAvailablePort(port);
    }

    const { server, wsHub } = createApp();
    let mdns = { unpublish(cb) { if (cb) cb(); } };

    // 定期检测 IP 变化并广播
    const ipWatcher = setInterval(() => {
        wsHub.setIP(getLocalIP());
    }, config.IP_WATCH_INTERVAL);

    server.listen(port, '0.0.0.0', () => {
        mdns = publishMdns(port);
        showStartupInfo(port, originalPort, wsHub.getIP());
        openBrowser(`http://localhost:${port}`);
    });

    /**
     * 优雅关闭：注销 mDNS、关闭 WebSocket 与 HTTP 连接，让客户端尽快感知断开
     * @param {string} signal
     */
    function gracefulShutdown(signal) {
        console.log(`\n  收到 ${signal}，正在关闭服务...`);
        clearInterval(ipWatcher);
        mdns.unpublish();
        wsHub.close();

        server.close(() => {
            console.log('  服务已关闭');
            process.exit(0);
        });

        // 超时强制退出
        setTimeout(() => {
            console.error('  关闭超时，强制退出');
            process.exit(1);
        }, 5000);
    }

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

main();
