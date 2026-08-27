import React, { useMemo } from 'react';
import { X, Check, Copy } from 'lucide-react';

interface DiffReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: () => void;
  filePath: string;
  originalCode: string;
  modifiedCode: string;
  diffSummary: string[];
}

function simpleDiff(oldStr: string, newStr: string) {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const res: { type: 'added' | 'removed' | 'unchanged', value: string }[] = [];
  
  let i = 0, j = 0;
  while(i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      res.push({ type: 'unchanged', value: oldLines[i] });
      i++; j++;
    } else {
      let matchFound = false;
      for(let k = 1; k < 20; k++) {
        if (i+k < oldLines.length && oldLines[i+k] === newLines[j]) {
           for(let x=0; x<k; x++) res.push({ type: 'removed', value: oldLines[i+x] });
           i += k;
           matchFound = true;
           break;
        }
        if (j+k < newLines.length && oldLines[i] === newLines[j+k]) {
           for(let x=0; x<k; x++) res.push({ type: 'added', value: newLines[j+x] });
           j += k;
           matchFound = true;
           break;
        }
      }
      if (!matchFound) {
        if (i < oldLines.length) res.push({ type: 'removed', value: oldLines[i++] });
        if (j < newLines.length) res.push({ type: 'added', value: newLines[j++] });
      }
    }
  }
  return res;
}

export function DiffReviewModal({
  isOpen,
  onClose,
  onApply,
  filePath,
  originalCode,
  modifiedCode,
  diffSummary
}: DiffReviewModalProps) {
  const diffLines = useMemo(() => {
    if (!isOpen) return [];
    return simpleDiff(originalCode, modifiedCode);
  }, [originalCode, modifiedCode, isOpen]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(modifiedCode);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100000
    }}>
      <div style={{
        width: '900px',
        maxWidth: '90vw',
        height: '85vh',
        background: 'rgba(15, 15, 23, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: '#f3f4f6',
        fontFamily: "'Outfit', system-ui, sans-serif"
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(0,0,0,0.2)'
        }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Review CSS Edits</h2>
            <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
              Target: <code style={{ color: '#a78bfa' }}>{filePath}</code>
            </div>
            {diffSummary.length > 0 && (
              <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>
                Modified properties: {diffSummary.join(', ')}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Diff Content */}
        <div style={{
          flex: 1,
          overflow: 'auto',
          backgroundColor: '#0a0a0f',
          fontFamily: "'Fira Code', monospace",
          fontSize: '13px',
          lineHeight: '1.5',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px 0'
        }}>
          {diffLines.map((line, index) => {
            const isAdded = line.type === 'added';
            const isRemoved = line.type === 'removed';
            const backgroundColor = isAdded ? 'rgba(16, 185, 129, 0.15)' : isRemoved ? 'rgba(239, 68, 68, 0.15)' : 'transparent';
            const color = isAdded ? '#34d399' : isRemoved ? '#f87171' : '#9ca3af';
            const prefix = isAdded ? '+' : isRemoved ? '-' : ' ';
            return (
              <div key={index} style={{ backgroundColor, color, display: 'flex', padding: '0 16px' }}>
                <span style={{ width: '24px', opacity: 0.5, userSelect: 'none' }}>{prefix}</span>
                <span style={{ whiteSpace: 'pre' }}>{line.value}</span>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '12px',
          background: 'rgba(0,0,0,0.2)'
        }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#f3f4f6',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <X size={14} /> Cancel / Discard
          </button>
          
          <button
            onClick={handleCopy}
            style={{
              padding: '8px 16px',
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              color: '#38bdf8',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <Copy size={14} /> Copy Modified Code / Snippet
          </button>
          
          <button
            onClick={onApply}
            style={{
              padding: '8px 16px',
              backgroundColor: '#8b5cf6',
              border: 'none',
              color: 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontWeight: 600
            }}
          >
            <Check size={14} /> Apply to File on Disk
          </button>
        </div>
      </div>
    </div>
  );
}
