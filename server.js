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
    // agent/脚本按需静默启动时（LAN_TRANSFER_NO_BROWSER=1）不弹浏览器
    if (process.env.LAN_TRANSFER_NO_BROWSER) return;
    const start = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start'
        : 'xdg-open';
    exec(`${start} ${url}`, () => {});
}

// 显示启动信息
function showStartupInfo(port, originalPort, lanIP, autoExitMinutes, noBrowser) {
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
    if (autoExitMinutes > 0) {
        console.log(`  │ ${autoExitMinutes} 分钟后自动关闭（手机请先扫码）`);
    } else if (noBrowser) {
        console.log('  │ 静默运行中（未打开浏览器），按 Ctrl+C 停止');
    } else {
        console.log('  │ 浏览器将自动打开，按 Ctrl+C 停止');
    }
    console.log('  ╰─────────────────────────────────────╯');
    console.log('');
}

async function main() {
    const originalPort = config.DEFAULT_PORT;
    // agent 按需启动时的运行开关
    const noBrowser = !!process.env.LAN_TRANSFER_NO_BROWSER;
    // 自动关闭时长（分钟），0 表示常驻不自动关闭；
    // 上限保护：Node 的 setTimeout 超过 2^31-1 ms（约 24.8 天）会立即触发，故截断到 35000 分钟
    const autoExitMinutes = Math.min(Math.max(Number(process.env.LAN_TRANSFER_AUTO_EXIT_MINUTES) || 0, 0), 35000);
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

    // agent 按需启动时的自动关闭定时器（0 分钟则不设置）
    let autoExitTimer = null;

    server.listen(port, '0.0.0.0', () => {
        mdns = publishMdns(port);
        // 仅在广播真正发布后向客户端提供 .local 备用地址
        if (mdns.ok) wsHub.setMdns(`${os.hostname()}.local`);
        showStartupInfo(port, originalPort, wsHub.getIP(), autoExitMinutes, noBrowser);
        openBrowser(`http://localhost:${port}`);

        // 到期自动关闭：临时分享场景（如给手机传安装包）用完即走，避免服务常驻
        if (autoExitMinutes > 0) {
            autoExitTimer = setTimeout(() => {
                console.log(`\n  已运行 ${autoExitMinutes} 分钟，自动关闭服务`);
                gracefulShutdown('定时关闭');
            }, autoExitMinutes * 60 * 1000);
        }
    });

    /**
     * 优雅关闭：注销 mDNS、关闭 WebSocket 与 HTTP 连接，让客户端尽快感知断开
     * @param {string} signal
     */
    function gracefulShutdown(signal) {
        console.log(`\n  收到 ${signal}，正在关闭服务...`);
        clearInterval(ipWatcher);
        if (autoExitTimer) clearTimeout(autoExitTimer);
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
