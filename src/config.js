const path = require('path');

// 全局配置
module.exports = {
    // 默认服务端口（被占用时自动向后查找）
    DEFAULT_PORT: 3000,
    // 上传文件存储目录
    UPLOAD_DIR: path.join(__dirname, '..', 'uploads'),
    // 单文件大小上限：2GB
    MAX_FILE_SIZE: 2 * 1024 * 1024 * 1024,
    // WebSocket 心跳检查间隔 / 超时
    HEARTBEAT_INTERVAL: 30000,
    HEARTBEAT_TIMEOUT: 60000,
    // 本机 IP 变化检测间隔
    IP_WATCH_INTERVAL: 30000
};
