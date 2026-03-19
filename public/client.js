const socket = io();
let username = "";
let onlineUsers = [];
let typingTimeout;
let chatMode = "group";
let privateChatWith = null;
let unreadCounts = {};
let lastShownDate = null;
let replyingTo = null; // { user, text }

fetch("/username")
.then(res => res.json())
.then(data => {
    if(!data.username){
        window.location.href = "login.html";
    } else {
        username = data.username;
        socket.emit("join", username);
        loadAllUsers();
    }
});

function getDateLabel(timestamp) {
    const msgDate = timestamp ? new Date(timestamp) : new Date();
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const isSameDay = (a, b) =>
        a.getDate() === b.getDate() &&
        a.getMonth() === b.getMonth() &&
        a.getFullYear() === b.getFullYear();

    if (isSameDay(msgDate, today)) return "Today";
    if (isSameDay(msgDate, yesterday)) return "Yesterday";

    // Older — show full date like "March 10, 2026"
    return msgDate.toLocaleDateString([], {
        year: 'numeric', month: 'long', day: 'numeric'
    });
}

// ✅ Show date separator if date changed
function showDateSeparatorIfNeeded(timestamp) {
    const label = getDateLabel(timestamp);
    if (label !== lastShownDate) {
        lastShownDate = label;
        const messagesDiv = document.getElementById("messages");
        const separator = document.createElement("div");
        separator.className = "date-separator";
        separator.innerHTML = `<span>${label}</span>`;
        messagesDiv.appendChild(separator);
    }
}

function switchMode(mode) {
    chatMode = mode;
    privateChatWith = null;

    document.getElementById("groupBtn").classList.toggle("active", mode === "group");
    document.getElementById("privateBtn").classList.toggle("active", mode === "private");
    // NEW: toggle saved button active state
    document.getElementById("savedBtn").classList.toggle("active", mode === "saved");

    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    if (mode === "group") {
        document.getElementById("chat-header").textContent = "👥 Group Chat";
        socket.emit("join", username);
    } else if (mode === "saved") {
        // NEW: load saved messages view
        document.getElementById("chat-header").textContent = "📌 Saved Messages";
        loadSavedMessages();
    } else {
        document.getElementById("chat-header").textContent = "🔒 Select a user to chat";
        messagesDiv.innerHTML = `<div class="info-msg">👈 Select a user from the sidebar to start private chat</div>`;
    }
}

function startPrivateChat(targetUser) {
    privateChatWith = targetUser;
    chatMode = "private";

    unreadCounts[targetUser] = 0;
    loadAllUsers();

    document.getElementById("chat-header").textContent = `🔒 Private Chat with ${targetUser}`;
    document.getElementById("privateBtn").classList.add("active");
    document.getElementById("groupBtn").classList.remove("active");

    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    fetch(`/private-messages/${username}/${targetUser}`)
    .then(res => res.json())
    .then(messages => {
        messages.forEach(m => {
            addMessage(m.sender, m.message, m.sender === username, m.timestamp, m.reply_to, m.image_data, m.image_type);
        });
    });
}

socket.on("users", (usersArr) => {
    onlineUsers = usersArr;
    loadAllUsers();
});

function loadAllUsers() {
    fetch("/all-users")
    .then(res => res.json())
    .then(users => {
        const usersDiv = document.getElementById("users");
        usersDiv.innerHTML = "";

        const selfDiv = document.createElement("div");
        selfDiv.className = "user-item current-user";
        selfDiv.innerHTML = `
            <span class="dot online"></span>
            <span>${username} (You)</span>
        `;
        usersDiv.appendChild(selfDiv);

        users.forEach(u => {
            if(u.username === username) return;
            const isOnline = onlineUsers.includes(u.username);
            const unread = unreadCounts[u.username] || 0;

            const div = document.createElement("div");
            div.className = "user-item";

            if(u.username === privateChatWith) {
                div.classList.add("selected");
            }

            div.innerHTML = `
                <span class="dot ${isOnline ? 'online' : 'offline'}"></span>
                <span class="username-text">${u.username}</span>
                ${unread > 0 ? `<span class="badge">${unread}</span>` : ''}
            `;

            div.onclick = () => startPrivateChat(u.username);
            div.style.cursor = "pointer";
            usersDiv.appendChild(div);
        });
    });
}

