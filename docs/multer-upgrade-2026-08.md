# multer 1.x → 2.x 升级记录（2026-08）

## 为什么升级

**安全**：multer 1.x 线已停止维护，存在多个已公开的 DoS 漏洞
（构造畸形 multipart 请求可打挂服务进程，CVE-2025-47935 等），官方修复只发布在 2.x。

## 关键事实：2.x 文件名解码行为

实测确认（multer 2.2.0）：**默认行为与 1.x 相同，filename 仍按 latin1 解码**，
中文名照样乱码。2.x 并未"原生支持 UTF-8"，但新增了官方配置项：

```js
defParamCharset: 'utf8'
```

设置后 busboy 按原始 UTF-8 解码 multipart 的 filename 参数，中文/特殊字符文件名
直接正确。这是替代 `fixEncoding` 补丁的官方方案。

> 注：普通文本字段（如 relativePath）无论哪个版本都按 UTF-8 解码，从未乱码过；
> 旧代码对它调 fixEncoding 属于防御性冗余（启发式兜底后等于原样返回），本次一并移除。

## 变更内容

| 项目 | 升级前 | 升级后 |
| --- | --- | --- |
| multer 版本 | ^1.4.5-lts.1 | ^2.2.0 |
| filename 解码 | latin1 + fixEncoding 补丁 | latin1 默认 → 显式 `defParamCharset: 'utf8'` |
| `fixEncoding` 补丁函数 | 必需 | 删除 |

### 删除 `fixEncoding` 的原因

原函数对文件名做 latin1→UTF-8 二次解码，存在固有缺陷：
- `Buffer.from(str, 'latin1')` 对 >255 的码点截断取低字节，输入已是正确 UTF-8 时有损坏风险
- 启发式兜底（检测 U+FFFD）无法覆盖所有"恰好构成合法 UTF-8"的损坏情况

官方选项从解析层根治，无上述问题。

## API 兼容性确认

- `multer.diskStorage` / `limits.fileSize` / `.single('file')` 签名不变 ✓
- 超限错误仍为 `err.code === 'LIMIT_FILE_SIZE'` ✓
- Node ≥ 18 满足 multer 2.x 要求 ✓

## 功能边界

- 解决：已知漏洞暴露、删除脆弱的编码启发式补丁、文件名编码改由官方配置保证。
- 不解决：极老客户端发送非 UTF-8 编码文件名的场景（现代浏览器均发 UTF-8，
  此类文件名会按 UTF-8 解出乱码字符，但不会崩溃或越权）。

## 验证方式

`npm test` 全量通过，其中已有用例覆盖：中文名上传下载、特殊字符 `# +` 文件名、
文件夹 relativePath 上传、同名自动加序号、路径遍历防护。
另用手工构造的原始 multipart 报文验证了 `defParamCharset` 前后的解码差异。
