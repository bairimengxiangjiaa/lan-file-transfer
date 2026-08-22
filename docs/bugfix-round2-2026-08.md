# 第二轮审查修复记录（2026-08）

multer 升级完成后对全库做第二次审查，发现并修复以下问题。

## Bug 4：并发上传同名文件的覆盖竞态（已修复）

### 根因

`uniquePath()` 用 `existsSync` 探测后再 `renameSync`，两步之间存在竞态窗口：
两个并发请求上传同名文件时都探测到"不存在"，先后 rename 到同一路径——
Windows 上 `renameSync` 会静默覆盖，后到者吃掉先到者。

### 修复方案

删除 `uniquePath`，改为 `saveWithoutOverwrite()`：
先用 `fs.openSync(candidate, 'wx')` **原子独占**创建 0 字节占位文件（并发下只有一个成功），
再 `renameSync` 覆盖自己的占位文件。EEXIST 时递增序号重试。
名字归属由操作系统保证，无检查-使用间隙。

### 边界

- 极端情况：占位创建与 rename 之间进程崩溃，会残留一个空文件（概率与旧方案丢文件相当，可接受）。
- 单用户串行场景行为不变：仍是 `a.txt`、`a (1).txt`、`a (2).txt`。

## Bug 5：inline 预览 SVG 的存储型 XSS 面（已加固）

### 风险

`/download?path=x.svg&inline=1` 以 `image/svg+xml` 内联返回用户上传的 SVG。
SVG 可内嵌 `<script>`，直接导航访问时脚本在**同源上下文**执行（Lightbox 的 `<img>`
方式预览不受影响，img 不执行 SVG 脚本）。局域网工具风险低，但属于开源项目应有的加固点。

### 修复方案

inline 响应追加响应头：

```
Content-Security-Policy: sandbox
```

sandbox 指令禁止脚本执行、表单提交等，图片仍正常渲染；对正常图片预览零影响。

## Bug 6：welcome 消息无条件携带 mDNS 地址（已修复）

### 现象

服务端 bonjour 广播启动失败时（如缺依赖），客户端仍收到 `hostname.local` 并展示"备用地址"，
用户拿到一个解析不了的地址。

### 修复方案

- `publishMdns` 返回 `ok` 标志；
- `wsHub.setMdns(host)` 仅在发布成功后注入主机名；
- welcome 消息按需携带 `mDNS` 字段；前端已有 `data.mDNS` 存在性判断，无需改动。

## 小项

- 设备名输入框 `maxlength` 从 20 对齐到服务端的 30 上限。

---

## 验证方式

现有测试覆盖同名加序号逻辑；`npm test` 全量通过后提交。
