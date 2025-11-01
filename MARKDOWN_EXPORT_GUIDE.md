# Markdown Export Format Guide

## What is Markdown Export?

The Markdown export creates human-readable quiz documents that can be:
- Reviewed and printed
- Shared with other instructors
- Converted to Google Forms
- Used as quiz study guides

## Format Structure

```markdown
# Quiz Export

Exported on: [Date and Time]
Total Quizzes: [Number]

---

## Quiz [Number]: [Title]

**Question:**
[Question text with markdown support]

**Type:** [text/select/checkbox]

**Time Limit:** [seconds] seconds

**Points:** [point value]

**Options:** (for select/checkbox only)
a. [Option 1]
b. [Option 2]
c. [Option 3]
d. [Option 4]

**Correct Answer:** (or **Expected Answer:** for text)
[Answer(s) with option letters]

---
```

## Question Types

### Multiple Choice (select)
- Shows options with letters (a, b, c, d...)
- Shows single correct answer

### Checkbox (multiple selection)
- Shows options with letters (a, b, c, d...)
- Shows all correct answers

### Text Answer
- Shows "Expected Answer" instead of options
- Displays the correct text answer

## Converting to Google Forms

1. **Create new form** in Google Forms
2. **For each quiz:**
   - Click "Add question"
   - Copy the question text from markdown
   - Select question type:
     - "Multiple choice" for select type
     - "Checkboxes" for checkbox type
     - "Short answer" for text type
   - Add options (use the letters as reference)
   - Click "Answer key" to mark correct answer(s)
   - Set point value
3. **Configure form settings** as needed

## Tips

- The letters (a, b, c, d...) match Google Forms option order
- Markdown formatting in questions will need manual adjustment
- Code blocks (```) should be formatted as code in Google Forms
- Copy one quiz at a time for best results

## Example

See `example_quiz_export.md` for a complete example with all question types.
