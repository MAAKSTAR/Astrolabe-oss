export class BrowserBridge {
  
  /**
   * Sends a raw CDP command to the guest view.
   */
  static async sendCommand(method: string, params?: any): Promise<any> {
    if (window.electronAPI && window.electronAPI.cdpSendCommand) {
      return await window.electronAPI.cdpSendCommand(method, params);
    }
    throw new Error('electronAPI.cdpSendCommand is not available');
  }

  /**
   * Captures a screenshot of the guest view page.
   * Returns a base64 encoded string of the image.
   */
  static async captureScreenshot(): Promise<string> {
    if (window.electronAPI && window.electronAPI.cdpCaptureScreenshot) {
      const result = await window.electronAPI.cdpCaptureScreenshot();
      return result.data;
    }
    throw new Error('electronAPI.cdpCaptureScreenshot is not available');
  }

  /**
   * Fetches the flattened DOM tree of the current guest view.
   */
  static async getDOMTree(): Promise<any> {
    // First ensure the document is enabled to get node info
    await this.sendCommand('DOM.enable');
    const result = await this.sendCommand('DOM.getFlattenedDocument', { depth: -1, pierce: true });
    return result.nodes;
  }

  /**
   * Scrolls the guest view to the specified Y coordinate instantaneously.
   */
  static async scrollTo(y: number): Promise<void> {
    try {
      await this.sendCommand('Runtime.evaluate', {
        expression: `window.scrollTo(0, ${y})`,
        returnByValue: true
      });
    } catch (e) {
      // Ignore if guest is navigating or not attached
    }
  }

  /**
   * Applies interpolated motion keyframe values to elements in the live guest page.
   */
  static async applyMotionFrame(tracks: { nodeId: string; property: string; value: number | number[] | string }[]): Promise<void> {
    if (!tracks || tracks.length === 0) return;
    try {
      const script = `
        (function() {
          const frameData = ${JSON.stringify(tracks)};
          if (!frameData || !Array.isArray(frameData)) return;

          // Helper to find elements for a given nodeId selector
          function resolveElements(nodeId) {
            if (!nodeId) return [];
            let clean = String(nodeId).trim();
            // If nodeId contains quotes from layer name like: div.font-heading "Unlock Full Access"
            if (clean.includes('"')) {
              clean = clean.split('"')[0].trim();
            }

            // 1. Check data-astrolabe-id attribute
            const byAstrolabeAttr = document.querySelectorAll('[data-astrolabe-id="' + clean + '"]');
            if (byAstrolabeAttr && byAstrolabeAttr.length > 0) {
              return Array.from(byAstrolabeAttr);
            }

            // 2. Check direct selector (id, class, tag, attribute)
            try {
              const queried = document.querySelectorAll(clean);
              if (queried && queried.length > 0) return Array.from(queried);
            } catch (e) {}

            // 3. Fallback: Check id without hash
            const byId = document.getElementById(clean.replace(/^#/, ''));
            if (byId) return [byId];

            return [];
          }

          // Group frame modifications by target DOM element to compose transforms seamlessly
          const elementMap = new Map();

          for (const t of frameData) {
            const els = resolveElements(t.nodeId);
            for (const el of els) {
              if (!el || !el.style) continue;
              if (!elementMap.has(el)) {
                elementMap.set(el, {
                  transforms: {},
                  styles: {}
                });
              }
              const entry = elementMap.get(el);
              const prop = t.property;
              const val = t.value;

              if (prop === 'translateY' || prop === 'y' || prop === 'opacity & transformY') {
                entry.transforms.translateY = typeof val === 'number' ? val : (parseFloat(String(val)) || 0);
              } else if (prop === 'translateX' || prop === 'x') {
                entry.transforms.translateX = typeof val === 'number' ? val : (parseFloat(String(val)) || 0);
              } else if (prop === 'scale') {
                entry.transforms.scale = typeof val === 'number' ? val : (parseFloat(String(val)) || 1);
              } else if (prop === 'rotate') {
                entry.transforms.rotate = typeof val === 'number' ? val : (parseFloat(String(val)) || 0);
              } else if (prop === 'opacity') {
                entry.styles.opacity = String(val);
              } else if (prop === 'blur' || prop === 'backdrop-blur') {
                entry.styles.filter = typeof val === 'number' ? 'blur(' + val + 'px)' : String(val);
              } else if (prop === 'fontSize' || prop === 'font-size') {
                entry.styles.fontSize = typeof val === 'number' ? val + 'px' : String(val);
              } else if (prop === 'width') {
                entry.styles.width = typeof val === 'number' ? val + 'px' : String(val);
              } else if (prop === 'height') {
                entry.styles.height = typeof val === 'number' ? val + 'px' : String(val);
              } else {
                entry.styles[prop] = String(val);
              }
            }
          }

          // Apply grouped styles and composed transforms to each element
          elementMap.forEach((data, el) => {
            try {
              // 1. Compose transforms
              const parts = [];
              const tx = data.transforms.translateX;
              const ty = data.transforms.translateY;
              if (tx !== undefined || ty !== undefined) {
                parts.push('translate3d(' + (tx || 0) + 'px, ' + (ty || 0) + 'px, 0px)');
              }
              if (data.transforms.scale !== undefined) {
                parts.push('scale(' + data.transforms.scale + ')');
              }
              if (data.transforms.rotate !== undefined) {
                parts.push('rotate(' + data.transforms.rotate + 'deg)');
              }

              if (parts.length > 0) {
                el.style.transform = parts.join(' ');
              }

              // 2. Apply general CSS styles
              for (const [propName, propVal] of Object.entries(data.styles)) {
                if (propName === 'fontSize') el.style.fontSize = propVal;
                else if (propName === 'opacity') el.style.opacity = propVal;
                else if (propName === 'filter') el.style.filter = propVal;
                else if (propName === 'width') el.style.width = propVal;
                else if (propName === 'height') el.style.height = propVal;
                else el.style.setProperty(propName, propVal);
              }
            } catch (err) {}
          });
        })();
      `;
      await this.sendCommand('Runtime.evaluate', { expression: script, returnByValue: false });
    } catch (e) {
      // Ignore if guest is not attached
    }
  }

  /**
   * Updates the native guest view bounds to match the React viewport container.
   */
  static async setGuestBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    if (window.electronAPI && window.electronAPI.setGuestBounds) {
      await window.electronAPI.setGuestBounds(bounds);
    }
  }

  /**
   * Loads a URL into the guest view.
   */
  static async loadURL(url: string): Promise<void> {
    if (window.electronAPI && window.electronAPI.loadGuestURL) {
      await window.electronAPI.loadGuestURL(url);
    } else {
      console.warn('electronAPI.loadGuestURL is not available');
    }
  }

  /**
   * Applies live CSS overrides to the currently selected element in guest view.
   */
  static async applyLiveStyle(styles: Record<string, string>): Promise<void> {
    if (window.electronAPI && window.electronAPI.applyLiveStyle) {
      await window.electronAPI.applyLiveStyle(styles);
    }
  }

  /**
   * Selects an element by its ID from the Layers Panel.
   */
  static async selectElementById(domId: string): Promise<void> {
    if (window.electronAPI && window.electronAPI.selectElementById) {
      await window.electronAPI.selectElementById(domId);
    }
  }

  /**
   * Toggles element visibility from the Layers Panel.
   */
  static async toggleElementVisibility(domId: string): Promise<void> {
    if (window.electronAPI && window.electronAPI.toggleElementVisibility) {
      await window.electronAPI.toggleElementVisibility(domId);
    }
  }

  /**
   * Sets Inspect Mode ON/OFF in the guest view.
   */
  static async setInspectMode(active: boolean): Promise<void> {
    if (window.electronAPI && window.electronAPI.setInspectMode) {
      await window.electronAPI.setInspectMode(active);
    }
  }

  /**
   * Updates the live textContent of the currently selected element in guest view.
   */
  static async setTextContent(text: string): Promise<void> {
    if (window.electronAPI && window.electronAPI.setTextContent) {
      await window.electronAPI.setTextContent(text);
    }
  }

  /**
   * Listens for DOM tree updates from the guest website.
   */
  static onDomTree(callback: (tree: any) => void): (() => void) | undefined {
    if (window.electronAPI && window.electronAPI.onDomTree) {
      return window.electronAPI.onDomTree(callback);
    }
  }

  /**
   * Listens for element selection events from the guest website.
   */
  static onElementSelected(callback: (data: any) => void): (() => void) | undefined {
    if (window.electronAPI && window.electronAPI.onElementSelected) {
      return window.electronAPI.onElementSelected(callback);
    }
  }

  /**
   * Listens for text content changes from direct on-screen inline editing.
   */
  static onTextChanged(callback: (data: any) => void): (() => void) | undefined {
    if (window.electronAPI && window.electronAPI.onTextChanged) {
      return window.electronAPI.onTextChanged(callback);
    }
  }
}

// Global declaration for the injected electron API
declare global {
  interface Window {
    electronAPI: {
      saveProject: (projectData: string, filePath?: string) => Promise<any>;
      loadProject: (filePath: string) => Promise<any>;
      cdpSendCommand: (method: string, params?: any) => Promise<any>;
      cdpCaptureScreenshot: () => Promise<any>;
      loadGuestURL: (url: string) => Promise<any>;
      setGuestBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<any>;
      toggleDevTools: () => Promise<any>;
      applyLiveStyle: (styles: Record<string, string>) => Promise<any>;
      selectElementById: (domId: string) => Promise<any>;
      toggleElementVisibility: (domId: string) => Promise<any>;
      setInspectMode: (active: boolean) => Promise<any>;
      setTextContent: (text: string) => Promise<any>;
      onDomTree: (callback: (tree: any) => void) => () => void;
      onElementSelected: (callback: (data: any) => void) => () => void;
      onTextChanged: (callback: (data: any) => void) => () => void;
    };
  }
}
