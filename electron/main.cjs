const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const store = require('./data-store.cjs');

/* 测试 / 自动化验证用：这两个环境变量把读写整体挪到别处，
   这样跑测试、验证界面改动时不会碰到你真正的账本文件。
     AA_LEDGER_DATA      = 数据 JSON 的完整路径
     AA_LEDGER_USER_DATA = 应用自己的目录（配置、缓存也一起隔离） */
const envDataFile = () => {
  const raw = process.env.AA_LEDGER_DATA;
  return typeof raw === 'string' && path.isAbsolute(raw) ? raw : null;
};

const envUserData = process.env.AA_LEDGER_USER_DATA;
if (typeof envUserData === 'string' && path.isAbsolute(envUserData)) {
  try {
    fs.mkdirSync(envUserData, { recursive: true });
    app.setPath('userData', envUserData);
  } catch {
    /* 路径不合法就按默认位置继续 */
  }
}

let mainWindow = null;

const defaultDataFile = () => path.join(app.getPath('userData'), 'aa-ledger-data.json');
const configFile = () => path.join(app.getPath('userData'), 'aa-ledger-config.json');

/* 我们最后一次读到 / 写出的磁盘内容。保存时拿它和磁盘现状比对，
   对不上就说明有另一个实例改过，不能直接覆盖。 */
let knownText = null;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function resolveDataFile() {
  const fromEnv = envDataFile();
  if (fromEnv) return fromEnv;
  const { dataFile } = readConfig();
  if (typeof dataFile === 'string' && path.isAbsolute(dataFile)) return dataFile;
  return defaultDataFile();
}

function dataInfo() {
  const file = resolveDataFile();
  return {
    file,
    isDefault: path.resolve(file) === path.resolve(defaultDataFile()),
    exists: fs.existsSync(file),
    lockedByEnv: Boolean(envDataFile()),
    backupDir: store.backupDirFor(file),
  };
}

function readData() {
  const file = resolveDataFile();
  const result = store.readDataFile(file);
  if (result.corrupt) {
    dialog.showErrorBox('数据文件无法读取', `已把损坏文件另存为：\n${result.corrupt}\n将以空数据启动。`);
  }
  knownText = result.text;
  return result.data;
}

function writeData(data) {
  const file = resolveDataFile();
  const result = store.writeDataFile(file, data, { expected: knownText });
  if (result.conflict) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['知道了'],
      message: '这份账本已经被别处的修改覆盖过，已停止写入。',
      detail: `磁盘上的文件在你这次编辑之后又被改过，直接保存会把那一份丢掉。\n\n本次的改动另存成了：\n${result.conflict}\n\n请关掉多余的窗口（同一个账本只留一个应用在写），再到菜单「数据 → 从备份恢复…」里挑一份。`,
    });
    return { ok: false, conflict: result.conflict };
  }
  knownText = result.text;
  return { ok: true, unchanged: result.unchanged };
}

function restoreFromBackup() {
  const file = resolveDataFile();
  const dir = store.backupDirFor(file);
  fs.mkdirSync(dir, { recursive: true });
  dialog
    .showOpenDialog(mainWindow, {
      title: '选一份备份恢复',
      defaultPath: dir,
      filters: [{ name: '账本备份 JSON', extensions: ['json'] }],
    })
    .then(({ canceled, filePaths }) => {
      if (canceled || !filePaths[0]) return;
      let data = null;
      try {
        data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
      } catch {
        dialog.showErrorBox('这份备份读不出来', `文件：\n${filePaths[0]}`);
        return;
      }
      const result = store.writeDataFile(file, data, { expected: knownText });
      if (result.conflict) {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          buttons: ['知道了'],
          message: '数据文件刚被别处改过，没有恢复。',
          detail: `本次恢复内容另存成了：\n${result.conflict}`,
        });
        return;
      }
      knownText = result.text;
      mainWindow?.webContents.send('data:changed');
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['知道了'],
        message: '已恢复这份备份。',
        detail: `来自：${filePaths[0]}\n恢复前的那份已自动备份，同样在「数据 → 从备份恢复…」里能选到。`,
      });
    });
}


