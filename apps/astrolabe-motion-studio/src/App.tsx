import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './styles/theme.css';
import { Viewport3D } from './viewport/Viewport3D';
import { SceneHierarchy } from './panels/SceneHierarchy';
import { LayersPanel } from './panels/LayersPanel';
import { LiveCodePanel } from './panels/LiveCodePanel';
import { PropertyInspector } from './panels/PropertyInspector';
import { TimelinePanel } from './timeline/TimelinePanel';
import { useSceneStore } from './core/SceneGraph';
import { BrowserBridge } from './core/BrowserBridge';
import { ASTCompiler, ElementIdentifier } from './core/ASTCompiler';
import { DiffReviewModal } from './panels/DiffReviewModal';
import { WorkspacePanel } from './panels/WorkspacePanel';
import DockLayout, { LayoutData, TabData, TabBase } from 'rc-dock';
import 'rc-dock/dist/rc-dock-dark.css';
import {
  MousePointer,
  Move,
  RotateCw,
  Maximize2,
  Zap,
  Clapperboard,
  FolderOpen,
  FileCode,
  Layers as LayersIcon,
  Box as BoxIcon,
  Code as CodeIcon,
  Save,
  Undo2,
  Redo2,
  Sliders,
  CheckCircle2,
  AlertCircle,
  X,
  Sparkles
} from 'lucide-react';

export interface ToastMessage {
  id: string;
  title: string;
  message?: string;
  type?: 'success' | 'info' | 'warning' | 'error';
  timestamp: number;
}

