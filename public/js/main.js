/**
 * 入口模块：组装各模块，负责连接信息卡片、设备列表、名称设置、拖拽上传接线
 */
import { toast, initLightbox, initTheme, escapeHtml } from './ui.js';
import { connect, send } from './ws.js';
import { initUpload, enqueueFiles, collectFilesFromEntries } from './upload.js';
import { initFileTree, loadFileList } from './file-tree.js';

let myDeviceId = null;
let myDeviceName = localStorage.getItem('deviceName') || '';

/* ==================== 连接信息卡片 ==================== */

function updateConnectInfo(data) {
    const port = window.location.port || '80';
    const url = `http://${data.ip}:${port}`;

    document.getElementById('connectUrl').textContent = url;
    document.getElementById('deviceHostname').textContent = data.hostname;

    // mDNS 备用地址（服务端广播成功时才展示）
    if (data.mDNS) {
        document.getElementById('mdnsUrl').textContent = `http://${data.mDNS}:${port}`;
        document.getElementById('mdnsRow').style.display = '';
    }

    // 生成二维码（重连后先清空旧的）
    const qrEl = document.getElementById('qrcode');
    qrEl.innerHTML = '';
    if (typeof QRCode !== 'undefined') {
        new QRCode(qrEl, {
            text: url,
            width: 128,
            height: 128,
            colorDark: '#1f2937',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }
}

function initCopyButton() {
    document.getElementById('copyBtn').addEventListener('click', async () => {
        const url = document.getElementById('connectUrl').textContent;
        if (!url || url === '-') return;
        try {
            await navigator.clipboard.writeText(url);
            toast('已复制访问地址', 'success');
        } catch (e) {
            // 非安全上下文（http://局域网IP）下 clipboard API 不可用，降级处理
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(input);
            toast(ok ? '已复制访问地址' : '复制失败，请手动复制', ok ? 'success' : 'error');
        }
    });
}

/* ==================== IP 变化提示 ==================== */

function showIpBanner(newIp) {
    const port = window.location.port || '80';
    document.getElementById('ipChangeNewAddr').textContent = `http://${newIp}:${port}`;
    document.getElementById('ipChangeBanner').style.display = '';
}

function initIpBanner() {
    document.getElementById('ipChangeClose').addEventListener('click', () => {
        document.getElementById('ipChangeBanner').style.display = 'none';
    });
}

/* ==================== 设备列表（纯展示） ==================== */

function renderDeviceList(devices) {
    const others = devices.filter(d => d.id !== myDeviceId);
    document.getElementById('deviceCount').textContent = others.length;

    const listEl = document.getElementById('deviceList');
    if (others.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <p>暂无其他设备</p>
                <p class="hint">等待其他设备加入...</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = others.map(d => `
        <div class="device-item">
            <span class="device-icon">📱</span>
            <div class="device-detail">
                <span class="device-item-name">${escapeHtml(d.name)}</span>
                <span class="device-item-ip">${escapeHtml(d.ip || '')}</span>
            </div>
            <span class="device-online-dot" title="在线"></span>
        </div>
    `).join('');
}

/* ==================== 设备名称 ==================== */

function applyDeviceName(name) {
    myDeviceName = name;
    document.getElementById('deviceName').textContent = name;
}

function initNameModal() {
    const modal = document.getElementById('nameModal');
    const input = document.getElementById('nameInput');

    function submit() {
        const name = input.value.trim();
        if (!name) return;
        localStorage.setItem('deviceName', name);
        applyDeviceName(name);
        send({ type: 'set-name', name });
        modal.classList.remove('active');
    }

    document.getElementById('setNameBtn').addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
    });

    // 点击设备名可重新修改
    document.getElementById('deviceName').addEventListener('click', () => {
        input.value = myDeviceName;
        modal.classList.add('active');
        input.focus();
    });

    if (!myDeviceName) {
        modal.classList.add('active');
        input.focus();
    } else {
        applyDeviceName(myDeviceName);
    }
}

/* ==================== 文件选择与拖拽上传 ==================== */

function initFilePickers() {
    const fileInput = document.getElementById('fileInput');
    const folderInput = document.getElementById('folderInput');

    document.getElementById('selectFileBtn').addEventListener('click', () => fileInput.click());
    document.getElementById('selectFolderBtn').addEventListener('click', () => folderInput.click());

    fileInput.addEventListener('change', () => {
        const items = Array.from(fileInput.files).map(file => ({ file, relativePath: '' }));
        enqueueFiles(items);
        fileInput.value = '';
    });

    folderInput.addEventListener('change', () => {
        const items = Array.from(folderInput.files).map(file => ({
            file,
            relativePath: file.webkitRelativePath || ''
        }));
        enqueueFiles(items);
        folderInput.value = '';
    });
}

function initDragDrop() {
    const overlay = document.getElementById('dropOverlay');
    let dragDepth = 0;

    // 全页拖拽：任意位置进入显示遮罩
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes('Files')) return;
        dragDepth++;
        overlay.classList.add('active');
    });

    document.addEventListener('dragover', (e) => e.preventDefault());

    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) overlay.classList.remove('active');
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dragDepth = 0;
        overlay.classList.remove('active');
        if (!e.dataTransfer) return;

        // 优先用 webkitGetAsEntry 以支持文件夹递归
        const entries = Array.from(e.dataTransfer.items || [])
            .map(item => item.webkitGetAsEntry && item.webkitGetAsEntry())
            .filter(Boolean);

        if (entries.length > 0) {
            const items = await collectFilesFromEntries(entries);
            if (items.length === 0) {
                toast('未读取到可上传的文件', 'info');
                return;
            }
            enqueueFiles(items);
        } else if (e.dataTransfer.files.length > 0) {
            const items = Array.from(e.dataTransfer.files).map(file => ({ file, relativePath: '' }));
            enqueueFiles(items);
        }
    });
}

/* ==================== 启动 ==================== */

function init() {
    initTheme();
    initLightbox();
    initCopyButton();
    initIpBanner();
    initNameModal();
    initFilePickers();
    initDragDrop();

    initUpload({ onUploaded: loadFileList });
    initFileTree();
    loadFileList();

    connect({
        getDeviceName: () => myDeviceName || null,
        onWelcome: (data) => {
            myDeviceId = data.deviceId;
            if (!myDeviceName) {
                document.getElementById('deviceName').textContent = data.deviceName;
            }
            updateConnectInfo(data);
        },
        onDeviceList: renderDeviceList,
        onIpUpdate: showIpBanner
    });
}

init();
