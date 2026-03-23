const socket = io();
let username = "";
let onlineUsers = [];
let typingTimeout;
let chatMode = "group";
let privateChatWith = null;
let unreadCounts = {};
let lastShownDate = null;
let replyingTo = null;
let reactions = {};
let myProfile = { avatar: null, bio: "", user_status: "online" };
let userProfiles = {};
let _selectedStatus = "online";
let _pendingAvatar = null;

// ── Init ──────────────────────────────────────────────────────────────────
fetch("/username")
.then(res => res.json())
.then(data => {
    if (!data.username) {
        window.location.href = "login.html";
    } else {
        username = data.username;
        socket.emit("join", username);
        // Show username immediately in sidebar card before profile loads
        const nameEl = document.getElementById("sidebar-name");
        const avatarEl = document.getElementById("sidebar-avatar");
        if (nameEl) nameEl.textContent = username;
        if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase();
        loadMyProfile();
        loadAllUsers();
    }
});

// ── Date helpers ──────────────────────────────────────────────────────────
function getDateLabel(timestamp) {
    const msgDate = timestamp ? new Date(timestamp) : new Date();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const isSameDay = (a, b) =>
        a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
    if (isSameDay(msgDate, today)) return "Today";
    if (isSameDay(msgDate, yesterday)) return "Yesterday";
    return msgDate.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
}

function showDateSeparatorIfNeeded(timestamp) {
    const label = getDateLabel(timestamp);
    if (label !== lastShownDate) {
        lastShownDate = label;
        const sep = document.createElement("div");
        sep.className = "date-separator";
        sep.innerHTML = `<span>${label}</span>`;
        document.getElementById("messages").appendChild(sep);
    }
}

// ── Mode switching ────────────────────────────────────────────────────────
function switchMode(mode) {
    chatMode = mode;
    privateChatWith = null;
    document.getElementById("groupBtn").classList.toggle("active", mode === "group");
    document.getElementById("privateBtn").classList.toggle("active", mode === "private");
    document.getElementById("savedBtn").classList.toggle("active", mode === "saved");
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";
    if (mode === "group") {
        document.getElementById("chat-header-text").textContent = "👥 Group Chat";
        socket.emit("join", username);
    } else if (mode === "saved") {
        document.getElementById("chat-header-text").textContent = "📌 Saved Messages";
        loadSavedMessages();
    } else {
        document.getElementById("chat-header-text").textContent = "🔒 Select a user to chat";
        messagesDiv.innerHTML = `<div class="info-msg">👈 Select a user from the sidebar to start private chat</div>`;
    }
}

function startPrivateChat(targetUser) {
    privateChatWith = targetUser;
    chatMode = "private";
    unreadCounts[targetUser] = 0;
    loadAllUsers();
    document.getElementById("chat-header-text").textContent = `🔒 Private Chat with ${targetUser}`;
    document.getElementById("privateBtn").classList.add("active");
    document.getElementById("groupBtn").classList.remove("active");
    document.getElementById("messages").innerHTML = "";
    fetch(`/private-messages/${username}/${targetUser}`)
    .then(res => res.json())
    .then(messages => {
        messages.forEach(m => addMessage(m.sender, m.message, m.sender === username, m.timestamp, m.reply_to, m.image_data, m.image_type, m.id, "private", targetUser));
    });
}

// ── Users list ────────────────────────────────────────────────────────────
socket.on("users", (usersArr) => {
    onlineUsers = usersArr;
    loadAllUsers();
});

