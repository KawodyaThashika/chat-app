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

// ✅ Required for Railway/Heroku HTTPS — trust the reverse proxy
app.set("trust proxy", 1);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json({ limit: "20mb" }));

const sessionStore = new MySQLStore({}, db);

app.use(session({
    secret: "chat_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        secure: process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT !== undefined,
        sameSite: "lax"
    }
}));

// ── Auto-add profile columns ──
db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar LONGTEXT DEFAULT NULL", (err) => {
    if (err && err.code !== "ER_DUP_FIELDNAME") console.log("avatar column:", err.message);
});
db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(200) DEFAULT ''", (err) => {
    if (err && err.code !== "ER_DUP_FIELDNAME") console.log("bio column:", err.message);
});
db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS user_status VARCHAR(20) DEFAULT 'online'", (err) => {
    if (err && err.code !== "ER_DUP_FIELDNAME") console.log("user_status column:", err.message);
});
// Increase packet size for large avatar base64 data
// Note: max_allowed_packet managed by Railway MySQL

// REGISTER
app.post("/register", (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.send("All fields are required");
    db.query("INSERT INTO users(username,email,password) VALUES(?,?,?)", [username, email, password], (err) => {
        if (err) {
            if (err.code === "ER_DUP_ENTRY") return res.send("Email already exists");
            return res.send("Registration failed: " + err.message);
        }
        res.redirect("/login.html");
    });
});

// LOGIN
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    db.query("SELECT * FROM users WHERE email=? AND password=?", [email, password], (err, result) => {
        if (result && result.length > 0) {
            req.session.username = result[0].username;
            req.session.save(() => res.redirect("/chat.html"));
        } else {
            res.send("Invalid login");
        }
    });
});

// GET USERNAME
app.get("/username", (req, res) => {
    res.json({ username: req.session.username || null });
});

// GET ALL USERS
app.get("/all-users", (req, res) => {
    db.query("SELECT username FROM users", (err, result) => {
        if (err) return res.json([]);
        res.json(result);
    });
});

// ── GET my profile ──
app.get("/profile/me", (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: "Not logged in" });
    // Use COALESCE so query works even if columns don't exist yet
    db.query("SELECT username, COALESCE(avatar, NULL) as avatar, COALESCE(bio, '') as bio, COALESCE(user_status, 'online') as user_status FROM users WHERE username=?",
        [req.session.username], (err, rows) => {
            if (err) {
                // Columns might not exist yet — return basic profile
                db.query("SELECT username FROM users WHERE username=?", [req.session.username], (err2, rows2) => {
                    if (err2 || !rows2 || rows2.length === 0) return res.json({});
                    res.json({ username: rows2[0].username, avatar: null, bio: "", user_status: "online" });
                });
                return;
            }
            if (!rows || rows.length === 0) return res.json({});
            res.json(rows[0]);
        });
});

// ── GET all users with profiles ──
app.get("/all-users-with-profiles", (req, res) => {
    db.query("SELECT username, COALESCE(avatar, NULL) as avatar, COALESCE(bio, '') as bio, COALESCE(user_status, 'online') as user_status FROM users", (err, result) => {
        if (err) {
            // Fall back to just usernames if profile columns missing
            db.query("SELECT username FROM users", (err2, rows) => {
                if (err2) return res.json([]);
                res.json(rows.map(r => ({ username: r.username, avatar: null, bio: "", user_status: "online" })));
            });
            return;
        }
        res.json(result);
    });
});

// ── GET single user profile ──
app.get("/profile/:username", (req, res) => {
    db.query("SELECT username, COALESCE(avatar, NULL) as avatar, COALESCE(bio, '') as bio, COALESCE(user_status, 'online') as user_status FROM users WHERE username=?",
        [req.params.username], (err, rows) => {
            if (err || !rows || rows.length === 0) return res.json({});
            res.json(rows[0]);
        });
});

