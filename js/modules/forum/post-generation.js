function getForumGenerationContext() {
    let context = "以下是论坛社区的背景设定和主要角色信息：\n\n";
    const bindings = db.forumBindings || { worldBookIds: [], charIds: [], userPersonaIds: [] };

    if (bindings.worldBookIds && bindings.worldBookIds.length > 0) {
        context += "===== 世界观设定 =====\n";
        bindings.worldBookIds.forEach(id => {
            const book = db.worldBooks.find(wb => wb.id === id);
            if (book && !book.disabled) {
                context += `设定名: ${book.name}\n内容: ${book.content}\n\n`;
            }
        });
    }

    if (bindings.charIds && bindings.charIds.length > 0) {
        context += "===== 主要角色人设 =====\n";
        bindings.charIds.forEach(id => {
            const char = db.characters.find(c => c.id === id);
            if (char) {
                context += `角色名: ${char.realName} (昵称: ${char.remarkName})\n人设: ${char.persona}\n\n`;
            }
        });
    }

    // 小号模式下不注入用户人设，保护隐私
    const activeAccount = forumGetActiveAccount();
    if (!activeAccount.isAlt && bindings.userPersonaIds && bindings.userPersonaIds.length > 0) {
        context += "=====  (你) 的人设 =====\n";
        bindings.userPersonaIds.forEach(presetName => {
            const preset = db.myPersonaPresets.find(p => p.name === presetName);
            if (preset) {
                context += `人设名: ${preset.name}\n人设描述: ${preset.persona}\n\n`;
            }
        });
    }

    if (context.length < 50) { 
        return "没有提供任何特定的背景设定，请自由发挥，创作一些通用的、有趣有网感的论坛帖子。禁止以user或者char的视角制作帖子，发帖人只能是NPC";
    }

    return context;
}

