async function fetchAiResponse(settings, requestBody, headers, endpoint, forceStream = false) {
    const { provider } = settings;
    const streamEnabled = forceStream || settings.streamEnabled;

    if (requestBody && Array.isArray(requestBody.messages)) {
        requestBody = {
            ...requestBody,
            messages: normalizeMessagesForProvider(requestBody.messages, provider)
        };
    }

    // 1. 针对流式传输调整 Request Body 和 Endpoint
    if (streamEnabled) {
        if (provider === 'gemini') {
            if (endpoint.includes(':generateContent')) {
                endpoint = endpoint.replace(':generateContent', ':streamGenerateContent');
            }
        } else {
            requestBody.stream = true;
        }
    }

    // 2. 发送请求
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`API Error: ${response.status} ${errorText}`);
        error.response = response;
        throw error;
    }

    // 3. 处理响应
    // 优先检查响应头是否指示流式，或者我们是否显式请求了流式
    const contentType = response.headers.get('content-type') || '';
    const isStreamResponse = streamEnabled || contentType.includes('text/event-stream');

    if (isStreamResponse) {
        return await readStreamResponse(response, provider);
    } else {
        // 普通 JSON 响应 (带容错处理)
        const text = await response.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            // JSON 解析失败。检查是否是 SSE 格式的文本 (针对未设置 header 的流式响应)
            if (text.includes('data: ')) {
                console.warn("Received SSE response without header, parsing as text...");
                let fallbackContent = "";
                const lines = text.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                        try {
                            const json = JSON.parse(line.substring(6));
                            fallbackContent += json.choices[0].delta?.content || "";
                        } catch (e2) {}
                    }
                }
                if (fallbackContent) return fallbackContent;
            }
            throw new Error(`Failed to parse JSON response: ${text.substring(0, 100)}...`);
        }

        if (provider === 'gemini') {
            return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
            return data.choices[0].message.content;
        }
    }
}

async function readStreamResponse(response, provider) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = "";
    let accumulatedChunk = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulatedChunk += decoder.decode(value, { stream: true });

        if (provider !== 'gemini') {
            // OpenAI / Standard SSE logic
            const parts = accumulatedChunk.split("\n\n");
            accumulatedChunk = parts.pop();
            for (const part of parts) {
                if (part.startsWith("data: ")) {
                    const data = part.substring(6);
                    if (data.trim() !== "[DONE]") {
                        try {
                            const json = JSON.parse(data);
                            fullResponse += json.choices[0].delta?.content || "";
                        } catch (e) {}
                    }
                }
            }
        }
    }

    // Handle remaining chunk for OpenAI
    if (provider !== 'gemini' && accumulatedChunk && accumulatedChunk.trim().length > 0) {
         if (accumulatedChunk.startsWith("data: ")) {
             const data = accumulatedChunk.substring(6);
             if (data.trim() !== "[DONE]") {
                 try {
                     const json = JSON.parse(data);
                     fullResponse += json.choices[0].delta?.content || "";
                 } catch (e) {}
             }
         }
    }

    // Gemini logic (accumulate all and parse at the end)
    if (provider === 'gemini') {
        try {
            // 尝试解析为 JSON 数组
            const parsedStream = JSON.parse(accumulatedChunk);
            if (Array.isArray(parsedStream)) {
                fullResponse = parsedStream.map(item => item.candidates?.[0]?.content?.parts?.[0]?.text || "").join('');
            }
        } catch (e) {
            console.error("Gemini stream parsing failed", e);
        }
    }

    return fullResponse;
}

