const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let mainWindow = null;

const dataFile = () => path.join(app.getPath('userData'), 'aa-ledger-data.json');

function readData() {
  const file = dataFile();
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
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
  return file;
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

function buildMenu() {
  const template = [
    { role: 'appMenu' },
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: '数据',
      submenu: [
        {
          label: '打开数据所在目录',
          click: () => shell.showItemInFolder(dataFile()),
        },
        {
          label: '导出备份 JSON…',
          click: async () => {
            const data = readData();
            if (!data) return;
            const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
              title: '导出备份',
              defaultPath: `aa-ledger-${new Date().toISOString().slice(0, 10)}.json`,
              filters: [{ name: 'JSON', extensions: ['json'] }],
            });
            if (!canceled && filePath) fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
          },
        },
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
ipcMain.handle('data:path', () => dataFile());

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
