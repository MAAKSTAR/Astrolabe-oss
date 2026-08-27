import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, TransformControls, GizmoHelper, GizmoViewport } from '@react-three/drei';
import { useSceneStore, SceneNode } from '../core/SceneGraph';
import { BrowserBridge } from '../core/BrowserBridge';
import {
  Globe,
  RefreshCw,
  Eye,
  EyeOff,
  Grid,
  Layers,
  Box,
  Monitor,
  Smartphone,
  Tablet,
  Laptop,
  Tv,
  Maximize2,
  RotateCw,
  Ruler
} from 'lucide-react';

interface DevicePreset {
  id: string;
  name: string;
  width: number;
  height: number;
  category: 'mobile' | 'tablet' | 'desktop' | 'responsive';
  icon: any;
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'responsive', name: 'Responsive (100%)', width: 0, height: 0, category: 'responsive', icon: Maximize2 },
  { id: 'mobile-s', name: 'Mobile S (320px)', width: 320, height: 568, category: 'mobile', icon: Smartphone },
  { id: 'mobile', name: 'Mobile (375px)', width: 375, height: 667, category: 'mobile', icon: Smartphone },
  { id: 'mobile-l', name: 'Mobile L (425px)', width: 425, height: 850, category: 'mobile', icon: Smartphone },
  { id: 'tablet', name: 'Tablet (768px)', width: 768, height: 1024, category: 'tablet', icon: Tablet },
  { id: 'laptop', name: 'Laptop (1024px)', width: 1024, height: 768, category: 'desktop', icon: Laptop },
  { id: 'desktop', name: 'Desktop (1440px)', width: 1440, height: 900, category: 'desktop', icon: Monitor },
  { id: 'desktop-4k', name: '4K Display (1920px)', width: 1920, height: 1080, category: 'desktop', icon: Tv },
];

const BREAKPOINT_RANGES = [
  { id: 'mobile', label: 'Mobile (< 768px)', min: 0, max: 767, targetWidth: 375, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)' },
  { id: 'tablet', label: 'Tablet (768px - 1023px)', min: 768, max: 1023, targetWidth: 768, color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.4)' },
  { id: 'desktop', label: 'Desktop (1024px - 1439px)', min: 1024, max: 1439, targetWidth: 1440, color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.4)' },
  { id: 'wide', label: 'Wide (> 1440px)', min: 1440, max: 3840, targetWidth: 1920, color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)' },
];

function AnimatedNode({ node }: { node: SceneNode }) {
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);
  const selectNode = useSceneStore((state) => state.selectNode);
  const scrollPosition = useSceneStore((state) => state.scrollPosition);
  const scrollTracks = useSceneStore((state) => state.scrollTracks);
  const { invalidate } = useThree();

  const meshRef = useRef<any>(null);
  const isSelected = selectedNodeId === node.id;

  const relevantTrack = useMemo(() => {
    return scrollTracks.find((t: any) => t.nodeId === node.id && t.property === 'position.y');
  }, [scrollTracks, node.id]);

  const keyframesHash = useMemo(() => {
    if (!relevantTrack || !relevantTrack.keyframes) return '';
    return relevantTrack.keyframes.map((k: any) => `${k.scrollPixel}:${k.value}`).join('|');
  }, [relevantTrack]);

  const lastCalculatedRef = useRef<{ scrollPos: number; trackHash: string }>({
    scrollPos: -1,
    trackHash: ''
  });

  // Calculate and update mesh position only when scrollPosition or track keyframes actually change
  useEffect(() => {
    if (!relevantTrack || !meshRef.current || relevantTrack.keyframes.length < 2) return;
    if (
      lastCalculatedRef.current.scrollPos === scrollPosition &&
      lastCalculatedRef.current.trackHash === keyframesHash
    ) {
      return;
    }

    const kf1 = relevantTrack.keyframes[0];
    const kf2 = relevantTrack.keyframes[1];
    if (scrollPosition >= kf1.scrollPixel && scrollPosition <= kf2.scrollPixel) {
      const progress = (scrollPosition - kf1.scrollPixel) / (kf2.scrollPixel - kf1.scrollPixel || 1);
      const startVal = typeof kf1.value === 'number' ? kf1.value : 1;
      const endVal = typeof kf2.value === 'number' ? kf2.value : 3;
      const newY = startVal + (endVal - startVal) * Math.sin(progress * Math.PI);
      if (meshRef.current.position.y !== newY) {
        meshRef.current.position.y = newY;
        invalidate();
      }
    }

    lastCalculatedRef.current = {
      scrollPos: scrollPosition,
      trackHash: keyframesHash
    };
  }, [scrollPosition, keyframesHash, relevantTrack, invalidate]);

  useFrame(() => {
    if (!relevantTrack || !meshRef.current || relevantTrack.keyframes.length < 2) return;
    if (
      lastCalculatedRef.current.scrollPos === scrollPosition &&
      lastCalculatedRef.current.trackHash === keyframesHash
    ) {
      return;
    }

    const kf1 = relevantTrack.keyframes[0];
    const kf2 = relevantTrack.keyframes[1];
    if (scrollPosition >= kf1.scrollPixel && scrollPosition <= kf2.scrollPixel) {
      const progress = (scrollPosition - kf1.scrollPixel) / (kf2.scrollPixel - kf1.scrollPixel || 1);
      const startVal = typeof kf1.value === 'number' ? kf1.value : 1;
      const endVal = typeof kf2.value === 'number' ? kf2.value : 3;
      const newY = startVal + (endVal - startVal) * Math.sin(progress * Math.PI);
      if (meshRef.current.position.y !== newY) {
        meshRef.current.position.y = newY;
      }
    }

    lastCalculatedRef.current = {
      scrollPos: scrollPosition,
      trackHash: keyframesHash
    };
  });

  const renderGeometry = () => {
    switch (node.geometryType) {
      case 'sphere': return <sphereGeometry args={[1, 32, 32]} />;
      case 'cylinder': return <cylinderGeometry args={[1, 1, 2, 32]} />;
      case 'plane': return <planeGeometry args={[2, 2]} />;
      case 'box':
      default:
        return <boxGeometry args={[1.5, 1.5, 1.5]} />;
    }
  };

  if (!node.visible) return null;

  return (
    <mesh
      ref={meshRef}
      key={node.id}
      position={node.transform.position}
      rotation={node.transform.rotation}
      scale={node.transform.scale}
      onClick={(e) => {
        e.stopPropagation();
        selectNode(node.id);
      }}
    >
      {renderGeometry()}
      <meshStandardMaterial
        color={node.properties.color || '#8b5cf6'}
        roughness={node.properties.roughness || 0.3}
        wireframe={isSelected}
      />
    </mesh>
  );
}

