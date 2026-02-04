let currentResponse = null;
let currentBase64 = null;
let requestStartTime = null;
let currentResponseJson = null; // parsed JSON for table view

// SSO State
let ssoLoggedIn = false;
let ssoSessionData = null;
let unitsList = [];
let selectedUnit = null;
let ssoAccounts = [];

// Initialize SSO event listeners
if (window.electronAPI) {
    window.electronAPI.onSSOSuccess((data) => {
        console.log('SSO Success:', data);
        ssoLoggedIn = true;
        ssoSessionData = data;
        updateSSOStatus(true);
        showAlert('Đăng nhập SSO thành công!', 'success');

        // Auto-apply credentials
        applySSOCredentials();

        // Show unit selection and load units
        document.getElementById('unitSelection').style.display = 'block';
        loadUnits();
    });

    window.electronAPI.onSSOError((error) => {
        console.error('SSO Error:', error);
        showAlert('Lỗi đăng nhập SSO: ' + error.message, 'error');
    });

    // Load SSO config on startup
    loadSSOConfig();
}

// Load SSO config from main process
async function loadSSOConfig() {
    try {
        const config = await window.electronAPI.getSSOConfig();
        if (config) {
            document.getElementById('ssoLoginUrl').value = config.loginUrl || '';
            document.getElementById('ssoServiceUrl').value = config.serviceUrl || '';
            document.getElementById('ssoCallbackUrl').value = config.callbackUrl || '';
            document.getElementById('ssoAppCode').value = config.appCode || '';

            // Fill selectors
            if (config.selectors) {
                document.getElementById('selectorUser').value = config.selectors.user || '';
                document.getElementById('selectorPass').value = config.selectors.pass || '';
                document.getElementById('selectorSubmit').value = config.selectors.submit || '';
            }

            // Load accounts
            ssoAccounts = config.accounts || [];
            if (typeof renderAccounts === 'function') renderAccounts();
            if (typeof updateAccountSelect === 'function') updateAccountSelect();
        }
    } catch (e) {
        console.log('Could not load SSO config:', e);
    }
}

// SSO Login trigger
async function triggerSSOLogin() {
    try {
        const accountIdx = document.getElementById('accountSelect').value;
        let account = null;
        const isAutoLogin = accountIdx !== "" && accountIdx !== "none";

        if (isAutoLogin) {
            account = ssoAccounts[parseInt(accountIdx)];
            showLoading(`Đang đăng nhập: ${account.name}...`);
        } else {
            showAlert('Đang mở cửa sổ đăng nhập SSO...', 'info');
        }

        const result = await window.electronAPI.openSSOLogin(account);
        console.log('SSO Login result:', result);

        if (isAutoLogin) {
            hideLoading();
        }
    } catch (error) {
        hideLoading();
        showAlert('Lỗi mở SSO: ' + error.message, 'error');
    }
}

// Loading overlay functions
function showLoading(text = 'Đang xử lý...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingText = overlay.querySelector('.loading-text');
    if (loadingText) loadingText.textContent = text;
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = 'none';
}

// Update SSO status UI
function updateSSOStatus(loggedIn) {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.getElementById('ssoStatusText');
    const ssoInfo = document.getElementById('ssoInfo');

    if (loggedIn) {
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
        statusText.textContent = 'Đã đăng nhập';
        ssoInfo.style.display = 'flex';
    } else {
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
        statusText.textContent = 'Chưa đăng nhập';
        ssoInfo.style.display = 'none';
    }

    // Re-initialize icons
    lucide.createIcons();
}

// Apply SSO credentials to form
function applySSOCredentials() {
    if (ssoSessionData) {
        // Extract JSESSIONID from callback cookies ONLY (this is what the API needs)
        let jsessionId = '';

        if (ssoSessionData.callbackCookies) {
            // Parse callback cookies to get JSESSIONID
            const parts = ssoSessionData.callbackCookies.split(';');
            for (const part of parts) {
                const trimmed = part.trim();
                if (trimmed.startsWith('JSESSIONID=')) {
                    jsessionId = trimmed;
                    break;
                }
            }
        }

        // If no JSESSIONID from callback, try using the jsessionId directly
        if (!jsessionId && ssoSessionData.jsessionId) {
            // This would be from SSO session, but prefer callback
            jsessionId = `JSESSIONID=${ssoSessionData.jsessionId}`;
        }

        document.getElementById('cookie').value = jsessionId;

        // Set token with Bearer prefix if not already present
        if (ssoSessionData.token) {
            const token = ssoSessionData.token;
            document.getElementById('token').value = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
        }

        showAlert('Đã áp dụng Cookie/Token từ SSO!', 'success');
        console.log('Applied cookies:', jsessionId);
        console.log('Applied token:', document.getElementById('token').value);
    } else {
        showAlert('Chưa có dữ liệu SSO. Vui lòng đăng nhập trước.', 'info');
    }
}

// Clear SSO session
async function clearSSOSession() {
    try {
        await window.electronAPI.clearSSOSession();
        ssoLoggedIn = false;
        ssoSessionData = null;
        updateSSOStatus(false);
        document.getElementById('cookie').value = '';
        document.getElementById('token').value = '';

        resetUnitSelection();
        document.getElementById('unitSelection').style.display = 'none';

        showAlert('Đã đăng xuất SSO!', 'info');
    } catch (error) {
        showAlert('Lỗi: ' + error.message, 'error');
    }
}

// Reset CSDL / unit selection (khi đổi tài khoản hoặc đăng xuất)
function resetUnitSelection() {
    unitsList = [];
    selectedUnit = null;
    const unitSelection = document.getElementById('unitSelection');
    const unitSelect = document.getElementById('unitSelect');
    const selectedUnitInfo = document.getElementById('selectedUnitInfo');
    if (unitSelect) unitSelect.innerHTML = '<option value="">-- Chọn dữ liệu --</option>';
    if (selectedUnitInfo) selectedUnitInfo.style.display = 'none';
}

// Load units after SSO login
async function loadUnits() {
    if (!ssoSessionData || !ssoSessionData.userData) {
        showAlert('Chưa có thông tin người dùng. Vui lòng đăng nhập lại.', 'error');
        return;
    }

    const userData = ssoSessionData.userData;
    const orgId = userData.org?.id;

    if (!orgId) {
        showAlert('Không tìm thấy mã đơn vị từ thông tin đăng nhập.', 'error');
        return;
    }

    // Get credentials
    let jsessionId = '';
    if (ssoSessionData.callbackCookies) {
        const parts = ssoSessionData.callbackCookies.split(';');
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('JSESSIONID=')) {
                jsessionId = trimmed;
                break;
            }
        }
    }

    const token = ssoSessionData.token || '';

    try {
        showAlert('Đang tải danh sách đơn vị...', 'info');

        const result = await window.electronAPI.fetchUnits({
            orgId: orgId,
            token: token,
            cookie: jsessionId
        });

        console.log('Units result:', result);

        if (result.status === 200 && result.data) {
            // Parse units from response
            let units = [];
            if (Array.isArray(result.data)) {
                units = result.data;
            } else if (result.data.data && Array.isArray(result.data.data)) {
                units = result.data.data;
            } else if (result.data.content && Array.isArray(result.data.content)) {
                units = result.data.content;
            }

            unitsList = units;

            // Populate select dropdown
            const select = document.getElementById('unitSelect');
            select.innerHTML = '<option value="">-- Chọn dữ liệu --</option>';

            units.forEach(unit => {
                const option = document.createElement('option');
                option.value = unit.accAccountingDataId || unit.id;
                const name = unit.dataName || unit.orgName || 'N/A';
                option.textContent = `${name} (${unit.accAccountingDataId || unit.id})`;
                select.appendChild(option);
            });

            showAlert(`Đã tải ${units.length} đơn vị!`, 'success');
            lucide.createIcons();
        } else {
            showAlert('Không thể tải danh sách đơn vị. Status: ' + result.status, 'error');
        }
    } catch (error) {
        console.error('Load units error:', error);
        showAlert('Lỗi tải đơn vị: ' + (error.error || error.message), 'error');
    }
}

