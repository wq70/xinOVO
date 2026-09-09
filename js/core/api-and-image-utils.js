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

                let engine = msgObj.imageGenerationMeta?.provider || db.activeImageProvider || '未知';

                const pvMatch = msgObj.content.match(/\[.*?发来的照片\/视频[：:]([\s\S]+?)\]/);
                let promptRaw = pvMatch ? pvMatch[1].trim() : msgObj.content;
                let finalPrompt = promptRaw;

                const tagMatch = promptRaw.match(/\{\{([\s\S]+?)\}\}/);
                if (tagMatch) finalPrompt = tagMatch[1].trim();

                let logText = `引擎: ${engine.toUpperCase()}\n状态: 成功`;
                if (msgObj.imageGenerationMeta?.model) logText += `\n模型: ${msgObj.imageGenerationMeta.model}`;
                if (msgObj.imageGenerationMeta?.size) logText += `\n尺寸/比例: ${msgObj.imageGenerationMeta.size}`;
                if (msgObj.imageGenerationMeta?.seed != null) logText += `\nSeed: ${msgObj.imageGenerationMeta.seed}`;
                if (msgObj.imageGenerationMeta?.atmosphere) logText += `\n氛围组: ${msgObj.imageGenerationMeta.atmosphere}`;
                logText += `\n\n[提取的提示词]\n${finalPrompt}`;
                
                if (engine === 'novelai' && db.novelAiSettings) {
                    if (db.novelAiSettings.systemPrompt) logText += `\n\n[系统附加词]\n${db.novelAiSettings.systemPrompt}`;
                    if (db.novelAiSettings.artistTags) logText += `\n\n[画师附加词]\n${db.novelAiSettings.artistTags}`;
                    if (db.novelAiSettings.negativePrompt) logText += `\n\n[负面提示词]\n${db.novelAiSettings.negativePrompt}`;
                } else if (engine === 'gpt' && db.gptImageSettings) {
                    if (db.gptImageSettings.systemPrompt) logText += `\n\n[系统附加词]\n${db.gptImageSettings.systemPrompt}`;
                    if (db.gptImageSettings.negativePrompt) logText += `\n\n[负面提示词]\n${db.gptImageSettings.negativePrompt}`;
                } else if (engine === 'google' && db.googleImageSettings) {
                    if (db.googleImageSettings.systemPrompt) logText += `\n\n[系统附加词]\n${db.googleImageSettings.systemPrompt}`;
                    if (db.googleImageSettings.negativePrompt) logText += `\n\n[避免内容]\n${db.googleImageSettings.negativePrompt}`;
                } else if (engine === 'stability' && db.stabilityImageSettings) {
                    if (db.stabilityImageSettings.systemPrompt) logText += `\n\n[系统附加词]\n${db.stabilityImageSettings.systemPrompt}`;
                    if (db.stabilityImageSettings.negativePrompt) logText += `\n\n[负面提示词]\n${db.stabilityImageSettings.negativePrompt}`;
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

    // 标准 ZIP 中图片通常经过 deflate 压缩，不能只在压缩字节里搜索 PNG 签名。
    const view = new DataView(arrayBuffer);
    for (let offset = 0; offset <= uint8.length - 46; offset++) {
        if (view.getUint32(offset, true) !== 0x02014b50) continue;
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const fileNameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const fileName = new TextDecoder().decode(uint8.slice(offset + 46, offset + 46 + fileNameLength));
        if (/\.(?:png|jpe?g|webp)$/i.test(fileName) && localOffset + 30 <= uint8.length && view.getUint32(localOffset, true) === 0x04034b50) {
            const localNameLength = view.getUint16(localOffset + 26, true);
            const localExtraLength = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            const compressed = uint8.slice(dataStart, dataStart + compressedSize);
            let imageBytes = compressed;
            if (method === 8 && typeof DecompressionStream !== 'undefined') {
                const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                imageBytes = new Uint8Array(await new Response(stream).arrayBuffer());
            } else if (method !== 0) {
                offset += 45 + fileNameLength + extraLength + commentLength;
                continue;
            }
            const mime = /\.jpe?g$/i.test(fileName) ? 'image/jpeg' : /\.webp$/i.test(fileName) ? 'image/webp' : 'image/png';
            return _nai_blobToDataUrl(new Blob([imageBytes], { type: mime }));
        }
        offset += 45 + fileNameLength + extraLength + commentLength;
    }

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
function _image_base64Kind(b64) {
    const value = String(b64 || '').replace(/^data:[^,]+,/, '').trim();
    if (value.startsWith('iVBOR')) return 'image/png';
    if (value.startsWith('/9j/')) return 'image/jpeg';
    if (value.startsWith('UklGR')) return 'image/webp';
    if (value.startsWith('R0lGOD')) return 'image/gif';
    if (value.startsWith('UEsDB')) return 'application/zip';
    return '';
}

function _nai_resolveBase64Image(b64) {
    if (!b64 || typeof b64 !== 'string') return null;
    const value = b64.trim();
    if (/^https?:\/\//i.test(value) || value.startsWith('blob:')) return value;
    if (value.startsWith('data:image/')) return value;
    const mime = _image_base64Kind(value);
    return mime.startsWith('image/') ? `data:${mime};base64,${value.replace(/^data:[^,]+,/, '')}` : null;
}

function _image_base64ToBlob(b64, mimeType) {
    const value = String(b64 || '').replace(/^data:[^,]+,/, '').replace(/\s/g, '');
    const raw = atob(value);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || _image_base64Kind(value) || 'application/octet-stream' });
}

