import React, { useState } from 'react';
import { useSceneStore } from '../core/SceneGraph';
import { BrowserBridge } from '../core/BrowserBridge';
import { 
  ChevronDown, 
  ChevronRight,
  Box,
  Columns2,
  LayoutGrid,
  Component,
  EyeOff,
  ArrowRight,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalSpaceBetween,
  AlignHorizontalSpaceAround,
  AlignHorizontalDistributeCenter,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  StretchVertical,
  Baseline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Layers,
  Sparkles,
  Type,
  Palette,
  Move,
  SlidersHorizontal
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*                               Accordion Component                           */
/* -------------------------------------------------------------------------- */
const Accordion = ({ 
  title, 
  children, 
  defaultOpen = false,
  badge
}: { 
  title: string; 
  children: React.ReactNode; 
  defaultOpen?: boolean;
  badge?: string;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '9px 0', 
          cursor: 'pointer', 
          fontSize: '11px', 
          color: isOpen ? '#f3f4f6' : '#9ca3af', 
          fontWeight: 600, 
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          userSelect: 'none',
          transition: 'color 0.15s ease'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {isOpen ? (
            <ChevronDown size={14} style={{ marginRight: '6px', color: '#a78bfa' }} />
          ) : (
            <ChevronRight size={14} style={{ marginRight: '6px', color: '#6b7280' }} />
          )}
          <span>{title}</span>
        </div>
        {badge && (
          <span style={{ 
            fontSize: '9px', 
            background: 'rgba(139, 92, 246, 0.15)', 
            color: '#c084fc', 
            padding: '1px 5px', 
            borderRadius: '4px',
            fontWeight: 500,
            textTransform: 'none'
          }}>
            {badge}
          </span>
        )}
      </div>
      {isOpen && (
        <div style={{ paddingBottom: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {children}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/*                               Input Field                                  */
/* -------------------------------------------------------------------------- */
const InputField = React.memo(({ 
  label, 
  propName, 
  value, 
  placeholder,
  onChange 
}: { 
  label: string; 
  propName: string; 
  value?: string; 
  placeholder?: string;
  onChange: (key: string, val: string) => void;
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
     <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>{label}</span>
     <input 
        type="text" 
        className="glass-input" 
        value={value || ''} 
        placeholder={placeholder || 'none'}
        onChange={(e) => onChange(propName, e.target.value)} 
        style={{ width: '100%' }}
     />
  </div>
));

/* -------------------------------------------------------------------------- */
/*                             Dimension Field                                */
/* -------------------------------------------------------------------------- */
const DimensionField = React.memo(({ 
  label, 
  propName, 
  value, 
  placeholder, 
  unit = 'px',
  onChange 
}: { 
  label: string; 
  propName: string; 
  value?: string; 
  placeholder?: string; 
  unit?: string;
  onChange: (key: string, val: string) => void;
}) => {
  const rawVal = value || '';
  const displayVal = rawVal.endsWith(unit) ? rawVal.slice(0, -unit.length) : rawVal;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>{label}</span>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input 
          type="text" 
          className="glass-input" 
          value={displayVal} 
          placeholder={placeholder || '0'}
          onChange={(e) => onChange(propName, e.target.value)} 
          style={{ width: '100%', paddingRight: unit ? '24px' : '8px' }}
        />
        {unit && (
          <span style={{ 
            position: 'absolute', 
            right: '7px', 
            fontSize: '9px', 
            color: '#6b7280', 
            pointerEvents: 'none', 
            fontFamily: 'monospace',
            fontWeight: 600
          }}>
            {unit}
          </span>
        )}
      </div>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                               Color Field                                  */
/* -------------------------------------------------------------------------- */
const ColorField = React.memo(({ 
  label, 
  propName, 
  value, 
  onChange 
}: { 
  label: string; 
  propName: string; 
  value?: string; 
  onChange: (key: string, val: string) => void;
}) => {
  const rawVal = value || '';
  
  // Clean hex value for the native picker if valid
  let hexVal = '#000000';
  if (/^#([0-9A-Fa-f]{3}){1,2}$/.test(rawVal.trim())) {
    hexVal = rawVal.trim().length === 4 
      ? `#${rawVal[1]}${rawVal[1]}${rawVal[2]}${rawVal[2]}${rawVal[3]}${rawVal[3]}` 
      : rawVal.trim();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{
          position: 'relative',
          width: '24px',
          height: '24px',
          borderRadius: '5px',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          overflow: 'hidden',
          flexShrink: 0,
          cursor: 'pointer',
          backgroundImage: 'linear-gradient(45deg, #262633 25%, transparent 25%), linear-gradient(-45deg, #262633 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #262633 75%), linear-gradient(-45deg, transparent 75%, #262633 75%)',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px'
        }}>
          <div style={{ position: 'absolute', inset: 0, background: rawVal || 'transparent' }} />
          <input
            type="color"
            value={hexVal}
            onChange={(e) => onChange(propName, e.target.value)}
            style={{
              position: 'absolute',
              inset: '-8px',
              opacity: 0,
              cursor: 'pointer',
              width: '40px',
              height: '40px'
            }}
          />
        </div>
        <input
          type="text"
          className="glass-input"
          value={rawVal}
          placeholder="transparent"
          onChange={(e) => onChange(propName, e.target.value)}
          style={{ flex: 1, minWidth: 0, padding: '5px 8px' }}
        />
      </div>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                         Segmented Button Control                           */
/* -------------------------------------------------------------------------- */
export interface SegmentOption {
  value: string;
  label?: string;
  icon?: React.ReactNode;
  tooltip?: string;
}

const SegmentedControl = React.memo(({
  label,
  value,
  options,
  onChange,
  activeMatcher
}: {
  label?: string;
  value?: string;
  options: SegmentOption[];
  onChange: (val: string) => void;
  activeMatcher?: (optionValue: string, currentValue?: string) => boolean;
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%' }}>
      {label && <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>{label}</span>}
      <div style={{
        display: 'flex',
        background: 'rgba(0, 0, 0, 0.45)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '7px',
        padding: '2px',
        gap: '2px',
        width: '100%',
        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.5)'
      }}>
        {options.map((opt) => {
          const isActive = activeMatcher 
            ? activeMatcher(opt.value, value)
            : (value?.toLowerCase().trim() === opt.value.toLowerCase().trim());

          return (
            <button
              key={opt.value}
              type="button"
              title={opt.tooltip || opt.label || opt.value}
              onClick={() => onChange(opt.value)}
              className={`ams-segmented-btn ${isActive ? 'active' : ''}`}
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '5px 3px',
                borderRadius: '5px',
                border: isActive ? '1px solid rgba(139, 92, 246, 0.7)' : '1px solid transparent',
                background: isActive 
                  ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.38) 0%, rgba(99, 102, 241, 0.25) 100%)' 
                  : 'transparent',
                color: isActive ? '#ffffff' : '#9ca3af',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: isActive ? 600 : 500,
                transition: 'all 0.15s ease',
                boxShadow: isActive ? '0 0 10px rgba(139, 92, 246, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)' : 'none',
                minWidth: 0
              }}
            >
              {opt.icon}
              {opt.label && (
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '10px' }}>
                  {opt.label}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                           Visual Opacity Slider                            */
/* -------------------------------------------------------------------------- */
const OpacitySlider = React.memo(({ 
  value, 
  onChange 
}: { 
  value?: string; 
  onChange: (key: string, val: string) => void;
}) => {
  let numVal = 1;
  if (value !== undefined && value !== '') {
    if (value.endsWith('%')) {
      const parsed = parseFloat(value) / 100;
      if (!isNaN(parsed)) numVal = parsed;
    } else {
      const parsed = parseFloat(value);
      if (!isNaN(parsed)) numVal = parsed;
    }
  }
  numVal = Math.min(Math.max(numVal, 0), 1);
  const percentVal = Math.round(numVal * 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>Opacity</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            className="glass-input"
            value={percentVal}
            onChange={(e) => {
              const p = parseFloat(e.target.value);
              if (!isNaN(p)) {
                const clamped = Math.min(Math.max(p / 100, 0), 1);
                onChange('opacity', clamped.toFixed(2).replace(/\.?0+$/, ''));
              }
            }}
            style={{ width: '46px', padding: '2px 4px', textAlign: 'right', fontSize: '10px' }}
          />
          <span style={{ fontSize: '10px', color: '#6b7280', fontWeight: 600 }}>%</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          className="ams-slider"
          value={numVal}
          onChange={(e) => onChange('opacity', e.target.value)}
          style={{
            flex: 1,
            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${percentVal}%, rgba(255,255,255,0.12) ${percentVal}%, rgba(255,255,255,0.12) 100%)`
          }}
        />
      </div>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                         Visual Font Weight Slider                          */
/* -------------------------------------------------------------------------- */
const FONT_WEIGHTS = [
  { value: 100, name: 'Thin' },
  { value: 200, name: 'Extra Light' },
  { value: 300, name: 'Light' },
  { value: 400, name: 'Regular' },
  { value: 500, name: 'Medium' },
  { value: 600, name: 'Semi Bold' },
  { value: 700, name: 'Bold' },
  { value: 800, name: 'Extra Bold' },
  { value: 900, name: 'Black' }
];

const FontWeightSlider = React.memo(({ 
  value, 
  onChange 
}: { 
  value?: string; 
  onChange: (key: string, val: string) => void;
}) => {
  let numVal = 400;
  if (value) {
    const lower = value.toLowerCase().trim();
    if (lower === 'normal') numVal = 400;
    else if (lower === 'bold') numVal = 700;
    else if (lower === 'lighter') numVal = 300;
    else if (lower === 'bolder') numVal = 800;
    else {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) numVal = Math.min(Math.max(Math.round(parsed / 100) * 100, 100), 900);
    }
  }

  const currentWeightObj = FONT_WEIGHTS.find(w => w.value === numVal) || FONT_WEIGHTS[3];
  const fillPercent = ((numVal - 100) / 800) * 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 500 }}>Font Weight</span>
        <span style={{ fontSize: '10px', color: '#c084fc', fontWeight: 600 }}>
          {numVal} · {currentWeightObj.name}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="range"
          min="100"
          max="900"
          step="100"
          className="ams-slider"
          value={numVal}
          onChange={(e) => onChange('fontWeight', e.target.value)}
          style={{
            flex: 1,
            background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${fillPercent}%, rgba(255,255,255,0.12) ${fillPercent}%, rgba(255,255,255,0.12) 100%)`
          }}
        />
      </div>
      {/* Quick Weight Selector Chips */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '3px', marginTop: '2px' }}>
        {[
          { label: '300', val: '300', title: 'Light' },
          { label: '400', val: '400', title: 'Regular' },
          { label: '500', val: '500', title: 'Medium' },
          { label: '600', val: '600', title: 'SemiBold' },
          { label: '700', val: '700', title: 'Bold' },
          { label: '900', val: '900', title: 'Black' }
        ].map((chip) => {
          const isSelected = numVal === parseInt(chip.val, 10);
          return (
            <button
              key={chip.val}
              type="button"
              title={chip.title}
              onClick={() => onChange('fontWeight', chip.val)}
              style={{
                background: isSelected ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                border: isSelected ? '1px solid #8b5cf6' : '1px solid rgba(255, 255, 255, 0.08)',
                color: isSelected ? '#ffffff' : '#9ca3af',
                fontSize: '9px',
                padding: '3px 2px',
                borderRadius: '4px',
                cursor: 'pointer',
                flex: 1,
                textAlign: 'center',
                fontWeight: isSelected ? 700 : 500,
                transition: 'all 0.15s ease'
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*                     Flex/Alignment Matching Helpers                        */
/* -------------------------------------------------------------------------- */
const flexMatcher = (optVal: string, curVal?: string) => {
  if (!curVal) return false;
  const c = curVal.toLowerCase().trim();
  const o = optVal.toLowerCase().trim();
  if (c === o) return true;
  if ((o === 'flex-start' && c === 'start') || (o === 'start' && c === 'flex-start')) return true;
  if ((o === 'flex-end' && c === 'end') || (o === 'end' && c === 'flex-end')) return true;
  return false;
};

const DISPLAY_OPTIONS: SegmentOption[] = [
  { value: 'block', label: 'Block', icon: <Box size={12} />, tooltip: 'display: block' },
  { value: 'flex', label: 'Flex', icon: <Columns2 size={12} />, tooltip: 'display: flex' },
  { value: 'grid', label: 'Grid', icon: <LayoutGrid size={12} />, tooltip: 'display: grid' },
  { value: 'inline-block', label: 'Inline', icon: <Component size={12} />, tooltip: 'display: inline-block' },
  { value: 'none', label: 'None', icon: <EyeOff size={12} />, tooltip: 'display: none' },
];

const POSITION_OPTIONS: SegmentOption[] = [
  { value: 'static', label: 'Static', tooltip: 'position: static' },
  { value: 'relative', label: 'Relative', tooltip: 'position: relative' },
  { value: 'absolute', label: 'Absolute', tooltip: 'position: absolute' },
  { value: 'fixed', label: 'Fixed', tooltip: 'position: fixed' },
  { value: 'sticky', label: 'Sticky', tooltip: 'position: sticky' },
];

const FLEX_DIRECTION_OPTIONS: SegmentOption[] = [
  { value: 'row', icon: <ArrowRight size={13} />, tooltip: 'Row (Horizontal Left → Right)' },
  { value: 'column', icon: <ArrowDown size={13} />, tooltip: 'Column (Vertical Top ↓ Bottom)' },
  { value: 'row-reverse', icon: <ArrowLeft size={13} />, tooltip: 'Row Reverse (Right → Left)' },
  { value: 'column-reverse', icon: <ArrowUp size={13} />, tooltip: 'Column Reverse (Bottom ↑ Top)' },
];

const JUSTIFY_CONTENT_OPTIONS: SegmentOption[] = [
  { value: 'flex-start', icon: <AlignHorizontalJustifyStart size={13} />, tooltip: 'Start (flex-start)' },
  { value: 'center', icon: <AlignHorizontalJustifyCenter size={13} />, tooltip: 'Center (center)' },
  { value: 'flex-end', icon: <AlignHorizontalJustifyEnd size={13} />, tooltip: 'End (flex-end)' },
  { value: 'space-between', icon: <AlignHorizontalSpaceBetween size={13} />, tooltip: 'Space Between' },
  { value: 'space-around', icon: <AlignHorizontalSpaceAround size={13} />, tooltip: 'Space Around' },
  { value: 'space-evenly', icon: <AlignHorizontalDistributeCenter size={13} />, tooltip: 'Space Evenly' },
];

const ALIGN_ITEMS_OPTIONS: SegmentOption[] = [
  { value: 'flex-start', icon: <AlignVerticalJustifyStart size={13} />, tooltip: 'Start (flex-start)' },
  { value: 'center', icon: <AlignVerticalJustifyCenter size={13} />, tooltip: 'Center (center)' },
  { value: 'flex-end', icon: <AlignVerticalJustifyEnd size={13} />, tooltip: 'End (flex-end)' },
  { value: 'stretch', icon: <StretchVertical size={13} />, tooltip: 'Stretch (stretch)' },
  { value: 'baseline', icon: <Baseline size={13} />, tooltip: 'Baseline (baseline)' },
];

const TEXT_ALIGN_OPTIONS: SegmentOption[] = [
  { value: 'left', icon: <AlignLeft size={13} />, tooltip: 'Align Left' },
  { value: 'center', icon: <AlignCenter size={13} />, tooltip: 'Align Center' },
  { value: 'right', icon: <AlignRight size={13} />, tooltip: 'Align Right' },
  { value: 'justify', icon: <AlignJustify size={13} />, tooltip: 'Justify' },
];

/* -------------------------------------------------------------------------- */
/*                         Main PropertyInspector                             */
/* -------------------------------------------------------------------------- */
export function PropertyInspector() {
  const nodes = useSceneStore((state) => state.nodes);
  const selectedNodeId = useSceneStore((state) => state.selectedNodeId);
  const updateTransform = useSceneStore((state) => state.updateTransform);
  
  const selectedElementPath = useSceneStore((state) => state.selectedElementPath) as any;
  const selectedElementStyles = useSceneStore((state) => state.selectedElementStyles) || {};
  const selectedElementText = useSceneStore((state) => state.selectedElementText);
  const setSelectedElementText = useSceneStore((state) => state.setSelectedElementText);
  const updateSelectedElementStyle = useSceneStore((state) => state.updateSelectedElementStyle);

  const selectedNode = selectedNodeId ? nodes[selectedNodeId] : null;

  const handleTextChange = (newText: string) => {
    setSelectedElementText(newText);
    BrowserBridge.setTextContent(newText);
  };

  const handleStyleChange = (key: string, value: string) => {
    let formattedValue = value;
    const pixelProperties = [
      'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
      'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontSize', 'lineHeight', 'letterSpacing', 'gap', 'borderRadius', 'top', 'left', 'right', 'bottom'
    ];

    if (pixelProperties.includes(key) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
      formattedValue = `${value.trim()}px`;
    }

    if (updateSelectedElementStyle) {
      updateSelectedElementStyle(key, formattedValue);
    }
    BrowserBridge.applyLiveStyle({ [key]: formattedValue });
  };

  if (!selectedNode && !selectedElementPath) {
    return (
      <div style={{
        padding: '24px 16px',
        background: 'rgba(18, 18, 26, 0.75)',
        backdropFilter: 'blur(20px)',
        height: '100%',
        color: '#6b7280',
        fontSize: '12px',
        borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: '12px'
      }}>
        <SlidersHorizontal size={28} style={{ color: '#4b5563' }} />
        <div>
          <div style={{ fontWeight: 600, color: '#9ca3af', marginBottom: '4px' }}>No Element Selected</div>
          <div style={{ fontSize: '11px', color: '#6b7280' }}>Click an element in the live viewport or layers panel to inspect and edit properties.</div>
        </div>
      </div>
    );
  }

  const isFlex = selectedElementStyles.display === 'flex' || selectedElementStyles.display === 'inline-flex';

  return (
    <div className="glass-panel" style={{
      padding: '16px',
      height: '100%',
      borderRadius: 0,
      borderTop: 'none',
      borderBottom: 'none',
      borderRight: 'none',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      color: '#f3f4f6',
      overflowY: 'auto'
    }}>
      <style>{`
        .ams-slider {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: rgba(255, 255, 255, 0.12);
          outline: none;
          cursor: pointer;
        }
        .ams-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #8b5cf6;
          border: 2px solid #ffffff;
          box-shadow: 0 0 6px rgba(139, 92, 246, 0.8);
          cursor: pointer;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
        }
        .ams-slider::-webkit-slider-thumb:hover {
          transform: scale(1.25);
          box-shadow: 0 0 10px rgba(139, 92, 246, 1);
        }
        .ams-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #8b5cf6;
          border: 2px solid #ffffff;
          box-shadow: 0 0 6px rgba(139, 92, 246, 0.8);
          cursor: pointer;
        }
        .ams-segmented-btn:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          color: #f3f4f6 !important;
        }
        .ams-segmented-btn.active {
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.38) 0%, rgba(99, 102, 241, 0.25) 100%) !important;
          border-color: rgba(139, 92, 246, 0.7) !important;
          color: #ffffff !important;
          box-shadow: 0 0 10px rgba(139, 92, 246, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25) !important;
        }
      `}</style>

      {/* Panel Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#9ca3af' }}>
          Property Inspector
        </span>
        <span style={{ fontSize: '10px', color: '#8b5cf6', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Sparkles size={11} /> Live Sync
        </span>
      </div>

      {selectedElementPath ? (
        <>
          {/* Target Element Badge */}
          <div style={{ 
            fontSize: '11px', 
            color: '#a78bfa', 
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid rgba(139, 92, 246, 0.2)',
            borderRadius: '6px',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
              <Box size={13} style={{ color: '#8b5cf6', flexShrink: 0 }} />
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {selectedElementPath.file?.split('/').pop() || 'Element'}
              </span>
            </div>
            {selectedElementPath.line && (
              <span style={{ fontSize: '9px', color: '#9ca3af', fontFamily: 'monospace', flexShrink: 0 }}>
                L{selectedElementPath.line}:{selectedElementPath.column}
              </span>
            )}
          </div>

          {/* Text Content Editor */}
          {selectedElementText !== null && (
            <div style={{
              background: 'rgba(139, 92, 246, 0.1)',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '8px',
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              marginBottom: '2px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: '#c084fc', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                  Text Content
                </span>
                <span style={{ fontSize: '9px', color: '#9ca3af' }}>Double-click on page to edit</span>
              </div>
              <textarea
                className="glass-input"
                rows={2}
                value={selectedElementText}
                placeholder="Enter text..."
                onChange={(e) => handleTextChange(e.target.value)}
                style={{
                  width: '100%',
                  resize: 'vertical',
                  fontSize: '12px',
                  fontFamily: 'inherit',
                  padding: '6px 8px'
                }}
              />
            </div>
          )}
          
          {/* ================================================================ */}
          {/*                            LAYOUT                                */}
          {/* ================================================================ */}
          <Accordion title="Layout" defaultOpen badge={selectedElementStyles.display || 'block'}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Display Segmented Bar */}
              <SegmentedControl
                label="Display"
                value={selectedElementStyles.display || 'block'}
                options={DISPLAY_OPTIONS}
                onChange={(val) => handleStyleChange('display', val)}
              />

              {/* Position Segmented Bar */}
              <SegmentedControl
                label="Position"
                value={selectedElementStyles.position || 'static'}
                options={POSITION_OPTIONS}
                onChange={(val) => handleStyleChange('position', val)}
              />

              {/* Flexbox Alignment Section */}
              <div style={{
                background: isFlex ? 'rgba(139, 92, 246, 0.06)' : 'rgba(0, 0, 0, 0.25)',
                border: isFlex ? '1px solid rgba(139, 92, 246, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)',
                borderRadius: '8px',
                padding: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '10px', color: isFlex ? '#c084fc' : '#9ca3af', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                    Flexbox Alignment
                  </span>
                  {!isFlex && (
                    <span style={{ fontSize: '9px', color: '#6b7280', fontStyle: 'italic' }}>
                      (Set Display to Flex to activate)
                    </span>
                  )}
                </div>

                {/* Flex Direction */}
                <SegmentedControl
                  label="Direction"
                  value={selectedElementStyles.flexDirection || 'row'}
                  options={FLEX_DIRECTION_OPTIONS}
                  onChange={(val) => {
                    if (!isFlex) handleStyleChange('display', 'flex');
                    handleStyleChange('flexDirection', val);
                  }}
                />

                {/* Justify Content */}
                <SegmentedControl
                  label="Justify Content (Main Axis)"
                  value={selectedElementStyles.justifyContent || 'flex-start'}
                  options={JUSTIFY_CONTENT_OPTIONS}
                  activeMatcher={flexMatcher}
                  onChange={(val) => {
                    if (!isFlex) handleStyleChange('display', 'flex');
                    handleStyleChange('justifyContent', val);
                  }}
                />

                {/* Align Items */}
                <SegmentedControl
                  label="Align Items (Cross Axis)"
                  value={selectedElementStyles.alignItems || 'stretch'}
                  options={ALIGN_ITEMS_OPTIONS}
                  activeMatcher={flexMatcher}
                  onChange={(val) => {
                    if (!isFlex) handleStyleChange('display', 'flex');
                    handleStyleChange('alignItems', val);
                  }}
                />

                {/* Gap */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <DimensionField 
                    label="Gap" 
                    propName="gap" 
                    value={selectedElementStyles.gap} 
                    placeholder="0"
                    onChange={handleStyleChange} 
                  />
                  <InputField 
                    label="Flex Wrap" 
                    propName="flexWrap" 
                    value={selectedElementStyles.flexWrap} 
                    placeholder="nowrap"
                    onChange={handleStyleChange} 
                  />
                </div>
              </div>
            </div>
          </Accordion>

          {/* ================================================================ */}
          {/*                          DIMENSIONS                              */}
          {/* ================================================================ */}
          <Accordion title="Dimensions" defaultOpen>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <DimensionField label="Width" propName="width" value={selectedElementStyles.width} placeholder="auto" onChange={handleStyleChange} />
              <DimensionField label="Height" propName="height" value={selectedElementStyles.height} placeholder="auto" onChange={handleStyleChange} />
              <DimensionField label="Min W" propName="minWidth" value={selectedElementStyles.minWidth} placeholder="none" onChange={handleStyleChange} />
              <DimensionField label="Min H" propName="minHeight" value={selectedElementStyles.minHeight} placeholder="none" onChange={handleStyleChange} />
              <DimensionField label="Max W" propName="maxWidth" value={selectedElementStyles.maxWidth} placeholder="none" onChange={handleStyleChange} />
              <DimensionField label="Max H" propName="maxHeight" value={selectedElementStyles.maxHeight} placeholder="none" onChange={handleStyleChange} />
            </div>

            {/* Margin Quad */}
            <div style={{ marginTop: '4px' }}>
              <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>Margin</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px', marginTop: '4px' }}>
                <DimensionField label="Top" propName="marginTop" value={selectedElementStyles.marginTop} onChange={handleStyleChange} />
                <DimensionField label="Right" propName="marginRight" value={selectedElementStyles.marginRight} onChange={handleStyleChange} />
                <DimensionField label="Bottom" propName="marginBottom" value={selectedElementStyles.marginBottom} onChange={handleStyleChange} />
                <DimensionField label="Left" propName="marginLeft" value={selectedElementStyles.marginLeft} onChange={handleStyleChange} />
              </div>
            </div>

            {/* Padding Quad */}
            <div style={{ marginTop: '4px' }}>
              <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>Padding</span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px', marginTop: '4px' }}>
                <DimensionField label="Top" propName="paddingTop" value={selectedElementStyles.paddingTop} onChange={handleStyleChange} />
                <DimensionField label="Right" propName="paddingRight" value={selectedElementStyles.paddingRight} onChange={handleStyleChange} />
                <DimensionField label="Bottom" propName="paddingBottom" value={selectedElementStyles.paddingBottom} onChange={handleStyleChange} />
                <DimensionField label="Left" propName="paddingLeft" value={selectedElementStyles.paddingLeft} onChange={handleStyleChange} />
              </div>
            </div>
          </Accordion>

          {/* ================================================================ */}
          {/*                          TYPOGRAPHY                              */}
          {/* ================================================================ */}
          <Accordion title="Typography" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <InputField label="Font Family" propName="fontFamily" value={selectedElementStyles.fontFamily} placeholder="sans-serif" onChange={handleStyleChange} />
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <DimensionField label="Font Size" propName="fontSize" value={selectedElementStyles.fontSize} placeholder="16" onChange={handleStyleChange} />
                <DimensionField label="Line Height" propName="lineHeight" value={selectedElementStyles.lineHeight} placeholder="normal" onChange={handleStyleChange} />
              </div>

              {/* Visual Font Weight Slider */}
              <FontWeightSlider 
                value={selectedElementStyles.fontWeight} 
                onChange={handleStyleChange} 
              />

              {/* Text Align Segmented Control */}
              <SegmentedControl
                label="Text Align"
                value={selectedElementStyles.textAlign || 'left'}
                options={TEXT_ALIGN_OPTIONS}
                onChange={(val) => handleStyleChange('textAlign', val)}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <ColorField label="Color" propName="color" value={selectedElementStyles.color} onChange={handleStyleChange} />
                <DimensionField label="Letter Spacing" propName="letterSpacing" value={selectedElementStyles.letterSpacing} placeholder="normal" onChange={handleStyleChange} />
              </div>
            </div>
          </Accordion>

          {/* ================================================================ */}
          {/*                          APPEARANCE                              */}
          {/* ================================================================ */}
          <Accordion title="Appearance" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Visual Opacity Slider */}
              <OpacitySlider 
                value={selectedElementStyles.opacity} 
                onChange={handleStyleChange} 
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <ColorField label="Bg Color" propName="backgroundColor" value={selectedElementStyles.backgroundColor} onChange={handleStyleChange} />
                <DimensionField label="Radius" propName="borderRadius" value={selectedElementStyles.borderRadius} placeholder="0" onChange={handleStyleChange} />
              </div>

              <InputField label="Background" propName="background" value={selectedElementStyles.background} placeholder="none" onChange={handleStyleChange} />
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <InputField label="Border" propName="border" value={selectedElementStyles.border} placeholder="none" onChange={handleStyleChange} />
                <InputField label="Box Shadow" propName="boxShadow" value={selectedElementStyles.boxShadow} placeholder="none" onChange={handleStyleChange} />
              </div>
            </div>
          </Accordion>

          {/* ================================================================ */}
          {/*                           TRANSFORM                              */}
          {/* ================================================================ */}
          <Accordion title="Transform">
             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <InputField label="Transform" propName="transform" value={selectedElementStyles.transform} placeholder="none" onChange={handleStyleChange} />
              <InputField label="Origin" propName="transformOrigin" value={selectedElementStyles.transformOrigin} placeholder="center" onChange={handleStyleChange} />
             </div>
          </Accordion>
        </>
      ) : selectedNode ? (
        <>
          {/* 3D Node Header */}
          <div style={{ 
            fontSize: '12px', 
            fontWeight: 600, 
            color: '#a78bfa',
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.25)',
            borderRadius: '6px',
            padding: '8px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <span>{selectedNode.name}</span>
            <span style={{ fontSize: '10px', color: '#c084fc', textTransform: 'uppercase', fontFamily: 'monospace' }}>
              {selectedNode.type}
            </span>
          </div>

          <Accordion title="Transform 3D" defaultOpen>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Position */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>Position</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  {[
                    { axis: 'X', color: '#ef4444', idx: 0 },
                    { axis: 'Y', color: '#10b981', idx: 1 },
                    { axis: 'Z', color: '#3b82f6', idx: 2 }
                  ].map(({ axis, color, idx }) => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color, fontWeight: 700, width: '10px' }}>{axis}</span>
                      <input
                        type="number"
                        step="0.1"
                        className="glass-input"
                        value={selectedNode.transform.position[idx] !== undefined ? selectedNode.transform.position[idx].toFixed(2) : '0.00'}
                        onChange={(e) => {
                          const newPos = [...selectedNode.transform.position] as [number, number, number];
                          newPos[idx] = parseFloat(e.target.value) || 0;
                          updateTransform(selectedNode.id, { position: newPos });
                        }}
                        style={{ width: '100%', padding: '4px 6px' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Rotation */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>Rotation (deg)</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  {[
                    { axis: 'X', color: '#ef4444', idx: 0 },
                    { axis: 'Y', color: '#10b981', idx: 1 },
                    { axis: 'Z', color: '#3b82f6', idx: 2 }
                  ].map(({ axis, color, idx }) => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color, fontWeight: 700, width: '10px' }}>{axis}</span>
                      <input
                        type="number"
                        step="1"
                        className="glass-input"
                        value={selectedNode.transform.rotation[idx] !== undefined ? ((selectedNode.transform.rotation[idx] * 180) / Math.PI).toFixed(1) : '0.0'}
                        onChange={(e) => {
                          const newRot = [...selectedNode.transform.rotation] as [number, number, number];
                          const deg = parseFloat(e.target.value) || 0;
                          newRot[idx] = (deg * Math.PI) / 180;
                          updateTransform(selectedNode.id, { rotation: newRot });
                        }}
                        style={{ width: '100%', padding: '4px 6px' }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Scale */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: '#9ca3af', fontWeight: 600 }}>Scale</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                  {[
                    { axis: 'X', color: '#ef4444', idx: 0 },
                    { axis: 'Y', color: '#10b981', idx: 1 },
                    { axis: 'Z', color: '#3b82f6', idx: 2 }
                  ].map(({ axis, color, idx }) => (
                    <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '10px', color, fontWeight: 700, width: '10px' }}>{axis}</span>
                      <input
                        type="number"
                        step="0.1"
                        className="glass-input"
                        value={selectedNode.transform.scale[idx] !== undefined ? selectedNode.transform.scale[idx].toFixed(2) : '1.00'}
                        onChange={(e) => {
                          const newScale = [...selectedNode.transform.scale] as [number, number, number];
                          newScale[idx] = parseFloat(e.target.value) || 1;
                          updateTransform(selectedNode.id, { scale: newScale });
                        }}
                        style={{ width: '100%', padding: '4px 6px' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Accordion>
        </>
      ) : null}
    </div>
  );
}
