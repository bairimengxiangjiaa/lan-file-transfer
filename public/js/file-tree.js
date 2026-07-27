/**
 * 文件树模块：渲染、选择、搜索、排序、下载/删除、图片预览
 * 全部交互使用事件委托，刷新后保留展开/勾选状态
 */
import { toast, confirmDialog, openLightbox, escapeHtml, formatSize, getFileIcon, isImageFile, encodePath } from './ui.js';

let allFiles = [];
const selectedFiles = new Set();
const collapsedFolders = new Set(); // 记录被折叠的文件夹（默认展开）
let searchQuery = '';
let sortMode = 'time-desc';

const fileListEl = () => document.getElementById('fileList');

/** 初始化：绑定工具栏与列表事件（只执行一次） */
export function initFileTree() {
    document.getElementById('refreshBtn').addEventListener('click', loadFileList);
    document.getElementById('selectAllBtn').addEventListener('click', toggleSelectAll);
    document.getElementById('downloadSelectedBtn').addEventListener('click', downloadSelected);
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelected);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllFiles);

    document.getElementById('fileSearch').addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        render();
    });

    document.getElementById('fileSort').addEventListener('change', (e) => {
        sortMode = e.target.value;
        render();
    });

    const list = fileListEl();

    // 复选框联动（事件委托）
    list.addEventListener('change', (e) => {
        if (!e.target.classList.contains('file-checkbox')) return;
        handleCheckboxChange(e);
    });

    // 点击行为：下载/删除/预览/折叠（事件委托）
    list.addEventListener('click', async (e) => {
        const downloadBtn = e.target.closest('[data-action="download"]');
        if (downloadBtn) {
            downloadFile(downloadBtn.dataset.path);
            return;
        }

        const deleteBtn = e.target.closest('[data-action="delete"]');
        if (deleteBtn) {
            const filePath = deleteBtn.dataset.path;
            const ok = await confirmDialog(`确定要删除 "${filePath}" 吗？`, '删除确认');
            if (ok) deleteFile(filePath);
            return;
        }

        const previewName = e.target.closest('[data-action="preview"]');
        if (previewName) {
            const filePath = previewName.dataset.path;
            openLightbox('/download?path=' + encodeURIComponent(filePath) + '&inline=1', filePath);
            return;
        }

        const header = e.target.closest('.folder-header');
        if (header && !e.target.closest('.file-checkbox')) {
            const folder = header.closest('.folder-item');
            const path = header.dataset.path;
            folder.classList.toggle('collapsed');
            if (folder.classList.contains('collapsed')) {
                collapsedFolders.add(path);
            } else {
                collapsedFolders.delete(path);
            }
        }
    });
}

/** 拉取文件列表并渲染（保留现有选择/折叠状态，剔除已不存在的路径） */
export function loadFileList() {
    fetch('/files')
        .then(res => res.json())
        .then(files => {
            allFiles = files;
            const existing = new Set(files.map(f => f.name));
            for (const p of [...selectedFiles]) {
                if (!existing.has(p)) selectedFiles.delete(p);
            }
            for (const p of [...collapsedFolders]) {
                if (!existing.has(p)) collapsedFolders.delete(p);
            }
            render();
        })
        .catch(err => {
            console.error('加载文件列表失败:', err);
        });
}

/* ==================== 渲染 ==================== */

/** 根据搜索词过滤：文件按路径匹配，文件夹保留含匹配项的 */
function getVisibleFiles() {
    if (!searchQuery) return allFiles;

    const matchedPaths = new Set();
    for (const f of allFiles) {
        if (!f.isDirectory && f.name.toLowerCase().includes(searchQuery)) {
            matchedPaths.add(f.name);
            // 保留所有祖先目录
            const parts = f.name.split('/');
            for (let i = 1; i < parts.length; i++) {
                matchedPaths.add(parts.slice(0, i).join('/'));
            }
        }
    }
    return allFiles.filter(f => matchedPaths.has(f.name));
}

function compareFiles(a, b) {
    switch (sortMode) {
        case 'time-asc': return new Date(a.uploadedAt) - new Date(b.uploadedAt);
        case 'name-asc': return a.name.localeCompare(b.name, 'zh-CN');
        case 'name-desc': return b.name.localeCompare(a.name, 'zh-CN');
        case 'size-desc': return b.size - a.size;
        case 'size-asc': return a.size - b.size;
        case 'time-desc':
        default:
            return new Date(b.uploadedAt) - new Date(a.uploadedAt);
    }
}

