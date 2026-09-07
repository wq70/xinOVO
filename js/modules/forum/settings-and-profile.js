function forumDeletePost(postId) {
    if (!confirm('确定要删除这篇帖子吗？')) return;
    const index = db.forumPosts.findIndex(p => p.id === postId);
    if (index === -1) return;
    const post = db.forumPosts[index];
    if (post.authorId !== 'user' && !(post.authorId && post.authorId.startsWith('alt_'))) { showToast('只能删除自己的帖子'); return; }
    db.forumPosts.splice(index, 1);
    saveData();
    switchScreen('forum-screen');
    renderForumPosts(db.forumPosts);
    showToast('帖子已删除');
}

function forumTogglePostDeleteMode() {
    if (forumPostDeleteMode) return;
    forumPostDeleteMode = true;
    forumSelectedPostIds.clear();
    var toolbar = document.getElementById('forum-post-delete-toolbar');
    if (toolbar) toolbar.style.display = 'flex';
    var deleteBtn = document.getElementById('forum-post-delete-btn');
    if (deleteBtn) deleteBtn.style.display = 'none';
    renderForumPosts(db.forumPosts, forumGetActiveFilter());
}

function forumPostSelectAll() {
    var posts = db.forumPosts || [];
    forumSelectedPostIds.clear();
    posts.forEach(function(p) { forumSelectedPostIds.add(p.id); });
    renderForumPosts(db.forumPosts, forumGetActiveFilter());
}

function forumPostDeleteSelected() {
    if (forumSelectedPostIds.size === 0) { showToast('请先选择要删除的帖子'); return; }
    if (!confirm('确定要删除选中的 ' + forumSelectedPostIds.size + ' 个帖子吗？')) return;
    db.forumPosts = (db.forumPosts || []).filter(function(p) { return !forumSelectedPostIds.has(p.id); });
    saveData();
    forumSelectedPostIds.clear();
    forumPostDeleteMode = false;
    var toolbar = document.getElementById('forum-post-delete-toolbar');
    if (toolbar) toolbar.style.display = 'none';
    var deleteBtn = document.getElementById('forum-post-delete-btn');
    if (deleteBtn) deleteBtn.style.display = '';
    renderForumPosts(db.forumPosts, forumGetActiveFilter());
    showToast('已删除选中帖子');
}

function forumPostCancelDeleteMode() {
    forumPostDeleteMode = false;
    forumSelectedPostIds.clear();
    var toolbar = document.getElementById('forum-post-delete-toolbar');
    if (toolbar) toolbar.style.display = 'none';
    var deleteBtn = document.getElementById('forum-post-delete-btn');
    if (deleteBtn) deleteBtn.style.display = '';
    renderForumPosts(db.forumPosts, forumGetActiveFilter());
}

function forumGetActiveFilter() {
    var activeTab = document.querySelector('.forum-filter-tab.active');
    return activeTab ? (activeTab.dataset.filter || 'all') : 'all';
}

