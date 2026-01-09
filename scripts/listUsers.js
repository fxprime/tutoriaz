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
const db = new sqlite3.Database(DB_PATH);

function all(dbInstance, sql, params = []) {
    return new Promise((resolve, reject) => {
        dbInstance.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
}

async function main() {
    try {
        const users = await all(db, 'SELECT username, display_name, role, created_at FROM users ORDER BY role, username');
        
        if (!users || users.length === 0) {
            console.log('No users found in database.');
            return;
        }

        console.log('\nUsers in database:\n');
        console.log('USERNAME'.padEnd(20), 'DISPLAY NAME'.padEnd(25), 'ROLE'.padEnd(10), 'CREATED');
        console.log('─'.repeat(80));

        users.forEach(user => {
            const createdDate = new Date(user.created_at).toLocaleDateString();
            console.log(
                user.username.padEnd(20),
                (user.display_name || '').padEnd(25),
                user.role.padEnd(10),
                createdDate
            );
        });

        console.log('\nTotal users:', users.length);
        console.log('Teachers:', users.filter(u => u.role === 'teacher').length);
        console.log('Students:', users.filter(u => u.role === 'student').length);
        console.log('');

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

main();
