# 💬 Chat App

A real-time chat application built with **Node.js**, **Express**, **Socket.IO**, and **MySQL**. Supports group chat, private messaging, image sharing, user profiles, message reactions, and a dark/light theme toggle.

## ✨ Features

- 🔐 **User authentication** — register and login with session-based auth
- 👥 **Group chat** — real-time messaging with everyone online
- 🔒 **Private chat** — one-on-one direct messages
- 📌 **Saved messages** — bookmark any message for later
- 🖼️ **Image sharing** — send images directly in chat
- 😊 **Emoji reactions** — react to any message
- ✏️ **Edit & delete messages** — edit within a 30-minute window, delete anytime
- ↩️ **Reply to messages** — quote and reply inline
- 🟢 **Live presence** — online/offline status and typing indicators
- 🙍 **User profiles** — custom avatar, bio, and status (online/busy/away/invisible)
- 🌗 **Dark / Light theme** — toggle with persistence across sessions
- 📱 **Responsive design** — works on both desktop and mobile

## 🛠️ Tech Stack

| Layer      | Technology                                   |
|------------|-----------------------------------------------|
| Backend    | Node.js, Express 5                            |
| Real-time  | Socket.IO                                     |
| Database   | MySQL (via `mysql2`)                          |
| Sessions   | `express-session` + `express-mysql-session`   |
| Frontend   | HTML, CSS, Vanilla JavaScript                 |

## 📋 Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- [MySQL](https://dev.mysql.com/downloads/) server (local or remote)

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/chat-app.git
cd chat-app
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up the database

Create a MySQL database and run the schema in `db.txt`:

```bash
mysql -u root -p -e "CREATE DATABASE chat_app;"
mysql -u root -p chat_app < db.txt
```

### 4. Configure environment variables

Create a `.env` file in the project root:

```env
PORT=5001

DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=chat_app
DB_PORT=3306
```

> ⚠️ Never commit your real `.env` file — it's already listed in `.gitignore`.

### 5. Run the app

```bash
npm run dev     # with nodemon (auto-restart on changes)
# or
npm start       # plain node
```

The app will be available at **http://localhost:5001**.

## 📁 Project Structure

```
chat-app/
├── public/
│   ├── index.html          # Redirects to registration
│   ├── login.html           # Login page
│   ├── register.html        # Registration page
│   ├── chat.html             # Main chat interface
│   ├── client.js              # Frontend logic (Socket.IO client)
│   └── style.css               # Styling (dark/light themes)
├── db.js                    # MySQL connection
├── db.txt                   # Database schema
├── server.js                # Express server + Socket.IO events
├── package.json
└── .env                      # Environment variables (not committed)
```

## 🗄️ Database Schema

The app uses four tables:

- **`users`** — accounts, profile info (bio, avatar, status)
- **`messages`** — group chat messages
- **`private_messages`** — one-on-one messages
- **`saved_messages`** — messages bookmarked by users

Full schema available in [`db.txt`](./db.txt).

## 📝 License

This project is licensed under the ISC License.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome. Feel free to open a pull request or an issue.