// --- 图片查看器 ---
function openImageViewer(src, msgId = null) {
    const modal = document.getElementById('full-image-modal');
    const img = document.getElementById('full-image-view');
    const closeBtn = document.getElementById('close-full-image-btn');
    const downloadBtn = document.getElementById('download-full-image-btn');
    const regenBtn = document.getElementById('regen-full-image-btn');
    const editBtn = document.getElementById('edit-full-image-btn');
    const logsBtn = document.getElementById('logs-full-image-btn');
    const versionSwitcher = document.getElementById('full-image-version-switcher');
    const prevVersionBtn = document.getElementById('full-image-prev-version-btn');
    const nextVersionBtn = document.getElementById('full-image-next-version-btn');
    const versionText = document.getElementById('full-image-version-text');
    
    if (!modal || !img) return;
    
    img.src = src;
    modal.classList.add('visible');

    // 查找消息对象
    let msgObj = null;
    let chatObj = null;
    if (msgId && typeof currentChatId !== 'undefined' && typeof currentChatType !== 'undefined') {
        chatObj = currentChatType === 'private' ? db.characters.find(c => c.id === currentChatId) : db.groups.find(g => g.id === currentChatId);
        if (chatObj && chatObj.history) {
            msgObj = chatObj.history.find(m => m.id === msgId);
        }
    }

    // 处理图片版本切换逻辑
    let versionsCount = 1;
    let currentIdx = 0;
    
    const updateVersionUI = () => {
        if (versionsCount > 1) {
            versionSwitcher.style.display = 'flex';
            versionText.textContent = `${currentIdx + 1} / ${versionsCount}`;
        } else {
            versionSwitcher.style.display = 'none';
        }
    };

    if (msgObj && msgObj._imageVersions && msgObj._imageVersions.length > 0) {
        versionsCount = msgObj._imageVersions.length + (msgObj.novelAiImageUrl ? 1 : 0);
        currentIdx = msgObj._currentImageIndex !== undefined ? msgObj._currentImageIndex : versionsCount - 1;
        updateVersionUI();
    } else {
        if (versionSwitcher) versionSwitcher.style.display = 'none';
    }

    const handleVersionSwitch = (dir, event) => {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        if (versionsCount <= 1 || !msgObj) return;

        currentIdx += dir;
        if (currentIdx < 0) currentIdx = versionsCount - 1;
        if (currentIdx >= versionsCount) currentIdx = 0;

        msgObj._currentImageIndex = currentIdx;
        
        // 更新全屏图片显示
        if (currentIdx < msgObj._imageVersions.length) {
            img.src = msgObj._imageVersions[currentIdx].imageUrl;
        } else {
            img.src = msgObj.novelAiImageUrl;
        }
        
        updateVersionUI();
        
        // 顺便保存和更新背景的聊天气泡，保持同步
        if (typeof saveData === 'function') saveData();
        if (typeof renderMessages === 'function') renderMessages(false, false);
    };

    // 清理旧事件监听，防止多次绑定
    if (prevVersionBtn) {
        prevVersionBtn.onclick = (e) => handleVersionSwitch(-1, e);
    }
    if (nextVersionBtn) {
        nextVersionBtn.onclick = (e) => handleVersionSwitch(1, e);
    }

    // 根据消息状态显示/隐藏高级按钮
    const isAiGenerated = msgObj && (msgObj.novelAiImageUrl || msgObj.novelAiError || msgObj.isNovelAiGenerating || (msgObj.content && msgObj.content.match(/\[.*?发来的照片\/视频[：:]([\s\S]+?)\]/)));

    if (regenBtn) regenBtn.style.display = isAiGenerated ? 'flex' : 'none';
    if (editBtn) editBtn.style.display = isAiGenerated ? 'flex' : 'none';
    if (logsBtn) logsBtn.style.display = isAiGenerated ? 'flex' : 'none';
    
    // 简单的关闭逻辑
    const closeModal = () => {
        modal.classList.remove('visible');
        setTimeout(() => { img.src = ''; }, 300); // 动画结束后清空
    };
    
    if (closeBtn) closeBtn.onclick = closeModal;

    if (regenBtn && isAiGenerated) {
        regenBtn.onclick = (e) => {
            e.stopPropagation();
            if (typeof window.retryImageGen === 'function') {
                window.retryImageGen(msgId, currentChatId, currentChatType);
                closeModal();
                if (typeof showToast === 'function') showToast('已加入重新生成队列...');
            }
        };
    }

    if (editBtn && isAiGenerated) {
        editBtn.onclick = (e) => {
            e.stopPropagation();
            const editModal = document.getElementById('edit-image-prompt-modal');
            const textarea = document.getElementById('edit-image-prompt-textarea');
            const confirmBtn = document.getElementById('edit-image-prompt-confirm-btn');
            const cancelBtn = document.getElementById('edit-image-prompt-cancel-btn');

            if (!editModal || !textarea) return;

            // 提取提示词
            const pvMatch = msgObj.content.match(/\[.*?发来的照片\/视频[：:]([\s\S]+?)\]/);
            let originalPrompt = pvMatch ? pvMatch[1].trim() : '';

            // 去掉 {{ }} 包装以便于编辑
            const tagMatch = originalPrompt.match(/\{\{([\s\S]+?)\}\}/);
            if (tagMatch) originalPrompt = tagMatch[1].trim();

            textarea.value = originalPrompt;
            editModal.classList.add('visible');

            const closeEditModal = () => {
                editModal.classList.remove('visible');
            };

            cancelBtn.onclick = closeEditModal;

            confirmBtn.onclick = () => {
                const newPrompt = textarea.value.trim();
                if (!newPrompt) {
                    if (typeof showToast === 'function') showToast('提示词不能为空');
                    return;
                }

                // 更新消息内容，保留消息包装格式
                if (pvMatch) {
                    msgObj.content = msgObj.content.replace(pvMatch[1], `{{${newPrompt}}}`);
                } else {
                    // 如果由于某种原因正则没有匹配上，直接替换整个内容，并加上照片包装
                    const senderName = msgObj.role === 'assistant' ? (chatObj.remarkName || chatObj.name || 'AI') : '你';
                    msgObj.content = `[${senderName}发来的照片/视频：{{${newPrompt}}}]`;
                }

                if (typeof saveData === 'function') saveData();
                if (typeof window.retryImageGen === 'function') {
                    window.retryImageGen(msgId, currentChatId, currentChatType);
                }
                
                closeEditModal();
                closeModal();
                if (typeof showToast === 'function') showToast('已保存新提示词并重新生成...');
            };
        };
    }

    if (logsBtn && isAiGenerated) {
        logsBtn.onclick = (e) => {
            e.stopPropagation();
            if (msgObj.novelAiError) {
                if (typeof showErrorModal === 'function') {
                    showErrorModal('生图出错了', new Error(msgObj.novelAiError));
                }
            } else {
                const logModal = document.getElementById('image-log-modal');
                const logContent = document.getElementById('image-log-content');
                const closeLogBtn = document.getElementById('close-image-log-btn');

                if (!logModal || !logContent) return;

                let engine = '未知';
                if (db.novelAiSettings && db.novelAiSettings.enabled) engine = 'novelai';
                if (db.gptImageSettings && db.gptImageSettings.enabled) engine = 'gpt';

                const pvMatch = msgObj.content.match(/\[.*?发来的照片\/视频[：:]([\s\S]+?)\]/);
                let promptRaw = pvMatch ? pvMatch[1].trim() : msgObj.content;
                let finalPrompt = promptRaw;

                const tagMatch = promptRaw.match(/\{\{([\s\S]+?)\}\}/);
                if (tagMatch) finalPrompt = tagMatch[1].trim();

                let logText = `引擎: ${engine.toUpperCase()}\n状态: 成功\n\n[提取的提示词]\n${finalPrompt}`;
                
                if (engine === 'novelai' && db.novelAiSettings) {
                    if (db.novelAiSettings.systemPrompt) logText += `\n\n[系统附加词]\n${db.novelAiSettings.systemPrompt}`;
                    if (db.novelAiSettings.artistTags) logText += `\n\n[画师附加词]\n${db.novelAiSettings.artistTags}`;
                    if (db.novelAiSettings.negativePrompt) logText += `\n\n[负面提示词]\n${db.novelAiSettings.negativePrompt}`;
                } else if (engine === 'gpt' && db.gptImageSettings) {
                    if (db.gptImageSettings.systemPrompt) logText += `\n\n[系统附加词]\n${db.gptImageSettings.systemPrompt}`;
                    if (db.gptImageSettings.negativePrompt) logText += `\n\n[负面提示词]\n${db.gptImageSettings.negativePrompt}`;
                }

                logContent.textContent = logText;
                logModal.classList.add('visible');

                if (closeLogBtn) {
                    closeLogBtn.onclick = () => {
                        logModal.classList.remove('visible');
                    };
                }
            }
        };
    }
    
    if (downloadBtn) {
        downloadBtn.onclick = async (e) => {
            e.stopPropagation(); // 阻止事件冒泡到 modal 上导致关闭
            try {
                // 判断是不是 base64
                if (src.startsWith('data:')) {
                    const a = document.createElement('a');
                    a.href = src;
                    a.download = `OVO_Image_${Date.now()}.png`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                } else {
                    // 如果是普通 url，为了避免跨域问题和能在浏览器直接下载，使用 fetch
                    const response = await fetch(src);
                    const blob = await response.blob();
                    const dlUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = dlUrl;
                    const extension = blob.type.split('/')[1] || 'png';
                    a.download = `OVO_Image_${Date.now()}.${extension}`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(dlUrl);
                }
                showToast('✅ 图片已下载');
            } catch (err) {
                console.error('下载图片失败:', err);
                showToast('❌ 下载失败，可能是跨域问题，请长按图片保存');
            }
        };
    }
    
    modal.onclick = (e) => {
        if (e.target === modal || e.target.closest('.modal-window')) {
            // 忽略对按钮的点击
            const isActionButton = [downloadBtn, closeBtn, regenBtn, editBtn, logsBtn].some(btn => btn && (e.target === btn || btn.contains(e.target)));
            if (!isActionButton && e.target !== img) {
                closeModal();
            }
        }
    };
}

