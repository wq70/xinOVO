const saveMainApiSettings = () => saveGlobalSettings(['apiSettings', 'gptImageSettings', 'imageRecognitionEnabled', 'weatherApiSettings']);

function setupApiSettingsApp() {
    const e = document.getElementById('api-form'), t = document.getElementById('fetch-models-btn'),
        a = document.getElementById('api-model'), n = document.getElementById('api-provider'),
        r = document.getElementById('api-url'), s = document.getElementById('api-key'), c = {
            newapi: '',
            deepseek: 'https://api.deepseek.com',
            claude: 'https://api.anthropic.com',
            gemini: 'https://generativelanguage.googleapis.com'
        };
    db.apiSettings && (n.value = db.apiSettings.provider || 'newapi', r.value = db.apiSettings.url || '', s.value = db.apiSettings.key || '', db.apiSettings.model && (a.innerHTML = `<option value="${db.apiSettings.model}">${db.apiSettings.model}</option>`));
    if (db.apiSettings && typeof db.apiSettings.onlineRoleEnabled !== 'undefined') { document.getElementById('online-role-switch').checked = db.apiSettings.onlineRoleEnabled; } else { document.getElementById('online-role-switch').checked = true; }
    if (db.apiSettings && typeof db.apiSettings.timePerceptionEnabled !== 'undefined') { document.getElementById('time-perception-switch').checked = db.apiSettings.timePerceptionEnabled; }
    if (db.apiSettings && typeof db.apiSettings.streamEnabled !== 'undefined') { document.getElementById('stream-switch').checked = db.apiSettings.streamEnabled; } else { document.getElementById('stream-switch').checked = true; }
    if (db.apiSettings && typeof db.apiSettings.quickReplyEnabled !== 'undefined') { document.getElementById('quick-reply-switch').checked = db.apiSettings.quickReplyEnabled; } else { document.getElementById('quick-reply-switch').checked = false; }

    const tempSlider = document.getElementById('temperature-slider');
    const tempValue = document.getElementById('temperature-value');
    if (tempSlider && tempValue) {
        const savedTemp = (db.apiSettings && db.apiSettings.temperature !== undefined) ? db.apiSettings.temperature : 1.0;
        tempSlider.value = savedTemp;
        tempValue.textContent = savedTemp;

        tempSlider.addEventListener('input', (e) => {
            tempValue.textContent = e.target.value;
        });
    }

    populateApiSelect();
    n?.addEventListener('change', () => {
        if (r) r.value = c[n.value] || ''
    });

    // 提取为全局函数以便复用
    window.fetchAndPopulateModels = async (showToastFlag = true) => {
        const provider = n.value;
        let apiUrl = r.value.trim();
        const apiKey = s.value.trim();
        const modelSelect = a;
        const fetchBtn = t;

        if (!apiUrl || !apiKey) {
            if (showToastFlag) showToast('请先填写API地址和密钥！');
            return;
        }

        if (BLOCKED_API_DOMAINS.some(domain => apiUrl.includes(domain))) {
            if (showToastFlag) showToast('该 API 站点已被屏蔽，无法使用！');
            return;
        }

        if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
        
        const endpoint = provider === 'gemini' 
            ? `${apiUrl}/v1beta/models?key=${getRandomValue(apiKey)}` 
            : `${apiUrl}/v1/models`;

        if (fetchBtn) {
            fetchBtn.classList.add('loading');
            fetchBtn.disabled = true;
        }

        try {
            const headers = provider === 'gemini' ? {} : { Authorization: `Bearer ${apiKey}` };
            const response = await fetch(endpoint, { method: 'GET', headers });
            
            if (!response.ok) {
                const error = new Error(`网络响应错误: ${response.status}`);
                error.response = response;
                throw error;
            }

            const data = await response.json();
            let models = [];
            
            if (provider !== 'gemini' && data.data) {
                models = data.data.map(e => e.id);
            } else if (provider === 'gemini' && data.models) {
                models = data.models.map(e => e.name.replace('models/', ''));
            }

            // 保留当前选中的值（如果仍在列表中）
            const currentVal = modelSelect.value;
            
            modelSelect.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelSelect.appendChild(opt);
                });
                
                // 尝试恢复之前的选择，或者使用设置中的值
                if (models.includes(currentVal)) {
                    modelSelect.value = currentVal;
                } else if (db.apiSettings && db.apiSettings.model && models.includes(db.apiSettings.model)) {
                    modelSelect.value = db.apiSettings.model;
                }
                
                if (showToastFlag) showToast('模型列表拉取成功！');
            } else {
                modelSelect.innerHTML = '<option value="">未找到任何模型</option>';
                if (showToastFlag) showToast('未找到任何模型');
            }
        } catch (err) {
            console.error(err);
            if (showToastFlag) {
                showApiError(err);
                modelSelect.innerHTML = '<option value="">拉取失败</option>';
            }
        } finally {
            if (fetchBtn) {
                fetchBtn.classList.remove('loading');
                fetchBtn.disabled = false;
            }
        }
    };

    t?.addEventListener('click', () => window.fetchAndPopulateModels(true));
    e?.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!a.value) return showToast('请选择模型后保存！');
        if (BLOCKED_API_DOMAINS.some(domain => r.value.includes(domain))) {
            return showToast('该 API 站点已被屏蔽，无法保存！');
        }
        db.apiSettings = {
            provider: n.value,
            url: r.value,
            key: s.value,
            model: a.value,
            onlineRoleEnabled: document.getElementById('online-role-switch').checked,
            timePerceptionEnabled: document.getElementById('time-perception-switch').checked,
            streamEnabled: document.getElementById('stream-switch').checked,
            quickReplyEnabled: document.getElementById('quick-reply-switch').checked,
            temperature: parseFloat(document.getElementById('temperature-slider').value)
        };
        
        // 保存自动识图全局开关
        const irSwitch = document.getElementById('imageRecognition-enabled-switch');
        if (irSwitch) {
            db.imageRecognitionEnabled = irSwitch.checked;
        }

        await saveMainApiSettings();
        showToast('API设置已保存！')
    });
    
    // === 副API设置：总结API ===
    setupSubApiSettings('summary', 'summaryApiSettings', 'summaryApiPresets');
    
    // === 副API设置：后台活动API ===
    setupSubApiSettings('background', 'backgroundApiSettings', 'backgroundApiPresets');

    // === 副API设置：向量记忆 Embedding API ===
    setupSubApiSettings('vector', 'vectorApiSettings', 'vectorApiPresets');
    
    // === 副API设置：补齐人设API ===
    setupSubApiSettings('supplementPersona', 'supplementPersonaApiSettings', 'supplementPersonaApiPresets');
    
    // === 副API设置：偷看手机API ===
    setupSubApiSettings('peek', 'peekApiSettings', 'peekApiPresets');

    // === 副API设置：自动识图 API ===
    setupSubApiSettings('imageRecognition', 'imageRecognitionApiSettings', 'imageRecognitionApiPresets');
    
    if (db.imageRecognitionEnabled !== undefined) {
        document.getElementById('imageRecognition-enabled-switch').checked = db.imageRecognitionEnabled;
    } else {
        document.getElementById('imageRecognition-enabled-switch').checked = false; // 默认关闭
    }

    // === 副API设置：表情包识图 API ===
    setupSubApiSettings('stickerRecognition', 'stickerRecognitionApiSettings', 'stickerRecognitionApiPresets');

    // === 全局天气服务 API ===
    const weatherProviderEl = document.getElementById('weather-api-provider');
    const weatherKeyEl = document.getElementById('weather-api-key');
    const weatherKeyCont = document.getElementById('weather-api-key-container');
    const weatherSaveBtn = document.getElementById('weather-api-save-btn');

    if (weatherProviderEl) {
        if (db.weatherApiSettings) {
            weatherProviderEl.value = db.weatherApiSettings.provider || 'openmeteo';
            if (weatherKeyEl) weatherKeyEl.value = db.weatherApiSettings.key || '';
        }
        
        const updateWeatherKeyVisibility = () => {
            const provider = weatherProviderEl.value;
            if (provider === 'qweather' || provider === 'seniverse') {
                if (weatherKeyCont) weatherKeyCont.style.display = 'flex';
            } else {
                if (weatherKeyCont) weatherKeyCont.style.display = 'none';
            }
        };
        weatherProviderEl.addEventListener('change', updateWeatherKeyVisibility);
        updateWeatherKeyVisibility();

        if (weatherSaveBtn) {
            weatherSaveBtn.addEventListener('click', async () => {
                db.weatherApiSettings = {
                    provider: weatherProviderEl.value,
                    key: weatherKeyEl ? weatherKeyEl.value.trim() : ''
                };
                await saveMainApiSettings();
                showToast('全局天气 API 设置已保存！');
            });
        }
    }

    // === NovelAI 生图 API 设置 ===
    setupNovelAiSettings();

    // === GPT 生图 API 设置 ===
    setupGptImageSettings();

    // === Google、Stability 与跨平台氛围组 ===
    setupAdditionalImageProviders();
    setupImageAtmosphereGroups();

    // === API 设置搜索功能 ===
    const searchInput = document.getElementById('api-settings-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const keyword = e.target.value.trim().toLowerCase();
            const groups = document.querySelectorAll('#api-settings-screen .kkt-group');
            
            groups.forEach(group => {
                let hasMatch = false;
                
                // 检查组标题
                const header = group.querySelector('.collapsible-header');
                const headerText = header ? header.textContent.toLowerCase() : '';
                if (keyword && headerText.includes(keyword)) {
                    hasMatch = true;
                }
                
                // 检查所有项目
                const items = group.querySelectorAll('.kkt-item, .api-presets-embedded');
                items.forEach(item => {
                    const text = item.textContent.toLowerCase();
                    if (!keyword || text.includes(keyword) || hasMatch) {
                        item.style.display = '';
                        if (keyword && text.includes(keyword)) {
                            hasMatch = true;
                        }
                    } else {
                        item.style.display = 'none';
                    }
                });
                
                if (!keyword || hasMatch) {
                    group.style.display = '';
                    // 如果有搜索词且匹配，并且是折叠面板，则展开
                    if (keyword && group.classList.contains('collapsible-section')) {
                        group.classList.add('open');
                    }
                } else {
                    group.style.display = 'none';
                }
            });
        });
    }
}

