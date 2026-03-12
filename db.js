require("dotenv").config();
const mysql = require("mysql2");

const db = mysql.createConnection(process.env.DATABASE_URL || {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
});

db.connect(err => {
    if (err) {
        console.error("DB Connection Failed:", err.message);
        process.exit(1);
    }
    console.log("MySQL Connected");
});

module.exports = db;