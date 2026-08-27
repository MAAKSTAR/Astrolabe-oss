import { app, BrowserWindow, BrowserView, ipcMain, session, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { GUEST_INSPECTOR_SCRIPT } from '../src/core/GuestInspectorScript';

let mainWindow: BrowserWindow | null = null;
let guestView: BrowserView | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Astrolabe Motion Studio',
    backgroundColor: '#07070a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#07070a',
      symbolColor: '#f3f4f6',
      height: 38
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: true
    }
  });

  guestView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: true
    }
  });

  mainWindow.addBrowserView(guestView);

  // Position guestView inside center area by default
  const updateInitialBounds = () => {
    if (!mainWindow || !guestView) return;
    const [contentWidth, contentHeight] = mainWindow.getContentSize();
    // Default center bounds: left 240px, right 300px, top 96px, bottom 180px
    const x = 240;
    const y = 96;
    const width = Math.max(100, contentWidth - 240 - 300);
    const height = Math.max(100, contentHeight - 96 - 180);
    guestView.setBounds({ x, y, width, height });
  };

  mainWindow.on('resize', updateInitialBounds);
  mainWindow.once('ready-to-show', updateInitialBounds);

  const distIndexPath = path.join(__dirname, '../dist/index.html');
  if (fs.existsSync(distIndexPath)) {
    mainWindow.loadFile(distIndexPath);
  } else {
    mainWindow.loadURL('http://localhost:47998');
  }

  guestView.webContents.on('did-finish-load', () => {
    try {
      if (!guestView?.webContents.debugger.isAttached()) {
        guestView?.webContents.debugger.attach('1.3');
      }
    } catch (err) {
      console.warn('Debugger attach failed:', err);
    }
    // Inject Astrolabe Visual Inspector script into the guest website
    if (guestView && !guestView.webContents.isDestroyed()) {
      guestView.webContents.executeJavaScript(GUEST_INSPECTOR_SCRIPT).catch(() => {});
    }
  });

  // Track page navigation to auto-detect routes and page files
  const notifyPageNavigated = (url: string) => {
    try {
      const parsedUrl = new URL(url);
      mainWindow?.webContents.send('astrolabe:pageNavigated', {
        url,
        pathname: parsedUrl.pathname,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port
      });
    } catch (e) {}
  };

  guestView.webContents.on('did-navigate', (_, url) => notifyPageNavigated(url));
  guestView.webContents.on('did-navigate-in-page', (_, url) => notifyPageNavigated(url));

  // Listen to messages from guest inspector
  guestView.webContents.on('console-message', (_, level, message) => {
    if (message.startsWith('__ASTROLABE_DOM_TREE__:')) {
      try {
        const tree = JSON.parse(message.replace('__ASTROLABE_DOM_TREE__:', ''));
        mainWindow?.webContents.send('astrolabe:domTree', tree);
      } catch (err) {}
    } else if (message.startsWith('__ASTROLABE_SELECTED__:')) {
      try {
        const payload = JSON.parse(message.replace('__ASTROLABE_SELECTED__:', ''));
        mainWindow?.webContents.send('astrolabe:elementSelected', payload);
      } catch (err) {}
    } else if (message.startsWith('__ASTROLABE_TEXT_CHANGED__:')) {
      try {
        const payload = JSON.parse(message.replace('__ASTROLABE_TEXT_CHANGED__:', ''));
        mainWindow?.webContents.send('astrolabe:textChanged', payload);
      } catch (err) {}
    }
  });

  // Right-click to inspect element in Chrome DevTools
  guestView.webContents.on('context-menu', (_, params) => {
    if (guestView && !guestView.webContents.isDestroyed()) {
      guestView.webContents.inspectElement(params.x, params.y);
      if (!guestView.webContents.isDevToolsOpened()) {
        guestView.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });

  // F12 or Ctrl+Shift+I to toggle DevTools
  mainWindow.webContents.on('before-input-event', (_, input) => {
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      if (guestView && !guestView.webContents.isDestroyed()) {
        if (guestView.webContents.isDevToolsOpened()) {
          guestView.webContents.closeDevTools();
        } else {
          guestView.webContents.openDevTools({ mode: 'detach' });
        }
      }
    }
  });

  guestView.webContents.debugger.on('detach', (event, reason) => {
    console.log('Debugger detached:', reason);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    guestView = null;
  });
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    
    const lowerCaseHeaders = Object.keys(responseHeaders).reduce((acc, key) => {
      acc[key.toLowerCase()] = key;
      return acc;
    }, {} as Record<string, string>);

    if (lowerCaseHeaders['content-security-policy']) {
      delete responseHeaders[lowerCaseHeaders['content-security-policy']];
    }
    if (lowerCaseHeaders['x-frame-options']) {
      delete responseHeaders[lowerCaseHeaders['x-frame-options']];
    }

    callback({
      cancel: false,
      responseHeaders
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handlers
ipcMain.handle('save-project', async (_, projectData: string, filePath?: string) => {
  try {
    const targetPath = filePath || path.join(app.getPath('documents'), 'scene.astrolabe');
    await fs.promises.writeFile(targetPath, projectData, 'utf-8');
    return { success: true, filePath: targetPath };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('load-project', async (_, filePath: string) => {
  try {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    return { success: true, data: JSON.parse(data) };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// File System IPC Handlers
async function walkDirectory(dir: string, fileList: string[] = []): Promise<string[]> {
  const files = await fs.promises.readdir(dir, { withFileTypes: true });
  for (const file of files) {
    if (file.name === 'node_modules' || file.name === '.git' || file.name === 'dist' || file.name === '.next') {
      continue;
    }
    const filePath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await walkDirectory(filePath, fileList);
    } else {
      const ext = path.extname(file.name).toLowerCase();
      if (['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.css'].includes(ext)) {
        fileList.push(filePath);
      }
    }
  }
  return fileList;
}

ipcMain.handle('fs:scanWorkspace', async (_, rootPath: string) => {
  try {
    const files = await walkDirectory(rootPath);
    return { success: true, files };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string, workspaceRoot?: string) => {
  try {
    let targetPath = filePath;
    if (workspaceRoot && !path.isAbsolute(filePath)) {
      targetPath = path.join(workspaceRoot, filePath);
    }
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
    await fs.promises.writeFile(targetPath, content, 'utf-8');
    return { success: true, filePath: targetPath };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('fs:readFile', async (_, filePath: string, workspaceRoot?: string) => {
  try {
    let targetPath = filePath;
    if (workspaceRoot && !path.isAbsolute(filePath)) {
      targetPath = path.join(workspaceRoot, filePath);
    }
    const data = await fs.promises.readFile(targetPath, 'utf-8');
    return { success: true, data, filePath: targetPath };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
});

// Dialog IPC Handlers
ipcMain.handle('dialog:openFile', async () => {
  if (!mainWindow) return { success: false, error: 'No main window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select React / Component File to Edit',
    properties: ['openFile'],
    filters: [
      { name: 'Component Files', extensions: ['tsx', 'jsx', 'ts', 'js', 'vue', 'svelte', 'html', 'css'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, filePath: result.filePaths[0] };
  }
  return { success: false, canceled: true };
});

ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return { success: false, error: 'No main window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Project Root Workspace Folder',
    properties: ['openDirectory']
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, folderPath: result.filePaths[0] };
  }
  return { success: false, canceled: true };
});

// Auto-detect initial workspace from CLI flags, environment variables, or launch directory
ipcMain.handle('workspace:getInitial', async () => {
  try {
    let wsRoot: string | null = null;
    let initialActiveFile: string | null = null;

    // 1. Check CLI args: --workspace=/path, --project-dir=/path, --active-file=/path
    for (const arg of process.argv) {
      if (arg.startsWith('--workspace=')) {
        const ws = arg.replace('--workspace=', '').trim();
        if (ws && fs.existsSync(ws)) {
          wsRoot = ws;
        }
      }
      if (arg.startsWith('--project-dir=')) {
        const ws = arg.replace('--project-dir=', '').trim();
        if (ws && fs.existsSync(ws)) {
          wsRoot = ws;
        }
      }
      if (arg.startsWith('--active-file=')) {
        const af = arg.replace('--active-file=', '').trim();
        if (af) {
          initialActiveFile = af;
        }
      }
    }

    // 2. Check environment variables passed by Astrolabe IDE / VS Code extension
    if (!wsRoot) {
      const envWorkspace = process.env.ASTROLABE_WORKSPACE || process.env.PROJECT_ROOT || process.env.VSCODE_WORKSPACE;
      if (envWorkspace && fs.existsSync(envWorkspace)) {
        wsRoot = envWorkspace;
      }
    }

    if (!initialActiveFile && process.env.ASTROLABE_ACTIVE_FILE) {
      initialActiveFile = process.env.ASTROLABE_ACTIVE_FILE;
    }

    // 3. Fallback: check parent directory of the studio (e.g. /home/maakstar/EXOVON_ECOSYSTEM)
    if (!wsRoot) {
      const parentDir = path.resolve(app.getAppPath(), '..');
      if (fs.existsSync(parentDir)) {
        const entries = fs.readdirSync(parentDir);
        if (entries.includes('package.json') || entries.includes('src') || entries.some(e => e !== 'astrolabe-motion-studio' && fs.statSync(path.join(parentDir, e)).isDirectory())) {
          wsRoot = parentDir;
        }
      }
    }

    return { success: true, workspaceRoot: wsRoot, activeFile: initialActiveFile };
  } catch (err: any) {
    console.warn('Auto-detect workspace error:', err);
  }
  return { success: false, workspaceRoot: null, activeFile: null };
});

// CDP IPC Handlers
ipcMain.handle('cdp:sendCommand', async (_, method: string, commandParams?: any) => {
  if (!guestView) throw new Error('Guest view not ready');
  return guestView.webContents.debugger.sendCommand(method, commandParams);
});

ipcMain.handle('cdp:captureScreenshot', async () => {
  if (!guestView) throw new Error('Guest view not ready');
  return guestView.webContents.debugger.sendCommand('Page.captureScreenshot');
});

let currentLoadingUrl = '';

// Allow loading a URL in the guest view
ipcMain.handle('guest:loadURL', async (_, url: string) => {
  if (!guestView || !url) return { success: false, error: 'guestView not available' };
  
  if (guestView.webContents.getURL() === url || currentLoadingUrl === url) {
    return { success: true };
  }

  currentLoadingUrl = url;
  try {
    console.log('Loading guest URL:', url);
    await guestView.webContents.loadURL(url);
    currentLoadingUrl = '';
    return { success: true };
  } catch (e: any) {
    currentLoadingUrl = '';
    // If navigation was simply superseded or aborted, do not treat as fatal error
    if (e.code === 'ERR_ABORTED' || e.errno === -3 || e.message?.includes('ERR_ABORTED')) {
      return { success: false, error: 'Navigation aborted' };
    }

    console.warn('Failed to load guest URL:', e.message);
    const errorHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              background: #07070b;
              color: #f3f4f6;
              font-family: system-ui, -apple-system, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              text-align: center;
              overflow: hidden;
            }
            .card {
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 14px;
              padding: 36px 48px;
              max-width: 460px;
              box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
              backdrop-filter: blur(20px);
            }
            .icon {
              font-size: 32px;
              margin-bottom: 12px;
            }
            h2 { margin: 0 0 10px; font-size: 17px; color: #a78bfa; font-weight: 600; }
            p { margin: 0 0 14px; font-size: 12px; color: #9ca3af; line-height: 1.6; }
            code { background: rgba(0,0,0,0.5); padding: 3px 8px; border-radius: 5px; color: #38bdf8; font-family: monospace; font-size: 11px; }
            .badge { display: inline-block; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 20px; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
            .btn-demo {
              margin-top: 14px;
              background: rgba(139, 92, 246, 0.2);
              border: 1px solid rgba(139, 92, 246, 0.5);
              color: #c4b5fd;
              padding: 6px 14px;
              border-radius: 6px;
              font-size: 11px;
              font-weight: 500;
              cursor: pointer;
              text-decoration: none;
              display: inline-block;
              transition: all 0.2s ease;
            }
            .btn-demo:hover {
              background: rgba(139, 92, 246, 0.4);
              color: #ffffff;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="icon">🌐</div>
            <div class="badge">${e.code || 'NO DEV SERVER RUNNING'}</div>
            <h2>Target Server Not Found</h2>
            <p>Astrolabe Motion Studio attempted to connect to <code>${url}</code>, but no web server is running on that port.</p>
            <p><strong>To connect your live site:</strong><br/>Run your dev server or enter an active URL above.</p>
          </div>
        </body>
      </html>
    `;
    try {
      if (!guestView.webContents.isDestroyed()) {
        guestView.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorHtml)}`);
      }
    } catch {}
    return { success: false, error: e.message };
  }
});

// Set guest view bounds dynamically from React viewport
ipcMain.handle('guest:setBounds', (_, bounds: { x: number; y: number; width: number; height: number }) => {
  if (guestView && mainWindow && !guestView.webContents.isDestroyed()) {
    guestView.setBounds(bounds);
  }
});

// Toggle Chrome DevTools for the guest website
ipcMain.handle('guest:toggleDevTools', () => {
  if (guestView && !guestView.webContents.isDestroyed()) {
    if (guestView.webContents.isDevToolsOpened()) {
      guestView.webContents.closeDevTools();
    } else {
      guestView.webContents.openDevTools({ mode: 'detach' });
    }
  }
});

// Apply live CSS styles to selected element in guest view
ipcMain.handle('guest:applyStyle', (_, styles: Record<string, string>) => {
  if (guestView && !guestView.webContents.isDestroyed()) {
    guestView.webContents.executeJavaScript(`window.__astrolabeApplyStyle && window.__astrolabeApplyStyle(${JSON.stringify(styles)})`).catch(() => {});
  }
});

// Select element by ID from Layers Panel
ipcMain.handle('guest:selectById', (_, domId: string) => {
  if (guestView && !guestView.webContents.isDestroyed()) {
    guestView.webContents.executeJavaScript(`window.__astrolabeSelectById && window.__astrolabeSelectById(${JSON.stringify(domId)})`).catch(() => {});
  }
});

// Toggle element visibility from Layers Panel
ipcMain.handle('guest:toggleVisibility', (_, domId: string) => {
  if (guestView && !guestView.webContents.isDestroyed()) {
    guestView.webContents.executeJavaScript(`window.__astrolabeToggleVisibility && window.__astrolabeToggleVisibility(${JSON.stringify(domId)})`).catch(() => {});
  }
});

// Set Inspect Mode ON/OFF in guest view
ipcMain.handle('guest:setInspectMode', (_, active: boolean) => {
  if (guestView && !guestView.webContents.isDestroyed()) {
    guestView.webContents.executeJavaScript(`window.__astrolabeSetInspectMode && window.__astrolabeSetInspectMode(${JSON.stringify(active)})`).catch(() => {});
  }
});

// Update textContent of selected element in guest view
ipcMain.handle('guest:setTextContent', (_, text: string) => {
  if (guestView && !guestView.webContents.isDestroyed()) {
    guestView.webContents.executeJavaScript(`window.__astrolabeSetTextContent && window.__astrolabeSetTextContent(${JSON.stringify(text)})`).catch(() => {});
  }
});
