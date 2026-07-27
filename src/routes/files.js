const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const archiver = require('archiver');

// 已压缩格式：打包 ZIP 时使用 STORE 模式，避免无意义的二次压缩
const PRECOMPRESSED_EXTS = new Set([
    '.zip', '.rar', '.7z', '.gz', '.xz', '.bz2', '.apk', '.jar',
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.mp3', '.aac', '.flac', '.ogg',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
    '.pdf', '.docx', '.xlsx', '.pptx'
]);

function shouldStore(name) {
    return PRECOMPRESSED_EXTS.has(path.extname(name).toLowerCase());
}

// 修复中文文件名编码（multer 1.x 以 latin1 解析 originalname）
function fixEncoding(str) {
    if (!str) return str;
    try {
        const buf = Buffer.from(str, 'latin1');
        const decoded = buf.toString('utf8');
        // 如果解码后包含替换字符，说明原始编码就是正确的
        if (decoded.includes('\uFFFD')) return str;
        return decoded;
    } catch (e) {
        return str;
    }
}

// RFC 5987 格式的 Content-Disposition，兼容中文等非 ASCII 文件名
function contentDisposition(type, filename) {
    const fallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * 创建文件相关路由
 * @param {Object} options
 * @param {string} options.uploadDir - 上传文件存储目录
 * @param {number} [options.maxFileSize] - 单文件大小上限（字节）
 */
function createFilesRouter({ uploadDir, maxFileSize = 2 * 1024 * 1024 * 1024 }) {
    const tmpDir = path.join(uploadDir, '.tmp');
    fs.mkdirSync(tmpDir, { recursive: true });

    // 启动时清理上次残留的临时文件，防止磁盘泄漏
    try {
        for (const item of fs.readdirSync(tmpDir)) {
            fs.rmSync(path.join(tmpDir, item), { recursive: true, force: true });
        }
    } catch (e) { /* ignore */ }

    // 路径安全检查：防止路径遍历攻击
    function isPathSafe(targetPath) {
        const resolved = path.resolve(targetPath);
        const baseResolved = path.resolve(uploadDir);
        return resolved.startsWith(baseResolved + path.sep) || resolved === baseResolved;
    }

    // 安全地构建路径，如果不安全返回 null
    function safePath(...segments) {
        const joined = path.join(uploadDir, ...segments);
        return isPathSafe(joined) ? joined : null;
    }

    // 若目标路径已存在，追加 " (1)"、" (2)" 后缀，避免静默覆盖
    function uniquePath(p) {
        if (!fs.existsSync(p)) return p;
        const dir = path.dirname(p);
        const ext = path.extname(p);
        const base = path.basename(p, ext);
        let i = 1;
        let candidate;
        do {
            candidate = path.join(dir, `${base} (${i})${ext}`);
            i++;
        } while (fs.existsSync(candidate));
        return candidate;
    }

    function cleanupTmpFile(req) {
        if (req.file && req.file.path) {
            fsp.rm(req.file.path, { force: true }).catch(() => {});
        }
    }

    // 文件上传：磁盘存储（避免大文件占用内存），先写临时目录再移动
    const storage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, tmpDir),
        filename: (req, file, cb) => {
            cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8));
        }
    });
    const uploadSingle = multer({ storage, limits: { fileSize: maxFileSize } }).single('file');

    const router = express.Router();

    // 轻量健康检查（供客户端探活与启动自检使用，避免每次递归扫描文件树）
    router.get('/health', (req, res) => {
        res.json({ ok: true, service: 'lan-file-transfer' });
    });

    // 文件上传接口
    router.post('/upload', (req, res) => {
        // 请求中断时清理已写入的临时文件
        req.on('aborted', () => cleanupTmpFile(req));

        uploadSingle(req, res, (err) => {
            if (err) {
                cleanupTmpFile(req);
                const msg = err.code === 'LIMIT_FILE_SIZE' ? '文件超过大小限制' : '上传失败';
                return res.status(400).json({ error: msg });
            }
            if (!req.file) {
                return res.status(400).json({ error: '没有文件' });
            }

            try {
                req.file.originalname = fixEncoding(req.file.originalname);
                const relativePath = fixEncoding(req.body.relativePath || '');
                let savePath;

                if (relativePath) {
                    // 文件夹上传：按相对路径保存（含路径遍历防护）
                    savePath = safePath(relativePath);
                    if (!savePath) {
                        cleanupTmpFile(req);
                        return res.status(403).json({ error: '非法路径' });
                    }
                    fs.mkdirSync(path.dirname(savePath), { recursive: true });
                } else {
                    // 单文件上传：保留原始文件名
                    savePath = safePath(path.basename(req.file.originalname));
                    if (!savePath) {
                        cleanupTmpFile(req);
                        return res.status(403).json({ error: '非法路径' });
                    }
                }

                // 已存在则追加序号后缀，不静默覆盖
                savePath = uniquePath(savePath);
                fs.renameSync(req.file.path, savePath);

                res.json({
                    success: true,
                    file: {
                        originalName: req.file.originalname,
                        filename: path.basename(savePath),
                        size: req.file.size
                    }
                });
            } catch (e) {
                console.error('保存文件失败:', e);
                cleanupTmpFile(req);
                res.status(500).json({ error: '保存文件失败' });
            }
        });
    });

    // 文件/文件夹下载接口（inline=1 时以内联方式返回，用于预览）
    router.get('/download', async (req, res) => {
        try {
            const filename = req.query.path;
            if (!filename) {
                return res.status(400).json({ error: '缺少文件路径' });
            }

            const filepath = safePath(filename);
            if (!filepath) {
                return res.status(403).json({ error: '禁止访问' });
            }

            const stats = await fsp.stat(filepath).catch(() => null);
            if (!stats) {
                return res.status(404).json({ error: '文件不存在' });
            }

            if (stats.isDirectory()) {
                const folderName = path.basename(filename);

                res.setHeader('Content-Type', 'application/zip');
                res.setHeader('Content-Disposition', contentDisposition('attachment', folderName + '.zip'));

                const archive = new archiver.ZipArchive();
                archive.on('error', (err) => {
                    console.error('压缩错误:', err);
                    if (!res.headersSent) {
                        res.status(500).json({ error: '创建ZIP失败' });
                    }
                });

                archive.pipe(res);
                archive.directory(filepath, false, (entry) => {
                    if (shouldStore(entry.name)) entry.store = true;
                    return entry;
                });
                archive.finalize();
            } else {
                const originalName = path.basename(filename);
                if (req.query.inline === '1') {
                    res.setHeader('Content-Disposition', contentDisposition('inline', originalName));
                    res.sendFile(filepath);
                } else {
                    res.download(filepath, originalName);
                }
            }
        } catch (err) {
            console.error('下载错误:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: '下载失败' });
            }
        }
    });

    // 批量下载接口
    router.post('/download-batch', (req, res) => {
        try {
            const { files } = req.body;

            if (!files || !Array.isArray(files) || files.length === 0) {
                return res.status(400).json({ error: '没有选择文件' });
            }

            // 安全检查：所有路径必须合法
            for (const file of files) {
                if (typeof file !== 'string' || !safePath(file)) {
                    return res.status(403).json({ error: '包含非法路径' });
                }
            }

            // 去重：跳过已被选中目录包含的子项
            const resolvedFiles = [];
            const sortedPaths = [...files].sort();
            for (const file of sortedPaths) {
                const isInsideSelectedDir = resolvedFiles.some(existing => {
                    if (file.startsWith(existing + '/') || file === existing) {
                        const existingPath = path.join(uploadDir, existing);
                        try {
                            if (fs.existsSync(existingPath) && fs.statSync(existingPath).isDirectory()) {
                                return true;
                            }
                        } catch (e) { /* ignore */ }
                    }
                    return false;
                });
                if (!isInsideSelectedDir) {
                    resolvedFiles.push(file);
                }
            }

            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', contentDisposition('attachment', 'download.zip'));

            const archive = new archiver.ZipArchive();
            archive.on('error', (err) => {
                console.error('压缩错误:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: '创建ZIP失败' });
                }
            });

            archive.pipe(res);

            for (const file of resolvedFiles) {
                const filepath = path.join(uploadDir, file);
                try {
                    if (fs.existsSync(filepath)) {
                        const stats = fs.statSync(filepath);
                        if (stats.isDirectory()) {
                            archive.directory(filepath, file, (entry) => {
                                if (shouldStore(entry.name)) entry.store = true;
                                return entry;
                            });
                        } else {
                            archive.file(filepath, { name: file, store: shouldStore(file) });
                        }
                    }
                } catch (err) {
                    console.error(`添加文件到压缩包时出错: ${file}`, err);
                }
            }

            archive.finalize();
        } catch (err) {
            console.error('批量下载错误:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: '下载失败' });
            }
        }
    });

    // 递归获取文件列表（异步，不阻塞事件循环）
    async function listRecursive(dir, basePath = '') {
        const result = [];
        let items;
        try {
            items = await fsp.readdir(dir, { withFileTypes: true });
        } catch (e) {
            console.error('读取目录失败:', e);
            return result;
        }

        for (const item of items) {
            if (item.name.startsWith('.')) continue; // 跳过隐藏文件/临时目录

            const itemPath = path.join(dir, item.name);
            const relativePath = basePath ? `${basePath}/${item.name}` : item.name;

            try {
                const stats = await fsp.stat(itemPath);
                if (item.isDirectory()) {
                    result.push({
                        name: relativePath,
                        originalName: item.name,
                        size: 0,
                        uploadedAt: stats.mtime,
                        isDirectory: true
                    });
                    result.push(...await listRecursive(itemPath, relativePath));
                } else {
                    result.push({
                        name: relativePath,
                        originalName: item.name,
                        size: stats.size,
                        uploadedAt: stats.mtime,
                        isDirectory: false
                    });
                }
            } catch (e) { /* 文件可能已被删除，跳过 */ }
        }

        return result;
    }

    // 获取文件列表
    router.get('/files', async (req, res) => {
        try {
            const files = await listRecursive(uploadDir);
            files.sort((a, b) => b.uploadedAt - a.uploadedAt);
            res.json(files);
        } catch (e) {
            res.status(500).json({ error: '获取文件列表失败' });
        }
    });

    // 清空所有文件接口
    router.delete('/files-all', async (req, res) => {
        try {
            const items = await fsp.readdir(uploadDir);
            for (const item of items) {
                if (item.startsWith('.')) continue; // 跳过隐藏文件/临时目录
                await fsp.rm(path.join(uploadDir, item), { recursive: true, force: true });
            }
            res.json({ success: true });
        } catch (e) {
            console.error('清空失败:', e);
            res.status(500).json({ error: '清空失败' });
        }
    });

    // 删除文件或文件夹
    router.delete('/files/:filename(*)', async (req, res) => {
        try {
            const filename = req.params.filename;
            const filepath = safePath(filename);

            if (!filepath) {
                return res.status(403).json({ error: '禁止访问' });
            }

            const stats = await fsp.stat(filepath).catch(() => null);
            if (!stats) {
                return res.status(404).json({ error: '文件不存在' });
            }

            await fsp.rm(filepath, { recursive: true, force: true });
            res.json({ success: true });
        } catch (e) {
            console.error('删除失败:', e);
            res.status(500).json({ error: '删除失败' });
        }
    });

    return router;
}

module.exports = { createFilesRouter };