async function handleForumRefresh() {
    const forumApiSettings = db.forumApiSettings || {};
    const apiSettings = forumApiSettings.useForumApi && forumApiSettings.url && forumApiSettings.key && forumApiSettings.model
        ? forumApiSettings
        : db.apiSettings;
    let { url, key, model } = apiSettings;
    if (!url || !key || !model) {
        showToast('请先在API设置中配置好接口信息');
        switchScreen('api-settings-screen');
        return;
    }

    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }

    const refreshBtn = document.getElementById('forum-refresh-btn');
    const postsContainer = document.getElementById('forum-posts-container');
    const searchInput = document.getElementById('forum-search-input');

    refreshBtn.disabled = true;
    const spinner = `<div class="spinner" style="display: block; margin: 0 auto; border-top-color: var(--primary-color);"></div>`;
    postsContainer.innerHTML = `<p class="placeholder-text" style="margin-top: 50px;">正在生成论坛内容，请稍候...<br>${spinner}</p>`;

    try {
        const context = getForumGenerationContext();
        const keywords = searchInput.value.trim();

        let systemPrompt = `你是一位专业的论坛内容生成专家，专门为指定世界观生成论坛帖子。
背景信息如下：
${context}

你的任务是读取背景世界观生成${(db.forumSettings && db.forumSettings.postsPerGeneration) || 8}篇风格各异、内容有趣的论坛帖子，每条帖子下面生成${(db.forumSettings && db.forumSettings.commentsPerPost && db.forumSettings.commentsPerPost.min) || 4}到${(db.forumSettings && db.forumSettings.commentsPerPost && db.forumSettings.commentsPerPost.max) || 8}条评论，每个帖子评论数量应该不一样，注意区分真实姓名和网名，注意user隐私，你的角色是“世界构建者”和“社区模拟器”，你需要分析char设定和user人设所处世界的世界观而不是“角色扮演者”，发帖人应该是该角色所处世界观下的其他NPC，发帖人不能是user。ABSOLUTELY DO NOT。若角色为普通人或需保密等神秘身份就禁止提及角色真实姓名，可以用代称或者暗号，只有当user或者char是公众人物名气大时才可以提及真实姓名。char的备注或者昵称是仅供user使用的，NPC不知道也禁止提及char的备注。若user和char不在一个地区就禁止有NPC目睹二人同框。

请严格按照下面的XML标签格式返回，不要包含任何多余的解释和注释。禁止以user的视角进行创作。

返回格式示例:
<posts>
  <post>
    <title>一个引人注目的帖子标题</title>
    <summary>对帖子内容的客观的重点摘要，大约100字左右，DO NOT use first-person “我”</summary>
    <content>帖子的详细内容，150~300字。\n可以使用换行符来分段落，注意排版。</content>
    <comments>
      <comment>
        <username>路人（随机姓名）</username>
        <content>这是第一条评论的内容，表达一个观点。</content>
        <timestamp>5分钟前</timestamp>
      </comment>
      <comment>
        <username>（随机姓名）</username>
        <content>这是第二条评论，可能反驳楼主或楼上的观点。</content>
        <timestamp>3分钟前</timestamp>
      </comment>
    </comments>
  </post>
</posts>
`;

        if (keywords) {
            systemPrompt += `\n\n重要指令：本次生成的所有帖子标题必须和以下关键词相关：【${keywords}】，同时也需要和之前绑定的设定相关。禁止相似帖子过多，不要特地把关键词标注出来。`;
        }

        const temperature = apiSettings.temperature !== undefined ? apiSettings.temperature : 0.8;

        const requestBody = {
            model: apiSettings.model,
            messages: [{ role: "user", content: systemPrompt }],
            temperature: temperature
        };

        const endpoint = `${url}/v1/chat/completions`;
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };

        const contentStr = await fetchAiResponse(apiSettings, requestBody, headers, endpoint);

        const posts = [];
        const postRegex = /<post>([\s\S]*?)<\/post>/g;
        let postMatch;
        while ((postMatch = postRegex.exec(contentStr)) !== null) {
            const postContent = postMatch[1];
            const titleMatch = postContent.match(/<title>([\s\S]*?)<\/title>/);
            const summaryMatch = postContent.match(/<summary>([\s\S]*?)<\/summary>/);
            const contentMatch = postContent.match(/<content>([\s\S]*?)<\/content>/);
            
            const comments = [];
            const commentsBlockMatch = postContent.match(/<comments>([\s\S]*?)<\/comments>/);
            if (commentsBlockMatch) {
                const commentRegex = /<comment>([\s\S]*?)<\/comment>/g;
                let commentMatch;
                while ((commentMatch = commentRegex.exec(commentsBlockMatch[1])) !== null) {
                    const cContent = commentMatch[1];
                    const uMatch = cContent.match(/<username>([\s\S]*?)<\/username>/);
                    const textMatch = cContent.match(/<content>([\s\S]*?)<\/content>/);
                    const timeMatch = cContent.match(/<timestamp>([\s\S]*?)<\/timestamp>/);
                    if (uMatch && textMatch) {
                        comments.push({
                            username: uMatch[1].trim(),
                            content: textMatch[1].trim(),
                            timestamp: timeMatch ? timeMatch[1].trim() : '刚刚'
                        });
                    }
                }
            }
            
            if (titleMatch && contentMatch) {
                posts.push({
                    title: titleMatch[1].trim(),
                    summary: summaryMatch ? summaryMatch[1].trim() : '',
                    content: contentMatch[1].trim(),
                    comments: comments
                });
            }
        }

        if (posts.length > 0) {
            const enhancedPosts = posts.map(post => ({
              ...post,
              id: `post_${Date.now()}_${Math.random()}`,
              authorId: 'npc',
              username: `楼主${Math.floor(100 + Math.random() * 900)}`,
              likeCount: Math.floor(Math.random() * 200),
              shareCount: Math.floor(Math.random() * 50),
              isLiked: false,
              comments: (post.comments || []).map(c => ({ ...c, authorId: 'npc' }))
            }));

            const userPosts = (db.forumPosts || []).filter(p => p.authorId === 'user' || (p.authorId && p.authorId.startsWith('alt_')));
            db.forumPosts = userPosts.concat(enhancedPosts);
            await saveData();
            renderForumPosts(db.forumPosts);

        } else {
            throw new Error("AI返回的数据格式不正确");
        }

    } catch (error) {
        showApiError(error);
        postsContainer.innerHTML = `<p class="placeholder-text" style="margin-top: 50px;">生成失败了，请检查API设置或网络后重试。</p>`;
    } finally {
        refreshBtn.disabled = false;
    }
}

