const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));

// MySQL Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "root",
    database: "chat_app"
});

db.connect(err => {
    if (err) throw err;
    console.log("MySQL Connected");
});

// ✅ Store sessions in MySQL so they survive refresh/restart
const sessionStore = new MySQLStore({}, db);

app.use(session({
    secret: "chat_secret",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,         // ✅ persist to DB
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}));

// REGISTER
app.post("/register", (req, res) => {
    const { username, email, password } = req.body;
    const sql = "INSERT INTO users(username,email,password) VALUES(?,?,?)";
    db.query(sql, [username, email, password], (err) => {
        if (err) return res.send("Email already exists");
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
            req.session.save(() => {          // ✅ force save before redirect
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

// ✅ Online users tracked by username (not socket.id) so refresh re-adds them
let users = {};

io.on("connection", (socket) => {

    socket.on("join", (username) => {
        socket.username = username;           // ✅ store on socket object
        users[username] = socket.id;          // ✅ keyed by username, not socket.id

        io.emit("users", Object.keys(users)); // ✅ send usernames

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
            delete users[socket.username];    // ✅ remove by username
            io.emit("users", Object.keys(users));
        }
    });
});

const PORT = 3000;
server.listen(PORT, () => console.log("Server running on port " + PORT));