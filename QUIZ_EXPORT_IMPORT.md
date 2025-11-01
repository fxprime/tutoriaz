# Quiz Export/Import Feature

## Overview
Teachers can now export their quizzes in two formats:
- **JSON format** - For backing up, importing, and migrating quizzes
- **Markdown format** - For viewing, sharing, and converting to other formats (e.g., Google Forms)

This is useful for:
- Backing up quizzes
- Sharing quizzes between courses
- Migrating quizzes to different instances
- Reusing quiz templates
- Creating readable quiz documents
- Converting quizzes to Google Forms or other platforms

## How to Export Quizzes

1. Open the teacher dashboard
2. Select a course
3. In the "Your Quizzes" sidebar, click the **📤 Export** button
4. Choose the export format:
   - **JSON** - For import/backup (machine-readable)
   - **Markdown** - For viewing/Google Forms (human-readable)
5. Choose quizzes to export:
   - Check individual quizzes you want to export, then click **Export Selected**
   - Or click **Export All** to export all quizzes in the current course
6. A file will be downloaded to your computer

**File naming:**
- JSON: `quizzes_export_YYYY-MM-DD.json`
- Markdown: `quizzes_export_YYYY-MM-DD.md`

## Export Formats

### JSON Format (for import/backup)
- Machine-readable format
- Can be imported back into the system
- Preserves all quiz data including metadata
- See `example_quiz_export.json` for format

### Markdown Format (for viewing/sharing)
- Human-readable format
- Perfect for review and documentation
- Easy to convert to Google Forms
- Includes:
  - Quiz title and question
  - Question type
  - Time limit and points
  - Options with letters (a, b, c, d...)
  - Correct answers clearly marked
- See `example_quiz_export.md` for example

## How to Import Quizzes

1. Open the teacher dashboard
2. Select a course (where you want to import the quizzes)
3. In the "Your Quizzes" sidebar, click the **📥 Import** button
4. Click **Choose File** and select a JSON export file
5. Review the preview showing:
   - Number of quizzes
   - Export date
   - List of quiz titles
6. Click **Import** to add the quizzes to your course
7. The imported quizzes will be assigned to the currently selected course

## Export File Format

The export file is a JSON file with the following structure:

```json
{
  "version": "1.0",
  "exported_at": "2025-11-01T12:00:00.000Z",
  "exported_by": "teacher-001",
  "count": 3,
  "quizzes": [
    {
      "title": "Quiz Title",
      "content_text": "Question text (supports Markdown)",
      "images": [],
      "question_type": "select",  // or "text", "checkbox"
      "options": ["Option 1", "Option 2", "Option 3"],
      "correct_answer": "{\"selected_index\":1,\"selected_text\":\"Option 2\"}",
      "category_id": null,
      "course_id": null,
      "timeout_seconds": 60,
      "is_scored": 1,
      "points": 1
    }
  ]
}
```

## Important Notes

### Quiz IDs
- Imported quizzes receive **new IDs** (they are duplicated, not moved)
- Original quiz responses and history are not imported

### Course Assignment
- Imported quizzes are assigned to the **currently selected course**
- Original `course_id` from the export is ignored
- You can import the same quiz file into multiple courses

### Categories
- If `targetCategoryId` is not specified, the original `category_id` is preserved
- If the category doesn't exist in the target course, it will be set to null

### Question Types
All three question types are supported:
- **text**: Free-form text answer
- **select**: Multiple choice (single selection)
- **checkbox**: Multiple choice (multiple selections)

### Correct Answers Format
- **text**: Plain string (e.g., `"4"`)
- **select**: JSON object (e.g., `"{\"selected_index\":1,\"selected_text\":\"Paris\"}"`)
- **checkbox**: JSON array (e.g., `"[\"Python\",\"JavaScript\",\"Java\"]"`)

## API Endpoints

### Export Quizzes
```http
POST /api/quizzes/export
Authorization: Bearer <token>
Content-Type: application/json

{
  "quizIds": ["quiz-id-1", "quiz-id-2"],  // Optional: specific quizzes
  "courseId": "course-id"                  // Optional: all quizzes from course
}
```

### Import Quizzes
```http
POST /api/quizzes/import
Authorization: Bearer <token>
Content-Type: application/json

{
  "quizzes": [...],              // Array of quiz objects
  "targetCourseId": "course-id", // Required: destination course
  "targetCategoryId": "cat-id"   // Optional: override category
}
```

## Example Use Cases

### Backup All Quizzes
1. Export all quizzes from each course
2. Save the JSON files in a safe location
3. Import them back if needed

### Share Quizzes Between Courses
1. Export quizzes from Course A
2. Switch to Course B
3. Import the same file

### Reuse Quiz Templates
1. Create a set of template quizzes
2. Export them
3. Import into new courses and modify as needed

### Migrate Between Servers
1. Export quizzes from old server
2. Copy JSON files to new server
3. Import into new server's courses

### Convert to Google Forms
1. Export quizzes as Markdown
2. Open the .md file in a text editor
3. Copy each quiz section
4. In Google Forms:
   - Create a new question
   - Paste the question text
   - Add options (a, b, c, d...)
   - Mark correct answer(s)
   - Set point value
   - Repeat for each quiz

The markdown format uses letters (a, b, c, d...) for options, making it easy to match with Google Forms' format.

## Troubleshooting

**Import fails with validation error**
- Check that the JSON file is properly formatted
- Ensure all required fields are present (title, question_type)
- Verify the question_type is one of: text, select, checkbox

**Quizzes imported but not visible**
- Make sure you selected a course before importing
- Refresh the quiz list
- Check that the quizzes were assigned to the correct course

**Export button shows "No quizzes to export"**
- Create at least one quiz first
- Select a course that contains quizzes

## See Also
- Example export file: `example_quiz_export.json`
- Migration scripts: `scripts/migrate-011.js` (adds checkbox support)
