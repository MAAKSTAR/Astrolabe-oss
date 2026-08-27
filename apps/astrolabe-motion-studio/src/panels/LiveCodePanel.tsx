import React, { useState, useMemo } from 'react';
import { useSceneStore, ScrollTrack } from '../core/SceneGraph';
import { 
  Copy, 
  Check, 
  FileCode, 
  Download, 
  Sparkles, 
  Palette, 
  Flame, 
  Timer, 
  Code2, 
  Boxes, 
  WrapText,
  FolderOpen,
  Edit2,
  Edit3,
  LucideIcon
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*                                Types & Tabs                                */
/* -------------------------------------------------------------------------- */

export type ExportFormat = 'jsx' | 'css' | 'tailwind' | 'css-modules' | 'styled' | 'gsap' | 'framer';

interface TabConfig {
  id: ExportFormat;
  label: string;
  badge?: string;
  icon: LucideIcon | React.ComponentType<any>;
  defaultFilename: string;
  extension: string;
}

const EXPORT_TABS: TabConfig[] = [
  { id: 'jsx', label: 'React JSX', icon: Code2, defaultFilename: 'Component', extension: '.tsx' },
  { id: 'css', label: 'CSS Classes', icon: Palette, defaultFilename: 'styles', extension: '.css' },
  { id: 'tailwind', label: 'Tailwind CSS', badge: 'v3/v4', icon: Flame, defaultFilename: 'Component', extension: '.tsx' },
  { id: 'css-modules', label: 'CSS Modules', icon: Boxes, defaultFilename: 'Component.module', extension: '.css' },
  { id: 'styled', label: 'Styled Components', icon: Sparkles, defaultFilename: 'StyledComponent', extension: '.tsx' },
  { id: 'gsap', label: 'GSAP Timeline', badge: 'Motion', icon: Timer, defaultFilename: 'useScrollTimeline', extension: '.ts' },
  { id: 'framer', label: 'Framer Motion', badge: 'Motion', icon: Sparkles, defaultFilename: 'FramerComponent', extension: '.tsx' }
];

/* -------------------------------------------------------------------------- */
/*                        Tailwind Converter Dictionary                       */
/* -------------------------------------------------------------------------- */

const SPACING_MAP: Record<number, string> = {
  0: '0',
  1: 'px',
  2: '0.5',
  4: '1',
  6: '1.5',
  8: '2',
  10: '2.5',
  12: '3',
  14: '3.5',
  16: '4',
  18: '4.5',
  20: '5',
  24: '6',
  28: '7',
  32: '8',
  36: '9',
  40: '10',
  44: '11',
  48: '12',
  52: '13',
  56: '14',
  60: '15',
  64: '16',
  72: '18',
  80: '20',
  96: '24',
  112: '28',
  128: '32',
  144: '36',
  160: '40',
  176: '44',
  192: '48',
  208: '52',
  224: '56',
  240: '60',
  256: '64',
  288: '72',
  320: '80',
  384: '96'
};

const COLOR_NAME_MAP: Record<string, string> = {
  '#000000': 'black',
  '#ffffff': 'white',
  '#f8fafc': 'slate-50',
  '#f1f5f9': 'slate-100',
  '#e2e8f0': 'slate-200',
  '#cbd5e1': 'slate-300',
  '#94a3b8': 'slate-400',
  '#64748b': 'slate-500',
  '#475569': 'slate-600',
  '#334155': 'slate-700',
  '#1e293b': 'slate-800',
  '#0f172a': 'slate-900',
  '#020617': 'slate-950',
  '#ef4444': 'red-500',
  '#dc2626': 'red-600',
  '#f97316': 'orange-500',
  '#f59e0b': 'amber-500',
  '#eab308': 'yellow-500',
  '#84cc16': 'lime-500',
  '#22c55e': 'green-500',
  '#10b981': 'emerald-500',
  '#059669': 'emerald-600',
  '#047857': 'emerald-700',
  '#14b8a6': 'teal-500',
  '#06b6d4': 'cyan-500',
  '#0891b2': 'cyan-600',
  '#0ea5e9': 'sky-500',
  '#38bdf8': 'sky-400',
  '#3b82f6': 'blue-500',
  '#2563eb': 'blue-600',
  '#6366f1': 'indigo-500',
  '#4f46e5': 'indigo-600',
  '#8b5cf6': 'purple-500',
  '#7c3aed': 'purple-600',
  '#a855f7': 'purple-500',
  '#c084fc': 'purple-400',
  '#d946ef': 'fuchsia-500',
  '#ec4899': 'pink-500',
  '#f43f5e': 'rose-500'
};

/* -------------------------------------------------------------------------- */
/*                           Helpers & Converters                             */
/* -------------------------------------------------------------------------- */

function parsePx(value: string | undefined): number | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(-?[\d.]+)px$/i);
  return match ? parseFloat(match[1]) : null;
}

function pxToTailwindStep(px: number): string | null {
  const rounded = Math.round(px * 10) / 10;
  if (SPACING_MAP[rounded] !== undefined) {
    return SPACING_MAP[rounded];
  }
  if (px > 0 && px % 4 === 0) {
    return String(px / 4);
  }
  return null;
}

function toSpacingClass(prefix: string, value: string | undefined): string | null {
  if (!value || value === '0px' || value === '0') {
    if (prefix.startsWith('p') || prefix.startsWith('m') || prefix.startsWith('gap')) {
      return `${prefix}-0`;
    }
    return null;
  }

  const px = parsePx(value);
  if (px !== null) {
    if (px < 0) {
      const step = pxToTailwindStep(Math.abs(px));
      return step ? `-${prefix}-${step}` : `-${prefix}-[${Math.abs(px)}px]`;
    }
    const step = pxToTailwindStep(px);
    return step ? `${prefix}-${step}` : `${prefix}-[${value}]`;
  }

  if (value === '100%') return `${prefix}-full`;
  if (value === '50%') return `${prefix}-1/2`;
  if (value === '33.333%' || value === '33.33%') return `${prefix}-1/3`;
  if (value === '66.667%' || value === '66.67%') return `${prefix}-2/3`;
  if (value === '25%') return `${prefix}-1/4`;
  if (value === '75%') return `${prefix}-3/4`;
  if (value === '100vw') return `${prefix}-screen`;
  if (value === '100vh') return `${prefix}-screen`;
  if (value === 'auto') return `${prefix}-auto`;
  if (value === 'fit-content') return `${prefix}-fit`;

  return `${prefix}-[${value}]`;
}

