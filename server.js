require("dotenv").config(); // ✅ must be FIRST line

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const bodyParser = require("body-parser");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);
const db = require("./db"); // ✅ import db connection

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ Store sessions in MySQL
const sessionStore = new MySQLStore({}, db);

app.use(session({
    secret: "chat_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// REGISTER — unchanged
app.post("/register", (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.send("All fields are required");
    }

    const sql = "INSERT INTO users(username,email,password) VALUES(?,?,?)";
    db.query(sql, [username, email, password], (err) => {
        if (err) {
            console.error("Register error:", err.message);
            if (err.code === "ER_DUP_ENTRY") {
                return res.send("Email already exists");
            }
            return res.send("Registration failed: " + err.message); // ✅ shows real error
        }
        res.redirect("/login.html");
    });
});

// LOGIN — unchanged
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    const sql = "SELECT * FROM users WHERE email=? AND password=?";
    db.query(sql, [email, password], (err, result) => {
        if (result.length > 0) {
            req.session.username = result[0].username;
            req.session.save(() => {
                res.redirect("/chat.html");
            });
        } else {
            res.send("Invalid login");
        }
    });
});

// GET CURRENT USERNAME — unchanged
app.get("/username", (req, res) => {
    res.json({ username: req.session.username || null });
});

// GET ALL REGISTERED USERS — unchanged
app.get("/all-users", (req, res) => {
    db.query("SELECT username FROM users", (err, result) => {
        if (err) return res.send([]);
        res.json(result);
    });
});

// GET PRIVATE MESSAGE HISTORY — unchanged (SELECT * already returns image_data, image_type once columns exist)
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

    // unchanged — SELECT * already picks up image_data + image_type once columns exist
    socket.on("join", (username) => {
        socket.username = username;
        users[username] = socket.id;
        io.emit("users", Object.keys(users));

        // Load group messages
        db.query("SELECT * FROM messages ORDER BY timestamp ASC LIMIT 50", (err, results) => {
            if (err) console.log(err);
            else socket.emit("previousMessages", results);
        });
    });

    // ── CHANGED: destructure imageData + imageType from the event ──
    socket.on("message", ({ text, replyTo, imageData, imageType }) => {
        const user = socket.username;
        if (!user) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;

        // CHANGED: extract image fields (null when no image sent)
        const imgData = imageData || null;
        const imgType = imageType || null;

        // CHANGED: INSERT now includes image_data and image_type columns
        db.query(
            "INSERT INTO messages(user, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?)",
            [user, text || "", replyJson, imgData, imgType],
            (err) => { if (err) console.log(err); }
        );

        // CHANGED: broadcast now includes imageData + imageType so clients can render the image
        io.emit("message", { user, text, replyTo, imageData, imageType });
    });

    // ── CHANGED: destructure imageData + imageType from the event ──
    socket.on("privateMessage", ({ to, message, replyTo, imageData, imageType }) => {
        const from = socket.username;
        if (!from) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;

        // CHANGED: extract image fields (null when no image sent)
        const imgData = imageData || null;
        const imgType = imageType || null;

        // CHANGED: INSERT now includes image_data and image_type columns
        db.query(
            "INSERT INTO private_messages(sender, receiver, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?,?)",
            [from, to, message || "", replyJson, imgData, imgType],
            (err) => { if (err) console.log(err); }
        );

        const receiverSocketId = users[to];

        // CHANGED: emit to receiver now includes imageData + imageType
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("privateMessage", { from, message, replyTo, imageData, imageType });
        }

        // CHANGED: echo back to sender also includes imageData + imageType
        socket.emit("privateMessage", { from, message, replyTo, imageData, imageType });
    });

    // ✅ Typing indicators — unchanged
    socket.on("typing", (user) => {
        socket.broadcast.emit("typing", user);
    });

    socket.on("stopTyping", () => {
        socket.broadcast.emit("stopTyping");
    });

    socket.on("disconnect", () => {
        if (socket.username) {
            delete users[socket.username];
            io.emit("users", Object.keys(users));
        }
    });
});

const PORT = process.env.PORT || 3000; // ✅ use env PORT too
server.listen(PORT, () => console.log("Server running on port " + PORT));