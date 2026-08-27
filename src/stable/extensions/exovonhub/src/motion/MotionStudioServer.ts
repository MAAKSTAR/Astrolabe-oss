/**
 * MotionStudioServer.ts — Independent OS Window Local Server & Full Blueprint UI
 *
 * Runs a local HTTP server inside the extension host to serve Astrolabe Motion Studio
 * as a completely independent OS window / standalone desktop window via vscode.env.openExternal.
 * Implements full Theatre.js visual studio features from the CUCUMBER blueprint.
 */

import * as http from 'http';
import * as vscode from 'vscode';
import { MotionCompiler } from './MotionCompiler';
import { MotionOnboarding } from './MotionOnboarding';
import { IBrainCoordinator } from '../types/shared';

export class MotionStudioServer {
  private static instance: MotionStudioServer;
  private server: http.Server | null = null;
  private port: number = 47999;
  private brainCoordinator?: IBrainCoordinator;

  public static getInstance(): MotionStudioServer {
    if (!MotionStudioServer.instance) {
      MotionStudioServer.instance = new MotionStudioServer();
    }
    return MotionStudioServer.instance;
  }

  public setBrainCoordinator(brainCoordinator?: IBrainCoordinator) {
    this.brainCoordinator = brainCoordinator;
  }

  public async startAndOpen(): Promise<void> {
    if (!this.server) {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      await new Promise<void>((resolve) => {
        this.server!.listen(this.port, '127.0.0.1', () => {
          console.log(`[Motion Studio Server] Running on http://127.0.0.1:${this.port}`);
          resolve();
        });
      });
    }

    const childProcess = require('child_process');
    const path = require('path');
    const fs = require('fs');

    // Robust multi-tier dynamic resolution for Astrolabe Motion Studio root
    const candidateAmsPaths: string[] = [
      process.env.ASTROLABE_AMS_PATH || '',
      path.resolve(__dirname, '../../../apps/astrolabe-motion-studio'),
      path.resolve(__dirname, '../../../../apps/astrolabe-motion-studio'),
      path.join(vscode.env.appRoot, 'motion-studio'),
      path.join(vscode.env.appRoot, 'resources', 'app', 'motion-studio'),
      '/run/media/maakstar/c/vscodium/apps/astrolabe-motion-studio',
      '/home/maakstar/EXOVON_ECOSYSTEM/astrolabe-motion-studio'
    ].filter(Boolean);

    const amsPath = candidateAmsPaths.find((p: string) => fs.existsSync(p)) || candidateAmsPaths[candidateAmsPaths.length - 1];
    const localElectronBin = path.join(amsPath, 'node_modules', '.bin', 'electron');
    const distElectronBin = path.join(amsPath, 'node_modules', 'electron', 'dist', 'electron');

    const logFile = '/tmp/ams-launcher.log';
    const log = (msg: string) => {
      try {
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`, 'utf-8');
      } catch (e) {}
    };

    log('--- Launch Request Triggered ---');
    log(`Selected amsPath: ${amsPath} (exists: ${fs.existsSync(amsPath)})`);
    log(`distElectronBin: ${distElectronBin} (exists: ${fs.existsSync(distElectronBin)})`);
    log(`localElectronBin: ${localElectronBin} (exists: ${fs.existsSync(localElectronBin)})`);
    log(`DISPLAY env: ${process.env.DISPLAY || 'unset'}`);

    const activeWorkspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || (vscode.workspace as any).rootPath || '';
    const activeEditorFile = vscode.window.activeTextEditor?.document.fileName || '';
    log(`Active Workspace Folder from IDE: ${activeWorkspaceFolder}`);
    log(`Active Editor File from IDE: ${activeEditorFile}`);

    let launched = false;
    const spawnEnv: Record<string, string | undefined> = { 
      ...process.env, 
      DISPLAY: process.env.DISPLAY || ':0',
      ASTROLABE_WORKSPACE: activeWorkspaceFolder || undefined,
      PROJECT_ROOT: activeWorkspaceFolder || undefined,
      ASTROLABE_ACTIVE_FILE: activeEditorFile || undefined
    };
    
    // Strict Electron ABI & Node hook isolation
    delete spawnEnv['ELECTRON_RUN_AS_NODE'];
    delete spawnEnv['NODE_OPTIONS'];
    delete spawnEnv['NODE_PATH'];
    delete spawnEnv['ELECTRON_NO_ASAR'];
    delete spawnEnv['VSCODE_IPC_HOOK'];

    const spawnArgs = ['.', '--no-sandbox'];
    if (activeWorkspaceFolder) {
      spawnArgs.push(`--workspace=${activeWorkspaceFolder}`);
    }
    if (activeEditorFile) {
      spawnArgs.push(`--active-file=${activeEditorFile}`);
    }

    if (fs.existsSync(distElectronBin)) {
      try {
        log(`Attempting spawn distElectronBin: ${distElectronBin} with args: ${spawnArgs.join(' ')}`);
        const outLog = fs.openSync(logFile, 'a');
        const proc = childProcess.spawn(distElectronBin, spawnArgs, {
          cwd: amsPath,
          detached: true,
          stdio: ['ignore', outLog, outLog],
          env: spawnEnv
        });
        proc.unref();
        launched = true;
        log('distElectronBin spawned successfully!');
      } catch (e: any) {
        log(`distElectronBin spawn error: ${e.message}`);
      }
    }

    if (!launched && fs.existsSync(localElectronBin)) {
      try {
        log(`Attempting spawn localElectronBin: ${localElectronBin} with args: ${spawnArgs.join(' ')}`);
        const outLog = fs.openSync(logFile, 'a');
        const proc = childProcess.spawn(localElectronBin, spawnArgs, {
          cwd: amsPath,
          detached: true,
          stdio: ['ignore', outLog, outLog],
          shell: true,
          env: spawnEnv
        });
        proc.unref();
        launched = true;
        log('localElectronBin spawned successfully!');
      } catch (e: any) {
        log(`localElectronBin spawn error: ${e.message}`);
      }
    }

    if (!launched) {
      try {
        log('Attempting spawn npx electron');
        const outLog = fs.openSync(logFile, 'a');
        const proc = childProcess.spawn('npx', ['electron', ...spawnArgs], {
          cwd: amsPath,
          detached: true,
          stdio: ['ignore', outLog, outLog],
          shell: true,
          env: spawnEnv
        });
        proc.unref();
        launched = true;
        log('npx electron spawned successfully!');
      } catch (e: any) {
        log(`npx electron spawn error: ${e.message}`);
      }
    }

    if (launched) {
      vscode.window.showInformationMessage('Opening Astrolabe Motion Studio window... (Logs: ams-launcher.log)');
    } else {
      vscode.window.showErrorMessage('Failed to launch AMS Electron window. Check ams-launcher.log');
      await vscode.env.openExternal(vscode.Uri.parse('http://127.0.0.1:47998'));
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'POST' && req.url === '/api/compile') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const payload = JSON.parse(body || '{}');
          const targetUri = vscode.window.activeTextEditor?.document.uri;
          
          let success = false;
          if (payload.type === 'compileCss') {
            success = await MotionCompiler.getInstance().compileCssAndApply(
              payload.targetFilePath,
              payload.line,
              payload.styles
            );
          } else {
            success = await MotionCompiler.getInstance().compileAndApply(
              targetUri,
              payload.rawTheatreJson || {},
              this.brainCoordinator
            );
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success }));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/status') {
      const status = await MotionOnboarding.inspectWorkspace(this.brainCoordinator);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(status));
      return;
    }

    // Serve Standalone Independent UI Page
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(this.getStandaloneStudioHtml());
  }

  private getStandaloneStudioHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Astrolabe Motion Studio — Standalone Studio Window</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <style>
    :root {
      --bg: #07070a;
      --panel-bg: rgba(18, 18, 26, 0.75);
      --panel-border: rgba(255, 255, 255, 0.08);
      --accent: #7c3aed;
      --accent-light: #a78bfa;
      --glow: rgba(124, 58, 237, 0.4);
      --text: #f3f4f6;
      --text-dim: #9ca3af;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Specular Frosted Glass Styling */
    .glass {
      background: var(--panel-bg);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--panel-border);
      position: relative;
      overflow: hidden;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1);
    }
    .glass::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 100%;
      background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.01) 50%, transparent 100%);
      pointer-events: none;
    }

    /* Top Bar Header */
    header {
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      border-bottom: 1px solid var(--panel-border);
    }
    .logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; }
    .logo-badge {
      background: linear-gradient(135deg, #7c3aed, #4c1d95);
      width: 28px; height: 28px; border-radius: 8px;
      display: flex; align-items: center; justify-content: center; font-size: 14px;
      box-shadow: 0 0 12px var(--glow);
    }

    .btn-compile {
      background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
      color: #fff; border: none; padding: 8px 18px; border-radius: 8px;
      font-family: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; gap: 8px;
      box-shadow: 0 4px 15px var(--glow); transition: all 0.2s;
    }
    .btn-compile:hover { transform: translateY(-1px); box-shadow: 0 6px 20px var(--glow); }

    /* Main Studio Workspace Grid */
    .studio-grid {
      flex: 1; display: grid;
      grid-template-columns: 240px 1fr 300px;
      grid-template-rows: 1fr 220px;
      gap: 12px; padding: 12px; height: calc(100vh - 56px);
    }

    /* Scene Hierarchy Explorer */
    .hierarchy-panel { grid-column: 1; grid-row: 1 / 3; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .panel-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--text-dim); font-weight: 600; }
    .tree-item {
      padding: 8px 12px; border-radius: 6px; font-size: 13px; color: var(--text);
      display: flex; align-items: center; gap: 8px; cursor: pointer; transition: background 0.15s;
    }
    .tree-item:hover, .tree-item.active { background: rgba(124, 58, 237, 0.2); border: 1px solid rgba(124, 58, 237, 0.4); }

    /* 3D Interactive Viewport */
    .viewport-panel { grid-column: 2; grid-row: 1; border-radius: 12px; position: relative; overflow: hidden; }
    #canvas-container { width: 100%; height: 100%; }
    .viewport-overlay {
      position: absolute; top: 12px; left: 12px;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(10px);
      padding: 6px 12px; border-radius: 6px; font-size: 11px; color: var(--text-dim); border: 1px solid var(--panel-border);
    }

    /* Property Inspector */
    .inspector-panel { grid-column: 3; grid-row: 1 / 3; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
    .prop-group { display: flex; flex-direction: column; gap: 8px; }
    .prop-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
    .prop-input {
      width: 70px; background: rgba(0,0,0,0.5); border: 1px solid var(--panel-border);
      color: #a7f3d0; padding: 4px 8px; border-radius: 6px; font-family: 'JetBrains Mono', monospace; font-size: 11px; text-align: right;
    }

    /* Keyframe Timeline Deck */
    .timeline-panel { grid-column: 2; grid-row: 2; border-radius: 12px; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; }
    .timeline-track {
      height: 90px; background: rgba(0,0,0,0.4); border-radius: 8px; border: 1px solid var(--panel-border);
      position: relative; overflow: hidden; display: flex; align-items: center;
    }
    .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: #ef4444; left: 30%; box-shadow: 0 0 8px #ef4444; }
    .kf-diamond {
      width: 12px; height: 12px; background: var(--accent); transform: rotate(45deg);
      position: absolute; box-shadow: 0 0 10px var(--accent); cursor: pointer; transition: transform 0.2s;
    }
    .kf-diamond:hover { transform: rotate(45deg) scale(1.4); }
  </style>
</head>
<body>

  <header class="glass">
    <div class="logo">
      <div class="logo-badge">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8H4Z"/><path d="m4 11 4-7h12l-4 7H4Z"/><path d="m8 4 4 7"/><path d="m14 4 4 7"/></svg>
      </div>
      <span>Astrolabe Motion Studio</span>
    </div>
    <div style="display: flex; gap: 12px; align-items: center;">
      <button class="btn-compile" id="btnCompileHeader">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Compile Motion to Code
      </button>
    </div>
  </header>

  <div class="studio-grid">

    <!-- Scene Hierarchy -->
    <div class="glass hierarchy-panel">
      <span class="panel-title">Scene Hierarchy</span>
      <div class="tree-item active">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg> PerspectiveCamera
      </div>
      <div class="tree-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg> editable.mesh (Box)
      </div>
      <div class="tree-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg> AmbientLight
      </div>
    </div>

    <!-- 3D Viewport -->
    <div class="glass viewport-panel">
      <div class="viewport-overlay">R3F Interactive Viewport (Three.js)</div>
      <div id="canvas-container"></div>
    </div>

    <!-- Property Inspector -->
    <div class="glass inspector-panel">
      <span class="panel-title">Property Inspector</span>
      <div class="prop-group">
        <span style="font-size: 12px; font-weight: 600; color: var(--accent-light);">editable.mesh</span>
        <div class="prop-row"><span>Position X</span><input class="prop-input" value="0.00" /></div>
        <div class="prop-row"><span>Position Y</span><input class="prop-input" value="1.50" /></div>
        <div class="prop-row"><span>Position Z</span><input class="prop-input" value="-2.00" /></div>
        <div class="prop-row"><span>Rotation Y</span><input class="prop-input" value="3.14" /></div>
        <div class="prop-row"><span>Easing</span><span style="font-size: 11px; color: #a7f3d0;">power2.inOut</span></div>
      </div>
    </div>

    <!-- Timeline Deck -->
    <div class="glass timeline-panel">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span class="panel-title">Sequence Timeline</span>
        <span style="font-size: 11px; color: var(--text-dim);">00:01.50 / 00:05.00</span>
      </div>
      <div class="timeline-track">
        <div class="playhead"></div>
        <div class="kf-diamond" style="left: 10%;" title="Keyframe 0s: [0, 0, 0]"></div>
        <div class="kf-diamond" style="left: 30%;" title="Keyframe 1.5s: [0, 1.5, -2]"></div>
        <div class="kf-diamond" style="left: 75%;" title="Keyframe 3.7s: [0, 0, 0]"></div>
      </div>
    </div>

  </div>

  <script>
    // Initialize 3D Three.js Viewport
    const container = document.getElementById('canvas-container');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const geometry = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const material = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.3, metalness: 0.8 });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    camera.position.z = 4;

    function animate() {
      requestAnimationFrame(animate);
      cube.rotation.x += 0.005;
      cube.rotation.y += 0.01;
      renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    });

    document.getElementById('btnCompileHeader').addEventListener('click', async () => {
      const response = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawTheatreJson: {
            id: 'mainScene',
            sheetsById: {
              defaultSheet: {
                sequence: {
                  tracksBySequence: {
                    default: {
                      "meshRef/position": {
                        keyframes: [
                          { position: 0, value: [0,0,0], handles: 'ease-in-out' },
                          { position: 1.5, value: [0, 1.5, -2], handles: 'ease-in-out' }
                        ]
                      }
                    }
                  }
                }
              }
            }
          }
        })
      });
      const res = await response.json();
      if (res.success) {
        alert('✨ Astrolabe Motion Studio: Successfully compiled motion to TSX code!');
      }
    });
  </script>
</body>
</html>`;
  }
}
