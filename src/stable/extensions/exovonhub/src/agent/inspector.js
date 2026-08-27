(function() {
    if (window.__exovonInspectorInitialized) return;
    window.__exovonInspectorInitialized = true;

    // Create highlight overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '2147483647'; // Max z-index
    overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.3)';
    overlay.style.border = '2px solid rgba(59, 130, 246, 0.8)';
    overlay.style.borderRadius = '4px';
    overlay.style.transition = 'all 0.1s ease-out';
    overlay.style.display = 'none';
    document.body.appendChild(overlay);

    let active = true; // Automatically active when injected (or controlled via messages)
    let hoveredElement = null;

    function getDomPath(el) {
        if (!el) return '';
        var stack = [];
        while (el.parentNode != null) {
            var sibCount = 0;
            var sibIndex = 0;
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
        return stack.slice(1).join(' > '); // Remove html
    }

    document.addEventListener('mousemove', (e) => {
        if (!active) return;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el && el !== overlay && el !== hoveredElement) {
            hoveredElement = el;
            const rect = el.getBoundingClientRect();
            overlay.style.display = 'block';
            overlay.style.top = rect.top + 'px';
            overlay.style.left = rect.left + 'px';
            overlay.style.width = rect.width + 'px';
            overlay.style.height = rect.height + 'px';
        }
    });

    document.addEventListener('click', (e) => {
        if (!active || !hoveredElement) return;
        
        // Prevent actual click
        e.preventDefault();
        e.stopPropagation();

        const el = hoveredElement;
        const rect = el.getBoundingClientRect();
        
        // Flash effect
        overlay.style.backgroundColor = 'rgba(34, 197, 94, 0.5)';
        overlay.style.borderColor = 'rgba(34, 197, 94, 0.9)';
        setTimeout(() => {
            overlay.style.backgroundColor = 'rgba(59, 130, 246, 0.3)';
            overlay.style.borderColor = 'rgba(59, 130, 246, 0.8)';
            overlay.style.display = 'none'; // hide after click
            active = false; // Turn off after single selection
        }, 300);

        // Collect data
        const data = {
            tagName: el.tagName.toLowerCase(),
            id: el.id,
            className: el.className,
            text: el.innerText ? el.innerText.substring(0, 100).replace(/\n/g, ' ') : '',
            domPath: getDomPath(el),
            outerHTML: el.outerHTML.substring(0, 200) + (el.outerHTML.length > 200 ? '...' : '')
        };

        // Send back to proxy
        fetch('/__exovon_inspector', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        }).catch(err => console.error('Inspector send error:', err));

    }, { capture: true }); // Use capture phase to ensure we stop the event early

    console.log('🚀 Astrolabe Visual UI Inspector Activated!');
})();
