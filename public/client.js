const socket = io();
const username = localStorage.getItem("username");

socket.emit("join", username);

const messages = document.getElementById("messages");
const usersDiv = document.getElementById("users");
const msgInput = document.getElementById("msg");

// Send message function
function sendMsg(){
    const msg = msgInput.value.trim();
    if(msg){
        socket.emit("message", msg);
        msgInput.value = "";
    }
}

// Enter key to send message
msgInput.addEventListener("keypress", function(event){
    if(event.key === "Enter"){
        sendMsg();
    }
});

// Receive messages
socket.on("message", (data) => {
    const div = document.createElement("div");
    div.classList.add("message"); // default class

    if(data.user === username){
        // Messages sent by you
        div.classList.add("sent");
        div.innerText = data.text; // optional: skip username
    } else {
        // Messages from others
        div.innerText = data.user + ": " + data.text;
    }

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight; // auto-scroll
});

// Update online users
socket.on("users", (users) => {
    usersDiv.innerHTML = "<h3>Online Users</h3>";
    users.forEach(u => {
        usersDiv.innerHTML += "<div>" + u + "</div>";
    });
});