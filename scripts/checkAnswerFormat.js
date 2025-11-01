const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

console.log('=== Checking Answer Format ===\n');

// Check the teatae quiz
db.get(`
    SELECT 
        id, 
        title, 
        question_type, 
        options,
        correct_answer,
        typeof(correct_answer) as answer_type
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

    console.log('Quiz:', row.title);
    console.log('Question Type:', row.question_type);
    console.log('\nOptions (raw):', row.options);
    
    let options = [];
    try {
        options = JSON.parse(row.options);
        console.log('Options (parsed):');
        options.forEach((opt, idx) => {
            console.log(`  [${idx}] "${opt}"`);
        });
    } catch (e) {
        console.log('Failed to parse options:', e.message);
    }

    console.log('\nCorrect Answer (raw):', row.correct_answer);
    console.log('Answer Type:', row.answer_type);
    
    if (row.correct_answer) {
        try {
            const parsed = JSON.parse(row.correct_answer);
            console.log('Correct Answer (parsed):');
            if (Array.isArray(parsed)) {
                parsed.forEach((ans, idx) => {
                    console.log(`  [${idx}] "${ans}"`);
                    
                    // Check if this matches any option
                    const matchIndex = options.indexOf(ans);
                    if (matchIndex !== -1) {
                        console.log(`      ✓ Matches option [${matchIndex}]`);
                    } else {
                        console.log(`      ✗ No matching option found!`);
                    }
                });
            } else {
                console.log(JSON.stringify(parsed, null, 2));
            }
        } catch (e) {
            console.log('Failed to parse answer:', e.message);
        }
    }

    console.log('\n=== Recent Responses ===\n');
    
    db.all(`
        SELECT 
            student_answer,
            is_correct,
            u.display_name
        FROM quiz_responses qr
        JOIN users u ON qr.student_id = u.id
        WHERE qr.quiz_id = ?
        ORDER BY qr.answered_at DESC
        LIMIT 3
    `, [row.id], (err, responses) => {
        if (err) {
            console.error('Error getting responses:', err);
        } else {
            responses.forEach((resp, idx) => {
                console.log(`Response ${idx + 1} (${resp.display_name}):`);
                console.log(`  Answer: ${resp.student_answer}`);
                console.log(`  Correct: ${resp.is_correct}`);
                
                try {
                    const parsed = JSON.parse(resp.student_answer);
                    console.log(`  Parsed:`, parsed);
                } catch (e) {
                    console.log(`  (Not JSON)`);
                }
                console.log('');
            });
        }
        db.close();
    });
});
