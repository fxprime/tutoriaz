#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

// Load .env file if it exists
const envPath = path.join(__dirname, '..', '.env');
const fs = require('fs');
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

const args = process.argv.slice(2);
let username = null;
let password = null;

for (const arg of args) {
    if (arg.startsWith('--username=')) {
        username = arg.split('=')[1] || null;
    }
    if (arg.startsWith('--password=')) {
        password = arg.split('=')[1] || null;
    }
}

if (!username || !password) {
    console.error('Usage: node scripts/resetPassword.js --username=<name> --password=<new-password>');
    console.error('');
    console.error('Example:');
    console.error('  node scripts/resetPassword.js --username=admin --password=newpassword123');
    process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
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

async function main() {
    try {
        // Check if user exists
        const user = await get(db, 'SELECT id, username, role FROM users WHERE username = ?', [username]);
        
        if (!user) {
            console.error(`Error: User "${username}" not found in database.`);
            console.error('');
            console.error('To see all users, run:');
            console.error('  node scripts/listUsers.js');
            process.exit(1);
        }

        console.log(`Found user: ${user.username} (${user.role})`);
        console.log(`Resetting password...`);

        // Hash the new password
        const hash = await bcrypt.hash(password, 10);

        // Update the password
        await run(
            db,
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hash, user.id]
        );

        console.log(`✓ Password successfully reset for user "${username}"`);
        console.log('');
        console.log('You can now login with:');
        console.log(`  Username: ${username}`);
        console.log(`  Password: ${password}`);

    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        db.close();
    }
}

main();