function SceneObjects({ showGrid, show3DObjects }: { showGrid: boolean; show3DObjects: boolean }) {
  const nodes = useSceneStore((state) => state.nodes);
  const rootIds = useSceneStore((state) => state.rootIds);
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);
  const updateTransform = useSceneStore((state) => state.updateTransform);
  const activeTool = useSceneStore((state) => state.activeTool);

  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : null;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 10, 7]} intensity={1.2} castShadow />
      
      {showGrid && <gridHelper args={[30, 30, '#4f46e5', '#1e1b4b']} />}

      {show3DObjects && rootIds.map((id) => {
        const node = nodes[id];
        if (!node || node.type !== 'mesh') return null;
        return <AnimatedNode key={node.id} node={node} />;
      })}

      {show3DObjects && selectedNode && selectedNode.type === 'mesh' && selectedNode.visible && (
        <TransformControls
          mode={activeTool === 'rotate' ? 'rotate' : activeTool === 'scale' ? 'scale' : 'translate'}
          position={selectedNode.transform.position}
          onObjectChange={(e: any) => {
            if (e?.target?.object) {
              const obj = e.target.object;
              updateTransform(selectedNode.id, {
                position: [obj.position.x, obj.position.y, obj.position.z],
                rotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
                scale: [obj.scale.x, obj.scale.y, obj.scale.z]
              });
            }
          }}
        />
      )}
    </>
  );
}

