# AI Assistant Instructions

**CRITICAL: Read this file before performing ANY actions in this workspace**

## 1. Python Virtual Environment Detection

**ALWAYS check for Python virtual environments before executing Python-related commands:**

### Detection Priority (check in this order):

1. **Course-specific venv**: `courses/<course_name>/.venv/`
   - Individual courses may have their own isolated Python environments
   - Example: `courses/uno_watering_tutorial/.venv/`

2. **Shared courses venv**: `courses/venv/`
   - Shared virtual environment for all courses that don't have individual venvs

3. **Root workspace venv**: `.venv/` or `venv/`
   - Project-level virtual environment

### Usage Rules:

- **NEVER** use system Python directly (e.g., `python`, `python3`)
- **ALWAYS** activate the appropriate venv or use full path to venv Python
- For MkDocs builds: Check course directory for `.venv/` first, then fall back to `courses/venv/`

### Examples:

```bash
# BAD - Don't do this
python -m pip install mkdocs
mkdocs build

# GOOD - Use venv
source courses/uno_watering_tutorial/.venv/bin/activate && mkdocs build
# OR
courses/uno_watering_tutorial/.venv/bin/python -m mkdocs build
```

## 2. Script Detection and Usage

**ALWAYS check for existing scripts before running commands:**

### Available Scripts in Root Directory:

- **`start.sh`** - Start the server (handles all course builds automatically)
- **`setup.sh`** - Initial workspace setup
- **`deploy.sh`** - Deployment script
- **`auto-update.sh`** - Auto-update functionality
- **`setup-autoupdate.sh`** - Setup auto-update service
- **`init-db.sh`** - Database initialization
- **`test-service.sh`** - Service testing

### Script Discovery Process:

1. **List available scripts**: `ls -la *.sh` in root directory
2. **Check script content**: `cat <script>.sh` to understand what it does
3. **Use existing script** if it matches the intended action

### Examples:

```bash
# BAD - Manual server start
node server.js

# GOOD - Use existing script
./start.sh

# BAD - Manual git submodule update
cd courses/esp32_basic && git pull

# GOOD - Use auto-update script if available
./auto-update.sh
```

## 3. Git Submodule Management

**All courses in `courses/` directory are git submodules:**

- **esp32_basic** - ESP32 course
- **iot_basic_course** - IoT basics course
- **uno_watering_tutorial** - Arduino UNO watering tutorial

### Rules:

- When adding new courses: Use `git submodule add <url> courses/<name>`
- When removing courses: Use proper git submodule removal (see `removeFromGitmodules()` in server.js)
- Never manually clone into `courses/` directory - always use submodule commands

## 4. Server Management

### Starting the Server:

1. **ALWAYS** use `./start.sh` instead of `node server.js`
2. The start script automatically:
   - Updates git submodules
   - Detects and activates appropriate venvs
   - Builds all MkDocs documentation
   - Starts the Node.js server

### Server Features:

- Port: 3030 (default)
- Database: SQLite (`database.sqlite`)
- Uses PM2 for production (`ecosystem.config.js`)

## 5. Documentation Building (MkDocs)

**Never manually run `mkdocs build` without checking for venv:**

```bash
# WRONG
cd courses/esp32_basic && mkdocs build

# CORRECT - Check for course-specific venv first
if [ -d "courses/esp32_basic/.venv" ]; then
    source courses/esp32_basic/.venv/bin/activate
    cd courses/esp32_basic && mkdocs build
elif [ -d "courses/venv" ]; then
    source courses/venv/bin/activate
    cd courses/esp32_basic && mkdocs build
fi
```

**OR just use `./start.sh` which handles all of this automatically.**

## 6. Course Addition Workflow

When teachers add a new course through the web interface:

1. Server receives git repository URL
2. Executes `git submodule add <url> courses/<repo_name>`
3. Validates it's an MkDocs project (has `mkdocs.yml`)
4. Builds documentation automatically in background
5. Updates database with course information

## 7. Database Operations