function render() {
    const files = getVisibleFiles();

    if (files.length === 0) {
        fileListEl().innerHTML = `<div class="empty-state"><p>${searchQuery ? '没有匹配的文件' : '暂无文件'}</p></div>`;
        updateToolbarButtons();
        return;
    }

    const topLevel = getTopLevelItems(files);
    fileListEl().innerHTML = `<div class="file-tree">${renderItems(topLevel, files)}</div>`;
    updateToolbarButtons();
}

// 获取顶层条目（根目录下的直接子项）
function getTopLevelItems(files) {
    const topDirs = new Set();
    const topFiles = [];

    files.forEach(f => {
        const parts = f.name.split('/');
        if (parts.length === 1) {
            if (f.isDirectory) {
                topDirs.add(f.name);
            } else {
                topFiles.push(f);
            }
        } else {
            topDirs.add(parts[0]);
        }
    });

    const result = [];
    topDirs.forEach(dirName => {
        const children = files.filter(f => f.name.startsWith(dirName + '/'));
        result.push({
            name: dirName,
            displayName: dirName,
            isDirectory: true,
            fileCount: children.filter(f => !f.isDirectory).length,
            uploadedAt: (files.find(f => f.name === dirName) || {}).uploadedAt || 0,
            size: 0
        });
    });
    topFiles.forEach(f => result.push(f));

    return result;
}

// 获取某个目录下的直接子项
function getChildren(dirName, files) {
    const prefix = dirName + '/';
    const childDirs = new Set();
    const childFiles = [];

    files.forEach(f => {
        if (!f.name.startsWith(prefix)) return;
        const rest = f.name.substring(prefix.length);
        const parts = rest.split('/');

        if (parts.length === 1) {
            if (f.isDirectory) {
                childDirs.add(parts[0]);
            } else {
                childFiles.push({ ...f, displayName: parts[0] });
            }
        } else {
            childDirs.add(parts[0]);
        }
    });

    const result = [];
    childDirs.forEach(subDir => {
        const subDirPath = prefix + subDir;
        const children = files.filter(f => f.name.startsWith(subDirPath + '/'));
        result.push({
            name: subDirPath,
            displayName: subDir,
            isDirectory: true,
            fileCount: children.filter(f => !f.isDirectory).length,
            uploadedAt: (files.find(f => f.name === subDirPath) || {}).uploadedAt || 0,
            size: 0
        });
    });
    childFiles.forEach(f => result.push(f));

    return result;
}

function renderItems(items, files) {
    let html = '';
    const dirs = items.filter(item => item.isDirectory).sort(compareFiles);
    const plainFiles = items.filter(item => !item.isDirectory).sort(compareFiles);

    for (const dir of dirs) {
        const children = getChildren(dir.name, files);
        // 搜索时强制展开以显示匹配项
        const isCollapsed = !searchQuery && collapsedFolders.has(dir.name);

        html += `
            <div class="folder-item${isCollapsed ? ' collapsed' : ''}">
                <div class="folder-header" data-path="${escapeHtml(dir.name)}">
                    <input type="checkbox" class="file-checkbox folder-checkbox" data-path="${escapeHtml(dir.name)}" data-type="folder"
                        ${selectedFiles.has(dir.name) ? 'checked' : ''} aria-label="选择文件夹">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${escapeHtml(dir.displayName || dir.name)}</span>
                    <span class="folder-count">${dir.fileCount || 0} 个文件</span>
                    <div class="folder-actions">
                        <button class="btn-item-action" data-action="download" data-path="${escapeHtml(dir.name)}" title="下载文件夹" aria-label="下载文件夹">⬇️</button>
                        <button class="btn-item-action" data-action="delete" data-path="${escapeHtml(dir.name)}" title="删除文件夹" aria-label="删除文件夹">🗑️</button>
                    </div>
                    <span class="folder-toggle">▼</span>
                </div>
                <div class="folder-children">
                    ${renderItems(children, files)}
                </div>
            </div>
        `;
    }

    for (const file of plainFiles) {
        const displayName = file.displayName || file.originalName || file.name;
        const previewable = isImageFile(displayName);

        html += `
            <div class="file-item">
                <input type="checkbox" class="file-checkbox" data-path="${escapeHtml(file.name)}" data-type="file"
                    ${selectedFiles.has(file.name) ? 'checked' : ''} aria-label="选择文件">
                <span class="file-icon">${getFileIcon(displayName)}</span>
                <span class="file-name${previewable ? ' previewable' : ''}"
                    ${previewable ? `data-action="preview" data-path="${escapeHtml(file.name)}" title="点击预览"` : ''}>${escapeHtml(displayName)}</span>
                <span class="file-size">${formatSize(file.size)}</span>
                <div class="file-actions">
                    ${previewable ? `<button class="btn-item-action" data-action="preview" data-path="${escapeHtml(file.name)}" title="预览" aria-label="预览图片">👁️</button>` : ''}
                    <button class="btn-item-action" data-action="download" data-path="${escapeHtml(file.name)}" title="下载" aria-label="下载文件">⬇️</button>
                    <button class="btn-item-action" data-action="delete" data-path="${escapeHtml(file.name)}" title="删除" aria-label="删除文件">🗑️</button>
                </div>
            </div>
        `;
    }

    return html;
}

