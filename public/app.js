// 全局变量
let ws = null;
let deviceId = null;
let deviceName = null;
let selectedDevice = null;
let serverIP = null;
let allFiles = [];
let selectedFiles = new Set();

// DOM元素
const elements = {
    deviceName: document.getElementById('deviceName'),
    connectionStatus: document.getElementById('connectionStatus'),
    deviceList: document.getElementById('deviceList'),
    deviceCount: document.getElementById('deviceCount'),
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),
    folderInput: document.getElementById('folderInput'),
    transferSection: document.getElementById('transferSection'),
    transferList: document.getElementById('transferList'),
    fileList: document.getElementById('fileList'),
    refreshBtn: document.getElementById('refreshBtn'),
    nameModal: document.getElementById('nameModal'),
    nameInput: document.getElementById('nameInput'),
    setNameBtn: document.getElementById('setNameBtn'),
    connectUrl: document.getElementById('connectUrl'),
    copyBtn: document.getElementById('copyBtn'),
    qrcode: document.getElementById('qrcode')
};

// 初始化
function init() {
    deviceName = localStorage.getItem('deviceName');

    if (!deviceName) {
        showNameModal();
    } else {
        elements.deviceName.textContent = deviceName;
        connectWebSocket();
    }

    setupEventListeners();
    loadFileList();
    generateQRCode();
}

// 显示名称设置弹窗
function showNameModal() {
    elements.nameModal.classList.add('active');
    elements.nameInput.focus();
}

// 隐藏名称设置弹窗
function hideNameModal() {
    elements.nameModal.classList.remove('active');
}

// 设置设备名称
function setDeviceName() {
    const name = elements.nameInput.value.trim();
    if (name) {
        deviceName = name;
        localStorage.setItem('deviceName', name);
        elements.deviceName.textContent = name;
        hideNameModal();
        connectWebSocket();
    }
}

// 连接WebSocket（带自动重连）
let reconnectTimer = null;
let reconnectDelay = 1000;
let shouldReconnect = true;

function connectWebSocket() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    shouldReconnect = true;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        reconnectDelay = 1000;
        shouldReconnect = true;
        elements.connectionStatus.textContent = '● 已连接';
        elements.connectionStatus.classList.remove('disconnected');
        elements.connectionStatus.style.cursor = 'default';
        elements.connectionStatus.onclick = null;

        if (deviceName) {
            ws.send(JSON.stringify({ type: 'set-name', name: deviceName }));
        }

        // 客户端心跳：每15秒发送一次
        clearInterval(window._heartbeatTimer);
        window._heartbeatTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, 15000);
    };

    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type !== 'pong') {
                handleMessage(data);
            }
        } catch (e) {
            console.error('消息解析错误:', e);
        }
    };

    ws.onclose = () => {
        clearInterval(window._heartbeatTimer);

        if (!shouldReconnect) return;

        elements.connectionStatus.textContent = '● 连接断开，检测中...';
        elements.connectionStatus.classList.add('disconnected');

        // 先检测服务器是否还在线
        checkServerAlive().then(alive => {
            if (alive) {
                // 服务器在线，自动重连
                elements.connectionStatus.textContent = '● 重连中...';
                reconnectTimer = setTimeout(() => {
                    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
                    connectWebSocket();
                }, reconnectDelay);
            } else {
                // 服务器已关闭，停止重连
                showDisconnected();
            }
        });
    };
}

// 检测服务器是否在线
async function checkServerAlive() {
    try {
        const res = await fetch('/files', { method: 'GET', signal: AbortSignal.timeout(3000) });
        return res.ok;
    } catch (e) {
        return false;
    }
}

// 显示断开状态（可点击重连）
function showDisconnected() {
    shouldReconnect = false;
    elements.connectionStatus.textContent = '● 已断开，点击重连';
    elements.connectionStatus.classList.add('disconnected');
    elements.connectionStatus.style.cursor = 'pointer';
    elements.connectionStatus.onclick = () => {
        elements.connectionStatus.textContent = '● 连接中...';
        elements.connectionStatus.style.cursor = 'default';
        elements.connectionStatus.onclick = null;
        connectWebSocket();
    };
}

