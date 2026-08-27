/**
 * MotionStudioPanelWindow.ts — Independent Premium Frosted Glass Webview Window
 *
 * Opens an independent, high-aesthetic dark frosted glass Motion Studio window beside the editor.
 * Features ultra-premium glassmorphism UI, specular reflections, timeline visualizer, and live compile controls.
 */

import * as vscode from 'vscode';
import { MotionCompiler } from './MotionCompiler';
import { MotionOnboarding } from './MotionOnboarding';
import { IBrainCoordinator } from '../types/shared';

export class MotionStudioPanelWindow {
  public static currentPanel: MotionStudioPanelWindow | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];
  private _brainCoordinator?: IBrainCoordinator;

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, brainCoordinator?: IBrainCoordinator) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._brainCoordinator = brainCoordinator;

    // Set webview content
    this._panel.webview.html = this._getHtmlForWebview();

    // Listen for messages from the webview window
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'compileMotion':
            await MotionCompiler.getInstance().compileAndApply(
              vscode.window.activeTextEditor?.document.uri,
              message.rawTheatreJson,
              this._brainCoordinator
            );
            this.updateStatus();
            break;
          case 'scaffoldScene':
            await MotionOnboarding.runOnboardingFlow({
              hasTheatreCore: true,
              hasTheatreR3f: true,
              hasGsap: true,
              r3fCanvasFiles: [],
              isReady: false
            });
            this.updateStatus();
            break;
          case 'undoCompile':
            await vscode.commands.executeCommand('undo');
            vscode.window.showInformationMessage('↩️ Reverted compiled motion edit.');
            break;
          case 'redoCompile':
            await vscode.commands.executeCommand('redo');
            vscode.window.showInformationMessage('↪️ Redid compiled motion edit.');
            break;
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this.updateStatus();
  }

  public static createOrShow(extensionUri: vscode.Uri, brainCoordinator?: IBrainCoordinator) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (MotionStudioPanelWindow.currentPanel) {
      MotionStudioPanelWindow.currentPanel._panel.reveal(column || vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'astrolabeMotionStudio',
      'Astrolabe Motion Studio 🎬',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media'), vscode.Uri.joinPath(extensionUri, 'dist')]
      }
    );

    MotionStudioPanelWindow.currentPanel = new MotionStudioPanelWindow(panel, extensionUri, brainCoordinator);
  }

  public async updateStatus() {
    const status = await MotionOnboarding.inspectWorkspace(this._brainCoordinator);
    this._panel.webview.postMessage({
      type: 'STATUS_UPDATE',
      status
    });
  }

  public dispose() {
    MotionStudioPanelWindow.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Astrolabe Motion Studio</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-pitch: #07070a;
      --glass-bg: rgba(18, 18, 26, 0.7);
      --glass-border: rgba(255, 255, 255, 0.08);
      --glass-reflection: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.01) 50%, rgba(0, 0, 0, 0) 100%);
      --accent-neon: #7c3aed;
      --accent-glow: rgba(124, 58, 237, 0.35);
      --emerald-neon: #10b981;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }

    body {
      background-color: var(--bg-pitch);
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(124, 58, 237, 0.15) 0%, transparent 45%),
        radial-gradient(circle at 85% 85%, rgba(16, 185, 129, 0.08) 0%, transparent 45%);
      color: var(--text-main);
      font-family: 'Outfit', sans-serif;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 24px;
    }

    /* Black Frosted Glass Container */
    .glass-card {
      background: var(--glass-bg);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid var(--glass-border);
      border-radius: 16px;
      position: relative;
      overflow: hidden;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    /* Specular Light Reflection Overlay */
    .glass-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 100%;
      background: var(--glass-reflection);
      pointer-events: none;
      opacity: 0.7;
    }

    /* Header Bar */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 24px;
      margin-bottom: 20px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, #7c3aed, #4c1d95);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 0 20px var(--accent-glow);
    }

    .brand-title h1 {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.3px;
    }

    .brand-title p {
      font-size: 12px;
      color: var(--text-muted);
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-radius: 20px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.2);
      font-size: 12px;
      color: var(--emerald-neon);
      font-weight: 500;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald-neon);
      box-shadow: 0 0 10px var(--emerald-neon);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Main Grid Layout */
    .main-grid {
      display: grid;
      grid-template-columns: 1fr 340px;
      gap: 20px;
      flex: 1;
      min-height: 0;
    }

    /* Timeline Visualizer Deck */
    .timeline-deck {
      padding: 24px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .deck-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .deck-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .timeline-scrubber {
      height: 120px;
      background: rgba(0, 0, 0, 0.4);
      border-radius: 12px;
      border: 1px solid var(--glass-border);
      position: relative;
      display: flex;
      align-items: center;
      padding: 0 20px;
      margin: 20px 0;
    }

    .keyframe-node {
      width: 14px;
      height: 14px;
      background: var(--accent-neon);
      transform: rotate(45deg);
      position: absolute;
      box-shadow: 0 0 12px var(--accent-neon);
      cursor: pointer;
      transition: transform 0.2s;
    }

    .keyframe-node:hover {
      transform: rotate(45deg) scale(1.3);
    }

    .playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      background: #ef4444;
      left: 35%;
      box-shadow: 0 0 10px #ef4444;
    }

    .control-bar {
      display: flex;
      gap: 12px;
    }

    /* Action Deck Panel */
    .action-panel {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .btn-primary {
      background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
      color: #fff;
      border: none;
      padding: 14px 20px;
      border-radius: 12px;
      font-family: 'Outfit', sans-serif;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      box-shadow: 0 8px 25px var(--accent-glow);
      transition: all 0.2s ease;
      position: relative;
      overflow: hidden;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 12px 30px var(--accent-glow);
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.04);
      color: var(--text-main);
      border: 1px solid var(--glass-border);
      padding: 12px 16px;
      border-radius: 10px;
      font-family: 'Outfit', sans-serif;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }

    .btn-secondary:hover {
      background: rgba(255, 255, 255, 0.08);
      border-color: rgba(255, 255, 255, 0.2);
    }

    .history-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .code-preview {
      background: rgba(0, 0, 0, 0.5);
      border-radius: 10px;
      padding: 14px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: #a7f3d0;
      line-height: 1.5;
      overflow-x: auto;
      border: 1px solid var(--glass-border);
      flex: 1;
    }
  </style>
