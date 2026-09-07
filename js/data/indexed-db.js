function initDatabase() {
    dexieDB = new Dexie('章鱼喷墨机DB_ee');
    dexieDB.version(1).stores({
        storage: 'key, value'
    });
    dexieDB.version(2).stores({
        characters: '&id',
        groups: '&id',
        worldBooks: '&id',
        myStickers: '&id',
        globalSettings: 'key'
    }).upgrade(async tx => {
        console.log("Upgrading database to version 2...");
        const oldData = await tx.table('storage').get('章鱼喷墨机');
        if (oldData && oldData.value) {
            console.log("Old data found, starting migration.");
            const data = JSON.parse(oldData.value);
            if (data.characters) await tx.table('characters').bulkPut(data.characters);
            if (data.groups) await tx.table('groups').bulkPut(data.groups);
            if (data.worldBooks) await tx.table('worldBooks').bulkPut(data.worldBooks);
            if (data.myStickers) await tx.table('myStickers').bulkPut(data.myStickers);
            
            const settingsToMigrate = {
                apiSettings: data.apiSettings || {},
                summaryApiSettings: data.summaryApiSettings || {},
                backgroundApiSettings: data.backgroundApiSettings || {},
                vectorApiSettings: data.vectorApiSettings || {},
                wallpaper: data.wallpaper || 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
                globalChatWallpaper: data.globalChatWallpaper || '',
            homeScreenMode: data.homeScreenMode || 'night',
            fontUrl: data.fontUrl || '',
            localFontName: data.localFontName || '',
            fontBuffer: data.fontBuffer || null,
                customIcons: data.customIcons || {},
                apiPresets: data.apiPresets || [],
                summaryApiPresets: data.summaryApiPresets || [],
                backgroundApiPresets: data.backgroundApiPresets || [],
                vectorApiPresets: data.vectorApiPresets || [],
                bubbleCssPresets: data.bubbleCssPresets || [],
                myPersonaPresets: data.myPersonaPresets || [],
                globalCss: data.globalCss || '',
                globalCssPresets: data.globalCssPresets || [],
                homeSignature: data.homeSignature || '编辑个性签名...',
                forumPosts: data.forumPosts || [],
                forumBindings: data.forumBindings || { worldBookIds: [], charIds: [], userPersonaIds: [] },
                pomodoroTasks: data.pomodoroTasks || [],
                pomodoroSettings: data.pomodoroSettings || { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] },
                insWidgetSettings: data.insWidgetSettings || { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' },
                homeWidgetSettings: data.homeWidgetSettings || defaultWidgetSettings,
                memoryTableTemplates: data.memoryTableTemplates || [],
                vectorMemoryTemplates: data.vectorMemoryTemplates || [],
            moreProfileCardBg: data.moreProfileCardBg || 'https://i.postimg.cc/XvFDdTKY/Smart-Select-20251013-023208.jpg',
            cotSettings: data.cotSettings || { enabled: false, activePresetId: 'default' },
            cotPresets: data.cotPresets || JSON.parse(JSON.stringify(DEFAULT_COT_PRESETS)),
            stickerCategories: data.stickerCategories || [],
            gptImageSettings: data.gptImageSettings || {},
            gptImagePresets: data.gptImagePresets || [],
            magicRoom: Object.assign({
                customPromptEnabled: false,
                customPromptTemplate: '',
                sysNotifEnabled: false,
                sysNotifSenderName: '',
                sysNotifShowAvatar: true,
                sysNotifShowContent: true,
                sysNotifCustomServer: false,
                sysNotifServerUrl: '',
                sysNotifServerKey: '',
            }, data.magicRoom || {})
            };

            const settingsPromises = Object.entries(settingsToMigrate).map(([key, value]) =>
                tx.table('globalSettings').put({ key, value })
            );
            await Promise.all(settingsPromises);
            
            await tx.table('storage').delete('章鱼喷墨机');
            console.log("Migration complete. Old data removed.");
        } else {
            console.log("No old data found to migrate.");
        }
    });
    dexieDB.version(3).stores({
        characters: '&id',
        groups: '&id',
        worldBooks: '&id',
        myStickers: '&id',
        globalSettings: 'key',
        archives: '&id,characterId,timestamp'
    });
}

