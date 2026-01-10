#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Load .env file if it exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            const value = valueParts.join('=');
            if (key && value && !process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', '012_add_docs_paths.sql');

console.log('Running migration: 012_add_docs_paths.sql');
console.log('Database path:', DB_PATH);

const db = new sqlite3.Database(DB_PATH);

const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');

db.serialize(() => {
    // Split by semicolon to handle multiple statements
    const statements = migrationSQL.split(';').filter(s => s.trim());
    
    statements.forEach(statement => {
        const trimmed = statement.trim();
        if (trimmed) {
            db.run(trimmed, (err) => {
                if (err) {
                    // Ignore "duplicate column" errors
                    if (err.message.includes('duplicate column')) {
                        console.log('Column already exists, skipping...');
                    } else {
                        console.error('Migration error:', err.message);
                    }
                } else {
                    console.log('✓ Statement executed successfully');
                }
            });
        }
    });
});

db.close((err) => {
    if (err) {
        console.error('Error closing database:', err.message);
        process.exit(1);
    }
    console.log('Migration completed!');
});