function loadAllUsers() {
    fetch("/all-users-with-profiles")
    .then(res => res.json())
    .then(users => {
        users.forEach(u => { userProfiles[u.username] = u; });

        const usersDiv = document.getElementById("users");
        usersDiv.innerHTML = "";

        // Self card
        const me = users.find(u => u.username === username) || {};
        const selfAvatarHtml = me.avatar
            ? `<img class="user-avatar-thumb" src="${me.avatar}" alt="">`
            : `<span class="user-avatar-thumb user-avatar-letter">${username.charAt(0).toUpperCase()}</span>`;
        const selfDiv = document.createElement("div");
        selfDiv.className = "user-item current-user";
        selfDiv.innerHTML = `
            <div class="user-avatar-wrap">
                ${selfAvatarHtml}
                <span class="status-dot status-online"></span>
            </div>
            <div class="user-item-info">
                <span class="username-text">${username} (You)</span>
                ${me.bio ? `<span class="user-bio-preview">${me.bio.slice(0,28)}${me.bio.length>28?"…":""}</span>` : ""}
            </div>
        `;
        usersDiv.appendChild(selfDiv);

        // Other users
        users.forEach(u => {
            if (u.username === username) return;
            const isOnline = onlineUsers.includes(u.username);
            const unread = unreadCounts[u.username] || 0;
            const avatarHtml = u.avatar
                ? `<img class="user-avatar-thumb" src="${u.avatar}" alt="">`
                : `<span class="user-avatar-thumb user-avatar-letter">${u.username.charAt(0).toUpperCase()}</span>`;
            const statusDot = getStatusDotHtml(isOnline, u.user_status);

            const div = document.createElement("div");
            div.className = "user-item";
            if (u.username === privateChatWith) div.classList.add("selected");
            div.innerHTML = `
                <div class="user-avatar-wrap">
                    ${avatarHtml}
                    ${statusDot}
                </div>
                <div class="user-item-info">
                    <span class="username-text">${u.username}</span>
                    ${u.bio ? `<span class="user-bio-preview">${u.bio.slice(0,28)}${u.bio.length>28?"…":""}</span>` : ""}
                </div>
                ${unread > 0 ? `<span class="badge">${unread}</span>` : ""}
            `;
            div.onclick = () => {
                startPrivateChat(u.username);
                if (window.matchMedia("(max-width:700px)").matches) closeSidebar();
            };
            div.addEventListener("contextmenu", (e) => { e.preventDefault(); openViewProfile(u.username); });
            div.style.cursor = "pointer";
            usersDiv.appendChild(div);
        });
    });
}

function getStatusDotHtml(isOnline, status) {
    if (!isOnline) return `<span class="status-dot status-offline"></span>`;
    const map = { online: "status-online", busy: "status-busy", away: "status-away", invisible: "status-offline" };
    return `<span class="status-dot ${map[status] || "status-online"}"></span>`;
}

// ── Message events ────────────────────────────────────────────────────────
socket.on("message", (data) => {
    if (chatMode === "group") {
        addMessage(data.user, data.text, data.user === username, null, data.replyTo, data.imageData, data.imageType, data.id, "group", null);
    } else if (data.user !== username) {
        showMsgNotification(data.user, data.imageData ? "📷 Image" : (data.text || ""), "group");
    }
});

socket.on("privateMessage", ({ id, from, message, replyTo, imageData, imageType }) => {
    if (from === username) return;
    if (chatMode === "private" && from === privateChatWith) {
        addMessage(from, message, false, null, replyTo, imageData, imageType, id, "private", from);
    } else {
        unreadCounts[from] = (unreadCounts[from] || 0) + 1;
        loadAllUsers();
        showMsgNotification(from, imageData ? "📷 Image" : (message || ""), "private");
    }
});

socket.on("previousMessages", (messages) => {
    if (chatMode === "group") {
        document.getElementById("messages").innerHTML = "";
        messages.forEach(m => addMessage(m.user, m.message, m.user === username, m.timestamp, m.reply_to, m.image_data, m.image_type, m.id, "group", null));
    }
});

socket.on("typing", (user) => {
    if (user !== username) {
        const el = document.getElementById("typing-indicator");
        el.textContent = `${user} is typing...`;
        el.style.display = "block";
    }
});
socket.on("stopTyping", () => {
    const el = document.getElementById("typing-indicator");
    el.textContent = "";
    el.style.display = "none";
});

// ── Send message ──────────────────────────────────────────────────────────
function sendMsg() {
    const msgInput = document.getElementById("msg");
    const msg = msgInput.value.trim();
    const pendingImage = window._pendingImage;
    if (!msg && !pendingImage) return;

    if (chatMode === "group") {
        socket.emit("message", {
            text: msg, replyTo: replyingTo,
            imageData: pendingImage ? pendingImage.data : null,
            imageType: pendingImage ? pendingImage.type : null
        });
    } else if (chatMode === "private" && privateChatWith) {
        socket.emit("privateMessage", {
            to: privateChatWith, message: msg, replyTo: replyingTo,
            imageData: pendingImage ? pendingImage.data : null,
            imageType: pendingImage ? pendingImage.type : null
        });
        addMessage(username, msg, true, null, replyingTo,
            pendingImage ? pendingImage.data : null,
            pendingImage ? pendingImage.type : null,
            null, "private", privateChatWith);
    } else {
        alert("Please select a user to chat with!");
        return;
    }

    window._pendingImage = null;
    document.getElementById("image-preview-area").style.display = "none";
    document.getElementById("image-preview-area").innerHTML = "";
    cancelReply();
    socket.emit("stopTyping");
    msgInput.value = "";
}