function forumLoadSettings() {
    const s = db.forumSettings || { postsPerGeneration: 8, commentsPerPost: { min: 4, max: 8 }, autoReplyCount: 3, detailReplyCount: 2 };
    const postsInput = document.getElementById('forum-posts-count-input');
    const minInput = document.getElementById('forum-comments-min-input');
    const maxInput = document.getElementById('forum-comments-max-input');
    const autoReplyInput = document.getElementById('forum-auto-reply-count-input');
    const detailReplyInput = document.getElementById('forum-detail-reply-count-input');
    const dmCountInput = document.getElementById('forum-dm-count-input');
    
    if (postsInput) postsInput.value = s.postsPerGeneration || 8;
    if (minInput) minInput.value = (s.commentsPerPost && s.commentsPerPost.min) != null ? s.commentsPerPost.min : 4;
    if (maxInput) maxInput.value = (s.commentsPerPost && s.commentsPerPost.max) != null ? s.commentsPerPost.max : 8;
    if (autoReplyInput) autoReplyInput.value = s.autoReplyCount != null ? s.autoReplyCount : 3;
    if (detailReplyInput) detailReplyInput.value = s.detailReplyCount != null ? s.detailReplyCount : 2;
    if (dmCountInput) dmCountInput.value = Math.max(1, Math.min(20, (s.dmPerGeneration != null ? parseInt(s.dmPerGeneration, 10) : 4)));
    
    const apiSettings = db.forumApiSettings || { useForumApi: false, url: '', key: '', model: '', temperature: 0.9 };
    const useApiToggle = document.getElementById('forum-use-api-toggle');
    const apiUrlInput = document.getElementById('forum-api-url-input');
    const apiKeyInput = document.getElementById('forum-api-key-input');
    const apiModelSelect = document.getElementById('forum-api-model-select');
    const apiConfigSection = document.getElementById('forum-api-config-section');
    
    if (useApiToggle) {
        useApiToggle.checked = apiSettings.useForumApi || false;
        useApiToggle.addEventListener('change', function() {
            if (apiConfigSection) apiConfigSection.style.display = this.checked ? 'block' : 'none';
        });
        if (apiConfigSection) apiConfigSection.style.display = useApiToggle.checked ? 'block' : 'none';
    }
    
    if (apiUrlInput) apiUrlInput.value = apiSettings.url || '';
    if (apiKeyInput) apiKeyInput.value = apiSettings.key || '';
    if (apiModelSelect && apiSettings.model) {
        apiModelSelect.innerHTML = `<option value="${apiSettings.model}">${apiSettings.model}</option>`;
    }
    
    const tempSlider = document.getElementById('forum-temperature-slider');
    const tempValue = document.getElementById('forum-temperature-value');
    if (tempSlider && tempValue) {
        const savedTemp = apiSettings.temperature !== undefined ? apiSettings.temperature : 0.9;
        tempSlider.value = savedTemp;
        tempValue.textContent = savedTemp;
        
        tempSlider.addEventListener('input', (e) => {
            tempValue.textContent = e.target.value;
        });
    }
    
    const fetchModelsBtn = document.getElementById('forum-fetch-models-btn');
    if (fetchModelsBtn) {
        fetchModelsBtn.addEventListener('click', forumFetchModels);
    }

    // 角色小号私信设置
    const charAltEnable = document.getElementById('forum-char-alt-enable');
    const charAltOptions = document.getElementById('forum-char-alt-options');
    const charAltProbSlider = document.getElementById('forum-char-alt-prob-slider');
    const charAltProbValue = document.getElementById('forum-char-alt-prob-value');
    const charAltList = document.getElementById('forum-char-alt-list');
    if (charAltEnable && charAltOptions) {
        const altSettings = db.forumSettings && db.forumSettings.enableCharAltDm;
        charAltEnable.checked = !!altSettings;
        charAltOptions.style.display = charAltEnable.checked ? 'block' : 'none';
        charAltEnable.addEventListener('change', function() {
            charAltOptions.style.display = this.checked ? 'block' : 'none';
        });
    }
    if (charAltProbSlider && charAltProbValue) {
        const p = (db.forumSettings && db.forumSettings.charAltProbability) != null ? db.forumSettings.charAltProbability : 25;
        charAltProbSlider.value = Math.max(0, Math.min(100, p));
        charAltProbValue.textContent = charAltProbSlider.value + '%';
        charAltProbSlider.addEventListener('input', function() {
            charAltProbValue.textContent = this.value + '%';
        });
    }
    if (charAltList) {
        const mainChars = (db.characters || []).filter(function(c) { return c.source !== 'forum'; });
        const selectedIds = (db.forumSettings && db.forumSettings.charAltCharIds) || [];
        const altNames = (db.forumSettings && db.forumSettings.charAltNames) || {};
        charAltList.innerHTML = '';
        mainChars.forEach(function(c) {
            const li = document.createElement('li');
            li.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.id = 'forum-char-alt-cb-' + c.id;
            cb.value = c.id;
            cb.checked = selectedIds.indexOf(c.id) !== -1;
            const label = document.createElement('label');
            label.htmlFor = cb.id;
            label.textContent = (c.remarkName || c.realName || c.id) + ' ';
            label.style.flex = '0 0 auto';
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = '小号昵称（选填）';
            input.dataset.charId = c.id;
            input.value = altNames[c.id] || '';
            input.style.cssText = 'flex:1;min-width:0;padding:4px 8px;border:1px solid #e0e0e0;border-radius:6px;font-size:13px;';
            li.appendChild(cb);
            li.appendChild(label);
            li.appendChild(input);
            charAltList.appendChild(li);
        });
        if (mainChars.length === 0) {
            charAltList.innerHTML = '<li style="padding:8px;color:#999;">暂无主角色（仅非论坛来源角色可设小号）</li>';
        }
    }
}

