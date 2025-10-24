-- Migration: align existing categories with their quiz courses

UPDATE quiz_categories
SET course_id = (
    SELECT course_id
    FROM quizzes
    WHERE quizzes.category_id = quiz_categories.id
      AND quizzes.course_id IS NOT NULL
    LIMIT 1
)
WHERE course_id IS NULL;

