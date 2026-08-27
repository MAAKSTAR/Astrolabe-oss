export const INSPECTOR_SCRIPT = `
(function() {
    if (window.__exovonInspectorInitialized) return;
    window.__exovonInspectorInitialized = true;
    
    console.log("🚀 Exovon Visual Inspector Injected!");

    function initInspector() {
        if (window.__exovonInspectorDOMReady) return;
        window.__exovonInspectorDOMReady = true;
        console.log("✅ Exovon Inspector DOM Ready! Binding events...");

        // Overlay for highlighting elements
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483647';
        overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
        overlay.style.border = '2px solid rgba(59, 130, 246, 0.8)';
        overlay.style.borderRadius = '4px';
        overlay.style.transition = 'all 0.1s ease-out';
        overlay.style.display = 'none';
        
        if (document.body) {
            document.body.appendChild(overlay);
        } else {
            document.documentElement.appendChild(overlay);
        }

        // Persistent 'Astrolabe Active' Badge
        const activeBadge = document.createElement('div');
        activeBadge.style.position = 'fixed';
        activeBadge.style.bottom = '16px';
        activeBadge.style.right = '16px';
        activeBadge.style.zIndex = '2147483646';
        activeBadge.style.backgroundColor = 'rgba(168, 85, 247, 0.9)';
        activeBadge.style.color = '#fff';
        activeBadge.style.padding = '6px 12px';
        activeBadge.style.borderRadius = '20px';
        activeBadge.style.fontFamily = 'system-ui, sans-serif';
        activeBadge.style.fontSize = '12px';
        activeBadge.style.fontWeight = 'bold';
        activeBadge.style.boxShadow = '0 4px 12px rgba(168, 85, 247, 0.4)';
        activeBadge.style.display = 'flex';
        activeBadge.style.alignItems = 'center';
        activeBadge.style.gap = '6px';
        activeBadge.style.pointerEvents = 'none';
        activeBadge.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Astrolabe Inspector';
        
        if (document.body) {
            document.body.appendChild(activeBadge);
        } else {
            document.documentElement.appendChild(activeBadge);
        }

    // Badge for React component names
    const badge = document.createElement('div');
    badge.style.position = 'absolute';
    badge.style.top = '-24px';
    badge.style.left = '-2px';
    badge.style.backgroundColor = 'rgba(59, 130, 246, 0.9)';
    badge.style.color = '#fff';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '4px';
    badge.style.fontSize = '11px';
    badge.style.fontFamily = 'monospace';
    badge.style.whiteSpace = 'nowrap';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '4px';
    // Add SVG icon for component
    badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg> <span>Component</span>';
    overlay.appendChild(badge);

    // Floating Menu
    const floatingMenu = document.createElement('div');
    floatingMenu.style.position = 'fixed';
    floatingMenu.style.zIndex = '2147483647';
    floatingMenu.style.display = 'none';
    floatingMenu.style.backgroundColor = '#2d2d2d';
    floatingMenu.style.border = '1px solid rgba(255,255,255,0.1)';
    floatingMenu.style.borderRadius = '6px';
    floatingMenu.style.padding = '4px';
    floatingMenu.style.boxShadow = '0 10px 25px -5px rgba(0, 0, 0, 0.5)';
    floatingMenu.style.display = 'none';
    floatingMenu.style.gap = '4px';
    if (document.body) {
        document.body.appendChild(floatingMenu);
    } else {
        document.documentElement.appendChild(floatingMenu);
    }

    const btnAgent = document.createElement('button');
    btnAgent.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> Send to Agent';
    btnAgent.style.display = 'flex';
    btnAgent.style.alignItems = 'center';
    btnAgent.style.background = 'transparent';
    btnAgent.style.color = '#e4e4e7';
    btnAgent.style.border = 'none';
    btnAgent.style.padding = '6px 12px';
    btnAgent.style.fontSize = '12px';
    btnAgent.style.fontFamily = 'sans-serif';
    btnAgent.style.cursor = 'pointer';
    btnAgent.style.borderRadius = '4px';
    btnAgent.onmouseover = () => btnAgent.style.backgroundColor = 'rgba(255,255,255,0.1)';
    btnAgent.onmouseout = () => btnAgent.style.backgroundColor = 'transparent';

    const btnCss = document.createElement('button');
    btnCss.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="m18 10-5.5 5.5-2.5-2.5 5.5-5.5"></path><path d="m22 2-6 6"></path><path d="M12 22a8.5 8.5 0 0 1-8.5-8.5c0-4.7 3.8-8.5 8.5-8.5V2l2 2-2 2v3c2.8 0 5 2.2 5 5s-2.2 5-5 5Z"></path></svg> Edit CSS';
    btnCss.style.display = 'flex';
    btnCss.style.alignItems = 'center';
    btnCss.style.background = 'transparent';
    btnCss.style.color = '#e4e4e7';
    btnCss.style.border = 'none';
    btnCss.style.padding = '6px 12px';
    btnCss.style.fontSize = '12px';
    btnCss.style.fontFamily = 'sans-serif';
    btnCss.style.cursor = 'pointer';
    btnCss.style.borderRadius = '4px';
    btnCss.onmouseover = () => btnCss.style.backgroundColor = 'rgba(255,255,255,0.1)';
    btnCss.onmouseout = () => btnCss.style.backgroundColor = 'transparent';

    floatingMenu.appendChild(btnAgent);
    floatingMenu.appendChild(btnCss);

    const btnEditor = document.createElement('button');
    btnEditor.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Open in VS Code';
    btnEditor.style.display = 'none';
    btnEditor.style.alignItems = 'center';
    btnEditor.style.background = 'transparent';
    btnEditor.style.color = '#e4e4e7';
    btnEditor.style.border = 'none';
    btnEditor.style.padding = '6px 12px';
    btnEditor.style.fontSize = '12px';
    btnEditor.style.fontFamily = 'sans-serif';
    btnEditor.style.cursor = 'pointer';
    btnEditor.style.borderRadius = '4px';
    btnEditor.onmouseover = () => btnEditor.style.backgroundColor = 'rgba(255,255,255,0.1)';
    btnEditor.onmouseout = () => btnEditor.style.backgroundColor = 'transparent';

    floatingMenu.appendChild(btnEditor);

    let active = true;
    let hoveredElement = null;
    let lockedElement = null;

    // React Fiber Component extraction
    function getReactComponent(el) {
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
        if (!key) return null;
        let fiber = el[key];
        while (fiber) {
            if (fiber.type && typeof fiber.type === 'function' && fiber.type.name) {
                return fiber.type.name;
            }
            fiber = fiber.return;
        }
        return null;
    }

    function getDomPath(el) {
        if (!el) return '';
        var stack = [];
        while (el.parentNode != null) {
            var sibCount = 0, sibIndex = 0;
            for (var i = 0; i < el.parentNode.childNodes.length; i++) {
                var sib = el.parentNode.childNodes[i];
                if (sib.nodeName == el.nodeName) {
                    if (sib === el) sibIndex = sibCount;
                    sibCount++;
                }
            }
            if (el.hasAttribute('id') && el.id != '') {
                stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
            } else if (sibCount > 1) {
                stack.unshift(el.nodeName.toLowerCase() + ':eq(' + sibIndex + ')');
            } else {
                stack.unshift(el.nodeName.toLowerCase());
            }
            el = el.parentNode;
        }
        return stack.slice(1).join(' > ');
    }

    function getDeepElementFromPoint(x, y) {
        let el = document.elementFromPoint(x, y);
        while (el && el.shadowRoot) {
            const shadowEl = el.shadowRoot.elementFromPoint(x, y);
            if (!shadowEl || shadowEl === el) break;
            el = shadowEl;
        }
        return el;
    }

    document.addEventListener('mousemove', (e) => {
        if (!active || lockedElement) return;
        const el = getDeepElementFromPoint(e.clientX, e.clientY);
        if (el && el !== overlay && !floatingMenu.contains(el) && el !== hoveredElement) {
            hoveredElement = el;
            const rect = el.getBoundingClientRect();
            overlay.style.display = 'block';
            overlay.style.top = rect.top + 'px';
            overlay.style.left = rect.left + 'px';
            overlay.style.width = rect.width + 'px';
            overlay.style.height = rect.height + 'px';

            const compName = getReactComponent(el);
            if (compName) {
                badge.style.display = 'flex';
                badge.querySelector('span').innerText = compName;
            } else {
                badge.style.display = 'none';
            }
        }
    }, { capture: true });

    function getSourceLocation(el) {
        let curr = el;
        while (curr && curr !== document.body && curr !== document.documentElement) {
            const pathInfo = curr.getAttribute('data-insp-path');
            if (pathInfo) {
                const match = pathInfo.match(/(.+):(\\d+):(\\d+)$/) || pathInfo.match(/(.+):(\\d+)$/);
                if (match) {
                    return { file: match[1], line: match[2], column: match[3] || '1' };
                }
            }
            curr = curr.parentElement;
        }
        return null;
    }

    // Double-click for Live Edit
    document.addEventListener('dblclick', (e) => {
        if (!active || floatingMenu.contains(e.target)) return;
        e.preventDefault();
        e.stopPropagation();

        const el = e.target;
        if (!el || el === overlay) return;

        // Hide UI
        overlay.style.display = 'none';
        floatingMenu.style.display = 'none';
        lockedElement = null;

        const oldText = el.innerText;
        el.contentEditable = true;
        el.focus();
        el.style.outline = '2px dashed #3b82f6';
        
        const onBlur = () => {
            el.contentEditable = false;
            el.style.outline = '';
            el.removeEventListener('blur', onBlur);
            
            const newText = el.innerText;
            if (oldText !== newText) {
                fetch('/__exovon_inspector', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'liveEdit',
                        oldText,
                        newText,
                        tagName: el.tagName.toLowerCase(),
                        domPath: getDomPath(el)
                    })
                }).catch(err => console.error(err));
            }
        };
        el.addEventListener('blur', onBlur);
    }, { capture: true });

    document.addEventListener('click', (e) => {
        if (!active) return;
        
        if (floatingMenu.contains(e.target)) {
            // Let menu buttons handle it
            return;
        }

        const el = (e.target && e.target !== overlay) ? e.target : hoveredElement;
        if (!el) return;

        e.preventDefault();
        e.stopPropagation();

        lockedElement = el;
        const el = lockedElement;
        
        // Show floating menu
        overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
        overlay.style.borderColor = 'rgba(34, 197, 94, 0.9)'; // Green border when locked
        
        const rect = el.getBoundingClientRect();
        floatingMenu.style.display = 'flex';
        floatingMenu.style.top = (rect.bottom + 10) + 'px';
        floatingMenu.style.left = rect.left + 'px';

        const sourceLoc = getSourceLocation(el);
        const fallbackLoc = { file: 'DOM Element (' + el.tagName.toLowerCase() + ')', line: '1', column: '1' };
        const pathInfo = sourceLoc || fallbackLoc;

        if (sourceLoc) {
            btnEditor.style.display = 'flex';
        } else {
            btnEditor.style.display = 'none';
        }

        if (window.parent !== window) {
            const computed = window.getComputedStyle(el);
            window.parent.postMessage({
                type: 'ASTROLABE_ELEMENT_SELECTED',
                bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                pathInfo: pathInfo,
                styles: {
                    width: computed.width,
                    height: computed.height,
                    marginTop: computed.marginTop,
                    marginRight: computed.marginRight,
                    marginBottom: computed.marginBottom,
                    marginLeft: computed.marginLeft,
                    top: computed.top,
                    left: computed.left,
                }
            }, '*');
        }

        // Update button handlers
        const data = {
            tagName: el.tagName.toLowerCase(),
            id: el.id,
            className: el.className,
            text: el.innerText ? el.innerText.substring(0, 100).replace(/\\n/g, ' ') : '',
            domPath: getDomPath(el),
            outerHTML: el.outerHTML.substring(0, 200) + (el.outerHTML.length > 200 ? '...' : ''),
            component: getReactComponent(el)
        };

        btnAgent.onclick = () => {
            fetch('/__exovon_inspector', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'sendToAgent', ...data })
            }).catch(err => console.error(err));
            hideAll();
        };

        btnCss.onclick = () => {
            fetch('/__exovon_inspector', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'openCssEditor', ...data })
            }).catch(err => console.error(err));
            hideAll();
        };

        btnEditor.onclick = () => {
            if (sourceLoc) {
                fetch('/__exovon_inspector', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'openInEditor', ...sourceLoc })
                }).catch(err => console.error(err));
                hideAll();
            }
        };

    }, { capture: true });

    function hideAll() {
        overlay.style.display = 'none';
        floatingMenu.style.display = 'none';
        lockedElement = null;
    }

    // SSE Bridge for Agent Control
    const sse = new EventSource('/__exovon_sse');
    sse.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'highlight') {
                const el = document.querySelector(msg.selector);
                if (el) {
                    const originalOutline = el.style.outline;
                    const originalTransition = el.style.transition;
                    el.style.transition = 'all 0.2s';
                    el.style.outline = '4px solid #ef4444'; // Red flash
                    setTimeout(() => {
                        el.style.outline = originalOutline;
                        el.style.transition = originalTransition;
                    }, 2000);
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        } catch (e) {}
    };

    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'ASTROLABE_UPDATE_STYLE' && lockedElement) {
            for (const key in event.data.styles) {
                lockedElement.style[key] = event.data.styles[key];
            }
        }
    });

    // --- Iframe Auto-Injection Logic ---
    function injectIntoIframe(iframe) {
        try {
            const doc = iframe.contentDocument || iframe.contentWindow?.document;
            if (doc && !doc.__exovonInspectorInitialized) {
                // If we are already an iframe, we might not have the original script tag id.
                // We can use document.currentScript or the global INSPECTOR_SCRIPT text.
                // Since this string is injected entirely, we can grab it if it exists.
                let scriptText = '';
                const scriptEl = document.getElementById('exovon-inspector-script');
                if (scriptEl) {
                    scriptText = scriptEl.textContent;
                } else if (document.currentScript) {
                    scriptText = document.currentScript.textContent;
                }
                
                if (scriptText) {
                    const script = doc.createElement('script');
                    script.textContent = scriptText;
                    doc.body.appendChild(script);
                }
            }
        } catch(e) { /* ignore cross-origin */ }
    }

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.tagName === 'IFRAME') {
                    node.addEventListener('load', () => injectIntoIframe(node));
                } else if (node.querySelectorAll) {
                    node.querySelectorAll('iframe').forEach(ifr => {
                        ifr.addEventListener('load', () => injectIntoIframe(ifr));
                    });
                }
            }
        }
    });
    
    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    }
    
    // Inject into existing iframes
    const existingIframes = document.querySelectorAll('iframe');
    existingIframes.forEach(iframe => {
        injectIntoIframe(iframe);
        iframe.addEventListener('load', () => injectIntoIframe(iframe));
    });

    } // end initInspector

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initInspector);
    } else {
        initInspector();
    }

})();
`;