// Handle unit selection
async function onUnitSelect() {
    const select = document.getElementById('unitSelect');
    const selectedAccDataId = select.value;

    if (!selectedAccDataId) {
        document.getElementById('selectedUnitInfo').style.display = 'none';
        return;
    }

    // Find selected unit by accAccountingDataId
    selectedUnit = unitsList.find(u => u.accAccountingDataId === selectedAccDataId);

    if (!selectedUnit) {
        console.log('Unit not found for:', selectedAccDataId);
        return;
    }

    // Get credentials
    let jsessionId = '';
    if (ssoSessionData.callbackCookies) {
        const parts = ssoSessionData.callbackCookies.split(';');
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.startsWith('JSESSIONID=')) {
                jsessionId = trimmed;
                break;
            }
        }
    }

    const token = ssoSessionData.token || '';
    const userId = ssoSessionData.userData?.id || '';
    const unitId = selectedUnit.unitId || selectedUnit.unitViettelId || ssoSessionData.userData?.org?.id || '';

    // Get accAccountingDataId and userSessionId from selected unit
    const accAccountingDataId = selectedUnit.accAccountingDataId;
    const userSessionId = selectedUnit.userSessionData?.userSessionId || selectedUnit.userSessionId || '';

    try {
        showAlert('Đang thiết lập CSDL...', 'info');

        const result = await window.electronAPI.setUnitSession({
            accAccountingDataId: accAccountingDataId,
            userSessionId: userSessionId,
            unitId: unitId,
            userId: userId,
            token: token,
            cookie: jsessionId
        });

        console.log('Set session result:', result);

        if (result.status === 200) {
            // Update displayed unit info - show both dataName and accAccountingDataId
            const unitName = selectedUnit.dataName || selectedUnit.orgName || selectedUnit.name;
            const unitId = selectedUnit.accAccountingDataId;
            document.getElementById('selectedUnitName').textContent = unitName;
            document.getElementById('selectedUnitId').textContent = unitId;
            document.getElementById('selectedUnitInfo').style.display = 'flex';

            showAlert(`Đã chọn CSDL: ${unitName}`, 'success');
            lucide.createIcons();
        } else {
            showAlert('Lỗi thiết lập CSDL. Status: ' + result.status, 'error');
        }
    } catch (error) {
        console.error('Set unit session error:', error);
        showAlert('Lỗi: ' + (error.error || error.message), 'error');
    }
}

// Copy unit name to clipboard
function copyUnitName() {
    const name = document.getElementById('selectedUnitName').textContent;
    navigator.clipboard.writeText(name).then(() => {
        showAlert(`Đã copy tên: ${name}`, 'success');
    }).catch(err => {
        showAlert('Không thể copy: ' + err, 'error');
    });
}

// Copy unit ID to clipboard
function copyUnitId() {
    const id = document.getElementById('selectedUnitId').textContent;
    navigator.clipboard.writeText(id).then(() => {
        showAlert(`Đã copy ID: ${id}`, 'success');
    }).catch(err => {
        showAlert('Không thể copy: ' + err, 'error');
    });
}

// Open SSO config modal
async function openSSOConfigModal() {
    const modal = document.getElementById('ssoConfigModal');
    modal.style.display = 'flex';

    // Load current config
    try {
        const config = await window.electronAPI.getSSOConfig();
        if (config) {
            document.getElementById('ssoLoginUrl').value = config.loginUrl || '';
            document.getElementById('ssoServiceUrl').value = config.serviceUrl || '';
            document.getElementById('ssoCallbackUrl').value = config.callbackUrl || '';
            document.getElementById('ssoAppCode').value = config.appCode || '';
        }
    } catch (e) {
        console.log('Could not load SSO config');
    }

    lucide.createIcons();
}

// Close SSO config modal
function closeSSOConfigModal() {
    document.getElementById('ssoConfigModal').style.display = 'none';
}

// Save SSO config
async function saveSSOConfig() {
    const config = {
        loginUrl: document.getElementById('ssoLoginUrl').value.trim(),
        serviceUrl: document.getElementById('ssoServiceUrl').value.trim(),
        callbackUrl: document.getElementById('ssoCallbackUrl').value.trim(),
        appCode: document.getElementById('ssoAppCode').value.trim(),
        selectors: {
            user: document.getElementById('selectorUser').value.trim(),
            pass: document.getElementById('selectorPass').value.trim(),
            submit: document.getElementById('selectorSubmit').value.trim()
        },
        accounts: ssoAccounts
    };

    try {
        await window.electronAPI.updateSSOConfig(config);
        showAlert('Đã lưu cấu hình SSO!', 'success');
        updateAccountSelect();
        closeSSOConfigModal();
    } catch (error) {
        showAlert('Lỗi lưu cấu hình: ' + error.message, 'error');
    }
}

// Account Management logic
function addNewAccount() {
    const name = document.getElementById('newAccountName').value.trim();
    const username = document.getElementById('newAccountUser').value.trim();
    const password = document.getElementById('newAccountPass').value.trim();

    if (!name || !username || !password) {
        showAlert('Vui lòng nhập đầy đủ thông tin tài khoản!', 'error');
        return;
    }

    ssoAccounts.push({ name, username, password });

    // Clear inputs
    document.getElementById('newAccountName').value = '';
    document.getElementById('newAccountUser').value = '';
    document.getElementById('newAccountPass').value = '';

    renderAccounts();
    updateAccountSelect();

    // Auto-save
    saveSSOWithoutClosing();
    showAlert('Đã thêm tài khoản mới!', 'success');
}

function deleteAccount(index) {
    ssoAccounts.splice(index, 1);
    renderAccounts();
    updateAccountSelect();

    // Auto-save
    saveSSOWithoutClosing();
}

// Internal helper to save without closing modal
async function saveSSOWithoutClosing() {
    const config = {
        loginUrl: document.getElementById('ssoLoginUrl').value.trim(),
        serviceUrl: document.getElementById('ssoServiceUrl').value.trim(),
        callbackUrl: document.getElementById('ssoCallbackUrl').value.trim(),
        appCode: document.getElementById('ssoAppCode').value.trim(),
        selectors: {
            user: document.getElementById('selectorUser').value.trim(),
            pass: document.getElementById('selectorPass').value.trim(),
            submit: document.getElementById('selectorSubmit').value.trim()
        },
        accounts: ssoAccounts
    };

    try {
        await window.electronAPI.updateSSOConfig(config);
    } catch (error) {
        console.error('Failed to auto-save config:', error);
    }
}

function renderAccounts() {
    const list = document.getElementById('accountList');
    if (ssoAccounts.length === 0) {
        list.innerHTML = '<div class="empty-hint" style="text-align: center; padding: 10px;">Chưa có tài khoản nào</div>';
        return;
    }

    list.innerHTML = ssoAccounts.map((acc, index) => `
        <div class="account-item">
            <div class="account-item-info">
                <span class="account-item-name">${acc.name}</span>
                <span class="account-item-user">${acc.username}</span>
            </div>
            <i data-lucide="trash-2" class="btn-delete-acc" onclick="deleteAccount(${index})" style="width: 16px; height: 16px;"></i>
        </div>
    `).join('');

    lucide.createIcons();
}

function updateAccountSelect() {
    const select = document.getElementById('accountSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">-- Chọn tài khoản --</option><option value="none">Login thủ công</option>';

    ssoAccounts.forEach((acc, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = acc.name;
        select.appendChild(option);
    });

    select.value = currentValue;
}

// Khi đổi tài khoản thì reset CSDL (danh sách đơn vị cũ không còn đúng)
(function initAccountSelectChange() {
    const el = document.getElementById('accountSelect');
    if (el) el.addEventListener('change', () => resetUnitSelection());
})();

// Check if should auto-redirect on 403
function shouldAutoRedirectOn403() {
    const checkbox = document.getElementById('autoRedirect403');
    return checkbox && checkbox.checked;
}

// Handle 403 response - auto redirect to SSO
async function handle403Response() {
    if (shouldAutoRedirectOn403() && !ssoLoggedIn) {
        showAlert('Lỗi 403 - Đang chuyển đến trang đăng nhập SSO...', 'info');
        setTimeout(() => {
            triggerSSOLogin();
        }, 1000);
        return true;
    }
    return false;
}

// Switch between tabs
function switchTab(tabName) {
    // Remove active class from all tabs and panes
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));

    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const pane = document.getElementById(tabName + 'Pane');
    if (btn) btn.classList.add('active');
    if (pane) pane.classList.add('active');
    // Áp dụng lại tìm kiếm cho tab mới nếu đang mở find bar
    const findBar = document.getElementById('findBar');
    const findInput = document.getElementById('findInput');
    if (findBar && findBar.style.display === 'flex' && findInput && findInput.value.trim()) {
        setTimeout(runSearch, 50);
    }
}