</head>
<body>

  <!-- Header Bar -->
  <header class="glass-card">
    <div class="brand">
      <div class="brand-icon">🎬</div>
      <div class="brand-title">
        <h1>Astrolabe Motion Studio</h1>
        <p>Deterministic Visual R3F & GSAP Compiler</p>
      </div>
    </div>
    <div class="status-pill">
      <div class="status-dot"></div>
      <span id="engineStatusText">Brain Indexer & Worker Ready</span>
    </div>
  </header>

  <!-- Main Grid -->
  <div class="main-grid">

    <!-- Left: Timeline Visualizer Deck -->
    <div class="glass-card timeline-deck">
      <div class="deck-header">
        <span class="deck-title">Choreography Timeline</span>
        <span style="font-size: 12px; color: var(--text-muted);">Scene: <code style="color: #a7f3d0;">mainScene</code></span>
      </div>

      <!-- Scrubber -->
      <div class="timeline-scrubber">
        <div class="playhead"></div>
        <div class="keyframe-node" style="left: 10%;" title="Keyframe 1: Position [0,0,0]"></div>
        <div class="keyframe-node" style="left: 35%;" title="Keyframe 2: Position [2,3,-1]"></div>
        <div class="keyframe-node" style="left: 70%;" title="Keyframe 3: Rotation [0, PI, 0]"></div>
      </div>

      <!-- Code Preview Snippet -->
      <div class="code-preview">
// @astrolabe-motion scene: mainScene
useGSAP(() => {
  gsap.registerPlugin(ScrollTrigger);
  const tl = gsap.timeline({ scrollTrigger: { trigger: "#mainScene-container", scrub: true } });
  tl.to(meshRef.current.position, { value: [2, 3, -1], duration: 1.5, ease: "power2.inOut" });
  return () => { ScrollTrigger.getAll().forEach(t => t.kill()); tl.kill(); };
}, []);
      </div>
    </div>

    <!-- Right: Action Panel -->
    <div class="glass-card action-panel">
      <span class="deck-title">Compile Controls</span>

      <button class="btn-primary" id="btnCompile">
        <span>⚡</span> Compile Motion to TSX
      </button>

      <div class="history-row">
        <button class="btn-secondary" id="btnUndo">
          <span>↩️</span> Undo
        </button>
        <button class="btn-secondary" id="btnRedo">
          <span>↪️</span> Redo
        </button>
      </div>

      <button class="btn-secondary" id="btnScaffold" style="margin-top: auto;">
        <span>✨</span> Scaffold 3D Scene (.tsx)
      </button>
    </div>

  </div>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btnCompile').addEventListener('click', () => {
      vscode.postMessage({ command: 'compileMotion' });
    });

    document.getElementById('btnUndo').addEventListener('click', () => {
      vscode.postMessage({ command: 'undoCompile' });
    });

    document.getElementById('btnRedo').addEventListener('click', () => {
      vscode.postMessage({ command: 'redoCompile' });
    });

    document.getElementById('btnScaffold').addEventListener('click', () => {
      vscode.postMessage({ command: 'scaffoldScene' });
    });

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'STATUS_UPDATE') {
        const statusText = document.getElementById('engineStatusText');
        if (statusText) {
          statusText.innerText = message.status.isReady ? 'Engine & Canvas Ready' : 'Ready (No Canvas in Active File)';
        }
      }
    });
  </script>
</body>
</html>`;
  }
}
