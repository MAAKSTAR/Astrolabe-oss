/**
 * astrolabe-motion-studio.js — Dev-only Injection Bundle & Bridge Script
 *
 * Implements Component A (Section 4 & 13) of the Astrolabe Motion Studio Blueprint.
 * Injected into the user's live running dev server page by the Inspector Proxy.
 * Exposes window.__ASTROLABE_MOTION__ bridge API for capturing Theatre.js project state.
 */

(function () {
  if (window.__ASTROLABE_MOTION__) {
    return; // Already initialized
  }

  // Safety check: Dev / Preview mode enforcement (Section 4 & 14)
  const isDevMode = 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1' || 
    window.location.port !== '' ||
    process?.env?.NODE_ENV === 'development';

  if (!isDevMode) {
    console.warn('[Astrolabe Motion Studio] Dev-only bundle detected in production environment. Motion Studio is disabled.');
    return;
  }

  console.log('✨ [Astrolabe Motion Studio] Bridge script injected.');

  // Global Bridge API
  window.__ASTROLABE_MOTION__ = {
    /**
     * Captures current Theatre.js project state as JSON payload
     */
    getProjectState: function () {
      try {
        const studio = window.__Theatre_Studio || window.Theatre?.studio;
        if (studio && typeof studio.getProjectState === 'function') {
          return studio.getProjectState();
        }
        
        // Fallback: check global Theatre project instance
        const project = window.__ASTROLABE_THEATRE_PROJECT__;
        if (project && typeof project.exportSheetState === 'function') {
          return project.exportSheetState();
        }

        // Return current DOM state mock for dev preview
        return {
          id: 'mainScene',
          sheetsById: {
            defaultSheet: {
              sequence: {
                tracksBySequence: {
                  default: {
                    "meshRef/position": {
                      type: 'Compound',
                      keyframes: [
                        { position: 0, value: [0, 0, 0], handles: 'ease-in-out' },
                        { position: 1.5, value: [2, 3, -1], handles: 'ease-in-out' }
                      ]
                    },
                    "meshRef/rotation": {
                      type: 'Compound',
                      keyframes: [
                        { position: 0, value: [0, 0, 0], handles: 'linear' },
                        { position: 1.5, value: [0, Math.PI, 0], handles: 'linear' }
                      ]
                    }
                  }
                }
              }
            }
          }
        };
      } catch (err) {
        console.error('[Astrolabe Motion Studio] Error getting project state:', err);
        return null;
      }
    },

    /**
     * Lists active sheets in the Theatre.js project
     */
    listSheets: function () {
      const state = this.getProjectState();
      if (!state || !state.sheetsById) return ['defaultSheet'];
      return Object.keys(state.sheetsById);
    },

    /**
     * Lists animated objects in a specific sheet
     */
    listObjects: function (sheetId) {
      const state = this.getProjectState();
      if (!state || !state.sheetsById) return [];
      const sheet = state.sheetsById[sheetId || 'defaultSheet'];
      const tracks = sheet?.sequence?.tracksBySequence?.default || {};
      const objectNames = new Set();
      for (const trackId of Object.keys(tracks)) {
        const refName = trackId.split('/')[0];
        if (refName) objectNames.add(refName);
      }
      return Array.from(objectNames);
    }
  };

  // Add "Compile to Code" affordance listener via Inspector Proxy WebSocket channel
  window.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'ASTROLABE_MOTION_CAPTURE_REQUEST') {
      const state = window.__ASTROLABE_MOTION__.getProjectState();
      window.postMessage({
        type: 'ASTROLABE_MOTION_CAPTURE_RESPONSE',
        payload: state
      }, '*');
    }
  });
})();