// Show alert message
// Show alert message
function showAlert(message, type = 'info') {
    const alertContainer = document.getElementById('alertContainer');
    const alertId = 'alert-' + Date.now();

    const alertDiv = document.createElement('div');
    alertDiv.id = alertId;
    alertDiv.className = `alert alert-${type}`;
    alertDiv.innerHTML = `<span>${message}</span>`;

    alertContainer.appendChild(alertDiv);

    // Auto remove after 5s
    setTimeout(() => {
        const el = document.getElementById(alertId);
        if (el) {
            el.style.opacity = '0';
            el.style.transform = 'translateX(20px)';
            setTimeout(() => el.remove(), 300);
        }
    }, 4000);
}

// Query Params: thêm / xóa dòng key-value
function addParamRow() {
    const list = document.getElementById('queryParamsList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = `
        <input type="text" class="input-field param-key" placeholder="Key">
        <input type="text" class="input-field param-value" placeholder="Value">
        <button type="button" class="btn btn-icon-sm param-remove" onclick="removeParamRow(this)" title="Xóa">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
    `;
    list.appendChild(row);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function removeParamRow(btn) {
    const row = btn.closest('.param-row');
    if (row) row.remove();
}

function clearQueryParams() {
    const list = document.getElementById('queryParamsList');
    if (!list) return;
    list.innerHTML = `
        <div class="param-row">
            <input type="text" class="input-field param-key" placeholder="Key">
            <input type="text" class="input-field param-value" placeholder="Value">
            <button type="button" class="btn btn-icon-sm param-remove" onclick="removeParamRow(this)" title="Xóa">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Gán URL và tách query string vào danh sách params (dùng khi paste URL hoặc import cURL)
function setUrlAndParams(fullUrl) {
    if (!fullUrl || !fullUrl.trim()) return;
    const urlStr = fullUrl.trim();
    const apiUrlEl = document.getElementById('apiUrl');
    const list = document.getElementById('queryParamsList');
    if (!apiUrlEl || !list) return;

    let baseUrl = urlStr;
    const params = [];

    try {
        const u = new URL(urlStr);
        baseUrl = u.origin + u.pathname;
        apiUrlEl.value = baseUrl;
        u.searchParams.forEach((value, key) => {
            params.push({ key, value });
        });
    } catch (e) {
        const qIndex = urlStr.indexOf('?');
        if (qIndex >= 0) {
            baseUrl = urlStr.slice(0, qIndex);
            apiUrlEl.value = baseUrl;
            const search = urlStr.slice(qIndex + 1);
            search.split('&').forEach(pair => {
                const eq = pair.indexOf('=');
                if (eq >= 0) {
                    params.push({
                        key: decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' ')),
                        value: decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '))
                    });
                }
            });
        } else {
            apiUrlEl.value = urlStr;
        }
    }

    clearQueryParams();
    if (params.length > 0) {
        list.innerHTML = '';
        params.forEach(({ key, value }) => {
            const row = document.createElement('div');
            row.className = 'param-row';
            row.innerHTML = `
                <input type="text" class="input-field param-key" placeholder="Key">
                <input type="text" class="input-field param-value" placeholder="Value">
                <button type="button" class="btn btn-icon-sm param-remove" onclick="removeParamRow(this)" title="Xóa">
                    <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
                </button>
            `;
            row.querySelector('.param-key').value = key;
            row.querySelector('.param-value').value = value;
            list.appendChild(row);
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

// Build URL gộp endpoint + query params từ danh sách key-value
function buildRequestUrl() {
    let urlStr = document.getElementById('apiUrl').value.trim();
    if (!urlStr) return '';
    const list = document.getElementById('queryParamsList');
    const params = new URLSearchParams();
    if (list) {
        list.querySelectorAll('.param-row').forEach(row => {
            const keyInput = row.querySelector('.param-key');
            const valueInput = row.querySelector('.param-value');
            const key = keyInput ? keyInput.value.trim() : '';
            const value = valueInput ? valueInput.value.trim() : '';
            if (key) params.set(key, value);
        });
    }
    try {
        const url = new URL(urlStr);
        params.forEach((value, key) => url.searchParams.set(key, value));
        return url.toString();
    } catch (e) {
        return urlStr;
    }
}

// Clear form
function clearForm() {
    document.getElementById('apiUrl').value = '';
    clearQueryParams();
    document.getElementById('method').value = 'GET';
    document.getElementById('cookie').value = '';
    document.getElementById('token').value = '';
    document.getElementById('customHeaders').value = '';
    setRequestBodyValue('');
    document.querySelector('input[name="bodyType"][value="json"]').checked = true;
    showBodyPanel();
    clearFormDataList();

    // Clear response
    currentResponse = null;
    currentBase64 = null;
    currentResponseJson = null;
    fillTableArraySelect(null);
    document.getElementById('tabContainer').style.display = 'none';
    const findBar = document.getElementById('findBar');
    if (findBar) findBar.style.display = 'none';
    document.getElementById('responseInfo').style.display = 'none';
    document.getElementById('statusBadge').style.display = 'none';
    const previewContent = document.getElementById('previewContent');
    if (previewContent) {
        previewContent.innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">📭</div>
            <p>Chưa có dữ liệu</p>
            <p class="empty-hint">Gửi request để xem response</p>
        </div>
    `;
    }

    showAlert('Đã xóa form', 'info');
}

// Build headers from form inputs
function buildHeaders() {
    const headers = {};

    // Add cookie if provided
    const cookie = document.getElementById('cookie').value.trim();
    if (cookie) {
        headers['Cookie'] = cookie;
    }

    // Add token if provided
    const token = document.getElementById('token').value.trim();
    if (token) {
        headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }

    // Add custom headers if provided
    const customHeaders = document.getElementById('customHeaders').value.trim();
    if (customHeaders) {
        try {
            const parsed = JSON.parse(customHeaders);
            Object.assign(headers, parsed);
        } catch (e) {
            showAlert('Custom headers phải là JSON hợp lệ!', 'error');
            return null;
        }
    }

    return headers;
}

// Send API request
async function sendRequest() {
    const url = buildRequestUrl();
    const method = document.getElementById('method').value;

    if (!url) {
        showAlert('Vui lòng nhập URL!', 'error');
        return;
    }

    try {
        new URL(url);
    } catch (e) {
        showAlert('URL không hợp lệ!', 'error');
        return;
    }

    // Build headers
    const headers = buildHeaders();
    if (headers === null) return;

    let body = null;
    const bodyType = getBodyType();
    if (method !== 'GET') {
        if (bodyType === 'formData') {
            const parts = await getFormDataParts();
            if (parts.length > 0) {
                const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
                body = { type: 'multipart', boundary, parts };
                delete headers['Content-Type'];
                delete headers['content-type'];
            }
        } else {
            const requestBody = getRequestBodyValue().trim();
            if (requestBody) {
                try {
                    const parsed = parseJSONAllowComments(requestBody);
                    body = JSON.stringify(parsed);
                    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
                } catch (e) {
                    showAlert('Request body phải là JSON hợp lệ! ' + (e.message || ''), 'error');
                    return;
                }
            }
        }
    }

    // Show loading
    document.getElementById('loadingContainer').style.display = 'block';
    document.getElementById('tabContainer').style.display = 'none';
    document.getElementById('alertContainer').innerHTML = '';

    requestStartTime = Date.now();

    try {
        // Call API via Electron
        const response = await window.electronAPI.callAPI({
            url,
            method,
            headers,
            body
        });

        const responseTime = Date.now() - requestStartTime;

        // Store response
        currentResponse = response;

        // Update status badge
        const statusBadge = document.getElementById('statusBadge');
        if (response.status >= 200 && response.status < 300) {
            statusBadge.className = 'status-badge success';
            statusBadge.textContent = `${response.status}`;
        } else {
            statusBadge.className = 'status-badge error';
            statusBadge.textContent = `${response.status}`;
        }

        // Show tabs
        document.getElementById('tabContainer').style.display = 'flex';
        document.getElementById('loadingContainer').style.display = 'none';

        // Process response
        displayResponse(response);

        // Handle 403 - Auto redirect to SSO
        if (response.status === 403) {
            const handled = await handle403Response();
            if (handled) {
                showAlert(`Lỗi 403 Forbidden - Đang chuyển đến SSO... (${responseTime}ms)`, 'error');
            } else {
                showAlert(`Lỗi 403 Forbidden - Cần đăng nhập SSO! (${responseTime}ms)`, 'error');
            }
        } else if (response.status === 401) {
            // Also handle 401 Unauthorized
            const handled = await handle403Response();
            if (handled) {
                showAlert(`Lỗi 401 Unauthorized - Đang chuyển đến SSO... (${responseTime}ms)`, 'error');
            } else {
                showAlert(`Lỗi 401 Unauthorized! (${responseTime}ms)`, 'error');
            }
        } else {
            showAlert(`Request thành công! (${responseTime}ms)`, 'success');
        }

    } catch (error) {
        document.getElementById('loadingContainer').style.display = 'none';
        showAlert(`Lỗi: ${error.error || error.message || 'Unknown error'}`, 'error');
        console.error('Request error:', error);
    }
}

// Display response data
function displayResponse(response) {
    const statusBadge = document.getElementById('statusBadge');
    if (statusBadge) {
        statusBadge.textContent = `${response.status}`;
        statusBadge.className = 'status-badge';
        if (response.status >= 200 && response.status < 300) {
            statusBadge.classList.add('success');
        } else if (response.status >= 400) {
            statusBadge.classList.add('error');
        }
    }

    const rawDataEl = document.getElementById('rawData');
    if (rawDataEl) {
        try {
            const json = JSON.parse(response.data);
            rawDataEl.textContent = JSON.stringify(json, null, 2);
        } catch (e) {
            rawDataEl.textContent = response.data;
        }
    }

    const headersDataEl = document.getElementById('headersData');
    if (headersDataEl) {
        headersDataEl.textContent = JSON.stringify(response.headers, null, 2);
    }

    previewResponse(response.data);

    // Populate table tab: tìm các mảng trong JSON để chọn xem dạng bảng
    try {
        currentResponseJson = JSON.parse(response.data);
        fillTableArraySelect(currentResponseJson);
    } catch (e) {
        currentResponseJson = null;
        fillTableArraySelect(null);
    }

    const tabContainer = document.getElementById('tabContainer');
    if (tabContainer) tabContainer.style.display = 'flex';
    const findBar = document.getElementById('findBar');
    if (findBar) findBar.style.display = 'flex';
}

// Preview response based on content type
function previewResponse(data) {
    const previewContent = document.getElementById('previewContent');
    if (!previewContent) return;

    // Try to parse as JSON
    try {
        const json = JSON.parse(data);

        // Check if response contains base64 data
        const base64Data = extractBase64FromJSON(json);

        if (base64Data) {
            currentBase64 = base64Data;
            previewBase64(base64Data);
        } else {
            // Display JSON tree (đóng/mở được)
            previewContent.innerHTML = '<div class="json-tree-root" id="jsonTreeRoot">' + buildJsonTreeHtml(json) + '</div>';
            initJsonTreeToggles();
        }
    } catch (e) {
        // Not JSON, check if it's base64
        if (isBase64(data)) {
            currentBase64 = data;
            previewBase64(data);
        } else {
            // Display as plain text
            previewContent.innerHTML = `<pre class="code-block">${escapeHtml(data)}</pre>`;
        }
    }
}

// Extract base64 from JSON response
function extractBase64FromJSON(json) {
    // Common paths for base64 data
    const paths = [
        'data.pdfSrc',
        'data.base64',
        'data.content',
        'pdfSrc',
        'base64',
        'content',
        'data',
        'file',
        'document'
    ];

    for (const path of paths) {
        const value = getNestedValue(json, path);
        if (value && typeof value === 'string' && isBase64(value)) {
            return value;
        }
    }

    return null;
}

// Get nested value from object
function getNestedValue(obj, path) {
    return path.split('.').reduce((current, prop) => current?.[prop], obj);
}

// Collect paths to arrays of objects in JSON (for table view)
function collectArrayPaths(obj, prefix = '') {
    const paths = [];
    if (obj == null) return paths;
    if (Array.isArray(obj) && obj.length > 0) {
        const first = obj[0];
        if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
            paths.push(prefix || 'root');
        }
        return paths;
    }
    if (typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [key, value] of Object.entries(obj)) {
            const p = prefix ? `${prefix}.${key}` : key;
            if (Array.isArray(value) && value.length > 0) {
                const first = value[0];
                if (typeof first === 'object' && first !== null && !Array.isArray(first)) {
                    paths.push(p);
                }
            } else {
                paths.push(...collectArrayPaths(value, p));
            }
        }
    }
    return paths;
}

// Fill dropdown "Chọn mảng" với các path tìm được
function fillTableArraySelect(json) {
    const select = document.getElementById('tableArraySelect');
    const emptyEl = document.getElementById('tableViewEmpty');
    const tableWrap = document.getElementById('tableViewTableWrap');
    if (!select) return;
    select.innerHTML = '<option value="">-- Chọn mảng (array) --</option>';
    if (tableWrap) tableWrap.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    if (!json || typeof json !== 'object') return;
    const paths = collectArrayPaths(json);
    paths.forEach(path => {
        const opt = document.createElement('option');
        opt.value = path;
        const arr = getNestedValue(json, path);
        const len = Array.isArray(arr) ? arr.length : 0;
        opt.textContent = `${path} (${len} dòng)`;
        select.appendChild(opt);
    });
    if (paths.length > 0) {
        select.value = paths[0];
        renderTableFromSelectedPath();
    }
    if (paths.length > 0 && typeof lucide !== 'undefined') lucide.createIcons();
}

// Chọn cột hiển thị trong bảng: null = tất cả, Set = chỉ các cột được tích
let tableVisibleColumns = null;
let currentTableColumns = [];
let currentTablePath = '';

function toggleTableColumnPicker() {
    const picker = document.getElementById('tableColumnPicker');
    const btn = document.getElementById('tableColumnPickerBtn');
    if (!picker || !btn) return;
    const isShow = picker.style.display !== 'none';
    if (isShow) {
        picker.style.display = 'none';
        picker.classList.remove('table-column-picker-fixed');
        return;
    }
    const list = document.getElementById('tableColumnPickerList');
    list.innerHTML = '';
    currentTableColumns.forEach(col => {
        const checked = tableVisibleColumns == null || tableVisibleColumns.has(col);
        const label = document.createElement('label');
        label.innerHTML = `<input type="checkbox" data-col="${escapeHtml(col)}" ${checked ? 'checked' : ''}> ${escapeHtml(col)}`;
        label.querySelector('input').addEventListener('change', onTableColumnCheckChange);
        list.appendChild(label);
    });
    const rect = btn.getBoundingClientRect();
    picker.classList.add('table-column-picker-fixed');
    picker.style.top = `${rect.bottom + 6}px`;
    picker.style.left = `${Math.max(8, rect.right - 320)}px`;
    picker.style.minWidth = '200px';
    picker.style.display = 'block';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function onTableColumnCheckChange() {
    const list = document.getElementById('tableColumnPickerList');
    if (!list) return;
    const checked = new Set();
    list.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        checked.add(cb.dataset.col);
    });
    tableVisibleColumns = checked.size === currentTableColumns.length ? null : checked;
    renderTableFromSelectedPath();
}

function tableColumnSelectAll() {
    tableVisibleColumns = null;
    const list = document.getElementById('tableColumnPickerList');
    if (list) list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = true; });
    renderTableFromSelectedPath();
}

function tableColumnDeselectAll() {
    tableVisibleColumns = new Set();
    const list = document.getElementById('tableColumnPickerList');
    if (list) list.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    renderTableFromSelectedPath();
}

// Đóng picker khi click ra ngoài
document.addEventListener('click', (e) => {
    const picker = document.getElementById('tableColumnPicker');
    const btn = document.getElementById('tableColumnPickerBtn');
    if (picker && picker.style.display !== 'none' && !picker.contains(e.target) && !(btn && btn.contains(e.target))) {
        picker.style.display = 'none';
        picker.classList.remove('table-column-picker-fixed');
    }
});

// Render mảng đã chọn thành bảng HTML
function renderTableFromSelectedPath() {
    const select = document.getElementById('tableArraySelect');
    const tableWrap = document.getElementById('tableViewTableWrap');
    const emptyEl = document.getElementById('tableViewEmpty');
    const columnPickerBtn = document.getElementById('tableColumnPickerBtn');
    if (!select || !tableWrap || !emptyEl) return;
    const path = select.value;
    if (!path || !currentResponseJson) {
        tableWrap.style.display = 'none';
        emptyEl.style.display = 'block';
        tableWrap.innerHTML = '';
        if (columnPickerBtn) columnPickerBtn.style.display = 'none';
        tableVisibleColumns = null;
        currentTableColumns = [];
        currentTablePath = '';
        return;
    }
    const arr = getNestedValue(currentResponseJson, path);
    if (!Array.isArray(arr) || arr.length === 0) {
        tableWrap.style.display = 'none';
        emptyEl.style.display = 'block';
        tableWrap.innerHTML = '';
        if (columnPickerBtn) columnPickerBtn.style.display = 'none';
        currentTableColumns = [];
        return;
    }
    if (path !== currentTablePath) {
        currentTablePath = path;
        tableVisibleColumns = null;
    }
    const keys = new Set();
    arr.forEach(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            Object.keys(item).forEach(k => keys.add(k));
        }
    });
    currentTableColumns = Array.from(keys);
    let colsToShow;
    if (tableVisibleColumns === null) {
        colsToShow = currentTableColumns;
    } else if (tableVisibleColumns.size === 0) {
        colsToShow = [];
    } else {
        colsToShow = currentTableColumns.filter(c => tableVisibleColumns.has(c));
    }
    emptyEl.style.display = 'none';
    tableWrap.style.display = 'block';
    tableWrap.innerHTML = renderArrayAsTable(arr, colsToShow);
    if (columnPickerBtn) columnPickerBtn.style.display = currentTableColumns.length > 0 ? 'inline-flex' : 'none';
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Tạo HTML bảng từ mảng đối tượng (visibleCols = mảng cột cần hiển thị, null/undefined = tất cả, [] = không cột nào)
function renderArrayAsTable(arr, visibleCols) {
    const keys = new Set();
    arr.forEach(item => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            Object.keys(item).forEach(k => keys.add(k));
        }
    });
    const cols = (visibleCols == null) ? Array.from(keys) : visibleCols;
    if (cols.length === 0) return '<p class="empty-hint">Không chọn cột nào. Dùng "Chọn tất cả" để hiển thị lại.</p>';
    let html = '<div class="table-view-scroll"><table class="response-table"><colgroup>';
    cols.forEach(() => { html += '<col>'; });
    html += '</colgroup><thead><tr>';
    cols.forEach(k => {
        html += `<th>${escapeHtml(String(k))}</th>`;
    });
    html += '</tr></thead><tbody>';
    arr.forEach(row => {
        if (row && typeof row === 'object' && !Array.isArray(row)) {
            html += '<tr>';
            cols.forEach(col => {
                const val = row[col];
                const str = val === null || val === undefined ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
                html += `<td>${escapeHtml(str)}</td>`;
            });
            html += '</tr>';
        }
    });
    html += '</tbody></table></div>';
    return html;
}

// Check if string is base64
function isBase64(str) {
    if (!str || typeof str !== 'string') return false;

    // Base64 strings are typically long and contain valid base64 characters
    if (str.length < 50) return false;

    const base64Regex = /^[A-Za-z0-9+/]+={0,2}$/;
    return base64Regex.test(str);
}

// Preview base64 data
function previewBase64(base64String) {
    const previewContent = document.getElementById('previewContent');

    try {
        // Try to detect file type from base64 header
        const fileType = detectFileType(base64String);

        if (fileType === 'pdf') {
            // Preview PDF
            const blob = base64ToBlob(base64String, 'application/pdf');
            const url = URL.createObjectURL(blob);
            previewContent.innerHTML = `
                <iframe src="${url}" class="pdf-viewer" title="PDF Preview" id="pdfFrame"></iframe>
            `;

            // Add fullscreen functionality
            const pdfFrame = document.getElementById('pdfFrame');
            pdfFrame.style.cursor = 'pointer';
            pdfFrame.addEventListener('click', toggleFullscreen);

        } else if (fileType.startsWith('image/')) {
            // Preview image
            previewContent.innerHTML = `
                <img src="data:${fileType};base64,${base64String}" class="image-preview" alt="Image Preview" onclick="toggleFullscreen(event)">
            `;
        } else {
            // Unknown type, show download option
            previewContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📄</div>
                    <p>Phát hiện dữ liệu Base64</p>
                    <p class="empty-hint">Sử dụng nút "Tải xuống" để lưu file</p>
                </div>
            `;
        }
    } catch (error) {
        console.error('Preview error:', error);
        previewContent.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <p>Không thể preview</p>
                <p class="empty-hint">${error.message}</p>
            </div>
        `;
    }
}

// Toggle fullscreen for PDF/Image
function toggleFullscreen(event) {
    const element = event.target;

    if (!document.fullscreenElement) {
        // Enter fullscreen
        if (element.requestFullscreen) {
            element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
        } else if (element.mozRequestFullScreen) {
            element.mozRequestFullScreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        }

        // Show hint
        showAlert('Đang xem toàn màn hình. Nhấn ESC để thoát.', 'info');
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
        }
    }
}

// Detect file type from base64
function detectFileType(base64String) {
    const signatures = {
        'JVBERi0': 'pdf',
        'iVBORw0KGgo': 'image/png',
        '/9j/': 'image/jpeg',
        'R0lGOD': 'image/gif',
        'UklGR': 'image/webp'
    };

    for (const [signature, type] of Object.entries(signatures)) {
        if (base64String.startsWith(signature)) {
            return type;
        }
    }

    return 'application/octet-stream';
}

// Convert base64 to blob
function base64ToBlob(base64, mimeType) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return new Blob([bytes], { type: mimeType });
}

// Download preview
function downloadPreview() {
    if (!currentBase64) {
        showAlert('Không có dữ liệu base64 để tải xuống!', 'error');
        return;
    }

    try {
        const fileType = detectFileType(currentBase64);
        const extension = fileType === 'pdf' ? 'pdf' :
            fileType.startsWith('image/') ? fileType.split('/')[1] : 'bin';
        const mimeType = fileType === 'pdf' ? 'application/pdf' : fileType;

        const blob = base64ToBlob(currentBase64, mimeType);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `download_${Date.now()}.${extension}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showAlert('Đã tải xuống file!', 'success');
    } catch (error) {
        showAlert('Lỗi khi tải xuống: ' + error.message, 'error');
    }
}

// Copy base64 to clipboard
function copyToClipboard() {
    if (!currentBase64) {
        showAlert('Không có dữ liệu base64 để copy!', 'error');
        return;
    }

    navigator.clipboard.writeText(currentBase64).then(() => {
        showAlert('Đã copy base64 vào clipboard!', 'success');
    }).catch(error => {
        showAlert('Lỗi khi copy: ' + error.message, 'error');
    });
}

// JSON tree đóng/mở (Preview)
function buildJsonTreeHtml(value, keyLabel) {
    const keyPart = keyLabel != null ? `<span class="json-tree-key">${escapeHtml(String(keyLabel))}</span>: ` : '';
    if (value === null) {
        return `<div class="json-tree-line">${keyPart}<span class="json-tree-null">null</span></div>`;
    }
    if (typeof value === 'boolean') {
        return `<div class="json-tree-line">${keyPart}<span class="json-tree-bool">${value}</span></div>`;
    }
    if (typeof value === 'number') {
        return `<div class="json-tree-line">${keyPart}<span class="json-tree-num">${value}</span></div>`;
    }
    if (typeof value === 'string') {
        return `<div class="json-tree-line">${keyPart}<span class="json-tree-str">"${escapeHtml(value)}"</span></div>`;
    }
    if (Array.isArray(value)) {
        const len = value.length;
        const childHtml = value.map((item, i) => buildJsonTreeHtml(item, i)).join('');
        return `<div class="json-tree-node json-tree-expandable" data-type="array">
            <div class="json-tree-head">${keyPart}<span class="json-tree-toggle">▼</span><span class="json-tree-bracket">[</span><span class="json-tree-meta"> ${len} item${len !== 1 ? 's' : ''}</span><span class="json-tree-bracket">]</span></div>
            <div class="json-tree-children">${childHtml}</div>
        </div>`;
    }
    if (typeof value === 'object') {
        const keys = Object.keys(value);
        const childHtml = keys.map(k => buildJsonTreeHtml(value[k], k)).join('');
        return `<div class="json-tree-node json-tree-expandable" data-type="object">
            <div class="json-tree-head">${keyPart}<span class="json-tree-toggle">▼</span><span class="json-tree-bracket">{</span><span class="json-tree-meta"> ${keys.length} key${keys.length !== 1 ? 's' : ''}</span><span class="json-tree-bracket">}</span></div>
            <div class="json-tree-children">${childHtml}</div>
        </div>`;
    }
    return '';
}

function initJsonTreeToggles() {
    const root = document.getElementById('jsonTreeRoot');
    if (!root) return;
    root.addEventListener('click', (e) => {
        const toggle = e.target.closest('.json-tree-toggle');
        if (!toggle) return;
        const node = toggle.closest('.json-tree-node');
        if (node) node.classList.toggle('json-tree-collapsed');
        if (toggle.textContent === '▼') toggle.textContent = '▶';
        else toggle.textContent = '▼';
    });
}

// Syntax highlight JSON
function syntaxHighlightJSON(json) {
    if (typeof json !== 'string') {
        json = JSON.stringify(json, null, 2);
    }

    json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
            if (/:$/.test(match)) {
                cls = 'json-key';
            } else {
                cls = 'json-string';
            }
        } else if (/true|false/.test(match)) {
            cls = 'json-boolean';
        } else if (/null/.test(match)) {
            cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
    });
}

// Escape HTML
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Toggle form panel collapse/expand
function toggleFormPanel() {
    const panel = document.getElementById('formPanel');
    const icon = document.getElementById('collapseIcon');

    panel.classList.toggle('collapsed');

    if (panel.classList.contains('collapsed')) {
        icon.textContent = '▲';
    } else {
        icon.textContent = '▼';
    }
}

// Parse cURL command
function parseCurlCommand(curlCommand) {
    const result = {
        url: '',
        method: 'GET',
        headers: {},
        cookie: '',
        body: ''
    };

    // Clean up the command - remove escaped newlines and normalize spaces
    curlCommand = curlCommand.replace(/\\\n/g, ' ')
        .replace(/\\\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Extract URL: ưu tiên URL có query params hoặc URL xuất hiện cuối (thường là request URL)
    const urlCandidates = [];
    const quotedUrlRe = /['"](https?:\/\/[^'"]+)['"]/gi;
    let m;
    while ((m = quotedUrlRe.exec(curlCommand)) !== null) {
        urlCandidates.push({ url: m[1], index: m.index });
    }
    const unquotedUrlRe = /https?:\/\/[^\s'"]+/g;
    while ((m = unquotedUrlRe.exec(curlCommand)) !== null) {
        if (!urlCandidates.some(c => c.url === m[0])) {
            urlCandidates.push({ url: m[0], index: m.index });
        }
    }
    const valid = urlCandidates.filter(c => {
        try {
            new URL(c.url);
            return true;
        } catch (e) {
            return false;
        }
    });
    if (valid.length > 0) {
        const withQuery = valid.filter(c => c.url.includes('?'));
        result.url = (withQuery.length > 0 ? withQuery : valid)
            .sort((a, b) => b.index - a.index)[0].url;
    }

    // Extract method (-X or --request)
    const methodMatch = curlCommand.match(/(?:-X|--request)\s+['"]?(\w+)['"]?/i);
    if (methodMatch) {
        result.method = methodMatch[1].toUpperCase();
    }

    // Extract headers (-H or --header) - handle both single and double quotes, and escaped quotes
    const headerPatterns = [
        /(?:-H|--header)\s+'([^']+)'/gi,
        /(?:-H|--header)\s+"([^"]+)"/gi,
        /(?:-H|--header)\s+([^\s-][^\n]+?)(?=\s+-|$)/gi
    ];

    for (const pattern of headerPatterns) {
        let headerMatch;
        while ((headerMatch = pattern.exec(curlCommand)) !== null) {
            const header = headerMatch[1].trim();
            const colonIndex = header.indexOf(':');
            if (colonIndex > 0) {
                const key = header.substring(0, colonIndex).trim();
                const value = header.substring(colonIndex + 1).trim();

                // Handle cookie separately
                if (key.toLowerCase() === 'cookie') {
                    result.cookie = value;
                } else if (key.toLowerCase() === 'authorization') {
                    result.headers[key] = value;
                } else {
                    result.headers[key] = value;
                }
            }
        }
    }

    // Also try to extract cookie from --cookie or -b flag
    const cookiePatterns = [
        /(?:--cookie|-b)\s+'([^']+)'/i,
        /(?:--cookie|-b)\s+"([^"]+)"/i,
        /(?:--cookie|-b)\s+([^\s-]+)/i
    ];

    for (const pattern of cookiePatterns) {
        const cookieMatch = curlCommand.match(pattern);
        if (cookieMatch) {
            result.cookie = cookieMatch[1];
            break;
        }
    }

    // Extract data/body (-d, --data, ...); nhiều -d khi dùng -G
    const hasGet = /\b(-G|--get)\b/i.test(curlCommand);
    const dataPatterns = [
        /(?:-d|--data|--data-raw|--data-binary)\s+'([^']+)'/gi,
        /(?:-d|--data|--data-raw|--data-binary)\s+"([^"]+)"/gi,
        /(?:-d|--data|--data-raw|--data-binary)\s+\$'([^']+)'/gi
    ];
    const allDataParts = [];
    for (const pattern of dataPatterns) {
        let dataMatch;
        while ((dataMatch = pattern.exec(curlCommand)) !== null) {
            allDataParts.push(dataMatch[1].trim());
        }
    }
    if (allDataParts.length > 0) {
        result.body = allDataParts.join('&');
        if (!hasGet && result.method === 'GET') result.method = 'POST';
    }

    // -G (--get): -d gửi dạng query string → gộp vào URL để fill đúng Query Params
    if (hasGet && result.url && result.body) {
        try {
            const u = new URL(result.url);
            result.body.split('&').forEach(p => {
                const eq = p.indexOf('=');
                if (eq >= 0) {
                    const k = decodeURIComponent(p.slice(0, eq).replace(/\+/g, ' '));
                    const v = decodeURIComponent(p.slice(eq + 1).replace(/\+/g, ' '));
                    u.searchParams.set(k, v);
                }
            });
            result.url = u.toString();
            result.body = '';
        } catch (e) { /* giữ nguyên */ }
    }

    return result;
}

