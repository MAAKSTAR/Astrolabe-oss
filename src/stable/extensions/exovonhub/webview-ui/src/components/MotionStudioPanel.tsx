import { getVsCodeApi } from '../vscodeApi';

const vscode = getVsCodeApi();

function ClapperboardIcon({ size = 20, color = "#a78bfa" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.2 6 3 11l-.9-2.4c-.4-1.1.2-2.4 1.3-2.8l13.6-5c1.1-.4 2.4.2 2.8 1.3Z" />
      <path d="m6.2 5.3 3.1 3.9" />
      <path d="m12.4 3 3.1 4" />
      <path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

function MonitorIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="14" x="2" y="3" rx="2" />
      <line x1="8" x2="16" y1="21" y2="21" />
      <line x1="12" x2="12" y1="17" y2="21" />
    </svg>
  );
}

function ZapIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function SparklesIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}

export function MotionStudioPanel() {
  const handleOpenStudioWindow = () => {
    vscode?.postMessage({
      command: 'openMotionStudio'
    });
  };

  const handleCompile = () => {
    vscode?.postMessage({
      command: 'compileMotion'
    });
  };

  const handleScaffoldScene = () => {
    vscode?.postMessage({
      command: 'compileMotion'
    });
  };

  return (
    <div style={{ padding: '16px', color: '#e0e0e0', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <ClapperboardIcon size={20} color="#a78bfa" />
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Astrolabe Motion Studio</h2>
      </div>

      <p style={{ fontSize: '12px', color: '#888', marginBottom: '16px', lineHeight: '1.4' }}>
        Direct 3D camera paths, R3F keyframes, and scroll-linked animations visually. Compile your performance into clean, hand-crafted GSAP + R3F code.
      </p>

      {/* Primary Window Launch Button */}
      <button
        onClick={handleOpenStudioWindow}
        style={{
          width: '100%',
          background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)',
          color: '#fff',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          boxShadow: '0 4px 15px rgba(124, 58, 237, 0.4)',
          marginBottom: '16px'
        }}
      >
        <MonitorIcon size={16} /> Open Motion Studio Window
      </button>

      {/* Status Card */}
      <div style={{ background: '#1e1e2e', border: '1px solid #2b2b3b', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', color: '#aaa' }}>Engine Status</span>
          <span style={{ fontSize: '11px', background: '#10b98122', color: '#10b981', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
            ● Deterministic Compiler Ready
          </span>
        </div>
        <div style={{ fontSize: '11px', color: '#666' }}>
          • Brain AST Index: Active<br/>
          • ts-morph Worker: Ready<br/>
          • Recompile Safety: Active
        </div>
      </div>

      {/* Primary Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={handleCompile}
          style={{
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            padding: '10px 14px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)'
          }}
        >
          <ZapIcon size={16} /> Compile Motion to Code
        </button>

        <button
          onClick={handleScaffoldScene}
          style={{
            background: '#27273a',
            color: '#d1d5db',
            border: '1px solid #374151',
            borderRadius: '6px',
            padding: '8px 12px',
            fontSize: '12px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px'
          }}
        >
          <SparklesIcon size={14} /> Scaffold Starter 3D Scene (.tsx)
        </button>
      </div>

      {/* Features Checklist */}
      <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #2a2a3a' }}>
        <h4 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#777', marginBottom: '8px' }}>
          Studio Features
        </h4>
        <ul style={{ fontSize: '11px', color: '#aaa', paddingLeft: '16px', margin: 0, lineHeight: '1.8' }}>
          <li>Theatre.js Visual Overlay for R3F</li>
          <li>GSAP ScrollTrigger Timeline Emitter</li>
          <li>Mandatory Memory-Leak Cleanup</li>
          <li>Non-Destructive AST Re-compile Diffing</li>
          <li>One-Click Undo / Redo History</li>
        </ul>
      </div>
    </div>
  );
}
