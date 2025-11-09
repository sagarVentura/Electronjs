const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scormAPI', {
  openScorm: (path) => ipcRenderer.send('open-scorm', path),
  decryptScorm: (courseName) => ipcRenderer.invoke('decrypt-course', courseName),

  // ✅ New function for directly opening a local HTML file
  openLocalHtml: (filePath) => ipcRenderer.send('open-local-html', filePath)

});