function forumSaveSettings() {
    const postsInput = document.getElementById('forum-posts-count-input');
    const minInput = document.getElementById('forum-comments-min-input');
    const maxInput = document.getElementById('forum-comments-max-input');
    const autoReplyInput = document.getElementById('forum-auto-reply-count-input');
    const detailReplyInput = document.getElementById('forum-detail-reply-count-input');
    
    const postsCount = parseInt(postsInput && postsInput.value, 10) || 8;
    const commentsMin = parseInt(minInput && minInput.value, 10) || 4;
    const commentsMax = parseInt(maxInput && maxInput.value, 10) || 8;
    const autoReplyCount = parseInt(autoReplyInput && autoReplyInput.value, 10) || 3;
    const detailReplyCount = parseInt(detailReplyInput && detailReplyInput.value, 10) || 2;
    
    if (commentsMin > commentsMax) { showToast('最小评论数不能大于最大评论数'); return; }
    
    const dmCountInput = document.getElementById('forum-dm-count-input');
    const dmPerGeneration = (dmCountInput && dmCountInput.value != null) ? Math.max(1, Math.min(20, parseInt(dmCountInput.value, 10))) : 4;
    
    db.forumSettings = db.forumSettings || {};
    db.forumSettings.postsPerGeneration = postsCount;
    db.forumSettings.commentsPerPost = { min: commentsMin, max: commentsMax };
    db.forumSettings.autoReplyCount = autoReplyCount;
    db.forumSettings.detailReplyCount = detailReplyCount;
    db.forumSettings.dmPerGeneration = dmPerGeneration;

    const charAltEnable = document.getElementById('forum-char-alt-enable');
    const charAltProbSlider = document.getElementById('forum-char-alt-prob-slider');
    const charAltList = document.getElementById('forum-char-alt-list');
    db.forumSettings.enableCharAltDm = !!(charAltEnable && charAltEnable.checked);
    db.forumSettings.charAltProbability = (charAltProbSlider && charAltProbSlider.value != null) ? Math.max(0, Math.min(100, parseInt(charAltProbSlider.value, 10))) : 25;
    db.forumSettings.charAltCharIds = [];
    db.forumSettings.charAltNames = {};
    if (charAltList) {
        charAltList.querySelectorAll('input[type="checkbox"]').forEach(function(cb) {
            if (cb.checked && cb.value) db.forumSettings.charAltCharIds.push(cb.value);
        });
        charAltList.querySelectorAll('input[type="text"][data-char-id]').forEach(function(inp) {
            var cid = inp.dataset.charId;
            if (cid && (inp.value || '').trim()) db.forumSettings.charAltNames[cid] = inp.value.trim();
        });
    }
    
    const useApiToggle = document.getElementById('forum-use-api-toggle');
    const apiUrlInput = document.getElementById('forum-api-url-input');
    const apiKeyInput = document.getElementById('forum-api-key-input');
    const apiModelSelect = document.getElementById('forum-api-model-select');
    const tempSlider = document.getElementById('forum-temperature-slider');
    
    db.forumApiSettings = {
        useForumApi: useApiToggle ? useApiToggle.checked : false,
        url: (apiUrlInput && apiUrlInput.value.trim()) || '',
        key: (apiKeyInput && apiKeyInput.value.trim()) || '',
        model: (apiModelSelect && apiModelSelect.value.trim()) || '',
        temperature: tempSlider ? parseFloat(tempSlider.value) : 0.9
    };
    
    saveData();
    showToast('设置已保存');
}

