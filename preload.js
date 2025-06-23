const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scormAPI', {
  getCourses: () => ipcRenderer.invoke('get-scorm-courses'),
  openScorm: (path) => ipcRenderer.send('open-scorm', path),
  decryptScorm: (path) => ipcRenderer.send('open-scorm', path)

});
