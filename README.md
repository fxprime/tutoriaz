# Tutoriaz - Real-time Quiz Platform

ระบบการสอนแบบอินเทอร์แอคทีฟสำหรับหลักสูตรออนไซต์ ที่มาพร้อมกับแบบทดสอบเรียลไทม์และการมีส่วนร่วมของนักเรียน พร้อมระบบจัดการคอร์สแบบอิสระผ่าน mkdocs

## What's New 🎉

### Version 2.0 Features

- ✅ **Checkbox Questions**: Multiple-selection questions with array-based answers
- ✅ **Markdown Support**: Full markdown rendering in questions and options (code blocks, formatting, etc.)
- ✅ **Syntax Highlighting**: Automatic code highlighting for C++, Python, JavaScript, Arduino, and more
- ✅ **Interactive Quiz Creation**: Preview and select correct answers directly in the form
- ✅ **Quiz Export/Import**: 
  - Export as JSON for backup and migration
  - Export as Markdown for documentation and Google Forms conversion
  - Import from JSON files
- ✅ **Persistent Quiz Monitor**: Reusable popup window that updates with each quiz (perfect for dual monitors)
- ✅ **Enhanced Answer Display**: Clean, human-readable answer formatting
- ✅ **Quiz Categories**: Organize quizzes into folders
- ✅ **Scoring System**: Configurable points with automatic grading
- ✅ **Quiz Queue System**: Per-student queue management with position tracking

### Recent Improvements

- **🔒 Security enhancements**: Comprehensive input validation, XSS protection, rate limiting, and stronger password requirements (see [SECURITY.md](SECURITY.md))
- **Syntax highlighting** for code blocks in quiz questions and options
- Fixed checkbox question type database constraint
- Enhanced quiz validation and error handling
- Improved modal dialogs with proper overlay positioning
- Better export/import error messages
- Environment variable support for database path (`DB_PATH`)
- Migration scripts with `.env` file support 

## Features

### Quiz Management
- **Multiple Question Types**: 
  - Text answers (free-form input)
  - Multiple choice (single selection)
  - **Checkbox questions (multiple selection)** - NEW!
- **Markdown Support**: Questions and options support markdown formatting including code blocks
- **Interactive Preview**: Teachers can preview and select correct answers directly in the creation form
- **Quiz Categories**: Organize quizzes into folders/categories
- **Scoring System**: Configurable points per quiz with automatic grading
- **Export/Import**: 
  - Export quizzes as **JSON** for backup and migration
  - Export quizzes as **Markdown** for viewing and Google Forms conversion
  - Import quizzes from JSON files

### Real-time Features
- **Teacher Dashboard**: Create and push quizzes, see online students, track responses
- **Student Interface**: Course content with real-time quiz notifications
- **WebSocket-based Communication**: Instant push notifications and response tracking
- **Quiz Monitor Window**: Persistent popup window that updates with each new quiz (perfect for dual monitors)
- **Response Tracking**: Monitor student engagement, answer times, and completion rates
- **Timeout Handling**: Configurable quiz timeouts with automatic status updates

### Student Management
- **Course Enrollment**: Students enroll with course-specific passkeys
- **Attendance Tracking**: Monitor which students are actively viewing course content
- **Performance Analytics**: Track quiz scores, response rates, and time taken
- **Quiz Queue System**: Students see upcoming quizzes in their personal queue

### Data & Reporting
- **CSV Export**: Export student data (basic and full modes) with course and teacher information
- **Show Answers**: Push quiz results to students showing correct/incorrect answers with color-coded display
- **Student Scores**: View comprehensive scoring dashboard with filtering and sorting
- **Quiz History**: Complete history of all quiz pushes and student responses

### User Management
- **Teacher Profile Management**: Edit display name and change password through UI
- **Multiple Teachers**: Support for multiple teacher accounts with separate quiz libraries
- **Student Registration**: Self-service registration with course enrollment

## Quick Start

