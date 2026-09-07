// --- 世界书功能 (js/modules/worldbook.js) ---
let pendingWbCategoryDelete = null; // 删除分类弹窗用：{ category, count }
let currentWorldBookCategory = null; // 当前正在查看的详情分类

function enterWorldBookMultiSelectMode(initialId, initialCategory = null) {
    if (isWorldBookMultiSelectMode) return;
    isWorldBookMultiSelectMode = true;

    document.getElementById('add-world-book-btn').style.display = 'none';
    const exportBtn = document.getElementById('export-world-book-btn');
    if (exportBtn) exportBtn.style.display = 'none';
    const detailExportBtn = document.getElementById('detail-export-world-book-btn');
    if (detailExportBtn) detailExportBtn.style.display = 'none';
    document.getElementById('cancel-wb-multi-select-btn').style.display = 'inline-block';
    document.getElementById('world-book-multi-select-bar').style.display = 'flex';
    document.querySelector('#world-book-screen .content').style.paddingBottom = '70px';
    
    // 如果在详情页
    const detailBar = document.getElementById('world-book-detail-multi-select-bar');
    if (detailBar && document.getElementById('world-book-detail-screen').classList.contains('active')) {
        detailBar.style.display = 'flex';
        document.querySelector('#world-book-detail-screen .content').style.paddingBottom = '70px';
        document.getElementById('world-book-multi-select-bar').style.display = 'none'; // 隐藏首页的多选栏
    }

    selectedWorldBookIds.clear();
    if (initialId) {
        selectedWorldBookIds.add(initialId);
    }

    updateWorldBookSelectCount();
    
    if (document.getElementById('world-book-detail-screen').classList.contains('active')) {
        renderWorldBookDetailList(currentWorldBookCategory);
    } else {
        renderWorldBookList(initialCategory); 
    }
}

function exitWorldBookMultiSelectMode() {
    isWorldBookMultiSelectMode = false;

    document.getElementById('add-world-book-btn').style.display = 'inline-block';
    const exportBtn = document.getElementById('export-world-book-btn');
    if (exportBtn) exportBtn.style.display = 'inline-block';
    const detailExportBtn = document.getElementById('detail-export-world-book-btn');
    if (detailExportBtn) detailExportBtn.style.display = 'inline-block';
    document.getElementById('cancel-wb-multi-select-btn').style.display = 'none';
    document.getElementById('world-book-multi-select-bar').style.display = 'none';
    document.querySelector('#world-book-screen .content').style.paddingBottom = '0';
    
    const detailBar = document.getElementById('world-book-detail-multi-select-bar');
    if (detailBar) detailBar.style.display = 'none';
    const detailContent = document.querySelector('#world-book-detail-screen .content');
    if (detailContent) detailContent.style.paddingBottom = '0';

    selectedWorldBookIds.clear();
    if (document.getElementById('world-book-detail-screen').classList.contains('active')) {
        renderWorldBookDetailList(currentWorldBookCategory);
    } else {
        renderWorldBookList();
    }
}

function toggleWorldBookSelection(bookId) {
    const itemEl = document.getElementById('world-book-list-container').querySelector(`.world-book-item[data-id="${bookId}"]`);
    if (selectedWorldBookIds.has(bookId)) {
        selectedWorldBookIds.delete(bookId);
        if(itemEl) itemEl.classList.remove('selected');
    } else {
        selectedWorldBookIds.add(bookId);
        if(itemEl) itemEl.classList.add('selected');
    }
    updateWorldBookSelectCount();
}

function updateWorldBookSelectCount() {
    const count = selectedWorldBookIds.size;
    document.getElementById('world-book-select-count').textContent = `已选择 ${count} 项`;
    
    // 详情页的多选统计
    const detailCountEl = document.getElementById('world-book-detail-select-count');
    if (detailCountEl) detailCountEl.textContent = `已选择 ${count} 项`;

    const exportBtn = document.getElementById('export-selected-world-books-btn');
    const deleteBtn = document.getElementById('delete-selected-world-books-btn');
    const moveBtn = document.getElementById('move-selected-world-books-btn');
    const toggleBtn = document.getElementById('toggle-selected-world-books-btn');
    
    const detailExportBtn = document.getElementById('detail-export-selected-world-books-btn');
    const detailDeleteBtn = document.getElementById('detail-delete-selected-world-books-btn');
    const detailMoveBtn = document.getElementById('detail-move-selected-world-books-btn');
    const detailToggleBtn = document.getElementById('detail-toggle-selected-world-books-btn');

    if (exportBtn) exportBtn.disabled = count === 0;
    if (deleteBtn) deleteBtn.disabled = count === 0;
    if (moveBtn) moveBtn.disabled = count === 0;
    if (toggleBtn) toggleBtn.disabled = count === 0;
    
    if (detailExportBtn) detailExportBtn.disabled = count === 0;
    if (detailDeleteBtn) detailDeleteBtn.disabled = count === 0;
    if (detailMoveBtn) detailMoveBtn.disabled = count === 0;
    if (detailToggleBtn) detailToggleBtn.disabled = count === 0;

    // 根据选中项的状态更新按钮文字
    if (count > 0) {
        const selectedBooks = db.worldBooks.filter(book => selectedWorldBookIds.has(book.id));
        const allDisabled = selectedBooks.length > 0 && selectedBooks.every(book => !!book.disabled);
        if (toggleBtn) toggleBtn.textContent = allDisabled ? '启用已选' : '停用已选';
        if (detailToggleBtn) detailToggleBtn.textContent = allDisabled ? '启用已选' : '停用已选';
    }
}

/**
 * 从纯文本（TXT/DOCX 提取结果）解析为分类与条目：按双换行分段落，每段首行为条目名、其余为内容，归为「导入」分类
 */
function parseTextToWorldBookEntries(text, defaultCategory = '导入') {
    const entries = [];
    const raw = (text || '').trim();
    if (!raw) return entries;
    const category = defaultCategory;
    const lines = raw.split(/\n/);
    const name = lines[0].trim() || '未命名条目';
    entries.push({ name, content: raw, category });
    return entries;
}

/**
 * 从 JSON 解析为世界书条目，支持：character_book.entries、{ categories: [...] }、条目数组
 */
function parseJsonToWorldBookEntries(jsonText, defaultCategory = '导入') {
    const entries = [];
    let data;
    try {
        data = JSON.parse(jsonText);
    } catch (e) {
        throw new Error('JSON 格式无效');
    }
    if (!data || typeof data !== 'object') return entries;

    // SillyTavern/角色卡式：entries 为对象 { "0": { comment, content }, "1": ... }
    if (data.entries && typeof data.entries === 'object' && !Array.isArray(data.entries)) {
        const category = defaultCategory;
        Object.values(data.entries).forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const name = (entry.comment || entry.name || entry.title || '未命名').trim();
            const content = (entry.content || entry.text || '').trim();
            if (name && content) entries.push({ name, content, category });
        });
        return entries;
    }
    if (data.character_book && Array.isArray(data.character_book.entries)) {
        const category = data.name || data.character_name || defaultCategory;
        data.character_book.entries.forEach(entry => {
            const name = entry.comment || entry.name || '未命名';
            const content = entry.content || '';
            if (name && content) entries.push({ name, content, category });
        });
        return entries;
    }
    if (Array.isArray(data.categories) && data.categories.length > 0) {
        data.categories.forEach(cat => {
            const category = (cat.name || cat.title || '未分类').trim() || '未分类';
            const list = cat.entries || cat.items || [];
            list.forEach(entry => {
                const name = (entry.name || entry.title || entry.comment || '未命名').trim();
                const content = (entry.content || entry.text || '').trim();
                if (name && content) entries.push({ name, content, category });
            });
        });
        return entries;
    }
    if (Array.isArray(data)) {
        data.forEach(item => {
            const name = (item.name || item.title || item.comment || '未命名').trim();
            const content = (item.content || item.text || '').trim();
            const category = (item.category || item.categoryName || defaultCategory).trim() || defaultCategory;
            if (name && content) entries.push({ name, content, category });
        });
        return entries;
    }
    return entries;
}