async function _image_resolveCandidate(candidate) {
    if (!candidate) return null;
    if (typeof candidate === 'object') {
        candidate = candidate.url || candidate.b64_json || candidate.base64 || candidate.image || candidate.data;
    }
    if (typeof candidate !== 'string') return null;
    const value = candidate.trim();
    if (/^https?:\/\//i.test(value) || value.startsWith('blob:') || value.startsWith('data:image/')) return value;
    const kind = _image_base64Kind(value);
    if (kind === 'application/zip') return _nai_extractPngFromZipBlob(_image_base64ToBlob(value, kind));
    return _nai_resolveBase64Image(value);
}

async function _image_extractFromJson(data) {
    const candidates = [
        Array.isArray(data?.data) ? data.data[0] : data?.data,
        data?.output?.[0], data?.images?.[0], data?.result?.images?.[0],
        data?.result?.image, data?.result, data?.image, data?.url, data?.b64_json
    ];
    for (const candidate of candidates) {
        const resolved = await _image_resolveCandidate(candidate);
        if (resolved) return resolved;
    }
    return null;
}

function _imageJoinUrl(base, path) {
    const value = String(base || '').trim();
    if (!value) return '';
    if (/\/(?:images\/generations|generateContent|generate\/core|generate\/ultra)(?:\?|$)/i.test(value)) return value;
    if (value.replace(/\/$/, '').endsWith('/v1') && path.startsWith('/v1/')) return value.replace(/\/$/, '') + path.slice(3);
    return value.replace(/\/$/, '') + path;
}

function _imageGetAtmosphere(provider) {
    const groups = Array.isArray(db?.imageAtmosphereGroups) ? db.imageAtmosphereGroups : [];
    const group = groups.find(item => item && item.id === db.activeImageAtmosphereId && item.enabled !== false);
    if (!group) return { prompt: '', negativePrompt: '', name: '' };
    const providerPrompt = group.providerPrompts && group.providerPrompts[provider];
    return {
        name: group.name || '',
        prompt: [group.prompt, providerPrompt].filter(Boolean).join(', '),
        negativePrompt: group.negativePrompt || ''
    };
}

function _imageMergePrompt(basePrompt, provider, systemPrompt, negativePrompt) {
    const atmosphere = _imageGetAtmosphere(provider);
    return {
        prompt: [systemPrompt, atmosphere.prompt, basePrompt].filter(Boolean).join(', '),
        negativePrompt: [negativePrompt, atmosphere.negativePrompt].filter(Boolean).join(', '),
        atmosphere: atmosphere.name
    };
}

async function _imageReadError(response, providerName) {
    let detail = '';
    try {
        const text = await response.text();
        try {
            const json = JSON.parse(text);
            detail = json?.error?.message || json?.message || json?.error || json?.code || text;
        } catch (_) {
            detail = text;
        }
    } catch (_) {}
    detail = String(detail || '').replace(/(?:Bearer\s*;?\s*|sk-)[A-Za-z0-9._-]{8,}/gi, '[已隐藏密钥]').slice(0, 300);
    if (response.status === 401 || response.status === 403) return new Error(`${providerName} 鉴权失败，请检查密钥和服务权限 (${response.status})`);
    if (response.status === 402) return new Error(`${providerName} 额度不足 (402)`);
    if (response.status === 429) return new Error(`${providerName} 请求过于频繁，请稍后再试 (429)`);
    return new Error(`${providerName} 请求失败 (${response.status})${detail ? `：${detail}` : ''}`);
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

    // 智能拼接提示词（保留旧系统词与角色画师词，并追加当前氛围组）
    const promptParts = [];
    if (systemPrompt) promptParts.push(systemPrompt);
    
    if (typeof currentChatId !== 'undefined' && typeof currentChatType !== 'undefined' && currentChatType === 'private') {
        const charObj = typeof db !== 'undefined' && db.characters ? db.characters.find(c => c.id === currentChatId) : null;
        if (charObj && charObj.gptArtistPrompt) {
            promptParts.push(charObj.gptArtistPrompt);
        }
    }
    
    promptParts.push(prompt.trim());

    const merged = _imageMergePrompt(promptParts.filter(Boolean).join(', '), 'gpt', '', negativePrompt);
    let finalPrompt = merged.prompt;
    if (merged.negativePrompt) finalPrompt = `${finalPrompt} --no ${merged.negativePrompt}`;

    const endpoint = _imageJoinUrl(url, '/v1/images/generations');

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
        throw await _imageReadError(response, 'GPT 生图');
    }

    const data = await response.json();
    let imageUrl = await _image_extractFromJson(data);

    if (!imageUrl) {
        throw new Error('响应数据中没有有效的图片链接或Base64数据');
    }

    console.log('[GPT Image] ✅ 生图成功');
    return { imageUrl, provider: 'gpt', model, size, atmosphere: merged.atmosphere };
}