### Prerequisites

- Node.js 16+ 
- npm or yarn
- Python 3.7+ (for course documentation)
- Git

### Installation

Run the automated setup script:
```bash
./setup.sh
```

Or manually:

1. Install dependencies:
```bash
npm install
```

2. Initialize and update course submodules:
```bash
git submodule update --init --recursive
```

3. Setup Python virtual environment and build documentation:
```bash
python3 -m venv courses/venv
source courses/venv/bin/activate
pip install mkdocs mkdocs-material
# Build each course
cd courses/your_course && mkdocs build && cd ../..
deactivate
```

4. Bootstrap the demo database:
```bash
npm run bootstrap
```

> **Note:** This script removes any existing `database.sqlite` before recreating demo data.

5. Start the server:
```bash
npm start
```

6. Open your browser to `http://localhost:3030` (or `https://localhost:3030` if HTTPS is configured)

### Scripts Overview

| Script | Command | Purpose | Used By |
|--------|---------|---------|---------|
| **setup.sh** | `npm run setup` | First-time installation: dependencies, submodules, venv, docs build | Developers, new deployments |
| **start.sh** | `npm start` | Development startup: updates submodules, builds docs, starts server | Local development (foreground) |
| **startByService.sh** | (systemd only) | Production service startup: loads env, starts server only | systemd service (background) |
| **auto-update.sh** | (timer) | Auto-update: git pull, submodule update, docs build, service restart | systemd timer (every 5 min) |
| **test-service.sh** | `./test-service.sh` | Check service status and configuration | Testing/debugging production |

**Important Notes:**
- ⚠️ **Never run `bash startByService.sh` manually** - it will block your terminal. Use `sudo systemctl start tutoriaz` instead.
- For local development: use `npm start` (runs in foreground, easy to stop with Ctrl+C)
- For production: use `sudo systemctl start tutoriaz` (runs in background, managed by systemd)

### Enable HTTPS (optional)

You can run the Express + Socket.IO server over TLS without a reverse proxy.