socket.on("message", (data) => {
    if (chatMode === "group") {
        addMessage(data.user, data.text, data.user === username, null, data.replyTo, data.imageData, data.imageType);
    }
});

socket.on("privateMessage", ({ from, message, replyTo, imageData, imageType }) => {
    if (from === username) return;
    if (chatMode === "private" && from === privateChatWith) {
        addMessage(from, message, false, null, replyTo, imageData, imageType);
    } else {
        unreadCounts[from] = (unreadCounts[from] || 0) + 1;
        loadAllUsers();
    }
});

socket.on("previousMessages", (messages) => {
    if (chatMode === "group") {
        document.getElementById("messages").innerHTML = "";
        messages.forEach(m => addMessage(m.user, m.message, m.user === username, m.timestamp, m.reply_to, m.image_data, m.image_type));
    }
});

socket.on("typing", (user) => {
    if (user !== username) {
        const typingDiv = document.getElementById("typing-indicator");
        typingDiv.textContent = `${user} is typing...`;
        typingDiv.style.display = "block";
    }
});

socket.on("stopTyping", () => {
    const typingDiv = document.getElementById("typing-indicator");
    typingDiv.textContent = "";
    typingDiv.style.display = "none";
});

function sendMsg(){
    const msgInput = document.getElementById("msg");
    const msg = msgInput.value.trim();

    // Check if we have a pending image
    const pendingImage = window._pendingImage;

    if(!msg && !pendingImage) return;

    if (chatMode === "group") {
        socket.emit("message", {
            text: msg,
            replyTo: replyingTo,
            imageData: pendingImage ? pendingImage.data : null,
            imageType: pendingImage ? pendingImage.type : null
        });
    } else if (chatMode === "private" && privateChatWith) {
        socket.emit("privateMessage", {
            to: privateChatWith,
            message: msg,
            replyTo: replyingTo,
            imageData: pendingImage ? pendingImage.data : null,
            imageType: pendingImage ? pendingImage.type : null
        });
        addMessage(username, msg, true, null, replyingTo, pendingImage ? pendingImage.data : null, pendingImage ? pendingImage.type : null);
    } else {
        alert("Please select a user to chat with!");
        return;
    }

    // Clear pending image
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
    typingTimeout = setTimeout(() => {
        socket.emit("stopTyping");
    }, 2000);
});

