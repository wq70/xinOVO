const saveApiPresetSettings = () => saveGlobalSettings(['apiPresets']);

function _getApiPresets() {
    return db.apiPresets || [];
}
function _saveApiPresets(arr) {
    db.apiPresets = arr || [];
    saveApiPresetSettings();
}

function populateApiSelect() {
    const sel = document.getElementById('api-preset-select');
    if (!sel) return;
    const presets = _getApiPresets();
    sel.innerHTML = '<option value="">— 选择 API 预设 —</option>';
    presets.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    sel.appendChild(opt);
    });
}

function saveCurrentApiAsPreset() {
    const apiKeyEl = document.querySelector('#api-key');
    const apiUrlEl = document.querySelector('#api-url');
    const providerEl = document.querySelector('#api-provider');
    const modelEl = document.querySelector('#api-model');

    const data = {
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        apiUrl: apiUrlEl ? apiUrlEl.value : '',
        provider: providerEl ? providerEl.value : '',
        model: modelEl ? modelEl.value : ''
    };
    
    let name = prompt('为该 API 预设填写名称（会覆盖同名预设）：');
    if (!name) return;
    const presets = _getApiPresets();
    const idx = presets.findIndex(p => p.name === name);
    const preset = {name: name, data: data};
    if (idx >= 0) presets[idx] = preset; else presets.push(preset);
    _saveApiPresets(presets);
    populateApiSelect();
    showToast('API 预设已保存');
}

async function applyApiPreset(name) {
    const presets = _getApiPresets();
    const p = presets.find(x => x.name === name);
    if (!p) return showToast('未找到该预设');
    try {
        const apiKeyEl = document.querySelector('#api-key');
        const apiUrlEl = document.querySelector('#api-url');
        const providerEl = document.querySelector('#api-provider');
        const modelEl = document.querySelector('#api-model');

        if (apiKeyEl && p.data && typeof p.data.apiKey !== 'undefined') apiKeyEl.value = p.data.apiKey;
        if (apiUrlEl && p.data && typeof p.data.apiUrl !== 'undefined') apiUrlEl.value = p.data.apiUrl;
        if (providerEl && p.data && typeof p.data.provider !== 'undefined') providerEl.value = p.data.provider;
        if (modelEl && p.data && typeof p.data.model !== 'undefined') {
            modelEl.innerHTML = `<option value="${p.data.model}">${p.data.model}</option>`;
            modelEl.value = p.data.model;
        }

        showToast('已应用 API 预设');
    } catch(e) {
        console.error('applyApiPreset error', e);
    }
}

function openApiManageModal() {
    const modal = document.getElementById('api-presets-modal');
    const list = document.getElementById('api-presets-list');
    if (!modal || !list) return;
    list.innerHTML = '';
    const presets = _getApiPresets();
    if (!presets.length) {
        list.innerHTML = '<p style="color:#888;margin:6px 0;">暂无预设</p>';
    }
    presets.forEach((p, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.padding = '8px 6px';
        row.style.borderBottom = '1px solid #f6f6f6';

        const left = document.createElement('div');
        left.style.flex = '1';
        left.style.minWidth = '0';
        left.innerHTML = '<div style="font-weight:600;">'+p.name+'</div><div style="font-size:12px;color:#666;margin-top:4px;">' + (p.data && p.data.provider ? ('提供者：'+p.data.provider) : '') + '</div>';

        const btns = document.createElement('div');
        btns.style.display = 'flex';
        btns.style.gap = '6px';

        const applyBtn = document.createElement('button');
        applyBtn.className = 'btn';
        applyBtn.textContent = '应用';
        applyBtn.onclick = function(){ applyApiPreset(p.name); modal.style.display='none'; };

        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn';
        renameBtn.textContent = '重命名';
        renameBtn.onclick = function(){
            const newName = prompt('输入新名称：', p.name);
            if (!newName) return;
            const all = _getApiPresets();
            all[idx].name = newName;
            _saveApiPresets(all);
            openApiManageModal();
            populateApiSelect();
        };

        const delBtn = document.createElement('button');
        delBtn.className = 'btn';
        delBtn.textContent = '删除';
        delBtn.onclick = function(){ if(!confirm('确定删除 "'+p.name+'" ?')) return; const all=_getApiPresets(); all.splice(idx,1); _saveApiPresets(all); openApiManageModal(); populateApiSelect(); };

        btns.appendChild(applyBtn); btns.appendChild(renameBtn); btns.appendChild(delBtn);

        row.appendChild(left); row.appendChild(btns);
        list.appendChild(row);
    });
    modal.style.display = 'flex';
}