function toTailwindColor(rawColor: string | undefined, type: 'bg' | 'text' | 'border'): string | null {
  if (!rawColor || rawColor === 'transparent' || rawColor === 'rgba(0, 0, 0, 0)') {
    if (type === 'bg') return 'bg-transparent';
    if (type === 'border') return 'border-transparent';
    return null;
  }

  const clean = rawColor.trim().toLowerCase();
  if (COLOR_NAME_MAP[clean]) {
    return `${type}-${COLOR_NAME_MAP[clean]}`;
  }

  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(clean)) {
    return `${type}-[${clean}]`;
  }

  if (clean.startsWith('rgb')) {
    return `${type}-[${clean.replace(/\s+/g, '')}]`;
  }

  return `${type}-[${clean}]`;
}

function toPascalCase(str: string): string {
  if (!str) return 'MotionComponent';
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'MotionComponent';
}

function toKebabCase(str: string): string {
  return str.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

interface ParsedMeta {
  tag: string;
  id: string;
  classes: string[];
  cleanSelector: string;
  componentName: string;
}

function parseElementMeta(
  pathInfo?: { file: string; line: string; column: string } | null,
  domId?: string | null
): ParsedMeta {
  const raw = pathInfo?.file || domId || 'div';

  let tag = 'div';
  let id = '';
  const classes: string[] = [];

  const tagMatch = raw.match(/^([a-zA-Z0-9_-]+)/);
  if (tagMatch && !raw.startsWith('#') && !raw.startsWith('.')) {
    tag = tagMatch[1].toLowerCase();
  }

  const idMatch = raw.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) {
    id = idMatch[1];
  }

  const classMatches = raw.matchAll(/\.([a-zA-Z0-9_-]+)/g);
  for (const cm of classMatches) {
    classes.push(cm[1]);
  }

  let cleanSelector = tag;
  if (id) {
    cleanSelector = `#${id}`;
  } else if (classes.length > 0) {
    cleanSelector = `.${classes.join('.')}`;
  }

  let baseName = id || classes[0] || (tag !== 'div' ? tag : 'MotionCard');
  const componentName = toPascalCase(baseName);

  return { tag, id, classes, cleanSelector, componentName };
}

/* -------------------------------------------------------------------------- */
/*                  Tailwind Full Style Set Converter Engine                  */
/* -------------------------------------------------------------------------- */

