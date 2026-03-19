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

    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    if (mode === "group") {
        document.getElementById("chat-header").textContent = "👥 Group Chat";
        socket.emit("join", username);
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
        // CHANGED: also pass m.image_data and m.image_type to addMessage
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

// CHANGED: also pass data.imageData and data.imageType to addMessage
socket.on("message", (data) => {
    if (chatMode === "group") {
        addMessage(data.user, data.text, data.user === username, null, data.replyTo, data.imageData, data.imageType);
    }
});

// CHANGED: destructure imageData + imageType from event, pass to addMessage
socket.on("privateMessage", ({ from, message, replyTo, imageData, imageType }) => {
    if (from === username) return;
    if (chatMode === "private" && from === privateChatWith) {
        addMessage(from, message, false, null, replyTo, imageData, imageType);
    } else {
        unreadCounts[from] = (unreadCounts[from] || 0) + 1;
        loadAllUsers();
    }
});

// CHANGED: also pass m.image_data and m.image_type to addMessage
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

    // CHANGED: read pending image set by the image picker
    const pendingImage = window._pendingImage;

    // CHANGED: allow send if there's text OR an image (was: text only)
    if(!msg && !pendingImage) return;

    if (chatMode === "group") {
        // CHANGED: include imageData + imageType in emitted event
        socket.emit("message", {
            text: msg,
            replyTo: replyingTo,
            imageData: pendingImage ? pendingImage.data : null,
            imageType: pendingImage ? pendingImage.type : null
        });
    } else if (chatMode === "private" && privateChatWith) {
        // CHANGED: include imageData + imageType in emitted event
        socket.emit("privateMessage", {
            to: privateChatWith,
            message: msg,
            replyTo: replyingTo,
            imageData: pendingImage ? pendingImage.data : null,
            imageType: pendingImage ? pendingImage.type : null
        });
        // CHANGED: optimistic sender render also passes image data
        addMessage(username, msg, true, null, replyingTo,
            pendingImage ? pendingImage.data : null,
            pendingImage ? pendingImage.type : null
        );
    } else {
        alert("Please select a user to chat with!");
        return;
    }

    // CHANGED: clear pending image and hide preview strip after sending
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

// CHANGED: added imageData + imageType params; builds <img> tag when present
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
    // CHANGED: fallback to "[image]" if message is empty (image-only bubble)
    replyBtn.onclick = () => setReply(user, message || "[image]");

    // Message bubble
    const div = document.createElement("div");
    div.className = isCurrentUser ? "sent" : "message";

    // Parse replyTo if it's a JSON string
    let replyData = replyTo;
    if (typeof replyTo === "string") {
        try { replyData = JSON.parse(replyTo); } catch { replyData = null; }
    }

    // CHANGED: build <img> if imageData present; supports full data-URL or raw base64 from DB
    let imageHtml = "";
    if (imageData) {
        const src = imageData.startsWith("data:")
            ? imageData
            : `data:${imageType || "image/png"};base64,${imageData}`;
        imageHtml = `<div class="msg-image-wrap">
            <img class="msg-image" src="${src}" alt="image" onclick="openImageFull(this.src)"/>
        </div>`;
    }

    // CHANGED: show name-only label when no text (image-only message)
    div.innerHTML = `
        ${replyData ? `<div class="reply-quote">↩ ${replyData.user}: ${replyData.text}</div>` : ""}
        ${message ? `<span class="msg-text">${user}: ${message}</span>` : `<span class="msg-text msg-text-name">${user}</span>`}
        ${imageHtml}
        <span class="msg-time">${time}</span>
    `;

    wrapper.appendChild(div);
    wrapper.appendChild(replyBtn);
    messagesDiv.appendChild(wrapper);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// NEW: open fullscreen overlay when a message image is clicked
function openImageFull(src) {
    const overlay = document.getElementById("image-overlay");
    document.getElementById("image-overlay-img").src = src;
    overlay.style.display = "flex";
}

// NEW: close the fullscreen overlay
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

// ── NEW: Image picker (everything below is brand new) ─────────────────────

// Triggers the hidden <input type="file"> in chat.html
function openImagePicker() {
    document.getElementById("image-file-input").click();
}

// Reads the selected file and stores it as a pending image
document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById("image-file-input");
    if (!fileInput) return;

    fileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reject files over 5MB
        if (file.size > 5 * 1024 * 1024) {
            alert("Image too large! Max size is 5MB.");
            fileInput.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;

            // Store globally so sendMsg() can pick it up
            window._pendingImage = { data: dataUrl, type: file.type };

            // Show thumbnail preview above the input bar
            const previewArea = document.getElementById("image-preview-area");
            previewArea.style.display = "flex";
            previewArea.innerHTML = `
                <img src="${dataUrl}" style="max-height:80px;max-width:150px;border-radius:8px;"/>
                <button onclick="cancelImage()" style="margin-left:8px;background:none;border:none;font-size:18px;cursor:pointer;color:#888;">✕</button>
            `;
        };
        reader.readAsDataURL(file);
        fileInput.value = ""; // reset so same file can be picked again
    });
});

// Discards the pending image without sending
function cancelImage() {
    window._pendingImage = null;
    const previewArea = document.getElementById("image-preview-area");
    previewArea.style.display = "none";
    previewArea.innerHTML = "";
}