- **Never** directly modify `database.sqlite`
- Use migration scripts in `migrations/` directory
- Check `schema.sql` for database structure
- Server auto-creates tables on startup if missing

## 8. Security Considerations

- Content Security Policy (CSP) enforced
- Path-based CSP: strict for main app, relaxed for `/docs/`
- JWT authentication for API endpoints
- bcrypt for password hashing

## 9. Environment Variables and Configuration

**CRITICAL: Always use `.env` file for configuration when creating scripts**

### .env File Location and Usage:

- **File**: `.env` in root directory
- **Purpose**: Stores all environment configuration (ports, hosts, secrets, paths)
- **Loading**: Scripts should source or load `.env` at the beginning

### Rules for Script Creation:

1. **ALWAYS check `.env` first** - See what variables are already defined
2. **DON'T hardcode values** - Use environment variables instead
3. **Load .env in scripts** - Use proper loading method for the script language
4. **Document new variables** - Add comments in `.env` for new variables

### Examples:

```bash
# BAD - Hardcoded values in script
#!/bin/bash
HOST="127.0.0.1"
PORT="3030"
node server.js

# GOOD - Load from .env
#!/bin/bash
# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi
node server.js
```

```javascript
// BAD - Hardcoded values
const PORT = 3030;
const HOST = '127.0.0.1';

// GOOD - Use environment variables
require('dotenv').config();
const PORT = process.env.PORT || 3030;
const HOST = process.env.HOST || '127.0.0.1';
```

### Common Variables in .env:

- `NODE_ENV` - Environment (production/development)
- `HOST` - Server host
- `PORT` - Server port
- `BASE_URL` - Base URL for the application
- `DB_PATH` - Database file path
- `JWT_SECRET` - JWT secret key
- Database credentials, API keys, etc.

### When Creating New Scripts:

1. Check existing `.env` for available variables
2. Use those variables instead of hardcoding
3. Add new variables to `.env` if needed
4. Update `.env.example` if it exists
5. Document what each variable does

## 10. Terminal Working Directory Management

**ALWAYS preserve the original working directory when running commands in different locations:**

### Rules:

1. **Before changing directories**: Note the current working directory
2. **After running commands elsewhere**: Return to the original directory
3. **Use `cd` with absolute paths** to avoid confusion
4. **Preferred pattern**: Use `cd /path && command` for one-time operations

### Examples:

```bash
# BAD - Changes directory and stays there
cd /Volumes/ExHDD/dev/tutoriaz/courses/uno_watering_tutorial
../venv/bin/python -m mkdocs build

# GOOD - Returns to original directory after operation
cd /Volumes/ExHDD/dev/tutoriaz/courses/uno_watering_tutorial && ../venv/bin/python -m mkdocs build --clean
cd /Volumes/ExHDD/dev/tutoriaz

# BEST - Single command that doesn't affect working directory
(cd /Volumes/ExHDD/dev/tutoriaz/courses/uno_watering_tutorial && ../venv/bin/python -m mkdocs build --clean)
```

### Why This Matters:

- Maintains context for subsequent commands
- Prevents accidental operations in wrong directory
- Makes command history more predictable
- Easier for users to understand current state

## Quick Reference Checklist

Before running ANY command, ask yourself:

- [ ] Is there a `.sh` script that does this?
- [ ] Do I need Python? Which venv should I use?
- [ ] Am I in a course directory? Does it have its own `.venv`?
- [ ] Am I modifying git submodules? Should I use git submodule commands?
- [ ] Am I starting the server? Should I use `./start.sh`?
- [ ] Am I creating a script? Did I check and use `.env` variables?
- [ ] Will this command change directories? Do I need to return to the original location?

## Emergency Recovery

If things break:

```bash
# Reset to clean state
./start.sh

# Database issues
./init-db.sh

# Submodule issues
git submodule update --init --recursive

# Service issues (production)
./test-service.sh
```

---

**Remember: These instructions exist to prevent common mistakes. Always check before acting!**