function convertStylesToTailwind(styles: Record<string, string>): string[] {
  const utilities: string[] = [];

  // 1. Layout & Display
  const display = styles.display;
  if (display) {
    if (display === 'flex') utilities.push('flex');
    else if (display === 'inline-flex') utilities.push('inline-flex');
    else if (display === 'grid') utilities.push('grid');
    else if (display === 'inline-grid') utilities.push('inline-grid');
    else if (display === 'inline-block') utilities.push('inline-block');
    else if (display === 'block') utilities.push('block');
    else if (display === 'none') utilities.push('hidden');
  }

  // 2. Flexbox specifics
  if (display === 'flex' || display === 'inline-flex') {
    const flexDir = styles.flexDirection;
    if (flexDir === 'column') utilities.push('flex-col');
    else if (flexDir === 'column-reverse') utilities.push('flex-col-reverse');
    else if (flexDir === 'row-reverse') utilities.push('flex-row-reverse');

    const alignItems = styles.alignItems;
    if (alignItems === 'center') utilities.push('items-center');
    else if (alignItems === 'flex-start' || alignItems === 'start') utilities.push('items-start');
    else if (alignItems === 'flex-end' || alignItems === 'end') utilities.push('items-end');
    else if (alignItems === 'stretch') utilities.push('items-stretch');
    else if (alignItems === 'baseline') utilities.push('items-baseline');

    const justify = styles.justifyContent;
    if (justify === 'center') utilities.push('justify-center');
    else if (justify === 'flex-start' || justify === 'start') utilities.push('justify-start');
    else if (justify === 'flex-end' || justify === 'end') utilities.push('justify-end');
    else if (justify === 'space-between') utilities.push('justify-between');
    else if (justify === 'space-around') utilities.push('justify-around');
    else if (justify === 'space-evenly') utilities.push('justify-evenly');
  }

  // 3. Gap
  if (styles.gap && styles.gap !== '0px' && styles.gap !== 'normal') {
    const gapClass = toSpacingClass('gap', styles.gap);
    if (gapClass) utilities.push(gapClass);
  }

  // 4. Dimensions
  if (styles.width && styles.width !== 'auto' && styles.width !== '0px') {
    const wClass = toSpacingClass('w', styles.width);
    if (wClass) utilities.push(wClass);
  }
  if (styles.height && styles.height !== 'auto' && styles.height !== '0px') {
    const hClass = toSpacingClass('h', styles.height);
    if (hClass) utilities.push(hClass);
  }
  if (styles.minWidth && styles.minWidth !== '0px') {
    const mwClass = toSpacingClass('min-w', styles.minWidth);
    if (mwClass) utilities.push(mwClass);
  }
  if (styles.maxWidth && styles.maxWidth !== 'none') {
    const mwClass = toSpacingClass('max-w', styles.maxWidth);
    if (mwClass) utilities.push(mwClass);
  }
  if (styles.minHeight && styles.minHeight !== '0px') {
    const mhClass = toSpacingClass('min-h', styles.minHeight);
    if (mhClass) utilities.push(mhClass);
  }
  if (styles.maxHeight && styles.maxHeight !== 'none') {
    const mhClass = toSpacingClass('max-h', styles.maxHeight);
    if (mhClass) utilities.push(mhClass);
  }

  // 5. Padding Grouping
  const pt = styles.paddingTop;
  const pr = styles.paddingRight;
  const pb = styles.paddingBottom;
  const pl = styles.paddingLeft;
  const hasPad = pt || pr || pb || pl;

  if (hasPad) {
    if (pt === pr && pr === pb && pb === pl) {
      const pClass = toSpacingClass('p', pt);
      if (pClass && pClass !== 'p-0') utilities.push(pClass);
    } else if (pt === pb && pr === pl) {
      const pyClass = toSpacingClass('py', pt);
      const pxClass = toSpacingClass('px', pr);
      if (pyClass && pyClass !== 'py-0') utilities.push(pyClass);
      if (pxClass && pxClass !== 'px-0') utilities.push(pxClass);
    } else {
      if (pt && pt !== '0px') {
        const ptClass = toSpacingClass('pt', pt);
        if (ptClass) utilities.push(ptClass);
      }
      if (pr && pr !== '0px') {
        const prClass = toSpacingClass('pr', pr);
        if (prClass) utilities.push(prClass);
      }
      if (pb && pb !== '0px') {
        const pbClass = toSpacingClass('pb', pb);
        if (pbClass) utilities.push(pbClass);
      }
      if (pl && pl !== '0px') {
        const plClass = toSpacingClass('pl', pl);
        if (plClass) utilities.push(plClass);
      }
    }
  }

  // 6. Margin Grouping
  const mt = styles.marginTop;
  const mr = styles.marginRight;
  const mb = styles.marginBottom;
  const ml = styles.marginLeft;
  const hasMar = mt || mr || mb || ml;

  if (hasMar) {
    if (mt === mr && mr === mb && mb === ml) {
      const mClass = toSpacingClass('m', mt);
      if (mClass && mClass !== 'm-0') utilities.push(mClass);
    } else if (mt === mb && mr === ml) {
      const myClass = toSpacingClass('my', mt);
      const mxClass = toSpacingClass('mx', mr);
      if (myClass && myClass !== 'my-0') utilities.push(myClass);
      if (mxClass && mxClass !== 'mx-0') utilities.push(mxClass);
    } else {
      if (mt && mt !== '0px') {
        const mtClass = toSpacingClass('mt', mt);
        if (mtClass) utilities.push(mtClass);
      }
      if (mr && mr !== '0px') {
        const mrClass = toSpacingClass('mr', mr);
        if (mrClass) utilities.push(mrClass);
      }
      if (mb && mb !== '0px') {
        const mbClass = toSpacingClass('mb', mb);
        if (mbClass) utilities.push(mbClass);
      }
      if (ml && ml !== '0px') {
        const mlClass = toSpacingClass('ml', ml);
        if (mlClass) utilities.push(mlClass);
      }
    }
  }

  // 7. Typography
  if (styles.fontSize) {
    const px = parsePx(styles.fontSize);
    if (px !== null) {
      if (px <= 12) utilities.push('text-xs');
      else if (px <= 14) utilities.push('text-sm');
      else if (px <= 16) utilities.push('text-base');
      else if (px <= 18) utilities.push('text-lg');
      else if (px <= 20) utilities.push('text-xl');
      else if (px <= 24) utilities.push('text-2xl');
      else if (px <= 30) utilities.push('text-3xl');
      else if (px <= 36) utilities.push('text-4xl');
      else if (px <= 48) utilities.push('text-5xl');
      else if (px <= 60) utilities.push('text-6xl');
      else if (px <= 72) utilities.push('text-7xl');
      else utilities.push(`text-[${styles.fontSize}]`);
    } else {
      utilities.push(`text-[${styles.fontSize}]`);
    }
  }

  if (styles.fontWeight) {
    const fw = String(styles.fontWeight);
    if (fw === '100') utilities.push('font-thin');
    else if (fw === '200') utilities.push('font-extralight');
    else if (fw === '300') utilities.push('font-light');
    else if (fw === '400' || fw === 'normal') utilities.push('font-normal');
    else if (fw === '500') utilities.push('font-medium');
    else if (fw === '600') utilities.push('font-semibold');
    else if (fw === '700' || fw === 'bold') utilities.push('font-bold');
    else if (fw === '800') utilities.push('font-extrabold');
    else if (fw === '900') utilities.push('font-black');
  }

  if (styles.color) {
    const textCol = toTailwindColor(styles.color, 'text');
    if (textCol) utilities.push(textCol);
  }

  if (styles.textAlign && styles.textAlign !== 'left') {
    if (styles.textAlign === 'center') utilities.push('text-center');
    else if (styles.textAlign === 'right') utilities.push('text-right');
    else if (styles.textAlign === 'justify') utilities.push('text-justify');
  }

  if (styles.letterSpacing && styles.letterSpacing !== '0px' && styles.letterSpacing !== 'normal') {
    const ls = styles.letterSpacing;
    if (ls === '-0.05em') utilities.push('tracking-tighter');
    else if (ls === '-0.025em') utilities.push('tracking-tight');
    else if (ls === '0.025em') utilities.push('tracking-wide');
    else if (ls === '0.05em') utilities.push('tracking-wider');
    else if (ls === '0.1em') utilities.push('tracking-widest');
    else utilities.push(`tracking-[${ls}]`);
  }

  // 8. Background & Colors
  if (styles.backgroundColor && styles.backgroundColor !== 'transparent') {
    const bgCol = toTailwindColor(styles.backgroundColor, 'bg');
    if (bgCol) utilities.push(bgCol);
  } else if (styles.background && styles.background !== 'transparent' && styles.background !== 'none') {
    const bgCol = toTailwindColor(styles.background, 'bg');
    if (bgCol) utilities.push(bgCol);
  }

  // 9. Borders & Radii
  if (styles.borderRadius && styles.borderRadius !== '0px') {
    const rad = styles.borderRadius;
    const px = parsePx(rad);
    if (px !== null) {
      if (px === 2) utilities.push('rounded-sm');
      else if (px === 4) utilities.push('rounded');
      else if (px === 6) utilities.push('rounded-md');
      else if (px === 8) utilities.push('rounded-lg');
      else if (px === 12) utilities.push('rounded-xl');
      else if (px === 16) utilities.push('rounded-2xl');
      else if (px === 24) utilities.push('rounded-3xl');
      else if (px >= 999) utilities.push('rounded-full');
      else utilities.push(`rounded-[${rad}]`);
    } else if (rad === '50%' || rad === '9999px') {
      utilities.push('rounded-full');
    } else {
      utilities.push(`rounded-[${rad}]`);
    }
  }

  if (styles.border && styles.border !== 'none' && styles.border !== '0px') {
    const parts = styles.border.split(' ');
    if (parts.length >= 1) {
      const bWidth = parsePx(parts[0]);
      if (bWidth === 1) utilities.push('border');
      else if (bWidth === 2) utilities.push('border-2');
      else if (bWidth === 4) utilities.push('border-4');
      else if (bWidth === 8) utilities.push('border-8');
      else if (bWidth !== null && bWidth > 0) utilities.push(`border-[${parts[0]}]`);
      else utilities.push('border');
    }
    if (parts.length >= 3) {
      const bCol = toTailwindColor(parts[2], 'border');
      if (bCol) utilities.push(bCol);
    }
  }

  // 10. Shadow & Effects
  if (styles.boxShadow && styles.boxShadow !== 'none') {
    utilities.push('shadow-lg');
  }

  if (styles.opacity && styles.opacity !== '1') {
    const opNum = parseFloat(styles.opacity);
    if (!isNaN(opNum)) {
      const opPct = Math.round(opNum * 100);
      utilities.push(`opacity-${opPct}`);
    } else {
      utilities.push(`opacity-[${styles.opacity}]`);
    }
  }

  // 11. Position
  if (styles.position && styles.position !== 'static') {
    utilities.push(styles.position);
  }

  return utilities;
}