function exportApiPresets() {
    const presets = _getApiPresets();
    const blob = new Blob([JSON.stringify(presets, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'api_presets.json'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
function importApiPresets() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json';
    inp.onchange = function(e){
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = function(){ try { const data = JSON.parse(r.result); if (Array.isArray(data)) { _saveApiPresets(data); populateApiSelect(); openApiManageModal(); } else alert('文件格式不正确'); } catch(e){ alert('导入失败：'+e.message); } };
        r.readAsText(f);
    };
    inp.click();
}

    // === 副API通用设置函数 ===
    var subApiDisplayNames = { summary: '总结', background: '后台活动', vector: '向量记忆', supplementPersona: '补齐人设', peek: '偷看手机', imageRecognition: '自动识图', stickerRecognition: '表情包识图' };
function setupSubApiSettings(prefix, dbKey, presetsKey) {
    const displayName = subApiDisplayNames[prefix] || prefix;
    const providerEl = document.getElementById(`${prefix}-api-provider`);
    const urlEl = document.getElementById(`${prefix}-api-url`);
    const keyEl = document.getElementById(`${prefix}-api-key`);
    const modelEl = document.getElementById(`${prefix}-api-model`);
    const fetchBtn = document.getElementById(`${prefix}-fetch-models-btn`);
    const saveBtn = document.getElementById(`${prefix}-api-save-btn`);
    
    const providerUrls = {
        newapi: '',
        deepseek: 'https://api.deepseek.com',
        claude: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com'
    };
    
    // 加载保存的设置
    if (db[dbKey]) {
        providerEl.value = db[dbKey].provider || 'newapi';
        urlEl.value = db[dbKey].url || '';
        keyEl.value = db[dbKey].key || '';
        if (db[dbKey].model) {
            modelEl.innerHTML = `<option value="${db[dbKey].model}">${db[dbKey].model}</option>`;
        }
    }
    
    // 服务商切换时自动填充URL
    providerEl.addEventListener('change', () => {
        urlEl.value = providerUrls[providerEl.value] || '';
    });
    
    // 拉取模型列表
    fetchBtn.addEventListener('click', async () => {
        const provider = providerEl.value;
        let apiUrl = urlEl.value.trim();
        const apiKey = keyEl.value.trim();
        
        if (!apiUrl || !apiKey) {
            showToast('请先填写API地址和密钥！');
            return;
        }
        
        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            showToast('该 API 站点已被屏蔽，无法使用！');
            return;
        }
        
        if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
        
        const endpoint = provider === 'gemini' 
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}` 
            : `${apiUrl}/v1/models`;
        
        fetchBtn.classList.add('loading');
        fetchBtn.disabled = true;
        
        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            
            if (!response.ok) {
                throw new Error(`网络响应错误: ${response.status}`);
            }
            
            const data = await response.json();
            let models = [];
            
            if (provider !== 'gemini' && data.data) {
                models = data.data.map(e => e.id);
            } else if (provider === 'gemini' && data.models) {
                models = data.models.map(e => e.name.replace('models/', ''));
            }
            
            modelEl.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelEl.appendChild(opt);
                });
                showToast('模型列表拉取成功！');
            } else {
                modelEl.innerHTML = '<option value="">未找到任何模型</option>';
                showToast('未找到任何模型');
            }
        } catch (err) {
            console.error(err);
            showApiError(err);
            modelEl.innerHTML = '<option value="">拉取失败</option>';
        } finally {
            fetchBtn.classList.remove('loading');
            fetchBtn.disabled = false;
        }
    });
    
    // 保存设置
    saveBtn.addEventListener('click', async () => {
        if (!modelEl.value && (urlEl.value.trim() || keyEl.value.trim())) {
            showToast('请选择模型后保存！');
            return;
        }
        
        if (BLOCKED_API_DOMAINS.some(domain => urlEl.value.includes(domain))) {
            showToast('该 API 站点已被屏蔽，无法保存！');
            return;
        }
        
        // 如果全部为空，则清空设置
        if (!urlEl.value.trim() && !keyEl.value.trim() && !modelEl.value) {
            db[dbKey] = {};
            await saveApiPresetSettings();
            showToast(displayName + 'API设置已清空！');
            return;
        }
        
        db[dbKey] = {
            provider: providerEl.value,
            url: urlEl.value,
            key: keyEl.value,
            model: modelEl.value
        };
        await saveApiPresetSettings();
        showToast(displayName + 'API设置已保存！');
    });
    
    // 预设管理
    setupSubApiPresets(prefix, dbKey, presetsKey);
}

// === 副API预设管理 ===
function setupSubApiPresets(prefix, dbKey, presetsKey) {
    const presetSelect = document.getElementById(`${prefix}-api-preset-select`);
    const applyBtn = document.getElementById(`${prefix}-api-apply-preset`);
    const savePresetBtn = document.getElementById(`${prefix}-api-save-preset`);
    const manageBtn = document.getElementById(`${prefix}-api-manage-presets`);
    const importBtn = document.getElementById(`${prefix}-api-import-presets`);
    const exportBtn = document.getElementById(`${prefix}-api-export-presets`);
    const modal = document.getElementById(`${prefix}-api-presets-modal`);
    const closeModalBtn = document.getElementById(`${prefix}-api-close-modal`);
    const presetsList = document.getElementById(`${prefix}-api-presets-list`);
    
    // 填充预设列表
    function populatePresets() {
        const presets = db[presetsKey] || [];
        if (presetSelect) presetSelect.innerHTML = '<option value="">— 选择 —</option>';
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            if (presetSelect) presetSelect.appendChild(opt);
        });
    }
    
    populatePresets();
    
    // 应用预设
    applyBtn?.addEventListener('click', async () => {
        const name = presetSelect ? presetSelect.value : '';
        if (!name) return showToast('请选择预设');
        
        const presets = db[presetsKey] || [];
        const preset = presets.find(p => p.name === name);
        if (!preset) return showToast('未找到该预设');
        
        try {
            const providerEl = document.getElementById(`${prefix}-api-provider`);
            const urlEl = document.getElementById(`${prefix}-api-url`);
            const keyEl = document.getElementById(`${prefix}-api-key`);
            const modelEl = document.getElementById(`${prefix}-api-model`);
            
            if (providerEl && preset.data.provider) providerEl.value = preset.data.provider;
            if (urlEl && preset.data.apiUrl) urlEl.value = preset.data.apiUrl;
            if (keyEl && preset.data.apiKey) keyEl.value = preset.data.apiKey;
            if (modelEl && preset.data.model) {
                modelEl.innerHTML = `<option value="${preset.data.model}">${preset.data.model}</option>`;
            }
            
            showToast('预设已应用到表单！');
        } catch (err) {
            console.error(err);
            showToast('应用预设失败');
        }
    });
    
    // 另存为预设
    savePresetBtn?.addEventListener('click', () => {
        const providerEl = document.getElementById(`${prefix}-api-provider`);
        const urlEl = document.getElementById(`${prefix}-api-url`);
        const keyEl = document.getElementById(`${prefix}-api-key`);
        const modelEl = document.getElementById(`${prefix}-api-model`);
        
        const data = {
            provider: providerEl ? providerEl.value : '',
            apiUrl: urlEl ? urlEl.value : '',
            apiKey: keyEl ? keyEl.value : '',
            model: modelEl ? modelEl.value : ''
        };
        
        let name = prompt('为该预设填写名称（会覆盖同名预设）：');
        if (!name) return;
        
        const presets = db[presetsKey] || [];
        const idx = presets.findIndex(p => p.name === name);
        const preset = { name: name, data: data };
        
        if (idx >= 0) presets[idx] = preset;
        else presets.push(preset);
        
        db[presetsKey] = presets;
        saveApiPresetSettings();
        populatePresets();
        showToast('预设已保存');
    });
    
    // 管理预设
    manageBtn?.addEventListener('click', () => {
        renderPresetsList();
        if (modal) modal.style.display = 'flex';
    });
    
    function renderPresetsList() {
        const presets = db[presetsKey] || [];
        presetsList.innerHTML = '';
        
        if (presets.length === 0) {
            presetsList.innerHTML = '<p style="text-align:center;color:#999;">暂无预设</p>';
            return;
        }
        
        presets.forEach((preset, idx) => {
            const div = document.createElement('div');
            div.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px;margin-bottom:6px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa;';
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = preset.name;
            nameSpan.style.cssText = 'flex:1;font-weight:500;';
            
            const delBtn = document.createElement('button');
            delBtn.textContent = '删除';
            delBtn.className = 'btn btn-small';
            delBtn.style.cssText = 'background:#ff4444;color:white;padding:4px 12px;';
            delBtn.onclick = () => {
                if (confirm(`确定删除预设"${preset.name}"吗？`)) {
                    presets.splice(idx, 1);
                    db[presetsKey] = presets;
                    saveApiPresetSettings();
                    renderPresetsList();
                    populatePresets();
                    showToast('预设已删除');
                }
            };
            
            div.appendChild(nameSpan);
            div.appendChild(delBtn);
            if (presetsList) presetsList.appendChild(div);
        });
    }
    
    closeModalBtn?.addEventListener('click', () => {
        if (modal) modal.style.display = 'none';
    });
    
    // 导入预设
    importBtn?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const imported = JSON.parse(text);
                
                if (!Array.isArray(imported)) {
                    showToast('文件格式错误');
                    return;
                }
                
                db[presetsKey] = db[presetsKey] || [];
                imported.forEach(preset => {
                    const idx = db[presetsKey].findIndex(p => p.name === preset.name);
                    if (idx >= 0) db[presetsKey][idx] = preset;
                    else db[presetsKey].push(preset);
                });
                
                await saveApiPresetSettings();
                populatePresets();
                showToast('预设已导入');
            } catch (err) {
                console.error(err);
                showToast('导入失败，请检查文件格式');
            }
        };
        input.click();
    });
    
    // 导出预设
    exportBtn?.addEventListener('click', () => {
        const presets = db[presetsKey] || [];
        if (presets.length === 0) {
            showToast('暂无预设可导出');
            return;
        }
        
        const json = JSON.stringify(presets, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prefix}_api_presets_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('预设已导出');
    });
}

// === NovelAI 生图 API 设置 ===
// === GPT 生图 API 设置 ===
