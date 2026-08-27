import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Code,
  Box,
  Search,
  X,
  Copy,
  Trash2,
  Plus,
  CornerDownRight,
  Check,
  Move,
  Maximize2,
  FolderPlus,
  Filter,
  MousePointer
} from 'lucide-react';
import { useSceneStore } from '../core/SceneGraph';
import { BrowserBridge } from '../core/BrowserBridge';

export interface DOMTreeNode {
  id: string;
  name: string;
  tag: string;
  elementId?: string;
  className?: string;
  text?: string;
  visible?: boolean;
  locked?: boolean;
  children?: DOMTreeNode[];
  _isMatch?: boolean;
  _hasMatchingChild?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: DOMTreeNode;
  showAddMenu?: boolean;
}

interface DropTargetState {
  id: string;
  position: 'before' | 'after' | 'inside';
}

// Helper: Safely deep clone tree
function cloneTree(node: DOMTreeNode): DOMTreeNode {
  return {
    ...node,
    children: Array.isArray(node.children) ? node.children.map(cloneTree) : []
  };
}

// Helper: Find a node by ID in tree
function findNodeInTree(node: DOMTreeNode | null, id: string): DOMTreeNode | null {
  if (!node) return null;
  if (node.id === id) return node;
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      const found = findNodeInTree(child, id);
      if (found) return found;
    }
  }
  return null;
}

// Helper: Check if targetId is a descendant of ancestorNode (prevents circular drops)
function isDescendantNode(ancestorNode: DOMTreeNode | null, targetId: string): boolean {
  if (!ancestorNode || !Array.isArray(ancestorNode.children)) return false;
  for (const child of ancestorNode.children) {
    if (child.id === targetId) return true;
    if (isDescendantNode(child, targetId)) return true;
  }
  return false;
}

// Helper: Remove node from tree by ID
function removeNodeFromTree(tree: DOMTreeNode, id: string): { newTree: DOMTreeNode | null; removed: DOMTreeNode | null } {
  if (tree.id === id) {
    return { newTree: null, removed: tree };
  }

  let removed: DOMTreeNode | null = null;
  function filterChildren(curr: DOMTreeNode): DOMTreeNode {
    if (!curr.children) return curr;
    const newChildren: DOMTreeNode[] = [];
    for (const child of curr.children) {
      if (child.id === id) {
        removed = child;
      } else {
        newChildren.push(filterChildren(child));
      }
    }
    return { ...curr, children: newChildren };
  }

  const cloned = cloneTree(tree);
  const newTree = filterChildren(cloned);
  return { newTree, removed };
}

// Helper: Insert node into tree before/after/inside targetId
function insertNodeIntoTree(
  tree: DOMTreeNode,
  targetId: string,
  nodeToInsert: DOMTreeNode,
  position: 'before' | 'after' | 'inside'
): DOMTreeNode {
  const cloned = cloneTree(tree);

  if (position === 'inside') {
    function insertInside(curr: DOMTreeNode): boolean {
      if (curr.id === targetId) {
        curr.children = [...(curr.children || []), nodeToInsert];
        return true;
      }
      if (curr.children) {
        for (const child of curr.children) {
          if (insertInside(child)) return true;
        }
      }
      return false;
    }
    insertInside(cloned);
    return cloned;
  }

  // Insert sibling before or after
  function insertSibling(curr: DOMTreeNode): boolean {
    if (!curr.children) return false;
    const idx = curr.children.findIndex((c) => c.id === targetId);
    if (idx !== -1) {
      const newChildren = [...curr.children];
      if (position === 'before') {
        newChildren.splice(idx, 0, nodeToInsert);
      } else {
        newChildren.splice(idx + 1, 0, nodeToInsert);
      }
      curr.children = newChildren;
      return true;
    }
    for (const child of curr.children) {
      if (insertSibling(child)) return true;
    }
    return false;
  }

  insertSibling(cloned);
  return cloned;
}