// 处理WebSocket消息
function handleMessage(data) {
    switch (data.type) {
        case 'welcome':
            deviceId = data.deviceId;
            serverIP = data.ip;
            updateConnectInfo();
            break;

        case 'device-list':
            updateDeviceList(data.devices);
            break;

        case 'transfer-request':
            handleTransferRequest(data);
            break;

        case 'transfer-response':
            handleTransferResponse(data);
            break;

        case 'ip-update':
            serverIP = data.ip;
            updateConnectInfo();
            break;
    }
}

// 更新连接信息
function updateConnectInfo() {
    if (!serverIP) return;

    const port = window.location.port || '3000';
    const lanUrl = `http://${serverIP}:${port}`;

    elements.connectUrl.textContent = lanUrl;

    if (typeof QRCode !== 'undefined') {
        elements.qrcode.innerHTML = '';
        new QRCode(elements.qrcode, {
            text: lanUrl,
            width: 128,
            height: 128,
            colorDark: '#333333',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L
        });
    }
}

// 生成二维码
function generateQRCode() {
    const url = window.location.href;
    elements.connectUrl.textContent = url;

    if (typeof QRCode !== 'undefined') {
        new QRCode(elements.qrcode, {
            text: url,
            width: 128,
            height: 128,
            colorDark: '#333333',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L
        });
    }
}

// 复制URL
function copyUrl() {
    const port = window.location.port || '3000';
    const url = serverIP ? `http://${serverIP}:${port}` : window.location.href;

    if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
            showCopySuccess();
        }).catch(() => {
            fallbackCopy(url);
        });
    } else {
        fallbackCopy(url);
    }
}

function fallbackCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();

    try {
        document.execCommand('copy');
        showCopySuccess();
    } catch (err) {
        alert('复制失败，请手动复制');
    }

    document.body.removeChild(textarea);
}

function showCopySuccess() {
    elements.copyBtn.classList.add('copied');
    elements.copyBtn.textContent = '✓';

    setTimeout(() => {
        elements.copyBtn.classList.remove('copied');
        elements.copyBtn.textContent = '📋';
    }, 2000);
}

// 更新设备列表
function updateDeviceList(devices) {
    const otherDevices = devices.filter(d => d.id !== deviceId);
    elements.deviceCount.textContent = otherDevices.length;

    if (otherDevices.length === 0) {
        elements.deviceList.innerHTML = `
            <div class="empty-state">
                <p>暂无其他设备</p>
                <p class="hint">等待其他设备加入...</p>
            </div>
        `;
        return;
    }

    elements.deviceList.innerHTML = otherDevices.map(device => `
        <div class="device-item ${selectedDevice === device.id ? 'selected' : ''}"
             data-id="${device.id}">
            <div class="device-icon">💻</div>
            <div class="device-details">
                <div class="device-item-name">${escapeHtml(device.name)}</div>
                <div class="device-item-ip">${device.ip}</div>
            </div>
        </div>
    `).join('');

    document.querySelectorAll('.device-item').forEach(item => {
        item.addEventListener('click', () => {
            selectDevice(item.dataset.id);
        });
    });
}

function selectDevice(id) {
    selectedDevice = selectedDevice === id ? null : id;
    document.querySelectorAll('.device-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.id === selectedDevice);
    });
}

// 设置事件监听
function setupEventListeners() {
    elements.setNameBtn.addEventListener('click', setDeviceName);
    elements.nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setDeviceName();
    });

    elements.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        elements.dropZone.classList.add('drag-over');
    });

    elements.dropZone.addEventListener('dragleave', () => {
        elements.dropZone.classList.remove('drag-over');
    });

    elements.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        elements.dropZone.classList.remove('drag-over');
        handleDrop(e.dataTransfer);
    });

    document.getElementById('selectFileBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        elements.fileInput.click();
    });

    document.getElementById('selectFolderBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        elements.folderInput.click();
    });

    elements.fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        e.target.value = '';
    });

    elements.folderInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        e.target.value = '';
    });

    elements.refreshBtn.addEventListener('click', loadFileList);
    elements.copyBtn.addEventListener('click', copyUrl);

    // 清空所有文件
    document.getElementById('clearAllBtn').addEventListener('click', clearAllFiles);
}