function forumGetUserStats() {
    const posts = db.forumPosts || [];
    let postCount = 0, commentCount = 0, likeCount = 0;
    const isOwnId = function(id) { return id === 'user' || (id && id.startsWith('alt_')); };
    posts.forEach(p => {
        if (isOwnId(p.authorId)) postCount++;
        (p.comments || []).forEach(c => { if (isOwnId(c.authorId)) commentCount++; });
        if (isOwnId(p.authorId)) likeCount += p.likeCount || 0;
    });
    return { posts: postCount, comments: commentCount, likes: likeCount };
}

async function forumFetchModels() {
    const apiUrlInput = document.getElementById('forum-api-url-input');
    const apiKeyInput = document.getElementById('forum-api-key-input');
    const modelSelect = document.getElementById('forum-api-model-select');
    const fetchBtn = document.getElementById('forum-fetch-models-btn');
    
    let apiUrl = apiUrlInput ? apiUrlInput.value.trim() : '';
    const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
    
    if (!apiUrl || !apiKey) {
        showToast('请先填写API地址和密钥！');
        return;
    }
    
    if (apiUrl.endsWith('/')) apiUrl = apiUrl.slice(0, -1);
    
    const endpoint = `${apiUrl}/v1/models`;
    
    if (fetchBtn) {
        fetchBtn.classList.add('loading');
        fetchBtn.disabled = true;
    }
    
    try {
        const headers = { Authorization: `Bearer ${apiKey}` };
        const response = await fetch(endpoint, { method: 'GET', headers });
        
        if (!response.ok) {
            const error = new Error(`网络响应错误: ${response.status}`);
            error.response = response;
            throw error;
        }
        
        const data = await response.json();
        let models = [];
        
        if (data.data) {
            models = data.data.map(e => e.id);
        }
        
        const currentVal = modelSelect ? modelSelect.value : '';
        
        if (modelSelect) {
            modelSelect.innerHTML = '';
            if (models.length > 0) {
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    modelSelect.appendChild(opt);
                });
                
                if (models.includes(currentVal)) {
                    modelSelect.value = currentVal;
                } else if (db.forumApiSettings && db.forumApiSettings.model && models.includes(db.forumApiSettings.model)) {
                    modelSelect.value = db.forumApiSettings.model;
                }
                
                showToast(`成功拉取 ${models.length} 个模型`);
            } else {
                modelSelect.innerHTML = '<option value="">未找到可用模型</option>';
                showToast('未找到可用模型');
            }
        }
        
    } catch (error) {
        console.error('拉取模型失败:', error);
        showToast('拉取模型失败: ' + (error.message || '未知错误'));
        if (modelSelect) {
            modelSelect.innerHTML = '<option value="">拉取失败</option>';
        }
    } finally {
        if (fetchBtn) {
            fetchBtn.classList.remove('loading');
            fetchBtn.disabled = false;
        }
    }
}

