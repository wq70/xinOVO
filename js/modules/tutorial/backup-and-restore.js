async function createFullBackupData() {
    const backupData = JSON.parse(JSON.stringify(db));
    const keys = window.globalSettingKeysForBackup || [];
    keys.forEach(k => {
        if (db[k] !== undefined && backupData[k] === undefined) {
            try { backupData[k] = JSON.parse(JSON.stringify(db[k])); } catch (e) { backupData[k] = db[k]; }
        }
    });
    backupData._exportVersion = '3.0';
    backupData._exportTimestamp = Date.now();
    return backupData;
}

// 小剧场相关的所有 db 键（用于分类导出/导入）
const THEATER_DB_KEYS = [
    'theaterScenarios', 'theaterPromptPresets',
    'theaterHtmlScenarios', 'theaterHtmlPromptPresets',
    'theaterMode', 'theaterApiSettings', 'theaterFontSize', 'theaterFontPreset'
];

// 分类导出：只包含选中的表
async function createPartialBackupData(selectedKeys) {
    const keys = window.globalSettingKeysForBackup || [];
    const result = { _exportVersion: '3.0_partial', _exportTimestamp: Date.now(), _exportTables: selectedKeys };
    for (const key of selectedKeys) {
        if (key === 'globalSettings') {
            result.globalSettings = {};
            keys.forEach(k => { result.globalSettings[k] = db[k] !== undefined ? JSON.parse(JSON.stringify(db[k])) : undefined; });
        } else if (key === 'theaterData') {
            result.theaterData = {};
            THEATER_DB_KEYS.forEach(k => { result.theaterData[k] = db[k] !== undefined ? JSON.parse(JSON.stringify(db[k])) : undefined; });
        } else if (db[key] !== undefined) {
            result[key] = JSON.parse(JSON.stringify(db[key]));
        }
    }
    return result;
}

// 分类导入：只合并文件里包含的表，不覆盖其他数据
async function importPartialBackupData(data) {
    const startTime = Date.now();
    const tables = data._exportTables || [];
    if (tables.length === 0) return { success: false, error: '文件中没有可导入的分类' };
    try {
        const keys = window.globalSettingKeysForBackup || [];
        for (const key of tables) {
            if (key === 'globalSettings' && data.globalSettings) {
                Object.keys(data.globalSettings).forEach(k => { db[k] = data.globalSettings[k]; });
            } else if (key === 'theaterData' && data.theaterData) {
                Object.keys(data.theaterData).forEach(k => { db[k] = data.theaterData[k]; });
            } else if (data[key] !== undefined) {
                db[key] = data[key];
            }
        }
        showToast('正在写入...');
        await saveData(db);
        const duration = Date.now() - startTime;
        return { success: true, message: `分类导入完成 (耗时${duration}ms)` };
    } catch (error) {
        console.error('分类导入失败:', error);
        return { success: false, error: error.message };
    }
}

// 导入备份数据
async function importBackupData(data) {
    const startTime = Date.now();
    try {
        const clearTasks = [
            dexieDB.characters.clear(),
            dexieDB.groups.clear(),
            dexieDB.worldBooks.clear(),
            dexieDB.myStickers.clear(),
            dexieDB.globalSettings.clear()
        ];
        if (dexieDB.archives) clearTasks.push(dexieDB.archives.clear());
        await Promise.all(clearTasks);
        showToast('正在清空旧数据...');

        let convertedData = data;

        if (data._exportVersion !== '3.0') {
            showToast('检测到旧版备份文件，正在转换格式...');
            
            const reassembleHistory = (chat, backupData) => {
                if (!chat.history || !Array.isArray(chat.history) || chat.history.length === 0) {
                    return [];
                }
                if (typeof chat.history[0] === 'object' && chat.history[0] !== null) {
                    return chat.history;
                }
                if (backupData.__chunks__ && typeof chat.history[0] === 'string') {
                    let fullHistory = [];
                    chat.history.forEach(key => {
                        if (backupData.__chunks__[key]) {
                            try {
                                const chunk = JSON.parse(backupData.__chunks__[key]);
                                fullHistory = fullHistory.concat(chunk);
                            } catch (e) {
                                console.error(`Failed to parse history chunk ${key}`, e);
                            }
                        }
                    });
                    return fullHistory;
                }
                return []; 
            };

            const newData = { ...data };

            if (newData.characters) {
                newData.characters = newData.characters.map(char => ({
                    ...char,
                    history: reassembleHistory(char, data)
                }));
            }
            if (newData.groups) {
                newData.groups = newData.groups.map(group => ({
                    ...group,
                    history: reassembleHistory(group, data)
                }));
            }
            
            convertedData = newData;
        }

        // 从备份恢复所有键（不限于当前 db 的键），避免漏掉主题预设、屏幕预设等
        const metaKeys = ['_exportVersion', '_exportTimestamp', '_exportTables'];
        Object.keys(convertedData).forEach(key => {
            if (metaKeys.includes(key)) return;
            if (convertedData[key] !== undefined) {
                db[key] = convertedData[key];
            }
        });

        // 补全角色/群聊缺失字段（如主题等），避免旧版备份或残缺数据导致预设丢失
        (db.characters || []).forEach(c => {
            if (c.theme === undefined || c.theme === null || c.theme === '') c.theme = 'white_pink';
        });
        (db.groups || []).forEach(g => {
            if (g.theme === undefined || g.theme === null || g.theme === '') g.theme = 'white_pink';
        });

        if (!db.pomodoroTasks) db.pomodoroTasks = [];
        if (!db.pomodoroSettings) db.pomodoroSettings = { boundCharId: null, userPersona: '', focusBackground: '', taskCardBackground: '', encouragementMinutes: 25, pokeLimit: 5, globalWorldBookIds: [] };
        if (!db.insWidgetSettings) db.insWidgetSettings = { avatar1: 'https://i.postimg.cc/Y96LPskq/o-o-2.jpg', bubble1: 'love u.', avatar2: 'https://i.postimg.cc/GtbTnxhP/o-o-1.jpg', bubble2: 'miss u.' };
        if (!db.homeWidgetSettings) db.homeWidgetSettings = JSON.parse(JSON.stringify(defaultWidgetSettings));
        if (!Array.isArray(db.themePresets)) db.themePresets = [];
        if (!db.themeSettings || typeof db.themeSettings !== 'object') db.themeSettings = { global: {}, wallpapers: {}, bottomNav: {}, chatScreen: {} };
        if (!Array.isArray(db.iconPresets)) db.iconPresets = [];
        if (!Array.isArray(db.homeWidgetPresets)) db.homeWidgetPresets = [];
        if (!Array.isArray(db.widgetWallpaperPresets)) db.widgetWallpaperPresets = [];

        showToast('正在写入新数据...');
        await saveData(db);

        const duration = Date.now() - startTime;
        const message = `导入完成 (耗时${duration}ms)`;
        
        return { success: true, message: message };

    } catch (error) {
        console.error('导入数据失败:', error);
        return {
            success: false,
            error: error.message,
            duration: Date.now() - startTime
        };
    }
}

// GitHub Manager