// 处理拖拽事件（支持文件和文件夹）
function handleDrop(dataTransfer) {
    // 优先使用 items + webkitGetAsEntry 来支持文件夹拖拽
    if (dataTransfer.items && dataTransfer.items.length > 0) {
        const items = Array.from(dataTransfer.items).filter(item => item.kind === 'file');
        if (items.length > 0) {
            const entries = items.map(item => item.webkitGetAsEntry()).filter(Boolean);
            if (entries.length > 0) {
                // 收集所有文件后统一上传
                collectFilesFromEntries(entries).then(fileList => {
                    fileList.forEach(({ file, relativePath }) => {
                        uploadFile(file, relativePath);
                    });
                }).catch(err => {
                    console.error('读取拖拽文件失败:', err);
                    // 降级：使用 files
                    if (dataTransfer.files && dataTransfer.files.length > 0) {
                        handleFiles(dataTransfer.files);
                    }
                });
                return;
            }
        }
    }

    // 降级：使用 files（仅支持文件，不支持文件夹结构）
    if (dataTransfer.files && dataTransfer.files.length > 0) {
        handleFiles(dataTransfer.files);
    }
}

/**
 * 从文件系统条目中递归收集所有文件
 * @param {FileSystemEntry[]} entries - 文件系统条目数组
 * @param {string} basePath - 基础相对路径
 * @returns {Promise<Array<{file: File, relativePath: string}>>} 文件列表
 */
function collectFilesFromEntries(entries, basePath = '') {
    const filePromises = [];

    entries.forEach(entry => {
        if (entry.isFile) {
            // 文件条目：转换为 File 对象并记录相对路径
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
            // 目录条目：递归读取子目录
            const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name;
            filePromises.push(readDirectoryFiles(entry, dirPath));
        }
    });

    return Promise.all(filePromises).then(results => {
        // 展平结果并过滤 null
        return results.flat().filter(Boolean);
    });
}

/**
 * 读取目录中的所有文件（递归）
 * @param {FileSystemDirectoryEntry} dirEntry - 目录条目
 * @param {string} basePath - 基础相对路径
 * @returns {Promise<Array<{file: File, relativePath: string}>>} 文件列表
 */
function readDirectoryFiles(dirEntry, basePath) {
    return new Promise((resolve) => {
        const reader = dirEntry.createReader();
        const allEntries = [];

        // readEntries 可能需要多次调用才能返回所有条目（Chrome 限制每次最多100个）
        function readBatch() {
            reader.readEntries(
                (batch) => {
                    if (batch.length === 0) {
                        // 所有条目读取完毕，递归处理这些条目
                        collectFilesFromEntries(allEntries, basePath).then(resolve);
                    } else {
                        allEntries.push(...batch);
                        readBatch(); // 继续读取下一批
                    }
                },
                () => {
                    // 读取失败，返回空数组
                    resolve([]);
                }
            );
        }

        readBatch();
    });
}

// 处理文件上传（来自 input 选择）
function handleFiles(files) {
    Array.from(files).forEach(file => {
        // 仅在使用 webkitdirectory 选择文件夹时使用 webkitRelativePath
        // 单文件/多文件选择时发送空字符串，让服务器使用唯一命名
        const relativePath = file.webkitRelativePath || '';
        uploadFile(file, relativePath);
    });
}

