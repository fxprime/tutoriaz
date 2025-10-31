-- Add scoring fields to quizzes table
ALTER TABLE quizzes ADD COLUMN is_scored INTEGER DEFAULT 1 CHECK(is_scored IN (0, 1));
ALTER TABLE quizzes ADD COLUMN points INTEGER DEFAULT 1 CHECK(points >= 0);

-- Update existing quizzes to be scored by default
UPDATE quizzes SET is_scored = 1, points = 1 WHERE is_scored IS NULL;
