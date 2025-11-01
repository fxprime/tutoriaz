const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('=== Updating Correct Answer for teatae Quiz ===\n');

// Update the correct answer to match the current options
db.get(`
    SELECT id, title, options, correct_answer
    FROM quizzes 
    WHERE title = 'teatae'
`, [], (err, row) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    if (!row) {
        console.log('Quiz not found.');
        db.close();
        return;
    }

    console.log('Current state:');
    console.log('Options:', row.options);
    console.log('Correct Answer:', row.correct_answer);

    // The options are: Option A, Option B, Option C, Option D
    // Let's set correct answer to Option B and Option C (indices 1 and 2)
    const newCorrectAnswer = JSON.stringify(["Option B - Second choice", "Option C - Third choice"]);

    console.log('\nUpdating correct answer to:', newCorrectAnswer);

    db.run(`
        UPDATE quizzes 
        SET correct_answer = ?
        WHERE id = ?
    `, [newCorrectAnswer, row.id], function(err) {
        if (err) {
            console.error('Error updating:', err);
        } else {
            console.log('\n✅ Correct answer updated successfully!');
            
            // Verify
            db.get('SELECT correct_answer FROM quizzes WHERE id = ?', [row.id], (err, updated) => {
                if (!err && updated) {
                    console.log('Verified:', updated.correct_answer);
                }
                db.close();
            });
        }
    });
});