// 上传文件
function uploadFile(file, relativePath) {
    const formData = new FormData();
    // 关键：relativePath 必须在 file 之前添加，这样 multer 的存储回调
    // 才能访问 req.body.relativePath（busboy 按顺序处理 multipart 各部分）
    formData.append('relativePath', relativePath);
    formData.append('file', file);

    const transferId = 'transfer-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
    const displayName = relativePath || file.name;
    const transferItem = createTransferItem(transferId, displayName, file.size);
    elements.transferList.appendChild(transferItem);
    elements.transferSection.style.display = 'block';

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            updateTransferProgress(transferId, percent);
        }
    });

    xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
            updateTransferStatus(transferId, 'complete', '上传完成');
            loadFileList();
        } else {
            updateTransferStatus(transferId, 'error', '上传失败');
        }
    });

    xhr.addEventListener('error', () => {
        updateTransferStatus(transferId, 'error', '上传失败');
    });

    xhr.open('POST', '/upload');
    xhr.send(formData);
}

function createTransferItem(id, name, size) {
    const div = document.createElement('div');
    div.className = 'transfer-item';
    div.id = id;
    div.innerHTML = `
        <div class="transfer-info">
            <span class="transfer-name">${escapeHtml(name)}</span>
            <span class="transfer-status">0%</span>
        </div>
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
    `;
    return div;
}

function updateTransferProgress(id, percent) {
    const item = document.getElementById(id);
    if (item) {
        item.querySelector('.transfer-status').textContent = `${percent}%`;
        item.querySelector('.progress-fill').style.width = `${percent}%`;
    }
}

function updateTransferStatus(id, status, text) {
    const item = document.getElementById(id);
    if (item) {
        item.querySelector('.transfer-status').textContent = text;
        item.querySelector('.progress-fill').classList.add(status);
    }
}

// 加载文件列表
function loadFileList() {
    fetch('/files')
        .then(res => res.json())
        .then(files => {
            allFiles = files;
            selectedFiles.clear();
            renderFileTree(files);
        })
        .catch(err => {
            console.error('加载文件列表失败:', err);
        });
}

// 渲染文件树
function renderFileTree(files) {
    if (files.length === 0) {
        elements.fileList.innerHTML = '<div class="empty-state"><p>暂无文件</p></div>';
        return;
    }

    // 分离目录和文件，只取顶层（根目录下的直接子项）
    const topLevel = getTopLevelItems(files);

    elements.fileList.innerHTML = `
        <div class="file-tree-toolbar">
            <button class="btn-select-all" id="selectAllBtn">☑ 全选</button>
            <button class="btn-download-selected" id="downloadSelectedBtn" disabled>📦 下载选中</button>
            <button class="btn-delete-selected" id="deleteSelectedBtn" disabled>🗑️ 删除选中</button>
        </div>
        <div class="file-tree">${renderItems(topLevel)}</div>
    `;

    // 绑定工具栏事件
    document.getElementById('selectAllBtn').addEventListener('click', toggleSelectAll);
    document.getElementById('downloadSelectedBtn').addEventListener('click', downloadSelected);
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelected);

    // 绑定复选框事件（支持文件夹联动）
    elements.fileList.querySelectorAll('.file-checkbox').forEach(cb => {
        cb.addEventListener('change', handleCheckboxChange);
    });

    // 绑定文件夹展开事件
    elements.fileList.querySelectorAll('.folder-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox' || e.target.closest('.btn-folder-action')) return;
            const folder = header.closest('.folder-item');
            folder.classList.toggle('collapsed');
        });
    });
}

// 获取顶层条目（直接在 uploads/ 根下的目录和文件）
function getTopLevelItems(files) {
    const topDirs = new Set();
    const topFiles = [];

    files.forEach(f => {
        const parts = f.name.split('/');
        if (parts.length === 1) {
            // 根目录下的文件
            topFiles.push(f);
        } else {
            // 子目录
            topDirs.add(parts[0]);
        }
    });

    const result = [];

    // 添加顶层目录
    topDirs.forEach(dirName => {
        // 计算该目录下的文件数量
        const children = files.filter(f => f.name.startsWith(dirName + '/') || f.name === dirName);
        const fileCount = children.filter(f => !f.isDirectory).length;

        result.push({
            name: dirName,
            isDirectory: true,
            fileCount: fileCount
        });
    });

    // 添加顶层文件
    topFiles.forEach(f => {
        result.push(f);
    });

    return result;
}

