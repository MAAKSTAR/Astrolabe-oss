const { app, View } = require('electron'); app.whenReady().then(() => { console.log('View:', !!View, View ? Object.getOwnPropertyNames(View.prototype) : 'none'); app.quit(); })
