require("dotenv").config();

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const db = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

const sessionStore = new MySQLStore({}, db);

app.use(session({
    secret: "chat_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

app.post("/register", (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.send("All fields are required");
    const sql = "INSERT INTO users(username,email,password) VALUES(?,?,?)";
    db.query(sql, [username, email, password], (err) => {
        if (err) {
            if (err.code === "ER_DUP_ENTRY") return res.send("Email already exists");
            return res.send("Registration failed: " + err.message);
        }
        res.redirect("/login.html");
    });
});

app.post("/login", (req, res) => {
    const { email, password } = req.body;
    const sql = "SELECT * FROM users WHERE email=? AND password=?";
    db.query(sql, [email, password], (err, result) => {
        if (result.length > 0) {
            req.session.username = result[0].username;
            req.session.save(() => res.redirect("/chat.html"));
        } else {
            res.send("Invalid login");
        }
    });
});

app.get("/username", (req, res) => {
    res.json({ username: req.session.username || null });
});

app.get("/all-users", (req, res) => {
    db.query("SELECT username FROM users", (err, result) => {
        if (err) return res.send([]);
        res.json(result);
    });
});

app.get("/private-messages/:user1/:user2", (req, res) => {
    const { user1, user2 } = req.params;
    const sql = `SELECT * FROM private_messages 
                 WHERE (sender=? AND receiver=?) 
                 OR (sender=? AND receiver=?) 
                 ORDER BY timestamp ASC LIMIT 50`;
    db.query(sql, [user1, user2, user2, user1], (err, result) => {
        if (err) return res.json([]);
        res.json(result);
    });
});

let users = {};

io.on("connection", (socket) => {

    socket.on("join", (username) => {
        socket.username = username;
        users[username] = socket.id;
        io.emit("users", Object.keys(users));

        db.query("SELECT * FROM messages ORDER BY timestamp ASC LIMIT 50", (err, results) => {
            if (err) console.log(err);
            else {
                // ✅ Parse reply_to JSON from DB
                results = results.map(r => ({
                    ...r,
                    reply_to: r.reply_to ? JSON.parse(r.reply_to) : null
                }));
                socket.emit("previousMessages", results);
            }
        });
    });

    // ✅ Group message with reply support
    socket.on("message", ({ text, replyTo }) => {
        const user = socket.username;
        if (!user) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        db.query("INSERT INTO messages(user, message, reply_to) VALUES(?,?,?)",
            [user, text, replyJson], (err) => {
                if (err) console.log(err);
            });
        io.emit("message", { user, text, replyTo });
    });

    // ✅ Private message with reply support
    socket.on("privateMessage", ({ to, message, replyTo }) => {
        const from = socket.username;
        if (!from) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        db.query("INSERT INTO private_messages(sender, receiver, message, reply_to) VALUES(?,?,?,?)",
            [from, to, message, replyJson], (err) => {
                if (err) console.log(err);
            });

        const receiverSocketId = users[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("privateMessage", { from, message, replyTo });
        }
        socket.emit("privateMessage", { from, message, replyTo });
    });

    socket.on("typing", (user) => socket.broadcast.emit("typing", user));
    socket.on("stopTyping", () => socket.broadcast.emit("stopTyping"));

    socket.on("disconnect", () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit("users", Object.keys(users));
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));