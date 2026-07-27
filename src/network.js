const os = require('os');
const http = require('http');

/**
 * 获取本机局域网 IP 地址（优先常见物理网卡，排除 VPN 和虚拟接口）
 */
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

/**
 * 检测端口是否可用
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function checkPort(port) {
    return new Promise((resolve) => {
        const testServer = http.createServer();
        testServer.listen(port, '0.0.0.0', () => {
            testServer.close(() => resolve(true));
        });
        testServer.on('error', () => resolve(false));
    });
}

/**
 * 从 startPort 开始查找可用端口（最多向后尝试 100 个）
 * @param {number} startPort
 * @returns {Promise<number>}
 */
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

/**
 * 发布 mDNS 服务广播，使局域网设备可通过 http://主机名.local:端口 访问
 * 失败时静默降级（不影响 IP 直连使用）
 * @param {number} port
 * @returns {{ unpublish: (cb?: Function) => void }}
 */
function publishMdns(port) {
    try {
        const { Bonjour } = require('bonjour-service');
        const bonjour = new Bonjour();
        bonjour.publish({
            name: `LAN File Transfer @ ${os.hostname()}`,
            type: 'http',
            port
        });
        return {
            unpublish(cb) {
                try {
                    bonjour.unpublishAll(() => bonjour.destroy(cb));
                } catch (e) {
                    if (cb) cb();
                }
            }
        };
    } catch (e) {
        console.error('mDNS 广播启动失败（不影响使用）:', e.message);
        return { unpublish(cb) { if (cb) cb(); } };
    }
}

module.exports = { getLocalIP, checkPort, findAvailablePort, publishMdns };
