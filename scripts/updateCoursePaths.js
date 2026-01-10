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

console.log('Updating existing courses with docs_local_path...');
console.log('Database path:', DB_PATH);

// Helper function to extract repo name from git URL
function getRepoFolderName(gitUrl) {
    // Extract repo name from SSH URL (e.g., git@github.com:user/repo.git -> repo)
    let match = gitUrl.match(/:([^\/]+\/)?([^\/]+?)(\.git)?$/);
    if (match && match[2]) {
        return match[2].replace(/\.git$/, '');
    }
    // Extract repo name from HTTPS URL (e.g., https://github.com/user/repo.git -> repo)
    match = gitUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (match && match[1]) {
        return match[1].replace(/\.git$/, '');
    }
    return null;
}

db.serialize(() => {
    // First, add columns if they don't exist
    db.run('ALTER TABLE courses ADD COLUMN docs_local_path TEXT', (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding docs_local_path:', err.message);
        }
    });
    
    db.run('ALTER TABLE courses ADD COLUMN docs_site_url TEXT', (err) => {
        if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding docs_site_url:', err.message);
        }
    });

    // Get all courses with docs_repo_url but no docs_local_path
    db.all(`SELECT id, docs_repo_url FROM courses WHERE docs_repo_url IS NOT NULL AND (docs_local_path IS NULL OR docs_local_path = '')`, [], (err, rows) => {
        if (err) {
            console.error('Error querying courses:', err.message);
            db.close();
            return;
        }

        if (!rows || rows.length === 0) {
            console.log('No courses need updating');
            db.close();
            return;
        }

        console.log(`Found ${rows.length} course(s) to update`);

        let updated = 0;
        rows.forEach(row => {
            const repoName = getRepoFolderName(row.docs_repo_url);
            if (repoName) {
                const localPath = `/docs/${repoName}/site/`;
                const coursePath = path.join(__dirname, '..', 'courses', repoName);
                
                // Check if the course directory exists
                if (fs.existsSync(coursePath)) {
                    db.run(
                        'UPDATE courses SET docs_local_path = ? WHERE id = ?',
                        [localPath, row.id],
                        (err) => {
                            if (err) {
                                console.error(`Error updating course ${row.id}:`, err.message);
                            } else {
                                console.log(`✓ Updated course ${row.id}: ${localPath}`);
                                updated++;
                            }
                            
                            if (updated === rows.length) {
                                console.log(`\nCompleted! Updated ${updated} course(s)`);
                                db.close();
                            }
                        }
                    );
                } else {
                    console.log(`⚠ Skipping course ${row.id}: directory courses/${repoName} not found`);
                    updated++;
                    if (updated === rows.length) {
                        db.close();
                    }
                }
            } else {
                console.log(`⚠ Could not extract repo name from: ${row.docs_repo_url}`);
                updated++;
                if (updated === rows.length) {
                    db.close();
                }
            }
        });
    });
});