// === NovelAI 生图 API ===

// Blob 转 DataURL 辅助函数
function _nai_blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// 从 ZIP Blob 中提取图片，返回 DataURL
async function _nai_extractPngFromZipBlob(zipBlob) {
    const arrayBuffer = await zipBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // 在 zip 字节流中定位 PNG 签名 (89 50 4E 47)
    let pngStart = -1;
    for (let i = 0; i < uint8.length - 8; i++) {
        if (uint8[i] === 0x89 && uint8[i+1] === 0x50 && uint8[i+2] === 0x4E && uint8[i+3] === 0x47) {
            pngStart = i;
            break;
        }
    }

    if (pngStart >= 0) {
        // 找到 PNG IEND 标记来精确截取
        let pngEnd = uint8.length;
        for (let i = pngStart + 8; i < uint8.length - 8; i++) {
            // IEND chunk: 49 45 4E 44
            if (uint8[i] === 0x49 && uint8[i+1] === 0x45 && uint8[i+2] === 0x4E && uint8[i+3] === 0x44) {
                pngEnd = i + 8; // IEND(4) + CRC(4)
                break;
            }
        }
        const pngBlob = new Blob([uint8.slice(pngStart, pngEnd)], { type: 'image/png' });
        return await _nai_blobToDataUrl(pngBlob);
    }

    // 没找到 PNG，尝试找 JPEG 签名 (FF D8 FF)
    for (let i = 0; i < uint8.length - 3; i++) {
        if (uint8[i] === 0xFF && uint8[i+1] === 0xD8 && uint8[i+2] === 0xFF) {
            const jpgBlob = new Blob([uint8.slice(i)], { type: 'image/jpeg' });
            return await _nai_blobToDataUrl(jpgBlob);
        }
    }

    // 都找不到，直接当整个文件转
    return await _nai_blobToDataUrl(zipBlob);
}

