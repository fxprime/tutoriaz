const sqlite3 = require('sqlite3').verbose();
const path = require('path');
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

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'database.sqlite');
console.log('Database path:', dbPath);
const db = new sqlite3.Database(dbPath);

console.log('=== Checking Quiz Data ===\n');

// Check all quizzes, especially checkbox types
db.all(`
    SELECT 
        id, 
        title, 
        question_type, 
        options,
        typeof(options) as options_type,
        length(options) as options_length,
        created_at
    FROM quizzes 
    ORDER BY created_at DESC 
    LIMIT 10
`, [], (err, rows) => {
    if (err) {
        console.error('Error fetching quizzes:', err);
        db.close();
        return;
    }

    console.log(`Found ${rows.length} quizzes:\n`);
    
    rows.forEach((row, index) => {
        console.log(`Quiz ${index + 1}:`);
        console.log(`  ID: ${row.id}`);
        console.log(`  Title: ${row.title}`);
        console.log(`  Question Type: ${row.question_type}`);
        console.log(`  Options Type: ${row.options_type}`);
        console.log(`  Options Length: ${row.options_length}`);
        console.log(`  Options (raw): ${row.options}`);
        
        // Try to parse options
        if (row.options) {
            try {
                const parsed = JSON.parse(row.options);
                console.log(`  Options (parsed): ${JSON.stringify(parsed, null, 2)}`);
                console.log(`  Is Array: ${Array.isArray(parsed)}`);
                console.log(`  Array Length: ${Array.isArray(parsed) ? parsed.length : 'N/A'}`);
            } catch (e) {
                console.log(`  Options (parse error): ${e.message}`);
            }
        } else {
            console.log(`  Options: NULL or empty`);
        }
        console.log('');
    });

    // Now check student_quiz_queue
    console.log('\n=== Checking Student Queue Data ===\n');
    
    db.all(`
        SELECT 
            sqq.id as queue_id,
            sqq.user_id,
            sqq.quiz_id,
            sqq.status,
            q.title,
            q.question_type,
            q.options
        FROM student_quiz_queue sqq
        JOIN quizzes q ON sqq.quiz_id = q.id
        WHERE sqq.status IN ('pending', 'viewing')
        ORDER BY sqq.added_at DESC
        LIMIT 10
    `, [], (err, queueRows) => {
        if (err) {
            console.error('Error fetching queue:', err);
            db.close();
            return;
        }

        console.log(`Found ${queueRows.length} queued quizzes:\n`);
        
        queueRows.forEach((row, index) => {
            console.log(`Queue Item ${index + 1}:`);
            console.log(`  Queue ID: ${row.queue_id}`);
            console.log(`  User ID: ${row.user_id}`);
            console.log(`  Quiz ID: ${row.quiz_id}`);
            console.log(`  Status: ${row.status}`);
            console.log(`  Title: ${row.title}`);
            console.log(`  Question Type: ${row.question_type}`);
            console.log(`  Options (raw): ${row.options}`);
            
            // Try to parse options
            if (row.options) {
                try {
                    const parsed = JSON.parse(row.options);
                    console.log(`  Options (parsed): ${JSON.stringify(parsed, null, 2)}`);
                    console.log(`  Array Length: ${Array.isArray(parsed) ? parsed.length : 'N/A'}`);
                } catch (e) {
                    console.log(`  Options (parse error): ${e.message}`);
                }
            }
            console.log('');
        });

        db.close();
        console.log('=== Database check complete ===');
    });
});