// 数据保存与加载
const saveData = async () => {
    // 存储配额预检
    if (navigator.storage && navigator.storage.estimate) {
        try {
            const { usage, quota } = await navigator.storage.estimate();
            const pct = (usage / quota) * 100;
            if (pct > 95) {
                if (typeof showToast === 'function') {
                    showToast(`⚠️ 存储空间已使用 ${pct.toFixed(0)}%，请立即导出备份！`, 6000);
                }
            }
        } catch (_) { /* 不阻断主流程 */ }
    }

    try {
        await dexieDB.characters.bulkPut(db.characters);
        await dexieDB.groups.bulkPut(db.groups);
        await dexieDB.worldBooks.bulkPut(db.worldBooks);
        await dexieDB.myStickers.bulkPut(db.myStickers);
        if (dexieDB.archives) await dexieDB.archives.bulkPut(db.archives || []);

        const allSettingKeys = [...globalSettingKeys, 'worldBookCategoryOrder'];
        const settingsPromises = allSettingKeys.map(key => {
            if (db[key] !== undefined) {
                return dexieDB.globalSettings.put({ key: key, value: db[key] });
            }
            return null;
        }).filter(p => p);
        await Promise.all(settingsPromises);
    } catch (e) {
        console.error("saveData failed:", e);
        if (typeof showToast === 'function') {
            // 根据错误类型给用户有意义的提示
            const isQuota = e.name === 'QuotaExceededError'
                || (e.message && (e.message.includes('quota') || e.message.includes('delete record')));
            const msg = isQuota
                ? '存储空间不足，保存失败！请到「存储管理」导出备份后清理数据。'
                : '保存数据失败: ' + e.message;
            showToast(msg, 6000);
        }
    }
};

/**
 * 只保存单个角色到 IndexedDB（聊天消息写入、角色配置修改时使用）
 * 失败时自动降级为全量 saveData
 */
const saveCharacter = async (characterId) => {
    const character = db.characters.find(c => c.id === characterId);
    if (!character) return;
    try {
        await dexieDB.characters.put(character);
    } catch (e) {
        console.error("saveCharacter failed:", e);
    }
};

/**
 * 只保存单个群组到 IndexedDB（群消息写入、群配置修改时使用）
 * 失败时自动降级为全量 saveData
 */
const saveGroup = async (groupId) => {
    const group = db.groups.find(g => g.id === groupId);
    if (!group) return;
    try {
        await dexieDB.groups.put(group);
    } catch (e) {
        console.error("saveGroup failed:", e);
    }
};

/**
 * 只保存全局设置（apiSettings、壁纸、主题等），不写角色/群
 */
const saveGlobalSettings = async () => {
    try {
        const allSettingKeys = [...globalSettingKeys, 'worldBookCategoryOrder'];
        const promises = allSettingKeys
            .filter(key => db[key] !== undefined)
            .map(key => dexieDB.globalSettings.put({ key, value: db[key] }));
        await Promise.all(promises);
    } catch (e) {
        console.error("saveGlobalSettings failed:", e);
        if (typeof showToast === 'function') showToast("保存设置失败: " + e.message);
    }
};

window.saveCharacter = saveCharacter;
window.saveGroup = saveGroup;
window.saveGlobalSettings = saveGlobalSettings;