function renderForumPosts(posts, filter = 'all') {
    const postsContainer = document.getElementById('forum-posts-container');
    postsContainer.innerHTML = ''; 

    if (!posts || posts.length === 0) {
        postsContainer.innerHTML = '<p class="placeholder-text" style="margin-top: 50px;">AI还没生成任何帖子，请点击刷新按钮。';
        return;
    }
    
    let filteredPosts = posts;
    
    if (filter === 'liked') {
        filteredPosts = posts.filter(p => p.isLiked);
    } else if (filter === 'favorited') {
        filteredPosts = posts.filter(p => p.isFavorited);
    }
    
    if (filteredPosts.length === 0) {
        const filterText = filter === 'liked' ? '点赞' : filter === 'favorited' ? '收藏' : '';
        postsContainer.innerHTML = `<p class="placeholder-text" style="margin-top: 50px;">暂无${filterText}的帖子</p>`;
        return;
    }

    filteredPosts.forEach(post => {
        const card = document.createElement('div');
        card.className = 'forum-post-card';
        if (forumPostDeleteMode) {
            card.classList.add('forum-post-delete-mode');
            if (forumSelectedPostIds.has(post.id)) card.classList.add('forum-post-selected');
        }
        card.dataset.id = post.id;

        let checkboxHtml = '';
        if (forumPostDeleteMode) {
            checkboxHtml = '<div class="forum-post-select-checkbox"></div>';
        }

        const titleEl = document.createElement('h3');
        titleEl.className = 'post-title';
        titleEl.textContent = post.title || '无标题';

        const summaryEl = document.createElement('p');
        summaryEl.className = 'post-summary';
        summaryEl.textContent = post.summary || '无摘要';

        if (forumPostDeleteMode) {
            const wrapper = document.createElement('div');
            wrapper.style.cssText = 'display:flex;align-items:flex-start;gap:12px;width:100%;';
            const cbDiv = document.createElement('div');
            cbDiv.className = 'forum-post-select-checkbox';
            const textDiv = document.createElement('div');
            textDiv.style.cssText = 'flex:1;min-width:0;';
            textDiv.appendChild(titleEl);
            textDiv.appendChild(summaryEl);
            wrapper.appendChild(cbDiv);
            wrapper.appendChild(textDiv);
            card.appendChild(wrapper);
        } else {
            card.appendChild(titleEl);
            card.appendChild(summaryEl);
        }

        postsContainer.appendChild(card);
    });
}

function forumInitUserProfile() {
    if (!db.forumUserProfile || typeof db.forumUserProfile !== 'object') {
        db.forumUserProfile = { username: '', avatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bio: '', joinDate: Date.now() };
        saveData();
    }
    if (!db.forumUserProfile.username && db.forumUserProfile.joinDate) {
        db.forumUserProfile.username = '用户' + Math.floor(1000 + Math.random() * 9000);
        saveData();
    }
}

