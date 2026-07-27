/**
 * 上传模块：并发受控的上传队列、批量聚合进度、取消上传、拖拽目录收集
 */
import { toast, escapeHtml, formatSize } from './ui.js';

const MAX_CONCURRENT = 4;   // 最大并发上传数
const SPEED_SAMPLE_MS = 600; // 速度采样间隔

let taskSeq = 0;
const jobQueue = [];        // 待上传的文件作业 { task, file, relativePath }
let activeCount = 0;
let onUploadedCallback = null;
let refreshTimer = null;

const transferSection = () => document.getElementById('transferSection');
const transferList = () => document.getElementById('transferList');

/** 初始化上传模块 */
export function initUpload({ onUploaded }) {
    onUploadedCallback = onUploaded;
    document.getElementById('clearDoneBtn').addEventListener('click', clearFinished);

    // 事件委托：取消按钮
    transferList().addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-cancel-transfer');
        if (!btn) return;
        const task = tasks.get(btn.closest('.transfer-item').id);
        if (task) cancelTask(task);
    });
}

const tasks = new Map(); // id -> task

/**
 * 将一批文件加入上传队列
 * 多文件批次显示为一条聚合进度条目，单文件独立显示
 * @param {Array<{file: File, relativePath: string}>} items
 */
export function enqueueFiles(items) {
    if (!items || items.length === 0) return;

    const totalBytes = items.reduce((sum, it) => sum + it.file.size, 0);
    const label = buildLabel(items);

    const task = {
        id: 'transfer-' + Date.now() + '-' + (taskSeq++),
        label,
        totalBytes,
        totalCount: items.length,
        doneCount: 0,
        errorCount: 0,
        completedBytes: 0,
        activeLoads: new Map(), // xhr -> loaded bytes
        activeXhrs: new Set(),
        status: 'uploading',
        canceled: false,
        lastSampleTime: Date.now(),
        lastSampleBytes: 0,
        speed: 0
    };
    tasks.set(task.id, task);
    renderTaskItem(task);

    for (const it of items) {
        jobQueue.push({ task, file: it.file, relativePath: it.relativePath });
    }
    pump();
}

/** 生成批次显示名：单文件用文件名，文件夹批次用顶层目录名，混合批次用数量 */
function buildLabel(items) {
    if (items.length === 1) {
        return items[0].relativePath || items[0].file.name;
    }
    const tops = new Set(
        items.map(it => (it.relativePath || it.file.name).split('/')[0])
    );
    if (tops.size === 1) {
        return `📁 ${[...tops][0]}（${items.length} 个文件）`;
    }
    return `${items.length} 个文件`;
}

/** 调度：在并发上限内启动队列中的作业 */
function pump() {
    while (activeCount < MAX_CONCURRENT && jobQueue.length > 0) {
        const job = jobQueue.shift();
        if (job.task.canceled) continue;
        startJob(job);
    }
}

function startJob(job) {
    const { task, file, relativePath } = job;
    activeCount++;

    const formData = new FormData();
    // 关键：relativePath 必须在 file 之前添加，服务器按顺序解析 multipart
    formData.append('relativePath', relativePath);
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    task.activeXhrs.add(xhr);
    task.activeLoads.set(xhr, 0);

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            task.activeLoads.set(xhr, e.loaded);
            updateTaskProgress(task);
        }
    });

    const finalize = (ok) => {
        task.activeXhrs.delete(xhr);
        task.activeLoads.delete(xhr);
        activeCount--;
        if (!task.canceled) {
            if (ok) {
                task.doneCount++;
                task.completedBytes += file.size;
                scheduleRefresh();
            } else {
                task.errorCount++;
            }
            if (task.doneCount + task.errorCount >= task.totalCount) {
                task.status = task.errorCount > 0 ? 'error' : 'done';
                if (task.errorCount > 0) {
                    toast(`「${task.label}」有 ${task.errorCount} 个文件上传失败`, 'error');
                }
            }
            updateTaskProgress(task);
        }
        pump();
    };

    xhr.addEventListener('load', () => finalize(xhr.status === 200));
    xhr.addEventListener('error', () => finalize(false));
    xhr.addEventListener('abort', () => {
        task.activeXhrs.delete(xhr);
        task.activeLoads.delete(xhr);
        activeCount--;
        pump();
    });

    xhr.open('POST', '/upload');
    xhr.send(formData);
}

/** 取消任务：中止进行中的请求并清空该任务排队中的作业 */
function cancelTask(task) {
    if (task.status !== 'uploading') return;
    task.canceled = true;
    task.status = 'canceled';

    for (let i = jobQueue.length - 1; i >= 0; i--) {
        if (jobQueue[i].task === task) jobQueue.splice(i, 1);
    }
    task.activeXhrs.forEach(xhr => xhr.abort());

    updateTaskProgress(task);
    toast(`已取消「${task.label}」`, 'info');
    scheduleRefresh();
}

