/**
 * WebSocket 重连核心模块
 *
 * 职责：封装 WebSocket 连接、自动重连、心跳、服务器探测等逻辑。
 * 不依赖 DOM，可在浏览器和 Node 环境中使用。
 *
 * 设计优点：
 * 1. 将连接状态机从 UI 代码中分离，职责清晰。
 * 2. 通过 createWebSocket 注入 WebSocket 实现，便于测试。
 * 3. 过期事件过滤 + 连接状态锁，避免并发连接和旧事件干扰。
 *
 * 功能边界：
 * - 解决：同一页面内的断线重连、服务器重启后重连、并发防护、明确状态反馈。
 * - 不解决：服务器端口变化后的页面重定向、跨域访问、浏览器离线但未触发 close 的场景。
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        // CommonJS（Node 测试环境）
        module.exports = factory();
    } else {
        // 浏览器环境：暴露全局变量 ReconnectCore
        root.ReconnectCore = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    /**
     * WebSocket 重连管理器
     */
    class ReconnectCore {
        /**
         * @param {Object} options
         * @param {string} options.url - WebSocket 连接地址
         * @param {function} [options.createWebSocket] - 创建 WebSocket 的工厂函数，默认使用全局 WebSocket
         * @param {function} [options.checkAlive] - 探测服务器是否存活的函数，返回 Promise<boolean>
         * @param {function} [options.onStateChange] - 状态变化回调，参数为状态字符串
         * @param {function} [options.onMessage] - 收到消息回调，参数为消息字符串
         * @param {function} [options.onOpen] - 连接成功回调
         * @param {number} [options.heartbeatInterval=15000] - 心跳间隔（毫秒）
         * @param {number} [options.maxReconnectDelay=10000] - 最大自动重连间隔（毫秒）
         */
        constructor(options) {
            this.url = options.url;
            this.createWebSocket = options.createWebSocket || ((url) => new WebSocket(url));
            this.checkAlive = options.checkAlive || (() => Promise.resolve(false));
            this.onStateChange = options.onStateChange || (() => {});
            this.onMessage = options.onMessage || (() => {});
            this.onOpen = options.onOpen || (() => {});
            this.heartbeatInterval = options.heartbeatInterval || 15000;
            this.maxReconnectDelay = options.maxReconnectDelay || 10000;

            this.state = 'disconnected';
            this.ws = null;
            this.isConnecting = false;
            this.shouldReconnect = true;
            this.reconnectTimer = null;
            this.heartbeatTimer = null;
            this.reconnectDelay = 1000;
        }

        /**
         * 设置内部状态并通知外部
         * @param {string} state
         */
        _setState(state) {
            this.state = state;
            this.onStateChange(state);
        }

        /**
         * 发起连接（若已在连接中则忽略）
         */
        connect() {
            // 连接状态锁：防止并发点击创建多个 WebSocket
            if (this.isConnecting) return;

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            this.shouldReconnect = true;
            this.isConnecting = true;
            this._setState('connecting');

            // 清理旧连接：先清空引用，再关闭旧连接，使旧连接的 onclose 被识别为过期事件并忽略
            if (this.ws) {
                const oldWs = this.ws;
                this.ws = null;
                oldWs.onopen = null;
                oldWs.onmessage = null;
                oldWs.onclose = null;
                oldWs.onerror = null;
                if (oldWs.readyState === 1 /* OPEN */ || oldWs.readyState === 0 /* CONNECTING */) {
                    oldWs.close();
                }
            }

            const socket = this.createWebSocket(this.url);
            this.ws = socket;

            socket.onopen = (event) => {
                // 过滤过期事件：只响应当前活动连接的事件
                if (event.target !== this.ws) return;

                this.reconnectDelay = 1000;
                this.isConnecting = false;
                this._setState('connected');
                this.onOpen();
                this._startHeartbeat();
            };

            socket.onmessage = (event) => {
                // 过滤过期事件
                if (event.target !== this.ws) return;
                this.onMessage(event.data);
            };

            socket.onclose = (event) => {
                // 过滤过期事件
                if (event.target !== this.ws) return;

                this._stopHeartbeat();

                if (!this.shouldReconnect) return;

                this.isConnecting = false;
                this._setState('checking');

                // 探测服务器是否存活，再决定自动重连或提示服务器未启动
                this.checkAlive().then(alive => {
                    if (alive) {
                        this._setState('reconnecting');
                        this.reconnectTimer = setTimeout(() => {
                            this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
                            this.connect();
                        }, this.reconnectDelay);
                    } else {
                        this._setState('server-down');
                    }
                });
            };

            socket.onerror = (event) => {
                // 过滤过期事件
                if (event.target !== this.ws) return;
                // onerror 后通常会跟随 onclose，统一在 onclose 中处理重连
                console.error('WebSocket error');
            };
        }

        /**
         * 断开连接并停止重连
         */
        disconnect() {
            this.shouldReconnect = false;
            this._stopHeartbeat();

            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }

            if (this.ws) {
                const oldWs = this.ws;
                this.ws = null;
                oldWs.onopen = null;
                oldWs.onmessage = null;
                oldWs.onclose = null;
                oldWs.onerror = null;
                if (oldWs.readyState === 1 /* OPEN */ || oldWs.readyState === 0 /* CONNECTING */) {
                    oldWs.close();
                }
            }

            this.isConnecting = false;
            this._setState('disconnected');
        }

        /**
         * 发送数据（仅当连接打开时）
         * @param {Object|string} data
         */
        send(data) {
            if (this.ws && this.ws.readyState === 1 /* OPEN */) {
                this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
            }
        }

        /**
         * 启动心跳
         */
        _startHeartbeat() {
            this._stopHeartbeat();
            this.heartbeatTimer = setInterval(() => {
                if (this.ws && this.ws.readyState === 1 /* OPEN */) {
                    this.send({ type: 'ping' });
                }
            }, this.heartbeatInterval);
        }

        /**
         * 停止心跳
         */
        _stopHeartbeat() {
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }
        }
    }

    return ReconnectCore;
}));
