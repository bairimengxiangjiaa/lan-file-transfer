/**
 * 服务端 HTTP 接口测试：使用真实服务实例 + 内置 fetch，零额外依赖
 * 运行：npm test（node --test tests/）
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../src/app');

let server;
let wsHub;
let baseUrl;
let uploadDir;

/** 用内置 fetch 上传单个文件（模拟浏览器 FormData） */
async function uploadFile(name, content, relativePath = '') {
    const form = new FormData();
    // relativePath 必须在 file 之前，服务器按 multipart 顺序解析
    form.append('relativePath', relativePath);
    form.append('file', new Blob([content]), name);
    return fetch(`${baseUrl}/upload`, { method: 'POST', body: form });
}

async function getFileList() {
    const res = await fetch(`${baseUrl}/files`);
    assert.strictEqual(res.status, 200);
    return res.json();
}

function encodePath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
}

before(async () => {
    uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan-transfer-test-'));
    const created = createApp({ uploadDir });
    server = created.server;
    wsHub = created.wsHub;

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    wsHub.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(uploadDir, { recursive: true, force: true });
});

test('GET /health 返回服务标识', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.service, 'lan-file-transfer');
});

test('上传→列表→下载→删除 全链路（含中文文件名）', async () => {
    const name = '测试文档 v1.txt';
    const content = 'hello 中文内容';

    const upRes = await uploadFile(name, content);
    assert.strictEqual(upRes.status, 200);
    const upData = await upRes.json();
    assert.strictEqual(upData.success, true);
    assert.strictEqual(upData.file.originalName, name);

    // 列表可见
    const files = await getFileList();
    const found = files.find(f => f.name === name);
    assert.ok(found, '上传的文件应出现在列表中');
    assert.strictEqual(found.isDirectory, false);

    // 下载内容一致，Content-Disposition 使用 RFC 5987
    const dlRes = await fetch(`${baseUrl}/download?path=${encodeURIComponent(name)}`);
    assert.strictEqual(dlRes.status, 200);
    assert.strictEqual(await dlRes.text(), content);
    const cd = dlRes.headers.get('content-disposition');
    assert.match(cd, /filename\*=UTF-8''/);

    // inline 预览模式
    const inlineRes = await fetch(`${baseUrl}/download?path=${encodeURIComponent(name)}&inline=1`);
    assert.strictEqual(inlineRes.status, 200);
    assert.match(inlineRes.headers.get('content-disposition'), /^inline/);

    // 删除（路径按段编码，验证特殊字符可达）
    const delRes = await fetch(`${baseUrl}/files/${encodePath(name)}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    const delData = await delRes.json();
    assert.strictEqual(delData.success, true);

    const filesAfter = await getFileList();
    assert.ok(!filesAfter.find(f => f.name === name), '删除后不应再出现在列表中');
});

test('含特殊字符 # + 的文件名可删除', async () => {
    const name = 'C# 笔记 +1.txt';
    const upRes = await uploadFile(name, 'sharp');
    assert.strictEqual(upRes.status, 200);

    const delRes = await fetch(`${baseUrl}/files/${encodePath(name)}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual((await delRes.json()).success, true);
});

test('带 relativePath 的文件夹上传按目录结构保存', async () => {
    const res = await uploadFile('a.txt', 'aaa', 'proj/src/a.txt');
    assert.strictEqual(res.status, 200);

    const files = await getFileList();
    assert.ok(files.find(f => f.name === 'proj' && f.isDirectory));
    assert.ok(files.find(f => f.name === 'proj/src' && f.isDirectory));
    assert.ok(files.find(f => f.name === 'proj/src/a.txt' && !f.isDirectory));
});

test('同名上传不覆盖，自动追加序号后缀', async () => {
    await uploadFile('dup.txt', 'first');
    await uploadFile('dup.txt', 'second');
    await uploadFile('dup.txt', 'third');

    const files = await getFileList();
    const names = files.map(f => f.name);
    assert.ok(names.includes('dup.txt'));
    assert.ok(names.includes('dup (1).txt'));
    assert.ok(names.includes('dup (2).txt'));

    // 原文件内容未被覆盖
    const res = await fetch(`${baseUrl}/download?path=dup.txt`);
    assert.strictEqual(await res.text(), 'first');
});

test('路径遍历防护：上传/下载/删除均拒绝 ../', async () => {
    // 上传恶意 relativePath
    const upRes = await uploadFile('evil.txt', 'evil', '../evil.txt');
    assert.strictEqual(upRes.status, 403);

    // 下载越权路径
    const dlRes = await fetch(`${baseUrl}/download?path=${encodeURIComponent('../package.json')}`);
    assert.strictEqual(dlRes.status, 403);

    // 删除越权路径（编码后的 ../）
    const delRes = await fetch(`${baseUrl}/files/..%2F..%2Fpackage.json`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 403);

    // 批量下载包含非法路径
    const batchRes = await fetch(`${baseUrl}/download-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: ['../package.json'] })
    });
    assert.strictEqual(batchRes.status, 403);
});

test('文件夹下载返回 ZIP', async () => {
    await uploadFile('f1.txt', 'f1', 'zipdir/f1.txt');
    await uploadFile('f2.txt', 'f2', 'zipdir/sub/f2.txt');

    const res = await fetch(`${baseUrl}/download?path=zipdir`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/zip');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.length > 0);
    assert.strictEqual(buf.subarray(0, 2).toString(), 'PK', 'ZIP 魔数应为 PK');
});

test('批量下载：父目录与子文件同时选中时正常返回 ZIP', async () => {
    await uploadFile('b1.txt', 'b1', 'batch/b1.txt');
    await uploadFile('b2.txt', 'b2', 'batch/sub/b2.txt');
    await uploadFile('solo.txt', 'solo');

    const res = await fetch(`${baseUrl}/download-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: ['batch', 'batch/b1.txt', 'batch/sub/b2.txt', 'solo.txt'] })
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/zip');

    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.subarray(0, 2).toString(), 'PK');
});

test('批量下载：空列表返回 400', async () => {
    const res = await fetch(`${baseUrl}/download-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [] })
    });
    assert.strictEqual(res.status, 400);
});

test('删除不存在的文件返回 404', async () => {
    const res = await fetch(`${baseUrl}/files/not-exist-file.bin`, { method: 'DELETE' });
    assert.strictEqual(res.status, 404);
});

test('DELETE /files-all 清空全部文件（保留 .tmp 目录）', async () => {
    await uploadFile('last.txt', 'last');

    const res = await fetch(`${baseUrl}/files-all`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).success, true);

    const files = await getFileList();
    assert.strictEqual(files.length, 0);
    assert.ok(fs.existsSync(path.join(uploadDir, '.tmp')), '.tmp 临时目录应保留');
});
