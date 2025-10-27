#!/bin/bash

echo "🚀 Starting Netlify build for Tutoriaz..."

# สร้าง directory สำหรับ production files
mkdir -p dist

# Copy static files
echo "📁 Copying static files..."
cp -r public/* dist/ 2>/dev/null || echo "No public files to copy"
cp -r courses dist/docs 2>/dev/null || echo "No course docs to copy"

# สร้าง database ใน /tmp สำหรับ Netlify
echo "🗄️ Initializing database..."
if [ ! -f database.sqlite ]; then
    echo "Creating new database..."
    node -e "
    const sqlite3 = require('sqlite3').verbose();
    const bcrypt = require('bcryptjs');
    const { v4: uuidv4 } = require('uuid');
    
    const db = new sqlite3.Database('database.sqlite');
    
    db.serialize(() => {
        // Create tables
        db.run(\`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('teacher', 'student')),
            created_at TEXT NOT NULL
        )\`);
        
        db.run(\`CREATE TABLE IF NOT EXISTS courses (
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
        )\`);
        
        // Insert default users
        const teacherHash = bcrypt.hashSync('admin123', 10);
        const studentHash = bcrypt.hashSync('student123', 10);
        
        db.run(\`INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?)\`, 
            [uuidv4(), 'teacher', 'Teacher', teacherHash, 'teacher', new Date().toISOString()]);
        
        db.run(\`INSERT OR IGNORE INTO users VALUES (?, ?, ?, ?, ?, ?)\`, 
            [uuidv4(), 'student1', 'Student 1', studentHash, 'student', new Date().toISOString()]);
    });
    
    db.close(() => console.log('Database initialized'));
    "
fi

echo "✅ Build completed successfully!"