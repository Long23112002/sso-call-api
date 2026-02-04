const { app, BrowserWindow, ipcMain, session, clipboard, dialog } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
let autoUpdater;
if (app.isPackaged) {
    try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { autoUpdater = null; }
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'sso-config.json');

let mainWindow;
let ssoWindow = null;

// Default SSO Configuration
let ssoConfig = {
    loginUrl: 'https://xacthuctaptrung.dcs.vn/sso/login',
    serviceUrl: 'http://103.157.218.21:8099',
    callbackUrl: 'http://103.157.218.21:9080/api/auth/callback',
    appCode: 'ICPV',
    autoRedirectOn403: true,
    selectors: {
        user: '#username',
        pass: '#password',
        submit: 'button[type="submit"]'
    },
    accounts: []
};

// Functions for persistence
function loadSavedConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            const saved = JSON.parse(data);
            ssoConfig = { ...ssoConfig, ...saved };
            console.log('Loaded config from:', CONFIG_PATH);
        }
    } catch (e) {
        console.error('Failed to load config:', e);
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(ssoConfig, null, 2));
        console.log('Saved config to:', CONFIG_PATH);
    } catch (e) {
        console.error('Failed to save config:', e);
    }
}

// Store session cookies after SSO login
let ssoSessionData = {
    cookies: '',
    token: '',
    jsessionId: '',
    callbackCookies: '',
    userData: null  // Store user data including orgId, userId
};

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        icon: path.join(__dirname, 'PDF_file_icon.svg.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        backgroundColor: '#1a202c',
        show: false
    });

    mainWindow.loadFile('app.html');

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Open DevTools in development
    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(() => {
    loadSavedConfig();
    createWindow();
    if (mainWindow && autoUpdater) setupAutoUpdater();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// ==================== Auto Update (chỉ chạy khi app đã build, không chạy trong dev) ====================
function setupAutoUpdater() {
    if (!autoUpdater || !mainWindow) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-available', { version: info.version, releaseNotes: info.releaseNotes });
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-downloaded', { version: info.version });
            dialog.showMessageBox(mainWindow, {
                type: 'info',
                title: 'Cập nhật sẵn sàng',
                message: `Đã tải xong phiên bản ${info.version}. Khởi động lại ứng dụng để cập nhật?`,
                buttons: ['Khởi động lại ngay', 'Để sau']
            }).then(({ response }) => {
                if (response === 0) autoUpdater.quitAndInstall(false, true);
            });
        }
    });

    autoUpdater.on('error', (err) => {
        console.error('Auto-update error:', err);
    });

    // Kiểm tra update sau vài giây khi mở app (tránh block lúc khởi động)
    setTimeout(() => {
        autoUpdater.checkForUpdates().catch((e) => console.error('Check for updates failed:', e));
    }, 5000);
}

// Escape string for safe use inside single-quoted JS string (injected script)
function escapeForJS(str) {
    if (str == null) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// Build SSO login URL
function buildSSOLoginUrl() {
    const encodedService = encodeURIComponent(ssoConfig.serviceUrl);
    return `${ssoConfig.loginUrl}?service=${encodedService}&appCode=${ssoConfig.appCode}`;
}

// Extract ticket from URL
function extractTicketFromUrl(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.searchParams.get('ticket');
    } catch (e) {
        return null;
    }
}

// Call callback API to exchange ticket for session
async function exchangeTicketForSession(ticket) {
    return new Promise((resolve, reject) => {
        const callbackUrl = `${ssoConfig.callbackUrl}?ticket=${ticket}`;
        const urlObj = new URL(callbackUrl);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Origin': ssoConfig.serviceUrl,
                'Referer': ssoConfig.serviceUrl + '/'
            },
            rejectUnauthorized: false
        };

        const req = httpModule.request(options, (res) => {
            let data = '';

            // Extract cookies from response
            const setCookies = res.headers['set-cookie'] || [];

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    cookies: setCookies,
                    data: data
                });
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.end();
    });
}