export function Viewport3D() {
  const selectNode = useSceneStore((state) => state.selectNode);
  const [devServerUrl, setDevServerUrl] = useState<string>('http://localhost:8000/neon-snake/');
  const [showWebsiteBg, setShowWebsiteBg] = useState<boolean>(true);
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const [show3DObjects, setShow3DObjects] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'live' | 'overlay' | '3d'>('live');

  // Device Mode & Breakpoint State
  const [devicePreset, setDevicePreset] = useState<string>('responsive');
  const [deviceWidth, setDeviceWidth] = useState<number>(375);
  const [deviceHeight, setDeviceHeight] = useState<number>(667);
  const [isRotated, setIsRotated] = useState<boolean>(false);
  const [showRuler, setShowRuler] = useState<boolean>(true);
  const [hoveredRulerPx, setHoveredRulerPx] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const lastLoadedRef = useRef<string>('');

  const setSelectedElement = useSceneStore((state) => state.setSelectedElement);
  const selectedElementBounds = useSceneStore((state) => state.selectedElementBounds);

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const initialOffset = useRef({ x: 0, y: 0 });

  // Effective dimensions accounting for orientation flip
  const effectiveWidth = useMemo(() => {
    if (devicePreset === 'responsive') return 0;
    return isRotated ? deviceHeight : deviceWidth;
  }, [devicePreset, deviceWidth, deviceHeight, isRotated]);

  const effectiveHeight = useMemo(() => {
    if (devicePreset === 'responsive') return 0;
    return isRotated ? deviceWidth : deviceHeight;
  }, [devicePreset, deviceWidth, deviceHeight, isRotated]);

  // Determine active breakpoint category for badge display
  const activeBreakpoint = useMemo(() => {
    const w = devicePreset === 'responsive' ? 1440 : effectiveWidth;
    return (
      BREAKPOINT_RANGES.find((r) => w >= r.min && w <= r.max) ||
      BREAKPOINT_RANGES[BREAKPOINT_RANGES.length - 1]
    );
  }, [devicePreset, effectiveWidth]);

  // Synchronize guestView bounds with native Electron layer
  useEffect(() => {
    const updateGuestBounds = () => {
      if (!previewFrameRef.current) return;
      const rect = previewFrameRef.current.getBoundingClientRect();
      if ((viewMode === 'live' || viewMode === 'overlay') && showWebsiteBg) {
        BrowserBridge.setGuestBounds({
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(10, Math.round(rect.width)),
          height: Math.max(10, Math.round(rect.height))
        });
      } else {
        BrowserBridge.setGuestBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    };

    updateGuestBounds();
    window.addEventListener('resize', updateGuestBounds);

    let frameObserver: ResizeObserver | null = null;
    let workspaceObserver: ResizeObserver | null = null;

    if (previewFrameRef.current) {
      frameObserver = new ResizeObserver(updateGuestBounds);
      frameObserver.observe(previewFrameRef.current);
    }
    if (workspaceRef.current) {
      workspaceObserver = new ResizeObserver(updateGuestBounds);
      workspaceObserver.observe(workspaceRef.current);
    }

    return () => {
      window.removeEventListener('resize', updateGuestBounds);
      if (frameObserver) frameObserver.disconnect();
      if (workspaceObserver) workspaceObserver.disconnect();
    };
  }, [viewMode, showWebsiteBg, devicePreset, deviceWidth, deviceHeight, isRotated, showRuler]);

  const normalizeUrl = (url: string) => {
    let clean = url.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = 'http://' + clean;
    }
    try {
      const parsed = new URL(clean);
      if (!parsed.pathname.includes('.') && !parsed.pathname.endsWith('/')) {
        parsed.pathname += '/';
        clean = parsed.toString();
      }
    } catch (e) {}
    return clean;
  };

  // Load URL on mount only once
  useEffect(() => {
    const timer = setTimeout(() => {
      const targetUrl = normalizeUrl(devServerUrl);
      if (targetUrl && targetUrl !== lastLoadedRef.current) {
        lastLoadedRef.current = targetUrl;
        BrowserBridge.loadURL(targetUrl);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, []);

  const handleReload = () => {
    const targetUrl = normalizeUrl(devServerUrl);
    if (targetUrl) {
      lastLoadedRef.current = targetUrl;
      BrowserBridge.loadURL(targetUrl);
    }
  };

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'ASTROLABE_ELEMENT_SELECTED') {
        setSelectedElement(e.data.bounds, e.data.pathInfo, e.data.styles);
        setViewMode('live');
        setShowWebsiteBg(true);
        setDragOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [setSelectedElement]);

  const activeTool = useSceneStore((state) => state.activeTool);
  const updateSelectedElementStyle = useSceneStore((state) => state.updateSelectedElementStyle);

  const [isResizing, setIsResizing] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const resizeStartPos = useRef({ x: 0, y: 0 });
  const initialBounds = useRef({ width: 0, height: 0, x: 0, y: 0 });

  useEffect(() => {
    setDragOffset({ x: 0, y: 0 });
  }, [selectedElementBounds]);

  // Preset Selection Handlers
  const applyPreset = useCallback((presetId: string) => {
    const preset = DEVICE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setDevicePreset(preset.id);
    if (preset.id !== 'responsive') {
      setDeviceWidth(preset.width);
      setDeviceHeight(preset.height);
      setIsRotated(false);
    }
  }, []);

  const setExplicitWidth = useCallback((width: number) => {
    const clamped = Math.max(280, Math.min(3840, width));
    setDeviceWidth(clamped);
    const matchedPreset = DEVICE_PRESETS.find((p) => p.width === clamped && p.id !== 'responsive');
    if (matchedPreset) {
      setDevicePreset(matchedPreset.id);
      setDeviceHeight(matchedPreset.height);
    } else {
      setDevicePreset('custom');
    }
  }, []);

  const toggleOrientation = useCallback(() => {
    if (devicePreset === 'responsive') return;
    setIsRotated((prev) => !prev);
  }, [devicePreset]);

  // Device Frame Drag-to-Resize Handlers
  const [isDraggingFrameHandle, setIsDraggingFrameHandle] = useState<string | null>(null);
  const dragStartFrame = useRef({ startX: 0, startY: 0, startWidth: 0, startHeight: 0 });

  const handleFrameResizeStart = (handle: string, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsDraggingFrameHandle(handle);
    const currentW = effectiveWidth || previewFrameRef.current?.getBoundingClientRect().width || 800;
    const currentH = effectiveHeight || previewFrameRef.current?.getBoundingClientRect().height || 600;
    dragStartFrame.current = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: currentW,
      startHeight: currentH
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleFrameResizeMove = (e: React.PointerEvent) => {
    if (!isDraggingFrameHandle) return;
    const dx = e.clientX - dragStartFrame.current.startX;
    const dy = e.clientY - dragStartFrame.current.startY;

    if (isDraggingFrameHandle === 'e' || isDraggingFrameHandle === 'w') {
      const multiplier = 2; // centered horizontal frame resize
      const delta = isDraggingFrameHandle === 'e' ? dx * multiplier : -dx * multiplier;
      const newW = Math.max(280, Math.min(3840, Math.round(dragStartFrame.current.startWidth + delta)));
      setDeviceWidth(newW);
      setDevicePreset('custom');
    } else if (isDraggingFrameHandle === 's') {
      const newH = Math.max(200, Math.min(3840, Math.round(dragStartFrame.current.startHeight + dy)));
      setDeviceHeight(newH);
      setDevicePreset('custom');
    } else if (isDraggingFrameHandle === 'se') {
      const newW = Math.max(280, Math.min(3840, Math.round(dragStartFrame.current.startWidth + dx * 2)));
      const newH = Math.max(200, Math.min(3840, Math.round(dragStartFrame.current.startHeight + dy)));
      setDeviceWidth(newW);
      setDeviceHeight(newH);
      setDevicePreset('custom');
    }
  };

  const handleFrameResizeUp = (e: React.PointerEvent) => {
    if (isDraggingFrameHandle) {
      setIsDraggingFrameHandle(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  // Breakpoint Ruler Click & Hover Handlers
  const handleRulerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    setExplicitWidth(Math.round(clickX));
  };

  const handleRulerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!rulerRef.current) return;
    const rect = rulerRef.current.getBoundingClientRect();
    const hoverX = Math.max(0, Math.round(e.clientX - rect.left));
    setHoveredRulerPx(hoverX);
  };

  const handleRulerMouseLeave = () => {
    setHoveredRulerPx(null);
  };

  // Pointer Handlers for Move Tool on Selected Element
  const handlePointerDown = (e: React.PointerEvent) => {
    if (activeTool !== 'move') return;
    e.stopPropagation();
    setIsDragging(true);
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    initialOffset.current = { ...dragOffset };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (isDragging && activeTool === 'move') {
      const dx = Math.round(e.clientX - dragStartPos.current.x);
      const dy = Math.round(e.clientY - dragStartPos.current.y);
      const newOffset = {
        x: initialOffset.current.x + dx,
        y: initialOffset.current.y + dy
      };
      setDragOffset(newOffset);
      const transformVal = `translate(${newOffset.x}px, ${newOffset.y}px)`;
      BrowserBridge.applyLiveStyle({ transform: transformVal });
      if (updateSelectedElementStyle) updateSelectedElementStyle('transform', transformVal);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  // Pointer Handlers for Scale / Resize Tool on Selected Element
  const handleResizeStart = (dir: string, e: React.PointerEvent) => {
    e.stopPropagation();
    setIsResizing(dir);
    resizeStartPos.current = { x: e.clientX, y: e.clientY };
    initialBounds.current = {
      width: selectedElementBounds?.width || 100,
      height: selectedElementBounds?.height || 40,
      x: selectedElementBounds?.x || 0,
      y: selectedElementBounds?.y || 0
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!isResizing || !selectedElementBounds) return;
    const dx = e.clientX - resizeStartPos.current.x;
    const dy = e.clientY - resizeStartPos.current.y;
    let newW = initialBounds.current.width;
    let newH = initialBounds.current.height;

    if (isResizing.includes('e')) newW += dx;
    if (isResizing.includes('w')) newW -= dx;
    if (isResizing.includes('s')) newH += dy;
    if (isResizing.includes('n')) newH -= dy;

    newW = Math.max(10, Math.round(newW));
    newH = Math.max(10, Math.round(newH));

    BrowserBridge.applyLiveStyle({ width: `${newW}px`, height: `${newH}px` });
    if (updateSelectedElementStyle) {
      updateSelectedElementStyle('width', `${newW}px`);
      updateSelectedElementStyle('height', `${newH}px`);
    }
  };

  const handleResizeUp = (e: React.PointerEvent) => {
    if (isResizing) {
      setIsResizing(null);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  // Pointer Handlers for Rotate Tool on Selected Element
  const handleRotateStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    setIsRotating(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleRotateMove = (e: React.PointerEvent) => {
    if (!isRotating || !selectedElementBounds) return;
    const centerX = selectedElementBounds.x + selectedElementBounds.width / 2;
    const centerY = selectedElementBounds.y + selectedElementBounds.height / 2;
    const rad = Math.atan2(e.clientY - centerY, e.clientX - centerX);
    const deg = Math.round((rad * 180) / Math.PI + 90);
    const rotVal = `rotate(${deg}deg)`;
    BrowserBridge.applyLiveStyle({ transform: rotVal });
    if (updateSelectedElementStyle) updateSelectedElementStyle('transform', rotVal);
  };

  const handleRotateUp = (e: React.PointerEvent) => {
    if (isRotating) {
      setIsRotating(false);
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {}
    }
  };

  // Render dynamic ticks for the breakpoint ruler
  const rulerTicks = useMemo(() => {
    const ticks: JSX.Element[] = [];
    const maxPx = 3840;
    const keyBreakpoints = [320, 375, 425, 768, 1024, 1440, 1920];

    for (let px = 0; px <= maxPx; px += 50) {
      const isMajor = px % 100 === 0;
      const isKey = keyBreakpoints.includes(px);

      ticks.push(
        <div
          key={px}
          style={{
            position: 'absolute',
            left: `${px}px`,
            bottom: 0,
            width: isKey ? '2px' : '1px',
            height: isKey ? '14px' : isMajor ? '10px' : '6px',
            background: isKey ? '#8b5cf6' : isMajor ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)',
            pointerEvents: 'none'
          }}
        >
          {isMajor && (
            <span
              style={{
                position: 'absolute',
                top: '-13px',
                left: '2px',
                fontSize: '9px',
                fontFamily: 'monospace',
                color: isKey ? '#a78bfa' : 'rgba(255, 255, 255, 0.45)',
                fontWeight: isKey ? 700 : 500,
                userSelect: 'none',
                pointerEvents: 'none'
              }}
            >
              {px}
            </span>
          )}
        </div>
      );
    }
    return ticks;
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        background: viewMode === '3d' || !showWebsiteBg ? '#050508' : '#08080d',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 1. Viewport Top Floating Glass Control Bar */}
      <div
        style={{
          height: '42px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          background: 'rgba(18, 18, 26, 0.95)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '4px 12px',
          zIndex: 30,
          flexShrink: 0
        }}
      >
        {/* Left: Dev Server URL Input & Reload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
          <Globe size={14} color="#60a5fa" />
          <span style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600 }}>Live Dev Site:</span>
          <input
            type="text"
            className="glass-input"
            value={devServerUrl}
            onChange={(e) => setDevServerUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleReload();
            }}
            placeholder="http://localhost:3000"
            style={{ flex: 1, maxWidth: '280px', padding: '3px 8px', fontSize: '11px' }}
          />
          <button
            onClick={handleReload}
            className="glass-button"
            title="Reload Dev Site (Enter)"
            style={{ padding: '3px 8px' }}
          >
            <RefreshCw size={12} />
          </button>
        </div>

        {/* Right: View Mode & Overlay Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Toggle View Mode */}
          <div style={{ display: 'flex', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px', padding: '2px' }}>
            <button
              onClick={() => {
                setViewMode('live');
                setShowWebsiteBg(true);
                setShowGrid(false);
                setShow3DObjects(false);
              }}
              style={{
                background: viewMode === 'live' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                color: viewMode === 'live' ? '#818cf8' : '#9ca3af',
                border: 'none',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Full Web App Editing Mode"
            >
              <Monitor size={12} /> Live Site
            </button>
            <button
              onClick={() => {
                setViewMode('overlay');
                setShowWebsiteBg(true);
                setShow3DObjects(true);
              }}
              style={{
                background: viewMode === 'overlay' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                color: viewMode === 'overlay' ? '#818cf8' : '#9ca3af',
                border: 'none',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="3D Overlay Motion Mode"
            >
              <Layers size={12} /> Motion Overlay
            </button>
            <button
              onClick={() => {
                setViewMode('3d');
                setShowWebsiteBg(false);
                setShowGrid(true);
                setShow3DObjects(true);
              }}
              style={{
                background: viewMode === '3d' ? 'rgba(99, 102, 241, 0.3)' : 'transparent',
                color: viewMode === '3d' ? '#818cf8' : '#9ca3af',
                border: 'none',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
              title="Pure 3D Canvas Mode"
            >
              <Box size={12} /> 3D Canvas
            </button>
          </div>

          {/* Toggle Space-Time Fabric Grid */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            className="glass-button"
            title={showGrid ? 'Hide Space-Time Grid' : 'Show Space-Time Grid'}
            style={{
              padding: '3px 8px',
              background: showGrid ? 'rgba(99, 102, 241, 0.25)' : undefined,
              borderColor: showGrid ? 'rgba(99, 102, 241, 0.5)' : undefined
            }}
          >
            <Grid size={12} color={showGrid ? '#818cf8' : '#9ca3af'} />
          </button>

          {/* Toggle 3D Objects */}
          <button
            onClick={() => setShow3DObjects(!show3DObjects)}
            className="glass-button"
            title={show3DObjects ? 'Hide 3D Mesh Objects' : 'Show 3D Mesh Objects'}
            style={{
              padding: '3px 8px',
              background: show3DObjects ? 'rgba(16, 185, 129, 0.25)' : undefined,
              borderColor: show3DObjects ? 'rgba(16, 185, 129, 0.5)' : undefined
            }}
          >
            <Box size={12} color={show3DObjects ? '#10b981' : '#9ca3af'} />
          </button>

          {/* Toggle Web Server Visibility */}
          <button
            onClick={() => setShowWebsiteBg(!showWebsiteBg)}
            className="glass-button"
            title={showWebsiteBg ? 'Hide Embedded Web Server' : 'Show Embedded Web Server'}
            style={{ padding: '3px 8px' }}
          >
            {showWebsiteBg ? <Eye size={12} color="#10b981" /> : <EyeOff size={12} color="#9ca3af" />}
          </button>
        </div>
      </div>

      {/* 2. Responsive Device Mode & Breakpoint Preset Toolbar */}
      {viewMode !== '3d' && (
        <div
          style={{
            height: '38px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            background: 'rgba(14, 14, 20, 0.95)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '0 12px',
            zIndex: 25,
            flexShrink: 0
          }}
        >
          {/* Preset Buttons: Responsive, Mobile (375px), Tablet (768px), Desktop (1440px) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {/* Quick Preset Buttons */}
            <button
              onClick={() => applyPreset('responsive')}
              className="glass-button"
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                background: devicePreset === 'responsive' ? 'rgba(139, 92, 246, 0.3)' : undefined,
                borderColor: devicePreset === 'responsive' ? '#8b5cf6' : undefined,
                color: devicePreset === 'responsive' ? '#c084fc' : '#9ca3af'
              }}
              title="Responsive Mode (100% Fluid Width)"
            >
              <Maximize2 size={12} /> Responsive
            </button>

            <button
              onClick={() => applyPreset('mobile')}
              className="glass-button"
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                background: devicePreset === 'mobile' ? 'rgba(245, 158, 11, 0.3)' : undefined,
                borderColor: devicePreset === 'mobile' ? '#f59e0b' : undefined,
                color: devicePreset === 'mobile' ? '#fbbf24' : '#9ca3af'
              }}
              title="Mobile Device Preset (375px × 667px)"
            >
              <Smartphone size={12} /> Mobile (375px)
            </button>

            <button
              onClick={() => applyPreset('tablet')}
              className="glass-button"
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                background: devicePreset === 'tablet' ? 'rgba(139, 92, 246, 0.3)' : undefined,
                borderColor: devicePreset === 'tablet' ? '#8b5cf6' : undefined,
                color: devicePreset === 'tablet' ? '#a78bfa' : '#9ca3af'
              }}
              title="Tablet Device Preset (768px × 1024px)"
            >
              <Tablet size={12} /> Tablet (768px)
            </button>

            <button
              onClick={() => applyPreset('desktop')}
              className="glass-button"
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 600,
                background: devicePreset === 'desktop' ? 'rgba(56, 189, 248, 0.3)' : undefined,
                borderColor: devicePreset === 'desktop' ? '#38bdf8' : undefined,
                color: devicePreset === 'desktop' ? '#7dd3fc' : '#9ca3af'
              }}
              title="Desktop Device Preset (1440px × 900px)"
            >
              <Monitor size={12} /> Desktop (1440px)
            </button>

            {/* Presets Dropdown */}
            <select
              value={devicePreset}
              onChange={(e) => applyPreset(e.target.value)}
              className="glass-input"
              style={{
                padding: '3px 6px',
                fontSize: '11px',
                color: '#e5e7eb',
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)'
              }}
            >
              {DEVICE_PRESETS.map((p) => (
                <option key={p.id} value={p.id} style={{ background: '#12121a', color: '#f3f4f6' }}>
                  {p.name}
                </option>
              ))}
              {devicePreset === 'custom' && (
                <option value="custom" style={{ background: '#12121a', color: '#f3f4f6' }}>
                  Custom ({effectiveWidth} × {effectiveHeight})
                </option>
              )}
            </select>
          </div>

          {/* Middle: Dimension Inputs (Width × Height) & Orientation Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="number"
                disabled={devicePreset === 'responsive'}
                value={devicePreset === 'responsive' ? '' : effectiveWidth}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setExplicitWidth(val);
                }}
                placeholder={devicePreset === 'responsive' ? '100%' : 'Width'}
                className="glass-input"
                style={{
                  width: '64px',
                  padding: '3px 6px',
                  textAlign: 'center',
                  fontSize: '11px',
                  color: '#38bdf8'
                }}
                title="Viewport Width in Pixels"
              />
              <span style={{ color: '#6b7280', fontSize: '11px' }}>×</span>
              <input
                type="number"
                disabled={devicePreset === 'responsive'}
                value={devicePreset === 'responsive' ? '' : effectiveHeight}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) {
                    setDeviceHeight(Math.max(200, Math.min(3840, val)));
                    setDevicePreset('custom');
                  }
                }}
                placeholder={devicePreset === 'responsive' ? '100%' : 'Height'}
                className="glass-input"
                style={{
                  width: '64px',
                  padding: '3px 6px',
                  textAlign: 'center',
                  fontSize: '11px',
                  color: '#38bdf8'
                }}
                title="Viewport Height in Pixels"
              />
              <span style={{ color: '#9ca3af', fontSize: '10px', marginLeft: '2px' }}>px</span>
            </div>

            {/* Orientation Rotate Toggle */}
            <button
              onClick={toggleOrientation}
              disabled={devicePreset === 'responsive'}
              className="glass-button"
              style={{
                padding: '3px 7px',
                opacity: devicePreset === 'responsive' ? 0.4 : 1,
                cursor: devicePreset === 'responsive' ? 'not-allowed' : 'pointer'
              }}
              title="Rotate Viewport Orientation (Portrait / Landscape)"
            >
              <RotateCw size={12} color={isRotated ? '#a78bfa' : '#9ca3af'} />
            </button>
          </div>

          {/* Right: Active Breakpoint Badge & Ruler Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* Active Breakpoint Pill */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 8px',
                borderRadius: '12px',
                background: activeBreakpoint.bg,
                border: `1px solid ${activeBreakpoint.border}`,
                fontSize: '10px',
                fontWeight: 600,
                color: activeBreakpoint.color
              }}
            >
              <span
                style={{
                  width: '5px',
                  height: '5px',
                  borderRadius: '50%',
                  backgroundColor: activeBreakpoint.color
                }}
              />
              <span>{activeBreakpoint.label}</span>
            </div>

            {/* Toggle Ruler Overlay */}
            <button
              onClick={() => setShowRuler(!showRuler)}
              className="glass-button"
              style={{
                padding: '3px 8px',
                background: showRuler ? 'rgba(139, 92, 246, 0.25)' : undefined,
                borderColor: showRuler ? 'rgba(139, 92, 246, 0.5)' : undefined
              }}
              title={showRuler ? 'Hide Breakpoint Ruler' : 'Show Breakpoint Ruler'}
            >
              <Ruler size={12} color={showRuler ? '#a78bfa' : '#9ca3af'} />
            </button>
          </div>
        </div>
      )}

      {/* 3. Responsive Breakpoint Ruler Bar Overlay */}
      {viewMode !== '3d' && showRuler && (
        <div
          ref={rulerRef}
          onClick={handleRulerClick}
          onMouseMove={handleRulerMouseMove}
          onMouseLeave={handleRulerMouseLeave}
          style={{
            height: '28px',
            position: 'relative',
            background: 'rgba(12, 12, 18, 0.98)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            overflow: 'hidden',
            cursor: 'crosshair',
            userSelect: 'none',
            zIndex: 20,
            flexShrink: 0
          }}
          title="Click anywhere on the ruler to set the viewport width"
        >
          {/* Colored Breakpoint Range Strips */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '8px', display: 'flex' }}>
            {BREAKPOINT_RANGES.map((range) => {
              const widthPx = range.max - range.min + 1;
              return (
                <div
                  key={range.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExplicitWidth(range.targetWidth);
                  }}
                  style={{
                    position: 'absolute',
                    left: `${range.min}px`,
                    width: `${Math.min(widthPx, 3840)}px`,
                    height: '100%',
                    background: range.bg,
                    borderBottom: `2px solid ${range.color}`,
                    cursor: 'pointer'
                  }}
                  title={`Click to switch to ${range.label} (${range.targetWidth}px)`}
                />
              );
            })}
          </div>

          {/* Pixel Gradation Ticks & Labels */}
          {rulerTicks}

          {/* Current Device Width Indicator Line & Pill */}
          {devicePreset !== 'responsive' && effectiveWidth > 0 && (
            <div
              style={{
                position: 'absolute',
                left: `${effectiveWidth}px`,
                top: 0,
                bottom: 0,
                width: '2px',
                background: '#8b5cf6',
                boxShadow: '0 0 8px rgba(139, 92, 246, 0.8)',
                pointerEvents: 'none',
                zIndex: 5
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '1px',
                  left: '4px',
                  background: '#8b5cf6',
                  color: '#ffffff',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  padding: '1px 4px',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap'
                }}
              >
                {effectiveWidth}px
              </div>
            </div>
          )}

          {/* Hover Indicator Cursor & Hairline */}
          {hoveredRulerPx !== null && (
            <div
              style={{
                position: 'absolute',
                left: `${hoveredRulerPx}px`,
                top: 0,
                bottom: 0,
                width: '1px',
                background: 'rgba(255, 255, 255, 0.6)',
                pointerEvents: 'none',
                zIndex: 6
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: '1px',
                  left: '4px',
                  background: 'rgba(0, 0, 0, 0.85)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#f3f4f6',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap'
                }}
              >
                {hoveredRulerPx}px
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. Live Website Workspace & Device Preview Frame Container */}
      <div
        ref={workspaceRef}
        onPointerMove={handleFrameResizeMove}
        onPointerUp={handleFrameResizeUp}
        style={{
          flex: 1,
          width: '100%',
          height: '100%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: devicePreset === 'responsive' ? 'stretch' : 'flex-start',
          padding: devicePreset === 'responsive' ? 0 : '16px 20px',
          overflow: 'auto',
          background:
            viewMode === '3d' || !showWebsiteBg
              ? '#050508'
              : 'radial-gradient(ellipse at center, #0c0d14 0%, #050508 100%)'
        }}
      >
        {/* Device Frame (or Full Responsive Container) */}
        <div
          ref={previewFrameRef}
          style={{
            position: 'relative',
            width: devicePreset === 'responsive' ? '100%' : `${effectiveWidth}px`,
            height: devicePreset === 'responsive' ? '100%' : `${effectiveHeight}px`,
            minWidth: devicePreset === 'responsive' ? '100%' : `${effectiveWidth}px`,
            maxWidth: devicePreset === 'responsive' ? '100%' : `${effectiveWidth}px`,
            borderRadius: devicePreset === 'responsive' ? '0px' : '10px',
            border:
              devicePreset === 'responsive'
                ? 'none'
                : '1px solid rgba(255, 255, 255, 0.16)',
            boxShadow:
              devicePreset === 'responsive'
                ? 'none'
                : '0 20px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.06)',
            background: 'transparent',
            flexShrink: 0,
            transition: isDraggingFrameHandle ? 'none' : 'width 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
            overflow: 'visible'
          }}
        >
          {/* Device Bezel Header Bar (Shown in non-responsive device mode) */}
          {devicePreset !== 'responsive' && (
            <div
              style={{
                position: 'absolute',
                top: -24,
                left: 0,
                right: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '10px',
                color: '#9ca3af',
                fontFamily: 'monospace',
                padding: '0 4px',
                userSelect: 'none',
                pointerEvents: 'none'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: activeBreakpoint.color }}>●</span>
                <span style={{ color: '#e5e7eb', fontWeight: 600 }}>
                  {devicePreset === 'custom' ? 'Custom Device' : DEVICE_PRESETS.find((p) => p.id === devicePreset)?.name || 'Device'}
                </span>
                <span>({effectiveWidth} × {effectiveHeight}px)</span>
              </span>
              <span style={{ color: '#6b7280' }}>Drag handles to resize</span>
            </div>
          )}

          {/* Draggable Resize Handles (East, West, South, South-East) */}
          {devicePreset !== 'responsive' && (
            <>
              {/* Right Handle (East) */}
              <div
                onPointerDown={(e) => handleFrameResizeStart('e', e)}
                style={{
                  position: 'absolute',
                  top: '20px',
                  right: -10,
                  bottom: '20px',
                  width: '10px',
                  cursor: 'ew-resize',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 25
                }}
                title="Drag to resize width"
              >
                <div
                  style={{
                    width: '4px',
                    height: '32px',
                    borderRadius: '2px',
                    background: isDraggingFrameHandle === 'e' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.3)',
                    boxShadow: isDraggingFrameHandle === 'e' ? '0 0 10px #8b5cf6' : undefined
                  }}
                />
              </div>

              {/* Left Handle (West) */}
              <div
                onPointerDown={(e) => handleFrameResizeStart('w', e)}
                style={{
                  position: 'absolute',
                  top: '20px',
                  left: -10,
                  bottom: '20px',
                  width: '10px',
                  cursor: 'ew-resize',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 25
                }}
                title="Drag to resize width"
              >
                <div
                  style={{
                    width: '4px',
                    height: '32px',
                    borderRadius: '2px',
                    background: isDraggingFrameHandle === 'w' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.3)',
                    boxShadow: isDraggingFrameHandle === 'w' ? '0 0 10px #8b5cf6' : undefined
                  }}
                />
              </div>

              {/* Bottom Handle (South) */}
              <div
                onPointerDown={(e) => handleFrameResizeStart('s', e)}
                style={{
                  position: 'absolute',
                  left: '20px',
                  right: '20px',
                  bottom: -10,
                  height: '10px',
                  cursor: 'ns-resize',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 25
                }}
                title="Drag to resize height"
              >
                <div
                  style={{
                    height: '4px',
                    width: '32px',
                    borderRadius: '2px',
                    background: isDraggingFrameHandle === 's' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.3)',
                    boxShadow: isDraggingFrameHandle === 's' ? '0 0 10px #8b5cf6' : undefined
                  }}
                />
              </div>

              {/* Bottom-Right Corner Handle (South-East) */}
              <div
                onPointerDown={(e) => handleFrameResizeStart('se', e)}
                style={{
                  position: 'absolute',
                  right: -8,
                  bottom: -8,
                  width: '16px',
                  height: '16px',
                  cursor: 'nwse-resize',
                  borderRadius: '3px',
                  background: isDraggingFrameHandle === 'se' ? '#8b5cf6' : 'rgba(255, 255, 255, 0.4)',
                  boxShadow: isDraggingFrameHandle === 'se' ? '0 0 12px #8b5cf6' : '0 2px 6px rgba(0,0,0,0.5)',
                  zIndex: 26
                }}
                title="Drag to resize both width and height"
              />
            </>
          )}

          {/* Visual Editor Overlay for Selected Element */}
          {viewMode === 'live' && selectedElementBounds && (
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={(e) => {
                handlePointerMove(e);
                handleResizeMove(e);
                handleRotateMove(e);
              }}
              onPointerUp={(e) => {
                handlePointerUp(e);
                handleResizeUp(e);
                handleRotateUp(e);
              }}
              style={{
                position: 'absolute',
                top: selectedElementBounds.y,
                left: selectedElementBounds.x,
                width: selectedElementBounds.width,
                height: selectedElementBounds.height,
                transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`,
                border: activeTool === 'move' ? '2px dashed #8b5cf6' : '2px solid #3b82f6',
                pointerEvents: 'auto',
                cursor: activeTool === 'move' ? (isDragging ? 'grabbing' : 'grab') : 'default',
                zIndex: 40,
                boxShadow: '0 0 0 1px rgba(255,255,255,0.2)'
              }}
            >
              {/* Dimension & Selector Pill */}
              <div
                style={{
                  position: 'absolute',
                  top: -24,
                  left: -2,
                  background: '#3b82f6',
                  color: '#fff',
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '3px',
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span>
                  {Math.round(selectedElementBounds.width)} × {Math.round(selectedElementBounds.height)}px
                </span>
                {activeTool === 'move' && isDragging && (
                  <span style={{ color: '#fed7aa' }}>
                    ({dragOffset.x > 0 ? '+' : ''}
                    {dragOffset.x}, {dragOffset.y > 0 ? '+' : ''}
                    {dragOffset.y})
                  </span>
                )}
              </div>

              {/* Rotate Handle */}
              {activeTool === 'rotate' && (
                <div
                  onPointerDown={handleRotateStart}
                  style={{
                    position: 'absolute',
                    top: -28,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 14,
                    height: 14,
                    background: '#8b5cf6',
                    border: '2px solid #ffffff',
                    borderRadius: '50%',
                    cursor: 'crosshair',
                    pointerEvents: 'auto',
                    boxShadow: '0 0 8px rgba(139, 92, 246, 0.6)'
                  }}
                  title="Drag to Rotate Element"
                >
                  <div
                    style={{
                      position: 'absolute',
                      bottom: -12,
                      left: '50%',
                      width: 1,
                      height: 12,
                      background: '#8b5cf6'
                    }}
                  />
                </div>
              )}

              {/* Scale 8-point Resize Handles */}
              {(activeTool === 'scale' || activeTool === 'select') && (
                <>
                  {/* Top-Left */}
                  <div
                    onPointerDown={(e) => handleResizeStart('nw', e)}
                    style={{
                      position: 'absolute',
                      top: -5,
                      left: -5,
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'nwse-resize'
                    }}
                  />
                  {/* Top-Right */}
                  <div
                    onPointerDown={(e) => handleResizeStart('ne', e)}
                    style={{
                      position: 'absolute',
                      top: -5,
                      right: -5,
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'nesw-resize'
                    }}
                  />
                  {/* Bottom-Left */}
                  <div
                    onPointerDown={(e) => handleResizeStart('sw', e)}
                    style={{
                      position: 'absolute',
                      bottom: -5,
                      left: -5,
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'nesw-resize'
                    }}
                  />
                  {/* Bottom-Right */}
                  <div
                    onPointerDown={(e) => handleResizeStart('se', e)}
                    style={{
                      position: 'absolute',
                      bottom: -5,
                      right: -5,
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'nwse-resize'
                    }}
                  />

                  {/* Top Edge */}
                  <div
                    onPointerDown={(e) => handleResizeStart('n', e)}
                    style={{
                      position: 'absolute',
                      top: -5,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'ns-resize'
                    }}
                  />
                  {/* Bottom Edge */}
                  <div
                    onPointerDown={(e) => handleResizeStart('s', e)}
                    style={{
                      position: 'absolute',
                      bottom: -5,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'ns-resize'
                    }}
                  />
                  {/* Left Edge */}
                  <div
                    onPointerDown={(e) => handleResizeStart('w', e)}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      left: -5,
                      transform: 'translateY(-50%)',
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'ew-resize'
                    }}
                  />
                  {/* Right Edge */}
                  <div
                    onPointerDown={(e) => handleResizeStart('e', e)}
                    style={{
                      position: 'absolute',
                      top: '50%',
                      right: -5,
                      transform: 'translateY(-50%)',
                      width: 10,
                      height: 10,
                      background: '#fff',
                      border: '2px solid #3b82f6',
                      borderRadius: '2px',
                      pointerEvents: 'auto',
                      cursor: 'ew-resize'
                    }}
                  />
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 5. 3D WebGL Canvas Layer */}
      {viewMode !== 'live' && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            zIndex: 2,
            pointerEvents: viewMode === 'overlay' && !show3DObjects ? 'none' : 'auto'
          }}
        >
          <Canvas
            frameloop="demand"
            dpr={[1, 1.5]}
            gl={{ powerPreference: 'low-power', antialias: true }}
            camera={{ position: [0, 3, 7], fov: 50 }}
            onClick={() => selectNode(null)}
            style={{ background: viewMode === '3d' ? '#050508' : 'transparent' }}
          >
            <SceneObjects showGrid={showGrid} show3DObjects={show3DObjects} />
            <OrbitControls makeDefault />
            {showGrid && (
              <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                <GizmoViewport axisColors={['#ef4444', '#10b981', '#3b82f6']} labelColor="#ffffff" />
              </GizmoHelper>
            )}
          </Canvas>
        </div>
      )}
    </div>
  );
}
