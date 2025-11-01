# Scripts Directory

This directory contains utility scripts for managing the Tutoriaz platform.

## Teacher Management

### Create a New Teacher Account

Use `createTeacher.js` to add new teacher accounts to the system.

**Usage:**
```bash
node scripts/createTeacher.js --username=<username> --password=<password> [--display="Display Name"]
```

**Examples:**
```bash
# Create teacher with username and password
node scripts/createTeacher.js --username=john --password=secure123

# Create teacher with custom display name
node scripts/createTeacher.js --username=jane --password=secure456 --display="Dr. Jane Smith"
```

**Notes:**
- The script will check if the username already exists before creating
- If `--display` is not provided, the username will be used as the display name
- Passwords are automatically hashed using bcrypt before storage

### Edit Teacher Profile

Teachers can update their own profiles through the web interface:
1. Log in to the teacher dashboard
2. Click the "⚙️ Profile" button in the header
3. Update display name and/or password
4. Click "💾 Save Changes"

## Student Management

### Create Student Accounts

Use `createStudents.js` to create multiple student accounts (see file for details).

## Testing & Development

- `bootstrapDemo.js` - Bootstrap demo data
- `seedQuizzes.js` - Seed quiz questions
- `simulateStudents.js` - Simulate student activities
- `testCsvExport.js` / `testCsvExport.sh` - Test CSV export functionality
- `quickTestCsv.sh` - Quick test for CSV export
- `testPushUndo.js` - Test quiz push/undo functionality
