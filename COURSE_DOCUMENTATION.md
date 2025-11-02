# Course Documentation Setup Guide

## Overview

Teachers can add course documentation that displays in an iframe for both teacher and student views. Documentation can be hosted locally or externally.

## Documentation Path Options

### Option 1: Local Documentation (Recommended)

Use local paths to serve documentation from your server. This avoids CSP (Content Security Policy) issues with external sites.

**Format:** `/docs/course_name/site/index.html`

**Examples:**
```
/docs/esp32_basic/site/index.html
/docs/python_intro/site/index.html
/docs/iot_basic_course/site/index.html
```

**Benefits:**
- ✅ No CSP frame-ancestors issues
- ✅ Faster loading (local files)
- ✅ Works offline
- ✅ Full control over content
- ✅ Secured by your own authentication

**Setup Steps:**

1. **Create course directory:**
   ```bash
   mkdir -p courses/my_course/docs
   ```

2. **Add MkDocs configuration:**
   ```bash
   cd courses/my_course
   nano mkdocs.yml
   ```

3. **Basic mkdocs.yml:**
   ```yaml
   site_name: My Course
   theme:
     name: material
   nav:
     - Home: index.md
     - Module 1: module-01.md
   ```

4. **Create documentation files:**
   ```bash
   mkdir docs
   echo "# Welcome" > docs/index.md
   echo "# Module 1" > docs/module-01.md
   ```

5. **Build documentation:**
   ```bash
   # Run setup to create venv and install MkDocs
   ./setup.sh
   
   # Or manually build specific course
   cd courses/my_course
   mkdocs build
   ```

6. **Verify site folder created:**
   ```bash
   ls courses/my_course/site/
   # Should see: index.html, assets/, etc.
   ```

7. **Use path in course creation:**
   - Documentation Path: `/docs/my_course/site/index.html`

### Option 2: Full URL (External Hosting)

Use complete URLs for externally hosted documentation.

**Format:** `https://example.com/docs/` or `http://localhost:3030/docs/course/site/`

**Examples:**
```
https://docs.mysite.com/esp32_course/
http://localhost:3030/docs/esp32_basic/site/
https://yourusername.github.io/course-docs/
```

**⚠️ CSP Warning:**
External sites may block iframe embedding if they have `frame-ancestors 'self'` in their CSP headers. You cannot control this - it's the external site's security policy.

**Workaround:**
- Students can use "Open in new tab" button
- Consider hosting locally instead

### Option 3: GitHub Repository

Provide GitHub repo URL and it will automatically convert to GitHub Pages.

**Format:** `https://github.com/owner/repo`

**Examples:**
```
https://github.com/myuser/esp32-course
https://github.com/organization/python-tutorial
```

**Requirements:**
- Repository must have GitHub Pages enabled
- Documentation must be built and committed to the repo
- Uses the `docs_branch` field (default: "main")

**How it works:**
- Input: `https://github.com/myuser/esp32-course`
- Converts to: `https://myuser.github.io/esp32-course/`

## Documentation Workflow

### Development Workflow

1. **Edit markdown files** in `courses/my_course/docs/`
2. **Preview changes locally:**
   ```bash
   cd courses/my_course
   mkdocs serve
   # View at http://localhost:8000
   ```
3. **Build for production:**
   ```bash
   mkdocs build
   # Creates/updates site/ folder
   ```
4. **Server restart** (if using npm start):
   - MkDocs builds automatically on startup
   - Or run `mkdocs build` manually

### Automatic Building

Documentation is automatically built when:
- ✅ Running `./setup.sh`
- ✅ Running `npm start` (via start.sh)
- ✅ Running `./auto-update.sh`

### Manual Building

Build a specific course:
```bash
cd courses/my_course
source ../venv/bin/activate
mkdocs build
deactivate
```

Build all courses:
```bash
cd courses
source venv/bin/activate
for dir in */; do
  if [ -f "$dir/mkdocs.yml" ]; then
    cd "$dir"
    mkdocs build
    cd ..
  fi
done
deactivate
```

## Course Creation Examples