/** 延迟合并刷新文件列表，避免批量上传时高频刷新 */
function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
        refreshTimer = null;
        if (onUploadedCallback) onUploadedCallback();
    }, 600);
}

function renderTaskItem(task) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.id = task.id;
    div.innerHTML = `
        <div class="transfer-info">
            <span class="transfer-name">${escapeHtml(task.label)}</span>
            <span class="transfer-meta">
                <span class="transfer-status">0%</span>
                <button class="btn-cancel-transfer" title="取消上传" aria-label="取消上传">✕</button>
            </span>
        </div>
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
    `;
    transferList().prepend(div);
    transferSection().style.display = 'block';
}

function updateTaskProgress(task) {
    const item = document.getElementById(task.id);
    if (!item) return;

    let loadedBytes = task.completedBytes;
    task.activeLoads.forEach(loaded => { loadedBytes += loaded; });

    // 速度采样
    const now = Date.now();
    if (now - task.lastSampleTime >= SPEED_SAMPLE_MS) {
        task.speed = (loadedBytes - task.lastSampleBytes) / ((now - task.lastSampleTime) / 1000);
        task.lastSampleTime = now;
        task.lastSampleBytes = loadedBytes;
    }

    const percent = task.totalBytes > 0
        ? Math.min(100, Math.round((loadedBytes / task.totalBytes) * 100))
        : 100;

    const statusEl = item.querySelector('.transfer-status');
    const fillEl = item.querySelector('.progress-fill');
    const cancelBtn = item.querySelector('.btn-cancel-transfer');

    fillEl.style.width = `${percent}%`;

    switch (task.status) {
        case 'uploading': {
            const speedText = task.speed > 0 ? ` · ${formatSize(task.speed)}/s` : '';
            const countText = task.totalCount > 1 ? ` (${task.doneCount}/${task.totalCount})` : '';
            statusEl.textContent = `${percent}%${countText}${speedText}`;
            break;
        }
        case 'done':
            statusEl.textContent = task.totalCount > 1 ? `完成 (${task.doneCount}/${task.totalCount})` : '上传完成';
            fillEl.classList.add('complete');
            cancelBtn.remove();
            item.dataset.finished = '1';
            break;
        case 'error':
            statusEl.textContent = `${task.errorCount} 个失败`;
            fillEl.classList.add('error');
            cancelBtn.remove();
            item.dataset.finished = '1';
            break;
        case 'canceled':
            statusEl.textContent = '已取消';
            fillEl.classList.add('error');
            if (cancelBtn) cancelBtn.remove();
            item.dataset.finished = '1';
            break;
    }
}

/** 清除已结束（完成/失败/取消）的条目 */
function clearFinished() {
    transferList().querySelectorAll('.transfer-item[data-finished="1"]').forEach(el => {
        tasks.delete(el.id);
        el.remove();
    });
    if (transferList().children.length === 0) {
        transferSection().style.display = 'none';
    }
}

/* ==================== 拖拽目录收集 ==================== */

/**
 * 从文件系统条目中递归收集所有文件
 * @param {FileSystemEntry[]} entries
 * @param {string} basePath
 * @returns {Promise<Array<{file: File, relativePath: string}>>}
 */
export function collectFilesFromEntries(entries, basePath = '') {
    const filePromises = [];

    entries.forEach(entry => {
        if (entry.isFile) {
            filePromises.push(new Promise((resolve) => {
                entry.file((file) => {
                    const relativePath = basePath ? `${basePath}/${entry.name}` : '';
                    resolve({ file, relativePath });
                }, () => {
                    // 读取失败，跳过该文件
                    resolve(null);
                });
            }));
        } else if (entry.isDirectory) {
            const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
            filePromises.push(readDirectoryFiles(entry, dirPath));
        }
    });

    return Promise.all(filePromises).then(results => results.flat().filter(Boolean));
}

/**
 * 递归读取目录中的所有文件
 * readEntries 每次最多返回 100 条（Chrome 限制），需循环读取
 */
function readDirectoryFiles(dirEntry, basePath) {
    return new Promise((resolve) => {
        const reader = dirEntry.createReader();
        const allEntries = [];

        function readBatch() {
            reader.readEntries(
                (batch) => {
                    if (batch.length === 0) {
                        collectFilesFromEntries(allEntries, basePath).then(resolve);
                    } else {
                        allEntries.push(...batch);
                        readBatch();
                    }
                },
                () => resolve([])
            );
        }

        readBatch();
    });
}