const loadData = async () => {
    const tables = [
        dexieDB.characters.toArray(),
        dexieDB.groups.toArray(),
        dexieDB.worldBooks.toArray(),
        dexieDB.myStickers.toArray(),
        dexieDB.globalSettings.toArray()
    ];
    if (dexieDB.archives) tables.push(dexieDB.archives.toArray());
    const results = await Promise.all(tables);
    const characters = results[0];
    const groups = results[1];
    const worldBooks = results[2];
    const myStickers = results[3];
    const settingsArray = results[4];
    const archives = results[5];

    db.characters = characters;
    db.groups = groups;
    db.worldBooks = worldBooks;
    db.myStickers = myStickers;
    db.archives = archives || [];

    const settings = settingsArray.reduce((acc, { key, value }) => {
        acc[key] = value;
        return acc;
    }, {});

    db.worldBookCategoryOrder = settings.worldBookCategoryOrder || null;

    globalSettingKeys.forEach(key => {
        const defaultValue = {
            apiSettings: {},
            summaryApiSettings: {},
            backgroundApiSettings: {},
            supplementPersonaApiSettings: {},
            peekApiSettings: {},
            vectorApiSettings: {},
            imageRecognitionEnabled: false,
            imageRecognitionApiSettings: {},
            stickerRecognitionApiSettings: {},
            wallpaper: 'https://i.postimg.cc/W4Z9R9x4/ins-1.jpg',
            globalChatWallpaper: '',
            globalCallWallpaper: '',
            homeScreenMode: 'night',
            fontUrl: '',
            localFontName: '',
            fontBuffer: null,
            customIcons: {},
            customAppNames: {},
            apiPresets: [],
            summaryApiPresets: [],
            backgroundApiPresets: [],
            supplementPersonaApiPresets: [],
            peekApiPresets: [],
            vectorApiPresets: [],
            imageRecognitionApiPresets: [],
            stickerRecognitionApiPresets: [],
            bubbleCssPresets: [],
            myPersonaPresets: [],
            fontPresets: [],
            globalCss: '',
            globalCssPresets: [],
            homeSignature: '编辑个性签名...',
            forumPosts: [],
            forumBindings: { worldBookIds: [], charIds: [], userPersonaIds: [] },
            forumUserProfile: { username: '', avatar: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bio: '', joinDate: 0 },
            forumSettings: { postsPerGeneration: 8, commentsPerPost: { min: 4, max: 8 }, generateDetailedStranger: false },
            forumApiSettings: { useForumApi: false, url: '', key: '', model: '', temperature: 0.9 },
            forumMessages: [],
            forumStrangerProfiles: {},
            forumFriendRequests: [],
            forumPendingRequestFromUser: {},
            pomodoroTasks: [],
            pomodoroSettings: { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] },
            insWidgetSettings: { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' },
            homeWidgetSettings: defaultWidgetSettings,
            memoryTableTemplates: [],
            vectorMemoryTemplates: [],
            activePersonaId: null,
            moreProfileCardBg: 'https://i.postimg.cc/XvFDdTKY/Smart-Select-20251013-023208.jpg',
            globalSendSound: '',
            globalReceiveSound: '',
            globalMessageSentSound: '',
            globalIncomingCallSound: '',
            multiMsgSoundEnabled: false,
            soundPresets: [],
            galleryPresets: [],
            iconPresets: [],
            homeWidgetPresets: [],
            widgetWallpaperPresets: [],
            cotSettings: { enabled: false, activePresetId: 'default' },
            cotPresets: JSON.parse(JSON.stringify(DEFAULT_COT_PRESETS)),
            hasSeenVideoCallDisclaimer: false,
            hasSeenVideoCallAvatarHint: false,
            favorites: [],
            piggyBank: { balance: 520, transactions: [], familyCards: [], receivedFamilyCards: [] },
            theaterScenarios: [],
            theaterPromptPresets: [],
            theaterHtmlScenarios: [],
            theaterHtmlPromptPresets: [],
            theaterMode: 'text',
            theaterApiSettings: { useTheaterApi: false, url: '', key: '', model: '' },
            theaterFontSize: 15,
        theaterFontPreset: null,
        avatarRecognitionDetailLevel: 'detailed',
        autoCompressImage: true,
        gptImageSettings: {},
        gptImagePresets: [],
        nodeTemplates: [],
        nodeSummaryText: '摘要',
        stickerCategories: [],
        magicRoom: {
            customPromptEnabled: false,
            customPromptTemplate: '',
            sysNotifEnabled: false,
            sysNotifSenderName: '',
            sysNotifShowAvatar: true,
            sysNotifInChatEnabled: false,
            sysNotifShowContent: true,
            sysNotifCustomServer: false,
            sysNotifServerUrl: '',
            sysNotifServerKey: '',
        },
        keepAliveCodeEnabled: false,
        keepAliveAudioEnabled: false,
        keepAliveAudioSrc: '',
        keepAliveAudioName: '',
        keepAliveAudioLibrary: []
    };
    db[key] = settings[key] !== undefined ? settings[key] : (defaultValue[key] !== undefined ? JSON.parse(JSON.stringify(defaultValue[key])) : undefined);
});

    if (!Array.isArray(db.stickerCategories)) db.stickerCategories = [];
    if (!Array.isArray(db.vectorMemoryTemplates)) db.vectorMemoryTemplates = [];
    if (!Array.isArray(db.vectorApiPresets)) db.vectorApiPresets = [];
    if (!db.piggyBank) db.piggyBank = { balance: 520, transactions: [], familyCards: [], receivedFamilyCards: [] };
    if (typeof db.piggyBank.balance !== 'number') db.piggyBank.balance = 520;
    if (!Array.isArray(db.piggyBank.transactions)) db.piggyBank.transactions = [];
    if (!Array.isArray(db.piggyBank.familyCards)) db.piggyBank.familyCards = [];
    if (!Array.isArray(db.piggyBank.receivedFamilyCards)) db.piggyBank.receivedFamilyCards = [];
    if (!db.forumStrangerProfiles || typeof db.forumStrangerProfiles !== 'object') db.forumStrangerProfiles = {};
    if (!Array.isArray(db.forumFriendRequests)) db.forumFriendRequests = [];
    if (!db.forumPendingRequestFromUser || typeof db.forumPendingRequestFromUser !== 'object') db.forumPendingRequestFromUser = {};
    if (db.forumSettings && db.forumSettings.generateDetailedStranger === undefined) db.forumSettings.generateDetailedStranger = false;
    if (db.forumSettings && db.forumSettings.enableCharAltDm === undefined) db.forumSettings.enableCharAltDm = false;
    if (db.forumSettings && !Array.isArray(db.forumSettings.charAltCharIds)) db.forumSettings.charAltCharIds = [];
    if (db.forumSettings && db.forumSettings.charAltProbability === undefined) db.forumSettings.charAltProbability = 25;
    if (db.forumSettings && (db.forumSettings.charAltNames === undefined || typeof db.forumSettings.charAltNames !== 'object')) db.forumSettings.charAltNames = {};

    // Data integrity checks
    db.characters.forEach(c => {
        if (!c.peekData) c.peekData = {}; 
        if (c.isPinned === undefined) c.isPinned = false;
        if (c.status === undefined) c.status = '在线';
        if (!c.worldBookIds) c.worldBookIds = [];
        if (c.callWallpaper === undefined) c.callWallpaper = '';
        if (c.customBubbleCss === undefined) c.customBubbleCss = '';
        if (c.useCustomBubbleCss === undefined) c.useCustomBubbleCss = false;
        if (c.allowCharSwitchBubbleCss === undefined) c.allowCharSwitchBubbleCss = false;
        if (!Array.isArray(c.bubbleCssThemeBindings)) c.bubbleCssThemeBindings = [];
        if (c.currentBubbleCssPresetName === undefined) c.currentBubbleCssPresetName = '';
        if (c.themeJustChangedByUser === undefined) c.themeJustChangedByUser = '';
        if (c.showTimestamp === undefined) c.showTimestamp = false;
        if (c.timestampPosition === undefined) c.timestampPosition = 'below_avatar';
        if (!c.statusPanel) {
            c.statusPanel = {
                enabled: false,
                promptSuffix: '',
                regexPattern: '',
                replacePattern: '',
                historyLimit: 3,
                currentStatusRaw: '',
                currentStatusHtml: '',
                history: []
            };
        }
        if (!['journal', 'table', 'vector'].includes(c.memoryMode)) c.memoryMode = 'journal';
        if (!c.memoryTables || typeof c.memoryTables !== 'object') {
            c.memoryTables = {
                enabled: true,
                boundTemplateIds: [],
                data: {},
                lockedFields: {},
                history: [],
                lastChangedFieldPaths: []
            };
        }
        if (!Array.isArray(c.memoryTables.boundTemplateIds)) c.memoryTables.boundTemplateIds = [];
        if (!c.memoryTables.data || typeof c.memoryTables.data !== 'object') c.memoryTables.data = {};
        if (!c.memoryTables.lockedFields || typeof c.memoryTables.lockedFields !== 'object') c.memoryTables.lockedFields = {};
        if (!Array.isArray(c.memoryTables.history)) c.memoryTables.history = [];
        if (!Array.isArray(c.memoryTables.lastChangedFieldPaths)) c.memoryTables.lastChangedFieldPaths = [];
        if (!c.vectorMemory || typeof c.vectorMemory !== 'object') {
            c.vectorMemory = {
                enabled: true,
                boundTemplateId: null,
                entries: [],
                history: [],
                topK: 5,
                threshold: 0.28,
                autoSummaryEnabled: false,
                autoSummaryInterval: 200,
                autoSummaryState: 'idle',
                autoSummaryPending: false,
                lastSummarizedMsgId: null,
                lastSummarizedMsgTimestamp: null,
                lastContextBlock: '',
                lastRetrievedEntryIds: [],
                lastQueryText: '',
                lastPreparedAt: null
            };
        }
        if (!Array.isArray(c.vectorMemory.entries)) c.vectorMemory.entries = [];
        if (!Array.isArray(c.vectorMemory.history)) c.vectorMemory.history = [];
        if (c.vectorMemory.topK === undefined) c.vectorMemory.topK = 5;
        if (c.vectorMemory.threshold === undefined) c.vectorMemory.threshold = 0.28;
        if (c.vectorMemory.autoSummaryEnabled === undefined) c.vectorMemory.autoSummaryEnabled = false;
        if (!Number.isFinite(parseInt(c.vectorMemory.autoSummaryInterval, 10))) c.vectorMemory.autoSummaryInterval = 200;
        if (!c.vectorMemory.autoSummaryState) c.vectorMemory.autoSummaryState = 'idle';
        if (c.vectorMemory.autoSummaryPending === undefined) c.vectorMemory.autoSummaryPending = false;
        if (!Array.isArray(c.vectorMemory.lastRetrievedEntryIds)) c.vectorMemory.lastRetrievedEntryIds = [];
        if (!c.regexFilter) {
            c.regexFilter = {
                enabled: false,
                rules: []
            };
        }
        if (!c.autoReply) {
            c.autoReply = {
                enabled: false,
                interval: 60,
                lastTriggerTime: 0
            };
        }
        if (!c.gallery) c.gallery = [];
        if (c.useRealGallery === undefined) c.useRealGallery = false;
        if (!c.callHistory) c.callHistory = [];
        if (!c.userAvatarLibrary || !Array.isArray(c.userAvatarLibrary)) c.userAvatarLibrary = [];
        if (!c.charAvatarLibrary || !Array.isArray(c.charAvatarLibrary)) c.charAvatarLibrary = [];
        if (c.charTimezone === undefined) c.charTimezone = '';
        if (c.myTimezone === undefined) c.myTimezone = '';
        if (c.enableDynamicTimezone === undefined) c.enableDynamicTimezone = false;
        if (c.myEnableDynamicTimezone === undefined) c.myEnableDynamicTimezone = false;
        // 拉黑与好友申请
        if (c.isBlocked === undefined) c.isBlocked = false;
        if (!c.blockHistory || !Array.isArray(c.blockHistory)) c.blockHistory = [];
        if (!c.friendRequests || !Array.isArray(c.friendRequests)) c.friendRequests = [];
        if (!c.blockReapply || typeof c.blockReapply !== 'object') {
            c.blockReapply = { mode: 'fixed', fixedInterval: 30, lastRequestTime: null, nextCheckTime: null, pendingRequestId: null };
        }
        // 角色拉黑用户（角色主动拉黑）
        if (c.canBlockUser === undefined) c.canBlockUser = true;
        // 角色掌控模式：允许角色查看并操控用户手机
        if (c.phoneControlEnabled === undefined) c.phoneControlEnabled = false;
        if (c.phoneControlViewLimit === undefined) c.phoneControlViewLimit = 10;
        if (!Array.isArray(c.phoneControlHistory)) c.phoneControlHistory = [];
        if (c.familyCardEnabled === undefined) c.familyCardEnabled = false;
        if (c.isBlockedByChar === undefined) c.isBlockedByChar = false;
        if (c.blockedByCharAt === undefined) c.blockedByCharAt = null;
        if (c.blockedByCharReason === undefined) c.blockedByCharReason = '';
        if (!c.charBlockHistory || !Array.isArray(c.charBlockHistory)) c.charBlockHistory = [];
        if (!c.userFriendRequests || !Array.isArray(c.userFriendRequests)) c.userFriendRequests = [];
        // 节点系统
        if (!c.nodes) c.nodes = [];
        if (c.activeNodeId === undefined) c.activeNodeId = null;

        // 用户头像库迁移：旧数据只有 name（实为描述），拆分为 name（简短名称）+ description（描述）
        c.userAvatarLibrary.forEach(function (item) {
            if (item.description === undefined && item.name) {
                item.description = item.name;
                item.name = item.name.length > 12 ? item.name.slice(0, 12) + '…' : item.name;
            }
            if (item.name === undefined) item.name = (item.description && item.description.length > 12) ? item.description.slice(0, 12) + '…' : (item.description || '未命名');
        });
    });
    if (db.userAvatarLibrary && Array.isArray(db.userAvatarLibrary) && db.userAvatarLibrary.length > 0) {
        db.characters.forEach(c => {
            if (!c.userAvatarLibrary) c.userAvatarLibrary = [];
            c.userAvatarLibrary.push(...db.userAvatarLibrary);
        });
        delete db.userAvatarLibrary;
        if (typeof saveData === 'function') saveData();
    }
    db.groups.forEach(g => {
        if (g.isPinned === undefined) g.isPinned = false;
        if (!g.worldBookIds) g.worldBookIds = [];
        if (g.customBubbleCss === undefined) g.customBubbleCss = '';
        if (g.useCustomBubbleCss === undefined) g.useCustomBubbleCss = false;
        if (g.showTimestamp === undefined) g.showTimestamp = false;
        if (g.timestampPosition === undefined) g.timestampPosition = 'below_avatar';
        if (!g.callHistory) g.callHistory = [];
    });
    
    // Handle old localStorage data if it exists
    const oldLocalStorageData = localStorage.getItem('gemini-chat-app-db');
    if(oldLocalStorageData) {
        console.log("Found old localStorage data, migrating...");
        const data = JSON.parse(oldLocalStorageData);
        await dexieDB.transaction('rw', dexieDB.tables, async () => {
            if (data.characters) await dexieDB.characters.bulkPut(data.characters);
            if (data.groups) await dexieDB.groups.bulkPut(data.groups);
        });
        localStorage.removeItem('gemini-chat-app-db');
        await loadData();
    }
};

