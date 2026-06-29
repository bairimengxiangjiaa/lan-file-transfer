/**
 * Windows 服务安装与管理脚本
 *
 * 功能说明：
 * - 将局域网文件传输工具安装为 Windows 系统服务
 * - 支持开机自启动、后台运行
 * - 提供安装、卸载、启动、停止等操作
 *
 * 使用方式：
 *   node service.js install   # 安装服务
 *   node service.js uninstall # 卸载服务
 *   node service.js start     # 启动服务
 *   node service.js stop      # 停止服务
 */

const Service = require('node-windows').Service;
const path = require('path');

// 服务配置
const serviceConfig = {
    name: 'LANFileTransfer',
    displayName: 'LAN File Transfer Service',
    description: '局域网文件传输服务 - 支持设备发现与文件快速传输',
    script: path.join(__dirname, 'server.js'),
    nodeOptions: [],
    workingDirectory: __dirname
};

// 创建服务实例
const svc = new Service(serviceConfig);

// 日志路径
const logPath = path.join(__dirname, '.daemon');

// 操作类型
const action = process.argv[2] || 'install';

/**
 * 安装服务
 */
function installService() {
    console.log('正在安装服务...');
    console.log(`  名称: ${serviceConfig.name}`);
    console.log(`  显示名称: ${serviceConfig.displayName}`);
    console.log(`  脚本路径: ${serviceConfig.script}`);
    console.log(`  工作目录: ${serviceConfig.workingDirectory}`);
    console.log('');

    // 监听安装事件
    svc.on('install', () => {
        console.log('✓ 服务安装成功！');
        console.log('');
        console.log('服务已设置为自动启动，系统重启后会自动运行。');
        console.log('如需立即启动，请执行: node service.js start');
    });

    svc.on('alreadyinstalled', () => {
        console.log('! 服务已安装，无需重复安装。');
        console.log('如需重新安装，请先执行: node service.js uninstall');
    });

    svc.on('error', (err) => {
        console.error('✗ 服务安装失败:', err.message);
        process.exit(1);
    });

    svc.install();
}

/**
 * 卸载服务
 */
function uninstallService() {
    console.log('正在卸载服务...');
    console.log(`  名称: ${serviceConfig.name}`);
    console.log('');

    svc.on('uninstall', () => {
        console.log('✓ 服务卸载成功！');
    });

    svc.on('alreadyuninstalled', () => {
        console.log('! 服务未安装，无需卸载。');
    });

    svc.on('error', (err) => {
        console.error('✗ 服务卸载失败:', err.message);
        process.exit(1);
    });

    svc.uninstall();
}

/**
 * 启动服务
 */
function startService() {
    console.log('正在启动服务...');
    console.log('');

    svc.on('start', () => {
        console.log('✓ 服务启动成功！');
        console.log('');
        console.log('服务正在后台运行，可以通过以下方式访问：');
        console.log('  - 本机: http://localhost:3000');
        console.log('  - 局域网: http://<本机IP>:3000');
    });

    svc.on('error', (err) => {
        console.error('✗ 服务启动失败:', err.message);
        process.exit(1);
    });

    svc.start();
}

/**
 * 停止服务
 */
function stopService() {
    console.log('正在停止服务...');
    console.log('');

    svc.on('stop', () => {
        console.log('✓ 服务已停止！');
    });

    svc.on('error', (err) => {
        console.error('✗ 服务停止失败:', err.message);
        process.exit(1);
    });

    svc.stop();
}

// 执行对应操作
switch (action.toLowerCase()) {
    case 'install':
        installService();
        break;
    case 'uninstall':
        uninstallService();
        break;
    case 'start':
        startService();
        break;
    case 'stop':
        stopService();
        break;
    case 'restart':
        console.log('正在重启服务...');
        svc.on('stop', () => svc.start());
        svc.stop();
        break;
    default:
        console.log('用法: node service.js [install|uninstall|start|stop|restart]');
        console.log('');
        console.log('操作说明:');
        console.log('  install   - 安装为 Windows 服务（开机自启）');
        console.log('  uninstall - 卸载 Windows 服务');
        console.log('  start     - 启动服务');
        console.log('  stop      - 停止服务');
        console.log('  restart   - 重启服务');
        process.exit(0);
}