// 获取某个目录下的直接子项
function getChildren(dirName, allFiles) {
    const prefix = dirName + '/';
    const childDirs = new Set();
    const childFiles = [];

    allFiles.forEach(f => {
        if (!f.name.startsWith(prefix)) return;
        const rest = f.name.substring(prefix.length);
        const parts = rest.split('/');

        if (parts.length === 1) {
            // 直接子文件
            childFiles.push({ ...f, displayName: parts[0] });
        } else {
            // 子目录
            childDirs.add(parts[0]);
        }
    });

    const result = [];

    childDirs.forEach(subDir => {
        const subDirPath = dirName + '/' + subDir;
        const children = allFiles.filter(f => f.name.startsWith(subDirPath + '/') || f.name === subDirPath);
        const fileCount = children.filter(f => !f.isDirectory).length;

        result.push({
            name: subDirPath,
            displayName: subDir,
            isDirectory: true,
            fileCount: fileCount
        });
    });

    childFiles.forEach(f => result.push(f));

    return result;
}

// 渲染条目列表
function renderItems(items) {
    let html = '';

    // 先渲染目录
    items.filter(item => item.isDirectory).forEach(dir => {
        const children = getChildren(dir.name, allFiles);

        html += `
            <div class="folder-item">
                <div class="folder-header">
                    <input type="checkbox" class="file-checkbox folder-checkbox" data-path="${escapeAttr(dir.name)}" data-type="folder">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${escapeHtml(dir.displayName || dir.name)}</span>
                    <span class="folder-count">${dir.fileCount || 0} 个文件</span>
                    <div class="folder-actions">
                        <button class="btn-folder-action btn-download-folder" onclick="downloadFile('${escapeAttr(dir.name)}')" title="下载文件夹">⬇️</button>
                        <button class="btn-folder-action btn-delete-folder" onclick="deleteFile('${escapeAttr(dir.name)}')" title="删除文件夹">🗑️</button>
                    </div>
                    <span class="folder-toggle">▼</span>
                </div>
                <div class="folder-children">
                    ${renderItems(children)}
                </div>
            </div>
        `;
    });

    // 再渲染文件
    items.filter(item => !item.isDirectory).forEach(file => {
        html += `
            <div class="file-item">
                <input type="checkbox" class="file-checkbox" data-path="${escapeAttr(file.name)}" data-type="file">
                <span class="file-icon">${getFileIcon(file.displayName || file.originalName || file.name)}</span>
                <span class="file-name">${escapeHtml(file.displayName || file.originalName || file.name)}</span>
                <span class="file-size">${formatSize(file.size)}</span>
                <div class="file-actions">
                    <button class="btn-download" onclick="downloadFile('${escapeAttr(file.name)}')" title="下载">⬇️</button>
                    <button class="btn-delete" onclick="deleteFile('${escapeAttr(file.name)}')" title="删除">🗑️</button>
                </div>
            </div>
        `;
    });

    return html;
}

// 处理复选框变更（支持文件夹联动）
function handleCheckboxChange(e) {
    const isFolder = e.target.dataset.type === 'folder';

    if (isFolder) {
        const folderItem = e.target.closest('.folder-item');
        const descendantCheckboxes = folderItem.querySelectorAll('.folder-children .file-checkbox');
        descendantCheckboxes.forEach(descendant => {
            descendant.checked = e.target.checked;
            const descPath = descendant.dataset.path;
            if (e.target.checked) {
                selectedFiles.add(descPath);
            } else {
                selectedFiles.delete(descPath);
            }
        });
    }

    const filePath = e.target.dataset.path;
    if (e.target.checked) {
        selectedFiles.add(filePath);
    } else {
        selectedFiles.delete(filePath);
    }

    updateDownloadButton();
}

