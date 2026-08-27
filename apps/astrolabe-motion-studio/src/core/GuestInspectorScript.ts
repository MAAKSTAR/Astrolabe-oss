export const GUEST_INSPECTOR_SCRIPT = `
(function() {
  if (window.__astrolabeInjected) return;
  window.__astrolabeInjected = true;

  let isInspectActive = true;
  let lockedElement = null;
  let hoveredElement = null;

  // Drag and drop state
  let dragState = {
    isDragging: false,
    hasMoved: false,
    target: null,
    startX: 0,
    startY: 0,
    initialTranslateX: 0,
    initialTranslateY: 0,
    initialTranslateZ: 0,
    nonTranslateParts: []
  };

  // Helper: Convert rgb/rgba string to hex
  function rgbToHex(rgbStr) {
    if (!rgbStr || rgbStr === 'transparent' || rgbStr === 'rgba(0, 0, 0, 0)') return '';
    if (rgbStr.startsWith('#')) return rgbStr;
    const match = rgbStr.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/);
    if (!match) return rgbStr;
    const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
    if (match[4] !== undefined && parseFloat(match[4]) < 1) {
      const a = Math.round(parseFloat(match[4]) * 255).toString(16).padStart(2, '0');
      return '#' + r + g + b + a;
    }
    return '#' + r + g + b;
  }

  // Helper: Parse length value with unit
  function parseLength(str) {
    if (!str) return { value: 0, unit: 'px' };
    const strTrimmed = String(str).trim();
    const match = strTrimmed.match(/^(-?[\\d.]+)\\s*(px|%|em|rem|vw|vh|vmin|vmax|deg|rad|turn|grad)?$/i);
    if (match) {
      return {
        value: parseFloat(match[1]) || 0,
        unit: match[2] || 'px'
      };
    }
    const val = parseFloat(strTrimmed);
    return {
      value: isNaN(val) ? 0 : val,
      unit: 'px'
    };
  }

  // Helper: Decompose 2D affine transform matrix (a, b, c, d) into rotate, skew, and scale
  function decomposeMatrix2D(a, b, c, d) {
    const scaleX = Math.sqrt(a * a + b * b);
    const det = a * d - b * c;
    const signY = det < 0 ? -1 : 1;
    const scaleY = Math.sqrt(c * c + d * d) * signY;
    const angleRad = Math.atan2(b, a);
    const angleDeg = (angleRad * 180) / Math.PI;
    const skewRad = Math.atan2(a * c + b * d, a * a + b * b);
    const skewDeg = (skewRad * 180) / Math.PI;

    const parts = [];
    const round2 = (num) => Math.round(num * 100) / 100;
    const round4 = (num) => Math.round(num * 10000) / 10000;

    if (Math.abs(angleDeg) > 0.01) {
      parts.push('rotate(' + round2(angleDeg) + 'deg)');
    }
    if (Math.abs(skewDeg) > 0.01) {
      parts.push('skewX(' + round2(skewDeg) + 'deg)');
    }
    if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
      if (Math.abs(scaleX - scaleY) < 0.001) {
        parts.push('scale(' + round4(scaleX) + ')');
      } else {
        parts.push('scale(' + round4(scaleX) + ', ' + round4(scaleY) + ')');
      }
    }
    return parts;
  }

  // Helper: Parse any CSS transform string or matrix into translation and non-translation components
  function parseTransformString(transformStr) {
    if (!transformStr || transformStr === 'none' || typeof transformStr !== 'string') {
      return {
        translateX: 0,
        translateY: 0,
        translateZ: 0,
        unitX: 'px',
        unitY: 'px',
        nonTranslateParts: [],
        hasTranslate: false
      };
    }

    const fnRegex = /([a-zA-Z0-9]+)\\s*\\(([^)]*)\\)/g;
    let match;
    let translateX = 0;
    let translateY = 0;
    let translateZ = 0;
    let unitX = 'px';
    let unitY = 'px';
    let hasTranslate = false;
    const nonTranslateParts = [];

    while ((match = fnRegex.exec(transformStr)) !== null) {
      const fnName = match[1];
      const rawArgs = match[2].trim();
      const args = rawArgs.split(/\\s*,\\s*|\\s+/).filter(Boolean);

      if (fnName === 'translate') {
        hasTranslate = true;
        if (args[0]) {
          const parsed = parseLength(args[0]);
          translateX = parsed.value;
          unitX = parsed.unit || 'px';
        }
        if (args[1]) {
          const parsed = parseLength(args[1]);
          translateY = parsed.value;
          unitY = parsed.unit || 'px';
        }
      } else if (fnName === 'translateX') {
        hasTranslate = true;
        if (args[0]) {
          const parsed = parseLength(args[0]);
          translateX = parsed.value;
          unitX = parsed.unit || 'px';
        }
      } else if (fnName === 'translateY') {
        hasTranslate = true;
        if (args[0]) {
          const parsed = parseLength(args[0]);
          translateY = parsed.value;
          unitY = parsed.unit || 'px';
        }
      } else if (fnName === 'translateZ') {
        hasTranslate = true;
        if (args[0]) {
          translateZ = parseLength(args[0]).value;
        }
      } else if (fnName === 'translate3d') {
        hasTranslate = true;
        if (args[0]) {
          const parsed = parseLength(args[0]);
          translateX = parsed.value;
          unitX = parsed.unit || 'px';
        }
        if (args[1]) {
          const parsed = parseLength(args[1]);
          translateY = parsed.value;
          unitY = parsed.unit || 'px';
        }
        if (args[2]) {
          translateZ = parseLength(args[2]).value;
        }
      } else if (fnName === 'matrix') {
        if (args.length >= 6) {
          const a = parseFloat(args[0]) || 0;
          const b = parseFloat(args[1]) || 0;
          const c = parseFloat(args[2]) || 0;
          const d = parseFloat(args[3]) || 0;
          const tx = parseFloat(args[4]) || 0;
          const ty = parseFloat(args[5]) || 0;
          hasTranslate = true;
          translateX = tx;
          translateY = ty;
          const decompParts = decomposeMatrix2D(a, b, c, d);
          if (decompParts.length > 0) {
            nonTranslateParts.push(...decompParts);
          } else if (a !== 1 || b !== 0 || c !== 0 || d !== 1) {
            nonTranslateParts.push('matrix(' + a + ', ' + b + ', ' + c + ', ' + d + ', 0, 0)');
          }
        }
      } else if (fnName === 'matrix3d') {
        if (args.length >= 16) {
          const m = args.map(v => parseFloat(v) || 0);
          hasTranslate = true;
          translateX = m[12];
          translateY = m[13];
          translateZ = m[14];
          m[12] = 0;
          m[13] = 0;
          m[14] = 0;
          const isIdentity = m[0] === 1 && m[5] === 1 && m[10] === 1 && m[15] === 1 &&
            m.every((val, idx) => [0, 5, 10, 15].includes(idx) ? val === 1 : val === 0);
          if (!isIdentity) {
            nonTranslateParts.push('matrix3d(' + m.join(', ') + ')');
          }
        }
      } else {
        // scale, scaleX, scaleY, scaleZ, scale3d, rotate, rotateX, rotateY, rotateZ, rotate3d, skew, skewX, skewY, perspective
        nonTranslateParts.push(fnName + '(' + rawArgs + ')');
      }
    }

    return {
      translateX,
      translateY,
      translateZ,
      unitX,
      unitY,
      nonTranslateParts,
      hasTranslate
    };
  }

  // Helper: Retrieve element's existing transform data from inline and computed styles
  function getElementTransformData(el) {
    if (!el) {
      return {
        translateX: 0,
        translateY: 0,
        translateZ: 0,
        nonTranslateParts: []
      };
    }

    const inlineTransform = el.style.transform || '';
    const parsedInline = parseTransformString(inlineTransform);

    // If inline transform has functions or translates, use it directly
    if (inlineTransform && (parsedInline.hasTranslate || parsedInline.nonTranslateParts.length > 0)) {
      return parsedInline;
    }

    // Otherwise inspect computed style (which may contain matrix from stylesheets)
    try {
      const computed = window.getComputedStyle(el);
      const computedTransform = computed.transform || '';
      if (computedTransform && computedTransform !== 'none') {
        const parsedComputed = parseTransformString(computedTransform);
        return parsedComputed;
      }
    } catch (err) {}

    return parsedInline;
  }

  // Helper: Compose new translate values with preserved scale, rotate, skew, and perspective
  function composeTransform(newX, newY, nonTranslateParts, translateZ = 0) {
    const roundVal = (val) => Math.round(val * 100) / 100;
    let translateStr;
    if (translateZ && Math.abs(translateZ) > 0.001) {
      translateStr = 'translate3d(' + roundVal(newX) + 'px, ' + roundVal(newY) + 'px, ' + roundVal(translateZ) + 'px)';
    } else {
      translateStr = 'translate(' + roundVal(newX) + 'px, ' + roundVal(newY) + 'px)';
    }

    if (Array.isArray(nonTranslateParts) && nonTranslateParts.length > 0) {
      return translateStr + ' ' + nonTranslateParts.join(' ');
    }
    return translateStr;
  }

  // Helper: Get element tag + id + class path identifier
  function getElementPath(el) {
    if (!el) return '';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
    return tag + id + cls;
  }

  // Visual highlight outline overlay
  const overlay = document.createElement('div');
  overlay.id = '__astrolabe_overlay';
  overlay.style.position = 'fixed';
  overlay.style.pointerEvents = 'none';
  overlay.style.zIndex = '2147483647';
  overlay.style.backgroundColor = 'rgba(139, 92, 246, 0.15)';
  overlay.style.border = '2px solid #8b5cf6';
  overlay.style.borderRadius = '4px';
  overlay.style.transition = 'all 0.06s ease-out';
  overlay.style.display = 'none';
  overlay.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.4)';

  const label = document.createElement('div');
  label.style.position = 'absolute';
  label.style.top = '-22px';
  label.style.left = '-2px';
  label.style.backgroundColor = '#8b5cf6';
  label.style.color = '#ffffff';
  label.style.padding = '2px 6px';
  label.style.borderRadius = '3px';
  label.style.fontSize = '10px';
  label.style.fontFamily = 'monospace';
  label.style.fontWeight = 'bold';
  label.style.whiteSpace = 'nowrap';
  label.textContent = '';
  overlay.appendChild(label);

  const mountOverlay = () => {
    if (document.body && !document.getElementById('__astrolabe_overlay')) {
      document.body.appendChild(overlay);
    }
  };
  mountOverlay();
  if (document.readyState !== 'complete') {
    window.addEventListener('DOMContentLoaded', mountOverlay);
  }

  // Serialize DOM tree for the Left Sidebar (Layers Panel)
  function serializeDOM(node, depth = 0) {
    if (!node || node.nodeType !== 1 || depth > 6) return null;
    if (node.id === '__astrolabe_overlay' || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'NOSCRIPT') return null;

    const tag = node.tagName.toLowerCase();
    const id = node.id ? '#' + node.id : '';
    const className = typeof node.className === 'string' && node.className.trim() ? '.' + node.className.trim().split(/\\s+/)[0] : '';
    
    const domId = node.id || (tag + (className ? className : '') + '_' + Math.random().toString(36).substr(2, 5));
    if (!node.dataset.astrolabeId) {
      node.dataset.astrolabeId = domId;
    }

    const text = (node.childNodes.length === 1 && node.childNodes[0].nodeType === 3) 
      ? node.textContent.trim().slice(0, 24) 
      : (['h1','h2','h3','h4','p','span','button','a'].includes(tag) ? (node.innerText || '').trim().slice(0, 24) : '');

    const children = Array.from(node.children)
      .map(c => serializeDOM(c, depth + 1))
      .filter(Boolean);

    return {
      id: node.dataset.astrolabeId,
      name: tag + id + className + (text ? ' "' + text + '"' : ''),
      tag: tag,
      elementId: node.id || '',
      className: typeof node.className === 'string' ? node.className : '',
      text: text,
      visible: node.style.display !== 'none' && node.style.visibility !== 'hidden',
      locked: false,
      children: children
    };
  }

  function emitDOMTree() {
    if (!document.body) return;
    const tree = serializeDOM(document.body);
    if (tree) {
      console.log('__ASTROLABE_DOM_TREE__:' + JSON.stringify(tree));
    }
  }

  // Extract all computed styles with shorthand and unit resolution
  function extractStyles(el) {
    const computed = window.getComputedStyle(el);

    const borderWidth = computed.borderTopWidth || '0px';
    const borderStyle = computed.borderTopStyle || 'none';
    const borderColor = rgbToHex(computed.borderTopColor);
    const borderStr = (borderStyle !== 'none' && borderWidth !== '0px') 
      ? (borderWidth + ' ' + borderStyle + ' ' + borderColor) 
      : '';

    const bgImage = computed.backgroundImage !== 'none' ? computed.backgroundImage : '';
    const bgColor = rgbToHex(computed.backgroundColor);
    const bgStr = bgImage || bgColor || '';

    const radius = computed.borderTopLeftRadius || computed.borderRadius || '0px';
    const shadow = computed.boxShadow !== 'none' ? computed.boxShadow : '';
    const transformStr = el.style.transform || ((computed.transform && computed.transform !== 'none') ? computed.transform : '');

    return {
      display: computed.display || 'block',
      position: computed.position || 'static',
      flexDirection: computed.flexDirection || 'row',
      alignItems: computed.alignItems || 'stretch',
      justifyContent: computed.justifyContent || 'flex-start',
      gap: computed.gap !== 'normal' ? computed.gap : '0px',
      
      width: Math.round(el.getBoundingClientRect().width) + 'px',
      height: Math.round(el.getBoundingClientRect().height) + 'px',
      minWidth: computed.minWidth !== '0px' ? computed.minWidth : '',
      minHeight: computed.minHeight !== '0px' ? computed.minHeight : '',
      maxWidth: computed.maxWidth !== 'none' ? computed.maxWidth : '',
      maxHeight: computed.maxHeight !== 'none' ? computed.maxHeight : '',

      marginTop: computed.marginTop || '0px',
      marginRight: computed.marginRight || '0px',
      marginBottom: computed.marginBottom || '0px',
      marginLeft: computed.marginLeft || '0px',

      paddingTop: computed.paddingTop || '0px',
      paddingRight: computed.paddingRight || '0px',
      paddingBottom: computed.paddingBottom || '0px',
      paddingLeft: computed.paddingLeft || '0px',

      fontFamily: computed.fontFamily ? computed.fontFamily.split(',')[0].replace(/['"]/g, '') : '',
      fontSize: computed.fontSize || '16px',
      fontWeight: computed.fontWeight || '400',
      color: rgbToHex(computed.color) || '#ffffff',
      textAlign: computed.textAlign || 'left',
      lineHeight: computed.lineHeight !== 'normal' ? computed.lineHeight : '',
      letterSpacing: computed.letterSpacing !== 'normal' ? computed.letterSpacing : '0px',

      background: bgStr,
      backgroundColor: bgColor,
      opacity: computed.opacity || '1',
      borderRadius: radius !== '0px' ? radius : '0px',
      border: borderStr,
      boxShadow: shadow,

      transform: transformStr,
      transformOrigin: computed.transformOrigin || ''
    };
  }

  function getElementText(el) {
    if (!el) return '';
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3) {
      return el.textContent || '';
    }
    const tag = el.tagName.toLowerCase();
    if (['h1','h2','h3','h4','h5','h6','p','span','button','a','label','strong','em','b','i'].includes(tag)) {
      return el.innerText || el.textContent || '';
    }
    return '';
  }

  function getComponentSourceInfo(el) {
    if (!el) return { file: '', line: undefined, column: undefined, componentName: '' };

    // 1. Check DOM attributes injected by Next.js / Vite / React inspectors
    const fileAttr = el.getAttribute('data-inspector-file') || 
                     el.getAttribute('data-source-file') || 
                     el.getAttribute('data-file') || 
                     el.getAttribute('data-loc-file') ||
                     el.getAttribute('data-component');
    const lineAttr = el.getAttribute('data-inspector-line') || 
                     el.getAttribute('data-source-line') || 
                     el.getAttribute('data-line') || 
                     el.getAttribute('data-loc-line');
    const colAttr = el.getAttribute('data-inspector-column') || 
                    el.getAttribute('data-source-column') || 
                    el.getAttribute('data-column');

    if (fileAttr) {
      return {
        file: fileAttr,
        line: lineAttr || undefined,
        column: colAttr || undefined,
        componentName: ''
      };
    }

    // 2. Check compound data-loc / data-source (e.g. "src/components/Paywall.tsx:45:10")
    const locAttr = el.getAttribute('data-loc') || el.getAttribute('data-source') || el.getAttribute('data-source-loc');
    if (locAttr && locAttr.includes(':')) {
      const parts = locAttr.split(':');
      return {
        file: parts[0],
        line: parts[1] || undefined,
        column: parts[2] || undefined,
        componentName: ''
      };
    }

    // 3. Inspect React Fiber internals (__reactFiber$ / __reactInternalInstance$)
    try {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (fiberKey && el[fiberKey]) {
        let fiber = el[fiberKey];
        let foundCompName = '';
        while (fiber) {
          if (fiber.type && typeof fiber.type === 'function') {
            foundCompName = fiber.type.displayName || fiber.type.name || '';
          }
          if (fiber._debugSource && fiber._debugSource.fileName) {
            return {
              file: fiber._debugSource.fileName,
              line: fiber._debugSource.lineNumber ? String(fiber._debugSource.lineNumber) : undefined,
              column: fiber._debugSource.columnNumber ? String(fiber._debugSource.columnNumber) : undefined,
              componentName: foundCompName
            };
          }
          if (fiber._debugOwner && fiber._debugOwner._debugSource && fiber._debugOwner._debugSource.fileName) {
            return {
              file: fiber._debugOwner._debugSource.fileName,
              line: fiber._debugOwner._debugSource.lineNumber ? String(fiber._debugOwner._debugSource.lineNumber) : undefined,
              column: fiber._debugOwner._debugSource.columnNumber ? String(fiber._debugOwner._debugSource.columnNumber) : undefined,
              componentName: foundCompName || (fiber._debugOwner.type && typeof fiber._debugOwner.type === 'function' ? (fiber._debugOwner.type.displayName || fiber._debugOwner.type.name) : '')
            };
          }
          fiber = fiber.return;
        }
        if (foundCompName) {
          return { file: '', line: undefined, column: undefined, componentName: foundCompName };
        }
      }
    } catch (e) {}

    return { file: '', line: undefined, column: undefined, componentName: '' };
  }

  function selectElement(el) {
    if (!el) return;
    lockedElement = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.borderColor = '#10b981';
    overlay.style.backgroundColor = 'rgba(16, 185, 129, 0.12)';
    overlay.style.boxShadow = '0 0 16px rgba(16, 185, 129, 0.5)';

    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
    label.textContent = tag + id + cls;
    label.style.backgroundColor = '#10b981';

    const styles = extractStyles(el);
    const textContent = getElementText(el);
    const sourceInfo = getComponentSourceInfo(el);
    const selectorStr = tag + id + cls;

    const payload = {
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      pathInfo: {
        file: sourceInfo.file || selectorStr,
        line: sourceInfo.line,
        column: sourceInfo.column,
        selector: selectorStr,
        componentName: sourceInfo.componentName || ''
      },
      styles: styles,
      text: textContent,
      domId: el.dataset.astrolabeId || ''
    };

    console.log('__ASTROLABE_SELECTED__:' + JSON.stringify(payload));
  }

  // Mouse Down: Initiate Drag-and-Drop or Selection
  document.addEventListener('mousedown', (e) => {
    if (!isInspectActive) return;
    if (e.button !== 0) return; // Only primary mouse button

    let target = e.target;
    if (!target) return;
    if (target === overlay || target === label) {
      target = lockedElement;
    }
    if (!target || target === document.body || target === document.documentElement) return;

    // Do not initiate drag if inline text editing is active
    if (target.isContentEditable) return;

    // Select the target element
    selectElement(target);

    // Retrieve and parse existing transform data (including scale, rotate, skew, matrix)
    const existingTransform = getElementTransformData(target);

    dragState = {
      isDragging: true,
      hasMoved: false,
      target: target,
      startX: e.clientX,
      startY: e.clientY,
      initialTranslateX: existingTransform.translateX,
      initialTranslateY: existingTransform.translateY,
      initialTranslateZ: existingTransform.translateZ,
      nonTranslateParts: existingTransform.nonTranslateParts
    };

    e.preventDefault();
  }, true);

  let dragRafId = null;
  let latestDragCoords = null;

  function processDragFrame() {
    dragRafId = null;
    if (!dragState.isDragging || !dragState.target || !latestDragCoords) return;

    const dx = latestDragCoords.clientX - dragState.startX;
    const dy = latestDragCoords.clientY - dragState.startY;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      dragState.hasMoved = true;
    }

    if (dragState.hasMoved) {
      const newX = dragState.initialTranslateX + dx;
      const newY = dragState.initialTranslateY + dy;

      // Compose the new translate with existing scale, rotate, skew, and perspective
      const composed = composeTransform(
        newX,
        newY,
        dragState.nonTranslateParts,
        dragState.initialTranslateZ
      );

      dragState.target.style.setProperty('transform', composed, 'important');

      // Keep overlay position synchronized with the moved element
      const rect = dragState.target.getBoundingClientRect();
      overlay.style.display = 'block';
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';

      // Emit live style updates to Astrolabe Studio UI
      const styles = extractStyles(dragState.target);
      console.log('__ASTROLABE_SELECTED__:' + JSON.stringify({
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        pathInfo: { file: getElementPath(dragState.target), line: '1', column: '1' },
        styles: styles,
        text: getElementText(dragState.target),
        domId: dragState.target.dataset.astrolabeId || ''
      }));
    }
  }

  // Mouse Move: Drag-and-Drop Handler & Hover Effect
  document.addEventListener('mousemove', (e) => {
    // 1. Drag-and-drop active handling (throttled with requestAnimationFrame)
    if (dragState.isDragging && dragState.target) {
      latestDragCoords = { clientX: e.clientX, clientY: e.clientY };
      if (!dragRafId) {
        dragRafId = requestAnimationFrame(processDragFrame);
      }
      return;
    }

    // 2. Hover outline effect (when not dragging)
    if (!isInspectActive) return;

    const el = e.target;
    if (!el || el === overlay || el === label || el === document.body || el === document.documentElement) {
      if (!lockedElement) overlay.style.display = 'none';
      return;
    }
    if (lockedElement) return;

    hoveredElement = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.borderColor = '#8b5cf6';
    overlay.style.backgroundColor = 'rgba(139, 92, 246, 0.15)';
    overlay.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.4)';
    
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '';
    label.textContent = tag + id + cls;
    label.style.backgroundColor = '#8b5cf6';
  }, true);

  // Mouse Up: Complete Drag-and-Drop
  document.addEventListener('mouseup', (e) => {
    if (dragState.isDragging) {
      if (dragRafId) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      if (latestDragCoords) {
        processDragFrame();
        latestDragCoords = null;
      }
      if (dragState.hasMoved && dragState.target) {
        selectElement(dragState.target);
        emitDOMTree();
        setTimeout(() => {
          dragState.hasMoved = false;
        }, 50);
      }
      dragState.isDragging = false;
      dragState.target = null;
    }
  }, true);

  // Click on element to select (ONLY if Inspect Mode is ON)
  document.addEventListener('click', (e) => {
    if (!isInspectActive) return;

    if (dragState.hasMoved) {
      e.preventDefault();
      e.stopPropagation();
      dragState.hasMoved = false;
      return;
    }

    const el = e.target;
    if (!el || el === overlay || el === label) return;
    e.preventDefault();
    e.stopPropagation();
    selectElement(el);
  }, true);

  // Double Click on element to directly edit text on screen!
  document.addEventListener('dblclick', (e) => {
    if (!isInspectActive) return;
    const el = e.target;
    if (!el || el === overlay || el === label) return;

    e.preventDefault();
    e.stopPropagation();

    lockedElement = el;
    el.contentEditable = 'true';
    el.focus();
    overlay.style.display = 'none';

    // Select all text inside element
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const finishEdit = () => {
      el.contentEditable = 'false';
      const newText = getElementText(el);
      const styles = extractStyles(el);
      console.log('__ASTROLABE_TEXT_CHANGED__:' + JSON.stringify({
        domId: el.dataset.astrolabeId || '',
        text: newText,
        styles: styles
      }));
      emitDOMTree();
      selectElement(el);
    };

    el.addEventListener('blur', finishEdit, { once: true });
    el.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ke.preventDefault();
        el.blur();
      }
    });
  }, true);

  // Escape key to deselect or blur
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.activeElement && document.activeElement.isContentEditable) {
        document.activeElement.blur();
      } else if (lockedElement) {
        lockedElement = null;
        overlay.style.display = 'none';
      }
    }
  });

  // Global methods called from Astrolabe Studio
  window.__astrolabeSetInspectMode = function(active) {
    isInspectActive = !!active;
    if (!isInspectActive) {
      if (dragRafId) {
        cancelAnimationFrame(dragRafId);
        dragRafId = null;
      }
      latestDragCoords = null;
      overlay.style.display = 'none';
      lockedElement = null;
      hoveredElement = null;
      dragState.isDragging = false;
      dragState.target = null;
    }
  };

  window.__astrolabeSetTextContent = function(newText) {
    if (!lockedElement) return;
    if (lockedElement.childNodes.length === 1 && lockedElement.childNodes[0].nodeType === 3) {
      lockedElement.textContent = newText;
    } else {
      let textNode = Array.from(lockedElement.childNodes).find(n => n.nodeType === 3);
      if (textNode) {
        textNode.textContent = newText;
      } else {
        lockedElement.textContent = newText;
      }
    }
    emitDOMTree();
    const rect = lockedElement.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
  };

  window.__astrolabeApplyStyle = function(styles) {
    if (!lockedElement) return;
    for (const key in styles) {
      try {
        let val = styles[key];
        if (key === 'transform' && typeof val === 'string') {
          const parsedIncoming = parseTransformString(val);
          // If incoming transform is only a translate(x, y), preserve existing non-translate functions (scale, rotate, skew)
          if (parsedIncoming.hasTranslate && parsedIncoming.nonTranslateParts.length === 0) {
            const currentTransform = getElementTransformData(lockedElement);
            if (currentTransform.nonTranslateParts.length > 0) {
              val = composeTransform(
                parsedIncoming.translateX,
                parsedIncoming.translateY,
                currentTransform.nonTranslateParts,
                parsedIncoming.translateZ
              );
            }
          }
        }
        const kebab = key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        lockedElement.style.setProperty(kebab, val, 'important');
      } catch (err) {}
    }
    if (lockedElement) {
      const rect = lockedElement.getBoundingClientRect();
      overlay.style.top = rect.top + 'px';
      overlay.style.left = rect.left + 'px';
      overlay.style.width = rect.width + 'px';
      overlay.style.height = rect.height + 'px';
    }
  };

  window.__astrolabeSelectById = function(astrolabeId) {
    const el = document.querySelector('[data-astrolabe-id="' + astrolabeId + '"]');
    if (el) {
      selectElement(el);
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  window.__astrolabeToggleVisibility = function(astrolabeId) {
    const el = document.querySelector('[data-astrolabe-id="' + astrolabeId + '"]');
    if (el) {
      if (el.style.display === 'none') {
        el.style.display = '';
        el.style.visibility = 'visible';
      } else {
        el.style.display = 'none';
      }
      emitDOMTree();
    }
  };

  // Emit initial tree and watch for changes
  setTimeout(emitDOMTree, 300);
  window.addEventListener('load', emitDOMTree);

  let mutationDebounceTimer = null;
  const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;

    for (let i = 0; i < mutations.length; i++) {
      const mut = mutations[i];
      const target = mut.target;

      // Ignore mutations originating on the overlay element or its children
      if (target) {
        if (target.id === '__astrolabe_overlay') continue;
        if (typeof target.closest === 'function' && target.closest('#__astrolabe_overlay')) continue;
      }

      // Ignore data-astrolabe-id and overlay style attribute changes
      if (mut.type === 'attributes') {
        if (mut.attributeName === 'data-astrolabe-id') continue;
        if (mut.attributeName === 'style' && target && target.id === '__astrolabe_overlay') continue;
      }

      // Ignore childList mutations that only involve the overlay element
      if (mut.type === 'childList') {
        let onlyOverlay = true;
        for (let j = 0; j < mut.addedNodes.length; j++) {
          if (mut.addedNodes[j].id !== '__astrolabe_overlay') {
            onlyOverlay = false;
            break;
          }
        }
        for (let j = 0; j < mut.removedNodes.length; j++) {
          if (mut.removedNodes[j].id !== '__astrolabe_overlay') {
            onlyOverlay = false;
            break;
          }
        }
        if (onlyOverlay && (mut.addedNodes.length > 0 || mut.removedNodes.length > 0)) {
          continue;
        }
      }

      shouldUpdate = true;
      break;
    }

    if (shouldUpdate) {
      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        emitDOMTree();
      }, 250);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }
})();
`;

