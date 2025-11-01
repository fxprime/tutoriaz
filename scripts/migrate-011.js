#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Load .env file if it exists
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    console.log('Loading environment from .env file...');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
        const match = line.match(/^([^=:#]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim();
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
const MIGRATION_FILE = path.join(__dirname, '..', 'migrations', '011_add_checkbox_question_type.sql');

console.log('Running migration: 011_add_checkbox_question_type.sql');
console.log('Database path:', DB_PATH);

const db = new sqlite3.Database(DB_PATH);

// Read the migration SQL
const migrationSQL = fs.readFileSync(MIGRATION_FILE, 'utf8');

db.serialize(() => {
    // Check current schema
    db.all("PRAGMA table_info(quizzes)", [], (err, rows) => {
        if (err) {
            console.error('Error reading table info:', err);
            process.exit(1);
        }
        
        console.log('\nCurrent quizzes table structure:');
        rows.forEach(row => {
            console.log(`  ${row.name}: ${row.type} ${row.notnull ? 'NOT NULL' : ''} ${row.dflt_value ? `DEFAULT ${row.dflt_value}` : ''}`);
        });
    });
    
    // Execute migration
    db.exec(migrationSQL, (err) => {
        if (err) {
            console.error('\n❌ Migration failed:', err);
            process.exit(1);
        }
        
        console.log('\n✅ Migration completed successfully!');
        
        // Verify the update
        db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='quizzes'", [], (err, rows) => {
            if (err) {
                console.error('Error verifying migration:', err);
            } else if (rows.length > 0) {
                console.log('\nNew table definition:');
                console.log(rows[0].sql);
                
                // Check if checkbox is in the constraint
                if (rows[0].sql.includes("'checkbox'")) {
                    console.log('\n✓ Checkbox type successfully added to CHECK constraint');
                } else {
                    console.log('\n⚠ Warning: checkbox type not found in constraint');
                }
            }
            
            db.close();
        });
    });
});