/* -------------------------------------------------------------------------- */
/*                  Syntax Highlighting Engine (Dark Studio)                  */
/* -------------------------------------------------------------------------- */

interface Token {
  text: string;
  type: 'keyword' | 'tag' | 'attr' | 'string' | 'number' | 'comment' | 'prop' | 'selector' | 'bracket' | 'plain';
}

function tokenizeLine(line: string, lang: 'jsx' | 'css' | 'ts'): Token[] {
  const tokens: Token[] = [];
  let remaining = line;

  const jsKeywords = new Set([
    'import', 'export', 'from', 'default', 'const', 'let', 'var', 'function', 
    'return', 'interface', 'type', 'async', 'await', 'if', 'else', 'true', 
    'false', 'null', 'undefined', 'styled', 'gsap', 'useRef', 'useEffect', 
    'useLayoutEffect', 'useMemo', 'useCallback', 'ScrollTrigger'
  ]);

  while (remaining.length > 0) {
    // 1. Comments
    if (remaining.startsWith('//') || remaining.startsWith('/*') || remaining.startsWith('{/*')) {
      tokens.push({ text: remaining, type: 'comment' });
      break;
    }

    // 2. Strings
    const stringMatch = remaining.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/);
    if (stringMatch) {
      tokens.push({ text: stringMatch[0], type: 'string' });
      remaining = remaining.slice(stringMatch[0].length);
      continue;
    }

    // 3. JSX Tags e.g. <button, </button>, <div, />
    const jsxTagMatch = remaining.match(/^<\/?([a-zA-Z0-9_.-]+)/);
    if (jsxTagMatch) {
      tokens.push({ text: jsxTagMatch[0], type: 'tag' });
      remaining = remaining.slice(jsxTagMatch[0].length);
      continue;
    }

    // 4. Closing JSX angle bracket / self-closing
    if (remaining.startsWith('/>') || remaining.startsWith('>')) {
      const match = remaining.startsWith('/>') ? '/>' : '>';
      tokens.push({ text: match, type: 'tag' });
      remaining = remaining.slice(match.length);
      continue;
    }

    // 5. CSS Selectors (in CSS mode) e.g. .class, #id, @keyframes
    if (lang === 'css') {
      const selectorMatch = remaining.match(/^([.#@][a-zA-Z0-9_-]+)/);
      if (selectorMatch) {
        tokens.push({ text: selectorMatch[0], type: 'selector' });
        remaining = remaining.slice(selectorMatch[0].length);
        continue;
      }

      const cssPropMatch = remaining.match(/^([a-z-]+)(?=:)/i);
      if (cssPropMatch) {
        tokens.push({ text: cssPropMatch[0], type: 'prop' });
        remaining = remaining.slice(cssPropMatch[0].length);
        continue;
      }
    }

    // 6. JSX Attributes e.g. className=, style=, onClick=
    const attrMatch = remaining.match(/^([a-zA-Z0-9_-]+)(?==)/);
    if (attrMatch) {
      tokens.push({ text: attrMatch[0], type: 'attr' });
      remaining = remaining.slice(attrMatch[0].length);
      continue;
    }

    // 7. Numbers with units e.g. 16px, 1.5rem, 100%, 250
    const numMatch = remaining.match(/^(-?[\d.]+(?:px|rem|em|%|ms|s|deg|vh|vw)?)\b/i);
    if (numMatch && !/[a-zA-Z_]/.test(remaining.charAt(numMatch[0].length))) {
      tokens.push({ text: numMatch[0], type: 'number' });
      remaining = remaining.slice(numMatch[0].length);
      continue;
    }

    // 8. Words / Identifiers
    const wordMatch = remaining.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (wordMatch) {
      const word = wordMatch[0];
      if (jsKeywords.has(word)) {
        tokens.push({ text: word, type: 'keyword' });
      } else if (/^[A-Z][a-zA-Z0-9]*$/.test(word)) {
        tokens.push({ text: word, type: 'tag' });
      } else {
        tokens.push({ text: word, type: 'plain' });
      }
      remaining = remaining.slice(word.length);
      continue;
    }

    // 9. Brackets & Punctuation
    const char = remaining[0];
    if (['{', '}', '(', ')', '[', ']', ';', ':', ',', '.'].includes(char)) {
      tokens.push({ text: char, type: 'bracket' });
      remaining = remaining.slice(1);
      continue;
    }

    // 10. Whitespace and other characters
    const whitespaceMatch = remaining.match(/^(\s+|[^\s\w"'`<{[(;)\]},.]+)/);
    if (whitespaceMatch) {
      tokens.push({ text: whitespaceMatch[0], type: 'plain' });
      remaining = remaining.slice(whitespaceMatch[0].length);
      continue;
    }

    tokens.push({ text: remaining[0], type: 'plain' });
    remaining = remaining.slice(1);
  }

  return tokens;
}

const TOKEN_COLORS: Record<Token['type'], string> = {
  keyword: '#c084fc',   // Electric Violet / Purple
  tag: '#f472b6',       // Vibrant Pink
  attr: '#38bdf8',      // Sky Blue
  string: '#a7f3d0',    // Emerald Mint
  number: '#fbbf24',    // Warm Amber
  comment: '#6b7280',   // Muted Slate
  prop: '#60a5fa',      // Soft Blue
  selector: '#f87171',  // Coral Red
  bracket: '#9ca3af',   // Light Gray
  plain: '#e5e7eb'      // Crisp Off-White
};

function CodeViewer({ code, lang, showLineNumbers = true, wrapLines = false }: { code: string; lang: 'jsx' | 'css' | 'ts'; showLineNumbers?: boolean; wrapLines?: boolean }) {
  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div style={{
      display: 'flex',
      fontSize: '11px',
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
      lineHeight: '1.65',
      background: 'rgba(8, 8, 12, 0.95)',
      overflow: 'auto',
      height: '100%',
      width: '100%'
    }}>
      {/* Line Numbers Gutter */}
      {showLineNumbers && (
        <div style={{
          padding: '12px 10px 12px 14px',
          textAlign: 'right',
          color: '#4b5563',
          userSelect: 'none',
          borderRight: '1px solid rgba(255, 255, 255, 0.07)',
          background: 'rgba(0, 0, 0, 0.25)',
          minWidth: '42px'
        }}>
          {lines.map((_, i) => (
            <div key={i} style={{ height: '1.65em' }}>{i + 1}</div>
          ))}
        </div>
      )}

      {/* Code Area */}
      <pre style={{
        margin: 0,
        padding: '12px 16px',
        flex: 1,
        whiteSpace: wrapLines ? 'pre-wrap' : 'pre',
        wordBreak: wrapLines ? 'break-word' : 'normal',
        tabSize: 2,
        outline: 'none'
      }}>
        {lines.map((line, lineIndex) => {
          const tokens = tokenizeLine(line, lang);
          return (
            <div key={lineIndex} style={{ minHeight: '1.65em' }}>
              {tokens.map((token, tokenIndex) => (
                <span
                  key={tokenIndex}
                  style={{
                    color: TOKEN_COLORS[token.type] || '#e5e7eb',
                    fontStyle: token.type === 'comment' ? 'italic' : 'normal'
                  }}
                >
                  {token.text}
                </span>
              ))}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                            Main LiveCodePanel                              */
/* -------------------------------------------------------------------------- */

export function LiveCodePanel() {
  const selectedElementPath = useSceneStore((state) => state.selectedElementPath);
  const selectedElementStyles = useSceneStore((state) => state.selectedElementStyles) || {};
  const selectedElementText = useSceneStore((state) => state.selectedElementText);
  const selectedDomId = useSceneStore((state) => state.selectedDomId);
  const scrollTracks = useSceneStore((state) => state.scrollTracks);
  const scrollHeight = useSceneStore((state) => state.scrollHeight);
  const activeProjectFile = useSceneStore((state) => state.activeProjectFile);
  const setActiveProjectFile = useSceneStore((state) => state.setActiveProjectFile);

  // Panel State
  const [activeTab, setActiveTab] = useState<ExportFormat>('jsx');
  const [copied, setCopied] = useState<boolean>(false);
  const [componentNameOverride, setComponentNameOverride] = useState<string>('');
  const [cssModuleSubView, setCssModuleSubView] = useState<'both' | 'module-only' | 'jsx-only'>('both');
  const [tailwindSubView, setTailwindSubView] = useState<'component' | 'classes-only'>('component');
  const [gsapFormat, setGsapFormat] = useState<'hook' | 'vanilla'>('hook');
  const [showLineNumbers] = useState<boolean>(true);
  const [wrapLines, setWrapLines] = useState<boolean>(false);

  // Parse element metadata
  const meta = useMemo(() => {
    return parseElementMeta(selectedElementPath, selectedDomId);
  }, [selectedElementPath, selectedDomId]);

  const activeComponentName = componentNameOverride.trim() || meta.componentName;
  const tag = meta.tag;
  const classes = meta.classes;
  const elementText = selectedElementText || 'Interactive Motion Content';

  // Filter meaningful active styles
  const activeStylesList = useMemo(() => {
    return Object.entries(selectedElementStyles).filter(([key, val]) => {
      if (!val || val === 'none' || val === 'normal' || val === 'auto') return false;
      if (val === '0px' && !['borderWidth', 'gap'].includes(key)) return false;
      return true;
    });
  }, [selectedElementStyles]);

  /* ------------------------------------------------------------------------ */
  /*                            Code Generators                               */
  /* ------------------------------------------------------------------------ */

  // 1. React JSX Code
  const jsxCode = useMemo(() => {
    const styleLines = activeStylesList.map(([k, v]) => `    ${k}: "${v}",`).join('\n');
    const classProp = classes.length > 0 ? ` className="${classes.join(' ')}"` : '';
    const styleProp = activeStylesList.length > 0 ? `\n  style={{\n${styleLines}\n  }}` : '';

    return `import React from 'react';

interface ${activeComponentName}Props {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function ${activeComponentName}({ children, className = '', onClick }: ${activeComponentName}Props) {
  return (
    <${tag}${classProp}${styleProp}
      onClick={onClick}
    >
      {children || "${elementText}"}
    </${tag}>
  );
}

export default ${activeComponentName};`;
  }, [activeComponentName, tag, classes, activeStylesList, elementText]);

  // 2. Raw CSS Classes Code
  const cssCode = useMemo(() => {
    const cssLines = activeStylesList.map(([k, v]) => `  ${toKebabCase(k)}: ${v};`).join('\n');
    const selector = meta.cleanSelector || `.${meta.componentName.toLowerCase()}`;

    return `/* Astrolabe Motion Studio Generated CSS */
${selector} {
${cssLines || '  /* No active style overrides */'}
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

${selector}:hover {
  opacity: 0.92;
  transform: translateY(-1px);
}

${selector}:active {
  transform: translateY(0);
}`;
  }, [activeStylesList, meta]);

  // 3. Tailwind CSS Code
  const tailwindClasses = useMemo(() => {
    const list = convertStylesToTailwind(selectedElementStyles);
    if (list.length === 0) {
      return ['flex', 'items-center', 'p-4', 'bg-slate-900', 'text-white', 'rounded-lg'];
    }
    return list;
  }, [selectedElementStyles]);

  const tailwindClassString = tailwindClasses.join(' ');

  const tailwindCode = useMemo(() => {
    if (tailwindSubView === 'classes-only') {
      return `/* Tailwind Utility Class List */
${tailwindClassString}`;
    }

    return `import React from 'react';

interface ${activeComponentName}Props {
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function ${activeComponentName}({ children, className = '', onClick }: ${activeComponentName}Props) {
  return (
    <${tag}
      className={\`${tailwindClassString} \${className}\`}
      onClick={onClick}
    >
      {children || "${elementText}"}
    </${tag}>
  );
}

export default ${activeComponentName};`;
  }, [tailwindSubView, activeComponentName, tag, tailwindClassString, elementText]);

  // 4. CSS Modules Code
  const cssModulesCode = useMemo(() => {
    const cssModuleContent = `/* ${activeComponentName}.module.css */
.container {
${activeStylesList.map(([k, v]) => `  ${toKebabCase(k)}: ${v};`).join('\n') || '  display: flex;\n  padding: 16px;'}
  transition: all 0.2s ease-in-out;
}

.container:hover {
  opacity: 0.95;
}`;

    const jsxModuleContent = `// ${activeComponentName}.tsx
import React from 'react';
import styles from './${activeComponentName}.module.css';

interface ${activeComponentName}Props {
  children?: React.ReactNode;
  className?: string;
}

export function ${activeComponentName}({ children, className = '' }: ${activeComponentName}Props) {
  return (
    <${tag} className={\`\${styles.container} \${className}\`}>
      {children || "${elementText}"}
    </${tag}>
  );
}

export default ${activeComponentName};`;

    if (cssModuleSubView === 'module-only') return cssModuleContent;
    if (cssModuleSubView === 'jsx-only') return jsxModuleContent;

    return `${cssModuleContent}\n\n/* ============================================== */\n\n${jsxModuleContent}`;
  }, [activeComponentName, activeStylesList, tag, elementText, cssModuleSubView]);

  // 5. Styled Components Code
  const styledCode = useMemo(() => {
    const cssProps = activeStylesList.map(([k, v]) => `  ${toKebabCase(k)}: ${v};`).join('\n');

    return `import React from 'react';
import styled from 'styled-components';

export const Styled${activeComponentName} = styled.${tag}\`
${cssProps || '  display: flex;\n  padding: 16px;'}
  box-sizing: border-box;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);

  &:hover {
    opacity: 0.92;
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
\`;

interface ${activeComponentName}Props {
  children?: React.ReactNode;
  onClick?: () => void;
}

export function ${activeComponentName}({ children, onClick }: ${activeComponentName}Props) {
  return (
    <Styled${activeComponentName} onClick={onClick}>
      {children || "${elementText}"}
    </Styled${activeComponentName}>
  );
}

export default ${activeComponentName};`;
  }, [activeComponentName, tag, activeStylesList, elementText]);

  // 6. GSAP Timeline Code
  const gsapCode = useMemo(() => {
    const targetSelector = meta.cleanSelector || `#${meta.componentName.toLowerCase()}`;
    const relevantTracks = scrollTracks.length > 0 ? scrollTracks : [
      {
        id: 'track-hero-fade',
        nodeId: targetSelector,
        property: 'opacity',
        keyframes: [
          { id: 'kf-1', scrollPixel: 0, value: 1, easing: 'linear' },
          { id: 'kf-2', scrollPixel: Math.round(scrollHeight * 0.3), value: 0, easing: 'power2.out' }
        ]
      }
    ];

    const generateKeyframeSteps = (track: any) => {
      // Sort keyframes by scroll position
      const sortedKfs = [...track.keyframes].sort((a, b) => a.scrollPixel - b.scrollPixel);
      if (sortedKfs.length < 2) return `  // Not enough keyframes for ${track.nodeId}`;
      
      let steps = '';
      const startKf = sortedKfs[0];
      
      steps += `      // Track: ${track.property} (${track.nodeId})\n`;
      steps += `      tl.set("${track.nodeId}", { ${track.property}: ${startKf.value} });\n`;
      
      for (let i = 1; i < sortedKfs.length; i++) {
        const kf = sortedKfs[i];
        const prevKf = sortedKfs[i-1];
        const duration = (kf.scrollPixel - prevKf.scrollPixel) / scrollHeight;
        const position = prevKf.scrollPixel / scrollHeight;
        
        steps += `      tl.to("${track.nodeId}", {
        ${track.property}: ${kf.value},
        ease: "${kf.easing || 'power2.out'}",
        duration: ${duration.toFixed(3)}
      }, ${position.toFixed(3)});\n`;
      }
      return steps;
    };

    if (gsapFormat === 'vanilla') {
      return `import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * Initializes Astrolabe Motion Studio compiled GSAP Scroll Sequence
 */
export function initMotionTimeline() {
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger: "${targetSelector}",
      start: "top top",
      end: "+=${scrollHeight}",
      scrub: 1,
      pin: false,
      markers: false
    }
  });

${relevantTracks.map(track => generateKeyframeSteps(track)).join('\n')}

  return tl;
}`;
    }

    return `import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * React Hook for Astrolabe Motion Studio Scroll Triggered GSAP Timeline
 */
export function use${activeComponentName}Animation() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: el,
          start: "top top",
          end: "+=${scrollHeight}",
          scrub: 1.2,
          pin: true,
          anticipatePin: 1
        }
      });

${relevantTracks.map(track => generateKeyframeSteps(track)).join('\n')}
    }, containerRef);

    return () => ctx.revert();
  }, []);

  return containerRef;
}

export default use${activeComponentName}Animation;`;
  }, [meta, scrollTracks, scrollHeight, gsapFormat, activeComponentName]);

  // 7. Framer Motion Code
  const framerCode = useMemo(() => {
    const targetSelector = meta.cleanSelector || `#${meta.componentName.toLowerCase()}`;
    const relevantTracks = scrollTracks.length > 0 ? scrollTracks : [
      {
        id: 'track-hero-fade',
        nodeId: targetSelector,
        property: 'opacity',
        keyframes: [
          { id: 'kf-1', scrollPixel: 0, value: 1, easing: 'linear' },
          { id: 'kf-2', scrollPixel: Math.round(scrollHeight * 0.3), value: 0, easing: 'power2.out' }
        ]
      }
    ];

    const hooks = relevantTracks.map((track, i) => {
      const sortedKfs = [...track.keyframes].sort((a, b) => a.scrollPixel - b.scrollPixel);
      const inputMap = sortedKfs.map(kf => `'${(kf.scrollPixel / scrollHeight).toFixed(3)}'`);
      const outputMap = sortedKfs.map(kf => kf.value);
      
      return `  const ${track.property}Prop${i} = useTransform(scrollYProgress, [${inputMap.join(', ')}], [${outputMap.join(', ')}]);`;
    }).join('\n');

    const styleProps = relevantTracks.map((track, i) => {
      return `        ${track.property}: ${track.property}Prop${i}`;
    }).join(',\n');

    return `import React, { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

export function ${activeComponentName}() {
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end end"]
  });

${hooks}

  return (
    <motion.div 
      ref={containerRef}
      style={{
${styleProps}
      }}
      className="${classes.join(' ')}"
    >
      {/* Content for ${activeComponentName} */}
    </motion.div>
  );
}

export default ${activeComponentName};`;
  }, [meta, scrollTracks, scrollHeight, classes, activeComponentName]);

  /* ------------------------------------------------------------------------ */
  /*                            Active Output Code                            */
  /* ------------------------------------------------------------------------ */

  const currentCode = useMemo(() => {
    switch (activeTab) {
      case 'jsx': return jsxCode;
      case 'css': return cssCode;
      case 'tailwind': return tailwindCode;
      case 'css-modules': return cssModulesCode;
      case 'styled': return styledCode;
      case 'gsap': return gsapCode;
      case 'framer': return framerCode;
      default: return jsxCode;
    }
  }, [activeTab, jsxCode, cssCode, tailwindCode, cssModulesCode, styledCode, gsapCode, framerCode]);

  const currentLang: 'jsx' | 'css' | 'ts' = useMemo(() => {
    if (activeTab === 'css') return 'css';
    if (activeTab === 'css-modules' && cssModuleSubView === 'module-only') return 'css';
    if (activeTab === 'gsap') return 'ts';
    return 'jsx';
  }, [activeTab, cssModuleSubView]);

  /* ------------------------------------------------------------------------ */
  /*                         Copy & Download Handlers                         */
  /* ------------------------------------------------------------------------ */

  const handleChangeTargetFile = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if ('showOpenFilePicker' in window) {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [{
            description: 'Component Files',
            accept: { 'text/*': ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.html', '.css'] }
          }]
        });
        if (handle && handle.name) {
          const newPath = `src/components/${handle.name}`;
          setActiveProjectFile(newPath);
          return;
        }
      }
    } catch {
      // User cancelled picker or permission error, proceed to fallback prompt
    }
    const path = window.prompt('Enter target component file path in workspace:', activeProjectFile || 'src/components/MotionScene.tsx');
    if (path && path.trim()) {
      setActiveProjectFile(path.trim());
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const currentTabObj = EXPORT_TABS.find((t) => t.id === activeTab) || EXPORT_TABS[0];
    const filename = `${activeComponentName}${currentTabObj.extension}`;
    const blob = new Blob([currentCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ------------------------------------------------------------------------ */
  /*                                Empty State                               */
  /* ------------------------------------------------------------------------ */

  if (!selectedElementPath && !selectedDomId) {
    return (
      <div style={{
        padding: '32px 20px',
        color: '#9ca3af',
        fontSize: '11px',
        textAlign: 'center',
        lineHeight: 1.6,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10, 10, 15, 0.96)',
        userSelect: 'none'
      }}>
        <div style={{
          width: '54px',
          height: '54px',
          borderRadius: '12px',
          background: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '12px',
          boxShadow: '0 0 20px rgba(139, 92, 246, 0.15)'
        }}>
          <FileCode size={26} style={{ color: '#c084fc' }} />
        </div>
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f3f4f6', marginBottom: '4px' }}>
          Live Code Generator
        </div>
        <div style={{ maxWidth: '280px', color: '#6b7280', fontSize: '11px', marginBottom: '16px' }}>
          Select any DOM element or motion layer in the viewport to generate clean, production-ready React, Tailwind, CSS, or GSAP code.
        </div>
        <button
          onClick={handleChangeTargetFile}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 12px',
            borderRadius: '6px',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(139, 92, 246, 0.12))',
            border: '1px solid rgba(6, 182, 212, 0.35)',
            color: '#38bdf8',
            cursor: 'pointer',
            fontSize: '11px',
            fontFamily: "'JetBrains Mono', monospace",
            transition: 'all 0.15s ease'
          }}
          title="Click to set active target component file"
        >
          <FolderOpen size={13} style={{ color: '#22d3ee' }} />
          <span style={{ color: '#94a3b8' }}>Target:</span>
          <span style={{ color: '#a5f3fc', fontWeight: 600 }}>
            {activeProjectFile || 'src/components/MotionScene.tsx'}
          </span>
          <Edit2 size={11} style={{ color: '#c084fc', marginLeft: '2px' }} />
        </button>
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /*                                Render UI                                 */
  /* ------------------------------------------------------------------------ */

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(10, 10, 15, 0.98)',
      fontFamily: "'Inter', -apple-system, sans-serif",
      overflow: 'hidden'
    }}>
      {/* 1. Main Export Format Tabs Header */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(255, 255, 255, 0.02)',
        gap: '8px',
        flexWrap: 'nowrap',
        overflowX: 'auto'
      }}>
        {/* Format Selector Pills */}
        <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
          {EXPORT_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '4px 9px',
                  borderRadius: '5px',
                  border: isActive 
                    ? '1px solid rgba(139, 92, 246, 0.5)' 
                    : '1px solid transparent',
                  background: isActive 
                    ? 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(99, 102, 241, 0.15))' 
                    : 'rgba(255, 255, 255, 0.03)',
                  color: isActive ? '#f3f4f6' : '#9ca3af',
                  fontSize: '10.5px',
                  fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 0 10px rgba(139, 92, 246, 0.2)' : 'none'
                }}
              >
                <Icon size={12} style={{ color: isActive ? '#c084fc' : '#6b7280' }} />
                <span>{tab.label}</span>
                {tab.badge && (
                  <span style={{
                    fontSize: '8.5px',
                    padding: '0 4px',
                    borderRadius: '3px',
                    background: isActive ? 'rgba(139, 92, 246, 0.35)' : 'rgba(255, 255, 255, 0.06)',
                    color: isActive ? '#e9d5ff' : '#6b7280',
                    fontWeight: 600
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Copy & Save Action Buttons & Target File Badge */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0 }}>
          {/* Top Header Target File Badge */}
          <button
            onClick={handleChangeTargetFile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(6, 182, 212, 0.35)',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(139, 92, 246, 0.12))',
              color: '#67e8f9',
              fontSize: '10px',
              fontFamily: "'JetBrains Mono', monospace",
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              maxWidth: '200px'
            }}
            title={`Target Component File: ${activeProjectFile || 'None selected (Click to choose)'}`}
          >
            <FolderOpen size={11} style={{ color: '#22d3ee', flexShrink: 0 }} />
            <span style={{ color: '#94a3b8', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Target:</span>
            <span style={{ 
              fontWeight: 600, 
              color: activeProjectFile ? '#a5f3fc' : '#fbbf24',
              overflow: 'hidden', 
              textOverflow: 'ellipsis', 
              whiteSpace: 'nowrap' 
            }}>
              {activeProjectFile ? (activeProjectFile.split('/').pop() || activeProjectFile) : 'Select file...'}
            </span>
            <Edit3 size={10} style={{ color: '#c084fc', flexShrink: 0, opacity: 0.85 }} />
          </button>

          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 9px',
              borderRadius: '5px',
              border: copied 
                ? '1px solid rgba(16, 185, 129, 0.5)' 
                : '1px solid rgba(255, 255, 255, 0.12)',
              background: copied 
                ? 'rgba(16, 185, 129, 0.15)' 
                : 'rgba(255, 255, 255, 0.05)',
              color: copied ? '#34d399' : '#d1d5db',
              fontSize: '10.5px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Copy snippet to clipboard"
          >
            {copied ? <Check size={12} style={{ color: '#34d399' }} /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 9px',
              borderRadius: '5px',
              border: '1px solid rgba(139, 92, 246, 0.4)',
              background: 'rgba(139, 92, 246, 0.18)',
              color: '#c084fc',
              fontSize: '10.5px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            title="Export source file to disk"
          >
            <Download size={12} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* 2. Format Sub-options & Component Customizer Toolbar */}
      <div style={{
        padding: '5px 12px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'rgba(0, 0, 0, 0.35)',
        fontSize: '10.5px',
        color: '#9ca3af',
        gap: '12px'
      }}>
        {/* Left: Component Name customizer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#6b7280', fontWeight: 500 }}>Name:</span>
          <input
            type="text"
            value={componentNameOverride}
            placeholder={meta.componentName}
            onChange={(e) => setComponentNameOverride(e.target.value)}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '4px',
              color: '#f3f4f6',
              fontSize: '10.5px',
              fontFamily: "'JetBrains Mono', monospace",
              padding: '2px 6px',
              width: '130px',
              outline: 'none'
            }}
            title="Custom component / hook name"
          />
        </div>

        {/* Center: Format specific sub-toggles */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {activeTab === 'css-modules' && (
            <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '1px' }}>
              {(['both', 'module-only', 'jsx-only'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setCssModuleSubView(view)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '9.5px',
                    borderRadius: '3px',
                    border: 'none',
                    background: cssModuleSubView === view ? 'rgba(139, 92, 246, 0.3)' : 'transparent',
                    color: cssModuleSubView === view ? '#c084fc' : '#9ca3af',
                    cursor: 'pointer'
                  }}
                >
                  {view === 'both' ? 'All' : view === 'module-only' ? '.module.css' : '.tsx'}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'tailwind' && (
            <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '1px' }}>
              {(['component', 'classes-only'] as const).map((view) => (
                <button
                  key={view}
                  onClick={() => setTailwindSubView(view)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '9.5px',
                    borderRadius: '3px',
                    border: 'none',
                    background: tailwindSubView === view ? 'rgba(139, 92, 246, 0.3)' : 'transparent',
                    color: tailwindSubView === view ? '#c084fc' : '#9ca3af',
                    cursor: 'pointer'
                  }}
                >
                  {view === 'component' ? 'Full JSX' : 'Classes Only'}
                </button>
              ))}
            </div>
          )}

          {activeTab === 'gsap' && (
            <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', padding: '1px' }}>
              {(['hook', 'vanilla'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => setGsapFormat(fmt)}
                  style={{
                    padding: '2px 6px',
                    fontSize: '9.5px',
                    borderRadius: '3px',
                    border: 'none',
                    background: gsapFormat === fmt ? 'rgba(139, 92, 246, 0.3)' : 'transparent',
                    color: gsapFormat === fmt ? '#c084fc' : '#9ca3af',
                    cursor: 'pointer'
                  }}
                >
                  {fmt === 'hook' ? 'React Hook' : 'Vanilla Script'}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Code Viewer Tools (Line numbers, Wrap) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={() => setWrapLines(!wrapLines)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              background: wrapLines ? 'rgba(139, 92, 246, 0.2)' : 'transparent',
              border: 'none',
              color: wrapLines ? '#c084fc' : '#6b7280',
              fontSize: '10px',
              cursor: 'pointer',
              padding: '2px 5px',
              borderRadius: '3px'
            }}
            title="Toggle Word Wrap"
          >
            <WrapText size={11} />
            <span>Wrap</span>
          </button>
        </div>
      </div>

      {/* 3. Code Editor Output View with Syntax Highlighting */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <CodeViewer
          code={currentCode}
          lang={currentLang}
          showLineNumbers={showLineNumbers}
          wrapLines={wrapLines}
        />
      </div>

      {/* 4. Bottom Status Bar */}
      <div style={{
        padding: '4px 12px',
        borderTop: '1px solid rgba(255, 255, 255, 0.07)',
        background: 'rgba(8, 8, 12, 0.98)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '9.5px',
        color: '#6b7280',
        fontFamily: "'JetBrains Mono', monospace"
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#a78bfa' }}>&lt;{tag}&gt;</span>
          {meta.cleanSelector && <span>{meta.cleanSelector}</span>}
          <span>•</span>
          <span>{activeStylesList.length} properties compiled</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          <span>{currentCode.split('\n').length} lines</span>
          <span>•</span>
          <button
            onClick={handleChangeTargetFile}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.12), rgba(139, 92, 246, 0.12))',
              border: '1px solid rgba(6, 182, 212, 0.35)',
              color: '#38bdf8',
              cursor: 'pointer',
              fontSize: '9.5px',
              fontFamily: "'JetBrains Mono', monospace",
              transition: 'all 0.15s ease'
            }}
            title={`Active Target File: ${activeProjectFile || 'None selected (Click to choose)'}`}
          >
            <FolderOpen size={11} style={{ color: '#22d3ee' }} />
            <span style={{ color: '#94a3b8', fontWeight: 500 }}>Target:</span>
            <span style={{ color: activeProjectFile ? '#a5f3fc' : '#fbbf24', fontWeight: 600, maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeProjectFile || 'Click to select target file...'}
            </span>
            <Edit2 size={10} style={{ color: '#c084fc', marginLeft: '2px', opacity: 0.85 }} />
          </button>
        </div>
      </div>
    </div>
  );
}