/**
 * 统一的生图路由分发函数
 * 根据用户在全局设置中选择的引擎，调用对应提供商。
 * @param {string} prompt - 提示词
 * @returns {Promise<{imageUrl: string}>} - 返回生成的图片 DataURL/URL
 */
async function generateImageDispatch(prompt, signal = null) {
    const enabled = {
        gpt: !!db.gptImageSettings?.enabled,
        novelai: !!db.novelAiSettings?.enabled,
        google: !!db.googleImageSettings?.enabled,
        stability: !!db.stabilityImageSettings?.enabled
    };
    let provider = db.activeImageProvider;
    if (!enabled[provider]) provider = ['gpt', 'novelai', 'google', 'stability'].find(key => enabled[key]);
    if (provider === 'gpt') return generateGptImage(prompt, {}, signal);
    if (provider === 'novelai') return generateNovelAiImage(prompt, {}, signal);
    if (provider === 'google') return generateGoogleImage(prompt, {}, signal);
    if (provider === 'stability') return generateStabilityImage(prompt, {}, signal);
    throw new Error('未开启任何生图引擎，请先在 API 设置中启用一个生图平台');
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
    const authMode = settings.authMode || 'bearer';
    if (!token && authMode !== 'none') throw new Error('NovelAI Token 未配置');
    if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

    // 清理 Token 中可能的特殊字符
    const cleanToken = String(token || '').trim().replace(/[\r\n]/g, '');

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

    // 拼接最终 prompt：系统基础 Prompt + 画师串 + 氛围组 + 用户 prompt
    const merged = _imageMergePrompt([artistTags, prompt].filter(Boolean).join(', '), 'novelai', systemPrompt, negativePrompt);
    const fullPrompt = merged.prompt;
    const fullNegativePrompt = merged.negativePrompt;

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
                    caption: { base_caption: fullNegativePrompt, char_captions: [] },
                    legacy_uc: false
                },
                negative_prompt: fullNegativePrompt,
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
                negative_prompt: fullNegativePrompt
            }
        };
    }

    // 确定 API 地址
    let apiUrl = '';
    if (customUrlEnabled && customUrl) {
        apiUrl = customUrl;
        if ((settings.endpointMode || 'auto') !== 'full' && !apiUrl.includes('/ai/generate-image')) {
            apiUrl = apiUrl.replace(/\/$/, '');
            const configuredPath = isV4 ? settings.streamPath : settings.generatePath;
            apiUrl += configuredPath || (isV4 ? '/ai/generate-image-stream' : '/ai/generate-image');
        }
    } else {
        // V4 使用 stream 端点，V3 使用普通端点
        apiUrl = isV4
            ? 'https://image.novelai.net/ai/generate-image-stream'
            : 'https://image.novelai.net/ai/generate-image';
    }

    console.log('[NovelAI] 发送生图请求:', { apiUrl, model, isV4, width, height, steps, scale, sampler });

    const requestHeaders = { 'Content-Type': 'application/json' };
    if (authMode === 'bearer' && cleanToken) requestHeaders.Authorization = `Bearer ${cleanToken}`;
    if (authMode === 'header' && cleanToken) requestHeaders[settings.authHeaderName || 'Authorization'] = cleanToken;
    if (settings.extraHeaders && typeof settings.extraHeaders === 'object') Object.assign(requestHeaders, settings.extraHeaders);
    if (authMode === 'query' && cleanToken) {
        const separator = apiUrl.includes('?') ? '&' : '?';
        apiUrl += `${separator}${encodeURIComponent(settings.authQueryName || 'key')}=${encodeURIComponent(cleanToken)}`;
    }

    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(requestBody),
        signal: signal
    });

    console.log(`[NovelAI] 响应状态: ${response.status}, Content-Type: ${response.headers.get('content-type')}`);

    if (!response.ok) {
        throw await _imageReadError(response, 'NovelAI');
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
            if (!line.startsWith('data:') || /^data:\s*\[DONE\]$/.test(line)) continue;

            const payload = line.substring(5).trim();
            try {
                const obj = JSON.parse(payload);
                imageDataUrl = await _image_extractFromJson(obj);
                if (imageDataUrl) break;
            } catch (e) {
                // 非 JSON，当成原始 base64 尝试
                if (payload.length > 100) {
                    imageDataUrl = await _image_resolveCandidate(payload);
                    if (imageDataUrl) break;
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
        imageDataUrl = await _image_extractFromJson(jsonData);
        if (!imageDataUrl) {
            throw new Error('JSON 响应中未找到图片数据');
        }

    } else {
        // === 默认当 ZIP / 二进制 Blob 处理（V3 常见）===
        console.log('[NovelAI] 解析二进制/ZIP 响应...');
        const blob = await response.blob();
        const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        const looksLikeImage = (head[0] === 0x89 && head[1] === 0x50)
            || (head[0] === 0xff && head[1] === 0xd8)
            || (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46);
        if ((blob.type && blob.type.startsWith('image/')) || looksLikeImage) {
            let typedBlob = blob;
            if (!blob.type.startsWith('image/')) {
                const mime = head[0] === 0xff ? 'image/jpeg' : (head[0] === 0x52 ? 'image/webp' : 'image/png');
                typedBlob = new Blob([await blob.arrayBuffer()], { type: mime });
            }
            imageDataUrl = await _nai_blobToDataUrl(typedBlob);
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
    return { imageUrl: imageDataUrl, provider: 'novelai', model, size: resolution, seed: commonSeed, atmosphere: merged.atmosphere };
}

/** 使用 Google Gemini 原生图片模型生成图片。 */
async function generateGoogleImage(prompt, overrideSettings = {}, signal = null) {
    const settings = Object.assign({}, db.googleImageSettings || {}, overrideSettings);
    const key = String(settings.key || '').trim();
    const baseUrl = String(settings.url || 'https://generativelanguage.googleapis.com').trim();
    const model = settings.model || 'gemini-3.1-flash-image';
    if (!key) throw new Error('Google 生图 API Key 未配置');
    if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

    const merged = _imageMergePrompt(prompt.trim(), 'google', settings.systemPrompt || '', settings.negativePrompt || '');
    let finalPrompt = merged.prompt;
    if (merged.negativePrompt) finalPrompt += `\n\n画面中不要出现：${merged.negativePrompt}`;
    const endpoint = /:generateContent(?:\?|$)/.test(baseUrl)
        ? baseUrl
        : `${baseUrl.replace(/\/$/, '')}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    if (settings.aspectRatio) generationConfig.imageConfig = { aspectRatio: settings.aspectRatio };

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: finalPrompt }] }], generationConfig }),
        signal
    });
    if (!response.ok) throw await _imageReadError(response, 'Google 生图');
    const data = await response.json();
    const parts = data?.candidates?.flatMap(candidate => candidate?.content?.parts || []) || [];
    const imagePart = parts.find(part => part.inlineData?.data || part.inline_data?.data);
    const inline = imagePart?.inlineData || imagePart?.inline_data;
    if (!inline?.data) {
        const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
        throw new Error(reason ? `Google 未返回图片：${reason}` : 'Google 响应中未找到图片数据');
    }
    const mimeType = inline.mimeType || inline.mime_type || 'image/png';
    return {
        imageUrl: `data:${mimeType};base64,${inline.data}`,
        provider: 'google', model, size: settings.aspectRatio || '', atmosphere: merged.atmosphere
    };
}

/** 使用 Stability Stable Image 接口生成图片。 */
async function generateStabilityImage(prompt, overrideSettings = {}, signal = null) {
    const settings = Object.assign({}, db.stabilityImageSettings || {}, overrideSettings);
    const key = String(settings.key || '').trim();
    const baseUrl = String(settings.url || 'https://api.stability.ai').trim();
    const service = settings.service === 'ultra' ? 'ultra' : 'core';
    if (!key) throw new Error('Stability API Key 未配置');
    if (!prompt || !prompt.trim()) throw new Error('提示词不能为空');

    const merged = _imageMergePrompt(prompt.trim(), 'stability', settings.systemPrompt || '', settings.negativePrompt || '');
    const endpoint = /\/stable-image\/generate\/(?:core|ultra)(?:\?|$)/.test(baseUrl)
        ? baseUrl
        : `${baseUrl.replace(/\/$/, '')}/v2beta/stable-image/generate/${service}`;
    const form = new FormData();
    form.append('prompt', merged.prompt);
    if (merged.negativePrompt) form.append('negative_prompt', merged.negativePrompt);
    form.append('output_format', settings.outputFormat || 'png');
    if (settings.aspectRatio) form.append('aspect_ratio', settings.aspectRatio);
    if (settings.stylePreset) form.append('style_preset', settings.stylePreset);
    if (settings.seed !== '' && settings.seed != null) form.append('seed', String(settings.seed));

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, Accept: 'image/*' },
        body: form,
        signal
    });
    if (!response.ok) throw await _imageReadError(response, 'Stability');
    const contentType = response.headers.get('content-type') || '';
    let imageUrl;
    if (contentType.includes('application/json')) imageUrl = await _image_extractFromJson(await response.json());
    else imageUrl = await _nai_blobToDataUrl(await response.blob());
    if (!imageUrl) throw new Error('Stability 响应中未找到图片数据');
    return {
        imageUrl, provider: 'stability', model: `stable-image-${service}`,
        size: settings.aspectRatio || '', seed: settings.seed, atmosphere: merged.atmosphere
    };
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
window.generateGoogleImage = generateGoogleImage;
window.generateStabilityImage = generateStabilityImage;
window.novelAiGenerate = novelAiGenerate;
window.writeOvoPngMetadata = writeOvoPngMetadata;
window.readOvoPngMetadata = readOvoPngMetadata;
