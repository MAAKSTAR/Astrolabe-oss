const m = require('module');
const originalRequire = m.prototype.require;
m.prototype.require = function (path) {
  if (path === 'vscode') {
    return {
      window: { createStatusBarItem: () => ({ show: () => {} }) },
      workspace: { getConfiguration: () => ({}), onDidSaveTextDocument: () => {} },
      commands: { registerCommand: () => {} },
      languages: { onDidChangeDiagnostics: () => {} },
      extensions: { getExtension: () => {} }
    };
  }
  return originalRequire.apply(this, arguments);
};
require('/home/maakstar/Downloads/exovonhub/dist/extension.js');
console.log("SUCCESS");
