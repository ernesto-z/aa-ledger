const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow = null;

const defaultDataFile = () => path.join(app.getPath('userData'), 'aa-ledger-data.json');
const configFile = () => path.join(app.getPath('userData'), 'aa-ledger-config.json');

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
  const { dataFile } = readConfig();
  if (typeof dataFile === 'string' && path.isAbsolute(dataFile)) return dataFile;
  return defaultDataFile();
}

function dataInfo() {
  const file = resolveDataFile();
  return { file, isDefault: path.resolve(file) === path.resolve(defaultDataFile()), exists: fs.existsSync(file) };
}

function readData() {
  const file = resolveDataFile();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const broken = `${file}.corrupt-${Date.now()}`;
    fs.renameSync(file, broken);
    dialog.showErrorBox('数据文件无法读取', `已把损坏文件另存为：\n${broken}\n将以空数据启动。`);
    return null;
  }
}

function writeData(data) {
  const file = resolveDataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
  return file;
}

async function pickDataFile() {
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
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle('data:load', () => readData());
ipcMain.handle('data:save', (_e, data) => {
  writeData(data);
  return true;
});
ipcMain.handle('data:info', () => dataInfo());
ipcMain.handle('data:choose', () => pickDataFile());
ipcMain.handle('data:restore-default', () => restoreDefaultPath());
ipcMain.handle('data:reveal', () => shell.showItemInFolder(resolveDataFile()));

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
