import React, { useState, useMemo, useCallback } from 'react';
import { useSceneStore } from '../core/SceneGraph';
import { 
  Folder, 
  FolderOpen, 
  ChevronRight, 
  ChevronDown, 
  Search, 
  FolderTree, 
  FileCode, 
  FileText, 
  RefreshCw, 
  FileJson, 
  Sparkles, 
  X,
  FileType2,
  FolderPlus
} from 'lucide-react';

interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileNode[];
}

function buildFileTree(files: string[], rootPath: string): FileNode[] {
  const root: FileNode = { name: 'root', path: rootPath, isDirectory: true, children: [] };
  const separator = rootPath.includes('\\') ? '\\' : '/';

  for (const file of files) {
    const relativePath = file.replace(rootPath + separator, '');
    const parts = relativePath.split(separator);
    
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      
      let child = current.children!.find(c => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: isFile ? file : '',
          isDirectory: !isFile,
          children: isFile ? undefined : []
        };
        current.children!.push(child);
      }
      current = child;
    }
  }

  // Sort: folders first, then files alphabetically
  const sortNodes = (node: FileNode) => {
    if (node.children) {
      node.children.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      node.children.forEach(sortNodes);
    }
  };
  sortNodes(root);

  return root.children || [];
}

/**
 * Returns a sleek icon and subtle accent color based on file extension
 */
function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'tsx':
    case 'jsx':
      return <FileCode size={13} style={{ color: '#38bdf8', flexShrink: 0 }} />;
    case 'ts':
    case 'js':
      return <FileCode size={13} style={{ color: '#60a5fa', flexShrink: 0 }} />;
    case 'css':
    case 'scss':
    case 'less':
      return <FileType2 size={13} style={{ color: '#f472b6', flexShrink: 0 }} />;
    case 'json':
    case 'yaml':
    case 'yml':
      return <FileJson size={13} style={{ color: '#fbbf24', flexShrink: 0 }} />;
    case 'md':
    case 'txt':
      return <FileText size={13} style={{ color: '#94a3b8', flexShrink: 0 }} />;
    default:
      return <FileText size={13} style={{ color: '#94a3b8', flexShrink: 0 }} />;
  }
}

const TreeNode: React.FC<{
  node: FileNode;
  level: number;
  activeFile: string;
  onSelect: (path: string) => void;
}> = ({ node, level, activeFile, onSelect }) => {
  const [expanded, setExpanded] = useState(true);
  const isSelected = !node.isDirectory && activeFile && (activeFile === node.path || activeFile.endsWith('/' + node.name) || activeFile.endsWith('\\' + node.name));

  if (node.isDirectory) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div 
          onClick={() => setExpanded(!expanded)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '3px 8px',
            paddingLeft: `${Math.max(8, level * 14 + 6)}px`,
            cursor: 'pointer',
            borderRadius: '4px',
            color: '#94a3b8',
            fontSize: '11.5px',
            fontWeight: 500,
            transition: 'background 0.12s ease, color 0.12s ease',
            userSelect: 'none'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            e.currentTarget.style.color = '#e2e8f0';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#94a3b8';
          }}
        >
          <span style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            width: '12px',
            height: '12px',
            color: '#64748b'
          }}>
            {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
          {expanded ? (
            <FolderOpen size={13} style={{ color: '#c084fc', flexShrink: 0 }} />
          ) : (
            <Folder size={13} style={{ color: '#a855f7', flexShrink: 0 }} />
          )}
          <span style={{ 
            overflow: 'hidden', 
            textOverflow: 'ellipsis', 
            whiteSpace: 'nowrap',
            letterSpacing: '0.01em'
          }}>
            {node.name}
          </span>
        </div>

        {expanded && node.children && (
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column',
            position: 'relative',
            marginLeft: `${level * 14 + 12}px`,
            paddingLeft: '6px',
            borderLeft: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            {node.children.map((child, idx) => (
              <TreeNode 
                key={`${child.name}-${idx}`} 
                node={child} 
                level={0} 
                activeFile={activeFile} 
                onSelect={onSelect} 
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      onClick={() => onSelect(node.path)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '3px 8px',
        paddingLeft: level === 0 ? '4px' : `${level * 14 + 6}px`,
        cursor: 'pointer',
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        color: isSelected ? '#ffffff' : '#cbd5e1',
        background: isSelected ? 'rgba(139, 92, 246, 0.16)' : 'transparent',
        borderLeft: isSelected ? '2px solid #8b5cf6' : '2px solid transparent',
        transition: 'all 0.12s ease',
        userSelect: 'none',
        position: 'relative'
      }}
      onMouseEnter={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.035)';
          e.currentTarget.style.color = '#f1f5f9';
        }
      }}
      onMouseLeave={(e) => {
        if (!isSelected) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = '#cbd5e1';
        }
      }}
      title={node.path}
    >
      {getFileIcon(node.name)}
      <span style={{ 
        flex: 1, 
        overflow: 'hidden', 
        textOverflow: 'ellipsis', 
        whiteSpace: 'nowrap',
        fontWeight: isSelected ? 600 : 400
      }}>
        {node.name}
      </span>
      {isSelected && (
        <div style={{
          width: '5px',
          height: '5px',
          borderRadius: '50%',
          backgroundColor: '#38bdf8',
          boxShadow: '0 0 8px #38bdf8',
          flexShrink: 0
        }} />
      )}
    </div>
  );
};