function forumLoadProfile() {
    forumInitUserProfile();
    const p = db.forumUserProfile;
    const nameEl = document.getElementById('forum-user-name-display');
    const avatarEl = document.getElementById('forum-user-avatar-display');
    const usernameInput = document.getElementById('forum-username-input');
    const bioInput = document.getElementById('forum-bio-input');
    if (nameEl) nameEl.textContent = p.username || '未设置昵称';
    if (avatarEl) avatarEl.src = p.avatar || 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
    if (usernameInput) usernameInput.value = p.username || '';
    if (bioInput) bioInput.value = p.bio || '';
    const stats = forumGetUserStats();
    const postsCountEl = document.getElementById('user-posts-count');
    const commentsCountEl = document.getElementById('user-comments-count');
    const likesCountEl = document.getElementById('user-likes-count');
    if (postsCountEl) postsCountEl.textContent = stats.posts;
    if (commentsCountEl) commentsCountEl.textContent = stats.comments;
    if (likesCountEl) likesCountEl.textContent = stats.likes;
}

function forumSaveProfile() {
    const usernameInput = document.getElementById('forum-username-input');
    const bioInput = document.getElementById('forum-bio-input');
    const username = usernameInput && usernameInput.value.trim();
    if (!username) { showToast('昵称不能为空'); return; }
    forumInitUserProfile();
    db.forumUserProfile.username = username;
    db.forumUserProfile.bio = (bioInput && bioInput.value) || '';
    saveData();
    showToast('资料已保存');
}

