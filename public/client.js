const socket = io();
let username = "";
let onlineUsers = [];
let typingTimeout;

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

// ✅ Update online users and refresh list
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

        // ✅ Current user at top with green dot
        const selfDiv = document.createElement("div");
        selfDiv.className = "user-item current-user";
        selfDiv.textContent = "👤 " + username + " (You)";
        selfDiv.classList.add("current-user");
        selfDiv.innerHTML = `
            <span class="dot online"></span>
            <span>${username} (You)</span>
        `;
        usersDiv.appendChild(selfDiv);

        // ✅ All other users with online/offline dot
        users.forEach(u => {
            if(u.username === username) return; // skip self
            const isOnline = onlineUsers.includes(u.username);
            const div = document.createElement("div");
            div.className = "user-item";
            div.innerHTML = `
                <span class="dot ${isOnline ? 'online' : 'offline'}"></span>
                <span>${u.username}</span>
            `;
            usersDiv.appendChild(div);
        });
    });
}

socket.on("previousMessages", (messages) => {
    messages.forEach(m => addMessage(m.user, m.message, m.user === username));
});

socket.on("message", (data) => {
    addMessage(data.user, data.text, data.user === username);
});


socket.on("typing", (user) => {
    const typingDiv = document.getElementById("typing-indicator");
    typingDiv.textContent = `${user} is typing...`;
    typingDiv.style.display = "block";
});

socket.on("stopTyping", () => {
    const typingDiv = document.getElementById("typing-indicator");
    typingDiv.textContent = "";
    typingDiv.style.display = "none";
});

function sendMsg(){
    const msgInput = document.getElementById("msg");
    const msg = msgInput.value.trim();
    if(msg){
        socket.emit("message", msg);
        socket.emit("stopTyping"); // ✅ stop typing when message sent
        msgInput.value = "";
    }
}


document.getElementById("msg").addEventListener("input", () => {
    socket.emit("typing", username);

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit("stopTyping");
    }, 2000); // stop after 2 seconds of no typing
});

function addMessage(user, message, isCurrentUser){
    const messagesDiv = document.getElementById("messages");
    const div = document.createElement("div");
    div.textContent = `${user}: ${message}`;
    div.className = isCurrentUser ? "sent" : "message";
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}