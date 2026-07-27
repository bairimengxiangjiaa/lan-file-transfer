/**
 * UI 基础组件模块：toast 通知、确认对话框、图片预览、主题切换、通用工具函数
 */

/**
 * 显示 toast 通知
 * @param {string} message
 * @param {'success'|'error'|'info'} [type='info']
 * @param {number} [duration=3000]
 */
export function toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);

    // 触发进入动画
    requestAnimationFrame(() => el.classList.add('show'));

    setTimeout(() => {
        el.classList.remove('show');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // 兜底移除（transition 未触发时）
        setTimeout(() => el.remove(), 500);
    }, duration);
}

/**
 * 显示确认对话框（替代原生 confirm，不阻塞事件循环）
 * @param {string} message
 * @param {string} [title='确认操作']
 * @returns {Promise<boolean>}
 */
export function confirmDialog(message, title = '确认操作') {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOkBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('active');

    return new Promise((resolve) => {
        function cleanup(result) {
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            modal.removeEventListener('click', onBackdrop);
            resolve(result);
        }
        function onOk() { cleanup(true); }
        function onCancel() { cleanup(false); }
        function onBackdrop(e) { if (e.target === modal) cleanup(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        modal.addEventListener('click', onBackdrop);
    });
}

/**
 * 打开图片预览 Lightbox
 * @param {string} url - 图片地址
 * @param {string} name - 文件名（作为标题）
 */
export function openLightbox(url, name) {
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    const caption = document.getElementById('lightboxCaption');
    img.src = url;
    caption.textContent = name;
    lightbox.classList.add('active');
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    lightbox.classList.remove('active');
    img.src = '';
}

/** 初始化 Lightbox 关闭事件（点击遮罩/关闭按钮/Esc） */
export function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox.classList.contains('active')) closeLightbox();
    });
}

/** 初始化主题：跟随系统偏好，手动切换后记忆到 localStorage */
export function initTheme() {
    const toggle = document.getElementById('themeToggle');

    function apply(theme) {
        document.documentElement.dataset.theme = theme;
        toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    }

    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(saved || (prefersDark ? 'dark' : 'light'));

    toggle.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('theme', next);
        apply(next);
    });
}

/** HTML 转义 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/** 文件大小格式化 */
export function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif']);

/** 判断文件名是否为可预览的图片 */
export function isImageFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return IMAGE_EXTS.has(ext);
}

/** 根据扩展名返回文件图标 */
export function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        pdf: '📄',
        doc: '📝', docx: '📝',
        xls: '📊', xlsx: '📊',
        ppt: '📽️', pptx: '📽️',
        jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', bmp: '🖼️', webp: '🖼️', svg: '🖼️',
        mp3: '🎵', wav: '🎵', flac: '🎵',
        mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
        zip: '📦', rar: '📦', '7z': '📦', apk: '📦',
        txt: '📃',
        js: '📜', py: '📜', java: '📜', cpp: '📜',
    };
    return icons[ext] || '📄';
}

/** 将文件路径按段编码为 URL（保留 / 分隔符，正确处理 # ? + 等特殊字符） */
export function encodePath(filePath) {
    return filePath.split('/').map(encodeURIComponent).join('/');
}
