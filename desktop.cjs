const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');

function openWindow() {
  const window = new BrowserWindow({
    title: 'Rnx CAD',
    width: 1540,
    height: 940,
    minWidth: 830,
    minHeight: 600,
    icon: path.join(__dirname, 'dist', 'favicon.ico'),
    backgroundColor: '#e9eff8',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  openWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
