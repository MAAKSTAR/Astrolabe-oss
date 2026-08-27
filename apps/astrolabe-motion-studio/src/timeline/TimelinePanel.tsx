import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSceneStore, ScrollTrack, ScrollKeyframe } from '../core/SceneGraph';
import { BrowserBridge } from '../core/BrowserBridge';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Repeat, 
  SkipBack, 
  SkipForward, 
  ArrowDown, 
  Plus, 
  Key,
  Gauge,
  Trash2,
  Sliders,
  Sparkles,
  Layers
} from 'lucide-react';

const EASING_PRESETS = [
  'linear', 
  'power2.out', 
  'power2.in', 
  'power3.inOut', 
  'elastic.out(1, 0.3)', 
  'back.out(1.7)', 
  'spring'
];

const PROPERTY_PRESETS = [
  { id: 'translateY', label: 'Translate Y (px)', startVal: 0, endVal: 120 },
  { id: 'translateX', label: 'Translate X (px)', startVal: 0, endVal: 80 },
  { id: 'scale', label: 'Scale (e.g. 1 to 0.75)', startVal: 1, endVal: 0.75 },
  { id: 'fontSize', label: 'Font Size (px)', startVal: 32, endVal: 18 },
  { id: 'opacity', label: 'Opacity (0 to 1)', startVal: 1, endVal: 0 },
  { id: 'rotate', label: 'Rotation (deg)', startVal: 0, endVal: 15 },
  { id: 'blur', label: 'Blur Filter (px)', startVal: 0, endVal: 10 }
];

/**
 * Calculates the interpolated property value between keyframes at the current scroll position
 */
function interpolateKeyframes(keyframes: ScrollKeyframe[], currentScroll: number): number | number[] | string {
  if (!keyframes || keyframes.length === 0) return 1;
  const sorted = [...keyframes].sort((a, b) => a.scrollPixel - b.scrollPixel);
  if (currentScroll <= sorted[0].scrollPixel) return sorted[0].value;
  if (currentScroll >= sorted[sorted.length - 1].scrollPixel) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const kfA = sorted[i];
    const kfB = sorted[i + 1];
    if (currentScroll >= kfA.scrollPixel && currentScroll <= kfB.scrollPixel) {
      const range = kfB.scrollPixel - kfA.scrollPixel;
      if (range === 0) return kfA.value;
      let t = (currentScroll - kfA.scrollPixel) / range;
      t = Math.max(0, Math.min(1, t));

      // Apply easing curve
      const ease = kfB.easing || 'power2.out';
      let easedT = t;
      if (ease === 'linear') {
        easedT = t;
      } else if (ease === 'power2.out') {
        easedT = 1 - Math.pow(1 - t, 2);
      } else if (ease === 'power2.in') {
        easedT = Math.pow(t, 2);
      } else if (ease === 'power3.inOut') {
        easedT = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      } else if (ease.startsWith('elastic')) {
        easedT = Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
      } else if (ease.startsWith('back')) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        easedT = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      } else if (ease === 'spring') {
        easedT = 1 - Math.exp(-6 * t) * Math.cos(10 * t);
      }

      const valA = typeof kfA.value === 'number' ? kfA.value : parseFloat(String(kfA.value)) || 0;
      const valB = typeof kfB.value === 'number' ? kfB.value : parseFloat(String(kfB.value)) || 0;
      const result = valA + (valB - valA) * easedT;
      return Math.round(result * 1000) / 1000;
    }
  }
  return sorted[0].value;
}

