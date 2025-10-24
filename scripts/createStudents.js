#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const args = process.argv.slice(2);

function parseArgs() {
    const config = {
        count: 50,
        prefix: 'student',
        password: 'student123',
        displayPrefix: 'Student',
        startIndex: 1,
        dryRun: false,
        verbose: false
    };

    args.forEach(arg => {
        if (arg.startsWith('--count=')) config.count = parseInt(arg.split('=')[1], 10) || config.count;
        else if (arg.startsWith('--prefix=')) config.prefix = arg.split('=')[1] || config.prefix;
        else if (arg.startsWith('--password=')) config.password = arg.split('=')[1] || config.password;
        else if (arg.startsWith('--displayPrefix=')) config.displayPrefix = arg.split('=')[1] || config.displayPrefix;
        else if (arg.startsWith('--start=')) config.startIndex = parseInt(arg.split('=')[1], 10) || config.startIndex;
        else if (arg === '--dry-run') config.dryRun = true;
        else if (arg === '--verbose') config.verbose = true;
    });

    return config;
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
    const config = parseArgs();
    console.log('Creating student accounts with config:', config);

    try {
        await ensureUsersSchema();

        const passwordHash = await bcrypt.hash(config.password, 10);
        const now = new Date().toISOString();
        const created = [];
        const skipped = [];

        for (let i = 0; i < config.count; i += 1) {
            const number = config.startIndex + i;
            const username = `${config.prefix}${number}`;
            const display = `${config.displayPrefix} ${number}`;

            const existing = await get(db, 'SELECT id FROM users WHERE username = ?', [username]);
            if (existing) {
                skipped.push({ username, id: existing.id });
                if (config.verbose) {
                    console.log(`Skipping ${username}: already exists.`);
                }
                continue;
            }

            if (config.dryRun) {
                console.log(`[DRY RUN] Would create ${username}`);
                created.push({ username, id: null });
                continue;
            }

            const userId = uuidv4();
            await run(
                db,
                `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
                 VALUES (?, ?, ?, ?, 'student', ?)` ,
                [
                    userId,
                    username,
                    display,
                    passwordHash,
                    now
                ]
            );
            created.push({ username, id: userId });
            if (config.verbose) {
                console.log(`Created student ${username} (id=${userId})`);
            }
        }

        console.log(`\nDone. Created: ${created.length}, skipped (already existed): ${skipped.length}`);
        if (skipped.length) {
            console.log('Skipped usernames:', skipped.map(s => s.username).join(', '));
        }
    } catch (error) {
        console.error('Failed to create students:', error.message);
        process.exitCode = 1;
    } finally {
        db.close();
    }
}

main();