async function handleImportWorldBookFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    let fileNameWithoutExt = file.name;
    const lastDotIndex = file.name.lastIndexOf('.');
    if (lastDotIndex > 0) {
        fileNameWithoutExt = file.name.substring(0, lastDotIndex);
    }
    const defaultCategory = fileNameWithoutExt || '导入';
    let entries = [];
    let text = '';

    if (ext === 'txt') {
        text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result || '');
            reader.onerror = () => reject(new Error('读取 TXT 失败'));
            reader.readAsText(file, 'UTF-8');
        });
        entries = parseTextToWorldBookEntries(text, defaultCategory);
    } else if (ext === 'docx') {
        if (typeof parseDocxFile === 'undefined') {
            showToast('无法解析 DOCX，请刷新后重试');
            return;
        }
        text = await parseDocxFile(file);
        entries = parseTextToWorldBookEntries(text, defaultCategory);
    } else if (ext === 'json') {
        text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result || '');
            reader.onerror = () => reject(new Error('读取 JSON 失败'));
            reader.readAsText(file, 'UTF-8');
        });
        entries = parseJsonToWorldBookEntries(text, defaultCategory);
    } else {
        showToast('仅支持 .txt、.json、.docx 格式');
        return;
    }

    if (entries.length === 0) {
        showToast('未能解析出任何条目，请检查文件格式');
        return;
    }

    const toAdd = entries.map((e, i) => ({
        id: `wb_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
        name: e.name,
        content: e.content,
        category: e.category || defaultCategory,
        position: 'before',
        isGlobal: false,
        disabled: false
    }));

    db.worldBooks.push(...toAdd);
    await dexieDB.worldBooks.bulkPut(toAdd);
    await saveData();
    renderWorldBookList();
    showToast(`已导入 ${toAdd.length} 条世界书`);
}

async function deleteSelectedWorldBooks() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    if (confirm(`确定要删除这 ${count} 个世界书条目吗？此操作不可恢复。`)) {
        const idsToDelete = Array.from(selectedWorldBookIds);
        
        await dexieDB.worldBooks.bulkDelete(idsToDelete);
        db.worldBooks = db.worldBooks.filter(book => !selectedWorldBookIds.has(book.id));
        
        db.characters.forEach(char => {
            if (char.worldBookIds) {
                char.worldBookIds = char.worldBookIds.filter(id => !selectedWorldBookIds.has(id));
            }
        });
        db.groups.forEach(group => {
            if (group.worldBookIds) {
                group.worldBookIds = group.worldBookIds.filter(id => !selectedWorldBookIds.has(id));
            }
        });

        await saveData();
        showToast(`已成功删除 ${count} 个条目`);
        exitWorldBookMultiSelectMode();
    }
}

function showMoveCategoryModal() {
    const count = selectedWorldBookIds.size;
    if (count === 0) {
        showToast('请先选择要移动的世界书条目');
        return;
    }

    const modal = document.getElementById('world-book-move-category-modal');
    const desc = document.getElementById('wb-move-category-modal-desc');
    const categoryList = document.getElementById('wb-move-category-list');
    
    if (!modal || !desc || !categoryList) return;

    desc.textContent = `将 ${count} 个条目移动到分类：`;
    categoryList.innerHTML = '';

    // 获取所有分类
    const categories = new Set();
    db.worldBooks.forEach(book => {
        const cat = (book.category && book.category.trim()) || '未分类';
        categories.add(cat);
    });

    // 排序：未分类优先，其余按名称排序
    const sortedCategories = Array.from(categories).sort((a, b) => {
        if (a === '未分类') return -1;
        if (b === '未分类') return 1;
        return a.localeCompare(b);
    });

    // 创建分类选项
    sortedCategories.forEach(category => {
        const option = document.createElement('div');
        option.className = 'wb-move-category-option';
        option.style.cssText = 'padding: 12px; border-bottom: 1px solid #f0f0f0; cursor: pointer; transition: background-color 0.2s;';
        option.dataset.category = category;
        
        option.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="font-weight: 500; color: #333;">${category}</span>
                <span style="color: #999; font-size: 12px;">›</span>
            </div>
        `;

        option.addEventListener('click', () => {
            // 移除之前的选中状态
            categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
                opt.style.backgroundColor = '';
                delete opt.dataset.selected;
            });
            // 设置当前选中
            option.style.backgroundColor = '#e8f5e9';
            option.dataset.selected = 'true';
        });

        option.addEventListener('mouseenter', () => {
            if (!option.dataset.selected) {
                option.style.backgroundColor = '#f5f5f5';
            }
        });

        option.addEventListener('mouseleave', () => {
            if (!option.dataset.selected) {
                option.style.backgroundColor = '';
            }
        });

        categoryList.appendChild(option);
    });

    // 添加"新建分类"选项
    const newCategoryOption = document.createElement('div');
    newCategoryOption.className = 'wb-move-category-option wb-move-category-new';
    newCategoryOption.style.cssText = 'padding: 12px; border-top: 2px solid #e0e0e0; cursor: pointer; transition: background-color 0.2s;';
    newCategoryOption.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 500; color: var(--primary-color);">+ 新建分类</span>
            <span style="color: #999; font-size: 12px;">›</span>
        </div>
    `;
    newCategoryOption.addEventListener('click', () => {
        const newCategoryName = prompt('输入新分类名称：', '');
        if (newCategoryName === null) return;
        const trimmed = newCategoryName.trim();
        if (!trimmed) {
            showToast('分类名不能为空');
            return;
        }
        // 直接移动到新分类
        moveSelectedWorldBooksToCategory(trimmed);
        modal.classList.remove('visible');
        // 清除选择状态
        categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
            opt.style.backgroundColor = '';
            delete opt.dataset.selected;
        });
    });
    newCategoryOption.addEventListener('mouseenter', () => {
        newCategoryOption.style.backgroundColor = '#f5f5f5';
    });
    newCategoryOption.addEventListener('mouseleave', () => {
        newCategoryOption.style.backgroundColor = '';
    });
    categoryList.appendChild(newCategoryOption);

    modal.classList.add('visible');
}

async function moveSelectedWorldBooksToCategory(targetCategory) {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    const idsToMove = Array.from(selectedWorldBookIds);
    let movedCount = 0;

    idsToMove.forEach(bookId => {
        const book = db.worldBooks.find(wb => wb.id === bookId);
        if (book) {
            book.category = targetCategory || '';
            movedCount++;
        }
    });

    if (movedCount > 0) {
        // 批量更新数据库
        const booksToUpdate = db.worldBooks.filter(wb => idsToMove.includes(wb.id));
        await dexieDB.worldBooks.bulkPut(booksToUpdate);
        await saveData();
        
        showToast(`已成功将 ${movedCount} 个条目移动到「${targetCategory || '未分类'}」`);
        renderWorldBookList();
        exitWorldBookMultiSelectMode();
    }
}

// --- 导出世界书 ---
function exportWorldBooks(booksToExport, defaultFilename = 'worldbook_export') {
    if (!booksToExport || booksToExport.length === 0) {
        showToast('没有可导出的世界书条目');
        return;
    }
    
    const exportData = {
        character_book: {
            entries: booksToExport.map(book => ({
                comment: book.name,
                content: book.content,
                // 这里暂不包含我们特有的一些字段，为了与主流格式兼容
            }))
        },
        // 可以同时在顶层保留一份带有分类和特有字段的数组，以供我们自己的系统完整导入
        custom_entries: booksToExport
    };
    
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `${defaultFilename}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    
    showToast(`成功导出 ${booksToExport.length} 个条目`);
}

function handleExportWorldBookBtnClick() {
    // 导出所有
    exportWorldBooks(db.worldBooks, 'all_worldbooks');
}

