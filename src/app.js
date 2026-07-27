const express = require('express');
const http = require('http');
const path = require('path');
const config = require('./config');
const { createFilesRouter } = require('./routes/files');
const { createWsHub } = require('./ws-hub');

/**
 * 组装应用：Express 静态服务 + 文件路由 + WebSocket 中心
 * 可注入 uploadDir 便于测试隔离
 * @param {Object} [options]
 * @param {string} [options.uploadDir]
 * @returns {{ app: import('express').Express, server: import('http').Server, wsHub: Object }}
 */
function createApp(options = {}) {
    const uploadDir = options.uploadDir || config.UPLOAD_DIR;

    const app = express();
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));
    app.use(createFilesRouter({ uploadDir, maxFileSize: config.MAX_FILE_SIZE }));

    const server = http.createServer(app);
    const wsHub = createWsHub(server, {
        heartbeatInterval: config.HEARTBEAT_INTERVAL,
        heartbeatTimeout: config.HEARTBEAT_TIMEOUT
    });

    return { app, server, wsHub };
}

module.exports = { createApp };
