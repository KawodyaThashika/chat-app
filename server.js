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
app.use(express.json()); // NEW: needed to parse JSON body for /save-message

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
        // imageData is base64 string, imageType is mime type e.g. "image/png"
        const imgData = imageData || null;
        const imgType = imageType || null;
        db.query("INSERT INTO messages(user, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?)",
            [user, text || "", replyJson, imgData, imgType], (err) => {
            if (err) console.log(err);
        });
        io.emit("message", { user, text, replyTo, imageData, imageType });
    });

    // private message
    socket.on("privateMessage", ({ to, message, replyTo, imageData, imageType }) => {
        const from = socket.username;
        if (!from) return;
        const replyJson = replyTo ? JSON.stringify(replyTo) : null;
        const imgData = imageData || null;
        const imgType = imageType || null;
        db.query("INSERT INTO private_messages(sender, receiver, message, reply_to, image_data, image_type) VALUES(?,?,?,?,?,?)",
            [from, to, message || "", replyJson, imgData, imgType], (err) => {
                if (err) console.log(err);
            });

        const receiverSocketId = users[to];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("privateMessage", { from, message, replyTo, imageData, imageType });
        }
        socket.emit("privateMessage", { from, message, replyTo, imageData, imageType });
    });

    // ✅ Typing indicators
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