// 存储分析工具
const dataStorage = {
    getStorageInfo: async function() {
        const stringify = (obj) => {
            try {
                return JSON.stringify(obj).length;
            } catch (e) {
                console.warn("Could not stringify object for size calculation:", obj, e);
                return 0;
            }
        };

        let categorizedSizes = {
            messages: 0,
            charactersAndGroups: 0,
            worldAndForum: 0,
            personalization: 0,
            apiAndCore: 0,
            other: 0
        };

        if (!db || !db.characters) {
            await loadData();
        }

        // 1. Messages (History)
        (db.characters || []).forEach(char => {
            categorizedSizes.messages += stringify(char.history);
        });
        (db.groups || []).forEach(group => {
            categorizedSizes.messages += stringify(group.history);
        });

        // 2. Characters and Groups (metadata)
        (db.characters || []).forEach(char => {
            const charWithoutHistory = { ...char, history: undefined };
            categorizedSizes.charactersAndGroups += stringify(charWithoutHistory);
        });
        (db.groups || []).forEach(group => {
            const groupWithoutHistory = { ...group, history: undefined };
            categorizedSizes.charactersAndGroups += stringify(groupWithoutHistory);
        });

        // 3. World and Forum
        categorizedSizes.worldAndForum += stringify(db.worldBooks);
        categorizedSizes.worldAndForum += stringify(db.forumPosts);
        categorizedSizes.worldAndForum += stringify(db.forumBindings);

        // 4. Personalization
        categorizedSizes.personalization += stringify(db.myStickers);
        categorizedSizes.personalization += stringify(db.wallpaper);
        categorizedSizes.personalization += stringify(db.globalChatWallpaper);
        categorizedSizes.personalization += stringify(db.globalCallWallpaper);
        categorizedSizes.personalization += stringify(db.homeScreenMode);
        categorizedSizes.personalization += stringify(db.fontUrl);
        categorizedSizes.personalization += stringify(db.localFontName);
        categorizedSizes.personalization += stringify(db.fontBuffer);
        categorizedSizes.personalization += stringify(db.customIcons);
        categorizedSizes.personalization += stringify(db.bubbleCssPresets);
        categorizedSizes.personalization += stringify(db.myPersonaPresets);
        categorizedSizes.personalization += stringify(db.globalCss);
        categorizedSizes.personalization += stringify(db.globalCssPresets);
        categorizedSizes.personalization += stringify(db.homeSignature);
        categorizedSizes.personalization += stringify(db.pomodoroTasks);
        categorizedSizes.personalization += stringify(db.pomodoroSettings);
        categorizedSizes.personalization += stringify(db.insWidgetSettings);
        categorizedSizes.personalization += stringify(db.homeWidgetSettings);
        categorizedSizes.personalization += stringify(db.moreProfileCardBg);
        categorizedSizes.personalization += stringify(db.soundPresets);
        categorizedSizes.personalization += stringify(db.iconPresets);

        // 5. API and Core
        categorizedSizes.apiAndCore += stringify(db.apiSettings);
        categorizedSizes.apiAndCore += stringify(db.apiPresets);
        categorizedSizes.apiAndCore += stringify(db.cotSettings);
        categorizedSizes.apiAndCore += stringify(db.cotPresets);
        categorizedSizes.apiAndCore += stringify(db.keepAliveAudioSrc);
        categorizedSizes.apiAndCore += stringify(db.keepAliveAudioLibrary);

        const totalSize = Object.values(categorizedSizes).reduce((sum, size) => sum + size, 0);

        return {
            totalSize,
            categorizedSizes
        };
    }
};