export function TimelinePanel() {
  const scrollTracks = useSceneStore((state) => state.scrollTracks);
  const scrollPosition = useSceneStore((state) => state.scrollPosition);
  const scrollHeight = useSceneStore((state) => state.scrollHeight);
  const setScrollPosition = useSceneStore((state) => state.setScrollPosition);
  const addScrollTrack = useSceneStore((state) => state.addScrollTrack);
  const removeScrollTrack = useSceneStore((state) => state.removeScrollTrack);
  const addScrollKeyframe = useSceneStore((state) => state.addScrollKeyframe);
  const updateScrollKeyframe = useSceneStore((state) => state.updateScrollKeyframe);
  const removeScrollKeyframe = useSceneStore((state) => state.removeScrollKeyframe);
  const selectedDomId = useSceneStore((state) => state.selectedDomId);
  const selectedElementPath = useSceneStore((state) => state.selectedElementPath);

  // Transport & Animation States
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [showAddTrackMenu, setShowAddTrackMenu] = useState<boolean>(false);
  
  // Keyframe Editing State
  const [editingKeyframe, setEditingKeyframe] = useState<{ trackId: string, kf: ScrollKeyframe } | null>(null);

  // Initialize store with default motion tracks if completely empty
  useEffect(() => {
    if (scrollTracks.length === 0) {
      const initialHeight = scrollHeight || 1200;
      const defaultTracks: ScrollTrack[] = [
        {
          id: 'track-hero-fade',
          nodeId: '#hero-heading',
          property: 'opacity',
          keyframes: [
            { id: 'kf-1', scrollPixel: 0, value: 1, easing: 'linear' },
            { id: 'kf-2', scrollPixel: Math.round(initialHeight * 0.25), value: 0, easing: 'power2.out' }
          ]
        },
        {
          id: 'track-hero-translate',
          nodeId: '#hero-heading',
          property: 'translateY',
          keyframes: [
            { id: 'kf-3', scrollPixel: 0, value: 0, easing: 'linear' },
            { id: 'kf-4', scrollPixel: Math.round(initialHeight * 0.25), value: -50, easing: 'power2.out' }
          ]
        },
        {
          id: 'track-nav-blur',
          nodeId: '#navbar',
          property: 'blur',
          keyframes: [
            { id: 'kf-5', scrollPixel: 0, value: 0, easing: 'linear' },
            { id: 'kf-6', scrollPixel: Math.round(initialHeight * 0.15), value: 12, easing: 'power2.out' }
          ]
        }
      ];
      useSceneStore.setState({ scrollTracks: defaultTracks });
    }
  }, []);

  // References for requestAnimationFrame loop
  const animFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(isPlaying);
  const isLoopingRef = useRef<boolean>(isLooping);
  const scrollPosRef = useRef<number>(scrollPosition);
  const scrollHeightRef = useRef<number>(scrollHeight);
  const speedRef = useRef<number>(playbackSpeed);
  const scrollTracksRef = useRef<ScrollTrack[]>(scrollTracks);

  // Throttling references for BrowserBridge IPC
  const lastScrollSentTimeRef = useRef<number>(0);
  const isSendingScrollRef = useRef<boolean>(false);

  // Keep references synced with React state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    isLoopingRef.current = isLooping;
  }, [isLooping]);

  useEffect(() => {
    scrollPosRef.current = scrollPosition;
  }, [scrollPosition]);

  useEffect(() => {
    scrollHeightRef.current = scrollHeight;
  }, [scrollHeight]);

  useEffect(() => {
    speedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    scrollTracksRef.current = scrollTracks;
  }, [scrollTracks]);

  /**
   * Dispatches scrollTo and live motion interpolation to guest page through BrowserBridge.
   */
  const syncScrollToGuest = useCallback((y: number, immediate = false) => {
    const roundedY = Math.max(0, Math.round(y));
    const now = performance.now();

    if (immediate || (now - lastScrollSentTimeRef.current > 20 && !isSendingScrollRef.current)) {
      lastScrollSentTimeRef.current = now;
      isSendingScrollRef.current = true;
      
      // 1. Scroll the guest viewport
      BrowserBridge.scrollTo(roundedY).catch(() => {});

      // 2. Compute and apply animated keyframe values to target elements
      const tracks = scrollTracksRef.current;
      if (tracks && tracks.length > 0) {
        const frameData = tracks.map((track) => ({
          nodeId: track.nodeId,
          property: track.property,
          value: interpolateKeyframes(track.keyframes, roundedY)
        }));
        BrowserBridge.applyMotionFrame(frameData).catch(() => {});
      }

      isSendingScrollRef.current = false;
    }
  }, []);

  /**
   * Scrubbing handler for the range slider
   */
  const handleScrubberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = Number(e.target.value);
    const height = Math.max(1, scrollHeight);
    const percentage = Math.max(0, Math.min(rawVal / height, 1));
    const targetY = Math.round(percentage * height);

    setScrollPosition(targetY);
    syncScrollToGuest(targetY, true);
  };

  /**
   * Transport: Toggle Play/Pause
   */
  const handleTogglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        // If playhead reached or is near the end, restart from beginning
        if (scrollPosRef.current >= scrollHeightRef.current - 5) {
          setScrollPosition(0);
          scrollPosRef.current = 0;
          syncScrollToGuest(0, true);
        }
      }
      return next;
    });
  }, [setScrollPosition, syncScrollToGuest]);

  /**
   * Transport: Reset Playhead to 0
   */
  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setScrollPosition(0);
    scrollPosRef.current = 0;
    syncScrollToGuest(0, true);
  }, [setScrollPosition, syncScrollToGuest]);

  /**
   * Transport: Skip to End of Timeline
   */
  const handleJumpToEnd = useCallback(() => {
    setIsPlaying(false);
    const endPos = scrollHeight;
    setScrollPosition(endPos);
    scrollPosRef.current = endPos;
    syncScrollToGuest(endPos, true);
  }, [scrollHeight, setScrollPosition, syncScrollToGuest]);

  /**
   * Transport: Toggle Loop
   */
  const handleToggleLoop = () => {
    setIsLooping((prev) => !prev);
  };

  /**
   * Cycle playback speed (0.5x -> 1x -> 1.5x -> 2x)
   */
  const handleCycleSpeed = () => {
    const speeds = [0.5, 1, 1.5, 2];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextSpeed = speeds[(currentIndex + 1) % speeds.length];
    setPlaybackSpeed(nextSpeed);
  };

  /**
   * Animation Playhead Engine using requestAnimationFrame
   */
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    const baseDurationSeconds = 5.0;

    const animateLoop = (now: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = now;
      }
      const deltaSeconds = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      const currentMaxHeight = Math.max(1, scrollHeightRef.current);
      const pixelsPerSecond = (currentMaxHeight / baseDurationSeconds) * speedRef.current;
      let nextPos = scrollPosRef.current + pixelsPerSecond * deltaSeconds;

      if (nextPos >= currentMaxHeight) {
        if (isLoopingRef.current) {
          nextPos = 0;
          setScrollPosition(0);
          scrollPosRef.current = 0;
          syncScrollToGuest(0, true);
        } else {
          nextPos = currentMaxHeight;
          setScrollPosition(currentMaxHeight);
          scrollPosRef.current = currentMaxHeight;
          syncScrollToGuest(currentMaxHeight, true);
          setIsPlaying(false);
          return;
        }
      } else {
        setScrollPosition(nextPos);
        scrollPosRef.current = nextPos;
        syncScrollToGuest(nextPos);
      }

      animFrameRef.current = requestAnimationFrame(animateLoop);
    };

    lastTimeRef.current = performance.now();
    animFrameRef.current = requestAnimationFrame(animateLoop);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [isPlaying, setScrollPosition, syncScrollToGuest]);

  /**
   * Direct Click/Drag on Ruler or Track Canvas to scrub
   */
  const handleTrackScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = rect.width > 0 ? clickX / rect.width : 0;
    const targetY = Math.round(percentage * scrollHeight);

    setScrollPosition(targetY);
    scrollPosRef.current = targetY;
    syncScrollToGuest(targetY, true);
  };

  const selectedElementStyles = useSceneStore((state) => state.selectedElementStyles);

  /**
   * Add or record a keyframe for the currently selected element or active track
   */
  const handleAddKeyframe = () => {
    // 1. Determine target selector for the active selected element
    let targetSelector = '';
    if (selectedDomId) {
      targetSelector = selectedDomId.startsWith('#') || selectedDomId.startsWith('.') || selectedDomId.includes('[') 
        ? selectedDomId 
        : `[data-astrolabe-id="${selectedDomId}"]`;
    } else if (selectedElementPath?.selector) {
      targetSelector = selectedElementPath.selector;
    }

    // 2. Find if a track already exists for this selected element or active track
    let targetTrack: ScrollTrack | undefined;
    if (targetSelector) {
      targetTrack = scrollTracks.find(t => t.nodeId === targetSelector || (selectedDomId && t.nodeId.includes(selectedDomId)));
    }
    if (!targetTrack && selectedTrackId) {
      targetTrack = scrollTracks.find(t => t.id === selectedTrackId);
    }

    // 3. Extract the element's current style value for the track property
    const propToRecord = targetTrack ? targetTrack.property : 'translateY';
    let currentValue: number | string = 0;

    if (selectedElementStyles) {
      if (propToRecord === 'translateY' || propToRecord === 'y') {
        const matchY = selectedElementStyles.transform?.match(/translateY\(([-\d.]+)px\)/i) || 
                       selectedElementStyles.transform?.match(/translate\([-\d.]+px,\s*([-\d.]+)px\)/i);
        if (matchY && matchY[1]) currentValue = parseFloat(matchY[1]);
      } else if (propToRecord === 'translateX' || propToRecord === 'x') {
        const matchX = selectedElementStyles.transform?.match(/translateX\(([-\d.]+)px\)/i) || 
                       selectedElementStyles.transform?.match(/translate\(([-\d.]+)px/i);
        if (matchX && matchX[1]) currentValue = parseFloat(matchX[1]);
      } else if (propToRecord === 'scale') {
        const matchScale = selectedElementStyles.transform?.match(/scale\(([-\d.]+)\)/i);
        if (matchScale && matchScale[1]) currentValue = parseFloat(matchScale[1]);
        else currentValue = 1;
      } else if (propToRecord === 'fontSize') {
        const num = parseFloat(selectedElementStyles.fontSize || '16');
        currentValue = isNaN(num) ? 16 : num;
      } else if (propToRecord === 'opacity') {
        const num = parseFloat(selectedElementStyles.opacity || '1');
        currentValue = isNaN(num) ? 1 : num;
      } else if (propToRecord === 'rotate') {
        const matchRot = selectedElementStyles.transform?.match(/rotate\(([-\d.]+)deg\)/i);
        if (matchRot && matchRot[1]) currentValue = parseFloat(matchRot[1]);
      } else if (propToRecord === 'blur') {
        const matchBlur = selectedElementStyles.filter?.match(/blur\(([-\d.]+)px\)/i);
        if (matchBlur && matchBlur[1]) currentValue = parseFloat(matchBlur[1]);
      } else if (selectedElementStyles[propToRecord]) {
        currentValue = selectedElementStyles[propToRecord];
      }
    }

    // 4. If no track exists for this selected element, create its motion track with the initial keyframe
    if (!targetTrack) {
      const initialSelector = targetSelector || (selectedElementPath?.selector || '#hero-heading');
      const newTrack: ScrollTrack = {
        id: `track-${Date.now()}`,
        nodeId: initialSelector,
        property: propToRecord,
        keyframes: [
          {
            id: `kf-${Date.now()}-1`,
            scrollPixel: Math.round(scrollPosition),
            value: currentValue,
            easing: 'linear'
          }
        ]
      };
      addScrollTrack(newTrack);
      setSelectedTrackId(newTrack.id);
      setEditingKeyframe({ trackId: newTrack.id, kf: newTrack.keyframes[0] });
      syncScrollToGuest(scrollPosition, true);
      return;
    }

    // 5. If track exists, check if there's already a keyframe near this scroll position
    const currentScrollPx = Math.round(scrollPosition);
    const existingKfIndex = targetTrack.keyframes.findIndex(kf => Math.abs(kf.scrollPixel - currentScrollPx) <= 5);

    if (existingKfIndex >= 0) {
      // Update existing keyframe at this position
      const existingKf = targetTrack.keyframes[existingKfIndex];
      const updatedValue = currentValue !== 0 ? currentValue : existingKf.value;
      updateScrollKeyframe(targetTrack.id, existingKf.id, { value: updatedValue, scrollPixel: currentScrollPx });
      setEditingKeyframe({ trackId: targetTrack.id, kf: { ...existingKf, value: updatedValue, scrollPixel: currentScrollPx } });
    } else {
      // Insert new keyframe at this new scroll position
      const interpolatedVal = interpolateKeyframes(targetTrack.keyframes, currentScrollPx);
      const newKfValue = currentValue !== 0 ? currentValue : interpolatedVal;

      const newKf: ScrollKeyframe = {
        id: `kf-${Date.now()}`,
        scrollPixel: currentScrollPx,
        value: newKfValue,
        easing: 'power2.out'
      };
      addScrollKeyframe(targetTrack.id, newKf);
      setSelectedTrackId(targetTrack.id);
      setEditingKeyframe({ trackId: targetTrack.id, kf: newKf });
    }

    syncScrollToGuest(scrollPosition, true);
  };

  /**
   * Create a new motion track for a specific property
   */
  const handleCreateTrack = (propertyId: string) => {
    setShowAddTrackMenu(false);
    const preset = PROPERTY_PRESETS.find(p => p.id === propertyId) || PROPERTY_PRESETS[0];
    const targetSelector = selectedDomId 
      ? (selectedDomId.startsWith('#') || selectedDomId.startsWith('.') ? selectedDomId : `[data-astrolabe-id="${selectedDomId}"]`) 
      : (selectedElementPath?.selector || '#hero-heading');

    const startPx = Math.max(0, Math.round(scrollPosition));
    const endPx = Math.min(scrollHeight, startPx + Math.max(150, Math.round(scrollHeight * 0.2)));

    const newTrack: ScrollTrack = {
      id: `track-${Date.now()}`,
      nodeId: targetSelector,
      property: preset.id,
      keyframes: [
        { id: `kf-${Date.now()}-1`, scrollPixel: startPx, value: preset.startVal, easing: 'linear' },
        { id: `kf-${Date.now()}-2`, scrollPixel: endPx, value: preset.endVal, easing: 'power2.out' }
      ]
    };
    addScrollTrack(newTrack);
    setSelectedTrackId(newTrack.id);
    setEditingKeyframe({ trackId: newTrack.id, kf: newTrack.keyframes[1] });
    syncScrollToGuest(scrollPosition, true);
  };

  // Keyboard shortcut listener for Space bar play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        handleTogglePlay();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePlay]);

  const progressPercent = scrollHeight > 0 ? (scrollPosition / scrollHeight) * 100 : 0;
  const activeTracks = scrollTracks;

  return (
    <div className="glass-panel" style={{
      height: '100%',
      borderRadius: 0,
      borderLeft: 'none',
      borderRight: 'none',
      borderBottom: 'none',
      display: 'flex',
      flexDirection: 'column',
      color: '#f3f4f6',
      padding: '8px 14px',
      background: 'rgba(10, 10, 15, 0.94)',
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      userSelect: 'none',
      overflow: 'hidden',
      position: 'relative'
    }}>
      {/* Top Header & Transport Deck */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px',
        paddingBottom: '6px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        {/* Left: Transport Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Reset / Go to Start */}
          <button
            onClick={handleReset}
            className="glass-button"
            style={{ width: '28px', height: '28px', padding: 0, justifyContent: 'center' }}
            title="Reset Playhead (0px)"
          >
            <RotateCcw size={13} />
          </button>

          {/* Skip Back */}
          <button
            onClick={handleReset}
            className="glass-button"
            style={{ width: '28px', height: '28px', padding: 0, justifyContent: 'center' }}
            title="Rewind to Start"
          >
            <SkipBack size={13} />
          </button>

          {/* Primary Play / Pause Button */}
          <button
            onClick={handleTogglePlay}
            className="glass-button"
            style={{
              width: '32px',
              height: '32px',
              padding: 0,
              justifyContent: 'center',
              background: isPlaying 
                ? 'linear-gradient(135deg, #10b981, #059669)' 
                : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
              borderColor: isPlaying ? 'rgba(16, 185, 129, 0.6)' : 'rgba(139, 92, 246, 0.6)',
              color: '#ffffff',
              boxShadow: isPlaying ? '0 0 14px rgba(16, 185, 129, 0.45)' : '0 0 14px rgba(139, 92, 246, 0.45)'
            }}
            title={isPlaying ? 'Pause Timeline (Space)' : 'Play Timeline (Space)'}
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: '2px' }} />}
          </button>

          {/* Skip to End */}
          <button
            onClick={handleJumpToEnd}
            className="glass-button"
            style={{ width: '28px', height: '28px', padding: 0, justifyContent: 'center' }}
            title="Jump to End"
          >
            <SkipForward size={13} />
          </button>

          {/* Loop Mode Toggle */}
          <button
            onClick={handleToggleLoop}
            className="glass-button"
            style={{
              width: '28px',
              height: '28px',
              padding: 0,
              justifyContent: 'center',
              background: isLooping ? 'rgba(139, 92, 246, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              borderColor: isLooping ? '#8b5cf6' : 'rgba(255, 255, 255, 0.1)',
              color: isLooping ? '#c084fc' : '#6b7280'
            }}
            title={isLooping ? 'Looping Enabled (Click to Disable)' : 'Looping Disabled (Click to Enable)'}
          >
            <Repeat size={13} />
          </button>

          {/* Playback Speed Pill */}
          <button
            onClick={handleCycleSpeed}
            className="glass-button"
            style={{
              padding: '3px 8px',
              fontSize: '11px',
              fontWeight: 600,
              fontFamily: 'monospace',
              color: '#38bdf8',
              borderColor: 'rgba(56, 189, 248, 0.3)',
              background: 'rgba(56, 189, 248, 0.08)',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
            title="Cycle Playback Speed"
          >
            <Gauge size={12} />
            {playbackSpeed}x
          </button>

          {/* Divider */}
          <div style={{ width: '1px', height: '20px', background: 'rgba(255, 255, 255, 0.1)', margin: '0 4px' }} />

          {/* Scrubber Range Slider & Readout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '11px',
              color: '#a7f3d0',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              background: 'rgba(16, 185, 129, 0.1)',
              padding: '3px 8px',
              borderRadius: '4px',
              border: '1px solid rgba(16, 185, 129, 0.2)'
            }}>
              <ArrowDown size={12} />
              {scrollPosition.toFixed(0)}px / {scrollHeight.toFixed(0)}px
              <span style={{ color: '#6ee7b7', opacity: 0.7, marginLeft: '2px' }}>
                ({progressPercent.toFixed(1)}%)
              </span>
            </span>

            <input
              type="range"
              min="0"
              max={scrollHeight}
              value={scrollPosition}
              onChange={handleScrubberChange}
              style={{
                width: '180px',
                accentColor: '#8b5cf6',
                cursor: 'pointer'
              }}
              title="Drag to scrub guest viewport scroll"
            />
          </div>
        </div>

        {/* Right: Actions (Add Track & Add Keyframe) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
          {/* Add Motion Track Dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAddTrackMenu(!showAddTrackMenu)}
              className="glass-button"
              style={{
                padding: '3px 9px',
                fontSize: '11px',
                color: '#38bdf8',
                borderColor: 'rgba(56, 189, 248, 0.35)',
                background: 'rgba(56, 189, 248, 0.12)',
                height: '28px',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}
              title="Add a new animated property track"
            >
              <Plus size={13} color="#38bdf8" />
              <Sliders size={12} />
              <span>Track</span>
            </button>

            {showAddTrackMenu && (
              <div style={{
                position: 'absolute',
                top: '32px',
                right: 0,
                width: '180px',
                background: '#0d0d14',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '8px',
                padding: '4px',
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.6)',
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px'
              }}>
                <div style={{ padding: '4px 8px', fontSize: '9px', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
                  Animate Property
                </div>
                {PROPERTY_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => handleCreateTrack(p.id)}
                    style={{
                      textAlign: 'left',
                      background: 'transparent',
                      border: 'none',
                      color: '#e2e8f0',
                      padding: '6px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>{p.label}</span>
                    <Sparkles size={10} color="#38bdf8" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Add Keyframe Button */}
          <button
            onClick={handleAddKeyframe}
            className="glass-button"
            style={{
              padding: '3px 9px',
              fontSize: '11px',
              color: '#c084fc',
              borderColor: 'rgba(139, 92, 246, 0.35)',
              background: 'rgba(139, 92, 246, 0.12)',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px'
            }}
            title="Add Keyframe at Playhead Position"
          >
            <Plus size={13} color="#a855f7" />
            <Key size={12} />
            <span>Keyframe</span>
          </button>
        </div>
      </div>

      {/* Timeline Pixel/Percent Ruler Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '4px' }}>
        <div style={{
          width: '180px',
          fontSize: '10px',
          fontWeight: 600,
          color: '#6b7280',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          paddingLeft: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span>Tracks ({activeTracks.length})</span>
          {selectedDomId && (
            <span style={{ fontSize: '9px', color: '#a78bfa', textTransform: 'none', background: 'rgba(139, 92, 246, 0.15)', padding: '1px 5px', borderRadius: '3px' }}>
              {selectedDomId.length > 12 ? selectedDomId.slice(0, 12) + '...' : selectedDomId}
            </span>
          )}
        </div>

        {/* Ruler Canvas Area */}
        <div
          onClick={handleTrackScrub}
          style={{
            flex: 1,
            height: '20px',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: '4px',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            position: 'relative',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center'
          }}
          title="Click ruler to jump playhead"
        >
          {/* Tick Marks: 0%, 25%, 50%, 75%, 100% */}
          {[0, 0.25, 0.5, 0.75, 1.0].map((ratio) => (
            <div
              key={ratio}
              style={{
                position: 'absolute',
                left: `${ratio * 100}%`,
                transform: 'translateX(-50%)',
                fontSize: '9px',
                fontFamily: 'monospace',
                color: '#6b7280',
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center'
              }}
            >
              <span>{Math.round(ratio * scrollHeight)}px</span>
            </div>
          ))}

          {/* Top Playhead Needle in Ruler */}
          <div style={{
            position: 'absolute',
            left: `${progressPercent}%`,
            top: 0,
            bottom: 0,
            width: '2px',
            background: '#ef4444',
            transform: 'translateX(-50%)',
            boxShadow: '0 0 8px #ef4444',
            zIndex: 20
          }}>
            <div style={{
              position: 'absolute',
              top: '-2px',
              left: '-4px',
              width: '10px',
              height: '8px',
              background: '#ef4444',
              clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
              boxShadow: '0 0 6px #ef4444'
            }} />
          </div>
        </div>
      </div>

      {/* Track List Deck */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        overflowY: 'auto',
        paddingRight: '2px'
      }}>
        {activeTracks.map((track) => {
          const isSelected = selectedTrackId === track.id;
          const liveValue = interpolateKeyframes(track.keyframes, scrollPosition);

          return (
            <div
              key={track.id}
              onClick={() => setSelectedTrackId(track.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: isSelected ? 'rgba(139, 92, 246, 0.08)' : 'rgba(255, 255, 255, 0.01)',
                border: isSelected ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid transparent',
                borderRadius: '6px',
                padding: '4px 6px',
                transition: 'all 0.15s ease'
              }}
            >
              {/* Track Info Header */}
              <div style={{
                width: '180px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                paddingLeft: '2px',
                overflow: 'hidden'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                  <span style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    color: isSelected ? '#c084fc' : '#e5e7eb',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap'
                  }} title={track.nodeId}>
                    {track.nodeId}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeScrollTrack(track.id);
                      if (selectedTrackId === track.id) setSelectedTrackId(null);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      padding: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      opacity: 0.6
                    }}
                    title="Remove Track"
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{
                    fontSize: '10px',
                    color: '#9ca3af',
                    fontFamily: "'JetBrains Mono', monospace",
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap'
                  }}>
                    {track.property}
                  </span>
                  <span style={{
                    fontSize: '9.5px',
                    color: '#34d399',
                    fontFamily: "'JetBrains Mono', monospace",
                    fontWeight: 600
                  }}>
                    {liveValue}
                  </span>
                </div>
              </div>

              {/* Track Lane */}
              <div
                onClick={(e) => {
                  handleTrackScrub(e);
                  setSelectedTrackId(track.id);
                }}
                style={{
                  flex: 1,
                  height: '32px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  borderRadius: '4px',
                  border: isSelected ? '1px solid rgba(139, 92, 246, 0.3)' : '1px solid rgba(255, 255, 255, 0.05)',
                  position: 'relative',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                {/* Visual Connection Line between keyframes */}
                {track.keyframes.length > 1 && (() => {
                  const sorted = [...track.keyframes].sort((a, b) => a.scrollPixel - b.scrollPixel);
                  const firstPct = (sorted[0].scrollPixel / Math.max(1, scrollHeight)) * 100;
                  const lastPct = (sorted[sorted.length - 1].scrollPixel / Math.max(1, scrollHeight)) * 100;
                  return (
                    <div style={{
                      position: 'absolute',
                      left: `${firstPct}%`,
                      width: `${Math.max(0, lastPct - firstPct)}%`,
                      height: '2px',
                      background: isSelected ? 'linear-gradient(90deg, #8b5cf6, #38bdf8)' : 'rgba(139, 92, 246, 0.4)',
                      zIndex: 5
                    }} />
                  );
                })()}

                {/* Vertical Playhead Cursor Line through Track */}
                <div style={{
                  position: 'absolute',
                  left: `${progressPercent}%`,
                  top: 0,
                  bottom: 0,
                  width: '1px',
                  background: 'rgba(239, 68, 68, 0.6)',
                  pointerEvents: 'none',
                  zIndex: 10
                }} />

                {/* Keyframes */}
                {track.keyframes.map((kf) => {
                  const kfPercent = scrollHeight > 0 ? (kf.scrollPixel / scrollHeight) * 100 : 0;
                  const isKfSelected = editingKeyframe?.kf.id === kf.id;

                  return (
                    <div
                      key={kf.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setScrollPosition(kf.scrollPixel);
                        scrollPosRef.current = kf.scrollPixel;
                        syncScrollToGuest(kf.scrollPixel, true);
                        setSelectedTrackId(track.id);
                        setEditingKeyframe({ trackId: track.id, kf });
                      }}
                      title={`Keyframe: ${kf.scrollPixel}px | Value: ${kf.value} | Easing: ${kf.easing || 'power2.out'}`}
                      style={{
                        position: 'absolute',
                        left: `${kfPercent}%`,
                        transform: 'translate(-50%, 0) rotate(45deg)',
                        width: isKfSelected ? '13px' : '11px',
                        height: isKfSelected ? '13px' : '11px',
                        background: isKfSelected ? '#38bdf8' : '#8b5cf6',
                        border: isKfSelected ? '2px solid #ffffff' : '1.5px solid #ffffff',
                        borderRadius: '2px',
                        boxShadow: isKfSelected ? '0 0 14px #38bdf8' : '0 0 8px rgba(139, 92, 246, 0.8)',
                        cursor: 'pointer',
                        zIndex: 15,
                        transition: 'all 0.15s ease'
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Keyframe Editor Popover */}
      {editingKeyframe && (
        <div style={{
          position: 'absolute',
          bottom: '16px',
          right: '16px',
          width: '260px',
          background: 'rgba(15, 15, 22, 0.98)',
          border: '1px solid rgba(139, 92, 246, 0.5)',
          borderRadius: '10px',
          padding: '14px',
          boxShadow: '0 12px 36px rgba(0, 0, 0, 0.7)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          backdropFilter: 'blur(16px)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#f3f4f6', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Key size={13} color="#a855f7" /> Edit Keyframe
            </span>
            <button
              onClick={() => setEditingKeyframe(null)}
              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px' }}
            >
              ✕
            </button>
          </div>
          
          {/* Scroll Offset (px) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>Scroll Offset (px)</label>
            <input
              type="number"
              value={editingKeyframe.kf.scrollPixel}
              onChange={(e) => {
                const newPixel = Number(e.target.value);
                updateScrollKeyframe(editingKeyframe.trackId, editingKeyframe.kf.id, { scrollPixel: newPixel });
                setEditingKeyframe(prev => prev ? { ...prev, kf: { ...prev.kf, scrollPixel: newPixel } } : null);
                syncScrollToGuest(newPixel, true);
              }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '5px',
                color: '#fff',
                padding: '5px 8px',
                fontSize: '11px',
                fontFamily: 'monospace'
              }}
            />
          </div>

          {/* Target Value */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>Target Value (e.g. 1, 0, 100, 45deg)</label>
            <input
              type="text"
              value={Array.isArray(editingKeyframe.kf.value) ? editingKeyframe.kf.value.join(', ') : String(editingKeyframe.kf.value ?? '')}
              onChange={(e) => {
                const raw = e.target.value;
                const num = Number(raw);
                const newVal: number | string = isNaN(num) || raw.trim() === '' ? raw : num;
                updateScrollKeyframe(editingKeyframe.trackId, editingKeyframe.kf.id, { value: newVal });
                setEditingKeyframe(prev => prev ? { ...prev, kf: { ...prev.kf, value: newVal } } : null);
                syncScrollToGuest(scrollPosition, true);
              }}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '5px',
                color: '#34d399',
                padding: '5px 8px',
                fontSize: '11px',
                fontFamily: 'monospace',
                fontWeight: 600
              }}
            />
          </div>

          {/* Easing Curve */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>Easing Curve</label>
            <select
              value={editingKeyframe.kf.easing || 'power2.out'}
              onChange={(e) => {
                const newEase = e.target.value;
                updateScrollKeyframe(editingKeyframe.trackId, editingKeyframe.kf.id, { easing: newEase });
                setEditingKeyframe(prev => prev ? { ...prev, kf: { ...prev.kf, easing: newEase } } : null);
                syncScrollToGuest(scrollPosition, true);
              }}
              style={{
                background: '#13131c',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '5px',
                color: '#38bdf8',
                padding: '5px 8px',
                fontSize: '11px'
              }}
            >
              {EASING_PRESETS.map(ease => (
                <option key={ease} value={ease} style={{ background: '#111', color: '#fff' }}>{ease}</option>
              ))}
            </select>
          </div>

          {/* Delete Keyframe Button */}
          <button
            onClick={() => {
              removeScrollKeyframe(editingKeyframe.trackId, editingKeyframe.kf.id);
              setEditingKeyframe(null);
              syncScrollToGuest(scrollPosition, true);
            }}
            style={{
              marginTop: '4px',
              padding: '6px',
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '5px',
              color: '#f87171',
              fontSize: '11px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px'
            }}
          >
            <Trash2 size={12} /> Delete Keyframe
          </button>
        </div>
      )}
    </div>
  );
}