// 从 base64 字符串解析为图片 DataURL
function _nai_resolveBase64Image(b64) {
    if (!b64) return null;
    if (b64.startsWith('http')) return b64;
    if (b64.startsWith('data:image')) return b64;
    if (b64.startsWith('iVBOR')) return `data:image/png;base64,${b64}`;
    if (b64.startsWith('/9j/')) return `data:image/jpeg;base64,${b64}`;
    return `data:image/png;base64,${b64}`;
}

/**
 * 调用 GPT (DALL-E格式) 图像生成 API
 * @param {string} prompt - 提示词
 * @param {object} [overrideSettings] - 可选，覆盖 db.gptImageSettings 的参数
 * @returns {Promise<{imageUrl: string}>} - 返回图片 URL 或 DataURL
 */
async function generateGptImage(prompt, overrideSettings = {}, signal = null) {
    const settings = Object.assign({}, db.gptImageSettings || {}, overrideSettings);
    const url = settings.url;
    const key = settings.key;
    if (!url) throw new Error('GPT生图 API URL 未配置');
    if (!key) throw new Error('GPT生图 API Key 未配置');
    if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

    const model = settings.model || 'dall-e-3';
    
    // 优先读取角色覆盖尺寸
    let finalSize = settings.size;
    if (typeof currentChatId !== 'undefined' && typeof currentChatType !== 'undefined' && currentChatType === 'private') {
        const charObj = typeof db !== 'undefined' && db.characters ? db.characters.find(c => c.id === currentChatId) : null;
        if (charObj && charObj.gptImageSizeOverride && charObj.gptImageSizeOverride.trim() !== '') {
            finalSize = charObj.gptImageSizeOverride;
        }
    }
    
    let defaultSize = '512x512';
    if (db.gptImageSettings && Object.keys(db.gptImageSettings).length > 0 && !db.gptImageSettings.size) {
        defaultSize = '1024x1024';
    }
    const size = finalSize || defaultSize;
    const systemPrompt = settings.systemPrompt || '';
    const negativePrompt = settings.negativePrompt || '';

    // 智能拼接提示词
    const promptParts = [];
    if (systemPrompt) promptParts.push(systemPrompt);
    
    if (typeof currentChatId !== 'undefined' && typeof currentChatType !== 'undefined' && currentChatType === 'private') {
        const charObj = typeof db !== 'undefined' && db.characters ? db.characters.find(c => c.id === currentChatId) : null;
        if (charObj && charObj.gptArtistPrompt) {
            promptParts.push(charObj.gptArtistPrompt);
        }
    }
    
    promptParts.push(prompt.trim());
    
    let finalPrompt = promptParts.filter(Boolean).join(', ');
    if (negativePrompt) finalPrompt = `${finalPrompt} --no ${negativePrompt}`;

    const endpoint = url.endsWith('/') ? `${url}v1/images/generations` : `${url}/v1/images/generations`;

    console.log('[GPT Image] 发送生图请求:', { endpoint, model, size, prompt: finalPrompt });

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key.trim()}`
        },
        body: JSON.stringify({
            model: model,
            prompt: finalPrompt,
            n: 1,
            size: size,
            response_format: 'b64_json'
        }),
        signal: signal
    });

    if (!response.ok) {
        let errDetail = '';
        try {
            const errObj = await response.json();
            errDetail = errObj.error?.message || JSON.stringify(errObj);
        } catch (_) {
            errDetail = await response.text();
        }
        console.error(`[GPT Image] API 错误 (${response.status}):`, errDetail);
        throw new Error(`API 返回错误 (${response.status}): ${errDetail.substring(0, 100)}`);
    }

    const data = await response.json();
    if (!data.data || !data.data[0]) {
        throw new Error('响应格式错误，未找到图片数据');
    }

    // 支持 url 或 b64_json
    let imageUrl = data.data[0].url;
    if (!imageUrl && data.data[0].b64_json) {
        imageUrl = _nai_resolveBase64Image(data.data[0].b64_json);
    }

    if (!imageUrl) {
        throw new Error('响应数据中没有有效的图片链接或Base64数据');
    }

    console.log('[GPT Image] ✅ 生图成功');
    return { imageUrl };
}

/**
 * 统一的生图路由分发函数
 * 根据用户在全局设置中选择的引擎，自动调用 NovelAI 或 GPT
 * @param {string} prompt - 提示词
 * @returns {Promise<{imageUrl: string}>} - 返回生成的图片 DataURL/URL
 */
async function generateImageDispatch(prompt, signal = null) {
    const gptEnabled = db.gptImageSettings && db.gptImageSettings.enabled;
    const naiEnabled = db.novelAiSettings && db.novelAiSettings.enabled;

    if (gptEnabled) {
        return generateGptImage(prompt, {}, signal);
    } else if (naiEnabled) {
        return generateNovelAiImage(prompt, {}, signal);
    } else {
        throw new Error('未开启任何生图引擎，请在设置中开启 NovelAI生图 或 GPT生图');
    }
}

/**
 * 调用 NovelAI 图像生成 API
 * @param {string} prompt - 正面提示词 (英文 tag)
 * @param {object} [overrideSettings] - 可选，覆盖 db.novelAiSettings 的参数
 * @returns {Promise<{imageUrl: string}>} - 返回图片 DataURL
 */
async function generateNovelAiImage(prompt, overrideSettings = {}, signal = null) {
    const settings = Object.assign({}, db.novelAiSettings || {}, overrideSettings);
    const token = settings.token;
    if (!token) throw new Error('NovelAI Token 未配置');
    if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

    // 清理 Token 中可能的特殊字符
    const cleanToken = token.trim().replace(/[^\x20-\x7E]/g, '');

    const customUrlEnabled = settings.customUrlEnabled || false;
    const customUrl = (settings.customUrl || '').trim();

    let model = settings.model || 'nai-diffusion-4-curated-preview';
    const resolution = settings.resolution || '832x1216';
    const [widthStr, heightStr] = resolution.split('x');
    const width = parseInt(widthStr) || 832;
    const height = parseInt(heightStr) || 1216;
    const sampler = settings.sampler || 'k_euler';
    const steps = settings.steps || 28;
    const scale = settings.scale || 5;
    const systemPrompt = settings.systemPrompt || '';
    const artistTags = settings.artistTags || '';
    const negativePrompt = settings.negativePrompt || '';

    // 拼接最终 prompt：系统基础 Prompt + 画师串 + 用户 prompt
    const promptParts = [];
    if (systemPrompt) promptParts.push(systemPrompt);
    if (artistTags) promptParts.push(artistTags);
    promptParts.push(prompt);
    const fullPrompt = promptParts.filter(Boolean).join(', ');

    console.log('[NovelAI] 最终 Prompt:', fullPrompt);

    // inpainting 模型不能直接生成，回退到同版本普通模型
    if (model === 'nai-diffusion-3-inpainting') model = 'nai-diffusion-3';

    // 判断是否为 V4 模型
    const isV4 = model.includes('nai-diffusion-4');
    const commonSeed = Math.floor(Math.random() * 9999999999);

    // 根据模型版本构建不同的请求体
    let requestBody;
    if (isV4) {
        requestBody = {
            input: fullPrompt,
            model: model,
            action: 'generate',
            parameters: {
                params_version: 3,
                width, height, scale, sampler, steps,
                seed: commonSeed,
                n_samples: 1,
                ucPreset: 0,
                qualityToggle: true,
                autoSmea: false,
                dynamic_thresholding: false,
                controlnet_strength: 1,
                legacy: false,
                add_original_image: true,
                cfg_rescale: 0,
                noise_schedule: 'karras',
                legacy_v3_extend: false,
                skip_cfg_above_sigma: null,
                use_coords: false,
                legacy_uc: false,
                normalize_reference_strength_multiple: true,
                characterPrompts: [],
                v4_prompt: {
                    caption: { base_caption: fullPrompt, char_captions: [] },
                    use_coords: false,
                    use_order: true
                },
                v4_negative_prompt: {
                    caption: { base_caption: negativePrompt, char_captions: [] },
                    legacy_uc: false
                },
                negative_prompt: negativePrompt,
                deliberate_euler_ancestral_bug: false,
                prefer_brownian: true
            }
        };
    } else {
        // V3 请求格式
        requestBody = {
            input: fullPrompt,
            model: model,
            action: 'generate',
            parameters: {
                width, height, scale, sampler, steps,
                seed: commonSeed,
                n_samples: 1,
                ucPreset: 0,
                qualityToggle: true,
                sm: false,
                sm_dyn: false,
                dynamic_thresholding: false,
                controlnet_strength: 1,
                legacy: false,
                add_original_image: false,
                cfg_rescale: 0,
                noise_schedule: 'native',
                negative_prompt: negativePrompt
            }
        };
    }

    // 确定 API 地址
    let apiUrl = '';
    if (customUrlEnabled && customUrl) {
        apiUrl = customUrl;
        // 智能拼接端点路径（如果用户只填了 Base URL）
        if (!apiUrl.includes('/ai/generate-image')) {
            apiUrl = apiUrl.replace(/\/$/, ''); // 移除末尾斜杠
            apiUrl += isV4 ? '/ai/generate-image-stream' : '/ai/generate-image';
        }
    } else {
        // V4 使用 stream 端点，V3 使用普通端点
        apiUrl = isV4
            ? 'https://image.novelai.net/ai/generate-image-stream'
            : 'https://image.novelai.net/ai/generate-image';
    }

    console.log('[NovelAI] 发送生图请求:', { apiUrl, model, isV4, width, height, steps, scale, sampler });

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanToken}`
        },
        body: JSON.stringify(requestBody),
        signal: signal
    });

    console.log(`[NovelAI] 响应状态: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
        let errDetail = '';
        try {
            const errText = await response.text();
            try { const errObj = JSON.parse(errText); errDetail = errObj.message || errObj.error || errText.substring(0, 150); }
            catch (_) { errDetail = errText.substring(0, 150); }
        } catch (_) {}
        console.error(`[NovelAI] API 错误 (${response.status}): ${errDetail}`);
        if (response.status === 401) throw new Error('Token 无效或已过期');
        if (response.status === 402) throw new Error('Anlas 额度不足');
        if (response.status === 429) throw new Error('请求过于频繁，请稍后再试');
        throw new Error(`API 返回错误 (${response.status}): ${errDetail}`);
    }

    // === 根据响应 Content-Type 选择解析策略 ===
    const contentType = response.headers.get('content-type') || '';
    let imageDataUrl = null;

    if (contentType.includes('text/event-stream') || contentType.includes('application/x-ndjson')) {
        // === V4 SSE 流式响应 ===
        console.log('[NovelAI] 解析 SSE 流式响应...');
        const sseText = await response.text();
        const lines = sseText.trim().split('\n');

        // 从后往前扫描，找到最终的图片数据
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;

            const payload = line.substring(6);
            try {
                const obj = JSON.parse(payload);
                // 检查是否有 URL 字段
                if (obj.output && Array.isArray(obj.output) && obj.output[0] && obj.output[0].url) {
                    imageDataUrl = obj.output[0].url; break;
                }
                if (obj.url) { imageDataUrl = obj.url; break; }
                // 检查 base64 字段
                const b64 = (obj.event_type === 'final' && obj.image) ? obj.image : (obj.data || obj.image);
                if (b64) {
                    imageDataUrl = _nai_resolveBase64Image(b64);
                    if (!imageDataUrl) {
                        // 可能是 zip 的 base64，解码后提取
                        const raw = atob(b64);
                        const bytes = new Uint8Array(raw.length);
                        for (let j = 0; j < raw.length; j++) bytes[j] = raw.charCodeAt(j);
                        imageDataUrl = await _nai_extractPngFromZipBlob(new Blob([bytes]));
                    }
                    break;
                }
            } catch (e) {
                // 非 JSON，当成原始 base64 尝试
                if (payload.length > 100) {
                    imageDataUrl = _nai_resolveBase64Image(payload);
                    break;
                }
            }
        }

        if (!imageDataUrl) {
            console.error('[NovelAI] SSE 响应中未找到图片数据, 前500字符:', sseText.substring(0, 500));
            throw new Error('SSE 响应中未找到图片数据');
        }

    } else if (contentType.includes('application/json')) {
        // === JSON 响应（某些代理会返回 JSON） ===
        console.log('[NovelAI] 解析 JSON 响应...');
        const jsonData = await response.json();
        if (jsonData.output && jsonData.output[0] && jsonData.output[0].url) {
            imageDataUrl = jsonData.output[0].url;
        } else if (jsonData.url) {
            imageDataUrl = jsonData.url;
        } else {
            const b64 = jsonData.image || jsonData.data;
            if (b64) {
                imageDataUrl = _nai_resolveBase64Image(b64);
            }
        }
        if (!imageDataUrl) {
            throw new Error('JSON 响应中未找到图片数据');
        }

    } else {
        // === 默认当 ZIP / 二进制 Blob 处理（V3 常见）===
        console.log('[NovelAI] 解析二进制/ZIP 响应...');
        const blob = await response.blob();
        if (blob.type && blob.type.startsWith('image/')) {
            imageDataUrl = await _nai_blobToDataUrl(blob);
        } else {
            imageDataUrl = await _nai_extractPngFromZipBlob(blob);
        }
    }

    if (!imageDataUrl) {
        throw new Error('未能从响应中获取图片');
    }

    // 将普通 URL 转换为 DataURL 以实现持久化本地缓存，防止过期裂图
    if (imageDataUrl.startsWith('http')) {
        try {
            console.log('[NovelAI] 尝试将返回的 URL 图片持久化为 Base64...');
            const imgRes = await fetch(imageDataUrl, { signal });
            const imgBlob = await imgRes.blob();
            imageDataUrl = await _nai_blobToDataUrl(imgBlob);
        } catch (e) {
            console.warn('[NovelAI] 图片 URL 转 Base64 失败，使用原链接:', e);
        }
    }

    console.log('[NovelAI] ✅ 生图成功');
    return { imageUrl: imageDataUrl };
}

/**
 * 使用已保存的 NovelAI 设置生成图片（便捷方法）
 * @param {string} prompt - 正面提示词
 * @returns {Promise<{imageUrl: string}>}
 */
async function novelAiGenerate(prompt) {
    if (!db.novelAiSettings || !db.novelAiSettings.enabled) {
        throw new Error('NovelAI 生图未启用，请在 API 设置中开启');
    }
    return generateNovelAiImage(prompt);
}

// 暴露给全局
window.showErrorModal = showErrorModal;
window.openImageViewer = openImageViewer;
window.getRandomValue = getRandomValue;
window.pad = pad;
window.formatTimeGap = formatTimeGap;
window.getLocalTimeInTimezone = getLocalTimeInTimezone;
window.filterHistoryForAI = filterHistoryForAI;
window.showToast = showToast;
window.showAppConfirmDialog = showAppConfirmDialog;
window.playSound = (typeof playSound !== 'undefined') ? playSound : null; // 防止循环依赖
window.generateGptImage = generateGptImage;
window.generateImageDispatch = generateImageDispatch;
window.generateNovelAiImage = generateNovelAiImage;
window.novelAiGenerate = novelAiGenerate;
window.writeOvoPngMetadata = writeOvoPngMetadata;
window.readOvoPngMetadata = readOvoPngMetadata;