async function pickDataFile() {
  if (envDataFile()) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['知道了'],
      message: '当前数据位置由环境变量 AA_LEDGER_DATA 指定，改不了。',
      detail: '去掉这个环境变量再启动应用，就能自己选存放位置。',
    });
    return { canceled: true };
  }
  const current = resolveDataFile();
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '账本数据存到哪里',
    defaultPath: path.basename(current),
    filters: [{ name: '账本数据 JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  const target = path.extname(filePath) ? filePath : `${filePath}.json`;
  if (path.resolve(target) === path.resolve(current)) return { canceled: true, unchanged: true };

  let migrated = false;
  if (fs.existsSync(current)) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['把现有数据带过去', '从空账本开始', '取消'],
      defaultId: 0,
      cancelId: 2,
      message: `新的数据文件：\n${target}`,
      detail: fs.existsSync(target) ? '该位置已有同名文件，选「带过去」会覆盖它。' : '要把现在这份账本数据复制过去吗？',
    });
    if (response === 2) return { canceled: true };
    if (response === 0) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(current, target);
      migrated = true;
    }
  }

  writeConfig({ dataFile: target });
  return { canceled: false, file: target, migrated };
}

async function restoreDefaultPath() {
  if (envDataFile()) return { canceled: true };
  const current = resolveDataFile();
  const target = defaultDataFile();
  if (path.resolve(current) === path.resolve(target)) return { canceled: true, unchanged: true };
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['把数据带回默认位置', '只改回默认位置', '取消'],
    defaultId: 0,
    cancelId: 2,
    message: `恢复默认数据位置：\n${target}`,
    detail: '当前文件会保持原样，不再被本应用读写。',
  });
  if (response === 2) return { canceled: true };
  if (response === 0 && fs.existsSync(current)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(current, target);
  }
  writeConfig({ dataFile: null });
  return { canceled: false, file: target };
}

async function runDataAction(fn) {
  const result = await fn();
  if (result && !result.canceled) mainWindow?.webContents.send('data:changed');
  return result;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'AA 账本',
    backgroundColor: '#f5f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function exportBackup() {
  const data = readData();
  if (!data) {
    dialog.showMessageBox(mainWindow, { type: 'info', message: '现在还没有账本数据可导出。' });
    return;
  }
  dialog
    .showSaveDialog(mainWindow, {
      title: '导出备份',
      defaultPath: `aa-ledger-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    .then(({ canceled, filePath }) => {
      if (!canceled && filePath) fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    });
}

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: '数据',
      submenu: [
        { label: '更改数据存放位置…', click: () => runDataAction(pickDataFile) },
        { label: '恢复默认数据位置', click: () => runDataAction(restoreDefaultPath) },
        { type: 'separator' },
        { label: '在文件夹中显示数据文件', click: () => shell.showItemInFolder(resolveDataFile()) },
        { label: '导出备份 JSON…', click: exportBackup },
        { type: 'separator' },
        { label: '从备份恢复…', click: restoreFromBackup },
        { label: '打开备份文件夹', click: () => shell.openPath(store.backupDirFor(resolveDataFile())) },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => writeData(data));
ipcMain.handle('data:info', () => dataInfo());
ipcMain.handle('data:choose', () => pickDataFile());
ipcMain.handle('data:restore-default', () => restoreDefaultPath());
ipcMain.handle('data:reveal', () => shell.showItemInFolder(resolveDataFile()));

/* 同一个数据目录只允许一个实例在写：开发版和打包版同时开着时，
   后启动的那个只把前一个唤到前台，不会两份内存各自往同一个文件里盖。 */
if (!app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  app.quit();
} else {
  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
