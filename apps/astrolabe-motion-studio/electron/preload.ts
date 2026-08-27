import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  saveProject: (projectData: string, filePath?: string) => ipcRenderer.invoke('save-project', projectData, filePath),
  loadProject: (filePath: string) => ipcRenderer.invoke('load-project', filePath),
  cdpSendCommand: (method: string, params?: any) => ipcRenderer.invoke('cdp:sendCommand', method, params),
  cdpCaptureScreenshot: () => ipcRenderer.invoke('cdp:captureScreenshot'),
  loadGuestURL: (url: string) => ipcRenderer.invoke('guest:loadURL', url),
  setGuestBounds: (bounds: { x: number; y: number; width: number; height: number }) => ipcRenderer.invoke('guest:setBounds', bounds),
  toggleDevTools: () => ipcRenderer.invoke('guest:toggleDevTools'),
  applyLiveStyle: (styles: Record<string, string>) => ipcRenderer.invoke('guest:applyStyle', styles),
  selectElementById: (domId: string) => ipcRenderer.invoke('guest:selectById', domId),
  toggleElementVisibility: (domId: string) => ipcRenderer.invoke('guest:toggleVisibility', domId),
  setInspectMode: (active: boolean) => ipcRenderer.invoke('guest:setInspectMode', active),
  setTextContent: (text: string) => ipcRenderer.invoke('guest:setTextContent', text),
  scanWorkspace: (rootPath: string) => ipcRenderer.invoke('fs:scanWorkspace', rootPath),
  readFile: (filePath: string, workspaceRoot?: string) => ipcRenderer.invoke('fs:readFile', filePath, workspaceRoot),
  writeFile: (filePath: string, content: string, workspaceRoot?: string) => ipcRenderer.invoke('fs:writeFile', filePath, content, workspaceRoot),
  fsReadFile: (filePath: string, workspaceRoot?: string) => ipcRenderer.invoke('fs:readFile', filePath, workspaceRoot),
  fsWriteFile: (filePath: string, content: string, workspaceRoot?: string) => ipcRenderer.invoke('fs:writeFile', filePath, content, workspaceRoot),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: () => ipcRenderer.invoke('dialog:openDirectory'),
  getInitialWorkspace: () => ipcRenderer.invoke('workspace:getInitial'),
  onDomTree: (callback: (tree: any) => void) => {
    const handler = (_: any, tree: any) => callback(tree);
    ipcRenderer.on('astrolabe:domTree', handler);
    return () => ipcRenderer.removeListener('astrolabe:domTree', handler);
  },
  onElementSelected: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('astrolabe:elementSelected', handler);
    return () => ipcRenderer.removeListener('astrolabe:elementSelected', handler);
  },
  onTextChanged: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('astrolabe:textChanged', handler);
    return () => ipcRenderer.removeListener('astrolabe:textChanged', handler);
  },
  onPageNavigated: (callback: (data: { url: string; pathname: string; hostname: string; port: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('astrolabe:pageNavigated', handler);
    return () => ipcRenderer.removeListener('astrolabe:pageNavigated', handler);
  }
});
