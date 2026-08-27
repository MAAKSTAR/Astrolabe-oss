import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { temporal, type TemporalState } from 'zundo';

export type NodeType = 'mesh' | 'group' | 'camera' | 'light' | 'component' | 'svg';

export interface Transform3D {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface ScrollKeyframe {
  id: string;
  scrollPixel: number; // in pixels instead of time
  value: number | number[] | string;
  easing: string; // e.g. "power2.inOut"
}

export interface ScrollTrack {
  id: string;
  nodeId: string;
  property: string;
  keyframes: ScrollKeyframe[];
}

export interface SceneNode {
  id: string;
  name: string;
  type: NodeType;
  geometryType?: 'box' | 'sphere' | 'cylinder' | 'plane';
  parentId: string | null;
  children: string[];
  transform: Transform3D;
  properties: Record<string, any>;
  visible: boolean;
  locked: boolean;
}

export interface SceneStore {
  activeProjectFile: string;
  nodes: Record<string, SceneNode>;
  rootIds: string[];
  selectedNodeId: string | null;
  activeTool: 'select' | 'move' | 'rotate' | 'scale';
  inspectActive: boolean;
  scrollTracks: ScrollTrack[];
  scrollPosition: number;
  scrollHeight: number;

  // DOM Visual Editor State
  domTree: any | null;
  selectedDomId: string | null;
  selectedElementBounds: { x: number, y: number, width: number, height: number } | null;
  selectedElementPath: { file: string; line: string; column: string; selector?: string } | null;
  selectedElementStyles: Record<string, string> | null;
  selectedElementText: string | null;

  workspaceRoot: string | null;
  workspaceFiles: string[];