// --- 自定义导出逻辑 ---
function openWorldBookCustomExportModal() {
    const modal = document.getElementById('world-book-custom-export-modal');
    if (!modal) return;

    const listContainer = document.getElementById('wb-custom-export-list');
    const selectAllCheckbox = document.getElementById('wb-custom-export-select-all');
    
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateCustomExportSelectCount(0);

    // 解析多级分类，复用原有的逻辑或者重新拍平
    // 这里使用树状结构渲染
    const categoryTree = {};
    db.worldBooks.forEach(book => {
        let categoryPath = book.category || '未分类';
        categoryPath = categoryPath.trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
        if (!categoryPath) categoryPath = '未分类';
        
        if (!categoryTree[categoryPath]) {
            categoryTree[categoryPath] = [];
        }
        categoryTree[categoryPath].push(book);
    });

    // 排序
    const sortedCategories = Object.keys(categoryTree).sort((a, b) => {
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b);
    });

    listContainer.innerHTML = '';
    
    if (db.worldBooks.length === 0) {
        listContainer.innerHTML = '<div style="text-align: center; color: #999; padding: 20px;">没有可导出的世界书</div>';
    } else {
        sortedCategories.forEach(category => {
            const books = categoryTree[category];
            const groupEl = document.createElement('div');
            groupEl.className = 'custom-export-group';
            groupEl.style.cssText = 'margin-bottom: 10px; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden;';

            // 分类头部
            const headerEl = document.createElement('div');
            headerEl.style.cssText = 'background: #f9f9f9; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; cursor: pointer;';
            headerEl.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" class="custom-export-category-checkbox" data-category="${category}">
                    <span style="font-weight: 600; font-size: 14px; color: #333;">${category} <span style="color:#999; font-size:12px; font-weight:normal;">(${books.length})</span></span>
                </div>
                <span class="custom-export-arrow" style="font-size: 12px; color: #999; transition: transform 0.2s;">▼</span>
            `;

            // 条目列表容器
            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'custom-export-items';
            itemsContainer.style.cssText = 'padding: 5px 12px; display: block;'; // 默认展开

            books.forEach(book => {
                const itemEl = document.createElement('div');
                itemEl.style.cssText = 'padding: 8px 0; border-bottom: 1px solid #f5f5f5; display: flex; align-items: flex-start; gap: 8px;';
                
                // 处理描述的截断
                let briefContent = book.content || '';
                if (briefContent.length > 30) briefContent = briefContent.substring(0, 30) + '...';

                itemEl.innerHTML = `
                    <input type="checkbox" class="custom-export-item-checkbox" value="${book.id}" style="margin-top: 3px;">
                    <div style="flex: 1;">
                        <div style="font-size: 14px; color: #333;">${book.name}</div>
                        <div style="font-size: 12px; color: #999; margin-top: 2px;">${briefContent}</div>
                    </div>
                `;
                itemsContainer.appendChild(itemEl);
            });

            groupEl.appendChild(headerEl);
            groupEl.appendChild(itemsContainer);
            listContainer.appendChild(groupEl);

            // 事件绑定
            const categoryCheckbox = headerEl.querySelector('.custom-export-category-checkbox');
            const arrow = headerEl.querySelector('.custom-export-arrow');
            const itemCheckboxes = itemsContainer.querySelectorAll('.custom-export-item-checkbox');

            // 点击展开/折叠 (点击头部除复选框外的区域)
            headerEl.addEventListener('click', (e) => {
                if (e.target.tagName.toLowerCase() === 'input') return;
                const isHidden = itemsContainer.style.display === 'none';
                itemsContainer.style.display = isHidden ? 'block' : 'none';
                arrow.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
            });

            // 点击分类复选框，全选/取消全选该分类下的所有条目
            categoryCheckbox.addEventListener('change', (e) => {
                const isChecked = e.target.checked;
                itemCheckboxes.forEach(cb => cb.checked = isChecked);
                updateCustomExportSelectCount();
            });

            // 点击单个条目复选框，更新状态并联动分类复选框和全选按钮
            itemCheckboxes.forEach(cb => {
                cb.addEventListener('change', () => {
                    const allChecked = Array.from(itemCheckboxes).every(c => c.checked);
                    const someChecked = Array.from(itemCheckboxes).some(c => c.checked);
                    categoryCheckbox.checked = allChecked;
                    categoryCheckbox.indeterminate = someChecked && !allChecked;
                    updateCustomExportSelectCount();
                });
            });
        });
    }

    modal.classList.add('visible');
}

function updateCustomExportSelectCount(count) {
    let selectedCount = count;
    if (typeof selectedCount === 'undefined') {
        const modal = document.getElementById('world-book-custom-export-modal');
        if (modal) {
            const checkedBoxes = modal.querySelectorAll('.custom-export-item-checkbox:checked');
            selectedCount = checkedBoxes.length;
            
            // 联动全选按钮
            const selectAllCheckbox = document.getElementById('wb-custom-export-select-all');
            const totalBoxes = modal.querySelectorAll('.custom-export-item-checkbox').length;
            if (selectAllCheckbox && totalBoxes > 0) {
                selectAllCheckbox.checked = selectedCount === totalBoxes;
            }
        }
    }
    
    const countEl = document.getElementById('wb-custom-export-count');
    if (countEl) {
        countEl.textContent = `已选 ${selectedCount} 项`;
    }
}

function handleCustomExportConfirm() {
    const modal = document.getElementById('world-book-custom-export-modal');
    if (!modal) return;

    const checkedBoxes = modal.querySelectorAll('.custom-export-item-checkbox:checked');
    if (checkedBoxes.length === 0) {
        showToast('请至少选择一项进行导出');
        return;
    }

    const selectedIds = Array.from(checkedBoxes).map(cb => cb.value);
    const booksToExport = db.worldBooks.filter(book => selectedIds.includes(book.id));

    exportWorldBooks(booksToExport, 'custom_selected_worldbooks');
    modal.classList.remove('visible');
}

function handleDetailExportWorldBookBtnClick() {
    if (!currentWorldBookCategory) return;
    const books = db.worldBooks.filter(b => {
        const cat = b.category || '未分类';
        return cat === currentWorldBookCategory || cat.startsWith(`${currentWorldBookCategory}/`);
    });
    exportWorldBooks(books, `worldbooks_${currentWorldBookCategory.replace(/[\/\\]/g, '_')}`);
}

function handleExportSelectedWorldBooksBtnClick() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;
    const books = db.worldBooks.filter(book => selectedWorldBookIds.has(book.id));
    exportWorldBooks(books, 'selected_worldbooks');
}

async function toggleSelectedWorldBooks() {
    const count = selectedWorldBookIds.size;
    if (count === 0) return;

    const selectedBooks = db.worldBooks.filter(book => selectedWorldBookIds.has(book.id));
    if (selectedBooks.length === 0) return;

    // 判断是否全部已停用
    const allDisabled = selectedBooks.every(book => !!book.disabled);
    const newDisabledState = !allDisabled;

    // 批量更新状态
    selectedBooks.forEach(book => {
        book.disabled = newDisabledState;
    });

    // 批量更新数据库
    await dexieDB.worldBooks.bulkPut(selectedBooks);
    await saveData();

    const actionText = newDisabledState ? '停用' : '启用';
    showToast(`已${actionText} ${selectedBooks.length} 个条目`);
    renderWorldBookList();
    updateWorldBookSelectCount();
}

let categorySortable = null;
let itemSortables = [];

function setupWorldBookApp() {
    const addWorldBookBtn = document.getElementById('add-world-book-btn');
    const editWorldBookForm = document.getElementById('edit-world-book-form');
    const worldBookNameInput = document.getElementById('world-book-name');
    const worldBookCategoryInput = document.getElementById('world-book-category');
    const worldBookTagsInput = document.getElementById('world-book-tags');
    const worldBookContentInput = document.getElementById('world-book-content');
    const worldBookListContainer = document.getElementById('world-book-list-container');
    const worldBookIdInput = document.getElementById('world-book-id');
    const searchInput = document.getElementById('world-book-search-input');
    const filterSelect = document.getElementById('world-book-filter-select');

    if (searchInput) {
        searchInput.addEventListener('input', () => renderWorldBookList());
    }
    if (filterSelect) {
        filterSelect.addEventListener('change', () => renderWorldBookList());
    }

    const addWbActionSheet = document.getElementById('add-world-book-actionsheet');
    if (addWorldBookBtn && addWbActionSheet) {
        addWorldBookBtn.addEventListener('click', () => {
            addWbActionSheet.classList.add('visible');
        });
    }
    
    const manualWbBtn = document.getElementById('wb-method-manual-btn');
    if (manualWbBtn) {
        manualWbBtn.addEventListener('click', () => {
            if (addWbActionSheet) addWbActionSheet.classList.remove('visible');
            currentEditingWorldBookId = null;
            editWorldBookForm.reset();
            document.querySelector('input[name="world-book-position"][value="before"]').checked = true;
            document.getElementById('world-book-global').checked = false;
            document.getElementById('world-book-always-on').checked = true;
            document.getElementById('world-book-weight').value = 100;
            document.getElementById('world-book-keywords-group').style.display = 'none';
            switchScreen('edit-world-book-screen');
        });
    }

    const importWorldBookFileInput = document.getElementById('import-world-book-file-input');
    const importWbBtn = document.getElementById('wb-method-import-btn');
    if (importWbBtn && importWorldBookFileInput) {
        importWbBtn.addEventListener('click', () => {
            if (addWbActionSheet) addWbActionSheet.classList.remove('visible');
            importWorldBookFileInput.click();
        });
        importWorldBookFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file) return;
            try {
                await handleImportWorldBookFile(file);
            } catch (err) {
                console.error('世界书导入失败', err);
                showToast('导入失败：' + (err.message || '未知错误'));
            }
        });
    }

    const cancelWbMethodBtn = document.getElementById('wb-method-cancel-btn');
    if (cancelWbMethodBtn && addWbActionSheet) {
        cancelWbMethodBtn.addEventListener('click', () => {
            addWbActionSheet.classList.remove('visible');
        });
    }

    const alwaysOnCheckbox = document.getElementById('world-book-always-on');
    if (alwaysOnCheckbox) {
        alwaysOnCheckbox.addEventListener('change', (e) => {
            document.getElementById('world-book-keywords-group').style.display = e.target.checked ? 'none' : 'block';
        });
    }

    const exportWorldBookBtn = document.getElementById('export-world-book-btn');
    const exportWbActionSheet = document.getElementById('export-world-book-actionsheet');
    const customExportModal = document.getElementById('world-book-custom-export-modal');

    if (exportWorldBookBtn && exportWbActionSheet) {
        exportWorldBookBtn.addEventListener('click', () => {
            exportWbActionSheet.classList.add('visible');
        });
    }

    if (exportWbActionSheet) {
        const exportAllBtn = document.getElementById('wb-export-all-btn');
        const exportCustomBtn = document.getElementById('wb-export-custom-btn');
        const exportCancelBtn = document.getElementById('wb-export-cancel-btn');

        if (exportAllBtn) {
            exportAllBtn.addEventListener('click', () => {
                exportWbActionSheet.classList.remove('visible');
                handleExportWorldBookBtnClick();
            });
        }

        if (exportCustomBtn) {
            exportCustomBtn.addEventListener('click', () => {
                exportWbActionSheet.classList.remove('visible');
                openWorldBookCustomExportModal();
            });
        }

        if (exportCancelBtn) {
            exportCancelBtn.addEventListener('click', () => {
                exportWbActionSheet.classList.remove('visible');
            });
        }
    }

    if (customExportModal) {
        const closeBtn = document.getElementById('wb-custom-export-close-btn');
        const confirmBtn = document.getElementById('wb-custom-export-confirm-btn');
        const selectAllCheckbox = document.getElementById('wb-custom-export-select-all');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                customExportModal.classList.remove('visible');
            });
        }

        if (confirmBtn) {
            confirmBtn.addEventListener('click', handleCustomExportConfirm);
        }

        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                const checkboxes = customExportModal.querySelectorAll('.custom-export-item-checkbox');
                checkboxes.forEach(cb => {
                    cb.checked = e.target.checked;
                });
                // 更新分类复选框状态
                const categoryCheckboxes = customExportModal.querySelectorAll('.custom-export-category-checkbox');
                categoryCheckboxes.forEach(cb => {
                    cb.checked = e.target.checked;
                });
                updateCustomExportSelectCount();
            });
        }
    }
    
    editWorldBookForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = worldBookNameInput.value.trim();
        const content = worldBookContentInput.value.trim();
        const category = worldBookCategoryInput.value.trim();
        const tagsRaw = worldBookTagsInput ? worldBookTagsInput.value.trim() : '';
        const tags = tagsRaw ? tagsRaw.split(/[,，]+/).map(t => t.trim()).filter(t => t) : [];
        const position = document.querySelector('input[name="world-book-position"]:checked').value;
        const isGlobal = document.getElementById('world-book-global').checked;
        const alwaysOn = document.getElementById('world-book-always-on').checked;
        const keywordsRaw = document.getElementById('world-book-keywords').value.trim();
        const keywords = keywordsRaw ? keywordsRaw.split(/[,，]+/).map(k => k.trim()).filter(k => k) : [];
        const weight = parseInt(document.getElementById('world-book-weight').value, 10) || 100;

        if (!name || !content) return showToast('名称和内容不能为空');
        if (currentEditingWorldBookId) {
            const book = db.worldBooks.find(wb => wb.id === currentEditingWorldBookId);
            if (book) {
                book.name = name;
                book.content = content;
                book.position = position;
                book.category = category;
                book.tags = tags;
                book.isGlobal = isGlobal;
                book.alwaysOn = alwaysOn;
                book.keywords = keywords;
                book.weight = weight;
                if (typeof book.disabled === 'undefined') book.disabled = false;
            }
        } else {
            db.worldBooks.push({
                id: `wb_${Date.now()}`, name, content, position, category, tags, isGlobal, disabled: false,
                alwaysOn, keywords, weight
            });
        }
        await saveData();
        showToast('世界书条目已保存');
        renderWorldBookList();
        switchScreen('world-book-screen');
    });

    worldBookListContainer.addEventListener('click', e => {
        const worldBookItem = e.target.closest('.world-book-item');

        if (isWorldBookMultiSelectMode) {
            if (e.target.matches('.category-checkbox')) {
                const category = e.target.dataset.category;
                const booksInCategory = db.worldBooks.filter(b => (b.category || '未分类') === category);
                const bookIdsInCategory = booksInCategory.map(b => b.id);
                const shouldSelectAll = e.target.checked;

                bookIdsInCategory.forEach(bookId => {
                    if (shouldSelectAll) {
                        selectedWorldBookIds.add(bookId);
                    } else {
                        selectedWorldBookIds.delete(bookId);
                    }
                });
                renderWorldBookList(category); 
                updateWorldBookSelectCount();
                return;
            }

            if (worldBookItem) {
                toggleWorldBookSelection(worldBookItem.dataset.id);
                const category = worldBookItem.closest('.collapsible-section').dataset.category;
                renderWorldBookList(category);
                return;
            }
            
            if (e.target.closest('.category-toggle-area')) {
                e.target.closest('.collapsible-section').classList.toggle('open');
                return;
            }

        } else { 
            if (e.target.closest('.collapsible-header')) {
                e.target.closest('.collapsible-section').classList.toggle('open');
                return;
            }
            
            if (worldBookItem && !e.target.closest('.action-btn')) {
                const book = db.worldBooks.find(wb => wb.id === worldBookItem.dataset.id);
                if (book) {
                    currentEditingWorldBookId = book.id;
                    worldBookIdInput.value = book.id;
                    worldBookNameInput.value = book.name;
                    worldBookContentInput.value = book.content;
                    worldBookCategoryInput.value = book.category || '';
                    if (worldBookTagsInput) {
                        worldBookTagsInput.value = Array.isArray(book.tags) ? book.tags.join(', ') : '';
                    }
                    document.querySelector(`input[name="world-book-position"][value="${book.position}"]`).checked = true;
                    document.getElementById('world-book-global').checked = book.isGlobal || false;
                    
                    const alwaysOn = book.alwaysOn !== false;
                    document.getElementById('world-book-always-on').checked = alwaysOn;
                    document.getElementById('world-book-keywords-group').style.display = alwaysOn ? 'none' : 'block';
                    document.getElementById('world-book-keywords').value = Array.isArray(book.keywords) ? book.keywords.join(', ') : '';
                    document.getElementById('world-book-weight').value = book.weight !== undefined ? book.weight : 100;
                    
                    switchScreen('edit-world-book-screen');
                }
            }
        }
    });

    worldBookListContainer.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const item = e.target.closest('.world-book-item');
        if (item) {
            const category = item.closest('.collapsible-section')?.dataset.category;
            enterWorldBookMultiSelectMode(item.dataset.id, category);
        }
    });
    
    worldBookListContainer.addEventListener('touchstart', (e) => {
        const item = e.target.closest('.world-book-item');
        if (!item) return;
        longPressTimer = setTimeout(() => {
            const category = item.closest('.collapsible-section')?.dataset.category;
            enterWorldBookMultiSelectMode(item.dataset.id, category);
        }, 500);
    });
    worldBookListContainer.addEventListener('mouseup', () => clearTimeout(longPressTimer));
    worldBookListContainer.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
    worldBookListContainer.addEventListener('touchend', () => clearTimeout(longPressTimer));
    worldBookListContainer.addEventListener('touchmove', () => clearTimeout(longPressTimer));

    const selectAllBtn = document.getElementById('world-book-select-all-btn');
    if (selectAllBtn) {
        selectAllBtn.addEventListener('click', () => {
            const listItems = document.querySelectorAll('#world-book-list-container .world-book-item');
            if (listItems.length > 0) {
                // 如果在首页（有分类折叠的情况），全选按钮不一定好处理所有展开和未展开的。
                // 简化处理：全选当前显示在列表里的所有条目的所属分类，但实际上首页渲染的是分类卡片，没有单独的 item
                // 因为当前首页结构不同，这里的全选按钮通常是在详情页才更有用。
                // 不过如果首页有全选按钮，我们可以全选数据库中所有受当前筛选器影响的条目：
                
                let filteredBooks = db.worldBooks;
                const filterSelect = document.getElementById('world-book-filter-select');
                if (filterSelect && filterSelect.value !== 'all') {
                    if (filterSelect.value === 'global') filteredBooks = filteredBooks.filter(b => b.isGlobal);
                    else if (filterSelect.value === 'disabled') filteredBooks = filteredBooks.filter(b => b.disabled);
                }
                const searchInput = document.getElementById('world-book-search-input');
                if (searchInput && searchInput.value.trim()) {
                    const searchKeyword = searchInput.value.trim().toLowerCase();
                    filteredBooks = filteredBooks.filter(b => {
                        return (b.name || '').toLowerCase().includes(searchKeyword) ||
                               (b.content || '').toLowerCase().includes(searchKeyword) ||
                               (b.category || '未分类').toLowerCase().includes(searchKeyword);
                    });
                }
                
                const allSelected = filteredBooks.every(b => selectedWorldBookIds.has(b.id));
                if (allSelected) {
                    filteredBooks.forEach(b => selectedWorldBookIds.delete(b.id));
                } else {
                    filteredBooks.forEach(b => selectedWorldBookIds.add(b.id));
                }
                renderWorldBookList();
                updateWorldBookSelectCount();
            }
        });
    }

    const exportSelectedBtn = document.getElementById('export-selected-world-books-btn');
    if (exportSelectedBtn) exportSelectedBtn.addEventListener('click', handleExportSelectedWorldBooksBtnClick);

    document.getElementById('delete-selected-world-books-btn').addEventListener('click', deleteSelectedWorldBooks);
    document.getElementById('move-selected-world-books-btn').addEventListener('click', showMoveCategoryModal);
    document.getElementById('toggle-selected-world-books-btn').addEventListener('click', toggleSelectedWorldBooks);
    document.getElementById('cancel-wb-multi-select-btn').addEventListener('click', exitWorldBookMultiSelectMode);

    // 移动到分类模态框的事件处理
    const moveCategoryModal = document.getElementById('world-book-move-category-modal');
    const moveCategoryConfirmBtn = document.getElementById('wb-move-category-confirm-btn');
    const moveCategoryCancelBtn = document.getElementById('wb-move-category-cancel-btn');
    if (moveCategoryModal && moveCategoryConfirmBtn && moveCategoryCancelBtn) {
        moveCategoryConfirmBtn.addEventListener('click', () => {
            const categoryList = document.getElementById('wb-move-category-list');
            const selectedOption = categoryList.querySelector('.wb-move-category-option[data-selected="true"]:not(.wb-move-category-new)');
            if (selectedOption) {
                const targetCategory = selectedOption.dataset.category;
                moveSelectedWorldBooksToCategory(targetCategory);
                moveCategoryModal.classList.remove('visible');
                // 清除选择状态
                categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
                    opt.style.backgroundColor = '';
                    delete opt.dataset.selected;
                });
            } else {
                showToast('请先选择一个分类');
            }
        });
        moveCategoryCancelBtn.addEventListener('click', () => {
            moveCategoryModal.classList.remove('visible');
            // 清除选择状态
            const categoryList = document.getElementById('wb-move-category-list');
            if (categoryList) {
                categoryList.querySelectorAll('.wb-move-category-option').forEach(opt => {
                    opt.style.backgroundColor = '';
                    delete opt.dataset.selected;
                });
            }
        });
    }

    const deleteCategoryModal = document.getElementById('world-book-delete-category-modal');
    const deleteCategoryAndEntriesBtn = document.getElementById('wb-delete-category-and-entries-btn');
    const deleteCategoryMoveEntriesBtn = document.getElementById('wb-delete-category-move-entries-btn');
    const deleteCategoryCancelBtn = document.getElementById('wb-delete-category-cancel-btn');
    if (deleteCategoryModal && deleteCategoryAndEntriesBtn && deleteCategoryMoveEntriesBtn && deleteCategoryCancelBtn) {
        deleteCategoryAndEntriesBtn.addEventListener('click', async () => {
            if (!pendingWbCategoryDelete) return;
            const cat = pendingWbCategoryDelete.category;
            const idsToDelete = db.worldBooks.filter(wb => (wb.category || '未分类') === cat).map(wb => wb.id);
            await dexieDB.worldBooks.bulkDelete(idsToDelete);
            db.worldBooks = db.worldBooks.filter(wb => (wb.category || '未分类') !== cat);
            db.characters.forEach(char => {
                if (char.worldBookIds) char.worldBookIds = char.worldBookIds.filter(id => !idsToDelete.includes(id));
            });
            db.groups.forEach(group => {
                if (group.worldBookIds) group.worldBookIds = group.worldBookIds.filter(id => !idsToDelete.includes(id));
            });
            await saveData();
            renderWorldBookList();
            deleteCategoryModal.classList.remove('visible');
            pendingWbCategoryDelete = null;
            showToast(`已删除分类及其下 ${idsToDelete.length} 个条目`);
        });
        deleteCategoryMoveEntriesBtn.addEventListener('click', async () => {
            if (!pendingWbCategoryDelete) return;
            const cat = pendingWbCategoryDelete.category;
        db.worldBooks.forEach(book => {
            if ((book.category || '未分类') === cat) book.category = '';
        });
        await saveData();
        renderWorldBookList();
        deleteCategoryModal.classList.remove('visible');
        pendingWbCategoryDelete = null;
        showToast('已删除分类，条目已移至「未分类」');
    });
    deleteCategoryCancelBtn.addEventListener('click', () => {
        deleteCategoryModal.classList.remove('visible');
        pendingWbCategoryDelete = null;
    });
    }

    // 详情页相关事件
    const detailSearchInput = document.getElementById('world-book-detail-search-input');
    const detailFilterSelect = document.getElementById('world-book-detail-filter-select');
    if (detailSearchInput) detailSearchInput.addEventListener('input', () => renderWorldBookDetailList(currentWorldBookCategory));
    if (detailFilterSelect) detailFilterSelect.addEventListener('change', () => renderWorldBookDetailList(currentWorldBookCategory));

    const detailExportBtn = document.getElementById('detail-export-world-book-btn');
    if (detailExportBtn) detailExportBtn.addEventListener('click', handleDetailExportWorldBookBtnClick);

    const detailAddBtn = document.getElementById('detail-add-world-book-btn');
    if (detailAddBtn) {
        detailAddBtn.addEventListener('click', () => {
            if (addWbActionSheet) addWbActionSheet.classList.add('visible');
        });
    }

    const detailSelectAllBtn = document.getElementById('world-book-detail-select-all-btn');
    if (detailSelectAllBtn) {
        detailSelectAllBtn.addEventListener('click', () => {
            const listItems = document.querySelectorAll('#world-book-detail-list-container .world-book-item');
            if (listItems.length > 0) {
                let filteredBooks = db.worldBooks.filter(b => {
                    const cat = b.category || '未分类';
                    return cat === currentWorldBookCategory || cat.startsWith(`${currentWorldBookCategory}/`);
                });
                
                const filterSelect = document.getElementById('world-book-detail-filter-select');
                if (filterSelect && filterSelect.value !== 'all') {
                    if (filterSelect.value === 'global') filteredBooks = filteredBooks.filter(b => b.isGlobal);
                    else if (filterSelect.value === 'disabled') filteredBooks = filteredBooks.filter(b => b.disabled);
                }
                const searchInput = document.getElementById('world-book-detail-search-input');
                if (searchInput && searchInput.value.trim()) {
                    const searchKeyword = searchInput.value.trim().toLowerCase();
                    filteredBooks = filteredBooks.filter(b => {
                        return (b.name || '').toLowerCase().includes(searchKeyword) ||
                               (b.content || '').toLowerCase().includes(searchKeyword);
                    });
                }

                const allSelected = filteredBooks.every(b => selectedWorldBookIds.has(b.id));
                if (allSelected) {
                    filteredBooks.forEach(b => selectedWorldBookIds.delete(b.id));
                } else {
                    filteredBooks.forEach(b => selectedWorldBookIds.add(b.id));
                }
                renderWorldBookDetailList(currentWorldBookCategory);
                updateWorldBookSelectCount();
            }
        });
    }

    const detailCancelMultiBtn = document.getElementById('detail-cancel-wb-multi-select-btn');
    if (detailCancelMultiBtn) detailCancelMultiBtn.addEventListener('click', exitWorldBookMultiSelectMode);

    const detailExportSelectedBtn = document.getElementById('detail-export-selected-world-books-btn');
    if (detailExportSelectedBtn) detailExportSelectedBtn.addEventListener('click', handleExportSelectedWorldBooksBtnClick);

    const detailDeleteBtn = document.getElementById('detail-delete-selected-world-books-btn');
    if (detailDeleteBtn) detailDeleteBtn.addEventListener('click', deleteSelectedWorldBooks);

    const detailMoveBtn = document.getElementById('detail-move-selected-world-books-btn');
    if (detailMoveBtn) detailMoveBtn.addEventListener('click', showMoveCategoryModal);

    const detailToggleBtn = document.getElementById('detail-toggle-selected-world-books-btn');
    if (detailToggleBtn) detailToggleBtn.addEventListener('click', toggleSelectedWorldBooks);

    const detailListContainer = document.getElementById('world-book-detail-list-container');
    if (detailListContainer) {
        detailListContainer.addEventListener('click', e => {
            const worldBookItem = e.target.closest('.world-book-item');

            if (isWorldBookMultiSelectMode) {
                if (worldBookItem) {
                    toggleWorldBookSelection(worldBookItem.dataset.id);
                    renderWorldBookDetailList(currentWorldBookCategory);
                    return;
                }
            } else {
                if (worldBookItem && !e.target.closest('.action-btn')) {
                    const book = db.worldBooks.find(wb => wb.id === worldBookItem.dataset.id);
                    if (book) {
                        currentEditingWorldBookId = book.id;
                        worldBookIdInput.value = book.id;
                        worldBookNameInput.value = book.name;
                        worldBookContentInput.value = book.content;
                        worldBookCategoryInput.value = book.category || '';
                        if (worldBookTagsInput) {
                            worldBookTagsInput.value = Array.isArray(book.tags) ? book.tags.join(', ') : '';
                        }
                        document.querySelector(`input[name="world-book-position"][value="${book.position}"]`).checked = true;
                        document.getElementById('world-book-global').checked = book.isGlobal || false;
                        
                        const alwaysOn = book.alwaysOn !== false;
                        document.getElementById('world-book-always-on').checked = alwaysOn;
                        document.getElementById('world-book-keywords-group').style.display = alwaysOn ? 'none' : 'block';
                        document.getElementById('world-book-keywords').value = Array.isArray(book.keywords) ? book.keywords.join(', ') : '';
                        document.getElementById('world-book-weight').value = book.weight !== undefined ? book.weight : 100;
                        
                        switchScreen('edit-world-book-screen');
                    }
                }
            }
        });

        detailListContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const item = e.target.closest('.world-book-item');
            if (item) {
                enterWorldBookMultiSelectMode(item.dataset.id, currentWorldBookCategory);
            }
        });
        
        detailListContainer.addEventListener('touchstart', (e) => {
            const item = e.target.closest('.world-book-item');
            if (!item) return;
            longPressTimer = setTimeout(() => {
                enterWorldBookMultiSelectMode(item.dataset.id, currentWorldBookCategory);
            }, 500);
        });
        detailListContainer.addEventListener('mouseup', () => clearTimeout(longPressTimer));
        detailListContainer.addEventListener('mouseleave', () => clearTimeout(longPressTimer));
        detailListContainer.addEventListener('touchend', () => clearTimeout(longPressTimer));
        detailListContainer.addEventListener('touchmove', () => clearTimeout(longPressTimer));
    }
}

function renderWorldBookList(expandedCategory = null) {
    const worldBookListContainer = document.getElementById('world-book-list-container');
    worldBookListContainer.innerHTML = '';
    
    // 清理之前的 sortable 实例
    if (categorySortable) {
        try { categorySortable.destroy(); } catch (e) {}
        categorySortable = null;
    }
    itemSortables.forEach(s => {
        try { s.destroy(); } catch (e) {}
    });
    itemSortables = [];
    
    let filteredBooks = db.worldBooks;
    
    // 应用搜索和筛选
    const searchInput = document.getElementById('world-book-search-input');
    const filterSelect = document.getElementById('world-book-filter-select');
    
    if (filterSelect && filterSelect.value !== 'all') {
        const filterValue = filterSelect.value;
        if (filterValue === 'global') {
            filteredBooks = filteredBooks.filter(b => b.isGlobal);
        } else if (filterValue === 'disabled') {
            filteredBooks = filteredBooks.filter(b => b.disabled);
        }
    }
    
    let searchKeyword = '';
    if (searchInput && searchInput.value.trim()) {
        searchKeyword = searchInput.value.trim().toLowerCase();
        filteredBooks = filteredBooks.filter(b => {
            const nameMatch = (b.name || '').toLowerCase().includes(searchKeyword);
            const contentMatch = (b.content || '').toLowerCase().includes(searchKeyword);
            const categoryMatch = (b.category || '未分类').toLowerCase().includes(searchKeyword);
            const tagsMatch = Array.isArray(b.tags) && b.tags.some(t => (t || '').toLowerCase().includes(searchKeyword));
            return nameMatch || contentMatch || categoryMatch || tagsMatch;
        });
    }

    document.getElementById('no-world-books-placeholder').style.display = filteredBooks.length === 0 ? 'block' : 'none';
    if (filteredBooks.length === 0) {
        return;
    }

    // 解析多级分类 (支持 / 分隔)
    const categoryTree = {};
    
    filteredBooks.forEach(book => {
        let categoryPath = book.category || '未分类';
        categoryPath = categoryPath.trim().replace(/^[\/\\]+|[\/\\]+$/g, ''); // 移除首尾斜杠
        if (!categoryPath) categoryPath = '未分类';
        
        const parts = categoryPath.split(/[\/\\]/).map(p => p.trim()).filter(p => p);
        if (parts.length === 0) parts.push('未分类');

        let currentLevel = categoryTree;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            if (!currentLevel[part]) {
                currentLevel[part] = { _books: [], _children: {} };
            }
            if (i === parts.length - 1) {
                currentLevel[part]._books.push(book);
            }
            currentLevel = currentLevel[part]._children;
        }
    });

    // 递归渲染分类树
    function renderCategoryNode(nodeName, nodeData, level = 0, parentPath = '') {
        const fullPath = parentPath ? `${parentPath}/${nodeName}` : nodeName;
        
        const section = document.createElement('div');
        section.className = 'kkt-group collapsible-section';
        section.style.cssText = `background-color: #fff; border: none; margin-bottom: ${level === 0 ? '15px' : '0'}; box-shadow: none; margin-left: ${level > 0 ? '15px' : '0'}; border-left: ${level > 0 ? '2px solid #f0f0f0' : 'none'}; padding-left: ${level > 0 ? '10px' : '0'};`;
        section.dataset.category = fullPath; 

        // 搜索时，如果该分类包含匹配项，或者该分类本身名称匹配了关键词，则自动展开
        const header = document.createElement('div');
        header.className = 'kkt-item world-book-folder-header';
        header.style.cssText = `background-color: #fff; border-bottom: 1px solid #f5f5f5; cursor: pointer; padding: 15px; border-radius: 12px; margin-bottom: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.03);`;
        
        let checkboxHTML = '';
        if (isWorldBookMultiSelectMode) {
            // 如果该分类或其子分类下的所有书都被选中
            let allBookIds = [];
            function collectIds(nd) {
                allBookIds.push(...nd._books.map(b => b.id));
                Object.values(nd._children).forEach(collectIds);
            }
            collectIds(nodeData);
            
            if (allBookIds.length > 0) {
                const allSelected = allBookIds.every(id => selectedWorldBookIds.has(id));
                checkboxHTML = `<input type="checkbox" class="category-checkbox" data-category="${fullPath}" ${allSelected ? 'checked' : ''} style="margin-right: 12px;">`;
            }
        }
        
        const categoryNameEscaped = nodeName.replace(/</g, '<').replace(/>/g, '>');
        
        // 统计该分类及其所有子分类下的总条目数
        let totalCount = 0;
        function countBooks(nd) {
            totalCount += nd._books.length;
            Object.values(nd._children).forEach(countBooks);
        }
        countBooks(nodeData);

        const editCategoryBtnHTML = !isWorldBookMultiSelectMode
            ? `<button type="button" class="action-btn world-book-edit-category-btn" title="编辑当前层级名" style="padding: 4px; border: none; background: transparent; margin-right: 4px;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>`
            : '';
        const deleteCategoryBtnHTML = !isWorldBookMultiSelectMode
            ? `<button type="button" class="action-btn world-book-delete-category-btn" title="删除该分类（其下条目将移至「未分类」）" style="padding: 6px; border: none; background: transparent; margin-left: 8px;"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ff3b30;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>`
            : '';
            
        header.innerHTML = `
            <div style="display: flex; align-items: center; width: 100%;">
                ${checkboxHTML}
                <div class="folder-icon" style="margin-right: 12px; color: var(--primary-color);">
                    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                </div>
                <div class="category-toggle-area" style="flex-grow: 1; display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-weight:600; color:#333; font-size: 16px; display: flex; align-items: center;">
                        ${categoryNameEscaped} <span style="color:#999; font-size:13px; font-weight:normal; margin-left:6px;">(${totalCount} 项)</span>
                    </div>
                    <div style="display: flex; align-items: center;">
                        ${editCategoryBtnHTML}
                        ${deleteCategoryBtnHTML}
                    </div>
                </div>
            </div>
        `;

        // 点击进入详情页
        header.addEventListener('click', (ev) => {
            if (ev.target.type === 'checkbox' || ev.target.closest('.action-btn')) return;
            currentWorldBookCategory = fullPath;
            document.getElementById('world-book-detail-title').textContent = categoryNameEscaped;
            renderWorldBookDetailList(fullPath);
            switchScreen('world-book-detail-screen');
        });

        if (editCategoryBtnHTML) {
            const editCategoryBtn = header.querySelector('.world-book-edit-category-btn');
            if (editCategoryBtn) {
                editCategoryBtn.addEventListener('click', async (ev) => {
                    ev.stopPropagation();
                    const newName = prompt('输入新分类名（仅修改当前层级）：', nodeName);
                    if (newName === null) return;
                    const trimmed = newName.trim().replace(/[\/\\]/g, ''); // 不允许输入斜杠
                    if (!trimmed) return showToast('分类名不能为空且不能包含斜杠');
                    if (trimmed === nodeName) return;
                    
                    const parentPrefix = parentPath ? `${parentPath}/` : '';
                    const oldFullPath = `${parentPrefix}${nodeName}`;
                    const newFullPath = `${parentPrefix}${trimmed}`;
                    
                    db.worldBooks.forEach(book => {
                        let cat = book.category || '未分类';
                        if (cat === oldFullPath || cat.startsWith(`${oldFullPath}/`)) {
                            book.category = cat.replace(oldFullPath, newFullPath);
                        }
                    });
                    await saveData();
                    renderWorldBookList();
                    showToast('分类名已修改');
                });
            }
        }
        if (deleteCategoryBtnHTML) {
            const deleteCategoryBtn = header.querySelector('.world-book-delete-category-btn');
            if (deleteCategoryBtn) {
                deleteCategoryBtn.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    let count = 0;
                    db.worldBooks.forEach(b => {
                        let cat = b.category || '未分类';
                        if (cat === fullPath || cat.startsWith(`${fullPath}/`)) count++;
                    });
                    
                    pendingWbCategoryDelete = { category: fullPath, count };
                    document.getElementById('wb-delete-category-modal-title').textContent = `删除分类「${nodeName}」`;
                    document.getElementById('wb-delete-category-modal-desc').textContent = `该分类（及其子分类）下共有 ${count} 个条目。要同时删除这些条目，还是将它们移至「未分类」？`;
                    document.getElementById('world-book-delete-category-modal').classList.add('visible');
                });
            }
        }

        // 首页不再渲染具体书籍和子分类内容，只显示卡片
        section.appendChild(header);
        return section;
    }

    // 从根节点开始渲染 (读取保存的分类顺序)
    let rootKeys = Object.keys(categoryTree);
    if (db.worldBookCategoryOrder) {
        rootKeys.sort((a, b) => {
            const indexA = db.worldBookCategoryOrder.indexOf(a);
            const indexB = db.worldBookCategoryOrder.indexOf(b);
            if (indexA === -1 && indexB === -1) return a.localeCompare(b);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
    } else {
        rootKeys.sort((a, b) => {
            if (a === '未分类') return 1;
            if (b === '未分类') return -1;
            return a.localeCompare(b);
        });
    }

    rootKeys.forEach(rootKey => {
        const section = renderCategoryNode(rootKey, categoryTree[rootKey]);
        worldBookListContainer.appendChild(section);
    });

    // 初始化分类拖拽排序（移动端/触摸设备不启用，避免影响点击）
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (typeof Sortable !== 'undefined' && !isWorldBookMultiSelectMode && !searchKeyword && !isTouchDevice) {
        categorySortable = new Sortable(worldBookListContainer, {
            animation: 150,
            handle: '.collapsible-header', // 点击头部拖拽
            ghostClass: 'sortable-ghost',
            onEnd: async function () {
                const newOrder = Array.from(worldBookListContainer.children).map(el => {
                    const categoryPath = el.dataset.category;
                    return categoryPath.split(/[\/\\]/)[0]; // 记录根节点顺序
                });
                db.worldBookCategoryOrder = newOrder;
                await saveData();
            }
        });

        // 初始化条目拖拽排序
        const lists = worldBookListContainer.querySelectorAll('.list-container');
        lists.forEach(listEl => {
            const sortable = new Sortable(listEl, {
                animation: 150,
                group: 'worldBookItems', // 允许在不同分类间拖拽
                ghostClass: 'sortable-ghost',
                onEnd: async function (evt) {
                    // 更新数据库中的分类和顺序
                    const itemEl = evt.item;
                    const bookId = itemEl.dataset.id;
                    const book = db.worldBooks.find(b => b.id === bookId);
                    
                    const newSection = itemEl.closest('.collapsible-section');
                    if (newSection && book) {
                        book.category = newSection.dataset.category;
                    }

                    // 重新排序 db.worldBooks (简单地把当前列表的所有书移到最后，保持它们之间的相对顺序)
                    // 更严谨的做法是更新所有书籍的 order 字段，但这里为了简便，依赖数组自身的顺序
                    const currentListIds = Array.from(evt.to.children).map(el => el.dataset.id);
                    const otherBooks = db.worldBooks.filter(b => !currentListIds.includes(b.id));
                    const sortedBooksInList = currentListIds.map(id => db.worldBooks.find(b => b.id === id)).filter(b => b);
                    
                    db.worldBooks = [...otherBooks, ...sortedBooksInList];

                    await dexieDB.worldBooks.bulkPut(db.worldBooks);
                    await saveData();
                    
                    // 如果跨分类拖拽了，需要重新渲染以更新数量等
                    if (evt.from !== evt.to) {
                        renderWorldBookList(newSection ? newSection.dataset.category : null);
                    }
                }
            });
            itemSortables.push(sortable);
        });
    }
}

function renderWorldBookDetailList(categoryPath) {
    const listContainer = document.getElementById('world-book-detail-list-container');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    itemSortables.forEach(s => {
        try { s.destroy(); } catch (e) {}
    });
    itemSortables = [];

    let filteredBooks = db.worldBooks.filter(b => {
        const cat = b.category || '未分类';
        return cat === categoryPath || cat.startsWith(`${categoryPath}/`);
    });

    // 应用搜索和筛选
    const searchInput = document.getElementById('world-book-detail-search-input');
    const filterSelect = document.getElementById('world-book-detail-filter-select');
    
    if (filterSelect && filterSelect.value !== 'all') {
        const filterValue = filterSelect.value;
        if (filterValue === 'global') {
            filteredBooks = filteredBooks.filter(b => b.isGlobal);
        } else if (filterValue === 'disabled') {
            filteredBooks = filteredBooks.filter(b => b.disabled);
        }
    }
    
    if (searchInput && searchInput.value.trim()) {
        const searchKeyword = searchInput.value.trim().toLowerCase();
        filteredBooks = filteredBooks.filter(b => {
            const nameMatch = (b.name || '').toLowerCase().includes(searchKeyword);
            const contentMatch = (b.content || '').toLowerCase().includes(searchKeyword);
            const categoryMatch = (b.category || '未分类').toLowerCase().includes(searchKeyword);
            const tagsMatch = Array.isArray(b.tags) && b.tags.some(t => (t || '').toLowerCase().includes(searchKeyword));
            return nameMatch || contentMatch || categoryMatch || tagsMatch;
        });
    }

    const placeholder = document.getElementById('no-world-books-detail-placeholder');
    if (placeholder) placeholder.style.display = filteredBooks.length === 0 ? 'block' : 'none';

    if (filteredBooks.length === 0) return;

    filteredBooks.forEach(book => {
        const li = document.createElement('li');
        li.className = 'list-item world-book-item';
        li.style.cssText = 'border-radius: 12px; margin-bottom: 10px; border: 1px solid #f0f0f0; box-shadow: 0 1px 3px rgba(0,0,0,0.02); overflow: hidden;';
        li.dataset.id = book.id;
        
        const isDisabled = !!book.disabled;
        if (isDisabled) li.classList.add('world-book-item-disabled');

        if (isWorldBookMultiSelectMode) {
            li.classList.add('is-selecting');
            if (selectedWorldBookIds.has(book.id)) {
                li.classList.add('selected');
            }
        }

        const disabledBadge = isDisabled ? ' <span class="world-book-disabled-badge" style="background:#e0e0e0;color:#666;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px;">未启用</span>' : '';
        let metaHTML = '';
        if (book.alwaysOn !== false) {
            metaHTML += '<span style="font-size:10px;color:#fff;background:var(--primary-color);padding:2px 6px;border-radius:4px;margin-right:4px;">常驻</span>';
        }
        if (book.weight !== undefined) {
            metaHTML += `<span style="font-size:10px;color:#666;background:#eee;padding:2px 6px;border-radius:4px;margin-right:4px;">权重:${book.weight}</span>`;
        }
        
        let tagsHTML = '';
        if (Array.isArray(book.tags) && book.tags.length > 0) {
            tagsHTML = `<div class="item-tags" style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px;">${book.tags.map(t => `<span style="font-size:11px;color:var(--primary-color);background:rgba(255,128,171,0.1);padding:3px 8px;border-radius:12px;">#${t}</span>`).join('')}</div>`;
        }
        
        let keywordHTML = '';
        if (book.alwaysOn === false && Array.isArray(book.keywords) && book.keywords.length > 0) {
            keywordHTML = `<div style="font-size:12px;color:#888;margin-top:6px; background:#f9f9f9; padding:4px 8px; border-radius:6px; display:inline-block;"><span style="color:#666;">🔑</span> ${book.keywords.join(', ')}</div>`;
        }

        // 显示子分类路径
        let subCategoryHTML = '';
        if (book.category && book.category !== categoryPath) {
            const relPath = book.category.replace(categoryPath + '/', '');
            subCategoryHTML = `<div style="font-size:11px; color:#999; margin-bottom:4px;">📂 ${relPath}</div>`;
        }
        
        li.innerHTML = `
            <div class="item-details" style="padding: 12px; ${isWorldBookMultiSelectMode ? 'padding-left: 45px;' : ''}">
                ${subCategoryHTML}
                <div class="item-name" style="margin-bottom: 6px; font-size: 15px; font-weight: 600; color: #333;">
                    ${book.name}
                    ${book.isGlobal ? ' <span style="display:inline-block;background:#4CAF50;color:white;font-size:10px;padding:2px 6px;border-radius:4px;margin-left:6px;vertical-align:middle;">全局</span>' : ''}
                    ${disabledBadge}
                </div>
                <div style="margin-bottom: 8px;">${metaHTML}</div>
                <div class="item-preview" style="color: #666; font-size: 13px; line-height: 1.5; background: #fafafa; padding: 10px; border-radius: 8px; margin-top: 8px;">${book.content.replace(/\n/g, '<br>')}</div>
                ${keywordHTML}
                ${tagsHTML}
            </div>
        `;
        
        if (!isWorldBookMultiSelectMode) {
            const btnWrap = document.createElement('div');
            btnWrap.className = 'world-book-item-actions';
            btnWrap.style.cssText = 'position: absolute; right: 12px; top: 12px; display: flex; align-items: center; gap: 8px;';
            const toggleBtn = document.createElement('button');
            toggleBtn.type = 'button';
            toggleBtn.className = 'action-btn world-book-toggle-enabled-btn';
            toggleBtn.title = isDisabled ? '点击启用' : '点击停用（停用后不会被读取）';
            toggleBtn.style.cssText = 'padding: 4px 10px; border: none; border-radius: 12px; font-size: 12px; background: ' + (isDisabled ? '#f0f0f0' : '#e8f5e9') + '; color: ' + (isDisabled ? '#666' : '#2e7d32') + '; cursor: pointer; transition: all 0.2s;';
            toggleBtn.textContent = isDisabled ? '启用' : '停用';
            toggleBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                const b = db.worldBooks.find(wb => wb.id === book.id);
                if (b) {
                    b.disabled = !b.disabled;
                    await saveData();
                    renderWorldBookDetailList(categoryPath);
                    showToast(b.disabled ? '已停用，该条目不会被读取' : '已启用');
                }
            });
            const delBtn = document.createElement('button');
            delBtn.className = 'action-btn';
            delBtn.style.cssText = 'padding: 4px; border: none; background: transparent; color: #ff3b30; cursor: pointer; display: flex; align-items: center; justify-content: center;';
            delBtn.title = '删除世界书';
            delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
            delBtn.addEventListener('click', async (ev) => {
                ev.stopPropagation();
                if (!confirm('确定要删除这个世界书条目吗？')) return;
                const bookIdToDelete = book.id;
                await dexieDB.worldBooks.delete(bookIdToDelete);
                db.worldBooks = db.worldBooks.filter(wb => wb.id !== bookIdToDelete);
                db.characters.forEach(char => {
                    if (char.worldBookIds) char.worldBookIds = char.worldBookIds.filter(id => id !== bookIdToDelete);
                });
                db.groups.forEach(group => {
                    if (group.worldBookIds) group.worldBookIds = group.worldBookIds.filter(id => id !== bookIdToDelete);
                });
                await saveData();
                renderWorldBookList(); // 更新首页的数字
                renderWorldBookDetailList(categoryPath);
                showToast('世界书条目已删除');
            });
            btnWrap.appendChild(toggleBtn);
            btnWrap.appendChild(delBtn);
            li.appendChild(btnWrap);
        }
        listContainer.appendChild(li);
    });

    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    if (typeof Sortable !== 'undefined' && !isWorldBookMultiSelectMode && !isTouchDevice && !searchInput?.value) {
        const sortable = new Sortable(listContainer, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: async function (evt) {
                // ... 可以在这里实现同分类下的排序逻辑，当前暂不支持自定义 order
            }
        });
        itemSortables.push(sortable);
    }
}

