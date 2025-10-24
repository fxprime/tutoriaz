#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const args = process.argv.slice(2);
let username = null;
let password = null;
let displayName = null;

for (const arg of args) {
    if (arg.startsWith('--username=')) {
        username = arg.split('=')[1] || null;
    }
    if (arg.startsWith('--password=')) {
        password = arg.split('=')[1] || null;
    }
    if (arg.startsWith('--display=')) {
        displayName = arg.split('=')[1] || null;
    }
}

if (!username || !password) {
    console.error('Usage: node scripts/createTeacher.js --username=<name> --password=<plain-text> [--display=<Display Name>]');
    process.exit(1);
}

const DB_PATH = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(DB_PATH);

function run(dbInstance, sql, params = []) {
    return new Promise((resolve, reject) => {
        dbInstance.run(sql, params, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve(this);
            }
        });
    });
}

function get(dbInstance, sql, params = []) {
    return new Promise((resolve, reject) => {
        dbInstance.get(sql, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
}

async function ensureUsersSchema() {
    const info = await new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(users)", [], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });

    if (!Array.isArray(info) || info.length === 0) {
        throw new Error('Users table not found. Run your migrations first.');
    }
}

async function main() {
    try {
        await ensureUsersSchema();

        const existing = await get(db, 'SELECT id, username FROM users WHERE username = ?', [username]);
        if (existing) {
            console.log(`User "${username}" already exists (id=${existing.id}). Nothing to do.`);
            return;
        }

        const hash = await bcrypt.hash(password, 10);
        const now = new Date().toISOString();
        const userId = uuidv4();

        await run(
            db,
            `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
             VALUES (?, ?, ?, ?, 'teacher', ?)` ,
            [
                userId,
                username,
                displayName || username,
                hash,
                now
            ]
        );

        console.log(`Created teacher account "${username}" with id ${userId}.`);
    } catch (error) {
        console.error('Failed to create teacher:', error.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
}

main();
