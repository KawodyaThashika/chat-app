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

let users = {};

io.on("connection", (socket) => {

    socket.on("join", (username) => {
        socket.username = username;
        users[username] = socket.id;
        io.emit("users", Object.keys(users));

        db.query("SELECT * FROM messages ORDER BY timestamp ASC LIMIT 50", (err, results) => {
            if (err) console.log(err);
            else socket.emit("previousMessages", results);
        });
    });

    socket.on("message", (msg) => {
        const user = socket.username;
        if (!user) return;

        db.query("INSERT INTO messages(user, message) VALUES(?,?)", [user, msg], (err) => {
            if (err) console.log(err);
        });

        io.emit("message", { user, text: msg });
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