function forumBindNewEvents() {
    document.getElementById('create-post-fab') && document.getElementById('create-post-fab').addEventListener('click', () => { document.getElementById('create-forum-post-modal').classList.add('visible'); });
    document.getElementById('create-forum-post-form') && document.getElementById('create-forum-post-form').addEventListener('submit', function(e) { e.preventDefault(); forumPublishPost(); });
    document.getElementById('cancel-forum-post-btn') && document.getElementById('cancel-forum-post-btn').addEventListener('click', () => { document.getElementById('create-forum-post-modal').classList.remove('visible'); });

    document.getElementById('forum-settings-btn') && document.getElementById('forum-settings-btn').addEventListener('click', () => { switchScreen('forum-settings-screen'); forumLoadSettings(); });
    document.getElementById('save-forum-settings-btn') && document.getElementById('save-forum-settings-btn').addEventListener('click', forumSaveSettings);
    document.getElementById('forum-goto-profile-btn') && document.getElementById('forum-goto-profile-btn').addEventListener('click', () => { switchScreen('forum-profile-screen'); forumLoadProfile(); });

    document.getElementById('forum-dm-btn') && document.getElementById('forum-dm-btn').addEventListener('click', () => { switchScreen('forum-dm-list-screen'); forumRenderDMList(); });

    document.getElementById('forum-post-delete-btn') && document.getElementById('forum-post-delete-btn').addEventListener('click', forumTogglePostDeleteMode);
    document.getElementById('forum-post-select-all-btn') && document.getElementById('forum-post-select-all-btn').addEventListener('click', forumPostSelectAll);
    document.getElementById('forum-post-delete-selected-btn') && document.getElementById('forum-post-delete-selected-btn').addEventListener('click', forumPostDeleteSelected);
    document.getElementById('forum-post-cancel-delete-btn') && document.getElementById('forum-post-cancel-delete-btn').addEventListener('click', forumPostCancelDeleteMode);

    document.getElementById('save-forum-profile-btn') && document.getElementById('save-forum-profile-btn').addEventListener('click', () => { forumSaveProfile(); switchScreen('forum-screen'); });
    document.getElementById('forum-profile-screen') && document.getElementById('forum-profile-screen').addEventListener('click', function(e) {
        if (e.target.id === 'forum-user-avatar-display' || e.target.closest('#forum-user-avatar-display')) document.getElementById('forum-avatar-upload').click();
    });
    document.getElementById('forum-avatar-upload') && document.getElementById('forum-avatar-upload').addEventListener('change', function(e) {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = function() { forumInitUserProfile(); db.forumUserProfile.avatar = reader.result; saveData(); const el = document.getElementById('forum-user-avatar-display'); if (el) el.src = reader.result; };
        reader.readAsDataURL(f);
        e.target.value = '';
    });

    const dmList = document.getElementById('forum-dm-list-container');
    if (dmList) dmList.addEventListener('click', function(e) {
        const item = e.target.closest('.forum-dm-item[data-user-id]');
        if (!item) return;
        if (forumDMListDeleteMode) {
            var id = item.dataset.userId;
            if (forumDMSelectedUserIds.has(id)) forumDMSelectedUserIds.delete(id);
            else forumDMSelectedUserIds.add(id);
            forumRenderDMList();
        } else {
            forumOpenDMConversation(item.dataset.userId, item.dataset.userName || '');
        }
    });
    document.getElementById('forum-dm-list-settings-btn') && document.getElementById('forum-dm-list-settings-btn').addEventListener('click', forumOpenDMSettingsModal);
    document.getElementById('forum-dm-list-refresh-btn') && document.getElementById('forum-dm-list-refresh-btn').addEventListener('click', forumGenerateStrangerDMs);
    document.getElementById('forum-dm-list-delete-btn') && document.getElementById('forum-dm-list-delete-btn').addEventListener('click', forumToggleDMListDeleteMode);
    document.getElementById('forum-dm-select-all-btn') && document.getElementById('forum-dm-select-all-btn').addEventListener('click', forumDMSelectAll);
    document.getElementById('forum-dm-delete-selected-btn') && document.getElementById('forum-dm-delete-selected-btn').addEventListener('click', forumDMDeleteSelected);
    document.getElementById('forum-dm-cancel-delete-btn') && document.getElementById('forum-dm-cancel-delete-btn').addEventListener('click', forumDMCancelDeleteMode);

    document.getElementById('send-forum-dm-btn') && document.getElementById('send-forum-dm-btn').addEventListener('click', forumSendDM);
    document.getElementById('forum-dm-input') && document.getElementById('forum-dm-input').addEventListener('keypress', function(e) { if (e.key === 'Enter') forumSendDM(); });
    document.getElementById('ai-reply-dm-btn') && document.getElementById('ai-reply-dm-btn').addEventListener('click', forumGenerateAIDMReply);
    document.getElementById('forum-dm-add-friend-btn') && document.getElementById('forum-dm-add-friend-btn').addEventListener('click', forumDMRequestAddFriend);
    document.getElementById('forum-friend-request-accept-btn') && document.getElementById('forum-friend-request-accept-btn').addEventListener('click', forumAcceptFriendRequest);
    document.getElementById('forum-friend-request-reject-btn') && document.getElementById('forum-friend-request-reject-btn').addEventListener('click', forumRejectFriendRequest);
    document.getElementById('forum-dm-settings-close-btn') && document.getElementById('forum-dm-settings-close-btn').addEventListener('click', forumCloseDMSettingsModal);
    const forumDmSettingsModal = document.getElementById('forum-dm-settings-modal');
    if (forumDmSettingsModal) forumDmSettingsModal.addEventListener('click', function(e) { if (e.target === forumDmSettingsModal) forumCloseDMSettingsModal(); });
    // 从私信对话页返回列表时刷新列表与未读角标，避免红点不消失
    var dmConversationBackBtn = document.querySelector('#forum-dm-conversation-screen .back-btn[data-target="forum-dm-list-screen"]');
    if (dmConversationBackBtn) dmConversationBackBtn.addEventListener('click', function() { forumRenderDMList(); forumUpdateDMUnreadBadge(); });
    
    setupForumDMMessageAreaLongPress();
    setupForumDMEditModal();
    
    const filterTabs = document.querySelectorAll('.forum-filter-tab');
    filterTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            filterTabs.forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            const filter = this.dataset.filter;
            renderForumPosts(db.forumPosts, filter);
        });
    });
}