export function App() {
  const activeTool = useSceneStore((state) => state.activeTool);
  const setTool = useSceneStore((state) => state.setTool);
  const activeProjectFile = useSceneStore((state) => state.activeProjectFile);
  const setActiveProjectFile = useSceneStore((state) => state.setActiveProjectFile);
  const selectedElementPath = useSceneStore((state) => state.selectedElementPath);
  const selectedElementStyles = useSceneStore((state) => state.selectedElementStyles);
  const selectedElementText = useSceneStore((state) => state.selectedElementText);
  const selectedDomId = useSceneStore((state) => state.selectedDomId);
  const scrollPosition = useSceneStore((state) => state.scrollPosition);
  const scrollTracks = useSceneStore((state) => state.scrollTracks);

  const setDomTree = useSceneStore((state) => state.setDomTree);
  const setSelectedElement = useSceneStore((state) => state.setSelectedElement);
  const setSelectedElementText = useSceneStore((state) => state.setSelectedElementText);

  const inspectActive = useSceneStore((state) => state.inspectActive);
  const setInspectActive = useSceneStore((state) => state.setInspectActive);

  const [lastAutoSavedTime, setLastAutoSavedTime] = useState<string>('Just now');
  const [saveStatus, setSaveStatus] = useState<string>('Auto-Save Active');

  // Floating Toast Notification State
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((title: string, message?: string, type: 'success' | 'info' | 'warning' | 'error' = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { id, title, message, type, timestamp: Date.now() }]);
    
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const dockLayoutRef = useRef<DockLayout>(null);

  const [diffModalState, setDiffModalState] = useState<{
    isOpen: boolean;
    filePath: string;
    originalCode: string;
    modifiedCode: string;
    diffSummary: string[];
    elementIdentifier?: any;
    styles?: any;
  }>({
    isOpen: false,
    filePath: '',
    originalCode: '',
    modifiedCode: '',
    diffSummary: []
  });

  // Subscribe to BrowserBridge events
  useEffect(() => {
    const unsubDom = BrowserBridge.onDomTree((tree) => {
      setDomTree(tree);
    });

    const unsubSelected = BrowserBridge.onElementSelected((data) => {
      setSelectedElement(data.bounds, data.pathInfo, data.styles, data.domId, data.text);
      if (data.pathInfo) {
        const f = data.pathInfo.file;
        const comp = data.pathInfo.componentName;
        
        // 1. Direct file path from React Fiber or DOM data attributes
        if (f && (f.startsWith('/') || /\.(tsx|jsx|ts|js|vue|svelte|html|css)$/i.test(f))) {
          setActiveProjectFile(f);
          addToast('File Auto-Detected', `Targeting ${f.split('/').pop()}`, 'info');
          return;
        }

        // 2. Component name matching against scanned workspace files
        if (comp) {
          const files = useSceneStore.getState().workspaceFiles;
          const matched = files.find(filePath => {
            const baseName = filePath.split('/').pop()?.replace(/\.(tsx|jsx|vue|svelte|ts|js)$/, '') || '';
            return baseName.toLowerCase() === comp.toLowerCase();
          });
          if (matched) {
            setActiveProjectFile(matched);
            addToast('Component Auto-Detected', `Targeting <${comp} /> in ${matched.split('/').pop()}`, 'info');
          }
        }
      }
    });

    const unsubText = BrowserBridge.onTextChanged((data) => {
      if (data.text !== undefined) {
        setSelectedElementText(data.text);
      }
    });

    const api = (window as any).electronAPI;
    let unsubNav: any = null;
    if (api && api.onPageNavigated) {
      unsubNav = api.onPageNavigated((nav: { url: string; pathname: string }) => {
        const files = useSceneStore.getState().workspaceFiles;
        if (!files || files.length === 0) return;

        let cleanPath = nav.pathname.replace(/^\/|\/$/g, '');
        if (!cleanPath) cleanPath = 'index';

        // Search for matching route file in Next.js / Vite / React project
        const match = files.find(f => {
          const lower = f.toLowerCase();
          if (cleanPath === 'index') {
            return lower.includes('/app/page.') || lower.includes('/pages/index.') || lower.includes('/src/app.') || lower.endsWith('/app.tsx');
          }
          return lower.includes(`/${cleanPath}/page.`) || lower.includes(`/${cleanPath}.`) || lower.includes(`/routes/${cleanPath}.`);
        });

        if (match) {
          console.log(`⚡ Auto-detected active route "${nav.pathname}" -> ${match}`);
          setActiveProjectFile(match);
          addToast('Page Route Detected', `Navigated to ${nav.pathname} -> ${match.split('/').pop()}`, 'info');
        }
      });
    }

    return () => {
      if (unsubDom) unsubDom();
      if (unsubSelected) unsubSelected();
      if (unsubText) unsubText();
      if (unsubNav) unsubNav();
    };
  }, [setDomTree, setSelectedElement, setSelectedElementText, setActiveProjectFile, addToast]);

  // Auto-detect Workspace Root spawned from Astrolabe IDE
  useEffect(() => {
    const detectWorkspace = async () => {
      try {
        const api = (window as any).electronAPI;
        if (api && api.getInitialWorkspace) {
          const res = await api.getInitialWorkspace();
          if (res && res.success) {
            if (res.workspaceRoot) {
              const currentRoot = useSceneStore.getState().workspaceRoot;
              if (!currentRoot || currentRoot !== res.workspaceRoot) {
                console.log('⚡ Auto-detected workspace from Astrolabe IDE:', res.workspaceRoot);
                useSceneStore.getState().setWorkspaceRoot(res.workspaceRoot);
              }
              if (api.scanWorkspace) {
                const scan = await api.scanWorkspace(res.workspaceRoot);
                if (scan && scan.success && scan.files) {
                  useSceneStore.getState().setWorkspaceFiles(scan.files);
                }
              }
            }
            if (res.activeFile) {
              console.log('⚡ Auto-detected active file from IDE:', res.activeFile);
              useSceneStore.getState().setActiveProjectFile(res.activeFile);
              addToast('Active File Synced', `Editing ${res.activeFile.split('/').pop()}`, 'info');
            }
          }
        }
      } catch (err) {
        console.warn('Workspace auto-detection notice:', err);
      }
    };
    detectWorkspace();
  }, [addToast]);

  // Periodic Auto-Save Engine
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      try {
        const state = useSceneStore.getState();
        const projectData = {
          version: '1.0.0',
          savedAt: new Date().toISOString(),
          activeProjectFile: state.activeProjectFile,
          scrollPosition: state.scrollPosition,
          scrollTracks: state.scrollTracks,
          selectedElement: {
            path: state.selectedElementPath,
            styles: state.selectedElementStyles,
            text: state.selectedElementText
          }
        };
        localStorage.setItem('astrolabe_autosave_state', JSON.stringify(projectData));
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastAutoSavedTime(timeStr);
        setSaveStatus('Auto-Saved');
      } catch (e) {
        console.warn('Auto-save write error:', e);
      }
    }, 15000);

    return () => clearInterval(autoSaveInterval);
  }, []);

  const handleToolClick = useCallback((toolId: string) => {
    if (toolId === 'select') {
      const next = !inspectActive;
      setInspectActive(next);
      BrowserBridge.setInspectMode(next);
      setTool('select');
    } else {
      setTool(toolId as any);
      if (!inspectActive) {
        setInspectActive(true);
        BrowserBridge.setInspectMode(true);
      }
    }
  }, [inspectActive, setInspectActive, setTool]);

  const handleUndo = useCallback(() => {
    try {
      const temporal = (useSceneStore as any).temporal;
      if (temporal && typeof temporal.getState === 'function') {
        temporal.getState().undo?.();
      }
    } catch (e) {
      console.warn('Temporal undo error:', e);
    }
  }, []);

  const handleRedo = useCallback(() => {
    try {
      const temporal = (useSceneStore as any).temporal;
      if (temporal && typeof temporal.getState === 'function') {
        temporal.getState().redo?.();
      }
    } catch (e) {
      console.warn('Temporal redo error:', e);
    }
  }, []);

  const handleSaveProject = useCallback(() => {
    const state = useSceneStore.getState();
    const projectData = {
      version: '1.0.0',
      savedAt: new Date().toISOString(),
      activeProjectFile: state.activeProjectFile,
      scrollPosition: state.scrollPosition,
      scrollTracks: state.scrollTracks,
      selectedElement: {
        path: state.selectedElementPath,
        styles: state.selectedElementStyles,
        text: state.selectedElementText
      }
    };
    const jsonStr = JSON.stringify(projectData, null, 2);

    try {
      if ((window as any).electronAPI?.saveProject) {
        (window as any).electronAPI.saveProject(jsonStr);
        setSaveStatus('Saved to File');
        addToast('Project Saved', '💾 Project state saved successfully to disk!', 'success');
        return;
      }
    } catch (e) {
      console.warn('Electron saveProject error:', e);
    }

    // Fallback: browser download
    try {
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'astrolabe-project.json';
      a.click();
      URL.revokeObjectURL(url);
      setSaveStatus('Project Exported');
      addToast('Project Exported', '💾 Project state exported as astrolabe-project.json', 'success');
    } catch (err: any) {
      addToast('Export Failed', 'Could not export project state: ' + (err.message || String(err)), 'error');
    }
  }, [addToast]);

  // Global Keyboard Shortcuts (Undo, Redo, Save, Tools)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName;
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) || (e.target as HTMLElement)?.isContentEditable;

      // Global Undo Shortcut: Ctrl+Z / Cmd+Z (without Shift)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
          return;
        }
      }

      // Global Redo Shortcut: Ctrl+Y / Cmd+Y or Ctrl+Shift+Z / Cmd+Shift+Z
      if (
        ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && e.shiftKey)
      ) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
          return;
        }
      }

      // Global Save Shortcut: Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSaveProject();
        return;
      }

      // Tool selection hotkeys when not typing
      if (isInput) return;
      if (e.key === 'v' || e.key === 'V') handleToolClick('select');
      if (e.key === 'g' || e.key === 'G') handleToolClick('move');
      if (e.key === 'r' || e.key === 'R') handleToolClick('rotate');
      if (e.key === 's' || e.key === 'S') handleToolClick('scale');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleSaveProject, handleToolClick]);

  const handleOpenFile = async () => {
    try {
      if ((window as any).electronAPI?.openFileDialog) {
        const res = await (window as any).electronAPI.openFileDialog();
        if (res && res.filePath) {
          setActiveProjectFile(res.filePath);
          addToast('Target File Updated', `Active target component: ${res.filePath.split('/').pop() || res.filePath}`, 'info');
          return;
        }
      }
    } catch (e) {
      console.warn('Native file picker failed, falling back to prompt', e);
    }
    const path = prompt('Enter target component file path in workspace:', activeProjectFile);
    if (path) {
      setActiveProjectFile(path);
      addToast('Target File Updated', `Active target component: ${path.split('/').pop() || path}`, 'info');
    }
  };

  const handleCompileToCode = async () => {
    if (!selectedElementStyles || Object.keys(selectedElementStyles).length === 0) {
      addToast(
        'No CSS Edits to Compile',
        'Please select an element and modify its styles first in the Property Inspector.',
        'warning'
      );
      return;
    }

    // Determine target file: use activeProjectFile or selectedElementPath if it's a file path
    const rawFile = selectedElementPath?.file || '';
    const isFileSpec = Boolean(
      rawFile && (
        rawFile.startsWith('/') ||
        rawFile.startsWith('./') ||
        rawFile.startsWith('../') ||
        /\.(tsx|jsx|ts|js|html|css)$/i.test(rawFile)
      )
    );

    const targetFile = isFileSpec ? rawFile : (activeProjectFile || 'src/components/Paywall.tsx');
    const filenameOnly = targetFile.split('/').pop() || targetFile;

    // Build the AST element identifier
    const elementIdentifier: ElementIdentifier = {
      selector: !isFileSpec && rawFile ? rawFile : (selectedElementPath?.selector || undefined),
      line: selectedElementPath?.line ? parseInt(selectedElementPath.line, 10) : undefined,
      column: selectedElementPath?.column ? parseInt(selectedElementPath.column, 10) : undefined,
      text: selectedElementText || undefined,
      id: selectedDomId || undefined
    };

    try {
      const result = await ASTCompiler.previewCSSEdits(
        targetFile,
        elementIdentifier,
        selectedElementStyles
      );

      if (result.success) {
        setDiffModalState({
          isOpen: true,
          filePath: result.filePath,
          originalCode: result.originalCode,
          modifiedCode: result.modifiedCode,
          diffSummary: result.diffSummary,
          elementIdentifier,
          styles: selectedElementStyles
        });
      } else {
        console.warn('AST write failed:', result.error);
        addToast(
          'Target File Not Found',
          `Could not read "${filenameOnly}". Please select your real component file.`,
          'error'
        );
        handleOpenFile();
      }
    } catch (err: any) {
      console.warn('AST compilation error:', err);
      addToast(
        'Compilation Error',
        `Error generating diff for ${filenameOnly}: ${err.message || 'File not found'}. Click Target to pick your file.`,
        'error'
      );
      handleOpenFile();
    }
  };

  const handleApplyDiff = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api && (api.writeFile || api.fsWriteFile)) {
        const writeFn = api.writeFile || api.fsWriteFile;
        await writeFn(diffModalState.filePath, diffModalState.modifiedCode);
      } else {
        await ASTCompiler.compileCSSEdits(
          diffModalState.filePath,
          diffModalState.elementIdentifier,
          diffModalState.styles
        );
      }
      
      const count = diffModalState.diffSummary.length;
      addToast(
        'Compiled to Source AST',
        `✨ Successfully wrote ${count} style edit${count === 1 ? '' : 's'} into ${diffModalState.filePath.split('/').pop()}!`,
        'success'
      );
      setDiffModalState(prev => ({ ...prev, isOpen: false }));
    } catch (err: any) {
      addToast('Compilation Error', `Error writing file: ${err.message}`, 'error');
    }
  };

  // Tab Loader for rc-dock Layout System
  const loadTab = useCallback((tab: TabBase): TabData => {
    switch (tab.id) {
      case 'layers':
        return {
          id: 'layers',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <LayersIcon size={13} color="#a78bfa" /> Layers
            </span>
          ),
          content: <LayersPanel />,
          cached: true,
          closable: false
        };
      case 'code':
        return {
          id: 'code',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <CodeIcon size={13} color="#38bdf8" /> Live Code
            </span>
          ),
          content: <LiveCodePanel />,
          cached: true,
          closable: false
        };
      case 'hierarchy':
        return {
          id: 'hierarchy',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <BoxIcon size={13} color="#a78bfa" /> 3D Scene
            </span>
          ),
          content: <SceneHierarchy />,
          cached: true,
          closable: false
        };
      case 'viewport':
        return {
          id: 'viewport',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <Clapperboard size={13} color="#818cf8" /> 3D Viewport & Live Site
            </span>
          ),
          content: <Viewport3D />,
          cached: true,
          closable: false
        };
      case 'inspector':
        return {
          id: 'inspector',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <Sliders size={13} color="#34d399" /> Property Inspector
            </span>
          ),
          content: <PropertyInspector />,
          cached: true,
          closable: false
        };
      case 'timeline':
        return {
          id: 'timeline',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <Clapperboard size={13} color="#f472b6" /> Motion Timeline
            </span>
          ),
          content: <TimelinePanel />,
          cached: true,
          closable: false
        };
      case 'workspace':
        return {
          id: 'workspace',
          title: (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
              <FolderOpen size={13} color="#38bdf8" /> Workspace
            </span>
          ),
          content: <WorkspacePanel />,
          cached: true,
          closable: false
        };
      default:
        return {
          id: tab.id,
          title: 'Panel',
          content: <div style={{ padding: '16px', color: '#9ca3af' }}>Panel: {tab.id}</div>,
          cached: true,
          closable: false
        };
    }
  }, []);

  // Default Dockable & Resizable Layout
  const defaultLayout: LayoutData = useMemo(() => ({
    dockbox: {
      mode: 'horizontal',
      children: [
        {
          size: 280,
          minWidth: 200,
          tabs: [
            loadTab({ id: 'workspace' }),
            loadTab({ id: 'layers' }),
            loadTab({ id: 'code' }),
            loadTab({ id: 'hierarchy' })
          ]
        },
        {
          mode: 'vertical',
          size: 800,
          children: [
            {
              size: 550,
              minHeight: 200,
              tabs: [
                loadTab({ id: 'viewport' })
              ]
            },
            {
              size: 200,
              minHeight: 120,
              tabs: [
                loadTab({ id: 'timeline' })
              ]
            }
          ]
        },
        {
          size: 320,
          minWidth: 220,
          tabs: [
            loadTab({ id: 'inspector' })
          ]
        }
      ]
    }
  }), [loadTab]);

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: '#050508',
      color: '#f3f4f6',
      fontFamily: "'Outfit', system-ui, sans-serif",
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Embedded CSS for rc-dock Glassmorphism Dark Theme */}
      <style>{`
        .dock-layout {
          background: transparent !important;
        }
        .dock-panel {
          background: rgba(14, 14, 20, 0.9) !important;
          backdrop-filter: blur(24px) saturate(180%) !important;
          -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          border-radius: 8px !important;
          overflow: hidden !important;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4) !important;
        }
        .dock-top .dock-bar {
          background: rgba(18, 18, 26, 0.95) !important;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
          padding-left: 6px !important;
          height: 34px !important;
          display: flex !important;
          align-items: center !important;
        }
        .dock-tab {
          background: transparent !important;
          color: #9ca3af !important;
          border: none !important;
          border-radius: 6px !important;
          padding: 3px 10px !important;
          margin: 2px 3px !important;
          height: 26px !important;
          line-height: 20px !important;
          font-size: 11px !important;
          font-weight: 500 !important;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
        }
        .dock-tab:hover {
          color: #f3f4f6 !important;
          background: rgba(255, 255, 255, 0.06) !important;
        }
        .dock-tab-active, .dock-tab-active:hover {
          color: #ffffff !important;
          background: rgba(139, 92, 246, 0.25) !important;
          border: 1px solid rgba(139, 92, 246, 0.4) !important;
          font-weight: 600 !important;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.3) !important;
        }
        .dock-ink-bar {
          display: none !important;
        }
        .dock-divider {
          background: rgba(255, 255, 255, 0.04) !important;
          transition: background 0.15s ease, box-shadow 0.15s ease !important;
        }
        .dock-divider:hover, .dock-divider:active {
          background: rgba(139, 92, 246, 0.7) !important;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.5) !important;
        }
        .dock-drop-indicator {
          background: rgba(139, 92, 246, 0.25) !important;
          border: 2px dashed #8b5cf6 !important;
          border-radius: 6px !important;
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.4) !important;
        }
        .dock-drop-square {
          background: rgba(18, 18, 26, 0.95) !important;
          border: 1px solid #8b5cf6 !important;
          border-radius: 6px !important;
          color: #c084fc !important;
        }
        .dock-drop-square-dropping {
          background: #8b5cf6 !important;
          color: #ffffff !important;
        }
        .dock-panel-max-btn:before, .dock-panel-min-btn:before {
          border-color: #9ca3af !important;
        }
        .dock-panel-max-btn:hover:before, .dock-panel-min-btn:hover:before {
          border-color: #ffffff !important;
        }
        .dock-panel-min-btn:before {
          color: #9ca3af !important;
        }
        .dock-panel-min-btn:hover:before {
          color: #ffffff !important;
        }
        .dock-content {
          background: transparent !important;
          height: 100% !important;
        }
        .dock-tabpane {
          background: transparent !important;
          height: 100% !important;
        }
        .dock-box {
          gap: 4px;
          padding: 4px;
        }
        @keyframes toast-slide-up {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.96);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>

      {/* Top Header Bar */}
      <header
        className="glass-panel"
        style={{
          height: '48px',
          borderRadius: 0,
          borderLeft: 'none',
          borderRight: 'none',
          borderTop: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          WebkitAppRegion: 'drag'
        } as any}
      >
        {/* Brand & Active File Picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', WebkitAppRegion: 'no-drag' } as any}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #7c3aed, #4c1d95)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 0 12px rgba(124, 58, 237, 0.4)'
            }}>
              <Clapperboard size={16} />
            </div>
            <span style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.2px' }}>
              Astrolabe Motion Studio
            </span>
          </div>

          {/* Project Component Selector Pill */}
          <button
            onClick={handleOpenFile}
            className="glass-button"
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              color: '#a7f3d0',
              borderColor: 'rgba(10, 185, 129, 0.3)',
              background: 'rgba(10, 185, 129, 0.08)',
              WebkitAppRegion: 'no-drag',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            } as any}
            title="Click to select active target component file"
          >
            <FileCode size={13} color="#10b981" />
            <span style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Target: {activeProjectFile}
            </span>
            <FolderOpen size={12} color="#9ca3af" />
          </button>
        </div>

        {/* Tools Toolbar with Interactive Mode indicator & Undo/Redo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', WebkitAppRegion: 'no-drag' } as any}>
          {/* Inspect Mode Toggle Button (Cursor V) */}
          <button
            onClick={() => handleToolClick('select')}
            title={inspectActive ? 'Inspect Mode ON (Click to toggle OFF and interact with website)' : 'Inspect Mode OFF (Click to inspect elements)'}
            className={`glass-button ${inspectActive && activeTool === 'select' ? 'active' : ''}`}
            style={{
              background: inspectActive ? 'rgba(139, 92, 246, 0.3)' : 'rgba(255, 255, 255, 0.05)',
              borderColor: inspectActive ? '#8b5cf6' : 'rgba(255, 255, 255, 0.1)',
              color: inspectActive ? '#c084fc' : '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              cursor: 'pointer'
            }}
          >
            <MousePointer size={14} />
            <span style={{ fontSize: '11px', fontWeight: 600 }}>
              {inspectActive ? 'Inspect (V)' : 'Browse (V)'}
            </span>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: inspectActive ? '#a855f7' : '#10b981',
              boxShadow: inspectActive ? '0 0 6px #a855f7' : '0 0 6px #10b981'
            }} />
          </button>

          {/* Move, Rotate, Scale Tools */}
          {[
            { id: 'move', icon: <Move size={14} />, label: 'Move Tool (G)' },
            { id: 'rotate', icon: <RotateCw size={14} />, label: 'Rotate Tool (R)' },
            { id: 'scale', icon: <Maximize2 size={14} />, label: 'Scale / Resize Tool (S)' }
          ].map((tool) => (
            <button
              key={tool.id}
              onClick={() => handleToolClick(tool.id)}
              title={tool.label}
              className={`glass-button ${activeTool === tool.id ? 'active' : ''}`}
              style={{
                background: activeTool === tool.id ? 'rgba(139, 92, 246, 0.25)' : undefined,
                borderColor: activeTool === tool.id ? 'rgba(139, 92, 246, 0.6)' : undefined,
                color: activeTool === tool.id ? '#a78bfa' : undefined,
                cursor: 'pointer'
              }}
            >
              {tool.icon}
            </button>
          ))}

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.1)', margin: '0 4px' }} />

          {/* Undo / Redo Actions */}
          <button
            onClick={handleUndo}
            className="glass-button"
            title="Undo Last Action (Ctrl+Z)"
            style={{ padding: '5px 8px', cursor: 'pointer' }}
          >
            <Undo2 size={13} color="#9ca3af" />
          </button>

          <button
            onClick={handleRedo}
            className="glass-button"
            title="Redo (Ctrl+Shift+Z / Ctrl+Y)"
            style={{ padding: '5px 8px', cursor: 'pointer' }}
          >
            <Redo2 size={13} color="#9ca3af" />
          </button>
        </div>

        {/* Header Actions & Auto-Save Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', WebkitAppRegion: 'no-drag' } as any}>
          {/* Visual Auto-Save Indicator with Static Glowing Dot */}
          <div
            title={`Status: ${saveStatus} (Last Auto-Saved: ${lastAutoSavedTime})`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '12px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.25)',
              fontSize: '11px',
              color: '#a7f3d0',
              fontWeight: 500,
              letterSpacing: '0.2px',
              userSelect: 'none'
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: '#10b981',
                boxShadow: '0 0 8px rgba(16, 185, 129, 0.7)',
                display: 'inline-block',
                flexShrink: 0,
                transition: 'transform 0.3s ease, opacity 0.3s ease'
              }}
            />
            <span>{saveStatus}</span>
          </div>

          {/* Save Project Button */}
          <button
            onClick={handleSaveProject}
            className="glass-button"
            title="Save Project State (Ctrl+S)"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              color: '#38bdf8',
              borderColor: 'rgba(56, 189, 248, 0.3)',
              background: 'rgba(56, 189, 248, 0.08)',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer'
            }}
          >
            <Save size={13} color="#38bdf8" /> Save Project
          </button>

          {/* Compile Action */}
          <button
            onClick={handleCompileToCode}
            className="glass-button glass-button-primary"
            title="Compile Edits directly into JSX Source Code AST"
            style={{ cursor: 'pointer' }}
          >
            <Zap size={14} /> Compile CSS Edits
          </button>
        </div>
      </header>

      {/* Main Dockable & Resizable Workspace via rc-dock */}
      <div style={{ flex: 1, position: 'relative', width: '100%', height: 'calc(100vh - 48px)', overflow: 'hidden' }}>
        <DockLayout
          ref={dockLayoutRef}
          defaultLayout={defaultLayout}
          loadTab={loadTab}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0
          }}
        />
      </div>

      {/* Sleek Non-Blocking Floating Toast Notification Stack (Bottom Right) */}
      <div
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          pointerEvents: 'none',
          maxWidth: '380px'
        }}
      >
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success';
          const isWarning = toast.type === 'warning';
          const isError = toast.type === 'error';
          
          const accentColor = isSuccess ? '#10b981' : isWarning ? '#f59e0b' : isError ? '#ef4444' : '#8b5cf6';
          const glowShadow = isSuccess 
            ? '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(16, 185, 129, 0.25)' 
            : isWarning 
            ? '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(245, 158, 11, 0.25)' 
            : isError 
            ? '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(239, 68, 68, 0.25)' 
            : '0 8px 30px rgba(0, 0, 0, 0.5), 0 0 15px rgba(139, 92, 246, 0.25)';

          return (
            <div
              key={toast.id}
              className="toast-item"
              style={{
                background: 'rgba(15, 15, 23, 0.94)',
                backdropFilter: 'blur(20px) saturate(180%)',
                WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                border: `1px solid ${isSuccess ? 'rgba(16, 185, 129, 0.4)' : isWarning ? 'rgba(245, 158, 11, 0.4)' : isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(139, 92, 246, 0.4)'}`,
                borderLeft: `4px solid ${accentColor}`,
                borderRadius: '10px',
                padding: '12px 14px',
                boxShadow: glowShadow,
                color: '#f9fafb',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                pointerEvents: 'auto',
                animation: 'toast-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards'
              }}
            >
              <div style={{ flexShrink: 0, marginTop: '1px' }}>
                {isSuccess && <CheckCircle2 size={16} color="#10b981" />}
                {isWarning && <AlertCircle size={16} color="#f59e0b" />}
                {isError && <AlertCircle size={16} color="#ef4444" />}
                {!isSuccess && !isWarning && !isError && <Sparkles size={16} color="#c084fc" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: '#ffffff', letterSpacing: '-0.1px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{toast.title}</span>
                </div>
                {toast.message && (
                  <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '3px', lineHeight: '1.4', wordBreak: 'break-word' }}>
                    {toast.message}
                  </div>
                )}
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  cursor: 'pointer',
                  padding: '2px',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'color 0.15s ease'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#f3f4f6')}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#6b7280')}
                title="Close notification"
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>

      <DiffReviewModal
        isOpen={diffModalState.isOpen}
        onClose={() => setDiffModalState(prev => ({ ...prev, isOpen: false }))}
        onApply={handleApplyDiff}
        filePath={diffModalState.filePath}
        originalCode={diffModalState.originalCode}
        modifiedCode={diffModalState.modifiedCode}
        diffSummary={diffModalState.diffSummary}
      />
    </div>
  );
}

export default App;