// Helper: Build CSS Selector Path from root down to node
function generateCssSelector(node: DOMTreeNode, rootTree: DOMTreeNode | null): string {
  if (node.elementId && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(node.elementId)) {
    return `#${node.elementId}`;
  }

  if (!rootTree) {
    const tag = node.tag || 'div';
    const cls = node.className ? `.${node.className.trim().split(/\s+/)[0]}` : '';
    return `${tag}${cls}`;
  }

  const path: string[] = [];
  function tracePath(curr: DOMTreeNode, targetId: string, currentPath: string[]): boolean {
    if (!curr) return false;
    let segment = curr.tag || 'div';
    if (curr.elementId && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(curr.elementId)) {
      segment = `${curr.tag}#${curr.elementId}`;
    } else if (curr.className && typeof curr.className === 'string') {
      const firstClass = curr.className.trim().split(/\s+/)[0];
      if (firstClass && /^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(firstClass)) {
        segment = `${curr.tag}.${firstClass}`;
      }
    }

    const nextPath = [...currentPath, segment];
    if (curr.id === targetId) {
      path.push(...nextPath);
      return true;
    }

    if (curr.children) {
      for (const child of curr.children) {
        if (tracePath(child, targetId, nextPath)) return true;
      }
    }
    return false;
  }

  tracePath(rootTree, node.id, []);
  if (path.length > 0) {
    return path.join(' > ');
  }

  const tag = node.tag || 'div';
  const cls = node.className ? `.${node.className.trim().split(/\s+/)[0]}` : '';
  const id = node.elementId ? `#${node.elementId}` : '';
  return `${tag}${id}${cls}`;
}

// Helper: Dispatch DOM mutation actions to BrowserBridge with CDP evaluation fallbacks
async function executeDomBridgeCommand(action: string, payload: Record<string, any>) {
  // 1. Try direct BrowserBridge method if defined
  if (typeof (BrowserBridge as any)[action] === 'function') {
    try {
      await (BrowserBridge as any)[action](...Object.values(payload));
      return;
    } catch (err) {
      console.warn(`[BrowserBridge.${action}] execution failed:`, err);
    }
  }

  // 2. Try window.electronAPI method if exposed
  if (window.electronAPI && typeof (window.electronAPI as any)[action] === 'function') {
    try {
      await (window.electronAPI as any)[action](...Object.values(payload));
      return;
    } catch (err) {
      console.warn(`[electronAPI.${action}] execution failed:`, err);
    }
  }

  // 3. Fallback: Execute live DOM manipulation script in Guest view via CDP Runtime.evaluate
  try {
    let script = '';
    if (action === 'deleteElementById') {
      script = `(() => {
        const el = document.querySelector('[data-astrolabe-id="${payload.id}"]') || document.getElementById("${payload.id}");
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
          return true;
        }
        return false;
      })()`;
    } else if (action === 'duplicateElementById') {
      script = `(() => {
        const el = document.querySelector('[data-astrolabe-id="${payload.id}"]') || document.getElementById("${payload.id}");
        if (el && el.parentNode) {
          const clone = el.cloneNode(true);
          const newId = 'node_' + Math.random().toString(36).substr(2, 6);
          clone.setAttribute('data-astrolabe-id', newId);
          el.parentNode.insertBefore(clone, el.nextSibling);
          return true;
        }
        return false;
      })()`;
    } else if (action === 'addChildElement') {
      const tag = payload.tag || 'div';
      script = `(() => {
        const parent = document.querySelector('[data-astrolabe-id="${payload.parentId}"]') || document.getElementById("${payload.parentId}");
        if (parent) {
          const child = document.createElement("${tag}");
          child.className = "new-${tag}";
          const newId = '${tag}_' + Math.random().toString(36).substr(2, 6);
          child.setAttribute('data-astrolabe-id', newId);
          parent.appendChild(child);
          return true;
        }
        return false;
      })()`;
    } else if (action === 'reparentOrReorderElement') {
      script = `(() => {
        const src = document.querySelector('[data-astrolabe-id="${payload.sourceId}"]') || document.getElementById("${payload.sourceId}");
        const tgt = document.querySelector('[data-astrolabe-id="${payload.targetId}"]') || document.getElementById("${payload.targetId}");
        if (src && tgt && src !== tgt) {
          if ("${payload.position}" === 'inside') {
            tgt.appendChild(src);
          } else if ("${payload.position}" === 'before' && tgt.parentNode) {
            tgt.parentNode.insertBefore(src, tgt);
          } else if ("${payload.position}" === 'after' && tgt.parentNode) {
            tgt.parentNode.insertBefore(src, tgt.nextSibling);
          }
          return true;
        }
        return false;
      })()`;
    }

    if (script && BrowserBridge.sendCommand) {
      await BrowserBridge.sendCommand('Runtime.evaluate', {
        expression: script,
        returnByValue: true
      });
    }
  } catch (err) {
    console.warn(`[BrowserBridge] Guest DOM script execution fallback:`, err);
  }
}