### Example 1: Local Documentation

**In Teacher Dashboard:**
- Title: "ESP32 Programming"
- Description: "Learn ESP32 microcontroller programming"
- Documentation Path: `/docs/esp32_basic/site/index.html`
- Passkey: `esp32-2024`

### Example 2: External URL

**In Teacher Dashboard:**
- Title: "Python Basics"
- Description: "Introduction to Python programming"
- Documentation Path: `https://docs.python-course.org/`
- Passkey: `python123`

### Example 3: GitHub Pages

**In Teacher Dashboard:**
- Title: "IoT Course"
- Description: "Internet of Things fundamentals"
- Documentation Path: `https://github.com/myuser/iot-course`
- Docs Branch: `main`
- Passkey: `iot2024`

## File Structure

```
tutoriaz/
├── courses/
│   ├── venv/                    # Shared Python virtual environment
│   ├── esp32_basic/
│   │   ├── mkdocs.yml          # MkDocs configuration
│   │   ├── docs/               # Source markdown files
│   │   │   ├── index.md
│   │   │   └── module-01.md
│   │   └── site/               # Built HTML (gitignored)
│   │       ├── index.html
│   │       └── assets/
│   └── iot_basic_course/
│       ├── mkdocs.yml
│       ├── docs/
│       └── site/               # Created after build
└── public/
    └── docs -> ../courses/     # Served at /docs endpoint
```

## Serving Documentation

The server automatically serves the `courses/` directory at `/docs`:

```javascript
// In server.js
app.use('/docs', express.static('courses'));
```

This means:
- `courses/esp32_basic/site/index.html` → `http://localhost:3030/docs/esp32_basic/site/index.html`
- `courses/iot_basic/site/index.html` → `http://localhost:3030/docs/iot_basic/site/index.html`

## Troubleshooting

### Issue: "site folder not found"

**Solution:**
```bash
# Setup Python environment and build docs
./setup.sh

# Or manually build
cd courses/my_course
source ../venv/bin/activate
mkdocs build
deactivate
```

### Issue: "CSP frame-ancestors error"

**Cause:** External site blocks iframe embedding

**Solutions:**
1. Use local documentation path instead (`/docs/...`)
2. Contact external site admin to allow your domain
3. Use "Open in new tab" button (workaround)

### Issue: "Documentation not updating"

**Solution:**
```bash
# Rebuild documentation
cd courses/my_course
mkdocs build

# Or restart server (rebuilds all docs)
npm start
```

### Issue: "Python venv not found"

**Solution:**
```bash
# Run setup to create virtual environment
./setup.sh
```

## MkDocs Configuration Tips

### Basic Theme (Material)

```yaml
site_name: My Course
theme:
  name: material
  palette:
    primary: blue
    accent: cyan
nav:
  - Home: index.md
  - Lessons:
    - Module 1: lessons/module-01.md
    - Module 2: lessons/module-02.md
```

### Code Highlighting

```yaml
markdown_extensions:
  - pymdownx.highlight:
      anchor_linenums: true
  - pymdownx.superfences
  - pymdownx.inlinehilite
```

### Search

```yaml
plugins:
  - search
```

## Best Practices

1. **Use local paths** for documentation to avoid CSP issues
2. **Build documentation** before starting the server
3. **Gitignore site/** folders (already configured)
4. **Test documentation** with `mkdocs serve` before deploying
5. **Keep docs organized** with clear navigation structure
6. **Use relative paths** in documentation links
7. **Include images** in `docs/assets/images/` folder
8. **Version control** markdown sources, not built HTML

## Security Notes

- Local documentation respects server authentication
- Students must be logged in to view `/docs` content
- External URLs bypass server authentication
- CSP headers protect against XSS attacks
- `frame-ancestors` prevents clickjacking

## Resources

- [MkDocs Documentation](https://www.mkdocs.org/)
- [Material Theme](https://squidfunk.github.io/mkdocs-material/)
- [Markdown Guide](https://www.markdownguide.org/)
- [GitHub Pages Setup](https://docs.github.com/en/pages)
