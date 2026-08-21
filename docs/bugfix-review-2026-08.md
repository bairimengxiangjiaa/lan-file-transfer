# 代码审查与修复记录（2026-08）

## 审查范围

全量审查服务端（`server.js`、`src/`）与前端（`public/js/`），以及未提交的"点击文件行下载"改动。

---

## Bug 1：僵尸连接剔除后不广播设备列表（已修复）

### 现象

某设备异常掉线（如手机锁屏后 WebSocket 半开）时，心跳 sweeper 会将其剔除，
但**其他设备的"在线设备"列表里它仍然显示在线**，直到有新设备加入/离开才刷新。

### 根因

`src/ws-hub.js` 的 sweeper 中先执行 `clients.delete(ws)` 再 `ws.terminate()`：

```js
clients.delete(ws);   // 这里先删了
ws.terminate();       // 触发 close 事件
```

而 close 事件处理器是 `if (clients.delete(ws)) broadcastDeviceList()` ——
第二次 delete 返回 false，广播被跳过。

### 修复方案

sweeper 只负责 `terminate()`，删除与广播统一交给 close 事件处理，职责单一、无重复逻辑。

### 边界

- 正常断开（close 先于 sweeper）行为不变。
- 不解决：客户端浏览器直接关闭页面但 TCP 未断开的窗口期（仍需等心跳超时，属预期设计）。

---

## Bug 2：loadFileList 不检查 HTTP 状态码（已修复）

### 现象

服务端返回 500 时，`res.json()` 拿到的是 `{ error: ... }` 对象，
后续 `files.map()` 抛 TypeError，文件列表区域静默空白，用户无任何提示。

### 修复方案

检查 `res.ok`，失败时 toast 提示并保留旧列表数据。

---

## Bug 3：上传清理监听使用已废弃的 aborted 事件（已修复）

### 问题

- Node 16+ 已废弃 `request('aborted')` 事件；
- 原逻辑在文件**成功保存后**若连接关闭，仍会尝试 rm 已移动走的临时路径（无害但语义错误）。

### 修复方案

改用 `req.on('close')` + `saved` 标志：只有文件尚未成功落盘时才清理临时文件。
兼容未来 Node 版本移除 aborted 事件的情况。

---

## 优化 1：listRecursive 并行 stat

原实现逐个 `await fsp.stat(itemPath)`，文件数量大时列表接口耗时线性增长。
改为同层目录内 `Promise.all` 并行 stat，递归仍按目录层级展开。
排序在 `/files` 路由统一做，结果顺序不受并行影响。

## 优化 2：端口回退修正

`main.js` 中 `window.location.port || '80'` 在 https 场景应回退为 443。
当前应用虽只跑 http，但修正后逻辑自洽，避免未来上 https 时二维码生成错误地址。

---

## 附带说明：未提交的"行点击下载"改动

工作区已有改动（本次一并提交）：点击文件行任意空白处直接下载该文件，
图片预览改为仅通过 👁️ 按钮。复选框、操作按钮均已排除，事件委托顺序正确，无冲突。

---

## 验证方式

- 新增回归测试：心跳超时剔除僵尸连接后，存活客户端必须收到不含该设备的 device-list 广播。
- `npm test` 全量通过。