export function LayersPanel() {
  const domTree = useSceneStore((state) => state.domTree) as DOMTreeNode | null;
  const selectedDomId = useSceneStore((state) => state.selectedDomId);
  const setDomTree = useSceneStore((state) => state.setDomTree);
  const setSelectedDomId = useSceneStore((state) => state.setSelectedDomId);

  // Search & Filtering State
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Node Collapse State
  const [collapsedNodes, setCollapsedNodes] = useState<Record<string, boolean>>({});

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Drag-and-Drop State
  const [draggedNode, setDraggedNode] = useState<DOMTreeNode | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);

  // Toast Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  const showToast = (message: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2400);
  };

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleGlobalClick);
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, []);

  const toggleCollapse = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedNodes((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelect = (id: string) => {
    setSelectedDomId(id);
    BrowserBridge.selectElementById(id);
  };

  const handleToggleVisibility = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    BrowserBridge.toggleElementVisibility(id);
  };

  const getTagColor = (tag: string) => {
    switch (tag?.toLowerCase()) {
      case 'div':
        return '#60a5fa';
      case 'button':
        return '#34d399';
      case 'input':
      case 'textarea':
      case 'select':
        return '#fbbf24';
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'p':
      case 'span':
      case 'a':
        return '#f472b6';
      case 'canvas':
      case 'svg':
      case 'path':
        return '#a78bfa';
      case 'section':
      case 'main':
      case 'header':
      case 'footer':
      case 'nav':
      case 'article':
        return '#38bdf8';
      case 'img':
      case 'video':
        return '#fb923c';
      default:
        return '#9ca3af';
    }
  };

  // Filter DOM Tree based on query
  const { filteredTree, matchCount } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!domTree) return { filteredTree: null, matchCount: 0 };
    if (!query) return { filteredTree: domTree, matchCount: 0 };

    let totalMatches = 0;

    function filterNode(node: DOMTreeNode): { node: DOMTreeNode | null; isMatch: boolean; hasChildMatch: boolean } {
      const tagMatch = node.tag && node.tag.toLowerCase().includes(query);
      const classMatch = node.className && node.className.toLowerCase().includes(query);
      const idMatch = node.elementId && node.elementId.toLowerCase().includes(query);
      const textMatch = node.text && node.text.toLowerCase().includes(query);
      const nameMatch = node.name && node.name.toLowerCase().includes(query);

      const isDirectMatch = !!(tagMatch || classMatch || idMatch || textMatch || nameMatch);
      if (isDirectMatch) totalMatches++;

      let matchingChildren: DOMTreeNode[] = [];
      let hasChildMatch = false;

      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          const res = filterNode(child);
          if (res.isMatch || res.hasChildMatch) {
            hasChildMatch = true;
            if (res.node) {
              matchingChildren.push(res.node);
            }
          }
        }
      }

      if (isDirectMatch || hasChildMatch) {
        return {
          node: {
            ...node,
            _isMatch: isDirectMatch,
            _hasMatchingChild: hasChildMatch,
            children: matchingChildren
          },
          isMatch: isDirectMatch,
          hasChildMatch
        };
      }

      return { node: null, isMatch: false, hasChildMatch: false };
    }

    const result = filterNode(domTree);
    return { filteredTree: result.node, matchCount: totalMatches };
  }, [domTree, searchQuery]);

  // Context Menu Actions
  const handleContextMenu = (e: React.MouseEvent, node: DOMTreeNode) => {
    e.preventDefault();
    e.stopPropagation();

    // Position menu clamped inside the panel / viewport
    const menuWidth = 220;
    const menuHeight = 280;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);

    setContextMenu({ x, y, node, showAddMenu: false });
  };

  const handleDuplicateElement = async (node: DOMTreeNode) => {
    setContextMenu(null);
    if (!domTree) return;

    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const newId = `${node.tag || 'node'}_${randomSuffix}`;

    function cloneWithNewIds(n: DOMTreeNode): DOMTreeNode {
      return {
        ...n,
        id: `${n.tag || 'node'}_${Math.random().toString(36).substring(2, 7)}`,
        elementId: n.elementId ? `${n.elementId}_copy` : '',
        children: Array.isArray(n.children) ? n.children.map(cloneWithNewIds) : []
      };
    }

    const duplicatedNode: DOMTreeNode = {
      ...cloneWithNewIds(node),
      id: newId,
      name: `${node.name || node.tag} (Copy)`
    };

    const newTree = insertNodeIntoTree(domTree, node.id, duplicatedNode, 'after');
    setDomTree(newTree);
    handleSelect(newId);
    showToast(`Duplicated <${node.tag}>`);

    await executeDomBridgeCommand('duplicateElementById', { id: node.id });
  };

  const handleDeleteElement = async (node: DOMTreeNode) => {
    setContextMenu(null);
    if (!domTree) return;

    const { newTree } = removeNodeFromTree(domTree, node.id);
    setDomTree(newTree);
    if (selectedDomId === node.id) {
      setSelectedDomId(null);
    }
    showToast(`Deleted <${node.tag}>`);

    await executeDomBridgeCommand('deleteElementById', { id: node.id });
  };

  const handleAddChildElement = async (parentNode: DOMTreeNode, tag: string = 'div') => {
    setContextMenu(null);
    if (!domTree) return;

    const newId = `${tag}_${Math.random().toString(36).substring(2, 7)}`;
    const newChildNode: DOMTreeNode = {
      id: newId,
      name: tag,
      tag: tag,
      elementId: '',
      className: `new-${tag}`,
      text: '',
      visible: true,
      locked: false,
      children: []
    };

    const newTree = insertNodeIntoTree(domTree, parentNode.id, newChildNode, 'inside');
    setDomTree(newTree);
    // Expand parent so new child is visible
    setCollapsedNodes((prev) => ({ ...prev, [parentNode.id]: false }));
    handleSelect(newId);
    showToast(`Added <${tag}> inside <${parentNode.tag}>`);

    await executeDomBridgeCommand('addChildElement', { parentId: parentNode.id, tag });
  };

  const handleCopyCssSelector = (node: DOMTreeNode) => {
    setContextMenu(null);
    const selector = generateCssSelector(node, domTree);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(selector).then(() => {
        showToast(`Copied: ${selector}`);
      }).catch(() => {
        showToast(`Copied selector!`);
      });
    } else {
      showToast(`Copied: ${selector}`);
    }
  };

  const handleExpandCollapseBranch = (node: DOMTreeNode, expand: boolean) => {
    setContextMenu(null);
    const newMap: Record<string, boolean> = {};
    function traverse(n: DOMTreeNode) {
      newMap[n.id] = !expand;
      if (n.children) {
        n.children.forEach(traverse);
      }
    }
    traverse(node);
    setCollapsedNodes((prev) => ({ ...prev, ...newMap }));
    showToast(expand ? 'Expanded branch' : 'Collapsed branch');
  };

  // Drag and Drop Handlers
  const handleDragStart = (node: DOMTreeNode, e: React.DragEvent) => {
    e.stopPropagation();
    setDraggedNode(node);
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (targetNode: DOMTreeNode, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedNode || draggedNode.id === targetNode.id) {
      setDropTarget(null);
      return;
    }

    // Prevent dropping into descendants (avoids tree cycle loops)
    if (isDescendantNode(draggedNode, targetNode.id)) {
      setDropTarget(null);
      e.dataTransfer.dropEffect = 'none';
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const height = rect.height;

    let position: 'before' | 'after' | 'inside';
    // If target is top-level root, default to inside unless near edges
    if (targetNode.id === domTree?.id) {
      position = 'inside';
    } else if (offsetY < height * 0.28) {
      position = 'before';
    } else if (offsetY > height * 0.72) {
      position = 'after';
    } else {
      position = 'inside';
    }

    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: targetNode.id, position });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
  };

  const handleDrop = async (targetNode: DOMTreeNode, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedNode || !domTree || !dropTarget || dropTarget.id !== targetNode.id) {
      setDraggedNode(null);
      setDropTarget(null);
      return;
    }

    if (draggedNode.id === targetNode.id || isDescendantNode(draggedNode, targetNode.id)) {
      setDraggedNode(null);
      setDropTarget(null);
      return;
    }

    const position = dropTarget.position;
    const sourceId = draggedNode.id;
    const targetId = targetNode.id;

    // 1. Remove source node from current position
    const { newTree: treeWithoutSource, removed } = removeNodeFromTree(domTree, sourceId);
    if (!treeWithoutSource || !removed) {
      setDraggedNode(null);
      setDropTarget(null);
      return;
    }

    // 2. Insert into target position
    const updatedTree = insertNodeIntoTree(treeWithoutSource, targetId, removed, position);

    // 3. Update scene store optimistically
    setDomTree(updatedTree);
    if (position === 'inside') {
      setCollapsedNodes((prev) => ({ ...prev, [targetId]: false }));
    }
    handleSelect(sourceId);

    showToast(`Moved <${draggedNode.tag}> ${position} <${targetNode.tag}>`);

    setDraggedNode(null);
    setDropTarget(null);

    // 4. Send command to guest view via bridge / CDP
    await executeDomBridgeCommand('reparentOrReorderElement', {
      sourceId,
      targetId,
      position
    });
  };

  const handleDragEnd = () => {
    setDraggedNode(null);
    setDropTarget(null);
  };

  // Render DOM Node Row recursively
  const renderDOMNode = (node: DOMTreeNode, depth: number = 0) => {
    if (!node) return null;

    const isSelected = selectedDomId === node.id;
    const hasChildren = node.children && node.children.length > 0;
    const isSearching = searchQuery.trim().length > 0;
    // Auto-expand if searching and matching child exists, otherwise check user collapse state
    const isCollapsed = isSearching ? false : !!collapsedNodes[node.id];
    const tagColor = getTagColor(node.tag);

    const isDraggingThis = draggedNode?.id === node.id;
    const isDropTargetThis = dropTarget?.id === node.id;
    const dropPos = isDropTargetThis ? dropTarget?.position : null;
    const isDirectSearchMatch = !!node._isMatch;

    return (
      <div
        key={node.id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative'
        }}
      >
        <div
          draggable={true}
          onDragStart={(e) => handleDragStart(node, e)}
          onDragOver={(e) => handleDragOver(node, e)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(node, e)}
          onDragEnd={handleDragEnd}
          onClick={() => handleSelect(node.id)}
          onContextMenu={(e) => handleContextMenu(e, node)}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '4px 8px',
            paddingLeft: `${depth * 12 + 6}px`,
            background: isDraggingThis
              ? 'rgba(139, 92, 246, 0.1)'
              : dropPos === 'inside'
              ? 'rgba(139, 92, 246, 0.28)'
              : isSelected
              ? 'rgba(139, 92, 246, 0.25)'
              : isDirectSearchMatch
              ? 'rgba(234, 179, 8, 0.12)'
              : 'transparent',
            borderLeft: isSelected
              ? '2px solid #8b5cf6'
              : isDirectSearchMatch
              ? '2px solid #eab308'
              : '2px solid transparent',
            borderTop: dropPos === 'before' ? '2px solid #8b5cf6' : 'none',
            borderBottom: dropPos === 'after' ? '2px solid #8b5cf6' : 'none',
            outline: dropPos === 'inside' ? '1px dashed #a78bfa' : 'none',
            outlineOffset: '-1px',
            opacity: isDraggingThis ? 0.35 : 1,
            color: isSelected ? '#ffffff' : '#d1d5db',
            cursor: 'grab',
            userSelect: 'none',
            fontSize: '11px',
            gap: '4px',
            transition: 'background 0.12s, border-color 0.12s',
            boxShadow:
              dropPos === 'before'
                ? '0 -2px 8px rgba(139, 92, 246, 0.6)'
                : dropPos === 'after'
                ? '0 2px 8px rgba(139, 92, 246, 0.6)'
                : 'none'
          }}
          className="layer-item"
        >
          {/* Collapse Arrow */}
          <div
            onClick={(e) => hasChildren && toggleCollapse(node.id, e)}
            style={{
              width: '14px',
              height: '14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: hasChildren ? 'pointer' : 'default',
              color: '#6b7280',
              flexShrink: 0
            }}
          >
            {hasChildren && (isCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />)}
          </div>

          {/* Tag Badge */}
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              fontWeight: 700,
              color: tagColor,
              background: 'rgba(255, 255, 255, 0.06)',
              padding: '1px 4px',
              borderRadius: '3px',
              flexShrink: 0,
              boxShadow: isDirectSearchMatch ? '0 0 6px rgba(234, 179, 8, 0.4)' : 'none'
            }}
          >
            &lt;{node.tag}&gt;
          </span>

          {/* ID or Class or Text */}
          <span
            style={{
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: '11px',
              color: isSelected ? '#ffffff' : isDirectSearchMatch ? '#fef08a' : '#9ca3af'
            }}
          >
            {node.elementId && <span style={{ color: '#38bdf8' }}>#{node.elementId} </span>}
            {node.className && (
              <span style={{ color: '#818cf8' }}>.{node.className.trim().split(/\s+/)[0]} </span>
            )}
            {node.text && <span style={{ color: '#6b7280', fontStyle: 'italic' }}>"{node.text}"</span>}
          </span>

          {/* Inside Drop Indicator Badge */}
          {dropPos === 'inside' && (
            <span
              style={{
                fontSize: '9px',
                color: '#c4b5fd',
                background: 'rgba(139, 92, 246, 0.3)',
                padding: '1px 4px',
                borderRadius: '3px',
                display: 'flex',
                alignItems: 'center',
                gap: '2px'
              }}
            >
              <CornerDownRight size={9} /> Drop inside
            </span>
          )}

          {/* Direct Match Indicator */}
          {isDirectSearchMatch && !dropPos && (
            <span
              style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: '#eab308',
                boxShadow: '0 0 6px #eab308',
                marginRight: '2px',
                flexShrink: 0
              }}
              title="Search Match"
            />
          )}

          {/* Visibility Toggle */}
          <button
            onClick={(e) => handleToggleVisibility(node.id, e)}
            style={{
              background: 'none',
              border: 'none',
              color: node.visible !== false ? '#9ca3af' : '#ef4444',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
            title={node.visible !== false ? 'Hide Element' : 'Show Element'}
          >
            {node.visible !== false ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </div>

        {/* Children Subtree */}
        {hasChildren && !isCollapsed && (
          <div>{node.children!.map((child) => renderDOMNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const commonChildTags = ['div', 'span', 'button', 'p', 'input', 'section', 'img'];

  return (
    <div
      className="glass-panel"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: 'none',
        borderRight: '1px solid rgba(255, 255, 255, 0.05)',
        borderRadius: 0,
        background: 'rgba(15, 15, 20, 0.95)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Top Header */}
      <div
        style={{
          padding: '10px 12px 8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
            color: '#9ca3af',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>DOM Tree Layers</span>
            {searchQuery && (
              <span
                style={{
                  fontSize: '9px',
                  color: matchCount > 0 ? '#34d399' : '#ef4444',
                  background: matchCount > 0 ? 'rgba(52, 211, 153, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  padding: '1px 5px',
                  borderRadius: '10px',
                  fontWeight: 600
                }}
              >
                {matchCount} match{matchCount === 1 ? '' : 'es'}
              </span>
            )}
          </div>
          {domTree && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#10b981',
                  boxShadow: '0 0 8px #10b981'
                }}
              />
              <span style={{ fontSize: '10px', color: '#10b981', fontWeight: 500 }}>Live Sync</span>
            </div>
          )}
        </div>

        {/* Search & Filter Bar */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: '8px',
              color: searchQuery ? '#a78bfa' : '#6b7280',
              pointerEvents: 'none'
            }}
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by tag, class, id, text..."
            style={{
              width: '100%',
              background: 'rgba(0, 0, 0, 0.45)',
              border: searchQuery
                ? '1px solid rgba(139, 92, 246, 0.4)'
                : '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              padding: '5px 24px 5px 26px',
              color: '#f3f4f6',
              fontSize: '11px',
              fontFamily: 'inherit',
              outline: 'none',
              transition: 'all 0.15s ease'
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = '#8b5cf6';
              e.currentTarget.style.boxShadow = '0 0 10px rgba(139, 92, 246, 0.25)';
            }}
            onBlur={(e) => {
              if (!searchQuery) {
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
              style={{
                position: 'absolute',
                right: '6px',
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              title="Clear Filter"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Tree Content Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {domTree ? (
          filteredTree ? (
            renderDOMNode(filteredTree)
          ) : (
            <div
              style={{
                padding: '28px 16px',
                color: '#6b7280',
                fontSize: '11px',
                textAlign: 'center',
                lineHeight: 1.5
              }}
            >
              <Filter size={20} style={{ margin: '0 auto 8px', color: '#4b5563' }} />
              <div>No elements matching "{searchQuery}"</div>
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  marginTop: '8px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#a78bfa',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                Clear Filter
              </button>
            </div>
          )
        ) : (
          <div
            style={{
              padding: '24px 16px',
              color: '#6b7280',
              fontSize: '11px',
              textAlign: 'center',
              lineHeight: 1.5
            }}
          >
            <Box size={24} style={{ margin: '0 auto 8px', color: '#4b5563' }} />
            <div>Listening to Live Website...</div>
            <div style={{ fontSize: '10px', marginTop: '4px', color: '#4b5563' }}>
              DOM nodes will stream here automatically.
            </div>
          </div>
        )}
      </div>

      {/* Floating Action Confirmation Toast */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            right: '12px',
            background: 'rgba(20, 20, 28, 0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(139, 92, 246, 0.4)',
            color: '#f3f4f6',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.6), 0 0 12px rgba(139, 92, 246, 0.3)',
            zIndex: 10000,
            animation: 'fadeIn 0.15s ease-out'
          }}
        >
          <Check size={13} color="#10b981" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {toastMessage}
          </span>
        </div>
      )}

      {/* Custom Right-Click Context Menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            width: '210px',
            background: 'rgba(18, 18, 24, 0.96)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.75), 0 0 1px rgba(255, 255, 255, 0.2)',
            padding: '4px',
            zIndex: 99999,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            color: '#e5e7eb',
            fontSize: '11px'
          }}
        >
          {/* Header with target element details */}
          <div
            style={{
              padding: '5px 8px 6px',
              borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
              marginBottom: '2px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <span
              style={{
                fontFamily: 'monospace',
                fontWeight: 700,
                fontSize: '10px',
                color: getTagColor(contextMenu.node.tag),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              &lt;{contextMenu.node.tag}&gt;
              {contextMenu.node.elementId && `#${contextMenu.node.elementId}`}
              {contextMenu.node.className && `.${contextMenu.node.className.trim().split(/\s+/)[0]}`}
            </span>
          </div>

          {/* Action 1: Duplicate Element */}
          <button
            onClick={() => handleDuplicateElement(contextMenu.node)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '5px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#f3f4f6',
              fontSize: '11px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Copy size={13} color="#a78bfa" />
              <span>Duplicate Element</span>
            </div>
            <span style={{ fontSize: '9px', color: '#6b7280' }}>Ctrl+D</span>
          </button>

          {/* Action 2: Add Child Element (with flyout options) */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() =>
                setContextMenu((prev) => (prev ? { ...prev, showAddMenu: !prev.showAddMenu } : null))
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: '5px 8px',
                background: contextMenu.showAddMenu ? 'rgba(139, 92, 246, 0.25)' : 'transparent',
                border: 'none',
                borderRadius: '5px',
                color: '#f3f4f6',
                fontSize: '11px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)')}
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = contextMenu.showAddMenu
                  ? 'rgba(139, 92, 246, 0.25)'
                  : 'transparent')
              }
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                <Plus size={13} color="#34d399" />
                <span>Add Child...</span>
              </div>
              <ChevronRight size={12} color="#6b7280" />
            </button>

            {/* Quick Tag Selector Submenu */}
            {contextMenu.showAddMenu && (
              <div
                style={{
                  marginTop: '2px',
                  background: 'rgba(24, 24, 32, 0.98)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '6px',
                  padding: '4px',
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '3px'
                }}
              >
                {commonChildTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => handleAddChildElement(contextMenu.node, tag)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '4px',
                      color: getTagColor(tag),
                      padding: '3px 4px',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                      textAlign: 'center',
                      fontWeight: 600
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.35)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')
                    }
                  >
                    &lt;{tag}&gt;
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Action 3: Copy CSS Selector */}
          <button
            onClick={() => handleCopyCssSelector(contextMenu.node)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              width: '100%',
              padding: '5px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#f3f4f6',
              fontSize: '11px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Code size={13} color="#38bdf8" />
            <span>Copy CSS Selector</span>
          </button>

          {/* Separator */}
          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '2px 0' }} />

          {/* Action 4: Toggle Visibility */}
          <button
            onClick={(e) => {
              setContextMenu(null);
              handleToggleVisibility(contextMenu.node.id, e);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              width: '100%',
              padding: '5px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#f3f4f6',
              fontSize: '11px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {contextMenu.node.visible !== false ? (
              <>
                <EyeOff size={13} color="#9ca3af" />
                <span>Hide Element</span>
              </>
            ) : (
              <>
                <Eye size={13} color="#10b981" />
                <span>Show Element</span>
              </>
            )}
          </button>

          {/* Action 5: Scroll & Select in Viewport */}
          <button
            onClick={() => {
              setContextMenu(null);
              handleSelect(contextMenu.node.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              width: '100%',
              padding: '5px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#f3f4f6',
              fontSize: '11px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Maximize2 size={13} color="#fbbf24" />
            <span>Select & Scroll to View</span>
          </button>

          {/* Action 6: Expand / Collapse Branch */}
          {contextMenu.node.children && contextMenu.node.children.length > 0 && (
            <button
              onClick={() =>
                handleExpandCollapseBranch(contextMenu.node, !!collapsedNodes[contextMenu.node.id])
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                width: '100%',
                padding: '5px 8px',
                background: 'transparent',
                border: 'none',
                borderRadius: '5px',
                color: '#f3f4f6',
                fontSize: '11px',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'background 0.1s'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(139, 92, 246, 0.25)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <FolderPlus size={13} color="#818cf8" />
              <span>
                {collapsedNodes[contextMenu.node.id] ? 'Expand Branch' : 'Collapse Branch'}
              </span>
            </button>
          )}

          {/* Separator */}
          <div style={{ height: '1px', background: 'rgba(255, 255, 255, 0.06)', margin: '2px 0' }} />

          {/* Action 7: Delete Element */}
          <button
            onClick={() => handleDeleteElement(contextMenu.node)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '5px 8px',
              background: 'transparent',
              border: 'none',
              borderRadius: '5px',
              color: '#f87171',
              fontSize: '11px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.1s'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <Trash2 size={13} color="#ef4444" />
              <span>Delete</span>
            </div>
            <span style={{ fontSize: '9px', color: '#f87171', opacity: 0.7 }}>Del</span>
          </button>
        </div>
      )}
    </div>
  );
}