function renderCategorizedWorldBookList(container, books, selectedIds, idPrefix) {
    container.innerHTML = '';
    if (!books || books.length === 0) {
        container.innerHTML = '<li style="color: #888; text-align: center; padding: 15px;">暂无世界书条目</li>';
        return;
    }

    // 选择世界书界面也支持多级分类渲染（这里为了简化展示，将多级路径拍平展示）
    const groupedBooks = books.reduce((acc, book) => {
        let category = book.category || '未分类';
        category = category.trim().replace(/^[\/\\]+|[\/\\]+$/g, '');
        if (!category) category = '未分类';
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(book);
        return acc;
    }, {});

    const sortedCategories = Object.keys(groupedBooks).sort((a, b) => {
        if (a === '未分类') return 1;
        if (b === '未分类') return -1;
        return a.localeCompare(b);
    });

    sortedCategories.forEach(category => {
        const categoryBooks = groupedBooks[category];
        const allInCategorySelected = categoryBooks.every(book => selectedIds.includes(book.id));

        const groupEl = document.createElement('div');
        groupEl.className = 'world-book-category-group';

        groupEl.innerHTML = `
            <div class="world-book-category-header">
                <input type="checkbox" class="category-checkbox" ${allInCategorySelected ? 'checked' : ''}>
                <span class="category-name">${category}</span>
                <span class="category-arrow">▼</span>
            </div>
            <ul class="world-book-items-list">
                ${categoryBooks.map(book => {
                    const isChecked = selectedIds.includes(book.id);
                    return `
                        <li class="world-book-select-item">
                            <input type="checkbox" class="item-checkbox" id="${idPrefix}-${book.id}" value="${book.id}" ${isChecked ? 'checked' : ''}>
                            <label for="${idPrefix}-${book.id}">${book.name}</label>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
        container.appendChild(groupEl);
    });

    container.querySelectorAll('.world-book-category-header').forEach(header => {
        header.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return; 
            const group = header.closest('.world-book-category-group');
            group.classList.toggle('open');
        });
    });

    container.querySelectorAll('.category-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.closest('.world-book-category-group');
            const itemCheckboxes = group.querySelectorAll('.item-checkbox');
            itemCheckboxes.forEach(itemCb => {
                itemCb.checked = e.target.checked;
            });
        });
    });

    container.querySelectorAll('.item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const group = e.target.closest('.world-book-category-group');
            const categoryCheckbox = group.querySelector('.category-checkbox');
            const allItems = group.querySelectorAll('.item-checkbox');
            const allChecked = Array.from(allItems).every(item => item.checked);
            categoryCheckbox.checked = allChecked;
        });
    });
}
