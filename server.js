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
// NEW: increased limit to 20mb to handle base64 image data in /save-message requests
app.use(express.json({ limit: "20mb" }));

// ✅ Store sessions in MySQL
const sessionStore = new MySQLStore({}, db);

app.use(session({
    secret: "chat_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// REGISTER
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

// LOGIN
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

// GET CURRENT USERNAME
app.get("/username", (req, res) => {
    res.json({ username: req.session.username || null });
});

// GET ALL REGISTERED USERS
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

        // Load group messages
        db.query("SELECT * FROM messages ORDER BY timestamp ASC LIMIT 50", (err, results) => {
            if (err) console.log(err);
            else socket.emit("previousMessages", results);
        });
    });

    // group message
    socket.on("message", ({ text, replyTo, imageData, imageType }) => {
        const user = socket.username;
        if (!user) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        const imgData = imageData || null;
        const imgType = imageType || null;
        db.query("INSERT INTO messages(user, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?)",
            [user, text || "", replyJson, imgData, imgType], (err, result) => {
            if (err) { console.log(err); return; }
            // CHANGED: include the new row's id so clients can reference it for deletion
            const msgId = result.insertId;
            io.emit("message", { id: msgId, user, text, replyTo, imageData, imageType });
        });
    });

    // private message
    socket.on("privateMessage", ({ to, message, replyTo, imageData, imageType }) => {
        const from = socket.username;
        if (!from) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        const imgData = imageData || null;
        const imgType = imageType || null;
        db.query("INSERT INTO private_messages(sender, receiver, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?,?)",
            [from, to, message || "", replyJson, imgData, imgType], (err, result) => {
                if (err) { console.log(err); return; }
                // CHANGED: include the new row's id so clients can reference it for deletion
                const msgId = result.insertId;
                const receiverSocketId = users[to];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("privateMessage", { id: msgId, from, message, replyTo, imageData, imageType });
                }
                socket.emit("privateMessage", { id: msgId, from, message, replyTo, imageData, imageType });
            });
    });

    // ✅ Typing indicators
    socket.on("typing", (user) => {
        socket.broadcast.emit("typing", user);
    });

    socket.on("stopTyping", () => {
        socket.broadcast.emit("stopTyping");
    });

    // NEW: Delete a group message for everyone (only the sender can do this)
    socket.on("deleteMessage", ({ id }) => {
        const user = socket.username;
        if (!user) return;
        // Only delete if the requesting user is the original sender
        db.query("DELETE FROM messages WHERE id=? AND user=?", [id, user], (err, result) => {
            if (err || result.affectedRows === 0) return;
            // Broadcast to all clients to remove this message from their UI
            io.emit("messageDeleted", { id });
        });
    });

    // NEW: Delete a private message for everyone (only the sender can do this)
    socket.on("deletePrivateMessage", ({ id, to }) => {
        const user = socket.username;
        if (!user) return;
        db.query("DELETE FROM private_messages WHERE id=? AND sender=?", [id, user], (err, result) => {
            if (err || result.affectedRows === 0) return;
            // Notify sender and receiver to remove the message
            socket.emit("privateMessageDeleted", { id });
            const receiverSocketId = users[to];
            if (receiverSocketId) {
                io.to(receiverSocketId).emit("privateMessageDeleted", { id });
            }
        });
    });

    // ── EMOJI REACTIONS ─────────────────────────────────────────────────────
    // In-memory store: { msgId: { emoji: Set<username> } }
    // (A real app would persist to DB; this keeps it simple)
    socket.on("react", ({ msgId, emoji, chatType, to }) => {
        if (!msgId || !emoji) return;
        const user = socket.username;
        if (!user) return;

        if (!io._reactions) io._reactions = {};
        if (!io._reactions[msgId]) io._reactions[msgId] = {};
        if (!io._reactions[msgId][emoji]) io._reactions[msgId][emoji] = new Set();

        const set = io._reactions[msgId][emoji];
        // Toggle: if already reacted, remove; otherwise add
        if (set.has(user)) {
            set.delete(user);
        } else {
            set.add(user);
        }

        // Build a plain object to send: { emoji: [usernames] }
        const reactionMap = {};
        Object.entries(io._reactions[msgId]).forEach(([em, usersSet]) => {
            if (usersSet.size > 0) reactionMap[em] = [...usersSet];
        });

        // Broadcast to everyone (group) or both parties (private)
        if (chatType === "private" && to) {
            const toSocketId = users[to];
            socket.emit("reactionUpdate", { msgId, reactionMap });
            if (toSocketId) io.to(toSocketId).emit("reactionUpdate", { msgId, reactionMap });
        } else {
            io.emit("reactionUpdate", { msgId, reactionMap });
        }
    });


    // ── EDIT MESSAGE ──────────────────────────────────────────────────────────
    const EDIT_LIMIT_MS = 30 * 60 * 1000; // 30 minutes

    socket.on("editMessage", ({ id, newText, chatType, to }) => {
        const user = socket.username;
        if (!user || !id || !newText) return;

        if (chatType === "private") {
            // Check timestamp and sender for private messages
            db.query("SELECT sender, timestamp FROM private_messages WHERE id=?", [id], (err, rows) => {
                if (err || rows.length === 0) return;
                const row = rows[0];
                if (row.sender !== user) return;
                const age = Date.now() - new Date(row.timestamp).getTime();
                if (age > EDIT_LIMIT_MS) {
                    socket.emit("editError", { message: "Cannot edit — 30 minute limit exceeded" });
                    return;
                }
                db.query("UPDATE private_messages SET message=? WHERE id=?", [newText, id], (err2) => {
                    if (err2) return;
                    socket.emit("messageEdited", { id, newText });
                    const toSocketId = users[to];
                    if (toSocketId) io.to(toSocketId).emit("messageEdited", { id, newText });
                });
            });
        } else {
            // Group message
            db.query("SELECT user, timestamp FROM messages WHERE id=?", [id], (err, rows) => {
                if (err || rows.length === 0) return;
                const row = rows[0];
                if (row.user !== user) return;
                const age = Date.now() - new Date(row.timestamp).getTime();
                if (age > EDIT_LIMIT_MS) {
                    socket.emit("editError", { message: "Cannot edit — 30 minute limit exceeded" });
                    return;
                }
                db.query("UPDATE messages SET message=? WHERE id=?", [newText, id], (err2) => {
                    if (err2) return;
                    io.emit("messageEdited", { id, newText });
                });
            });
        }
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
// ── NEW: Save a message to the user's personal saved messages ──
app.post("/save-message", (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: "Not logged in" });
    const owner = req.session.username;
    const { original_user, message, image_data, image_type, source_chat } = req.body;
    db.query(
        "INSERT INTO saved_messages(owner, original_user, message, image_data, image_type, source_chat) VALUES(?,?,?,?,?,?)",
        [owner, original_user, message || "", image_data || null, image_type || null, source_chat || ""],
        (err) => {
            if (err) { console.log(err); return res.status(500).json({ error: "Failed" }); }
            res.json({ ok: true });
        }
    );
});

// ── NEW: Get the user's saved messages ──
app.get("/saved-messages", (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: "Not logged in" });
    const owner = req.session.username;
    db.query(
        "SELECT * FROM saved_messages WHERE owner=? ORDER BY saved_at ASC",
        [owner],
        (err, result) => {
            if (err) return res.json([]);
            res.json(result);
        }
    );
});

// ── NEW: Delete a saved message ──
app.delete("/saved-messages/:id", (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: "Not logged in" });
    const owner = req.session.username;
    db.query(
        "DELETE FROM saved_messages WHERE id=? AND owner=?",
        [req.params.id, owner],
        (err) => {
            if (err) return res.status(500).json({ error: "Failed" });
            res.json({ ok: true });
        }
    );
});