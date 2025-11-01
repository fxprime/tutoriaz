const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('=== Fixing Checkbox Quiz ===\n');

// Find checkbox quiz with empty options
db.get(`
    SELECT id, title, question_type, options
    FROM quizzes 
    WHERE question_type = 'checkbox' AND (options = '[]' OR options IS NULL)
    ORDER BY created_at DESC
    LIMIT 1
`, [], (err, row) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    if (!row) {
        console.log('No checkbox quiz with empty options found.');
        db.close();
        return;
    }

    console.log('Found quiz:', row.title);
    console.log('Quiz ID:', row.id);
    console.log('Current options:', row.options);
    
    // Add sample options
    const newOptions = JSON.stringify([
        'Option A - First choice',
        'Option B - Second choice',
        'Option C - Third choice',
        'Option D - Fourth choice'
    ]);

    console.log('\nUpdating with options:', newOptions);

    db.run(`
        UPDATE quizzes 
        SET options = ?
        WHERE id = ?
    `, [newOptions, row.id], function(err) {
        if (err) {
            console.error('Error updating:', err);
        } else {
            console.log('\n✅ Quiz updated successfully!');
            console.log('Rows affected:', this.changes);
            
            // Verify the update
            db.get('SELECT options FROM quizzes WHERE id = ?', [row.id], (err, updated) => {
                if (!err && updated) {
                    console.log('\nVerified options:', updated.options);
                    const parsed = JSON.parse(updated.options);
                    console.log('Parsed:', parsed);
                }
                db.close();
            });
        }
    });
});
