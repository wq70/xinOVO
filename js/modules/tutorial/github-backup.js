const GitHubMgr = {
    config: { token: '', repo: '', auto: false, interval: 48, lastTime: 0, fileName: '' },
    
    init: () => {
        const confStr = localStorage.getItem('gh_config');
        if(confStr) GitHubMgr.config = JSON.parse(confStr);
        
        const tokenInput = document.getElementById('gh-token-input');
        const repoInput = document.getElementById('gh-repo-input');
        const fileNameInput = document.getElementById('gh-filename-input');
        const autoSwitch = document.getElementById('gh-auto-switch');
        
        if(tokenInput) tokenInput.value = GitHubMgr.config.token || '';
        if(repoInput) repoInput.value = GitHubMgr.config.repo || '';
        if(fileNameInput) fileNameInput.value = GitHubMgr.config.fileName || '';
        
        if(autoSwitch) {
            autoSwitch.checked = GitHubMgr.config.auto || false;
            document.getElementById('gh-interval-setting').style.display = autoSwitch.checked ? 'flex' : 'none';
        }
        if(document.getElementById('gh-interval-select')) {
            document.getElementById('gh-interval-select').value = GitHubMgr.config.interval || 48;
        }
        
        if(GitHubMgr.config.auto) GitHubMgr.checkAndBackup();
        GitHubMgr.updateStatusText();
    },
    
    saveConfig: () => {
        let token = document.getElementById('gh-token-input').value.trim();
        // 自动清理 Token：移除前缀和空格
        token = token.replace(/^(Bearer|token)\s+/i, '').replace(/\s+/g, '');

        const repo = document.getElementById('gh-repo-input').value.trim();
        const fileName = document.getElementById('gh-filename-input').value.trim();
        const auto = document.getElementById('gh-auto-switch').checked;
        const interval = parseInt(document.getElementById('gh-interval-select').value);
        
        GitHubMgr.config.token = token;
        GitHubMgr.config.repo = repo;
        GitHubMgr.config.fileName = fileName;
        GitHubMgr.config.auto = auto;
        GitHubMgr.config.interval = interval;
        
        document.getElementById('gh-interval-setting').style.display = auto ? 'flex' : 'none';
        
        localStorage.setItem('gh_config', JSON.stringify(GitHubMgr.config));
        GitHubMgr.updateStatusText();
        
        if(auto) GitHubMgr.checkAndBackup();
    },
    
    updateStatusText: () => {
        const el = document.getElementById('gh-status-msg');
        if(!el) return;
        if(!GitHubMgr.config.lastTime) el.innerText = '从未备份过';
        else {
            const date = new Date(GitHubMgr.config.lastTime);
            const nextTime = new Date(GitHubMgr.config.lastTime + (GitHubMgr.config.interval || 48) * 3600000);
            el.innerText = `上次: ${date.toLocaleString()} (下次约: ${nextTime.toLocaleString()})`;
        }
    },
    
    checkAndBackup: async () => {
        if(!GitHubMgr.config.token || !GitHubMgr.config.repo || !GitHubMgr.config.auto) return;
        const now = Date.now();
        const interval = GitHubMgr.config.interval || 48;
        const hours = (now - (GitHubMgr.config.lastTime || 0)) / (1000 * 60 * 60);
        
        if(hours >= interval) {
            console.log(`距离上次备份已过 ${hours.toFixed(1)} 小时，触发自动备份...`);
            
            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed; top:10px; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.7); color:#fff; padding:8px 15px; border-radius:20px; font-size:12px; z-index:9999; pointer-events:none; transition:opacity 0.5s;';
            toast.innerText = '正在后台准备自动备份...';
            document.body.appendChild(toast);
            
            try {
                await GitHubMgr.performUpload((msg) => { toast.innerText = '自动备份: ' + msg; });
                toast.innerText = '自动备份成功！';
                setTimeout(() => toast.remove(), 3000);
            } catch(e) {
                console.error('自动备份失败', e);
                toast.innerText = '自动备份失败: ' + e.message;
                setTimeout(() => toast.remove(), 5000);
            }
        }
    },
    
    testUpload: async () => {
        GitHubMgr.saveConfig(); // 强制保存当前输入框的值
        if(!GitHubMgr.config.token || !GitHubMgr.config.repo) return alert('请先填写 Token 和 仓库路径');
        showToast('开始备份...');
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = '备份中...';
        btn.style.pointerEvents = 'none';
        
        try {
            await GitHubMgr.performUpload((msg) => { showToast(msg); });
            showToast('上传成功！');
        } catch(e) {
            showToast('上传失败: ' + e.message);
        } finally {
            btn.innerText = originalText;
            btn.style.pointerEvents = 'auto';
        }
    },
    
    // 单文件上传上限（base64 字符数），超过则走分片。约 35MB base64 对应解码后约 26MB，低于 GitHub 100MB 限制
    _SINGLE_FILE_MAX_B64: 35 * 1024 * 1024,
    // 每片 base64 长度（字符数），分片时使用
    _CHUNK_B64_SIZE: 35 * 1024 * 1024,
    _CHUNKS_DIR: 'backup_chunks',

    _uploadOneFile: async (repoPath, base64ContentForApi, message, existingSha) => {
        const url = `https://api.github.com/repos/${GitHubMgr.config.repo}/contents/${encodeURIComponent(repoPath)}`;
        const body = { message: message || 'Backup', content: base64ContentForApi };
        if (existingSha) body.sha = existingSha;
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${GitHubMgr.config.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const errJson = await res.json();
            throw new Error(errJson.message || 'GitHub API Error');
        }
        return res;
    },

    performUpload: async (onProgress) => {
        // 1. 预检权限
        onProgress('正在检查权限...');
        const checkUrl = `https://api.github.com/repos/${GitHubMgr.config.repo}`;
        const checkRes = await fetch(checkUrl, {
            headers: { 'Authorization': `token ${GitHubMgr.config.token}` }
        });
        
        if (!checkRes.ok) {
             if (checkRes.status === 401) throw new Error('Token 无效或过期 (401)');
             if (checkRes.status === 404) throw new Error('仓库不存在或 Token 无权访问 (404)');
             throw new Error(`权限检查失败: ${checkRes.status}`);
        }
        
        const repoInfo = await checkRes.json();
        // 检查 push 权限
        if (repoInfo.permissions && repoInfo.permissions.push === false) {
            throw new Error('Token 缺少写入权限 (push)，请重新生成 Token 并勾选 repo 权限');
        }

        onProgress('正在打包数据...');
        const backupData = await createFullBackupData();
        const jsonString = JSON.stringify(backupData);
        
        onProgress('正在压缩...');
        const dataBlob = new Blob([jsonString]);
        const compressionStream = new CompressionStream('gzip');
        const compressedStream = dataBlob.stream().pipeThrough(compressionStream);
        const compressedBlob = await new Response(compressedStream, { headers: { 'Content-Type': 'application/octet-stream' } }).blob();
        
        onProgress('正在编码...');
        const base64Content = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const res = reader.result;
                let base64 = res.split(',')[1]; 
                // 移除可能存在的换行符，防止上传失败
                base64 = base64.replace(/\s/g, '');
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(compressedBlob);
        });

        const useChunked = base64Content.length > GitHubMgr._SINGLE_FILE_MAX_B64;
        const token = GitHubMgr.config.token;
        const repo = GitHubMgr.config.repo;

        if (!useChunked) {
            // 小文件：单文件上传（兼容原有逻辑）
            onProgress('正在上传至 GitHub...');
            let path = '';
            let sha = null;
            const customName = GitHubMgr.config.fileName;
            
            if (customName && customName.trim()) {
                path = customName.trim();
                if (!path.endsWith('.ee')) path += '.ee';
                try {
                    const checkUrl = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
                    const checkRes = await fetch(checkUrl, {
                        headers: { 'Authorization': `token ${token}` }
                    });
                    if (checkRes.ok) {
                        const fileData = await checkRes.json();
                        sha = fileData.sha;
                    }
                } catch(e) {
                    console.log('File does not exist or error checking:', e);
                }
            } else {
                const dateStr = new Date().toISOString().slice(0, 10);
                path = `AutoBackup_${dateStr}_${Date.now()}.ee`;
            }
            await GitHubMgr._uploadOneFile(path, base64Content, 'Auto backup', sha);
        } else {
            // 大文件：分片上传
            const backupId = Date.now();
            const chunkSize = GitHubMgr._CHUNK_B64_SIZE;
            const totalChunks = Math.ceil(base64Content.length / chunkSize);
            const chunkPaths = [];
            const dir = GitHubMgr._CHUNKS_DIR;

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSize;
                const end = Math.min(start + chunkSize, base64Content.length);
                const chunk = base64Content.slice(start, end);
                const chunkPath = `${dir}/BackupChunk_${backupId}_part${i}.ee.chunk`;
                chunkPaths.push(`BackupChunk_${backupId}_part${i}.ee.chunk`);

                onProgress(`正在上传分片 ${i + 1}/${totalChunks}...`);
                const contentForApi = btoa(chunk);
                await GitHubMgr._uploadOneFile(chunkPath, contentForApi, `Backup chunk ${i + 1}/${totalChunks}`);
            }

            const manifest = {
                backupId,
                totalChunks,
                chunkPaths,
                timestamp: backupId
            };
            const manifestPath = `${dir}/BackupChunk_${backupId}_manifest.json`;
            onProgress('正在上传清单...');
            await GitHubMgr._uploadOneFile(
                manifestPath,
                btoa(JSON.stringify(manifest)),
                'Backup manifest'
            );
        }

        GitHubMgr.config.lastTime = Date.now();
        localStorage.setItem('gh_config', JSON.stringify(GitHubMgr.config));
        GitHubMgr.updateStatusText();
    },
    
    checkStatus: async () => {
        if(!GitHubMgr.config.token || !GitHubMgr.config.repo) return showToast('未配置');
        const url = `https://api.github.com/repos/${GitHubMgr.config.repo}`;
        try {
            const res = await fetch(url, { headers: { 'Authorization': `token ${GitHubMgr.config.token}` } });
            if(res.ok) {
                const data = await res.json();
                alert(`连接成功！\n仓库: ${data.full_name}\n私有: ${data.private}\n说明: 配置有效`);
            } else {
                alert('连接失败，请检查 Token 或 仓库路径');
            }
        } catch(e) { alert('网络错误: ' + e.message); }
    },
    
    restoreLatest: async () => {
        if(!GitHubMgr.config.token || !GitHubMgr.config.repo) return alert('请先在配置中填写 Token 和 仓库路径');
        if(!confirm('⚠️ 警告：这将下载最新的自动备份并覆盖当前所有数据！\n此操作不可撤销！\n\n确定要继续吗？')) return;

        showToast('正在连接 GitHub...');
        const btn = event.target;
        const originalText = btn.innerText;
        btn.innerText = '恢复中...';
        btn.style.pointerEvents = 'none';

        const token = GitHubMgr.config.token;
        const repo = GitHubMgr.config.repo;
        const baseUrl = `https://api.github.com/repos/${repo}/contents`;
        const auth = { 'Authorization': `token ${token}` };

        try {
            const customName = GitHubMgr.config.fileName;
            let restoreChunked = false;
            let targetSingle = null;
            let targetManifest = null;

            if (customName && customName.trim()) {
                let path = customName.trim();
                if (!path.endsWith('.ee')) path += '.ee';
                targetSingle = { name: path };
            } else {
                const rootRes = await fetch(`${baseUrl}/`, { headers: auth });
                if (!rootRes.ok) {
                    if (rootRes.status === 404) throw new Error('仓库不存在或路径错误');
                    if (rootRes.status === 401) throw new Error('Token 无效或无权限');
                    throw new Error('获取列表失败: ' + rootRes.status);
                }
                const rootFiles = await rootRes.json();
                const singleBackups = rootFiles.filter(f => f.name.startsWith('AutoBackup_') && f.name.endsWith('.ee'));
                singleBackups.sort((a, b) => {
                    const getTs = (name) => {
                        const match = name.match(/_(\d+)\.ee$/);
                        return match ? parseInt(match[1]) : 0;
                    };
                    return getTs(b.name) - getTs(a.name);
                });
                if (singleBackups.length > 0) targetSingle = { name: singleBackups[0].name, ts: singleBackups[0].name.match(/_(\d+)\.ee$/)?.[1] || 0 };

                const chunksDirRes = await fetch(`${baseUrl}/${encodeURIComponent(GitHubMgr._CHUNKS_DIR)}`, { headers: auth });
                if (chunksDirRes.ok) {
                    const chunkFiles = await chunksDirRes.json();
                    const manifests = chunkFiles.filter(f => f.name.endsWith('_manifest.json') && f.name.startsWith('BackupChunk_'));
                    if (manifests.length > 0) {
                        manifests.sort((a, b) => {
                            const getId = (name) => {
                                const m = name.match(/BackupChunk_(\d+)_manifest/);
                                return m ? parseInt(m[1]) : 0;
                            };
                            return getId(b.name) - getId(a.name);
                        });
                        targetManifest = { name: manifests[0].name };
                    }
                }

                if (targetSingle && targetManifest) {
                    const singleTs = parseInt(targetSingle.ts, 10) || 0;
                    const chunkId = parseInt(targetManifest.name.match(/BackupChunk_(\d+)_manifest/)?.[1], 10) || 0;
                    restoreChunked = chunkId > singleTs;
                } else if (targetManifest) {
                    restoreChunked = true;
                }
            }

            let data;
            if (restoreChunked && targetManifest) {
                showToast('正在下载分片清单...');
                const manifestPath = `${GitHubMgr._CHUNKS_DIR}/${targetManifest.name}`;
                const manifestRes = await fetch(`${baseUrl}/${encodeURIComponent(manifestPath)}`, {
                    headers: { ...auth, 'Accept': 'application/vnd.github.v3.raw' }
                });
                if (!manifestRes.ok) throw new Error('下载清单失败: ' + manifestRes.status);
                const manifestText = await manifestRes.text();
                const manifest = JSON.parse(manifestText);

                let fullBase64 = '';
                for (let i = 0; i < manifest.totalChunks; i++) {
                    showToast(`正在下载分片 ${i + 1}/${manifest.totalChunks}...`);
                    const chunkFileName = manifest.chunkPaths[i];
                    const chunkPath = `${GitHubMgr._CHUNKS_DIR}/${chunkFileName}`;
                    const chunkRes = await fetch(`${baseUrl}/${encodeURIComponent(chunkPath)}`, {
                        headers: { ...auth, 'Accept': 'application/vnd.github.v3.raw' }
                    });
                    if (!chunkRes.ok) throw new Error('下载分片失败: ' + chunkRes.status);
                    fullBase64 += await chunkRes.text();
                }

                showToast('正在解码并解压...');
                const binStr = atob(fullBase64);
                const bytes = new Uint8Array(binStr.length);
                for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
                const blob = new Blob([bytes], { type: 'application/octet-stream' });

                const decompressionStream = new DecompressionStream('gzip');
                const decompressedStream = blob.stream().pipeThrough(decompressionStream);
                const jsonString = await new Response(decompressedStream).text();
                data = JSON.parse(jsonString);
            } else {
                if (!targetSingle) throw new Error('未找到可恢复的备份文件');
                showToast('正在下载: ' + targetSingle.name);
                const dlRes = await fetch(`${baseUrl}/${encodeURIComponent(targetSingle.name)}`, {
                    headers: { ...auth, 'Accept': 'application/vnd.github.v3.raw' }
                });
                if (!dlRes.ok) throw new Error('下载文件失败: ' + dlRes.status);
                showToast('下载完成，正在解压...');
                const blob = await dlRes.blob();
                const decompressionStream = new DecompressionStream('gzip');
                const decompressedStream = blob.stream().pipeThrough(decompressionStream);
                const jsonString = await new Response(decompressedStream).text();
                data = JSON.parse(jsonString);
            }

            showToast('解压完成，开始导入...');
            const importResult = await importBackupData(data);

            if (importResult.success) {
                showToast(`恢复成功！${importResult.message} 应用即将刷新。`);
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                throw new Error(importResult.error);
            }

        } catch(e) {
            console.error(e);
            alert('恢复失败: ' + e.message);
            btn.innerText = originalText;
            btn.style.pointerEvents = 'auto';
        }
    }
};
window.GitHubMgr = GitHubMgr;
