const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'vscode') return { 
    workspace: { getConfiguration: () => ({ get: () => null }) }, 
    window: { 
      createWebviewPanel: () => ({ webview: { onDidReceiveMessage: () => {}, postMessage: () => {} } }), 
      registerWebviewViewProvider: () => {},
      showErrorMessage: (m) => console.log("VSCODE ERROR:", m) 
    }, 
    commands: { registerCommand: () => {} },
    ExtensionContext: class {},
    Uri: { joinPath: () => ({}), parse: () => ({}) },
    EventEmitter: class { event = {}; fire() {} }
  };
  return originalRequire.apply(this, arguments);
};
try {
  const ext = require('./dist/extension.js');
  if (ext.activate) ext.activate({ extensionUri: {}, extensionPath: '', subscriptions: [] });
} catch (e) {
  console.error(e);
}
