(function() {
    // ==================== 全局状态 ====================
    let currentUsername = '';
    let guestbookOffset = 0;
    let guestbookHasMore = true;
    let guestbookLoading = false;
    const GUESTBOOK_PAGE_SIZE = 20;
    let socket = null;
    let currentTab = 'guestbook';
    let unreadChatCount = 0;
    let chatTabActive = false;

    // ==================== DOM元素 ====================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const usernameModal = $('#usernameModal');
    const usernameInput = $('#usernameInput');
    const usernameConfirmBtn = $('#usernameConfirmBtn');
    const userInfoHeader = $('#userInfoHeader');
    const headerAvatar = $('#headerAvatar');
    const headerUsername = $('#headerUsername');
    const toastEl = $('#toast');
    const appContainer = $('#appContainer');
    const guestbookMessages = $('#guestbookMessages');
    const guestbookEmpty = $('#guestbookEmpty');
    const guestbookTextarea = $('#guestbookTextarea');
    const guestbookSendBtn = $('#guestbookSendBtn');
    const guestbookLoadMoreWrap = $('#guestbookLoadMoreWrap');
    const loadMoreGuestbookBtn = $('#loadMoreGuestbook');
    const chatMessages = $('#chatMessages');
    const chatEmpty = $('#chatEmpty');
    const chatTextarea = $('#chatTextarea');
    const chatSendBtn = $('#chatSendBtn');
    const onlineBadge = $('#onlineBadge');
    const tabBtns = $$('.tab-btn');

    // ==================== 工具函数 ====================
    function showToast(msg, duration = 2200) {
        toastEl.textContent = msg;
        toastEl.classList.add('show');
        clearTimeout(toastEl._timeout);
        toastEl._timeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, duration);
    }

    function getAvatarColor(name) {
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash;
        }
        const hue = Math.abs(hash) % 360;
        const saturation = 55 + (Math.abs(hash) % 25);
        const lightness = 45 + (Math.abs(hash >> 3) % 20);
        return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    }

    function formatDateTime(dateStr) {
        const d = new Date(dateStr);
        const now = new Date();
        const diffMs = now - d;
        const diffMin = Math.floor(diffMs / 60000);
        const diffHour = Math.floor(diffMs / 3600000);
        const diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) return '刚刚';
        if (diffMin < 60) return `${diffMin}分钟前`;
        if (diffHour < 24) return `${diffHour}小时前`;
        if (diffDay < 7) return `${diffDay}天前`;

        const month = d.getMonth() + 1;
        const day = d.getDate();
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${month}月${day}日 ${hours}:${minutes}`;
    }

    function formatChatTime(dateStr) {
        const d = new Date(dateStr);
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getInitial(name) {
        return name.charAt(0).toUpperCase();
    }

    // ==================== 用户名管理 ====================
    function getStoredUsername() {
        return localStorage.getItem('chat_username') || '';
    }

    function setStoredUsername(name) {
        localStorage.setItem('chat_username', name.trim());
    }

    function updateHeaderDisplay() {
        const name = currentUsername || '用户';
        headerUsername.textContent = name;
        headerAvatar.textContent = getInitial(name);
        headerAvatar.style.backgroundColor = getAvatarColor(name);
    }

    function showUsernameModal() {
        usernameModal.style.display = 'flex';
        const stored = getStoredUsername();
        usernameInput.value = stored || '';
        setTimeout(() => usernameInput.focus(), 200);
    }

    function hideUsernameModal() {
        usernameModal.style.display = 'none';
    }

    function applyUsername(name) {
        const trimmed = name.trim();
        if (!trimmed) {
            showToast('昵称不能为空哦～');
            return false;
        }
        if (trimmed.length > 20) {
            showToast('昵称最多20个字符');
            return false;
        }
        currentUsername = trimmed;
        setStoredUsername(trimmed);
        updateHeaderDisplay();
        hideUsernameModal();
        showToast(`欢迎，${trimmed}！✨`);
        // 更新socket连接
        if (socket && socket.connected) {
            socket.emit('update_username', { username: currentUsername });
        }
        return true;
    }

    // 初始化用户名
    function initUsername() {
        const stored = getStoredUsername();
        if (stored && stored.trim()) {
            currentUsername = stored.trim();
            updateHeaderDisplay();
            hideUsernameModal();
        } else {
            showUsernameModal();
        }
    }

    // 点击头衔修改昵称
    userInfoHeader.addEventListener('click', () => {
        showUsernameModal();
    });

    // 确认用户名
    usernameConfirmBtn.addEventListener('click', () => {
        applyUsername(usernameInput.value);
    });
    usernameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            applyUsername(usernameInput.value);
        }
    });

    // ==================== Tab切换 ====================
    function switchTab(tabName) {
        currentTab = tabName;
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        const panels = $$('.tab-panel');
        panels.forEach(panel => {
            panel.classList.toggle('active', panel.id === `panel-${tabName}`);
        });

        if (tabName === 'chatroom') {
            chatTabActive = true;
            unreadChatCount = 0;
            updateOnlineBadge();
            scrollChatToBottom();
            chatTextarea.focus();
        } else {
            chatTabActive = false;
            updateOnlineBadge();
        }
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    function updateOnlineBadge() {
        if (unreadChatCount > 0 && !chatTabActive) {
            onlineBadge.style.display = 'inline';
            onlineBadge.textContent = unreadChatCount > 99 ? '99+' : unreadChatCount;
        } else if (socket && socket.connected && chatTabActive) {
            onlineBadge.style.display = 'inline';
            onlineBadge.textContent = '在线';
            onlineBadge.style.background = '#22c55e';
        } else if (socket && socket.connected) {
            onlineBadge.style.display = 'inline';
            onlineBadge.textContent = '在线';
            onlineBadge.style.background = '#22c55e';
        } else {
            onlineBadge.style.display = 'none';
            onlineBadge.style.background = '#ef4444';
        }
    }

    // ==================== 留言板 ====================
    function renderGuestbookMessage(msg) {
        const card = document.createElement('div');
        card.className = 'guestbook-card';
        card.dataset.msgId = msg.id;
        const avatarColor = getAvatarColor(msg.username);
        const initial = getInitial(msg.username);
        card.innerHTML = `
            <div class="card-header">
                <div class="avatar-circle" style="background:${avatarColor};">${escapeHTML(initial)}</div>
                <div>
                    <div class="card-username">${escapeHTML(msg.username)}</div>
                    <div class="card-time">${formatDateTime(msg.created_at)}</div>
                </div>
            </div>
            <div class="card-content">${escapeHTML(msg.content)}</div>
        `;
        return card;
    }

    function loadGuestbook(reset = false) {
        if (guestbookLoading) return;
        if (!reset && !guestbookHasMore) return;
        guestbookLoading = true;

        const offset = reset ? 0 : guestbookOffset;
        const url = `/api/guestbook?offset=${offset}&limit=${GUESTBOOK_PAGE_SIZE}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    if (reset) {
                        guestbookMessages.innerHTML = '';
                        guestbookOffset = 0;
                        guestbookHasMore = true;
                    }
                    const messages = data.messages || [];
                    if (messages.length < GUESTBOOK_PAGE_SIZE) {
                        guestbookHasMore = false;
                    }
                    messages.forEach(msg => {
                        const card = renderGuestbookMessage(msg);
                        guestbookMessages.appendChild(card);
                    });
                    guestbookOffset += messages.length;

                    if (guestbookMessages.children.length === 0) {
                        guestbookEmpty.style.display = 'flex';
                        guestbookLoadMoreWrap.hidden = true;
                    } else {
                        guestbookEmpty.style.display = 'none';
                        guestbookLoadMoreWrap.hidden = !guestbookHasMore;
                    }
                }
                guestbookLoading = false;
            })
            .catch(err => {
                console.error('加载留言失败:', err);
                showToast('加载留言失败，请检查网络连接');
                guestbookLoading = false;
            });
    }

    function sendGuestbook() {
        const content = guestbookTextarea.value.trim();
        if (!content) {
            showToast('请输入留言内容');
            return;
        }
        if (!currentUsername) {
            showToast('请先设置昵称');
            showUsernameModal();
            return;
        }
        guestbookSendBtn.disabled = true;
        guestbookSendBtn.textContent = '发送中...';

        fetch('/api/guestbook', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: currentUsername, content: content }),
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    const msg = data.message;
                    const card = renderGuestbookMessage(msg);
                    // 插入到最前面
                    if (guestbookMessages.firstChild && guestbookMessages.firstChild.classList &&
                        guestbookMessages.firstChild.classList.contains('guestbook-card')) {
                        guestbookMessages.insertBefore(card, guestbookMessages.firstChild);
                    } else {
                        guestbookMessages.appendChild(card);
                        guestbookEmpty.style.display = 'none';
                    }
                    guestbookTextarea.value = '';
                    guestbookTextarea.style.height = 'auto';
                    guestbookOffset++;
                    showToast('留言发布成功！✅');
                } else {
                    showToast('发布失败，请重试');
                }
                guestbookSendBtn.disabled = false;
                guestbookSendBtn.textContent = ' 发布';
            })
            .catch(err => {
                console.error('发布留言失败:', err);
                showToast('发布失败，请检查网络连接');
                guestbookSendBtn.disabled = false;
                guestbookSendBtn.textContent = ' 发布';
            });
    }

    guestbookSendBtn.addEventListener('click', sendGuestbook);
    guestbookTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendGuestbook();
        }
    });
    // 自动调整textarea高度
    guestbookTextarea.addEventListener('input', () => {
        guestbookTextarea.style.height = 'auto';
        guestbookTextarea.style.height = Math.min(guestbookTextarea.scrollHeight, 100) + 'px';
    });

    loadMoreGuestbookBtn.addEventListener('click', () => loadGuestbook(false));

    // 滚动加载更多
    guestbookMessages.addEventListener('scroll', () => {
        if (guestbookLoading || !guestbookHasMore) return;
        const { scrollTop, scrollHeight, clientHeight } = guestbookMessages;
        if (scrollHeight - scrollTop - clientHeight < 120) {
            loadGuestbook(false);
        }
    });

    // ==================== 聊天室 ====================
    function renderChatMessage(msg, isSelf) {
        const wrapper = document.createElement('div');
        const avatarColor = getAvatarColor(msg.username);
        const initial = getInitial(msg.username);

        if (msg.type === 'system') {
            wrapper.className = 'chat-message system-msg';
            wrapper.innerHTML = `<span>${escapeHTML(msg.content)}</span>`;
            return wrapper;
        }

        wrapper.className = `chat-message ${isSelf ? 'self' : 'other'}`;
        wrapper.innerHTML = `
            <div class="chat-avatar-sm" style="background:${avatarColor};">${escapeHTML(initial)}</div>
            <div>
                <div class="msg-username">${escapeHTML(msg.username)}</div>
                <div class="chat-bubble">${escapeHTML(msg.content)}</div>
                <div class="msg-time">${formatChatTime(msg.created_at || msg.timestamp)}</div>
            </div>
        `;
        return wrapper;
    }

    function scrollChatToBottom() {
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);
    }

    function addChatMessage(msg) {
        const isSelf = (msg.username === currentUsername) && (msg.type !== 'system');
        const el = renderChatMessage(msg, isSelf);
        chatMessages.appendChild(el);
        chatEmpty.style.display = 'none';
        if (chatTabActive) {
            scrollChatToBottom();
        } else if (!isSelf && msg.type !== 'system') {
            unreadChatCount++;
            updateOnlineBadge();
        }
    }

    function loadChatHistory() {
        fetch('/api/chat/history?limit=100')
            .then(res => res.json())
            .then(data => {
                if (data.success && data.messages) {
                    data.messages.forEach(msg => {
                        const isSelf = (msg.username === currentUsername);
                        const el = renderChatMessage(msg, isSelf);
                        chatMessages.appendChild(el);
                    });
                    if (data.messages.length > 0) {
                        chatEmpty.style.display = 'none';
                    }
                    scrollChatToBottom();
                }
            })
            .catch(err => console.error('加载聊天记录失败:', err));
    }

    function sendChatMessage() {
        const content = chatTextarea.value.trim();
        if (!content) return;
        if (!currentUsername) {
            showToast('请先设置昵称');
            showUsernameModal();
            return;
        }
        if (!socket || !socket.connected) {
            showToast('连接已断开，正在重连...');
            return;
        }
        chatSendBtn.disabled = true;
        socket.emit('send_message', {
            username: currentUsername,
            content: content,
        });
        chatTextarea.value = '';
        chatTextarea.style.height = 'auto';
        chatSendBtn.disabled = false;
        chatTextarea.focus();
    }

    chatSendBtn.addEventListener('click', sendChatMessage);
    chatTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
    chatTextarea.addEventListener('input', () => {
        chatTextarea.style.height = 'auto';
        chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 100) + 'px';
    });

    // ==================== Socket.IO ====================
    function initSocket() {
        if (socket) {
            socket.disconnect();
        }
        socket = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
        });

        socket.on('connect', () => {
            console.log('Socket connected:', socket.id);
            updateOnlineBadge();
            if (currentUsername) {
                socket.emit('update_username', { username: currentUsername });
            }
            // 连接成功后加载聊天历史
            if (chatMessages.children.length <= 1 &&
                (chatMessages.children.length === 0 ||
                    (chatMessages.children.length === 1 && chatMessages.children[0].id === 'chatEmpty'))
            ) {
                loadChatHistory();
            }
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected');
            updateOnlineBadge();
        });

        socket.on('receive_message', (data) => {
            addChatMessage(data);
        });

        socket.on('user_joined', (data) => {
            const sysMsg = {
                type: 'system',
                content: data.content || `${data.username} 加入了聊天室`,
                created_at: new Date().toISOString(),
                username: '系统',
            };
            addChatMessage(sysMsg);
        });

        socket.on('user_left', (data) => {
            const sysMsg = {
                type: 'system',
                content: data.content || `${data.username} 离开了聊天室`,
                created_at: new Date().toISOString(),
                username: '系统',
            };
            addChatMessage(sysMsg);
        });

        socket.on('connect_error', (err) => {
            console.error('Socket connection error:', err);
            updateOnlineBadge();
        });
    }

    // ==================== 初始化 ====================
    function init() {
        initUsername();
        initSocket();
        loadGuestbook(true);
        switchTab('guestbook');

        // 如果用户名已存在但模态框还显示着，隐藏它
        if (currentUsername && usernameModal.style.display !== 'none') {
            hideUsernameModal();
        }
    }

    // 启动应用
    init();

    // ==================== 窗口事件 ====================
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.disconnect();
        }
    });

    // 处理页面可见性变化
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && currentTab === 'chatroom') {
            chatTabActive = true;
            unreadChatCount = 0;
            updateOnlineBadge();
            scrollChatToBottom();
        }
    });

    console.log(' 留言聊天室应用已就绪');
    console.log('    留言板 - 发布和浏览留言');
    console.log('    聊天室 - 实时聊天通信');
    console.log('    WebSocket 状态:', socket ? '已初始化' : '等待初始化');
})();