document.getElementById("msg").addEventListener("input", () => {
    socket.emit("typing", username);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stopTyping"), 2000);
});

// ── addMessage ────────────────────────────────────────────────────────────
function addMessage(user, message, isCurrentUser, timestamp = null, replyTo = null, imageData = null, imageType = null, msgId = null, chatType = "group", chatPeer = null) {
    showDateSeparatorIfNeeded(timestamp);
    const messagesDiv = document.getElementById("messages");
    const time = timestamp
        ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const wrapper = document.createElement("div");
    wrapper.className = isCurrentUser ? "message-wrapper sent-wrapper" : "message-wrapper";
    if (msgId) wrapper.dataset.id = msgId;
    wrapper.dataset.user = user;
    wrapper.dataset.chatType = chatType;
    if (chatPeer) wrapper.dataset.chatPeer = chatPeer;
    wrapper.dataset.timestamp = timestamp ? new Date(timestamp).getTime() : Date.now();

    const div = document.createElement("div");
    div.className = isCurrentUser ? "sent" : "message";

    let replyData = replyTo;
    if (typeof replyTo === "string") {
        try { replyData = JSON.parse(replyTo); } catch { replyData = null; }
    }

    let imageHtml = "";
    if (imageData) {
        const src = imageData.startsWith("data:") ? imageData : `data:${imageType || "image/png"};base64,${imageData}`;
        imageHtml = `<div class="msg-image-wrap"><img class="msg-image" src="${src}" alt="image" onclick="openImageFull(this.src)"/></div>`;
    }

    div.innerHTML = `
        <button class="msg-menu-btn" title="Options">⋮</button>
        ${replyData ? `<div class="reply-quote">↩ ${replyData.user}: ${replyData.text}</div>` : ""}
        ${message ? `<span class="msg-text">${user}: ${message}</span>` : `<span class="msg-text msg-text-name">${user}</span>`}
        ${imageHtml}
        <span class="msg-time">${time}</span>
    `;

    div.querySelector(".msg-menu-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        showMsgMenu(div.querySelector(".msg-menu-btn"), wrapper, isCurrentUser, msgId, chatType, chatPeer, user, message, imageData, imageType);
    });

    wrapper.appendChild(div);

    if (msgId) {
        const reactBar = document.createElement("div");
        reactBar.className = "reactions-bar";
        reactBar.dataset.msgId = msgId;
        wrapper.appendChild(reactBar);
        renderReactions(msgId, reactBar);
    }

    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function openImageFull(src) {
    document.getElementById("image-overlay-img").src = src;
    document.getElementById("image-overlay").style.display = "flex";
}
function closeImageOverlay() { document.getElementById("image-overlay").style.display = "none"; }

function setReply(user, text) {
    replyingTo = { user, text };
    document.getElementById("reply-box").classList.add("active");
    document.getElementById("reply-box-text").textContent = `↩ ${user}: ${text}`;
    document.getElementById("msg").focus();
}
function cancelReply() {
    replyingTo = null;
    document.getElementById("reply-box").classList.remove("active");
    document.getElementById("reply-box-text").textContent = "";
}

function openImagePicker() { document.getElementById("image-file-input").click(); }

document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("image-file-input");
    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { alert("Image too large! Max 5MB."); fileInput.value = ""; return; }
            const reader = new FileReader();
            reader.onload = (ev) => {
                window._pendingImage = { data: ev.target.result, type: file.type };
                const previewArea = document.getElementById("image-preview-area");
                previewArea.style.display = "flex";
                previewArea.innerHTML = `<img src="${ev.target.result}" class="preview-thumb"/><button class="preview-cancel-btn" onclick="cancelImage()">✕</button>`;
            };
            reader.readAsDataURL(file);
            fileInput.value = "";
        });
    }
});

function cancelImage() {
    window._pendingImage = null;
    const previewArea = document.getElementById("image-preview-area");
    previewArea.style.display = "none";
    previewArea.innerHTML = "";
}