function addMessage(user, message, isCurrentUser, timestamp = null, replyTo = null, imageData = null, imageType = null) {
    showDateSeparatorIfNeeded(timestamp);

    const messagesDiv = document.getElementById("messages");

    const time = timestamp
        ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Wrapper div
    const wrapper = document.createElement("div");
    wrapper.className = isCurrentUser ? "message-wrapper sent-wrapper" : "message-wrapper";

    // Reply button
    const replyBtn = document.createElement("button");
    replyBtn.className = "reply-btn";
    replyBtn.innerHTML = "↩";
    replyBtn.title = "Reply";
    replyBtn.onclick = () => setReply(user, message || "[image]");

    // NEW: Save/forward button — pins this message to the user's Saved Messages
    const saveBtn = document.createElement("button");
    saveBtn.className = "reply-btn save-btn";
    saveBtn.innerHTML = "📌";
    saveBtn.title = "Save message";
    saveBtn.onclick = () => saveMessage(user, message, imageData, imageType);

    // Message bubble
    const div = document.createElement("div");
    div.className = isCurrentUser ? "sent" : "message";

    // Parse replyTo if it's a JSON string
    let replyData = replyTo;
    if (typeof replyTo === "string") {
        try { replyData = JSON.parse(replyTo); } catch { replyData = null; }
    }

    // Build image HTML if present
    let imageHtml = "";
    if (imageData) {
        const src = imageData.startsWith("data:") ? imageData : `data:${imageType || "image/png"};base64,${imageData}`;
        imageHtml = `<div class="msg-image-wrap"><img class="msg-image" src="${src}" alt="image" onclick="openImageFull(this.src)"/></div>`;
    }

    div.innerHTML = `
        ${replyData ? `<div class="reply-quote">↩ ${replyData.user}: ${replyData.text}</div>` : ""}
        ${message ? `<span class="msg-text">${user}: ${message}</span>` : `<span class="msg-text msg-text-name">${user}</span>`}
        ${imageHtml}
        <span class="msg-time">${time}</span>
    `;

    wrapper.appendChild(div);
    wrapper.appendChild(replyBtn);
    wrapper.appendChild(saveBtn); // NEW: save button sits next to reply button
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function openImageFull(src) {
    const overlay = document.getElementById("image-overlay");
    document.getElementById("image-overlay-img").src = src;
    overlay.style.display = "flex";
}

function closeImageOverlay() {
    document.getElementById("image-overlay").style.display = "none";
}

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
// ---- Image picker ----
function openImagePicker() {
    document.getElementById("image-file-input").click();
}

document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("image-file-input");
    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Max 5MB
            if (file.size > 5 * 1024 * 1024) {
                alert("Image too large! Max size is 5MB.");
                fileInput.value = "";
                return;
            }

            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target.result;
                // Store as pending image
                window._pendingImage = { data: dataUrl, type: file.type };

                // Show preview
                const previewArea = document.getElementById("image-preview-area");
                previewArea.style.display = "flex";
                previewArea.innerHTML = `
                    <img src="${dataUrl}" style="max-height:80px;max-width:150px;border-radius:8px;"/>
                    <button onclick="cancelImage()" style="margin-left:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#888;">✕</button>
                `;
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


// ── NEW: Saved Messages feature ───────────────────────────────────────────

// Save a message to the server (called by the 📌 button)
function saveMessage(user, message, imageData, imageType) {
    const source = chatMode === "group"
        ? "Group Chat"
        : (privateChatWith ? `Private: ${privateChatWith}` : "");

    fetch("/save-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            original_user: user,
            message: message || "",
            image_data: imageData || null,
            image_type: imageType || null,
            source_chat: source
        })
    })
    .then(res => res.json())
    .then(data => {
        if (data.ok) showToast("📌 Message saved!");
    })
    .catch(() => showToast("Failed to save"));
}

// Load and render all saved messages
function loadSavedMessages() {
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = `<div class="info-msg" style="margin-top:20px;">Loading...</div>`;

    fetch("/saved-messages")
    .then(res => res.json())
    .then(items => {
        messagesDiv.innerHTML = "";

        if (items.length === 0) {
            messagesDiv.innerHTML = `<div class="info-msg">📌 No saved messages yet.<br>Hover any message and click 📌 to save it.</div>`;
            return;
        }

        items.forEach(item => {
            addSavedItem(item);
        });
    });
}

// Render a single saved message card
function addSavedItem(item) {
    const messagesDiv = document.getElementById("messages");

    const card = document.createElement("div");
    card.className = "saved-card";
    card.dataset.id = item.id;

    const time = item.saved_at
        ? new Date(item.saved_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : "";

    let imageHtml = "";
    if (item.image_data) {
        const src = item.image_data.startsWith("data:")
            ? item.image_data
            : `data:${item.image_type || "image/png"};base64,${item.image_data}`;
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

// Delete a saved message
function deleteSavedMessage(id, btn) {
    fetch(`/saved-messages/${id}`, { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
        if (data.ok) {
            const card = btn.closest(".saved-card");
            card.style.opacity = "0";
            card.style.transform = "scale(0.95)";
            card.style.transition = "all 0.2s";
            setTimeout(() => card.remove(), 200);
        }
    });
}

// Brief toast notification
function showToast(msg) {
    let toast = document.getElementById("toast-msg");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "toast-msg";
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = "toast-active";
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { toast.className = ""; }, 2500);
}