// Fill form from cURL command
function fillFormFromCurl(curlCommand) {
    try {
        const parsed = parseCurlCommand(curlCommand);

        // Debug log
        console.log('Parsed cURL:', parsed);

        // Fill URL và tách query params vào danh sách
        if (parsed.url) {
            setUrlAndParams(parsed.url);
        }

        // Fill method
        if (parsed.method) {
            document.getElementById('method').value = parsed.method;
        }

        // Fill cookie
        if (parsed.cookie) {
            document.getElementById('cookie').value = parsed.cookie;
        }

        // Fill headers (excluding cookie and authorization which are handled separately)
        const headers = { ...parsed.headers };

        // Extract authorization token if exists
        if (headers['Authorization'] || headers['authorization']) {
            const authHeader = headers['Authorization'] || headers['authorization'];
            document.getElementById('token').value = authHeader;
            delete headers['Authorization'];
            delete headers['authorization'];
        }

        // Remove content-type from custom headers as it will be auto-added
        delete headers['Content-Type'];
        delete headers['content-type'];

        // Set remaining custom headers
        if (Object.keys(headers).length > 0) {
            document.getElementById('customHeaders').value = JSON.stringify(headers, null, 2);
        }

        // Fill body
        if (parsed.body) {
            try {
                const jsonBody = parseJSONAllowComments(parsed.body);
                setRequestBodyValue(JSON.stringify(jsonBody, null, 2));
            } catch (e) {
                setRequestBodyValue(parsed.body);
            }
        }

        showAlert('Đã import cURL command thành công!', 'success');
    } catch (error) {
        showAlert('Không thể parse cURL command: ' + error.message, 'error');
    }
}

