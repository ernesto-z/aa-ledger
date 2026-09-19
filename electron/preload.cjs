const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aaApi', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  dataInfo: () => ipcRenderer.invoke('data:info'),
  chooseDataFile: () => ipcRenderer.invoke('data:choose'),
  restoreDefaultPath: () => ipcRenderer.invoke('data:restore-default'),
  revealDataFile: () => ipcRenderer.invoke('data:reveal'),
  onDataPathChanged: (callback) => ipcRenderer.on('data:changed', () => callback()),
});
