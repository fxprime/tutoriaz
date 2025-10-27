const serverless = require('serverless-http');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();

// Configuration
const BASE_URL = process.env.BASE_URL || process.env.URL || 'http://localhost:8888';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Database setup for Netlify
let db;
function initDB() {
    if (!db) {
        // Try to use pre-built database first, then fallback to temp
        const preBuiltDB = path.join(__dirname, 'database.sqlite');
        const tempDB = '/tmp/database.sqlite';
        
        let dbPath = tempDB;
        
        // Copy pre-built database to temp if it exists
        if (fs.existsSync(preBuiltDB)) {
            console.log('Using pre-built database');
            fs.copyFileSync(preBuiltDB, tempDB);
            dbPath = tempDB;
        } else {
            console.log('Creating new database at runtime');
            dbPath = tempDB;
        }
        
        db = new sqlite3.Database(dbPath);
        
        // Create tables if they don't exist (fallback)
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                display_name TEXT,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
                created_at TEXT NOT NULL
            )`);
            
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
            
            // Only insert if no users exist (for runtime fallback)
            db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
                if (!err && row.count === 0) {
                    console.log('No users found, creating default users');
                    const teacherHash = bcrypt.hashSync('admin123', 10);
                    const studentHash = bcrypt.hashSync('student123', 10);
                    
                    db.run(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)`, 
                        ['teacher-id', 'teacher', 'Teacher', teacherHash, 'teacher', new Date().toISOString()]);
                    
                    db.run(`INSERT INTO users VALUES (?, ?, ?, ?, ?, ?)`, 
                        ['student-id', 'student1', 'Student 1', studentHash, 'student', new Date().toISOString()]);
                    
                    // Insert ESP32 course
                    db.run(`INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                        ['esp32-course', 'ESP32 Fundamentals', 'Learn ESP32 basics', 'teacher-id', 
                         new Date().toISOString(), null, `${BASE_URL}/docs/esp32_basic/site/`, 'main', '']);
                }
            });
        });
    }
    return db;
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
    const db = initDB();
    
    if (req.user.role === 'teacher') {
        db.all(`
            SELECT c.*,
                   COUNT(DISTINCT ce.student_id) as enrollment_count
            FROM courses c
            LEFT JOIN course_enrollments ce ON c.id = ce.course_id
            WHERE c.created_by = ?
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `, [req.user.userId], (err, courses) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ courses: courses || [] });
        });
    } else if (req.user.role === 'student') {
        db.all(`
            SELECT c.*,
                   u.username as teacher_username,
                   u.display_name as teacher_display_name,
                   CASE WHEN ce.id IS NOT NULL THEN 1 ELSE 0 END as is_enrolled
            FROM courses c
            LEFT JOIN users u ON c.created_by = u.id
            LEFT JOIN course_enrollments ce ON c.id = ce.course_id AND ce.student_id = ?
            ORDER BY c.created_at DESC
        `, [req.user.userId], (err, courses) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            const normalized = courses.map(course => ({
                ...course,
                is_enrolled: Boolean(course.is_enrolled),
                teacher_display_name: course.teacher_display_name || course.teacher_username,
                teacher_username: course.teacher_username
            }));
            
            res.json({ courses: normalized });
        });
    } else {
        res.status(403).json({ error: 'Invalid role' });
    }
});

// Export for Netlify Functions
exports.handler = serverless(app);