// 提取为全局函数以便复用
window.fetchAndPopulateGptModels = async (showToastFlag = true) => {
    const urlEl = document.getElementById('gpt-image-url');
    const keyEl = document.getElementById('gpt-image-key');
    const modelEl = document.getElementById('gpt-image-model');
    const modelSelectEl = document.getElementById('gpt-image-model-select');
    const fetchModelsBtn = document.getElementById('gpt-image-fetch-models-btn');

    // 如果是通过自动调用且没有 DOM，尝试从 db 中读取
    const apiUrl = urlEl ? urlEl.value.trim() : (db.gptImageSettings?.url || '');
    const apiKey = keyEl ? keyEl.value.trim() : (db.gptImageSettings?.key || '');

    if (!apiUrl || !apiKey) {
        if (showToastFlag) showToast('请先填写 GPT API 地址和 Key');
        return;
    }

    const blockedDomains = (typeof BLOCKED_API_DOMAINS !== 'undefined') ? BLOCKED_API_DOMAINS : [];
    if (blockedDomains.some(d => apiUrl.includes(d))) {
        if (showToastFlag) showToast('该API站点已被屏蔽');
        return;
    }

    const endpoint = `${apiUrl.replace(/\/$/, '')}/v1/models`;
    let origText = '';
    if (fetchModelsBtn) {
        fetchModelsBtn.disabled = true;
        origText = fetchModelsBtn.textContent;
        fetchModelsBtn.textContent = '拉取中…';
    }

    try {
        const resp = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${apiKey}` } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        const models = (json.data || []).map(m => m.id).filter(Boolean).sort();
        
        if (!models.length) {
            if (showToastFlag) showToast('未找到可用模型');
            if (modelSelectEl) modelSelectEl.innerHTML = '<option value="">未找到任何模型</option>';
            return;
        }

        const cur = modelEl ? modelEl.value : (db.gptImageSettings?.model || '');
        if (modelSelectEl) {
            modelSelectEl.innerHTML = '<option value="">— 请选择 —</option>';
            models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                modelSelectEl.appendChild(opt);
            });
            if (models.includes(cur)) modelSelectEl.value = cur;
        }
        if (showToastFlag) showToast(`成功拉取 ${models.length} 个模型`);
    } catch (err) {
        console.error('[GPT Image] 拉取模型失败:', err);
        if (showToastFlag) showToast('拉取模型失败：' + (err.message || '未知错误'));
        if (modelSelectEl) modelSelectEl.innerHTML = '<option value="">拉取失败</option>';
    } finally {
        if (fetchModelsBtn) {
            fetchModelsBtn.disabled = false;
            fetchModelsBtn.textContent = origText;
        }
    }
};

// --- 预设管理 ---
