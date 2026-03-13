const socket = io();
let username = "";
let onlineUsers = [];
let typingTimeout;
let chatMode = "group";      // ✅ "group" or "private"
let privateChatWith = null;  // ✅ who we're chatting with

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

// ✅ Switch between group and private mode
function switchMode(mode) {
    chatMode = mode;
    privateChatWith = null;

    document.getElementById("groupBtn").classList.toggle("active", mode === "group");
    document.getElementById("privateBtn").classList.toggle("active", mode === "private");

    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    if (mode === "group") {
        document.getElementById("chat-header").textContent = "👥 Group Chat";
        // Reload group messages
        socket.emit("join", username);
    } else {
        document.getElementById("chat-header").textContent = "🔒 Select a user to chat";
        messagesDiv.innerHTML = `<div class="info-msg">👈 Select a user from the sidebar to start private chat</div>`;
    }
}

// ✅ Start private chat with a user
function startPrivateChat(targetUser) {
    privateChatWith = targetUser;
    chatMode = "private";

    document.getElementById("chat-header").textContent = `🔒 Private Chat with ${targetUser}`;
    document.getElementById("privateBtn").classList.add("active");
    document.getElementById("groupBtn").classList.remove("active");

    // Load previous private messages
    const messagesDiv = document.getElementById("messages");
    messagesDiv.innerHTML = "";

    fetch(`/private-messages/${username}/${targetUser}`)
    .then(res => res.json())
    .then(messages => {
        messages.forEach(m => {
            addMessage(m.sender, m.message, m.sender === username);
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

        // Current user at top
        const selfDiv = document.createElement("div");
        selfDiv.className = "user-item current-user";
        selfDiv.innerHTML = `
            <span class="dot online"></span>
            <span>${username} (You)</span>
        `;
        usersDiv.appendChild(selfDiv);

        // Other users
        users.forEach(u => {
            if(u.username === username) return;
            const isOnline = onlineUsers.includes(u.username);
            const div = document.createElement("div");
            div.className = "user-item";
            div.innerHTML = `
                <span class="dot ${isOnline ? 'online' : 'offline'}"></span>
                <span>${u.username}</span>
            `;

            // ✅ Click user to start private chat
            div.onclick = () => startPrivateChat(u.username);
            div.style.cursor = "pointer";
            div.title = `Click to chat privately with ${u.username}`;

            usersDiv.appendChild(div);
        });
    });
}

socket.on("previousMessages", (messages) => {
    if (chatMode === "group") {
        document.getElementById("messages").innerHTML = "";
        messages.forEach(m => addMessage(m.user, m.message, m.user === username));
    }
});

// ✅ Group message received
socket.on("message", (data) => {
    if (chatMode === "group") {
        addMessage(data.user, data.text, data.user === username);
    }
});

// ✅ Private message received
socket.on("privateMessage", ({ from, message }) => {
    if (chatMode === "private" && (from === privateChatWith || from === username)) {
        addMessage(from, message, from === username);
    }
});

// Typing indicators
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
    if(!msg) return;

    if (chatMode === "group") {
        // ✅ Send group message
        socket.emit("message", msg);
    } else if (chatMode === "private" && privateChatWith) {
        // ✅ Send private message
        socket.emit("privateMessage", { to: privateChatWith, message: msg });
    } else {
        alert("Please select a user to chat with!");
        return;
    }

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

function addMessage(user, message, isCurrentUser){
    const messagesDiv = document.getElementById("messages");
    const div = document.createElement("div");
    div.textContent = `${user}: ${message}`;
    div.className = isCurrentUser ? "sent" : "message";
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}