// ── SAVE profile ──
app.post("/profile/save", (req, res) => {
    if (!req.session.username) {
        return res.status(401).json({ error: "Not logged in — please refresh the page" });
    }
    const { bio, status, avatar } = req.body;
    const safeStatus = ["online","busy","away","invisible"].includes(status) ? status : "online";
    const safeBio = (bio || "").slice(0, 200);
    let safeAvatar = avatar || null;
    if (safeAvatar && safeAvatar.length > 700000) safeAvatar = null;
    const user = req.session.username;

    // Ensure columns exist first, then update
    const addCols = [
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(200) DEFAULT ''`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS user_status VARCHAR(20) DEFAULT 'online'`,
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar LONGTEXT DEFAULT NULL`
    ];

    let done = 0;
    const afterCols = () => {
        done++;
        if (done < addCols.length) return;
        // All columns ensured — now save
        db.query("UPDATE users SET bio=?, user_status=?, avatar=? WHERE username=?",
            [safeBio, safeStatus, safeAvatar, user],
            (err) => {
                if (err) {
                    console.error("Profile save error:", err.message);
                    return res.status(500).json({ error: err.message });
                }
                res.json({ ok: true, avatarSaved: !!safeAvatar });
            });
    };

    addCols.forEach(sql => db.query(sql, () => afterCols()));
});

// PRIVATE MESSAGES
app.get("/private-messages/:user1/:user2", (req, res) => {
    const { user1, user2 } = req.params;
    const sql = `SELECT * FROM private_messages
                 WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)
                 ORDER BY timestamp ASC LIMIT 50`;
    db.query(sql, [user1, user2, user2, user1], (err, result) => {
        if (err) return res.json([]);
        res.json(result);
    });
});

// SAVE MESSAGE
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

// GET SAVED MESSAGES
app.get("/saved-messages", (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: "Not logged in" });
    db.query("SELECT * FROM saved_messages WHERE owner=? ORDER BY saved_at ASC",
        [req.session.username], (err, result) => {
            if (err) return res.json([]);
            res.json(result);
        });
});

// DELETE SAVED MESSAGE
app.delete("/saved-messages/:id", (req, res) => {
    if (!req.session.username) return res.status(401).json({ error: "Not logged in" });
    db.query("DELETE FROM saved_messages WHERE id=? AND owner=?",
        [req.params.id, req.session.username], (err) => {
            if (err) return res.status(500).json({ error: "Failed" });
            res.json({ ok: true });
        });
});

// ── SOCKET.IO ──
let users = {};

io.on("connection", (socket) => {

    socket.on("join", (username) => {
        socket.username = username;
        users[username] = socket.id;
        io.emit("users", Object.keys(users));
        db.query("SELECT * FROM messages ORDER BY timestamp ASC LIMIT 50", (err, results) => {
            if (!err) socket.emit("previousMessages", results);
        });
    });

    socket.on("message", ({ text, replyTo, imageData, imageType }) => {
        const user = socket.username;
        if (!user) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        db.query("INSERT INTO messages(user, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?)",
            [user, text || "", replyJson, imageData || null, imageType || null], (err, result) => {
                if (err) return;
                io.emit("message", { id: result.insertId, user, text, replyTo, imageData, imageType });
            });
    });

    socket.on("privateMessage", ({ to, message, replyTo, imageData, imageType }) => {
        const from = socket.username;
        if (!from) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        db.query("INSERT INTO private_messages(sender, receiver, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?,?)",
            [from, to, message || "", replyJson, imageData || null, imageType || null], (err, result) => {
                if (err) return;
                const msgId = result.insertId;
                const receiverSocketId = users[to];
                if (receiverSocketId) {
                    io.to(receiverSocketId).emit("privateMessage", { id: msgId, from, message, replyTo, imageData, imageType });
                }
                socket.emit("privateMessage", { id: msgId, from, message, replyTo, imageData, imageType });
            });
    });

    socket.on("typing", (user) => { socket.broadcast.emit("typing", user); });
    socket.on("stopTyping", () => { socket.broadcast.emit("stopTyping"); });

    socket.on("deleteMessage", ({ id }) => {
        const user = socket.username;
        if (!user) return;
        db.query("DELETE FROM messages WHERE id=? AND user=?", [id, user], (err, result) => {
            if (err || result.affectedRows === 0) return;
            io.emit("messageDeleted", { id });
        });
    });

    socket.on("deletePrivateMessage", ({ id, to }) => {
        const user = socket.username;
        if (!user) return;
        db.query("DELETE FROM private_messages WHERE id=? AND sender=?", [id, user], (err, result) => {
            if (err || result.affectedRows === 0) return;
            socket.emit("privateMessageDeleted", { id });
            const receiverSocketId = users[to];
            if (receiverSocketId) io.to(receiverSocketId).emit("privateMessageDeleted", { id });
        });
    });

    socket.on("react", ({ msgId, emoji, chatType, to }) => {
        if (!msgId || !emoji) return;
        const user = socket.username;
        if (!user) return;
        if (!io._reactions) io._reactions = {};
        if (!io._reactions[msgId]) io._reactions[msgId] = {};
        if (!io._reactions[msgId][emoji]) io._reactions[msgId][emoji] = new Set();
        const set = io._reactions[msgId][emoji];
        if (set.has(user)) set.delete(user); else set.add(user);
        const reactionMap = {};
        Object.entries(io._reactions[msgId]).forEach(([em, usersSet]) => {
            if (usersSet.size > 0) reactionMap[em] = [...usersSet];
        });
        if (chatType === "private" && to) {
            const toSocketId = users[to];
            socket.emit("reactionUpdate", { msgId, reactionMap });
            if (toSocketId) io.to(toSocketId).emit("reactionUpdate", { msgId, reactionMap });
        } else {
            io.emit("reactionUpdate", { msgId, reactionMap });
        }
    });

    socket.on("editMessage", ({ id, newText, chatType, to }) => {
        const user = socket.username;
        if (!user || !id || !newText) return;
        const EDIT_LIMIT_MS = 30 * 60 * 1000;
        if (chatType === "private") {
            db.query("SELECT sender, timestamp FROM private_messages WHERE id=?", [id], (err, rows) => {
                if (err || !rows || rows.length === 0) return;
                if (rows[0].sender !== user) return;
                if (Date.now() - new Date(rows[0].timestamp).getTime() > EDIT_LIMIT_MS) {
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
            db.query("SELECT user, timestamp FROM messages WHERE id=?", [id], (err, rows) => {
                if (err || !rows || rows.length === 0) return;
                if (rows[0].user !== user) return;
                if (Date.now() - new Date(rows[0].timestamp).getTime() > EDIT_LIMIT_MS) {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));