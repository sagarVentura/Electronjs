const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('scormAPI', {
  getCourses: () => ipcRenderer.invoke('get-scorm-courses'),
  openScorm: (path) => ipcRenderer.send('open-scorm', path),
  decryptScorm: (courseName) => ipcRenderer.invoke('decrypt-course', courseName)

});