/* ==================== 选择 ==================== */

function handleCheckboxChange(e) {
    const isFolder = e.target.dataset.type === 'folder';

    if (isFolder) {
        const folderItem = e.target.closest('.folder-item');
        folderItem.querySelectorAll('.folder-children .file-checkbox').forEach(descendant => {
            descendant.checked = e.target.checked;
            if (e.target.checked) {
                selectedFiles.add(descendant.dataset.path);
            } else {
                selectedFiles.delete(descendant.dataset.path);
            }
        });
    }

    if (e.target.checked) {
        selectedFiles.add(e.target.dataset.path);
    } else {
        selectedFiles.delete(e.target.dataset.path);
    }

    updateToolbarButtons();
}

function toggleSelectAll() {
    const allCheckboxes = fileListEl().querySelectorAll('.file-checkbox');
    if (allCheckboxes.length === 0) return;
    const allChecked = Array.from(allCheckboxes).every(cb => cb.checked);

    allCheckboxes.forEach(cb => {
        cb.checked = !allChecked;
        if (!allChecked) {
            selectedFiles.add(cb.dataset.path);
        } else {
            selectedFiles.delete(cb.dataset.path);
        }
    });

    updateToolbarButtons();
}

function updateToolbarButtons() {
    const count = selectedFiles.size;
    const hasSelection = count > 0;

    const downloadBtn = document.getElementById('downloadSelectedBtn');
    downloadBtn.disabled = !hasSelection;
    downloadBtn.textContent = hasSelection ? `📦 下载选中 (${count})` : '📦 下载选中';

    const deleteBtn = document.getElementById('deleteSelectedBtn');
    deleteBtn.disabled = !hasSelection;
    deleteBtn.textContent = hasSelection ? `🗑️ 删除选中 (${count})` : '🗑️ 删除选中';
}

/* ==================== 下载 / 删除 ==================== */

function downloadFile(filePath) {
    const a = document.createElement('a');
    a.href = '/download?path=' + encodeURIComponent(filePath);
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function downloadSelected() {
    if (selectedFiles.size === 0) return;

    if (selectedFiles.size === 1) {
        downloadFile([...selectedFiles][0]);
        return;
    }

    fetch('/download-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [...selectedFiles] })
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
        toast('下载失败: ' + err.message, 'error');
    });
}

function deleteFile(filePath) {
    fetch('/files/' + encodePath(filePath), { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                selectedFiles.delete(filePath);
                toast('已删除', 'success');
                loadFileList();
            } else {
                toast(data.error || '删除失败', 'error');
            }
        })
        .catch(err => {
            console.error('删除失败:', err);
            toast('删除失败', 'error');
        });
}

async function deleteSelected() {
    if (selectedFiles.size === 0) return;
    const ok = await confirmDialog(`确定要删除选中的 ${selectedFiles.size} 个项目吗？`, '批量删除');
    if (!ok) return;

    const files = [...selectedFiles];
    Promise.all(files.map(file =>
        fetch('/files/' + encodePath(file), { method: 'DELETE' }).then(res => res.json()).catch(() => ({}))
    ))
    .then(() => {
        selectedFiles.clear();
        toast('删除完成', 'success');
        loadFileList();
    })
    .catch(err => {
        console.error('批量删除失败:', err);
        loadFileList();
    });
}

async function clearAllFiles() {
    const ok = await confirmDialog('确定要清空所有文件吗？此操作不可恢复！', '清空全部');
    if (!ok) return;

    fetch('/files-all', { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                selectedFiles.clear();
                toast('已清空全部文件', 'success');
                loadFileList();
            }
        })
        .catch(err => {
            console.error('清空失败:', err);
            toast('清空失败', 'error');
        });
}