// Open SSO Login popup window
function openSSOWindow(account = null) {
    return new Promise((resolve, reject) => {
        if (ssoWindow) {
            ssoWindow.focus();
            return resolve({ status: 'window_exists' });
        }

        // Create separate session for SSO
        const ssoSession = session.fromPartition('persist:sso');

        ssoWindow = new BrowserWindow({
            width: 800,
            height: 700,
            parent: mainWindow,
            modal: true,
            show: false,
            closable: true,
            minimizable: false,
            maximizable: false,
            title: 'Đăng nhập SSO - Nhấn X để đóng',
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                session: ssoSession
            }
        });

        const loginUrl = buildSSOLoginUrl();
        console.log('Opening SSO URL:', loginUrl);

        ssoWindow.loadURL(loginUrl);

        // Determine if we should show the window
        const isAutoLogin = account && account.username && account.password;
        let showTimeout = null;

        ssoWindow.once('ready-to-show', () => {
            if (!isAutoLogin) {
                // Manual login - show immediately
                ssoWindow.show();
            } else {
                // Auto login - show after timeout if still open (fallback)
                showTimeout = setTimeout(() => {
                    if (ssoWindow && !ssoWindow.isDestroyed()) {
                        console.log('Background login taking too long - showing window for manual login');
                        ssoWindow.show();
                    }
                }, 18000);
            }

            // Listen for ESC key to close window
            ssoWindow.webContents.on('before-input-event', (event, input) => {
                if (input.key === 'Escape') {
                    ssoWindow.close();
                }
            });
        });

        // Clear timeout when window closes
        ssoWindow.on('close', () => {
            if (showTimeout) clearTimeout(showTimeout);
        });

        // Automation injection (auto-login)
        if (account && account.username && account.password) {
            const safeUser = escapeForJS(account.username);
            const safePass = escapeForJS(account.password);
            const selUser = (ssoConfig.selectors && ssoConfig.selectors.user) ? ssoConfig.selectors.user : '#username';
            const selPass = (ssoConfig.selectors && ssoConfig.selectors.pass) ? ssoConfig.selectors.pass : '#password';
            const selSubmit = (ssoConfig.selectors && ssoConfig.selectors.submit) ? ssoConfig.selectors.submit : 'button[type="submit"]';

            ssoWindow.webContents.on('did-finish-load', () => {
                const url = ssoWindow.webContents.getURL();
                if (!url.includes(ssoConfig.loginUrl)) return;
                console.log('Injecting credentials for account:', account.name);
                // Delay so SPA/form has time to render
                const js = `
                    (function() {
                        const userVal = '${safeUser}';
                        const passVal = '${safePass}';
                        const selUser = ${JSON.stringify(selUser)};
                        const selPass = ${JSON.stringify(selPass)};
                        const selSubmit = ${JSON.stringify(selSubmit)};
                        const userSelectors = [selUser, 'input[name="username"]', 'input[name="user"]', 'input[type="text"]'];
                        const passSelectors = [selPass, 'input[name="password"]', 'input[type="password"]'];
                        let retries = 0;
                        const maxRetries = 40;
                        const startDelay = 1500;
                        setTimeout(function run() {
                            const interval = setInterval(function() {
                                let userField = null, passField = null;
                                for (const s of userSelectors) {
                                    try { userField = document.querySelector(s); if (userField && userField.offsetParent !== null) break; } catch(e) {}
                                }
                                for (const s of passSelectors) {
                                    try { passField = document.querySelector(s); if (passField && passField.offsetParent !== null) break; } catch(e) {}
                                }
                                if (userField && passField) {
                                    clearInterval(interval);
                                    userField.focus();
                                    userField.value = userVal;
                                    userField.dispatchEvent(new Event('input', { bubbles: true }));
                                    userField.dispatchEvent(new Event('change', { bubbles: true }));
                                    passField.value = passVal;
                                    passField.dispatchEvent(new Event('input', { bubbles: true }));
                                    passField.dispatchEvent(new Event('change', { bubbles: true }));
                                    var submitBtn = document.querySelector(selSubmit);
                                    if (!submitBtn) {
                                        var buttons = document.querySelectorAll('button, input[type="submit"], input[type="button"]');
                                        for (var i = 0; i < buttons.length; i++) {
                                            if (buttons[i].textContent.indexOf('Đăng nhập') >= 0 || (buttons[i].value && buttons[i].value.indexOf('Đăng nhập') >= 0)) {
                                                submitBtn = buttons[i]; break;
                                            }
                                        }
                                    }
                                    if (submitBtn) setTimeout(function() { submitBtn.click(); }, 400);
                                }
                                retries++;
                                if (retries >= maxRetries) clearInterval(interval);
                            }, 400);
                        }, startDelay);
                    })();
                `;
                ssoWindow.webContents.executeJavaScript(js).catch(console.error);
            });
        }

        // Monitor URL changes for callback/redirect
        ssoWindow.webContents.on('will-redirect', async (event, url) => {
            console.log('SSO Redirect:', url);

            // Check if redirected to service URL with ticket
            if (url.startsWith(ssoConfig.serviceUrl)) {
                const ticket = extractTicketFromUrl(url);

                if (ticket) {
                    console.log('Got ticket:', ticket);
                    event.preventDefault();

                    try {
                        // Exchange ticket for session
                        const sessionResult = await exchangeTicketForSession(ticket);
                        console.log('Session result:', sessionResult);

                        // Get all cookies from SSO session
                        const cookies = await ssoSession.cookies.get({});
                        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                        // Parse response for token and user data
                        let token = '';
                        let userData = null;
                        try {
                            const responseData = JSON.parse(sessionResult.data);
                            token = responseData.token || responseData.access_token || responseData.data?.token || '';
                            userData = responseData.user || null;
                        } catch (e) {
                            console.log('Response is not JSON or has no token');
                        }

                        // Update session data
                        ssoSessionData = {
                            cookies: cookieString,
                            token: token,
                            jsessionId: cookies.find(c => c.name.includes('JSESSIONID'))?.value || '',
                            callbackCookies: sessionResult.cookies.join('; '),
                            userData: userData
                        };

                        console.log('User data:', userData);

                        // Notify renderer
                        mainWindow.webContents.send('sso-success', ssoSessionData);

                        ssoWindow.close();
                        resolve({ status: 'success', data: ssoSessionData });

                    } catch (error) {
                        console.error('Ticket exchange error:', error);
                        mainWindow.webContents.send('sso-error', { message: error.message });
                        ssoWindow.close();
                        reject(error);
                    }
                }
            }
        });

        // Also check did-navigate for cases where will-redirect doesn't fire
        ssoWindow.webContents.on('did-navigate', async (event, url) => {
            console.log('SSO Navigate:', url);

            if (url.startsWith(ssoConfig.serviceUrl)) {
                const ticket = extractTicketFromUrl(url);

                if (ticket) {
                    console.log('Got ticket from navigate:', ticket);

                    try {
                        const sessionResult = await exchangeTicketForSession(ticket);
                        const ssoSession = session.fromPartition('persist:sso');
                        const cookies = await ssoSession.cookies.get({});
                        const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                        let token = '';
                        let userData = null;
                        try {
                            const responseData = JSON.parse(sessionResult.data);
                            token = responseData.token || responseData.access_token || responseData.data?.token || '';
                            userData = responseData.user || responseData.data?.user || null;
                        } catch (e) { }

                        ssoSessionData = {
                            cookies: cookieString,
                            token: token,
                            jsessionId: cookies.find(c => c.name.includes('JSESSIONID'))?.value || '',
                            callbackCookies: (sessionResult.cookies || []).join('; '),
                            userData: userData
                        };

                        mainWindow.webContents.send('sso-success', ssoSessionData);
                        ssoWindow.close();
                        resolve({ status: 'success', data: ssoSessionData });

                    } catch (error) {
                        mainWindow.webContents.send('sso-error', { message: error.message });
                        ssoWindow.close();
                        reject(error);
                    }
                }
            }
        });

        ssoWindow.on('closed', () => {
            ssoWindow = null;
            reject(new Error('Cửa sổ SSO đã bị đóng bởi người dùng.'));
        });
    });
}

