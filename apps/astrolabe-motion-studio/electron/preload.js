"use strict";

// electron/preload.ts
var import_electron = require("electron");
import_electron.contextBridge.exposeInMainWorld("electronAPI", {
  saveProject: (projectData, filePath) => import_electron.ipcRenderer.invoke("save-project", projectData, filePath),
  loadProject: (filePath) => import_electron.ipcRenderer.invoke("load-project", filePath),
  cdpSendCommand: (method, params) => import_electron.ipcRenderer.invoke("cdp:sendCommand", method, params),
  cdpCaptureScreenshot: () => import_electron.ipcRenderer.invoke("cdp:captureScreenshot"),
  loadGuestURL: (url) => import_electron.ipcRenderer.invoke("guest:loadURL", url),
  setGuestBounds: (bounds) => import_electron.ipcRenderer.invoke("guest:setBounds", bounds),
  toggleDevTools: () => import_electron.ipcRenderer.invoke("guest:toggleDevTools"),
  applyLiveStyle: (styles) => import_electron.ipcRenderer.invoke("guest:applyStyle", styles),
  selectElementById: (domId) => import_electron.ipcRenderer.invoke("guest:selectById", domId),
  toggleElementVisibility: (domId) => import_electron.ipcRenderer.invoke("guest:toggleVisibility", domId),
  setInspectMode: (active) => import_electron.ipcRenderer.invoke("guest:setInspectMode", active),
  setTextContent: (text) => import_electron.ipcRenderer.invoke("guest:setTextContent", text),
  scanWorkspace: (rootPath) => import_electron.ipcRenderer.invoke("fs:scanWorkspace", rootPath),
  readFile: (filePath, workspaceRoot) => import_electron.ipcRenderer.invoke("fs:readFile", filePath, workspaceRoot),
  writeFile: (filePath, content, workspaceRoot) => import_electron.ipcRenderer.invoke("fs:writeFile", filePath, content, workspaceRoot),
  fsReadFile: (filePath, workspaceRoot) => import_electron.ipcRenderer.invoke("fs:readFile", filePath, workspaceRoot),
  fsWriteFile: (filePath, content, workspaceRoot) => import_electron.ipcRenderer.invoke("fs:writeFile", filePath, content, workspaceRoot),
  openFileDialog: () => import_electron.ipcRenderer.invoke("dialog:openFile"),
  openDirectoryDialog: () => import_electron.ipcRenderer.invoke("dialog:openDirectory"),
  getInitialWorkspace: () => import_electron.ipcRenderer.invoke("workspace:getInitial"),
  onDomTree: (callback) => {
    const handler = (_, tree) => callback(tree);
    import_electron.ipcRenderer.on("astrolabe:domTree", handler);
    return () => import_electron.ipcRenderer.removeListener("astrolabe:domTree", handler);
  },
  onElementSelected: (callback) => {
    const handler = (_, data) => callback(data);
    import_electron.ipcRenderer.on("astrolabe:elementSelected", handler);
    return () => import_electron.ipcRenderer.removeListener("astrolabe:elementSelected", handler);
  },
  onTextChanged: (callback) => {
    const handler = (_, data) => callback(data);
    import_electron.ipcRenderer.on("astrolabe:textChanged", handler);
    return () => import_electron.ipcRenderer.removeListener("astrolabe:textChanged", handler);
  },
  onPageNavigated: (callback) => {
    const handler = (_, data) => callback(data);
    import_electron.ipcRenderer.on("astrolabe:pageNavigated", handler);
    return () => import_electron.ipcRenderer.removeListener("astrolabe:pageNavigated", handler);
  }
});