// ── Saved Messages ────────────────────────────────────────────────────────
function saveMessage(user, message, imageData, imageType) {
    const source = chatMode === "group" ? "Group Chat" : (privateChatWith ? `Private: ${privateChatWith}` : "");
    fetch("/save-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original_user: user, message: message || "", image_data: imageData || null, image_type: imageType || null, source_chat: source })
    })
    .then(res => res.json())
    .then(data => { if (data.ok) showToast("📌 Message saved!"); else showToast("❌ " + (data.error || "Failed")); })
    .catch(err => showToast("❌ " + err.message));
}

function loadSavedMessages() {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = `<div class="info-msg" style="margin-top:20px;">Loading...</div>`;
    fetch("/saved-messages")
    .then(res => res.json())
    .then(items => {
        messagesDiv.innerHTML = "";
        if (items.length === 0) { messagesDiv.innerHTML = `<div class="info-msg">📌 No saved messages yet.</div>`; return; }
        items.forEach(item => addSavedItem(item));
    });
}

function addSavedItem(item) {
    const messagesDiv = document.getElementById("messages");
    const card = document.createElement("div");
    card.className = "saved-card";
    card.dataset.id = item.id;
    const time = item.saved_at ? new Date(item.saved_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    let imageHtml = "";
    if (item.image_data) {
        const src = item.image_data.startsWith("data:") ? item.image_data : `data:${item.image_type || "image/png"};base64,${item.image_data}`;
        imageHtml = `<div class="msg-image-wrap"><img class="msg-image" src="${src}" alt="image" onclick="openImageFull(this.src)"/></div>`;
    }
    card.innerHTML = `
        <div class="saved-card-meta">
            <span class="saved-from">✉️ ${item.original_user}</span>
            <span class="saved-source">${item.source_chat || ""}</span>
            <button class="saved-delete-btn" onclick="deleteSavedMessage(${item.id}, this)" title="Remove">🗑️</button>
        </div>
        ${item.message ? `<div class="saved-card-text">${item.message}</div>` : ""}
        ${imageHtml}
        <div class="saved-card-time">${time}</div>
    `;
    messagesDiv.appendChild(card);
}

function deleteSavedMessage(id, btn) {
    fetch(`/saved-messages/${id}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            const card = btn.closest(".saved-card");
            card.style.opacity = "0"; card.style.transform = "scale(0.95)"; card.style.transition = "all 0.2s";
            setTimeout(() => card.remove(), 200);
        }
    });
}

// ── Toast ─────────────────────────────────────────────────────────────────
function showToast(msg) {
    let toast = document.getElementById("toast-msg");
    if (!toast) { toast = document.createElement("div"); toast.id = "toast-msg"; document.body.appendChild(toast); }
    toast.textContent = msg;
    toast.className = "toast-active";
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { toast.className = ""; }, 2500);
}

// ── Notification Toast ────────────────────────────────────────────────────
function showMsgNotification(from, preview, type) {
    if (from === username) return;
    const old = document.getElementById("msg-notif-toast");
    if (old) { clearTimeout(window._notifTimer); old.remove(); }
    const toast = document.createElement("div");
    toast.id = "msg-notif-toast";
    toast.className = "msg-notif-toast";
    const previewShort = preview.length > 45 ? preview.slice(0, 45) + "…" : preview;
    toast.innerHTML = `
        <span class="msg-notif-icon">💬</span>
        <div class="msg-notif-text">
            <span class="msg-notif-from">${from}</span>
            <span class="msg-notif-type">${type === "group" ? "Group Chat" : "Private Message"}</span>
            <span class="msg-notif-preview">${previewShort}</span>
        </div>
    `;
    toast.onclick = () => {
        if (type === "private") startPrivateChat(from); else switchMode("group");
        toast.classList.remove("msg-notif-show");
        setTimeout(() => toast.remove(), 350);
        clearTimeout(window._notifTimer);
    };
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("msg-notif-show"));
    window._notifTimer = setTimeout(() => { toast.classList.remove("msg-notif-show"); setTimeout(() => toast.remove(), 350); }, 4000);
}

// ── Message Menu ──────────────────────────────────────────────────────────
function showMsgMenu(btn, wrapper, isCurrentUser, msgId, chatType, chatPeer, user, message, imageData, imageType) {
    const existing = document.getElementById("msg-menu");
    if (existing) existing.remove();
    const menu = document.createElement("div");
    menu.id = "msg-menu";
    menu.className = "delete-menu";

    const reactItem = document.createElement("button");
    reactItem.innerHTML = "😊&nbsp; React";
    reactItem.onclick = (e) => { menu.remove(); showEmojiPicker(btn, msgId, chatType, chatPeer); };
    menu.appendChild(reactItem);

    if (isCurrentUser && msgId && message && !imageData) {
        const editItem = document.createElement("button");
        editItem.innerHTML = "✏️&nbsp; Edit message";
        editItem.onclick = () => {
            menu.remove();
            if (!canEdit(wrapper)) { showToast("⏰ Cannot edit — 30 minute limit exceeded"); return; }
            startEditMessage(wrapper, msgId, message, chatType, chatPeer);
        };
        menu.appendChild(editItem);
    }

    const replyItem = document.createElement("button");
    replyItem.innerHTML = "↩&nbsp; Reply";
    replyItem.onclick = () => { setReply(user, message || "[image]"); menu.remove(); };
    menu.appendChild(replyItem);

    const saveItem = document.createElement("button");
    saveItem.innerHTML = "📌&nbsp; Save message";
    saveItem.onclick = () => { saveMessage(user, message, imageData, imageType); menu.remove(); };
    menu.appendChild(saveItem);

    const forMe = document.createElement("button");
    forMe.innerHTML = "🙈&nbsp; Delete for me";
    forMe.onclick = () => {
        wrapper.style.opacity = "0"; wrapper.style.transform = "scale(0.95)"; wrapper.style.transition = "all 0.2s";
        setTimeout(() => wrapper.remove(), 200); menu.remove();
    };
    menu.appendChild(forMe);

    if (isCurrentUser && msgId) {
        const forAll = document.createElement("button");
        forAll.innerHTML = "🗑️&nbsp; Delete for everyone";
        forAll.classList.add("delete-for-all");
        forAll.onclick = () => {
            if (chatType === "group") socket.emit("deleteMessage", { id: msgId });
            else socket.emit("deletePrivateMessage", { id: msgId, to: chatPeer });
            menu.remove();
        };
        menu.appendChild(forAll);
    }

    document.body.appendChild(menu);
    const rect = btn.getBoundingClientRect();
    let left = rect.right - menu.offsetWidth;
    if (left < 4) left = 4;
    menu.style.top = (rect.bottom + window.scrollY + 4) + "px";
    menu.style.left = left + "px";
    setTimeout(() => { document.addEventListener("click", () => menu.remove(), { once: true }); }, 0);
}

socket.on("messageDeleted", ({ id }) => {
    const wrapper = document.querySelector(`.message-wrapper[data-id="${id}"]`);
    if (wrapper) { wrapper.style.opacity="0"; wrapper.style.transform="scale(0.95)"; wrapper.style.transition="all 0.2s"; setTimeout(() => wrapper.remove(), 200); }
});
socket.on("privateMessageDeleted", ({ id }) => {
    const wrapper = document.querySelector(`.message-wrapper[data-id="${id}"]`);
    if (wrapper) { wrapper.style.opacity="0"; wrapper.style.transform="scale(0.95)"; wrapper.style.transition="all 0.2s"; setTimeout(() => wrapper.remove(), 200); }
});

// ── Mobile Sidebar ────────────────────────────────────────────────────────
function openSidebar() {
    if (!window.matchMedia("(max-width: 700px)").matches) return;
    document.getElementById("sidebar").classList.add("open");
    document.getElementById("sidebar-overlay").classList.add("active");
}
function closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebar-overlay").classList.remove("active");
}
document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".mode-btn").forEach(btn => {
        btn.addEventListener("click", () => { if (window.matchMedia("(max-width: 700px)").matches) closeSidebar(); });
    });
});

// ── Emoji Reactions ───────────────────────────────────────────────────────
const REACTION_EMOJIS = ["❤️", "😂", "😮", "😢", "😡", "👍", "🎉", "🔥"];

function showEmojiPicker(anchorEl, msgId, chatType, chatPeer) {
    const existing = document.getElementById("emoji-picker");
    if (existing) existing.remove();
    if (!msgId) return;
    const picker = document.createElement("div");
    picker.id = "emoji-picker";
    picker.className = "emoji-picker";
    REACTION_EMOJIS.forEach(emoji => {
        const btn = document.createElement("button");
        btn.className = "emoji-pick-btn";
        btn.textContent = emoji;
        btn.onclick = (e) => { e.stopPropagation(); sendReaction(msgId, emoji, chatType, chatPeer); picker.remove(); };
        picker.appendChild(btn);
    });
    document.body.appendChild(picker);
    const rect = anchorEl.getBoundingClientRect();
    let top = rect.bottom + window.scrollY + 6;
    let left = rect.left + window.scrollX;
    if (left + 280 > window.innerWidth - 8) left = window.innerWidth - 280 - 8;
    if (left < 4) left = 4;
    picker.style.top = top + "px";
    picker.style.left = left + "px";
    setTimeout(() => { document.addEventListener("click", () => picker.remove(), { once: true }); }, 0);
}

function sendReaction(msgId, emoji, chatType, chatPeer) { socket.emit("react", { msgId, emoji, chatType, to: chatPeer }); }

function renderReactions(msgId, barEl) {
    barEl.innerHTML = "";
    const msgReactions = reactions[msgId];
    if (!msgReactions) return;
    Object.entries(msgReactions).forEach(([emoji, users]) => {
        if (!users || users.length === 0) return;
        const chip = document.createElement("button");
        chip.className = "reaction-chip" + (users.includes(username) ? " mine" : "");
        chip.title = users.join(", ");
        chip.innerHTML = `${emoji}<span class="reaction-count">${users.length}</span>`;
        chip.onclick = () => {
            const wrapper = barEl.closest(".message-wrapper");
            sendReaction(msgId, emoji, wrapper ? wrapper.dataset.chatType : "group", wrapper ? wrapper.dataset.chatPeer : null);
        };
        barEl.appendChild(chip);
    });
}

function updateReactionBar(msgId) {
    const bar = document.querySelector(`.reactions-bar[data-msg-id="${msgId}"]`);
    if (bar) renderReactions(msgId, bar);
}

socket.on("reactionUpdate", ({ msgId, reactionMap }) => { reactions[msgId] = reactionMap; updateReactionBar(msgId); });

// ── Edit Message ──────────────────────────────────────────────────────────
const EDIT_TIME_LIMIT_MS = 30 * 60 * 1000;

function canEdit(wrapper) { return Date.now() - parseInt(wrapper.dataset.timestamp || "0") < EDIT_TIME_LIMIT_MS; }

function startEditMessage(wrapper, msgId, currentText, chatType, chatPeer) {
    const existing = document.getElementById("edit-box-container");
    if (existing) existing.remove();
    const editContainer = document.createElement("div");
    editContainer.id = "edit-box-container";
    editContainer.className = "edit-box-container";
    const textarea = document.createElement("textarea");
    textarea.className = "edit-textarea";
    textarea.value = currentText;
    textarea.rows = 2;
    const btnRow = document.createElement("div");
    btnRow.className = "edit-btn-row";
    const saveBtn = document.createElement("button");
    saveBtn.className = "edit-save-btn";
    saveBtn.textContent = "Save";
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "edit-cancel-btn";
    cancelBtn.textContent = "Cancel";
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    editContainer.appendChild(textarea);
    editContainer.appendChild(btnRow);
    wrapper.insertBefore(editContainer, wrapper.querySelector(".reactions-bar") || null);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    cancelBtn.onclick = () => editContainer.remove();
    saveBtn.onclick = () => {
        const newText = textarea.value.trim();
        if (!newText || newText === currentText) { editContainer.remove(); return; }
        socket.emit("editMessage", { id: msgId, newText, chatType, to: chatPeer });
        editContainer.remove();
    };
    textarea.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.ctrlKey) saveBtn.click(); if (e.key === "Escape") cancelBtn.click(); });
}

socket.on("messageEdited", ({ id, newText }) => {
    const wrapper = document.querySelector(`.message-wrapper[data-id="${id}"]`);
    if (!wrapper) return;
    const msgTextEl = wrapper.querySelector(".msg-text");
    if (!msgTextEl) return;
    msgTextEl.innerHTML = `${wrapper.dataset.user}: ${newText} <span class="edited-label">(edited)</span>`;
    const bubble = wrapper.querySelector(".sent, .message");
    if (bubble) { bubble.style.transition = "background 0.3s"; bubble.style.background = "rgba(99,102,241,0.15)"; setTimeout(() => { bubble.style.background = ""; }, 800); }
});

// ── Profile ───────────────────────────────────────────────────────────────
function loadMyProfile() {
    fetch("/profile/me")
    .then(res => res.json())
    .then(p => {
        if (!p || !p.username) return;
        myProfile = p;
        _selectedStatus = p.user_status || "online";
        updateSidebarProfileCard(p);
        // Refresh user list so self card shows correct avatar/bio
        loadAllUsers();
    })
    .catch(() => {});
}

function updateSidebarProfileCard(p) {
    const avatarEl = document.getElementById("sidebar-avatar");
    const nameEl   = document.getElementById("sidebar-name");
    const statusEl = document.getElementById("sidebar-status");
    if (!avatarEl) return;

    const displayName = p.username || username || "?";
    if (p.avatar) {
        avatarEl.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;">`;
    } else {
        avatarEl.innerHTML = "";
        avatarEl.textContent = displayName.charAt(0).toUpperCase();
    }
    if (nameEl) nameEl.textContent = displayName;
    if (statusEl) {
        const labels = { online:"🟢 Online", busy:"🔴 Busy", away:"🟡 Away", invisible:"⚫ Invisible" };
        statusEl.textContent = (p.bio && p.bio.trim())
            ? p.bio.slice(0,30) + (p.bio.length>30?"…":"")
            : (labels[p.user_status] || "🟢 Online");
    }
}

function openProfileModal() {
    const modal = document.getElementById("profile-modal");
    if (!modal) return;
    document.getElementById("profile-username-display").value = username;
    document.getElementById("profile-bio").value = myProfile.bio || "";
    _selectedStatus = myProfile.user_status || "online";
    _pendingAvatar = null;

    const avatarEl = document.getElementById("modal-avatar");
    if (myProfile.avatar) {
        avatarEl.innerHTML = `<img src="${myProfile.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
        avatarEl.textContent = username.charAt(0).toUpperCase();
    }

    document.querySelectorAll(".status-opt").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.status === _selectedStatus);
        btn.onclick = () => {
            _selectedStatus = btn.dataset.status;
            document.querySelectorAll(".status-opt").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        };
    });

    const fileInput = document.getElementById("avatar-file-input");
    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) { showToast("❌ Image too large (max 3MB)"); return; }
        const reader = new FileReader();
        reader.onload = (ev) => {
            _pendingAvatar = ev.target.result;
            document.getElementById("modal-avatar").innerHTML = `<img src="${_pendingAvatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
        };
        reader.readAsDataURL(file);
        fileInput.value = "";
    };

    modal.classList.add("open");
}