// IPC Handlers
ipcMain.handle('sso-login', async (event, account) => {
    try {
        return await openSSOWindow(account);
    } catch (error) {
        return { status: 'error', message: error.message };
    }
});

ipcMain.handle('get-sso-config', () => {
    return ssoConfig;
});

ipcMain.handle('update-sso-config', (event, newConfig) => {
    ssoConfig = { ...ssoConfig, ...newConfig };
    saveConfig();
    return ssoConfig;
});

ipcMain.handle('get-sso-cookies', () => {
    return ssoSessionData;
});

ipcMain.handle('clear-sso-session', async () => {
    const ssoSession = session.fromPartition('persist:sso');
    await ssoSession.clearStorageData();
    ssoSessionData = { cookies: '', token: '', jsessionId: '', callbackCookies: '' };
    return { status: 'cleared' };
});

// Build multipart/form-data body (renderer gửi parts với contentBase64 cho file)
function buildMultipartBody(boundary, parts) {
    const chunks = [];
    const b = (str) => Buffer.from(str, 'utf8');
    const crlf = '\r\n';
    for (const part of parts) {
        chunks.push(b('--' + boundary + crlf));
        if (part.type === 'file' && part.contentBase64 != null) {
            const filename = part.fileName || 'file';
            chunks.push(b(`Content-Disposition: form-data; name="${part.name}"; filename="${filename}"${crlf}`));
            chunks.push(b('Content-Type: application/octet-stream' + crlf + crlf));
            chunks.push(Buffer.from(part.contentBase64, 'base64'));
        } else {
            const value = (part.type === 'text' && part.value != null) ? String(part.value) : '';
            chunks.push(b(`Content-Disposition: form-data; name="${part.name}"${crlf + crlf}`));
            chunks.push(b(value));
        }
        chunks.push(b(crlf));
    }
    chunks.push(b('--' + boundary + '--' + crlf));
    return Buffer.concat(chunks);
}

