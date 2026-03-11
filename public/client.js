const socket = io();
let username = "";

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

function loadAllUsers() {
    fetch("/all-users")
    .then(res => res.json())
    .then(users => {
        const usersDiv = document.getElementById("users");
        usersDiv.innerHTML = "";

        // ✅ Show current user at top separately
        const selfDiv = document.createElement("div");
        selfDiv.textContent = "👤 " + username + " (You)";
        selfDiv.classList.add("current-user");
        usersDiv.appendChild(selfDiv);

        // ✅ Show all OTHER users below
        users.forEach(u => {
            if(u.username === username) return; // skip self
            const div = document.createElement("div");
            div.textContent = u.username;
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

function sendMsg(){
    const msgInput = document.getElementById("msg");
    const msg = msgInput.value.trim();
    if(msg){
        socket.emit("message", msg);
        msgInput.value = "";
    }
}

function addMessage(user, message, isCurrentUser){
    const messagesDiv = document.getElementById("messages");
    const div = document.createElement("div");
    div.textContent = `${user}: ${message}`;
    div.className = isCurrentUser ? "sent" : "message";
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}