export const WorkspacePanel: React.FC = () => {
  const workspaceRoot = useSceneStore((state) => state.workspaceRoot);
  const workspaceFiles = useSceneStore((state) => state.workspaceFiles);
  const activeProjectFile = useSceneStore((state) => state.activeProjectFile);
  const setWorkspaceRoot = useSceneStore((state) => state.setWorkspaceRoot);
  const setWorkspaceFiles = useSceneStore((state) => state.setWorkspaceFiles);
  const setActiveProjectFile = useSceneStore((state) => state.setActiveProjectFile);

  const [search, setSearch] = useState('');
  const [isScanning, setIsScanning] = useState(false);

  const handleOpenFolder = async () => {
    try {
      const api = (window as any).electronAPI;
      if (api && api.openDirectoryDialog) {
        const res = await api.openDirectoryDialog();
        if (res && res.success && res.directoryPath) {
          setIsScanning(true);
          setWorkspaceRoot(res.directoryPath);
          const scanRes = await api.scanWorkspace(res.directoryPath);
          if (scanRes && scanRes.success) {
            setWorkspaceFiles(scanRes.files);
          }
          setIsScanning(false);
        }
      }
    } catch (e) {
      console.error(e);
      setIsScanning(false);
    }
  };

  const handleRefresh = async () => {
    if (!workspaceRoot) return;
    try {
      setIsScanning(true);
      const api = (window as any).electronAPI;
      if (api && api.scanWorkspace) {
        const scanRes = await api.scanWorkspace(workspaceRoot);
        if (scanRes && scanRes.success) {
          setWorkspaceFiles(scanRes.files);
        }
      }
      setIsScanning(false);
    } catch (e) {
      console.error(e);
      setIsScanning(false);
    }
  };

  // Filtered files
  const filteredFiles = useMemo(() => {
    if (!search.trim()) return workspaceFiles;
    const q = search.toLowerCase();
    return workspaceFiles.filter(f => f.toLowerCase().includes(q));
  }, [workspaceFiles, search]);

  // Build tree
  const fileTree = useMemo(() => {
    if (!workspaceRoot || filteredFiles.length === 0) return [];
    return buildFileTree(filteredFiles, workspaceRoot);
  }, [filteredFiles, workspaceRoot]);

  const workspaceName = useMemo(() => {
    if (!workspaceRoot) return '';
    return workspaceRoot.split(/[/\\]/).filter(Boolean).pop() || workspaceRoot;
  }, [workspaceRoot]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: 'rgba(10, 10, 15, 0.95)',
      color: '#f3f4f6',
      fontSize: '12px',
      userSelect: 'none',
      overflow: 'hidden'
    }}>
      {/* Sleek Top Header Bar */}
      <div style={{
        padding: '8px 10px 6px 10px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}>
        {/* Workspace Root Badge & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <FolderTree size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: '#e2e8f0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}>
              {workspaceName || 'Explorer'}
            </span>
            {workspaceFiles.length > 0 && (
              <span style={{
                fontSize: '9.5px',
                fontFamily: "'JetBrains Mono', monospace",
                color: '#64748b',
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '1px 5px',
                borderRadius: '4px'
              }}>
                {workspaceFiles.length}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <button
              onClick={handleRefresh}
              style={{
                background: 'transparent',
                border: 'none',
                color: isScanning ? '#8b5cf6' : '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              title="Rescan Workspace Files"
              onMouseEnter={(e) => (e.currentTarget.style.color = '#f3f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.color = isScanning ? '#8b5cf6' : '#94a3b8')}
            >
              <RefreshCw size={12} style={{ animation: isScanning ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              onClick={handleOpenFolder}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease'
              }}
              title="Switch Workspace Folder"
              onMouseEnter={(e) => (e.currentTarget.style.color = '#f3f4f6')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
              <FolderPlus size={13} />
            </button>
          </div>
        </div>

        {/* Inset Obsidian Search Box */}
        {workspaceRoot && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(0, 0, 0, 0.45)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '5px',
            padding: '3px 8px',
            gap: '6px'
          }}>
            <Search size={11} style={{ color: '#64748b', flexShrink: 0 }} />
            <input
              type="text"
              placeholder="Filter components..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e2e8f0',
                fontSize: '11px',
                width: '100%',
                fontFamily: 'inherit'
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* File Tree List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '6px 4px',
        display: 'flex',
        flexDirection: 'column',
        gap: '1px'
      }}>
        {!workspaceRoot ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#64748b',
            textAlign: 'center',
            padding: '16px',
            gap: '10px'
          }}>
            <FolderTree size={28} style={{ color: '#475569', opacity: 0.7 }} />
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>No workspace folder active</div>
            <button
              onClick={handleOpenFolder}
              style={{
                background: 'rgba(139, 92, 246, 0.15)',
                border: '1px solid rgba(139, 92, 246, 0.35)',
                color: '#c084fc',
                borderRadius: '6px',
                padding: '6px 12px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <FolderPlus size={12} /> Open Workspace
            </button>
          </div>
        ) : fileTree.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '120px',
            color: '#64748b',
            fontSize: '11px',
            gap: '6px'
          }}>
            <span>No components matching "{search}"</span>
          </div>
        ) : (
          fileTree.map((node, idx) => (
            <TreeNode
              key={`${node.name}-${idx}`}
              node={node}
              level={0}
              activeFile={activeProjectFile}
              onSelect={setActiveProjectFile}
            />
          ))
        )}
      </div>
    </div>
  );
};