1. Generate a certificate (use [`mkcert`](https://github.com/FiloSottile/mkcert) or `openssl`):
    ```bash
    mkdir -p certs
    mkcert -key-file certs/local-key.pem -cert-file certs/local-cert.pem localhost 127.0.0.1 ::1
    # or
    openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/local-key.pem -out certs/local-cert.pem -days 365
    ```
2. Export the certificate paths before starting the server:
    ```bash
    export HTTPS_KEY_PATH=certs/local-key.pem
    export HTTPS_CERT_PATH=certs/local-cert.pem
    # optional extras
    # export HTTPS_CA_PATH=certs/rootCA.pem      # single file or comma-separated list
    # export HTTPS_PASSPHRASE="your-passphrase"
    npm start
    ```

If the key/cert cannot be loaded the server falls back to HTTP automatically. In production you can continue to terminate TLS at a reverse proxy (e.g., Nginx + Let's Encrypt) as described below.

### Demo Accounts

- **Teacher**: username=`teacher`, password=`admin123`
- **Students**: `student1` - `student50`, password=`student123`
- **Course Passkey**: `JOIN-ESP32` (generated by the bootstrap script)

## Usage

### Teacher Account Management

#### Creating New Teacher Accounts

Use the provided script to create additional teacher accounts:

```bash
node scripts/createTeacher.js --username=john --password=secure123 --display="John Doe"
```

**Options:**
- `--username` - Username for login (required)
- `--password` - Password for the account (required, min 6 characters)
- `--display` - Display name shown in UI (optional, defaults to username)

**Example:**
```bash
# Create a teacher with default display name
node scripts/createTeacher.js --username=teacher2 --password=mypassword

# Create a teacher with custom display name
node scripts/createTeacher.js --username=jane.smith --password=secure456 --display="Dr. Jane Smith"
```

The script will:
- Check if the username already exists
- Hash the password securely using bcrypt
- Create the teacher account in the database
- Display the new user ID

#### Editing Teacher Profile

Teachers can update their own profile through the web interface:

1. Log in to the teacher dashboard
2. Click the **"⚙️ Profile"** button in the header (next to Logout)
3. Update display name and/or password:
   - **Display Name**: Change how your name appears to students
   - **Password**: Enter current password, then new password (min 6 characters)
4. Click **"💾 Save Changes"**

**Security Notes:**
- Changing password requires entering your current password
- Passwords are validated for minimum length (6 characters)
- All passwords are hashed using bcrypt before storage

### For Teachers

1. Login with teacher credentials
2. **Edit Your Profile**: Click "⚙️ Profile" button to update display name or change password
3. **Create Quizzes**: 
   - Choose question type (text, multiple choice, or checkbox)
   - Use markdown for formatting (code blocks, bold, italic, etc.)
   - Preview options with interactive answer selection
   - Organize with categories
   - Set time limits and point values
4. **Push Quizzes**: Send quizzes to all online students or specific courses
5. **Monitor Responses**: Watch real-time responses in a persistent popup window
6. **Export Quizzes**:
   - **JSON format**: For backup and importing to other courses
   - **Markdown format**: For documentation or converting to Google Forms
7. **Import Quizzes**: Upload JSON files to reuse quizzes across courses
8. **Export Student Data**: Click "📥 Export CSV" to download student performance data
9. **Show Quiz Results**: Click "📋 Show Answers to Students" to push quiz results with correct answers
10. Undo quiz pushes if needed

### For Students

1. Login with student credentials or register with course passkey
2. View course content on the main page
3. **Receive Quiz Notifications**: 
   - Quizzes appear as overlay notifications
   - See your position in the queue
   - Markdown-formatted questions and options
4. **Answer Quizzes**:
   - Text input for free-form answers
   - Radio buttons for single-choice questions
   - **Checkboxes for multiple-selection questions**
5. Submit answers within the time limit
6. See confirmation when answers are submitted
7. **View Quiz Results**: When teacher pushes answers, see your results with correct answers highlighted
8. Track your quiz history and scores

## Course Documentation

Course materials are maintained in separate repositories and included as Git submodules under the `courses/` directory. Each course uses MkDocs with Material theme for documentation.

### Adding a New Course

Follow these steps to create and add a new course to the platform:

#### 1. Create Course Repository

Create a new folder for your course content:
```bash
mkdir my_new_course
cd my_new_course
git init
```

#### 2. Write Course in Markdown

Set up the MkDocs structure:
```bash
# Create MkDocs configuration
cat > mkdocs.yml << 'EOF'
site_name: My New Course
theme:
  name: material
  palette:
    primary: indigo
    accent: indigo
  features:
    - navigation.sections
    - navigation.expand
    - navigation.top

nav:
  - Home: index.md
  - Getting Started: getting-started.md
  - Module 1: modules/module-01.md
  - Module 2: modules/module-02.md
  - Reference: appendix/reference.md
EOF

# Create documentation structure
mkdir -p docs/{modules,appendix,assets/{images,snippets}}

# Write your course content
cat > docs/index.md << 'EOF'
# Welcome to My New Course

Course overview and introduction...
EOF

# Create module files
echo "# Module 1: Introduction" > docs/modules/module-01.md
echo "# Module 2: Advanced Topics" > docs/modules/module-02.md
echo "# Getting Started" > docs/getting-started.md
echo "# Reference Materials" > docs/appendix/reference.md
```

#### 3. Test with MkDocs

Install MkDocs and preview your course locally:
```bash
# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate

# Install MkDocs
pip install mkdocs mkdocs-material

# Serve locally (live preview)
mkdocs serve
# Visit http://127.0.0.1:8000

# Build static site
mkdocs build
# Output will be in site/ directory
```

Verify that:
- All pages load correctly
- Navigation works as expected
- Images and assets display properly
- Mobile view renders correctly

#### 4. Git Push to Remote Repository

Push your course to GitHub (or your Git hosting):
```bash
# Add a .gitignore
cat > .gitignore << 'EOF'
site/
venv/
__pycache__/
*.pyc
.DS_Store
EOF

# Commit and push
git add .
git commit -m "Initial course content"
git remote add origin https://github.com/yourusername/my_new_course.git
git push -u origin main
```

#### 5. Add Submodule to Main Platform

In the main tutoriaz repository, add your course as a submodule:
```bash
cd /path/to/tutoriaz

# Add the course as a submodule
git submodule add https://github.com/yourusername/my_new_course.git courses/my_new_course

# Initialize and update submodules
git submodule update --init --recursive

# Commit the submodule addition
git add .gitmodules courses/my_new_course
git commit -m "Add my_new_course submodule"
git push
```

#### 6. Register Course in Platform

Add the course to the database through the teacher dashboard:
1. Login as teacher
2. Click "New Course" button
3. Fill in course details:
   - **Title**: My New Course
   - **Description**: Brief description of the course
   - **Documentation URL**: `https://github.com/yourusername/my_new_course.git`
   - **Documentation Branch**: `main`
   - **Access Code**: Generate a passkey (e.g., `JOIN-MYNEWCOURSE`)
4. Click "Create Course"

The platform will automatically:
- Pull the submodule when updates are available
- Build documentation using MkDocs in a virtual environment
- Serve the static site at `/docs/my_new_course/`

### Updating Existing Course Content

To update an existing course:

```bash
# Navigate to the course submodule
cd courses/my_new_course

# Make your changes
vim docs/modules/module-01.md

# Test locally
source venv/bin/activate
mkdocs serve

# Commit and push
git add .
git commit -m "Update module 1 content"
git push
```

The auto-update script on the production server will:
1. Detect new commits every 5 minutes
2. Pull the latest changes
3. Rebuild the documentation
4. Restart the service

### Course Documentation Structure

Each course should follow this structure:
```
my_new_course/
├── mkdocs.yml           # MkDocs configuration
├── docs/
│   ├── index.md         # Course homepage
│   ├── getting-started.md
│   ├── modules/         # Course modules
│   │   ├── module-01.md
│   │   └── module-02.md
│   ├── appendix/        # Reference materials
│   │   └── reference.md
│   └── assets/          # Images, code snippets
│       ├── images/
│       └── snippets/
├── venv/                # Python virtual environment (gitignored)
├── site/                # Built documentation (gitignored)
└── .gitignore
```

## Architecture

- **Backend**: Node.js + Express + Socket.IO + SQLite
- **Frontend**: Vanilla HTML/CSS/JavaScript with Socket.IO client
- **Database**: SQLite for demo (easily switchable to PostgreSQL)
- **Real-time**: WebSocket connections for live quiz distribution

## API Endpoints

### Authentication
- `POST /api/login` - User authentication
- `POST /api/register` - Student registration
- `GET /api/me` - Get current user info
- `PUT /api/profile` - Update user profile (display name and password)

### Courses
- `GET /api/courses` - List courses (context-aware for teachers/students)
- `POST /api/courses` - Create new course (teacher only)
- `POST /api/courses/:courseId/enroll` - Enroll in course (student only)
- `GET /api/courses/:courseId/export-csv` - Export student data as CSV (teacher only)
- `POST /api/courses/:courseId/push-answers` - Push quiz results to students (teacher only)

### Quizzes (Teacher only)
- `GET /api/quizzes` - List teacher's quizzes
- `POST /api/quizzes` - Create new quiz
- `PUT /api/quizzes/:quizId` - Update existing quiz
- `DELETE /api/quizzes/:quizId` - Delete quiz
- `GET /api/quizzes/:quizId/responses` - Get quiz responses
- `POST /api/quizzes/export` - Export quizzes as JSON or Markdown
- `POST /api/quizzes/import` - Import quizzes from JSON
- `POST /api/pushes` - Push quiz to students  
- `POST /api/pushes/:id/undo` - Undo quiz push

### Categories (Teacher only)
- `GET /api/categories` - List quiz categories
- `POST /api/categories` - Create new category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category

### Students
- `GET /api/students/online` - List online students (teacher only)

## WebSocket Events

### Authentication
- `auth` - Authenticate with JWT token
- `auth_ok` / `auth_error` - Authentication responses

### Quiz Flow
- `quiz_push` - Server pushes quiz to students
- `quiz_queue_updated` - Server updates student's quiz queue
- `show_next_quiz` - Server tells student to display next quiz
- `queue_empty` - Notify student queue is empty
- `quiz_answer` - Student submits answer
- `quiz_response` - Server notifies teachers of responses
- `quiz_undo` - Server cancels active quiz
- `quiz_timeout` - Quiz timeout notification
- `show_answers` - Server pushes quiz results to students with correct answers

### Presence
- `online_students` - Updates list of connected students

## Security

The platform implements comprehensive security measures to protect against common vulnerabilities:

- **🔒 Authentication**: Bcrypt password hashing with configurable rounds
- **🛡️ Rate Limiting**: Protection against brute force attacks (15 requests per 15 minutes)
- **🔐 Input Validation**: Strict username and password requirements
- **✨ XSS Protection**: All user-generated content sanitized using the `xss` library
- **💉 SQL Injection**: All database queries use parameterized statements
- **🔑 JWT Tokens**: Secure token-based authentication with 24-hour expiry
- **🚫 Reserved Usernames**: System usernames blocked (admin, root, etc.)
- **📏 Body Size Limits**: Request payload size capped at 8KB

### Password Requirements

- Minimum 8 characters
- Maximum 128 characters
- Must contain at least one letter
- Must contain at least one number or symbol

### Username Requirements

- 3-30 characters
- Letters, numbers, and underscore only
- Must start with a letter
- Case-insensitive

For detailed security information, see [SECURITY.md](SECURITY.md)

### Security Testing

Run the security test suite:

```bash
node test-security.js
```

## Development

### Running Migrations

The platform includes database migrations for schema updates. To run a migration:

```bash
# Run specific migration (automatically loads .env)
node scripts/migrate-011.js

# Or with explicit DB_PATH
DB_PATH=/var/lib/tutoriaz/database.sqlite node scripts/migrate-011.js
```

### Database Utilities

**Check Quiz Data:**
```bash
node scripts/checkQuizData.js
```
Shows detailed information about quizzes and their options, useful for debugging.

**Fix Checkbox Quizzes:**
```bash
node scripts/fixCheckboxQuiz.js
```
Repairs checkbox quizzes that were created without options (before the fix).

### Environment Variables

The platform supports these environment variables:

- `DB_PATH` - Path to SQLite database (default: `./database.sqlite`)
- `PORT` - Server port (default: `3030`)
- `HOST` - Server host (default: `0.0.0.0`)
- `NODE_ENV` - Environment mode (`development` or `production`)
- `JWT_SECRET` - Secret for JWT tokens
- `HTTPS_KEY_PATH` - Path to HTTPS private key
- `HTTPS_CERT_PATH` - Path to HTTPS certificate
- `HTTPS_CA_PATH` - Path to CA certificate(s)
- `HTTPS_PASSPHRASE` - Passphrase for HTTPS key

Create a `.env` file in the project root:
```env
DB_PATH=/var/lib/tutoriaz/database.sqlite
PORT=3030
NODE_ENV=production
JWT_SECRET=your-secret-here
```

### Database Schema

The platform uses these main tables:
- `users` - User accounts (teachers/students) with profile information
- `courses` - Course definitions with access codes and documentation settings
- `course_enrollments` - Student course enrollment tracking
- `course_attendance_sessions` - Student viewing/attendance tracking
- `quiz_categories` - Quiz organization folders
- `quizzes` - Quiz definitions with scoring and timeout settings
- `quiz_pushes` - Quiz distribution instances with targeting
- `quiz_responses` - Student answers and engagement data with correctness tracking
- `student_quiz_queue` - Per-student quiz queue management

### File Structure

```
├── server.js           # Main server application
├── schema.sql          # Database schema
├── migrations/         # Database migrations
│   ├── 011_add_checkbox_question_type.sql
│   └── ...
├── courses/            # Course documentation (Git submodules)
│   └── esp32_basic/
│       ├── mkdocs.yml
│       └── docs/
├── scripts/
│   ├── bootstrapDemo.js     # Combined wipe + seed helper
│   ├── createTeacher.js     # Standalone teacher seeding utility
│   ├── createStudents.js    # Standalone student batch creator
│   ├── seedQuizzes.js       # Standalone quiz seeding utility
│   ├── testPushUndo.js      # Integration test for push/undo flow
│   ├── migrate-011.js       # Migration script for checkbox support
│   ├── checkQuizData.js     # Database inspection tool
│   └── fixCheckboxQuiz.js   # Quiz data repair utility
├── public/
│   ├── index.html        # Login page
│   ├── register.html     # Student registration
│   ├── teacher.html      # Teacher dashboard
│   ├── student.html      # Student interface
│   └── quiz-monitor.html # Quiz monitoring popup
├── example_quiz_export.json  # Example JSON export
├── example_quiz_export.md    # Example Markdown export
├── QUIZ_EXPORT_IMPORT.md     # Export/Import documentation
├── MARKDOWN_EXPORT_GUIDE.md  # Markdown export guide
└── package.json              # Dependencies and scripts
```

## Deployment on Debian 10

### System Setup

1. Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

2. Create application user:
```bash
sudo useradd -m -s /bin/bash esp32course
sudo su - esp32course
```

3. Clone and setup:
```bash
git clone <your-repo> esp32-course-platform
cd esp32-course-platform
git submodule update --init --recursive  # Initialize docs submodule
npm install --production
npm run init-db
```

### systemd Service

Create `/etc/systemd/system/esp32course.service`:

```ini
[Unit]
Description=ESP32 Course Platform
After=network.target

[Service]
Type=simple
User=esp32course
WorkingDirectory=/home/esp32course/esp32-course-platform
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

Start service:
```bash
sudo systemctl enable esp32course
sudo systemctl start esp32course
```

### Nginx Reverse Proxy

Install nginx:
```bash
sudo apt update
sudo apt install nginx
```

Create `/etc/nginx/sites-available/esp32course`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3030;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/esp32course /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Production Considerations

### Security
- Change JWT_SECRET in production
- Use environment variables for sensitive config
- Enable HTTPS/SSL
- Implement rate limiting
- Add input validation and sanitization

### Database
- Switch to PostgreSQL for better concurrency:
```bash
sudo apt install postgresql postgresql-contrib
sudo -u postgres createdb esp32course
```

- Update connection in `server.js` to use `pg` package

### Monitoring
- Add logging with winston
- Monitor with PM2 or systemd
- Set up health checks
- Monitor WebSocket connections

### Scaling
- Use Redis for WebSocket session storage
- Load balance with multiple Node.js instances  
- Separate database server
- CDN for static assets

## Troubleshooting

### Common Issues

1. **Port already in use**: Change PORT in environment or stop conflicting process
2. **Database locked**: Ensure SQLite file permissions are correct
3. **WebSocket connection fails**: Check firewall and proxy settings
4. **Students don't receive quizzes**: Verify authentication and WebSocket connection

### Logs

Check application logs:
```bash
sudo journalctl -u esp32course -f
```

### Database

View database content:
```bash
sqlite3 database.sqlite
.tables
SELECT * FROM users;
```

## Created by

Modulemore Co., Ltd.

## License
MIT License - see LICENSE file for details.