  // Actions
  setWorkspaceRoot: (path: string | null) => void;
  setWorkspaceFiles: (files: string[]) => void;
  setActiveProjectFile: (file: string) => void;
  setDomTree: (tree: any) => void;
  setSelectedDomId: (id: string | null) => void;
  setSelectedElementText: (text: string) => void;
  setInspectActive: (active: boolean) => void;
  toggleInspectActive: () => void;
  addMeshNode: (geometryType: 'box' | 'sphere' | 'cylinder' | 'plane') => void;
  removeSelectedNode: () => void;
  selectNode: (id: string | null) => void;
  toggleNodeVisibility: (id: string) => void;
  toggleNodeLock: (id: string) => void;
  updateTransform: (id: string, transform: Partial<Transform3D>) => void;
  setTool: (tool: 'select' | 'move' | 'rotate' | 'scale') => void;
  addScrollTrack: (track: ScrollTrack) => void;
  removeScrollTrack: (trackId: string) => void;
  addScrollKeyframe: (trackId: string, keyframe: ScrollKeyframe) => void;
  updateScrollKeyframe: (trackId: string, kfId: string, updates: Partial<ScrollKeyframe>) => void;
  removeScrollKeyframe: (trackId: string, kfId: string) => void;
  setScrollPosition: (pos: number) => void;
  setScrollHeight: (height: number) => void;
  setSelectedElement: (bounds: any, path: { file: string; line: string; column: string; selector?: string } | null, styles: Record<string, string> | null, domId?: string, text?: string) => void;
  updateSelectedElementStyle: (styleName: string, value: string) => void;
}

export const useSceneStore = create<SceneStore>()(
  persist(
    temporal(
      (set) => ({
        workspaceRoot: null,
        workspaceFiles: [],
        activeProjectFile: '',
        nodes: {
          'main-camera': {
            id: 'main-camera',
            name: 'Perspective Camera',
            type: 'camera',
            parentId: null,
            children: [],
            transform: {
              position: [0, 2, 5],
              rotation: [0, 0, 0],
              scale: [1, 1, 1]
            },
            properties: { fov: 60 },
            visible: true,
            locked: false
          },
          'dir-light': {
            id: 'dir-light',
            name: 'Directional Light',
            type: 'light',
            parentId: null,
            children: [],
            transform: {
              position: [5, 10, 7],
              rotation: [0, 0, 0],
              scale: [1, 1, 1]
            },
            properties: { intensity: 1.2 },
            visible: true,
            locked: false
          }
        },
        rootIds: ['main-camera', 'dir-light'],
        selectedNodeId: null,
        activeTool: 'select',
        inspectActive: true,
        scrollTracks: [],
        scrollPosition: 0,
        scrollHeight: 2000,

        // Initial DOM Visual Editor State
        domTree: null,
        selectedDomId: null,
        selectedElementBounds: null,
        selectedElementPath: null,
        selectedElementStyles: null,
        selectedElementText: null,

        setWorkspaceRoot: (path) => set({ workspaceRoot: path }),
        setWorkspaceFiles: (files) => set({ workspaceFiles: files }),
        setActiveProjectFile: (file) => set({ activeProjectFile: file }),
        setDomTree: (tree) => set({ domTree: tree }),
        setSelectedDomId: (id) => set({ selectedDomId: id }),
        setSelectedElementText: (text) => set({ selectedElementText: text }),
        setInspectActive: (active) => set({ inspectActive: active }),
        toggleInspectActive: () => set((state) => ({ inspectActive: !state.inspectActive })),

        addMeshNode: (geometryType) => set((state) => {
          const id = `mesh-${Date.now()}`;
          const name = `Mesh (${geometryType.charAt(0).toUpperCase() + geometryType.slice(1)})`;
          const colors = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ec4899'];
          const color = colors[Math.floor(Math.random() * colors.length)];

          const newNode: SceneNode = {
            id,
            name,
            type: 'mesh',
            geometryType,
            parentId: null,
            children: [],
            transform: {
              position: [(Math.random() - 0.5) * 4, 1, (Math.random() - 0.5) * 4],
              rotation: [0, 0, 0],
              scale: [1, 1, 1]
            },
            properties: { color, roughness: 0.3 },
            visible: true,
            locked: false
          };

          return {
            nodes: { ...state.nodes, [id]: newNode },
            rootIds: [...state.rootIds, id],
            selectedNodeId: id
          };
        }),

        removeSelectedNode: () => set((state) => {
          if (!state.selectedNodeId) return state;
          const id = state.selectedNodeId;
          const newNodes = { ...state.nodes };
          delete newNodes[id];
          return {
            nodes: newNodes,
            rootIds: state.rootIds.filter((rootId) => rootId !== id),
            selectedNodeId: null
          };
        }),

        selectNode: (id) => set({ selectedNodeId: id }),

        updateTransform: (id, transform) => set((state) => {
          const node = state.nodes[id];
          if (!node) return state;
          return {
            nodes: {
              ...state.nodes,
              [id]: {
                ...node,
                transform: { ...node.transform, ...transform }
              }
            }
          };
        }),

        toggleNodeVisibility: (id) => set((state) => {
          const node = state.nodes[id];
          if (!node) return state;
          return { nodes: { ...state.nodes, [id]: { ...node, visible: !node.visible } } };
        }),

        toggleNodeLock: (id) => set((state) => {
          const node = state.nodes[id];
          if (!node) return state;
          return { nodes: { ...state.nodes, [id]: { ...node, locked: !node.locked } } };
        }),

        setTool: (tool) => set({ activeTool: tool }),

        addScrollTrack: (track) => set((state) => ({
          scrollTracks: [...state.scrollTracks.filter(t => t.id !== track.id), track]
        })),

        removeScrollTrack: (trackId) => set((state) => ({
          scrollTracks: state.scrollTracks.filter(t => t.id !== trackId)
        })),

        addScrollKeyframe: (trackId, keyframe) => set((state) => ({
          scrollTracks: state.scrollTracks.map((t) => {
            if (t.id === trackId) {
              const existingFiltered = t.keyframes.filter(k => k.id !== keyframe.id);
              return { ...t, keyframes: [...existingFiltered, keyframe].sort((a, b) => a.scrollPixel - b.scrollPixel) };
            }
            return t;
          })
        })),

        updateScrollKeyframe: (trackId, kfId, updates) => set((state) => ({
          scrollTracks: state.scrollTracks.map((t) => {
            if (t.id === trackId) {
              return {
                ...t,
                keyframes: t.keyframes.map(k => k.id === kfId ? { ...k, ...updates } : k).sort((a, b) => a.scrollPixel - b.scrollPixel)
              };
            }
            return t;
          })
        })),

        removeScrollKeyframe: (trackId, kfId) => set((state) => ({
          scrollTracks: state.scrollTracks.map((t) => {
            if (t.id === trackId) {
              return {
                ...t,
                keyframes: t.keyframes.filter(k => k.id !== kfId)
              };
            }
            return t;
          })
        })),

        setScrollPosition: (pos) => set({ scrollPosition: pos }),
        setScrollHeight: (height) => set({ scrollHeight: height }),
        
        setSelectedElement: (bounds, path, styles, domId, text) => set({
          selectedElementBounds: bounds,
          selectedElementPath: path,
          selectedElementStyles: styles,
          selectedDomId: domId || null,
          selectedElementText: text !== undefined ? text : null,
          selectedNodeId: null // clear 3D selection when DOM element is selected
        }),

        updateSelectedElementStyle: (styleName, value) => set((state) => {
          if (!state.selectedElementStyles) return state;
          return {
            selectedElementStyles: {
              ...state.selectedElementStyles,
              [styleName]: value
            }
          };
        })
      }),
      {
        limit: 100,
        partialize: (state) => ({
          workspaceRoot: state.workspaceRoot,
          workspaceFiles: state.workspaceFiles,
          activeProjectFile: state.activeProjectFile,
          nodes: state.nodes,
          rootIds: state.rootIds,
          selectedNodeId: state.selectedNodeId,
          activeTool: state.activeTool,
          inspectActive: state.inspectActive,
          scrollTracks: state.scrollTracks,
          scrollPosition: state.scrollPosition,
          scrollHeight: state.scrollHeight,
          domTree: state.domTree,
          selectedDomId: state.selectedDomId,
          selectedElementBounds: state.selectedElementBounds,
          selectedElementPath: state.selectedElementPath,
          selectedElementStyles: state.selectedElementStyles,
          selectedElementText: state.selectedElementText,
        })
      }
    ),
    {
      name: 'astrolabe-workspace-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        workspaceRoot: state.workspaceRoot,
        workspaceFiles: state.workspaceFiles,
        activeProjectFile: state.activeProjectFile,
        nodes: state.nodes,
        rootIds: state.rootIds,
        selectedNodeId: state.selectedNodeId,
        activeTool: state.activeTool,
        inspectActive: state.inspectActive,
        scrollTracks: state.scrollTracks,
        scrollPosition: state.scrollPosition,
        scrollHeight: state.scrollHeight,
        domTree: state.domTree,
        selectedDomId: state.selectedDomId,
        selectedElementBounds: state.selectedElementBounds,
        selectedElementPath: state.selectedElementPath,
        selectedElementStyles: state.selectedElementStyles,
        selectedElementText: state.selectedElementText,
      })
    }
  )
);

export const useTemporalStore = create(useSceneStore.temporal);
export type { TemporalState };