function forumAddHeaderButtonsAndFAB() {
    const actionBtnGroup = document.querySelector('#forum-screen .action-btn-group');
    if (!actionBtnGroup) return;

    if (!document.getElementById('forum-post-delete-btn')) {
        const delBtn = document.createElement('button');
        delBtn.className = 'action-btn';
        delBtn.id = 'forum-post-delete-btn';
        delBtn.title = '删除帖子';
        delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
        actionBtnGroup.appendChild(delBtn);
    }

    if (!document.getElementById('forum-dm-btn')) {
        const dmBtn = document.createElement('button');
        dmBtn.className = 'action-btn';
        dmBtn.id = 'forum-dm-btn';
        dmBtn.title = '私信';
        dmBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
        actionBtnGroup.appendChild(dmBtn);
    }

    if (!document.getElementById('forum-settings-btn')) {
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'action-btn';
        settingsBtn.id = 'forum-settings-btn';
        settingsBtn.title = '设置';
        settingsBtn.innerHTML = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';
        actionBtnGroup.appendChild(settingsBtn);
    }

    const forumScreen = document.getElementById('forum-screen');
    if (forumScreen && !document.getElementById('create-post-fab')) {
        const fab = document.createElement('button');
        fab.className = 'forum-fab';
        fab.id = 'create-post-fab';
        fab.title = '发布新帖';
        fab.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        forumScreen.appendChild(fab);
    }

    if (!document.getElementById('forum-fab-style')) {
        const style = document.createElement('style');
        style.id = 'forum-fab-style';
        style.textContent = '.forum-fab{position:fixed;bottom:80px;right:20px;width:56px;height:56px;border-radius:50%;background:var(--primary-color);color:#fff;border:none;box-shadow:0 4px 12px rgba(0,0,0,0.15);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:100;}.forum-fab:active{transform:scale(0.95);}';
        document.head.appendChild(style);
    }
}

function forumTogglePostLike(postId) {
    const post = db.forumPosts.find(p => p.id === postId);
    if (!post) return;
    post.isLiked = !post.isLiked;
    post.likeCount = (post.likeCount || 0) + (post.isLiked ? 1 : -1);
    saveData();
    const likeBtn = document.getElementById('like-post-btn');
    const likeCountEl = document.getElementById('like-count');
    if (likeBtn) {
        likeBtn.dataset.liked = post.isLiked;
        const svg = likeBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', post.isLiked ? '#ff4757' : 'none');
    }
    if (likeCountEl) likeCountEl.textContent = post.likeCount;
}

function forumTogglePostFavorite(postId) {
    const post = db.forumPosts.find(p => p.id === postId);
    if (!post) return;
    post.isFavorited = !post.isFavorited;
    saveData();
    const favoriteBtn = document.getElementById('favorite-post-btn');
    if (favoriteBtn) {
        favoriteBtn.dataset.favorited = post.isFavorited;
        const svg = favoriteBtn.querySelector('svg');
        if (svg) svg.setAttribute('fill', post.isFavorited ? '#ffd700' : 'none');
    }
    showToast(post.isFavorited ? '已收藏' : '已取消收藏');
}

function forumPublishComment(postId, content) {
    const post = db.forumPosts.find(p => p.id === postId);
    if (!post) return;
    const activeAccount = forumGetActiveAccount();
    const defaultAvatarUrl = 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg';
    const newComment = { id: 'comment_' + Date.now() + '_' + Math.random(), authorId: activeAccount.isAlt ? activeAccount.id : 'user', username: activeAccount.username || '用户', avatar: activeAccount.avatar || defaultAvatarUrl, content: content, timestamp: new Date().toLocaleString() };
    if (forumReplyTarget) {
        newComment.replyTo = { commentId: forumReplyTarget.commentId, username: forumReplyTarget.username };
        forumReplyTarget = null;
    }
    if (!post.comments) post.comments = [];
    post.comments.push(newComment);
    saveData();
    renderPostDetail(post);
    const input = document.getElementById('forum-comment-input');
    if (input) input.value = '';
    showToast('评论成功');
}