// 全选/取消全选
function toggleSelectAll() {
    const allCheckboxes = elements.fileList.querySelectorAll('.file-checkbox');
    const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);

    allCheckboxes.forEach(cb => {
        cb.checked = !allChecked;
        const filePath = cb.dataset.path;
        if (!allChecked) {
            selectedFiles.add(filePath);
        } else {
            selectedFiles.delete(filePath);
        }
    });

    updateDownloadButton();
}

// 更新按钮状态
function updateDownloadButton() {
    const hasSelection = selectedFiles.size > 0;
    const count = selectedFiles.size;

    const downloadBtn = document.getElementById('downloadSelectedBtn');
    if (downloadBtn) {
        downloadBtn.disabled = !hasSelection;
        downloadBtn.textContent = hasSelection ? `📦 下载选中 (${count})` : '📦 下载选中';
    }

    const deleteBtn = document.getElementById('deleteSelectedBtn');
    if (deleteBtn) {
        deleteBtn.disabled = !hasSelection;
        deleteBtn.textContent = hasSelection ? `🗑️ 删除选中 (${count})` : '🗑️ 删除选中';
    }
}

// 下载选中的文件
function downloadSelected() {
    if (selectedFiles.size === 0) return;

    if (selectedFiles.size === 1) {
        // 单个文件/文件夹直接下载
        const filePath = Array.from(selectedFiles)[0];
        downloadFile(filePath);
        return;
    }

    // 多个文件打包下载
    const files = Array.from(selectedFiles);

    fetch('/download-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(err => {
                throw new Error(err.error || '下载失败');
            });
        }
        return response.blob();
    })
    .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'download.zip';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    })
    .catch(err => {
        console.error('下载失败:', err);
        alert('下载失败: ' + err.message);
    });
}

// 下载文件或文件夹
function downloadFile(filePath) {
    const a = document.createElement('a');
    a.href = '/download?path=' + encodeURIComponent(filePath);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// 删除文件或文件夹
function deleteFile(filePath) {
    if (!confirm(`确定要删除 "${filePath}" 吗？`)) return;

    fetch('/files/' + encodeURI(filePath), { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                selectedFiles.delete(filePath);
                loadFileList();
            }
        })
        .catch(err => {
            console.error('删除失败:', err);
            alert('删除失败');
        });
}

// 清空所有文件
function clearAllFiles() {
    if (!confirm('确定要清空所有文件吗？此操作不可恢复！')) return;

    fetch('/files-all', { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                loadFileList();
            }
        })
        .catch(err => {
            console.error('清空失败:', err);
        });
}

// 批量删除选中的文件
function deleteSelected() {
    if (selectedFiles.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedFiles.size} 个项目吗？`)) return;

    const files = Array.from(selectedFiles);
    Promise.all(files.map(file =>
        fetch('/files/' + encodeURI(file), { method: 'DELETE' }).then(res => res.json())
    ))
    .then(() => {
        selectedFiles.clear();
        loadFileList();
    })
    .catch(err => {
        console.error('批量删除失败:', err);
        loadFileList();
    });
}

// 处理传输请求
function handleTransferRequest(data) {
    const accept = confirm(`设备 "${data.fromName}" 想要发送文件 "${data.fileName}" (${formatSize(data.fileSize)})，是否接受？`);

    ws.send(JSON.stringify({
        type: 'transfer-response',
        targetId: data.fromId,
        accepted: accept
    }));
}

function handleTransferResponse(data) {
    if (data.accepted) {
        alert(`${data.fromName} 已接受文件传输`);
    } else {
        alert(`${data.fromName} 拒绝了文件传输`);
    }
}

// 工具函数
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 用于 onclick 属性中的字符串转义
function escapeAttr(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        pdf: '📄',
        doc: '📝', docx: '📝',
        xls: '📊', xlsx: '📊',
        ppt: '📽️', pptx: '📽️',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️',
        mp3: '🎵', wav: '🎵',
        mp4: '🎬', avi: '🎬', mkv: '🎬',
        zip: '📦', rar: '📦', '7z': '📦',
        txt: '📃',
        js: '📜', py: '📜', java: '📜', cpp: '📜',
    };
    return icons[ext] || '📄';
}

// 启动应用
init();
