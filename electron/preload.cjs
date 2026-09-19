const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aaApi', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  dataPath: () => ipcRenderer.invoke('data:path'),
});