async function forumPublishPost() {
    const titleInput = document.getElementById('forum-post-title-input');
    const contentInput = document.getElementById('forum-post-content-input');
    const title = titleInput && titleInput.value.trim();
    const content = contentInput && contentInput.value.trim();
    if (!title || !content) { showToast('标题和内容不能为空'); return; }
    
    const activeAccount = forumGetActiveAccount();
    const newPost = { 
        id: 'post_' + Date.now() + '_' + Math.random(), 
        authorId: activeAccount.isAlt ? activeAccount.id : 'user', 
        username: activeAccount.username || '用户', 
        title: title, 
        content: content, 
        summary: content.length > 100 ? content.substring(0, 100) + '...' : content, 
        timestamp: Date.now(), 
        likeCount: 0, 
        isLiked: false, 
        comments: [] 
    };
    
    if (!db.forumPosts) db.forumPosts = [];
    db.forumPosts.unshift(newPost);
    await saveData();
    
    renderForumPosts(db.forumPosts);
    document.getElementById('create-forum-post-modal').classList.remove('visible');
    showToast('发布成功');
    
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    
    const autoReplyCount = (db.forumSettings && db.forumSettings.autoReplyCount) || 0;
    if (autoReplyCount > 0) {
        forumGenerateAutoReplies(newPost.id, autoReplyCount);
    }
}

async function forumGenerateAutoReplies(postId, replyCount) {
    const post = db.forumPosts.find(p => p.id === postId);
    if (!post) return;
    
    const forumApiSettings = db.forumApiSettings || {};
    let apiSettings = forumApiSettings.useForumApi ? forumApiSettings : db.apiSettings;
    
    if (!apiSettings.url || !apiSettings.key || !apiSettings.model) {
        showToast('未配置API，无法自动生成评论');
        return;
    }
    
    showToast('正在生成AI评论...');
    
    try {
        const context = getForumGenerationContext();
        
        const systemPrompt = `你是一位论坛内容生成专家。
背景信息：
${context}

用户刚发布了一篇新帖：
标题: ${post.title}
内容: ${post.content}
作者: ${post.username}

请生成${replyCount}条来自不同NPC的评论。评论要有不同的观点和风格，有的支持，有的质疑，有的提供新的视角。评论者都是论坛中的NPC用户，要根据背景设定来回复。

返回XML标签格式:
<comments>
  <comment>
    <username>评论者昵称</username>
    <content>评论内容</content>
    <timestamp>刚刚</timestamp>
  </comment>
</comments>
`;
        
        let url = apiSettings.url;
        if (url.endsWith('/')) url = url.slice(0, -1);
        
        const temperature = apiSettings.temperature !== undefined ? apiSettings.temperature : 0.9;
        
        const requestBody = {
            model: apiSettings.model,
            messages: [{ role: "user", content: systemPrompt }],
            temperature: temperature
        };
        
        const endpoint = `${url}/v1/chat/completions`;
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiSettings.key}` };
        
        const contentStr = await fetchAiResponse(apiSettings, requestBody, headers, endpoint);
        
        const comments = [];
        const commentRegex = /<comment>([\s\S]*?)<\/comment>/g;
        let commentMatch;
        while ((commentMatch = commentRegex.exec(contentStr)) !== null) {
            const cContent = commentMatch[1];
            const uMatch = cContent.match(/<username>([\s\S]*?)<\/username>/);
            const textMatch = cContent.match(/<content>([\s\S]*?)<\/content>/);
            const timeMatch = cContent.match(/<timestamp>([\s\S]*?)<\/timestamp>/);
            if (uMatch && textMatch) {
                comments.push({
                    username: uMatch[1].trim(),
                    content: textMatch[1].trim(),
                    timestamp: timeMatch ? timeMatch[1].trim() : '刚刚'
                });
            }
        }
        
        if (comments.length > 0) {
            if (!post.comments) post.comments = [];
            
            comments.forEach(comment => {
                const newComment = {
                    id: 'comment_' + Date.now() + '_' + Math.random(),
                    authorId: 'npc',
                    username: comment.username || '路人' + Math.floor(100 + Math.random() * 900),
                    content: comment.content || '',
                    timestamp: comment.timestamp || '刚刚'
                };
                post.comments.push(newComment);
            });
            
            await saveData();
            renderForumPosts(db.forumPosts);
            showToast(`成功生成${jsonData.comments.length}条AI评论`);
        }
        
    } catch (error) {
        console.error('自动回复生成失败:', error);
        showToast('自动生成评论失败');
    }
}