// Add paste event listener to URL field
document.getElementById('apiUrl').addEventListener('paste', (e) => {
    setTimeout(() => {
        const pastedText = e.target.value.trim();

        // Check if pasted text looks like a cURL command
        if (pastedText.toLowerCase().startsWith('curl ')) {
            e.preventDefault();
            fillFormFromCurl(pastedText);
        }
    }, 10);
});

// Add keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + F: mở tìm kiếm trong response
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openFindBar();
        return;
    }
    if (e.key === 'Escape') {
        const findBar = document.getElementById('findBar');
        if (findBar && findBar.style.display !== 'none') {
            closeFindBar();
            e.preventDefault();
        }
        return;
    }
    // Ctrl/Cmd + Enter to send request
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        sendRequest();
        return;
    }
    // Ctrl/Cmd + K to clear form
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        clearForm();
    }
});

// ==================== Find in Response (Ctrl+F) ====================
let searchHighlightElements = [];
let searchCurrentIndex = -1;

function getSearchableContainer() {
    const activePane = document.querySelector('.tab-pane.active');
    if (!activePane) return null;
    const id = activePane.id;
    if (id === 'previewPane') return document.getElementById('previewContent');
    if (id === 'tablePane') return document.getElementById('tableViewTableWrap');
    if (id === 'rawPane') return document.getElementById('rawData');
    if (id === 'headersPane') return document.getElementById('headersData');
    return null;
}