// Handle API calls from renderer process
ipcMain.handle('api-call', async (event, { url, method, headers, body }) => {
    return new Promise((resolve, reject) => {
        try {
            const urlObj = new URL(url);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            let bodyToSend = body;
            const finalHeaders = { ...(headers || {}) };
            if (body && typeof body === 'object' && body.type === 'multipart' && body.boundary && body.parts) {
                bodyToSend = buildMultipartBody(body.boundary, body.parts);
                finalHeaders['Content-Type'] = `multipart/form-data; boundary=${body.boundary}`;
                finalHeaders['Content-Length'] = bodyToSend.length;
            }

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method || 'GET',
                headers: finalHeaders,
                rejectUnauthorized: false
            };

            const req = httpModule.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        statusText: res.statusMessage,
                        headers: res.headers,
                        data: data
                    });
                });
            });

            req.on('error', (error) => {
                reject({
                    error: error.message,
                    code: error.code
                });
            });

            if (bodyToSend) {
                req.write(bodyToSend);
            }

            req.end();
        } catch (error) {
            reject({
                error: error.message
            });
        }
    });
});

// Fetch units by orgId
ipcMain.handle('fetch-units', async (event, { orgId, token, cookie }) => {
    return new Promise((resolve, reject) => {
        const url = `http://103.157.218.21:9080/api/v1/accountant/financial/acc-accounting-data/find-unit/${orgId}`;

        console.log('Fetching units for orgId:', orgId);

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
                'Cookie': cookie || '',
                'Origin': 'http://103.157.218.21:8099',
                'Referer': 'http://103.157.218.21:8099/'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log('Units response:', data);
                try {
                    const parsed = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        data: parsed
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            console.error('Fetch units error:', error);
            reject({ error: error.message });
        });

        req.end();
    });
});

// Set session for selected unit (save-session API)
ipcMain.handle('set-unit-session', async (event, { accAccountingDataId, userSessionId, unitId, userId, token, cookie }) => {
    return new Promise((resolve, reject) => {
        const url = 'http://103.157.218.21:9080/api/v1/accountant/financial/acc-accounting-data/save-session';

        const bodyData = JSON.stringify({
            userSessionId: userSessionId,
            accAccountingDataId: accAccountingDataId,
            unitId: unitId,
            userId: userId
        });

        console.log('Saving session:', bodyData);

        const urlObj = new URL(url);
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 80,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
                'Cookie': cookie || '',
                'Origin': 'http://103.157.218.21:8099',
                'Referer': 'http://103.157.218.21:8099/',
                'Content-Length': Buffer.byteLength(bodyData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                console.log('Save session response:', data);
                try {
                    const parsed = JSON.parse(data);
                    resolve({
                        status: res.statusCode,
                        data: parsed
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: data
                    });
                }
            });
        });

        req.on('error', (error) => {
            console.error('Save session error:', error);
            reject({ error: error.message });
        });

        req.write(bodyData);
        req.end();
    });
});

// Get SSO user data
ipcMain.handle('get-sso-user-data', async () => {
    return ssoSessionData.userData;
});

// Copy text to clipboard (ổn định trên Windows hơn navigator.clipboard trong renderer)
ipcMain.handle('copy-to-clipboard', (event, text) => {
    clipboard.writeText(text || '');
});
