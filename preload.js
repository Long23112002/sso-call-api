const { contextBridge, ipcRenderer } = require('electron');

// Expose API to renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    callAPI: (params) => ipcRenderer.invoke('api-call', params),

    // SSO functions
    openSSOLogin: (account) => ipcRenderer.invoke('sso-login', account),
    getSSOConfig: () => ipcRenderer.invoke('get-sso-config'),
    updateSSOConfig: (config) => ipcRenderer.invoke('update-sso-config', config),
    getSSOCookies: () => ipcRenderer.invoke('get-sso-cookies'),
    clearSSOSession: () => ipcRenderer.invoke('clear-sso-session'),
    getSSOUserData: () => ipcRenderer.invoke('get-sso-user-data'),

    // Unit selection functions
    fetchUnits: (params) => ipcRenderer.invoke('fetch-units', params),
    setUnitSession: (params) => ipcRenderer.invoke('set-unit-session', params),

    // SSO event listeners
    onSSOSuccess: (callback) => ipcRenderer.on('sso-success', (event, data) => callback(data)),
    onSSOError: (callback) => ipcRenderer.on('sso-error', (event, error) => callback(error)),
    onSSOManualNeeded: (callback) => ipcRenderer.on('sso-manual-needed', (event) => callback()),

    // Clipboard (dùng trên Windows để copy cURL không bị lỗi)
    writeClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),

    // Auto-update: nhận thông báo từ main process
    onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, data) => callback(data)),
    onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, data) => callback(data))
});