function removeSearchHighlights(container) {
    if (!container) return;
    container.querySelectorAll('.search-highlight, .search-highlight-current').forEach(mark => {
        const parent = mark.parentNode;
        parent.replaceChild(document.createTextNode(mark.textContent), mark);
        parent.normalize();
    });
    searchHighlightElements = [];
    searchCurrentIndex = -1;
}

function highlightSearchInContainer(container, searchText) {
    if (!container) return 0;
    removeSearchHighlights(container);
    if (!searchText || !searchText.trim()) {
        updateFindMatchCount(0);
        return 0;
    }
    const escaped = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'gi');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);
    const marks = [];
    textNodes.forEach(node => {
        const text = node.textContent;
        const parts = text.split(re);
        if (parts.length <= 1) return;
        const fragment = document.createDocumentFragment();
        let idx = 0;
        let pos = 0;
        while (pos < text.length) {
            const match = text.slice(pos).match(re);
            if (!match) {
                fragment.appendChild(document.createTextNode(text.slice(pos)));
                break;
            }
            const matchStart = text.indexOf(match[0], pos);
            if (matchStart > pos) {
                fragment.appendChild(document.createTextNode(text.slice(pos, matchStart)));
            }
            const mark = document.createElement('mark');
            mark.className = 'search-highlight';
            mark.textContent = match[0];
            mark.dataset.searchIndex = String(marks.length);
            marks.push(mark);
            fragment.appendChild(mark);
            pos = matchStart + match[0].length;
        }
        node.parentNode.replaceChild(fragment, node);
    });
    searchHighlightElements = marks;
    searchCurrentIndex = marks.length > 0 ? 0 : -1;
    if (marks.length > 0) {
        marks[0].classList.add('search-highlight-current');
        marks[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    updateFindMatchCount(marks.length);
    return marks.length;
}

function updateFindMatchCount(total) {
    const el = document.getElementById('findMatchCount');
    if (!el) return;
    if (total === 0) {
        const findInput = document.getElementById('findInput');
        el.textContent = findInput && findInput.value.trim() ? '0 kết quả' : '';
    } else {
        el.textContent = `${searchCurrentIndex + 1}/${total}`;
    }
}

function findNext() {
    const q = searchHighlightElements;
    if (q.length === 0) return;
    q.forEach(m => m.classList.remove('search-highlight-current'));
    searchCurrentIndex = (searchCurrentIndex + 1) % q.length;
    q[searchCurrentIndex].classList.add('search-highlight-current');
    q[searchCurrentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateFindMatchCount(q.length);
}

function findPrev() {
    const q = searchHighlightElements;
    if (q.length === 0) return;
    q.forEach(m => m.classList.remove('search-highlight-current'));
    searchCurrentIndex = searchCurrentIndex <= 0 ? q.length - 1 : searchCurrentIndex - 1;
    q[searchCurrentIndex].classList.add('search-highlight-current');
    q[searchCurrentIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    updateFindMatchCount(q.length);
}

function runSearch() {
    const input = document.getElementById('findInput');
    const container = getSearchableContainer();
    if (!input || !container) return;
    const text = input.value;
    highlightSearchInContainer(container, text);
}

// Debounce tìm kiếm để tránh lag khi gõ
let findSearchDebounceTimer = null;
const FIND_DEBOUNCE_MS = 280;

function debouncedRunSearch() {
    if (findSearchDebounceTimer) clearTimeout(findSearchDebounceTimer);
    const input = document.getElementById('findInput');
    if (input && input.value.trim() === '') {
        runSearch();
        return;
    }
    findSearchDebounceTimer = setTimeout(() => {
        findSearchDebounceTimer = null;
        runSearch();
    }, FIND_DEBOUNCE_MS);
}

function openFindBar() {
    const findBar = document.getElementById('findBar');
    const tabContainer = document.getElementById('tabContainer');
    if (!findBar || !tabContainer || tabContainer.style.display === 'none') return;
    findBar.style.display = 'flex';
    const input = document.getElementById('findInput');
    if (input) {
        input.value = '';
        input.focus();
        removeSearchHighlights(getSearchableContainer());
        document.getElementById('findMatchCount').textContent = '';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closeFindBar() {
    const findBar = document.getElementById('findBar');
    if (findBar) findBar.style.display = 'none';
    removeSearchHighlights(getSearchableContainer());
}

// ==================== Request Body: JSON / Form Data ====================
function getBodyType() {
    const r = document.querySelector('input[name="bodyType"]:checked');
    return r ? r.value : 'json';
}

function showBodyPanel() {
    const isJson = getBodyType() === 'json';
    const jsonWrap = document.getElementById('bodyJsonWrap');
    const formWrap = document.getElementById('bodyFormDataWrap');
    const btn = document.getElementById('beautifyJsonBtn');
    if (jsonWrap) jsonWrap.style.display = isJson ? 'block' : 'none';
    if (formWrap) formWrap.style.display = isJson ? 'none' : 'block';
    if (btn) btn.style.display = isJson ? 'inline-flex' : 'none';
}

function clearFormDataList() {
    const list = document.getElementById('formDataList');
    if (!list) return;
    list.innerHTML = `
        <div class="form-data-row">
            <input type="text" class="input-field form-data-key" placeholder="Key">
            <select class="select-field form-data-type" onchange="onFormDataRowTypeChange(this)">
                <option value="text">Text</option>
                <option value="file">File</option>
            </select>
            <input type="text" class="input-field form-data-value" placeholder="Value">
            <input type="file" class="form-data-file" style="display: none;" onchange="onFormDataFileSelect(this)">
            <span class="form-data-file-name"></span>
            <button type="button" class="btn btn-icon-sm param-remove" onclick="removeFormDataRow(this)" title="Xóa">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
            </button>
        </div>
    `;
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function addFormDataRow() {
    const list = document.getElementById('formDataList');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'form-data-row';
    row.innerHTML = `
        <input type="text" class="input-field form-data-key" placeholder="Key">
        <select class="select-field form-data-type" onchange="onFormDataRowTypeChange(this)">
            <option value="text">Text</option>
            <option value="file">File</option>
        </select>
        <input type="text" class="input-field form-data-value" placeholder="Value">
        <input type="file" class="form-data-file" style="display: none;" onchange="onFormDataFileSelect(this)">
        <span class="form-data-file-name"></span>
        <button type="button" class="btn btn-icon-sm param-remove" onclick="removeFormDataRow(this)" title="Xóa">
            <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
        </button>
    `;
    list.appendChild(row);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function removeFormDataRow(btn) {
    const row = btn.closest('.form-data-row');
    if (row) row.remove();
}

function onFormDataRowTypeChange(select) {
    const row = select.closest('.form-data-row');
    if (!row) return;
    const valueInput = row.querySelector('.form-data-value');
    const fileInput = row.querySelector('.form-data-file');
    const fileNameSpan = row.querySelector('.form-data-file-name');
    const isFile = select.value === 'file';
    if (valueInput) valueInput.style.display = isFile ? 'none' : 'block';
    if (fileInput) fileInput.style.display = isFile ? 'block' : 'none';
    if (fileNameSpan) fileNameSpan.textContent = isFile && fileInput.files.length ? fileInput.files[0].name : '';
}

function onFormDataFileSelect(input) {
    const row = input.closest('.form-data-row');
    const span = row ? row.querySelector('.form-data-file-name') : null;
    if (span) span.textContent = input.files.length ? input.files[0].name : '';
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const b64 = reader.result.split(',')[1];
            resolve(b64 || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function getFormDataParts() {
    const list = document.getElementById('formDataList');
    if (!list) return [];
    const parts = [];
    for (const row of list.querySelectorAll('.form-data-row')) {
        const keyInput = row.querySelector('.form-data-key');
        const typeSelect = row.querySelector('.form-data-type');
        const valueInput = row.querySelector('.form-data-value');
        const fileInput = row.querySelector('.form-data-file');
        const key = keyInput ? keyInput.value.trim() : '';
        if (!key) continue;
        const type = typeSelect ? typeSelect.value : 'text';
        if (type === 'file' && fileInput && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const contentBase64 = await fileToBase64(file);
            parts.push({ name: key, type: 'file', fileName: file.name, contentBase64 });
        } else if (type === 'text' && valueInput) {
            parts.push({ name: key, type: 'text', value: valueInput.value });
        }
    }
    return parts;
}

// Chuyển panel Request Body khi đổi JSON / Form Data
document.querySelectorAll('input[name="bodyType"]').forEach(radio => {
    radio.addEventListener('change', showBodyPanel);
});

// Gắn sự kiện cho Find: input (debounce), Enter, Shift+Enter
(function initFindBar() {
    const findInput = document.getElementById('findInput');
    if (!findInput) return;
    findInput.addEventListener('input', debouncedRunSearch);
    findInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) findPrev();
            else findNext();
        }
    });
})();

// JSON Formatting function (called from HTML)
function beautifyJSON() {
    if (!window.bodyEditor) return;

    const content = window.bodyEditor.getValue().trim();
    if (!content) {
        showAlert('Request Body trống!', 'warning');
        return;
    }

    try {
        const parsed = parseJSONAllowComments(content);
        const formatted = JSON.stringify(parsed, null, 2);
        window.bodyEditor.setValue(formatted, -1);
        showAlert('JSON đã được format!', 'success');
    } catch (e) {
        showAlert('JSON không hợp lệ: ' + e.message, 'error');
    }
}

// Strip JSON comments (// and /* */) so JSONC-style input can be parsed
function stripJSONComments(str) {
    if (!str || typeof str !== 'string') return str;
    let out = '';
    let i = 0;
    const n = str.length;
    let inString = false;
    let escape = false;
    let inLineComment = false;
    let inBlockComment = false;
    let quote = '';

    while (i < n) {
        const c = str[i];

        if (inBlockComment) {
            if (c === '*' && str[i + 1] === '/') {
                i += 2;
                inBlockComment = false;
            } else {
                i++;
            }
            continue;
        }
        if (inLineComment) {
            if (c === '\n' || c === '\r') {
                inLineComment = false;
                out += c;
            }
            i++;
            continue;
        }
        if (escape) {
            escape = false;
            out += c;
            i++;
            continue;
        }
        if (inString) {
            if (c === '\\') {
                escape = true;
                out += c;
                i++;
            } else if (c === quote) {
                inString = false;
                out += c;
                i++;
            } else {
                out += c;
                i++;
            }
            continue;
        }

        if (c === '"' || c === "'") {
            inString = true;
            quote = c;
            out += c;
            i++;
        } else if (c === '/' && str[i + 1] === '/') {
            inLineComment = true;
            i += 2;
        } else if (c === '/' && str[i + 1] === '*') {
            inBlockComment = true;
            i += 2;
        } else {
            out += c;
            i++;
        }
    }
    return out;
}

// Parse JSON allowing // and /* */ comments (JSONC)
function parseJSONAllowComments(str) {
    return JSON.parse(stripJSONComments(str));
}

// Validate JSON helper (allows comments)
function isValidJSON(str) {
    try {
        parseJSONAllowComments(str);
        return true;
    } catch (e) {
        return false;
    }
}

// --- Request Body: Ace Editor ---
function getRequestBodyValue() {
    if (window.bodyEditor) return window.bodyEditor.getValue();
    const el = document.getElementById('requestBody');
    return (el && el.value !== undefined) ? el.value : '';
}

function setRequestBodyValue(str) {
    if (window.bodyEditor) {
        window.bodyEditor.setValue(str || '', -1);
        return;
    }
    const el = document.getElementById('requestBody');
    if (el && el.value !== undefined) el.value = str || '';
}

function initRequestBodyEditor() {
    const container = document.getElementById('requestBody');
    if (!container) return;
    if (!window.ace) {
        setTimeout(initRequestBodyEditor, 200);
        return;
    }
    if (window.bodyEditor) return;
    try {
        window.bodyEditor = ace.edit(container);
        window.bodyEditor.setTheme('ace/theme/twilight');
        window.bodyEditor.session.setMode('ace/mode/json');
        window.bodyEditor.setOptions({
            fontSize: '12px',
            showPrintMargin: false,
            minLines: 6,
            maxLines: 20
        });
        window.bodyEditor.setValue('{}', -1);
    } catch (e) {
        console.error('Init request body editor failed:', e);
    }
}

// ==================== Resize bar giữa 2 panel ====================
const LEFT_PANEL_MIN = 280;
const LEFT_PANEL_MAX = 900;
const STORAGE_KEY_LEFT_PANEL = 'api-caller-left-panel-width';

function initResizeHandle() {
    const mainContent = document.getElementById('mainContent');
    const handle = document.getElementById('resizeHandle');
    if (!mainContent || !handle) return;

    const saved = localStorage.getItem(STORAGE_KEY_LEFT_PANEL);
    if (saved) {
        const w = parseInt(saved, 10);
        if (w >= LEFT_PANEL_MIN && w <= LEFT_PANEL_MAX) {
            mainContent.style.setProperty('--left-panel-width', w + 'px');
        }
    }

    let isDragging = false;
    handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            if (!isDragging) return;
            const w = Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, e.clientX));
            mainContent.style.setProperty('--left-panel-width', w + 'px');
        }
        function onUp() {
            isDragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            const v = mainContent.style.getPropertyValue('--left-panel-width');
            if (v) localStorage.setItem(STORAGE_KEY_LEFT_PANEL, parseInt(v, 10));
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initRequestBodyEditor, 50);
        initResizeHandle();
    });
} else {
    setTimeout(initRequestBodyEditor, 50);
    initResizeHandle();
}
