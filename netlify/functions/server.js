const serverless = require('serverless-http');

// Import the existing Express app
// Since we can't directly import the server.js due to it starting a server,
// we'll create a simplified version for Netlify Functions

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();

// Configuration
const BASE_URL = process.env.BASE_URL || process.env.URL || 'http://localhost:8888';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Database path for Netlify (temporary storage)
const DB_PATH = '/tmp/database.sqlite';

// Initialize database
let db;
function initDB() {
    if (!db) {
        db = new sqlite3.Database(DB_PATH);
        
        db.serialize(() => {
            // Create users table
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
                created_at TEXT NOT NULL
            )`);
            
            // Create courses table
            db.run(`CREATE TABLE IF NOT EXISTS courses (
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
            )`);
            
            // Insert default users
            const teacherHash = bcrypt.hashSync('admin123', 10);
            const studentHash = bcrypt.hashSync('student123', 10);
            
            db.run(`INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?)`, 
                ['teacher-id', 'teacher', 'Teacher', teacherHash, 'teacher', new Date().toISOString()]);
            
            db.run(`INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?)`, 
                ['student-id', 'student1', 'Student 1', studentHash, 'student', new Date().toISOString()]);
            
            // Insert ESP32 course
            db.run(`INSERT OR IGNORE INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                ['esp32-course', 'ESP32 Fundamentals', 'Learn ESP32 basics', 'teacher-id', 
                 new Date().toISOString(), null, `${BASE_URL}/docs/esp32_basic/site/`, 'main', '']);
        });
    }
}

// Middleware
app.use(cors());
app.use(express.json());

// JWT middleware
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

// Routes
app.get('/api/config', (req, res) => {
    res.json({
        baseUrl: BASE_URL,
        environment: process.env.NODE_ENV || 'development'
    });
});

app.post('/api/login', (req, res) => {
    initDB();
    
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

app.get('/api/courses', authenticateToken, (req, res) => {
    initDB();
    
    db.all('SELECT * FROM courses', (err, courses) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ courses });
    });
});

// Export for Netlify Functions
exports.handler = serverless(app);