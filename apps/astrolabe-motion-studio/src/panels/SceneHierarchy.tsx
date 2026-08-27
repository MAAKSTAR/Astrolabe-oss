import React from 'react';
import { useSceneStore } from '../core/SceneGraph';
import { Box, Camera, Sun, Folder, Plus, Trash2 } from 'lucide-react';

export function SceneHierarchy() {
  const nodes = useSceneStore((state) => state.nodes);
  const rootIds = useSceneStore((state) => state.rootIds);
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);
  const selectNode = useSceneStore((state) => state.selectNode);
  const addMeshNode = useSceneStore((state) => state.addMeshNode);
  const removeSelectedNode = useSceneStore((state) => state.removeSelectedNode);

  const getIcon = (type: string) => {
    switch (type) {
      case 'mesh': return <Box size={14} color="#a78bfa" />;
      case 'camera': return <Camera size={14} color="#60a5fa" />;
      case 'light': return <Sun size={14} color="#facc15" />;
      default: return <Folder size={14} color="#9ca3af" />;
    }
  };

  return (
    <div className="glass-panel" style={{
      padding: '14px',
      height: '100%',
      borderRadius: 0,
      borderTop: 'none',
      borderBottom: 'none',
      borderLeft: 'none',
      display: 'flex',
      flexDirection: 'column',
      color: '#f3f4f6'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: '#9ca3af' }}>
          Scene Hierarchy
        </span>
        {selectedNodeId && (
          <button
            onClick={removeSelectedNode}
            title="Delete Selected Node"
            className="glass-button"
            style={{ padding: '4px 8px', color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      {/* Quick Add Object Controls */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '14px' }}>
        <button
          onClick={() => addMeshNode('box')}
          className="glass-button"
          style={{ padding: '6px 8px', fontSize: '11px', justifyContent: 'center' }}
        >
          <Plus size={12} /> Box
        </button>
        <button
          onClick={() => addMeshNode('sphere')}
          className="glass-button"
          style={{ padding: '6px 8px', fontSize: '11px', justifyContent: 'center' }}
        >
          <Plus size={12} /> Sphere
        </button>
        <button
          onClick={() => addMeshNode('cylinder')}
          className="glass-button"
          style={{ padding: '6px 8px', fontSize: '11px', justifyContent: 'center' }}
        >
          <Plus size={12} /> Cylinder
        </button>
        <button
          onClick={() => addMeshNode('plane')}
          className="glass-button"
          style={{ padding: '6px 8px', fontSize: '11px', justifyContent: 'center' }}
        >
          <Plus size={12} /> Plane
        </button>
      </div>

      {/* Node Tree */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1, overflowY: 'auto' }}>
        {rootIds.map((id) => {
          const node = nodes[id];
          if (!node) return null;
          const isSelected = selectedNodeId === id;

          return (
            <div
              key={node.id}
              onClick={() => selectNode(node.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: 'pointer',
                background: isSelected ? 'rgba(124, 58, 237, 0.2)' : 'transparent',
                border: isSelected ? '1px solid rgba(124, 58, 237, 0.4)' : '1px solid transparent',
                transition: 'all 0.15s'
              }}
            >
              {getIcon(node.type)}
              <span>{node.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