function closeProfileModal(e) {
    if (e && e.target !== document.getElementById("profile-modal")) return;
    document.getElementById("profile-modal").classList.remove("open");
}

function saveProfile() {
    const bio = document.getElementById("profile-bio").value.trim();
    const avatar = _pendingAvatar || myProfile.avatar || null;
    fetch("/profile/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bio, status: _selectedStatus, avatar })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            myProfile = { ...myProfile, bio, user_status: _selectedStatus, avatar };
            updateSidebarProfileCard(myProfile);
            showToast("✅ Profile saved!");
            document.getElementById("profile-modal").classList.remove("open");
            loadAllUsers();
        } else {
            showToast("❌ " + (data.error || "Failed to save"));
        }
    })
    .catch(() => showToast("❌ Save failed"));
}

function openViewProfile(targetUsername) {
    const modal = document.getElementById("view-profile-modal");
    if (!modal) return;
    const p = userProfiles[targetUsername] || {};
    const isOnline = onlineUsers.includes(targetUsername);
    const avatarEl = document.getElementById("view-avatar");
    if (p.avatar) {
        avatarEl.innerHTML = `<img src="${p.avatar}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
        avatarEl.textContent = targetUsername.charAt(0).toUpperCase();
    }
    document.getElementById("view-name").textContent = targetUsername;
    const statusLabels = { online:"🟢 Online", busy:"🔴 Busy", away:"🟡 Away", invisible:"⚫ Invisible" };
    document.getElementById("view-status-badge").textContent = !isOnline ? "⚫ Offline" : (statusLabels[p.user_status] || "🟢 Online");
    document.getElementById("view-bio").textContent = p.bio || "No bio yet.";
    document.getElementById("view-chat-btn").onclick = () => {
        closeViewProfile();
        startPrivateChat(targetUsername);
        if (window.matchMedia("(max-width:700px)").matches) closeSidebar();
    };
    modal.classList.add("open");
}

function closeViewProfile(e) {
    if (e && e.target !== document.getElementById("view-profile-modal")) return;
    document.getElementById("view-profile-modal").classList.remove("open");
}