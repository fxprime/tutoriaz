const express = require('express');
const serverless = require('serverless-http');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Import your existing server logic
const app = express();

// Configuration for Netlify
const BASE_URL = process.env.BASE_URL || process.env.URL || 'http://localhost:8888';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Database path - Netlify จะ mount ที่ /tmp
const DB_PATH = process.env.NODE_ENV === 'production' 
    ? '/tmp/database.sqlite' 
    : path.join(__dirname, '../../database.sqlite');

// สร้าง database connection
const db = new sqlite3.Database(DB_PATH);

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? [BASE_URL, 'https://tutoriaz-app.netlify.app'] 
        : true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, '../../public')));
app.use('/docs', express.static(path.join(__dirname, '../../courses')));

// JWT authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
}

// Initialize database
function initializeDatabase() {
    db.serialize(() => {
        // Create tables if they don't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
                created_at TEXT NOT NULL
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                access_code_hash TEXT,
                docs_repo_url TEXT,
                docs_branch TEXT DEFAULT 'main',
                docs_path TEXT,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        `);

        // Insert default users if they don't exist
        const teacherHash = bcrypt.hashSync('admin123', 10);
        const studentHash = bcrypt.hashSync('student123', 10);

        db.run(`INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`, 
                [uuidv4(), 'teacher', 'Teacher', teacherHash, 'teacher', new Date().toISOString()]);

        db.run(`INSERT OR IGNORE INTO users (id, username, display_name, password_hash, role, created_at) 
                VALUES (?, ?, ?, ?, ?, ?)`, 
                [uuidv4(), 'student1', 'Student 1', studentHash, 'student', new Date().toISOString()]);
    });
}

// API Routes
app.get('/api/config', (req, res) => {
    res.json({
        baseUrl: BASE_URL,
        environment: process.env.NODE_ENV || 'development'
    });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ error: 'Internal server error' });
        }

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = jwt.sign(
            { 
                userId: user.id, 
                username: user.username, 
                role: user.role,
                displayName: user.display_name 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                displayName: user.display_name,
                role: user.role
            }
        });
    });
});

app.get('/api/me', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

// Initialize database on startup
initializeDatabase();

// Handle Netlify Functions
if (process.env.NODE_ENV === 'production') {
    module.exports.handler = serverless(app);
} else {
    // Local development
    const PORT = process.env.PORT || 8888;
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}