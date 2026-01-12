const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const xss = require('xss');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const sharp = require('sharp');
const { execSync, spawn } = require('child_process');

// Custom XSS filter options for markdown content with code blocks
const xssOptionsForMarkdown = new xss.FilterXSS({
    whiteList: {
        // Allow code-related tags
        code: [],
        pre: [],
        // Block potentially dangerous tags
    },
    stripIgnoreTag: false,
    stripIgnoreTagBody: ['script', 'style'],
    // Don't escape content inside code/pre tags
    escapeHtml: (html) => {
        // Preserve content inside backticks (inline code) and code blocks
        return html;
    }
});

// Simple sanitization that only removes dangerous tags but preserves < and >
function sanitizeMarkdownContent(content) {
    if (!content) return '';
    // Remove script and style tags
    let sanitized = content.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    // Remove on* event handlers
    sanitized = sanitized.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
    sanitized = sanitized.replace(/\son\w+\s*=\s*[^\s>]*/gi, '');
    return sanitized.trim();
}

// Helper function to validate if a URL is a git repository
function isGitUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    // Check for SSH format: git@github.com:user/repo.git or git@github.com:user/repo
    if (/^git@[\w\-\.]+:[\w\-\/]+/.test(trimmed)) return true;
    // Check for HTTPS with .git
    if (/^https?:\/\/.*\.git$/i.test(trimmed)) return true;
    // Check for HTTPS without .git from common platforms
    if (/^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org)/i.test(trimmed)) return true;
    return false;
}

// Helper function to sanitize folder name from git URL
function getRepoFolderName(gitUrl) {
    // Extract repo name from SSH URL (e.g., git@github.com:user/repo.git -> repo)
    let match = gitUrl.match(/:([^\/]+\/)?([^\/]+?)(\.git)?$/);
    if (match && match[2]) {
        return match[2].replace(/\.git$/, '');
    }
    // Extract repo name from HTTPS URL (e.g., https://github.com/user/repo.git -> repo)
    match = gitUrl.match(/\/([^\/]+?)(\.git)?$/);
    if (match && match[1]) {
        return match[1].replace(/\.git$/, '');
    }
    // Fallback to UUID if can't extract
    return `course_${uuidv4().substring(0, 8)}`;
}

// Helper function to check if a directory contains an MkDocs project
function isMkDocsProject(dirPath) {
    const mkdocsYmlPath = path.join(dirPath, 'mkdocs.yml');
    const mkdocsYamlPath = path.join(dirPath, 'mkdocs.yaml');
    return fs.existsSync(mkdocsYmlPath) || fs.existsSync(mkdocsYamlPath);
}

// Helper function to read site_url from mkdocs.yml
function getMkDocsSiteUrl(dirPath) {
    try {
        const mkdocsYmlPath = path.join(dirPath, 'mkdocs.yml');
        const mkdocsYamlPath = path.join(dirPath, 'mkdocs.yaml');

        let configPath = null;
        if (fs.existsSync(mkdocsYmlPath)) {
            configPath = mkdocsYmlPath;
        } else if (fs.existsSync(mkdocsYamlPath)) {
            configPath = mkdocsYamlPath;
        }

        if (!configPath) return null;

        const content = fs.readFileSync(configPath, 'utf8');
        // Simple regex to extract site_url (not full YAML parsing)
        const match = content.match(/^site_url:\s*(.+)$/m);
        if (match && match[1]) {
            return match[1].trim();
        }
        return null;
    } catch (error) {
        console.error('Error reading mkdocs config:', error.message);
        return null;
    }
}

// Helper function to add entry to .gitmodules
function addToGitmodules(repoUrl, repoFolderName, branch = 'main') {
    try {
        const gitmodulesPath = path.join(__dirname, '.gitmodules');
        const submodulePath = `courses/${repoFolderName}`;

        // Check if entry already exists
        if (fs.existsSync(gitmodulesPath)) {
            const content = fs.readFileSync(gitmodulesPath, 'utf8');
            if (content.includes(`path = ${submodulePath}`)) {
                console.log('.gitmodules entry already exists, skipping');
                return;
            }
        }

        // Add new entry
        const entry = `\n[submodule "${submodulePath}"]\n\tpath = ${submodulePath}\n\turl = ${repoUrl}\n\tbranch = ${branch}\n`;
        fs.appendFileSync(gitmodulesPath, entry, 'utf8');
        console.log(`Added ${submodulePath} to .gitmodules`);
    } catch (error) {
        console.error('Error updating .gitmodules:', error.message);
    }
}

// Helper function to remove entry from .gitmodules
function removeFromGitmodules(repoFolderName) {
    try {
        const submodulePath = `courses/${repoFolderName}`;

        // Check if we're in a git repository
        let isGitRepo = false;
        try {
            execSync('git rev-parse --git-dir', { cwd: __dirname, stdio: 'ignore' });
            isGitRepo = true;
        } catch (e) {
            console.log('Not in a git repository, will manually remove from .gitmodules');
        }

        if (isGitRepo) {
            // Use proper git submodule commands
            try {
                // Deinitialize the submodule
                execSync(`git submodule deinit -f "${submodulePath}"`, {
                    cwd: __dirname,
                    stdio: 'pipe'
                });
                console.log(`Deinitialized submodule: ${submodulePath}`);

                // Remove from git index and working tree
                execSync(`git rm -f "${submodulePath}"`, {
                    cwd: __dirname,
                    stdio: 'pipe'
                });
                console.log(`Removed submodule from git: ${submodulePath}`);

                // Remove the .git/modules entry
                const modulesPath = path.join(__dirname, '.git', 'modules', 'courses', repoFolderName);
                if (fs.existsSync(modulesPath)) {
                    execSync(`rm -rf "${modulesPath}"`, { cwd: __dirname });
                    console.log(`Removed .git/modules/${submodulePath}`);
                }
            } catch (e) {
                console.error(`Error removing submodule with git commands: ${e.message}`);
                // Fall back to manual removal
                isGitRepo = false;
            }
        }

        // Manual removal if not in git repo or git commands failed
        if (!isGitRepo) {
            const gitmodulesPath = path.join(__dirname, '.gitmodules');
            if (fs.existsSync(gitmodulesPath)) {
                let content = fs.readFileSync(gitmodulesPath, 'utf8');

                // Remove the submodule section
                const regex = new RegExp(`\\[submodule "${submodulePath}"\\][^\\[]*`, 'g');
                content = content.replace(regex, '');

                // Clean up extra newlines
                content = content.replace(/\n{3,}/g, '\n\n').trim() + '\n';

                fs.writeFileSync(gitmodulesPath, content, 'utf8');
                console.log(`Manually removed ${submodulePath} from .gitmodules`);
            }
        }
    } catch (error) {
        console.error('Error removing from .gitmodules:', error.message);
    }
}

// Helper function to remove course directory
function removeCourseDirectory(repoFolderName) {
    try {
        const coursePath = path.join(__dirname, 'courses', repoFolderName);
        if (fs.existsSync(coursePath)) {
            execSync(`rm -rf "${coursePath}"`, { cwd: __dirname });
            console.log(`Removed course directory: courses/${repoFolderName}`);
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error removing course directory:', error.message);
        return false;
    }
}

// Helper function to build MkDocs documentation
async function buildMkDocsSite(repoFolderName, onProgress = null) {
    try {
        const coursePath = path.join(__dirname, 'courses', repoFolderName);
        const venvPath = path.join(__dirname, 'courses', 'venv');

        // Check if course directory exists
        if (!fs.existsSync(coursePath)) {
            throw new Error(`Course directory not found: ${repoFolderName}`);
        }

        // Check if mkdocs.yml exists
        if (!isMkDocsProject(coursePath)) {
            throw new Error('Not a valid MkDocs project');
        }

        // Check if virtual environment exists
        if (!fs.existsSync(venvPath)) {
            throw new Error('Python virtual environment not found. Run setup.sh first.');
        }

        console.log(`Building MkDocs site for: ${repoFolderName}`);
        if (onProgress) onProgress({ step: 'building', message: 'Building documentation site...', progress: 95 });

        return new Promise((resolve, reject) => {
            // Run mkdocs build using the virtual environment
            const activateCmd = `source "${venvPath}/bin/activate"`;
            const buildCmd = `cd "${coursePath}" && mkdocs build --clean`;
            const fullCmd = `${activateCmd} && ${buildCmd}`;

            const buildProcess = spawn('bash', ['-c', fullCmd], {
                cwd: __dirname
            });

            let stdout = '';
            let stderr = '';

            buildProcess.stdout.on('data', (data) => {
                stdout += data.toString();
                console.log(`MkDocs build: ${data.toString().trim()}`);
            });

            buildProcess.stderr.on('data', (data) => {
                stderr += data.toString();
                console.error(`MkDocs build error: ${data.toString().trim()}`);
            });

            buildProcess.on('close', (code) => {
                if (code === 0) {
                    console.log(`Successfully built MkDocs site for ${repoFolderName}`);
                    resolve({ success: true, output: stdout });
                } else {
                    reject(new Error(`MkDocs build failed with code ${code}: ${stderr}`));
                }
            });

            buildProcess.on('error', (err) => {
                reject(new Error(`Failed to run mkdocs build: ${err.message}`));
            });

            // Timeout after 120 seconds
            setTimeout(() => {
                buildProcess.kill();
                reject(new Error('MkDocs build timed out'));
            }, 120000);
        });
    } catch (error) {
        console.error('Error building MkDocs site:', error.message);
        throw error;
    }
}

// Helper function to clone git repository as submodule
async function cloneGitRepoAsSubmodule(gitUrl, targetDir, onProgress = null) {
    try {
        const coursesDir = path.join(__dirname, 'courses');

        // Ensure courses directory exists
        if (!fs.existsSync(coursesDir)) {
            fs.mkdirSync(coursesDir, { recursive: true });
        }

        const repoFolderName = getRepoFolderName(gitUrl);
        const repoPath = path.join(coursesDir, repoFolderName);

        // Check if folder already exists
        if (fs.existsSync(repoPath)) {
            // Check if it's an MkDocs project
            if (isMkDocsProject(repoPath)) {
                console.log(`Repository already exists at courses/${repoFolderName}, skipping clone`);
                if (onProgress) onProgress({ step: 'exists', message: 'Repository already exists, using cached version' });
                const siteUrl = getMkDocsSiteUrl(repoPath);
                const localPath = `/docs/${repoFolderName}/site/`;
                return { success: true, path: repoPath, folderName: repoFolderName, siteUrl, localPath };
            } else {
                throw new Error('Directory exists but is not an MkDocs project');
            }
        }

        console.log(`Adding git submodule: ${gitUrl} to courses/${repoFolderName}`);
        if (onProgress) onProgress({ step: 'starting', message: 'Initializing repository clone...' });

        // Check if we're in a git repository
        let isGitRepo = false;
        try {
            execSync('git rev-parse --git-dir', { cwd: __dirname, stdio: 'ignore' });
            isGitRepo = true;
        } catch (e) {
            console.log('Not in a git repository, will use regular clone');
        }

        // Use git submodule add for proper submodule setup
        const cloneSuccess = await new Promise((resolve, reject) => {
            if (onProgress) onProgress({ step: 'cloning', message: 'Adding as git submodule...', progress: 10 });

            // Use git submodule add if in a git repo, otherwise fall back to regular clone
            const gitArgs = isGitRepo
                ? ['submodule', 'add', '--progress', gitUrl, `courses/${repoFolderName}`]
                : ['clone', '--depth', '1', '--progress', gitUrl, repoPath];

            const gitProcess = spawn('git', gitArgs, {
                cwd: __dirname
            });

            let errorOutput = '';

            gitProcess.stderr.on('data', (data) => {
                const output = data.toString();
                errorOutput += output;

                // Parse git progress (git outputs to stderr)
                if (output.includes('Receiving objects:') || output.includes('Resolving deltas:') || output.includes('Cloning into')) {
                    const percentMatch = output.match(/(\d+)%/);
                    if (percentMatch && onProgress) {
                        const percent = parseInt(percentMatch[1]);
                        const adjustedPercent = 10 + (percent * 0.7); // Scale to 10-80%
                        onProgress({
                            step: 'cloning',
                            message: `Cloning repository... ${percent}%`,
                            progress: Math.floor(adjustedPercent)
                        });
                    }
                }
            });

            gitProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(true);
                } else {
                    reject(new Error(`Git operation failed: ${errorOutput}`));
                }
            });

            gitProcess.on('error', (err) => {
                reject(new Error(`Failed to spawn git: ${err.message}`));
            });

            // Timeout after 60 seconds
            setTimeout(() => {
                gitProcess.kill();
                reject(new Error('Clone operation timed out'));
            }, 60000);
        });

        if (!cloneSuccess) {
            throw new Error('Clone failed');
        }

        if (onProgress) onProgress({ step: 'validating', message: 'Validating MkDocs project...', progress: 85 });

        // Verify it's an MkDocs project
        if (!isMkDocsProject(repoPath)) {
            // Cleanup cloned repo
            try {
                if (isGitRepo) {
                    // Remove as submodule
                    execSync(`git submodule deinit -f "courses/${repoFolderName}"`, { cwd: __dirname, stdio: 'ignore' });
                    execSync(`git rm -f "courses/${repoFolderName}"`, { cwd: __dirname, stdio: 'ignore' });
                    execSync(`rm -rf ".git/modules/courses/${repoFolderName}"`, { cwd: __dirname, stdio: 'ignore' });
                }
                execSync(`rm -rf "${repoPath}"`, { cwd: __dirname, stdio: 'ignore' });
            } catch (cleanupError) {
                console.error('Error during cleanup:', cleanupError.message);
            }
            throw new Error('Repository is not an MkDocs project (missing mkdocs.yml or mkdocs.yaml)');
        }

        if (onProgress) onProgress({ step: 'finalizing', message: 'Setting up documentation...', progress: 90 });

        // If not using git submodule add (not in git repo), manually add to .gitmodules
        if (!isGitRepo) {
            addToGitmodules(gitUrl, repoFolderName, 'main');
        } else {
            console.log(`Successfully added courses/${repoFolderName} as git submodule`);
        }

        // Read site_url from mkdocs.yml
        const siteUrl = getMkDocsSiteUrl(repoPath);

        // Generate local path for serving (e.g., /docs/repo_name/site/)
        const localPath = `/docs/${repoFolderName}/site/`;

        console.log(`Successfully cloned MkDocs repository to courses/${repoFolderName}`);
        if (siteUrl) {
            console.log(`MkDocs site_url: ${siteUrl}`);
        }
        console.log(`Local docs path: ${localPath}`);

        // Build the MkDocs site in background (don't wait)
        // This allows the HTTP response to return quickly
        setImmediate(async () => {
            try {
                if (onProgress) onProgress({ step: 'building', message: 'Building documentation site...', progress: 95 });
                await buildMkDocsSite(repoFolderName, onProgress);
                if (onProgress) onProgress({ step: 'complete', message: 'Repository cloned and built successfully!', progress: 100 });
                console.log(`Background build completed for ${repoFolderName}`);
            } catch (buildError) {
                console.error('Warning: Background MkDocs build failed:', buildError.message);
                if (onProgress) onProgress({ step: 'warning', message: 'Cloned successfully but build failed. You may need to build manually.', progress: 100 });
            }
        });

        // Return immediately with success (build happens in background)
        if (onProgress) onProgress({ step: 'complete', message: 'Repository cloned successfully! Building in background...', progress: 95 });

        return { success: true, path: repoPath, folderName: repoFolderName, siteUrl, localPath };

    } catch (error) {
        console.error('Error cloning git repository:', error.message);
        if (onProgress) onProgress({ step: 'error', message: error.message, progress: 0 });
        throw error;
    }
}

const app = express();

// Configuration
const PORT = process.env.PORT || 3030;
// Default to 0.0.0.0 in production to allow external connections
// Use 127.0.0.1 only in development for security
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const BASE_URL = process.env.BASE_URL || `http://${HOST}:${PORT}`;
// Use DB_PATH environment variable if set, otherwise default to local database.sqlite
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

// Application version and build info
let APP_VERSION = '0.0.0';
let APP_BUILD_DATE = null; // ISO string
try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    if (pkg && pkg.version) {
        APP_VERSION = pkg.version;
    }
} catch (e) {
    console.warn('Could not read package.json for version:', e.message);
}

// Try to read last git commit date (ISO) if available
try {
    const { execSync } = require('child_process');
    const gitDate = execSync('git log -1 --format=%cI', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim();
    if (gitDate) {
        APP_BUILD_DATE = gitDate; // ISO 8601
    }
} catch (e) {
    // fallback: file mtime of package.json
    try {
        const stats = fs.statSync(path.join(__dirname, 'package.json'));
        APP_BUILD_DATE = stats.mtime.toISOString();
    } catch (e2) {
        APP_BUILD_DATE = null;
    }
}

// Database connection
const db = new sqlite3.Database(DB_PATH);

// Initialize required tables
function initializeDatabase() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS courses (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                access_code_hash TEXT,
                FOREIGN KEY(created_by) REFERENCES users(id)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS course_enrollments (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                enrolled_at TEXT NOT NULL,
                UNIQUE(course_id, student_id),
                FOREIGN KEY(course_id) REFERENCES courses(id),
                FOREIGN KEY(student_id) REFERENCES users(id)
            )
        `);

        db.run(`
            CREATE INDEX IF NOT EXISTS idx_course_enrollments_course
            ON course_enrollments(course_id)
        `);

        db.run(`
            CREATE INDEX IF NOT EXISTS idx_course_enrollments_student
            ON course_enrollments(student_id)
        `);

        // Ensure legacy tables get access_code_hash column
        db.all('PRAGMA table_info(courses)', [], (err, rows) => {
            if (err) {
                console.error('PRAGMA table_info(courses) error:', err);
                return;
            }

            const hasAccessCodeColumn = Array.isArray(rows) && rows.some(col => col.name === 'access_code_hash');
            if (!hasAccessCodeColumn) {
                db.run('ALTER TABLE courses ADD COLUMN access_code_hash TEXT', (alterErr) => {
                    if (alterErr) {
                        console.error('Error adding access_code_hash column:', alterErr);
                    } else {
                        console.log('Added access_code_hash column to courses table');
                    }
                });
            }
        });

        // Assignment tables
        db.run(`
            CREATE TABLE IF NOT EXISTS assignments (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'closed',
                opened_at TEXT,
                deadline_type TEXT NOT NULL DEFAULT 'specific',
                deadline_datetime TEXT,
                deadline_duration_hours INTEGER,
                deadline_duration_minutes INTEGER,
                auto_close BOOLEAN DEFAULT 1,
                image_path TEXT,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS assignment_submissions (
                id TEXT PRIMARY KEY,
                assignment_id TEXT NOT NULL,
                student_id TEXT NOT NULL,
                course_id TEXT NOT NULL,
                content TEXT NOT NULL,
                image_path TEXT,
                submitted_at TEXT NOT NULL,
                is_late BOOLEAN DEFAULT 0,
                score REAL,
                feedback TEXT,
                graded_at TEXT,
                graded_by TEXT,
                FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
                FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
                FOREIGN KEY (graded_by) REFERENCES users(id) ON DELETE SET NULL,
                UNIQUE(assignment_id, student_id)
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS reading_progress (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                course_id TEXT NOT NULL,
                section_id TEXT NOT NULL,
                section_title TEXT,
                page_url TEXT,
                completed_at TEXT NOT NULL,
                session_id TEXT,
                time_spent_seconds INTEGER DEFAULT 0,
                progress_data TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS course_progress_summary (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                course_id TEXT NOT NULL,
                total_sections INTEGER DEFAULT 0,
                completed_sections INTEGER DEFAULT 0,
                progress_percentage REAL DEFAULT 0,
                first_accessed_at TEXT,
                last_accessed_at TEXT,
                chapter_progress TEXT,
                UNIQUE(user_id, course_id),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS course_sections (
                id TEXT PRIMARY KEY,
                course_id TEXT NOT NULL,
                section_id TEXT NOT NULL,
                section_title TEXT,
                page_url TEXT,
                section_order INTEGER DEFAULT 0,
                parent_section TEXT,
                chapter_id TEXT,
                is_quiz_trigger INTEGER DEFAULT 0,
                quiz_id TEXT,
                UNIQUE(course_id, section_id),
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS reading_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                course_id TEXT NOT NULL,
                started_at TEXT NOT NULL,
                ended_at TEXT,
                total_time_seconds INTEGER DEFAULT 0,
                pages_visited TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
            )
        `);

        db.run(`CREATE INDEX IF NOT EXISTS idx_assignments_course ON assignments(course_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assignment_submissions_assignment ON assignment_submissions(assignment_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_assignment_submissions_student ON assignment_submissions(student_id)`);
    });
}

initializeDatabase();

// Middleware
// Basic security headers with CSP configuration
// Apply stricter CSP for main app, relaxed for documentation
app.use((req, res, next) => {
    // For documentation paths, use relaxed CSP to allow MkDocs inline scripts
    if (req.path.startsWith('/docs/')) {
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: [
                        "'self'",
                        "'unsafe-inline'", // Allow inline scripts for MkDocs
                        "https://cdn.jsdelivr.net",
                        "https://cdnjs.cloudflare.com",
                        "https://unpkg.com" // Allow unpkg for mermaid and other dependencies
                    ],
                    styleSrc: [
                        "'self'",
                        "'unsafe-inline'",
                        "https://cdnjs.cloudflare.com",
                        "https://fonts.googleapis.com"
                    ],
                    connectSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:", "blob:"],
                    fontSrc: [
                        "'self'",
                        "https://cdnjs.cloudflare.com",
                        "https://fonts.gstatic.com"
                    ],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'self'", "https://tutoriaz.modulemore.com", "https://*.modulemore.com"]
                }
            }
        })(req, res, next);
    } else {
        // Stricter CSP for main application
        helmet({
            contentSecurityPolicy: {
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: [
                        "'self'",
                        "https://cdn.jsdelivr.net",
                        "https://cdnjs.cloudflare.com"
                    ],
                    styleSrc: [
                        "'self'",
                        "'unsafe-inline'", // Keep for inline styles (less risky than inline scripts)
                        "https://cdnjs.cloudflare.com",
                        "https://fonts.googleapis.com"
                    ],
                    connectSrc: ["'self'"],
                    imgSrc: ["'self'", "data:", "https:", "blob:"],
                    fontSrc: [
                        "'self'",
                        "https://cdnjs.cloudflare.com",
                        "https://fonts.gstatic.com"
                    ],
                    objectSrc: ["'none'"],
                    mediaSrc: ["'self'"],
                    frameSrc: ["'self'", "https://tutoriaz.modulemore.com", "https://*.modulemore.com"]
                }
            }
        })(req, res, next);
    }
});
// CORS - keep default permissive for now (adjust in production)
app.use(cors());
// Limit JSON body size to mitigate large payload abuse
app.use(express.json({ limit: '8kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(express.static('public'));

// Rate limiter for auth endpoints (login / register)
// Disabled - bypass rate limiting
const authLimiter = (req, res, next) => next();

// Serve course documentation statically
app.use('/docs', express.static('courses'));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
const assignmentsUploadsDir = path.join(uploadsDir, 'assignments');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(assignmentsUploadsDir)) {
    fs.mkdirSync(assignmentsUploadsDir, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static('uploads'));

// Configure multer for file uploads
const storage = multer.memoryStorage(); // Store in memory for processing
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit before compression
    },
    fileFilter: (req, file, cb) => {
        // Accept images only
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Image compression function
async function compressImage(buffer, filename) {
    try {
        const image = sharp(buffer);
        const metadata = await image.metadata();

        // Scale down if too large (max 800px width/height)
        let processedImage = image;
        if (metadata.width > 800 || metadata.height > 800) {
            processedImage = image.resize(800, 800, {
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        // Always convert to WebP for better compression
        // WebP provides 25-35% better compression than JPEG/PNG
        const compressed = await processedImage
            .webp({
                quality: 80,
                effort: 4  // Compression effort (0-6), 4 is good balance
            })
            .toBuffer();

        // Return buffer and new filename with .webp extension
        const nameWithoutExt = path.basename(filename, path.extname(filename));
        const newFilename = `${nameWithoutExt}.webp`;

        return { buffer: compressed, filename: newFilename };
    } catch (error) {
        console.error('Image compression error:', error);
        throw new Error('Failed to process image');
    }
}

const resolvePath = (value) => {
    if (!value) {
        return null;
    }
    return path.resolve(__dirname, value);
};

const loadHttpsCredentials = () => {
    const keyPathRaw = process.env.HTTPS_KEY_PATH;
    const certPathRaw = process.env.HTTPS_CERT_PATH;

    if (!keyPathRaw || !certPathRaw) {
        return null;
    }

    try {
        const keyPath = resolvePath(keyPathRaw.trim());
        const certPath = resolvePath(certPathRaw.trim());
        const credentials = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };

        const caEnv = process.env.HTTPS_CA_PATH;
        if (caEnv) {
            const caPaths = caEnv
                .split(',')
                .map(item => item.trim())
                .filter(Boolean)
                .map(item => resolvePath(item));

            if (caPaths.length === 1) {
                credentials.ca = fs.readFileSync(caPaths[0]);
            } else if (caPaths.length > 1) {
                credentials.ca = caPaths.map(caPath => fs.readFileSync(caPath));
            }
        }

        if (process.env.HTTPS_PASSPHRASE) {
            credentials.passphrase = process.env.HTTPS_PASSPHRASE;
        }

        return credentials;
    } catch (error) {
        console.error('Failed to load HTTPS credentials:', error);
        return null;
    }
};

let isHttpsEnabled = false;
let server;

const httpsCredentials = loadHttpsCredentials();
if (httpsCredentials) {
    try {
        server = https.createServer(httpsCredentials, app);
        isHttpsEnabled = true;
        console.log('HTTPS enabled using provided certificate paths.');
    } catch (error) {
        console.error('Error creating HTTPS server. Falling back to HTTP:', error);
    }
}

if (!server) {
    server = http.createServer(app);
}

const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// In-memory stores for active connections and pushes
const connectedUsers = new Map(); // socketId -> {userId, username, role, connectedAt}
// Quiz management
const activePushes = new Map(); // push_id -> push metadata
const activePushesByQuiz = new Map(); // quiz_id -> push metadata
const quizQueue = []; // Array of queued quiz pushes (global, being deprecated)
let currentActiveQuiz = null; // Currently active quiz

// Student-side queue management (NEW)
const studentQueues = new Map(); // userId -> Array of { push_id, quiz_id, quiz, added_at }

const ATTENDANCE_VIEWING_STATUSES = new Set(['viewing', 'not_viewing']);
const ATTENDANCE_ENDED_STATUS = 'ended';

// Attendance session metadata (in-memory)
const attendanceSessionTabMap = new Map(); // sessionId -> tabId
const studentActiveTabMap = new Map(); // studentId -> tabId
const studentActiveSessionMap = new Map(); // studentId -> sessionId

const setActiveTabForSession = (sessionId, tabId = null) => {
    if (!sessionId) {
        return;
    }
    if (!tabId) {
        attendanceSessionTabMap.delete(sessionId);
    } else {
        attendanceSessionTabMap.set(sessionId, tabId);
    }
};

const getActiveTabForSession = (sessionId) => {
    if (!sessionId) {
        return null;
    }
    return attendanceSessionTabMap.get(sessionId) || null;
};

const clearActiveTabForSession = (sessionId) => {
    if (!sessionId) {
        return;
    }
    attendanceSessionTabMap.delete(sessionId);
};

const setActiveTabForStudent = (studentId, tabId = null) => {
    if (!studentId) {
        return;
    }
    if (!tabId) {
        studentActiveTabMap.delete(studentId);
    } else {
        studentActiveTabMap.set(studentId, tabId);
    }
};

const getActiveTabForStudent = (studentId) => {
    if (!studentId) {
        return null;
    }
    return studentActiveTabMap.get(studentId) || null;
};

const setActiveSessionForStudent = (studentId, sessionId = null) => {
    if (!studentId) {
        return;
    }
    if (!sessionId) {
        studentActiveSessionMap.delete(studentId);
    } else {
        studentActiveSessionMap.set(studentId, sessionId);
    }
};

const getActiveSessionForStudent = (studentId) => {
    if (!studentId) {
        return null;
    }
    return studentActiveSessionMap.get(studentId) || null;
};

// Quiz queue management
function addToQueue(push, quiz, teacherSocketId) {
    quizQueue.push({ push, quiz, teacherSocketId, timestamp: Date.now() });
    console.log(`Quiz "${quiz.title}" added to queue. Queue length: ${quizQueue.length}`);
}

function processNextInQueue() {
    if (quizQueue.length === 0 || currentActiveQuiz) {
        console.log('Cannot process queue: queue empty or active quiz exists');
        return; // No queue or already have active quiz
    }

    const nextItem = quizQueue.shift();
    console.log(`Processing queued quiz: "${nextItem.quiz.title}"`);

    // Create a proper push record
    const push = {
        id: nextItem.push.id,
        quiz_id: nextItem.push.quiz_id,
        pushed_by: nextItem.push.pushed_by,
        target_scope: nextItem.push.target_scope,
        timeout_seconds: nextItem.push.timeout_seconds,
        course_id: nextItem.push.course_id || nextItem.quiz.course_id || null
    };

    currentActiveQuiz = push.quiz_id;

    // Create push in database
    createPushInDB(push).then(() => {
        // Send to students via WebSocket
        const targetStudents = Array.from(connectedUsers.values())
            .filter(user => user.role === 'student');

        const targetUserIds = targetStudents.map(student => student.userId);

        // Store active push with target user IDs
        const activeMeta = {
            ...push,
            quiz: nextItem.quiz,
            targetUsers: targetUserIds,
            started_at: new Date().toISOString()
        };

        activePushes.set(push.id, activeMeta);
        const quizKey = push.quiz_id ? String(push.quiz_id).trim() : push.quiz_id;
        if (quizKey) {
            activePushesByQuiz.set(quizKey, activeMeta);
        }

        targetStudents.forEach(student => {
            io.to(student.socketId).emit('quiz_push', {
                push_id: push.id,
                quiz: {
                    id: nextItem.quiz.id,
                    title: nextItem.quiz.title,
                    content_text: nextItem.quiz.content_text,
                    images: nextItem.quiz.images,
                    question_type: nextItem.quiz.question_type,
                    options: nextItem.quiz.options
                },
                timeout_seconds: push.timeout_seconds,
                pushed_at: new Date().toISOString(),
                queue_position: 1, // First in queue when it becomes active
                queue_total: 1 + quizQueue.length, // 1 (current) + remaining in queue
                course_id: push.course_id || student.activeCourseId || null
            });
        });

        schedulePushTimeoutCheck(push.id).catch((error) => {
            console.error('schedulePushTimeoutCheck error:', error);
        });

        // Notify teachers about the push
        const teachers = Array.from(connectedUsers.values())
            .filter(user => user.role === 'teacher');

        teachers.forEach(teacher => {
            io.to(teacher.socketId).emit('push_created', {
                push_id: push.id,
                quiz_id: push.quiz_id,
                course_id: push.course_id || null,
                target_count: targetStudents.length
            });
        });

        console.log(`Queued quiz "${nextItem.quiz.title}" sent to ${targetStudents.length} students`);
    }).catch(err => {
        console.error('Error creating push from queue:', err);
        currentActiveQuiz = null;
        // Try next in queue
        setTimeout(() => processNextInQueue(), 100);
    });
}

// Student Queue Management Functions (NEW)
async function addToStudentQueue(userId, pushId, quizId, quiz) {
    return new Promise((resolve, reject) => {
        const id = uuidv4();
        const courseId = quiz && quiz.course_id ? quiz.course_id : null;
        const query = `
            INSERT INTO student_quiz_queue (id, user_id, push_id, quiz_id, course_id, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
        `;

        db.run(query, [id, userId, pushId, quizId, courseId], function (err) {
            if (err) {
                // Check if duplicate (already in queue)
                if (err.message && err.message.includes('UNIQUE constraint')) {
                    console.log(`Quiz already in queue for user ${userId}`);
                    resolve({ skipped: true });
                } else {
                    reject(err);
                }
            } else {
                resolve({ added: true });
            }
        });
    });
}

async function removeFromStudentQueue(userId, pushId, status = 'answered') {
    return new Promise((resolve, reject) => {
        const query = `
            UPDATE student_quiz_queue 
            SET status = ?
            WHERE user_id = ? AND push_id = ?
        `;

        db.run(query, [status, userId, pushId], function (err) {
            if (err) {
                reject(err);
            } else {
                if (studentQueues.has(userId)) {
                    const queue = studentQueues.get(userId);
                    const index = queue.findIndex(item => item.push_id === pushId);
                    if (index !== -1) {
                        if (status === 'answered' || status === 'removed') {
                            queue.splice(index, 1);
                        } else {
                            queue[index].status = status;
                        }
                    }
                }
                resolve();
            }
        });
    });
}

// Queue snapshot helpers
function parseTimestampToMs(value) {
    if (!value) {
        return null;
    }

    let parsed = String(value).trim();
    if (!parsed) {
        return null;
    }

    if (!parsed.includes('T')) {
        parsed = parsed.replace(' ', 'T');
    }
    if (!/[zZ]$/.test(parsed)) {
        parsed = `${parsed}Z`;
    }

    const timestamp = Date.parse(parsed);
    if (Number.isNaN(timestamp)) {
        return null;
    }
    return timestamp;
}

function computeRemainingMilliseconds(timeoutSeconds, firstViewedAt) {
    const totalMs = (Number(timeoutSeconds) || 60) * 1000;
    if (!firstViewedAt) {
        return totalMs;
    }

    const viewedMs = parseTimestampToMs(firstViewedAt);
    if (viewedMs === null) {
        return totalMs;
    }

    const elapsed = Date.now() - viewedMs;
    const remaining = totalMs - elapsed;
    if (!Number.isFinite(remaining)) {
        return totalMs;
    }
    return Math.max(0, Math.floor(remaining));
}

function computeRemainingSeconds(timeoutSeconds, firstViewedAt) {
    const remainingMs = computeRemainingMilliseconds(timeoutSeconds, firstViewedAt);
    return Math.floor(remainingMs / 1000);
}

function mapQueueRow(row) {
    if (!row) return null;
    let images = [];
    let options = [];
    try {
        images = JSON.parse(row.quiz_images || '[]');
    } catch (e) {
        images = [];
    }
    try {
        options = JSON.parse(row.quiz_options || '[]');
    } catch (e) {
        options = [];
    }

    const timeout = row.push_timeout || row.quiz_timeout || 60;

    return {
        queue_id: row.id,
        push_id: row.push_id,
        quiz_id: row.quiz_id,
        course_id: row.course_id || null,
        status: row.status,
        added_at: row.added_at,
        first_viewed_at: row.first_viewed_at,
        timeout_seconds: timeout,
        quiz: {
            id: row.quiz_id,
            title: row.title,
            content_text: row.content_text,
            images,
            question_type: row.question_type,
            options
        }
    };
}

async function getViewingQueueEntriesForPush(pushId) {
    return new Promise((resolve, reject) => {
        if (!pushId) {
            resolve([]);
            return;
        }

        const query = `
            SELECT 
                sqq.*, 
                q.timeout_seconds AS quiz_timeout,
                qp.timeout_seconds AS push_timeout
            FROM student_quiz_queue sqq
            JOIN quizzes q ON sqq.quiz_id = q.id
            LEFT JOIN quiz_pushes qp ON sqq.push_id = qp.id
            WHERE sqq.push_id = ? AND sqq.status = 'viewing'
        `;

        db.all(query, [pushId], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows || []);
            }
        });
    });
}

async function getQueueEntryForStudent(pushId, userId) {
    return new Promise((resolve, reject) => {
        if (!pushId || !userId) {
            resolve(null);
            return;
        }

        const query = `
            SELECT 
                sqq.*, 
                q.timeout_seconds AS quiz_timeout,
                qp.timeout_seconds AS push_timeout
            FROM student_quiz_queue sqq
            JOIN quizzes q ON sqq.quiz_id = q.id
            LEFT JOIN quiz_pushes qp ON sqq.push_id = qp.id
            WHERE sqq.push_id = ? AND sqq.user_id = ?
            LIMIT 1
        `;

        db.get(query, [pushId, userId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

async function countActiveQueueEntriesForPush(pushId) {
    return new Promise((resolve, reject) => {
        if (!pushId) {
            resolve(0);
            return;
        }

        const query = `
            SELECT COUNT(*) AS count
            FROM student_quiz_queue
            WHERE push_id = ? AND status IN ('pending', 'viewing')
        `;

        db.get(query, [pushId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(Number(row && row.count ? row.count : 0));
            }
        });
    });
}

async function getCurrentQuizForStudent(userId, courseId = null) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                sqq.*, 
                q.title, 
                q.content_text, 
                q.images AS quiz_images, 
                q.question_type, 
                q.options AS quiz_options,
                q.timeout_seconds AS quiz_timeout,
                qp.timeout_seconds AS push_timeout
            FROM student_quiz_queue sqq
            JOIN quizzes q ON sqq.quiz_id = q.id
            LEFT JOIN quiz_pushes qp ON sqq.push_id = qp.id
            WHERE sqq.user_id = ?${courseId ? ' AND sqq.course_id = ?' : ''} AND sqq.status = 'viewing'
            ORDER BY sqq.first_viewed_at ASC, sqq.added_at ASC
            LIMIT 1
        `;

        const params = courseId ? [userId, courseId] : [userId];

        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                const mapped = mapQueueRow(row);
                if (mapped) {
                    mapped.remaining_seconds = computeRemainingSeconds(
                        mapped.timeout_seconds,
                        mapped.first_viewed_at
                    );
                    if (mapped.push_id) {
                        schedulePushTimeoutCheck(mapped.push_id).catch((error) => {
                            console.error('schedulePushTimeoutCheck error:', error);
                        });
                    }
                }
                resolve(mapped);
            }
        });
    });
}

async function getPendingQuizzesForStudent(userId, courseId = null) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                sqq.*, 
                q.title, 
                q.content_text, 
                q.images AS quiz_images, 
                q.question_type, 
                q.options AS quiz_options,
                q.timeout_seconds AS quiz_timeout,
                qp.timeout_seconds AS push_timeout
            FROM student_quiz_queue sqq
            JOIN quizzes q ON sqq.quiz_id = q.id
            LEFT JOIN quiz_pushes qp ON sqq.push_id = qp.id
            WHERE sqq.user_id = ?${courseId ? ' AND sqq.course_id = ?' : ''} AND sqq.status = 'pending'
            ORDER BY sqq.added_at ASC
        `;

        const params = courseId ? [userId, courseId] : [userId];

        db.all(query, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const pending = rows.map(row => {
                    const mapped = mapQueueRow(row);
                    mapped.remaining_seconds = mapped.timeout_seconds;
                    return mapped;
                });
                resolve(pending);
            }
        });
    });
}

async function promoteNextPendingToViewing(userId, courseId = null) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT id
            FROM student_quiz_queue
            WHERE user_id = ?${courseId ? ' AND course_id = ?' : ''} AND status = 'pending'
            ORDER BY added_at ASC
            LIMIT 1
        `;

        const params = courseId ? [userId, courseId] : [userId];

        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            if (!row) {
                resolve(null);
                return;
            }

            db.run(
                `UPDATE student_quiz_queue 
                 SET status = 'viewing', first_viewed_at = COALESCE(first_viewed_at, CURRENT_TIMESTAMP)
                 WHERE id = ?`,
                [row.id],
                (updateErr) => {
                    if (updateErr) {
                        reject(updateErr);
                    } else {
                        getCurrentQuizForStudent(userId, courseId)
                            .then((result) => {
                                if (result && result.push_id) {
                                    schedulePushTimeoutCheck(result.push_id).catch((error) => {
                                        console.error('schedulePushTimeoutCheck error:', error);
                                    });
                                }
                                resolve(result);
                            })
                            .catch(reject);
                    }
                }
            );
        });
    });
}

async function getQueueSnapshot(userId, courseId = null) {
    let currentQuiz = await getCurrentQuizForStudent(userId, courseId);
    if (!currentQuiz) {
        currentQuiz = await promoteNextPendingToViewing(userId, courseId);
    }

    const pending = await getPendingQuizzesForStudent(userId, courseId);
    const total = (currentQuiz ? 1 : 0) + pending.length;

    if (currentQuiz) {
        currentQuiz.position = 1;
        currentQuiz.total = total;
        currentQuiz.status = 'viewing';
    }

    pending.forEach((item, index) => {
        item.position = (currentQuiz ? index + 2 : index + 1);
        item.total = total;
    });

    return {
        courseId,
        currentQuiz,
        pending,
        total
    };
}

function sanitizeQueueItem(item) {
    if (!item) return null;
    return {
        push_id: item.push_id,
        quiz_id: item.quiz_id,
        course_id: item.course_id || null,
        quiz: item.quiz,
        status: item.status,
        added_at: item.added_at,
        first_viewed_at: item.first_viewed_at,
        remaining_seconds: item.remaining_seconds,
        timeout_seconds: item.timeout_seconds,
        position: item.position,
        total: item.total
    };
}

function buildQueueUpdatePayload(snapshot) {
    return {
        course_id: snapshot.courseId || null,
        total: snapshot.total,
        currentQuiz: snapshot.currentQuiz ? sanitizeQueueItem(snapshot.currentQuiz) : null,
        pending: snapshot.pending.map(sanitizeQueueItem)
    };
}

function buildShowQuizPayload(currentQuiz) {
    return {
        push_id: currentQuiz.push_id,
        quiz: currentQuiz.quiz,
        course_id: currentQuiz.course_id || null,
        timeout_seconds: currentQuiz.timeout_seconds,
        remaining_seconds: currentQuiz.remaining_seconds,
        pushed_at: currentQuiz.added_at,
        position: currentQuiz.position || 1,
        total: currentQuiz.total || 1
    };
}

function syncStudentQueueCache(userId, snapshot) {
    const cache = [];
    if (snapshot.currentQuiz) {
        cache.push(snapshot.currentQuiz);
    }
    cache.push(...snapshot.pending);
    studentQueues.set(userId, cache);
}

function parseStoredAnswer(raw) {
    if (raw === null || raw === undefined) {
        return null;
    }

    if (typeof raw !== 'string') {
        return raw;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
        return '';
    }

    try {
        return JSON.parse(trimmed);
    } catch (err) {
        if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
            return trimmed.slice(1, -1);
        }
        return raw;
    }
}

function formatAnswerForDisplay(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'string') {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    // Handle select type answers (object with selected_text)
    if (typeof value === 'object' && value.selected_text) {
        return value.selected_text;
    }
    // Handle checkbox type answers (array of strings)
    if (Array.isArray(value)) {
        return value.join(', ');
    }
    return JSON.stringify(value);
}

// Check if quiz is already in student's queue OR already answered
async function checkQuizInStudentQueue(userId, quizId, courseId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as count 
            FROM student_quiz_queue 
            WHERE user_id = ? AND quiz_id = ?${courseId ? ' AND course_id = ?' : ''} AND status IN ('pending', 'viewing')
        `;

        const params = courseId ? [userId, quizId, courseId] : [userId, quizId];

        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row.count > 0);
            }
        });
    });
}

// Check if student has already answered this quiz (by quiz_id, not push_id)
async function checkQuizAlreadyAnswered(userId, quizId) {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT COUNT(*) as count 
            FROM quiz_responses qr
            LEFT JOIN quiz_pushes qp ON qr.push_id = qp.id
            WHERE qr.user_id = ? AND qr.quiz_id = ? AND qr.status = 'answered'
              AND (qp.undone_at IS NULL OR qp.undone_at = '')
        `;

        db.get(query, [userId, quizId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row.count > 0);
            }
        });
    });
}

const pushTimeouts = new Map(); // pushId -> timeoutId

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Helper functions
const getUserFromDB = (username) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const createQuizInDB = (quiz) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO quizzes (id, title, content_text, images, question_type, options, correct_answer, category_id, course_id, created_by, timeout_seconds, is_scored, points)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run([
            quiz.id, quiz.title, quiz.content_text,
            JSON.stringify(quiz.images || []),
            quiz.question_type,
            JSON.stringify(quiz.options || []),
            quiz.correct_answer,
            quiz.category_id,
            quiz.course_id,
            quiz.created_by, quiz.timeout_seconds,
            quiz.is_scored !== undefined ? quiz.is_scored : 1,
            quiz.points !== undefined ? quiz.points : 1
        ], function (err) {
            if (err) reject(err);
            else resolve({ id: quiz.id, ...quiz });
        });
        stmt.finalize();
    });
};

const getQuizzesFromDB = (userId, courseId) => {
    return new Promise((resolve, reject) => {
        const params = [userId];
        let courseClause = '';
        if (courseId) {
            courseClause = ' AND q.course_id = ?';
            params.push(courseId);
        }

        db.all(`
            SELECT 
                q.*, 
                c.name as category_name,
                COUNT(qr.id) AS response_count,
                SUM(CASE WHEN qr.status = 'answered' THEN 1 ELSE 0 END) AS answered_count,
                SUM(CASE WHEN qr.status = 'timeout' THEN 1 ELSE 0 END) AS timeout_count,
                MAX(qr.answered_at) AS last_response_at
            FROM quizzes q 
            LEFT JOIN quiz_categories c ON q.category_id = c.id 
            LEFT JOIN quiz_responses qr ON q.id = qr.quiz_id
            WHERE q.created_by = ?${courseClause}
            GROUP BY q.id
            ORDER BY c.name, q.created_at DESC
        `, params, (err, rows) => {
            if (err) reject(err);
            else {
                const quizzes = rows.map(row => ({
                    ...row,
                    images: JSON.parse(row.images || '[]'),
                    options: JSON.parse(row.options || '[]'),
                    response_count: Number(row.response_count || 0),
                    answered_count: Number(row.answered_count || 0),
                    timeout_count: Number(row.timeout_count || 0),
                    last_response_at: row.last_response_at || null,
                    has_responses: Number(row.response_count || 0) > 0,
                    responseCount: Number(row.response_count || 0),
                    answeredCount: Number(row.answered_count || 0),
                    timeoutCount: Number(row.timeout_count || 0),
                    lastResponseAt: row.last_response_at || null,
                    hasResponses: Number(row.response_count || 0) > 0
                }));
                resolve(quizzes);
            }
        });
    });
};

const createPushInDB = (push) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO quiz_pushes (id, quiz_id, pushed_by, target_scope, timeout_seconds, course_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run([
            push.id, push.quiz_id, push.pushed_by,
            JSON.stringify(push.target_scope), push.timeout_seconds,
            push.course_id || null
        ], function (err) {
            if (err) reject(err);
            else resolve({ id: push.id, ...push });
        });
        stmt.finalize();
    });
};

const createResponseInDB = (response) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO quiz_responses (id, push_id, quiz_id, user_id, answer_text, started_at, answered_at, elapsed_ms, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run([
            response.id, response.push_id, response.quiz_id, response.user_id,
            response.answer_text, response.started_at, response.answered_at,
            response.elapsed_ms, response.status
        ], function (err) {
            if (err) reject(err);
            else resolve({ id: response.id, ...response });
        });
        stmt.finalize();
    });
};

const createCourseInDB = (course) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO courses (id, title, description, created_by, created_at, access_code_hash, docs_repo_url, docs_branch, docs_site_url, docs_local_path)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(
            [
                course.id,
                course.title,
                course.description || '',
                course.created_by,
                course.created_at,
                course.access_code_hash || null,
                course.docs_repo_url || null,
                course.docs_branch || 'main',
                course.docs_site_url || null,
                course.docs_local_path || null
            ],
            function (err) {
                if (err) reject(err);
                else resolve({ id: course.id, ...course });
            }
        );
        stmt.finalize();
    });
};

const getCoursesForTeacher = (teacherId) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT c.*, COUNT(e.id) AS enrollment_count
            FROM courses c
            LEFT JOIN course_enrollments e ON c.id = e.course_id
            WHERE c.created_by = ?
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `;
        db.all(query, [teacherId], (err, rows) => {
            if (err) reject(err);
            else {
                const mapped = (rows || []).map(row => ({
                    id: row.id,
                    title: row.title,
                    description: row.description,
                    created_by: row.created_by,
                    created_at: row.created_at,
                    enrollment_count: Number(row.enrollment_count || 0),
                    requires_access_code: Boolean(row.access_code_hash),
                    docs_repo_url: row.docs_repo_url,
                    docs_branch: row.docs_branch || 'main',
                    docs_path: row.docs_path,
                    docs_local_path: row.docs_local_path,
                    docs_site_url: row.docs_site_url
                }));
                resolve(mapped);
            }
        });
    });
};

const getCoursesForStudent = (studentId) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT 
                c.*,
                u.display_name AS teacher_display_name,
                u.username AS teacher_username,
                CASE WHEN EXISTS (
                    SELECT 1 FROM course_enrollments e
                    WHERE e.course_id = c.id AND e.student_id = ?
                ) THEN 1 ELSE 0 END AS is_enrolled
            FROM courses c
            JOIN users u ON c.created_by = u.id
            ORDER BY c.created_at DESC
        `;
        db.all(query, [studentId], (err, rows) => {
            if (err) reject(err);
            else {
                const mapped = (rows || []).map(row => ({
                    id: row.id,
                    title: row.title,
                    description: row.description,
                    created_by: row.created_by,
                    created_at: row.created_at,
                    teacher_display_name: row.teacher_display_name,
                    teacher_username: row.teacher_username,
                    is_enrolled: Boolean(row.is_enrolled),
                    requires_access_code: Boolean(row.access_code_hash),
                    docs_repo_url: row.docs_repo_url,
                    docs_branch: row.docs_branch,
                    docs_path: row.docs_path,
                    docs_local_path: row.docs_local_path,
                    docs_site_url: row.docs_site_url
                }));
                resolve(mapped);
            }
        });
    });
};

const enrollStudentInCourse = (courseId, studentId) => {
    return new Promise((resolve, reject) => {
        const id = uuidv4();
        const query = `
            INSERT INTO course_enrollments (id, course_id, student_id, enrolled_at)
            VALUES (?, ?, ?, ?)
        `;
        db.run(query, [id, courseId, studentId, new Date().toISOString()], function (err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE constraint failed')) {
                    resolve({ alreadyEnrolled: true });
                } else {
                    reject(err);
                }
            } else {
                resolve({ enrolled: true, id });
            }
        });
    });
};

const getCourseById = (courseId) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM courses WHERE id = ?', [courseId], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
};

const ensureTeacherOwnsCourse = async (teacherId, courseId) => {
    if (!courseId) {
        return null;
    }

    const course = await getCourseById(courseId);
    if (!course || course.created_by !== teacherId) {
        return null;
    }
    return course;
};

const verifyCategoryForTeacher = (categoryId, teacherId, courseId) => {
    return new Promise((resolve, reject) => {
        if (!categoryId) {
            resolve(true);
            return;
        }

        db.get(
            'SELECT id, course_id FROM quiz_categories WHERE id = ? AND created_by = ?',
            [categoryId, teacherId],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                if (!row) {
                    resolve(false);
                    return;
                }

                if (!courseId) {
                    resolve(false);
                    return;
                }

                if (!row.course_id) {
                    db.run(
                        'UPDATE quiz_categories SET course_id = ? WHERE id = ?',
                        [courseId, categoryId],
                        (updateErr) => {
                            if (updateErr) {
                                reject(updateErr);
                            } else {
                                resolve(true);
                            }
                        }
                    );
                    return;
                }

                resolve(row.course_id === courseId);
            }
        );
    });
};

const isStudentEnrolledInCourse = (studentId, courseId) => {
    return new Promise((resolve, reject) => {
        if (!courseId) {
            resolve(false);
            return;
        }

        db.get(
            'SELECT 1 FROM course_enrollments WHERE student_id = ? AND course_id = ? LIMIT 1',
            [studentId, courseId],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(Boolean(row));
                }
            }
        );
    });
};

const getCategoryById = (categoryId) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM quiz_categories WHERE id = ?', [categoryId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
};

const getCourseIdsForStudent = (studentId) => {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT course_id FROM course_enrollments WHERE student_id = ?',
            [studentId],
            (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve((rows || []).map(row => row.course_id));
                }
            }
        );
    });
};

const getStudentQuizStats = (studentId, courseId = null) => {
    return new Promise((resolve, reject) => {
        let query = `
            SELECT 
                COUNT(qr.id) AS total_responses,
                SUM(CASE WHEN qr.status = 'answered' THEN 1 ELSE 0 END) AS answered_count,
                MAX(qr.answered_at) AS last_answered_at
            FROM quiz_responses qr
            LEFT JOIN quiz_pushes qp ON qr.push_id = qp.id
            WHERE qr.user_id = ?
        `;
        const params = [studentId];

        if (courseId) {
            query += ' AND (qp.course_id = ? OR qp.course_id IS NULL)';
            params.push(courseId);
        }

        db.get(query, params, (err, row) => {
            if (err) {
                reject(err);
            } else {
                const safeRow = row || {};
                resolve({
                    total_responses: Number(safeRow.total_responses || 0),
                    answered_count: Number(safeRow.answered_count || 0),
                    last_answered_at: safeRow.last_answered_at || null
                });
            }
        });
    });
};

const updateCourseInDB = (courseId, teacherId, fields) => {
    return new Promise((resolve, reject) => {
        const updates = [];
        const params = [];

        if (Object.prototype.hasOwnProperty.call(fields, 'title')) {
            updates.push('title = ?');
            params.push(fields.title);
        }

        if (Object.prototype.hasOwnProperty.call(fields, 'description')) {
            updates.push('description = ?');
            params.push(fields.description);
        }

        if (Object.prototype.hasOwnProperty.call(fields, 'docs_repo_url')) {
            updates.push('docs_repo_url = ?');
            params.push(fields.docs_repo_url);
        }

        if (Object.prototype.hasOwnProperty.call(fields, 'docs_branch')) {
            updates.push('docs_branch = ?');
            params.push(fields.docs_branch);
        }

        if (Object.prototype.hasOwnProperty.call(fields, 'access_code_hash')) {
            updates.push('access_code_hash = ?');
            params.push(fields.access_code_hash);
        }

        if (updates.length === 0) {
            resolve({ updated: false });
            return;
        }

        params.push(courseId, teacherId);

        const query = `UPDATE courses SET ${updates.join(', ')} WHERE id = ? AND created_by = ?`;
        db.run(query, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({ updated: this.changes > 0 });
            }
        });
    });
};

const getActiveAttendanceSession = (studentId) => {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT * FROM course_attendance_sessions
             WHERE student_id = ? AND status IN ('viewing','not_viewing')
             ORDER BY started_at DESC
             LIMIT 1`,
            [studentId],
            (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    if (!row) {
                        setActiveSessionForStudent(studentId, null);
                        resolve(null);
                        return;
                    }

                    setActiveSessionForStudent(studentId, row.id);

                    let activeTabId = getActiveTabForSession(row.id);
                    if (!activeTabId) {
                        activeTabId = getActiveTabForStudent(studentId);
                        if (activeTabId) {
                            setActiveTabForSession(row.id, activeTabId);
                        }
                    }

                    if (activeTabId) {
                        setActiveTabForStudent(studentId, activeTabId);
                    }

                    resolve({ ...row, active_tab_id: activeTabId || null });
                }
            }
        );
    });
};

const createAttendanceSession = (studentId, courseId, status, tabId = null) => {
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        const id = uuidv4();
        const normalizedStatus = ATTENDANCE_VIEWING_STATUSES.has(status) ? status : 'viewing';

        const query = `
            INSERT INTO course_attendance_sessions
                (id, student_id, course_id, status, started_at, last_status_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.run(query, [id, studentId, courseId, normalizedStatus, now, now], function (err) {
            if (err) {
                reject(err);
            } else {
                if (tabId) {
                    setActiveTabForSession(id, tabId);
                    setActiveTabForStudent(studentId, tabId);
                }
                setActiveSessionForStudent(studentId, id);

                resolve({
                    id,
                    student_id: studentId,
                    course_id: courseId,
                    status: normalizedStatus,
                    started_at: now,
                    last_status_at: now,
                    ended_at: null,
                    active_tab_id: tabId || null
                });
            }
        });
    });
};

const updateAttendanceSessionStatus = (sessionId, status, options = {}) => {
    const { tabId = null, studentId = null } = options;
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();
        const normalizedStatus = ATTENDANCE_VIEWING_STATUSES.has(status) ? status : 'viewing';

        db.run(
            `UPDATE course_attendance_sessions
             SET status = ?, last_status_at = ?
             WHERE id = ?`,
            [normalizedStatus, now, sessionId],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    if (tabId) {
                        setActiveTabForSession(sessionId, tabId);
                        if (studentId) {
                            setActiveTabForStudent(studentId, tabId);
                        }
                    }

                    let activeTabId = tabId || getActiveTabForSession(sessionId);
                    if (!activeTabId && studentId) {
                        activeTabId = getActiveTabForStudent(studentId);
                        if (activeTabId) {
                            setActiveTabForSession(sessionId, activeTabId);
                        }
                    }

                    resolve({
                        updated: this.changes > 0,
                        status: normalizedStatus,
                        last_status_at: now,
                        active_tab_id: activeTabId || null
                    });
                }
            }
        );
    });
};

const endAttendanceSession = (sessionId, options = {}) => {
    const { studentId = null } = options;
    return new Promise((resolve, reject) => {
        const now = new Date().toISOString();

        db.run(
            `UPDATE course_attendance_sessions
             SET status = 'ended', ended_at = ?, last_status_at = ?
             WHERE id = ?`,
            [now, now, sessionId],
            function (err) {
                if (err) {
                    reject(err);
                } else {
                    clearActiveTabForSession(sessionId);
                    if (studentId) {
                        if (getActiveSessionForStudent(studentId) === sessionId) {
                            setActiveSessionForStudent(studentId, null);
                        }
                        setActiveTabForStudent(studentId, null);
                    }

                    resolve({
                        updated: this.changes > 0,
                        ended_at: now
                    });
                }
            }
        );
    });
};

const syncConnectedUserAttendance = (studentId, courseId = null, status = null, tabId = null) => {
    const activeTabId = tabId || getActiveTabForStudent(studentId) || null;
    if (activeTabId) {
        setActiveTabForStudent(studentId, activeTabId);
    }
    for (const [socketId, info] of connectedUsers.entries()) {
        if (info.userId === studentId) {
            info.activeCourseId = courseId;
            info.attendanceStatus = status;
            info.activeAttendanceTabId = activeTabId;
            info.isPrimaryTab = activeTabId ? info.tabId === activeTabId : Boolean(info.isVisible);
        }
    }
};

const emitAttendanceUpdate = (studentId, payload = {}) => {
    const session = payload.session || null;
    if (session) {
        if (!session.active_tab_id && session.id) {
            const sessionTab = getActiveTabForSession(session.id);
            if (sessionTab) {
                session.active_tab_id = sessionTab;
            }
        }
        if (!session.active_tab_id) {
            const fallbackTab = getActiveTabForStudent(studentId);
            if (fallbackTab) {
                session.active_tab_id = fallbackTab;
            }
        }
    }

    for (const [socketId, info] of connectedUsers.entries()) {
        if (info.userId === studentId) {
            io.to(socketId).emit('attendance_session_updated', payload);
        }
    }
};

const normalizeAttendanceStatus = (status) => {
    if (!status) {
        return 'viewing';
    }
    const lowered = String(status).toLowerCase();
    return ATTENDANCE_VIEWING_STATUSES.has(lowered) ? lowered : 'viewing';
};

const deleteCourseInDB = (courseId, teacherId) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('DELETE FROM course_enrollments WHERE course_id = ?', [courseId], (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                db.run('DELETE FROM courses WHERE id = ? AND created_by = ?', [courseId, teacherId], function (err2) {
                    if (err2) {
                        reject(err2);
                    } else {
                        resolve({ deleted: this.changes > 0 });
                    }
                });
            });
        });
    });
};

// REST API Routes

// Login endpoint
app.post('/api/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const normalizedUsername = String(username).trim().toLowerCase();
        const user = await getUserFromDB(normalizedUsername);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const tokenPayload = {
            userId: user.id,
            username: user.username,
            display_name: user.display_name,
            role: user.role
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        res.json({
            token,
            user: {
                id: user.id,
                username: user.username,
                display_name: user.display_name,
                role: user.role
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Student registration endpoint
app.post('/api/register', authLimiter, async (req, res) => {
    try {
        const { username, password, display_name } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const trimmedUsername = String(username).trim().toLowerCase();

        // Username validation
        if (!/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
            return res.status(400).json({ error: 'Username must be 3-30 characters (letters, numbers, underscore)' });
        }

        // Username must start with a letter
        if (trimmedUsername.startsWith('_') || /^[0-9]/.test(trimmedUsername)) {
            return res.status(400).json({ error: 'Username must start with a letter' });
        }

        // Check reserved usernames
        const reserved = new Set(['admin', 'root', 'system', 'administrator', 'support', 'null', 'undefined', 'test', 'demo']);
        if (reserved.has(trimmedUsername)) {
            return res.status(400).json({ error: 'Username not allowed' });
        }

        // Stronger password validation (8 chars minimum, require letter + number/symbol)
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (password.length > 128) {
            return res.status(400).json({ error: 'Password too long (max 128 characters)' });
        }
        if (!/[a-zA-Z]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one letter' });
        }
        if (!/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            return res.status(400).json({ error: 'Password must contain at least one number or symbol' });
        }

        const existing = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM users WHERE username = ?', [trimmedUsername], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existing) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const id = uuidv4();
        const hash = await bcrypt.hash(password, 10);
        const now = new Date().toISOString();
        // Sanitize display name to remove tags/control characters and limit length
        const rawDisplay = display_name ? String(display_name) : '';
        let sanitizedDisplay = xss(rawDisplay).trim().slice(0, 60);
        sanitizedDisplay = sanitizedDisplay.replace(/[\u0000-\u001F\u007F]/g, '');
        const displayName = sanitizedDisplay || trimmedUsername;

        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
                 VALUES (?, ?, ?, ?, 'student', ?)` ,
                [id, trimmedUsername, displayName, hash, now],
                (err) => (err ? reject(err) : resolve())
            );
        });

        const token = jwt.sign(
            { userId: id, username: trimmedUsername, display_name: displayName, role: 'student' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'Registration successful',
            token,
            user: {
                id,
                username: trimmedUsername,
                display_name: displayName,
                role: 'student'
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update user profile (display name and/or password)
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { display_name, password, current_password } = req.body || {};
        const userId = req.user.userId;

        // Get current user data
        const user = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // If changing password, verify current password first
        if (password) {
            if (!current_password) {
                return res.status(400).json({ error: 'Current password required to change password' });
            }

            const validPassword = await bcrypt.compare(current_password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }

            if (password.length < 6) {
                return res.status(400).json({ error: 'New password must be at least 6 characters' });
            }
        }

        // Build update query dynamically
        const updates = [];
        const params = [];

        if (display_name !== undefined && String(display_name).trim()) {
            updates.push('display_name = ?');
            params.push(String(display_name).trim());
        }

        if (password) {
            const hash = await bcrypt.hash(password, 10);
            updates.push('password_hash = ?');
            params.push(hash);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        params.push(userId);

        await new Promise((resolve, reject) => {
            db.run(
                `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
                params,
                (err) => (err ? reject(err) : resolve())
            );
        });

        // Fetch updated user
        const updatedUser = await new Promise((resolve, reject) => {
            db.get('SELECT id, username, display_name, role FROM users WHERE id = ?', [userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        res.json({
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create course (teacher only)
app.post('/api/courses', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { title, description, access_code, docs_repo_url, docs_branch } = req.body || {};
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Course title required' });
        }

        if (!access_code || !String(access_code).trim()) {
            return res.status(400).json({ error: 'Course passkey required' });
        }

        const trimmedAccessCode = String(access_code).trim();
        if (trimmedAccessCode.length < 4) {
            return res.status(400).json({ error: 'Course passkey must be at least 4 characters' });
        }

        const accessCodeHash = await bcrypt.hash(trimmedAccessCode, 10);

        // Handle git repository cloning if URL is provided
        let repoUrl = (docs_repo_url && String(docs_repo_url).trim()) || null;
        let localRepoFolder = null;
        let siteUrl = null;
        let localPath = null;
        let cloneId = null;

        // Validate git URL first
        if (repoUrl && !isGitUrl(repoUrl)) {
            return res.status(400).json({ error: 'Invalid git repository URL' });
        }

        // Get the expected folder name upfront
        if (repoUrl) {
            localRepoFolder = getRepoFolderName(repoUrl);
            if (!localRepoFolder) {
                return res.status(400).json({ error: 'Could not extract repository name from URL' });
            }
            // Generate expected paths
            localPath = `/docs/${localRepoFolder}/site/`;
            // We'll update siteUrl after clone completes
        }

        // Start git clone in background if URL provided
        if (repoUrl) {
            cloneId = `clone_${uuidv4()}`;

            // Progress callback to emit updates via socket
            const onProgress = (progress) => {
                io.emit('clone-progress', {
                    cloneId,
                    userId: req.user.userId,
                    ...progress
                });
            };

            // Clone in background - don't wait for it
            cloneGitRepoAsSubmodule(repoUrl, null, onProgress)
                .then(cloneResult => {
                    if (cloneResult.success) {
                        console.log(`✓ Course repository cloned to: courses/${cloneResult.folderName}`);
                        if (cloneResult.siteUrl) {
                            console.log(`✓ Site URL from mkdocs.yml: ${cloneResult.siteUrl}`);
                            // Update the course with the actual site URL
                            db.run('UPDATE courses SET docs_site_url = ? WHERE docs_repo_url = ?',
                                [cloneResult.siteUrl, repoUrl],
                                (err) => {
                                    if (err) console.error('Failed to update docs_site_url:', err);
                                }
                            );
                        }
                        onProgress({ step: 'complete', message: 'Repository setup complete!', progress: 100 });
                    }
                })
                .catch(cloneError => {
                    console.error('Background clone failed:', cloneError.message);
                    io.emit('clone-progress', {
                        cloneId,
                        userId: req.user.userId,
                        step: 'error',
                        message: `Clone failed: ${cloneError.message}`,
                        progress: 0
                    });
                });
        }

        const course = {
            id: uuidv4(),
            title: String(title).trim(),
            description: (description && String(description).trim()) || '',
            created_by: req.user.userId,
            created_at: new Date().toISOString(),
            access_code_hash: accessCodeHash,
            docs_repo_url: repoUrl,
            docs_branch: (docs_branch && String(docs_branch).trim()) || 'main',
            docs_site_url: siteUrl,
            docs_local_path: localPath
        };

        const saved = await createCourseInDB(course);
        const responseCourse = {
            id: saved.id,
            title: saved.title,
            description: saved.description,
            created_by: saved.created_by,
            created_at: saved.created_at,
            enrollment_count: 0,
            requires_access_code: true,
            docs_repo_url: saved.docs_repo_url,
            docs_branch: saved.docs_branch,
            docs_local_path: saved.docs_local_path,
            local_repo_folder: localRepoFolder,
            clone_id: cloneId  // Send back the clone ID so frontend can track progress
        };

        res.status(201).json({
            course: responseCourse,
            passkey: trimmedAccessCode,
            message: localRepoFolder ? `Course created! Cloning repository in background...` : 'Course created successfully'
        });
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update course (teacher only)
app.put('/api/courses/:courseId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.params;
        const course = await getCourseById(courseId);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        const { title, description, access_code, docs_repo_url, docs_branch } = req.body || {};

        const updateFields = {};

        if (typeof title !== 'undefined') {
            const trimmedTitle = String(title).trim();
            if (!trimmedTitle) {
                return res.status(400).json({ error: 'Course title cannot be empty' });
            }
            updateFields.title = trimmedTitle;
        }

        if (typeof description !== 'undefined') {
            updateFields.description = String(description || '').trim();
        }

        // Handle git repository URL changes
        let localRepoFolder = null;
        if (typeof docs_repo_url !== 'undefined') {
            const newRepoUrl = docs_repo_url ? String(docs_repo_url).trim() : null;

            // If URL changed and is a valid git URL, clone the new repository
            if (newRepoUrl && newRepoUrl !== course.docs_repo_url && isGitUrl(newRepoUrl)) {
                try {
                    const cloneResult = await cloneGitRepoAsSubmodule(newRepoUrl, null);
                    if (cloneResult.success) {
                        localRepoFolder = cloneResult.folderName;
                        const siteUrl = cloneResult.siteUrl;
                        const localPath = cloneResult.localPath;
                        console.log(`Updated course repository cloned to: courses/${localRepoFolder}`);
                        if (siteUrl) {
                            console.log(`Site URL from mkdocs.yml: ${siteUrl}`);
                            updateFields.docs_site_url = siteUrl;
                        }
                        if (localPath) {
                            updateFields.docs_local_path = localPath;
                        }
                    }
                } catch (cloneError) {
                    console.error('Failed to clone updated repository:', cloneError.message);
                    return res.status(400).json({
                        error: cloneError.message || 'Failed to clone repository. Please ensure it\'s a public, valid MkDocs project.'
                    });
                }
            }

            updateFields.docs_repo_url = newRepoUrl;
        }

        if (typeof docs_branch !== 'undefined') {
            updateFields.docs_branch = docs_branch ? String(docs_branch).trim() : 'main';
        }

        if (typeof access_code !== 'undefined') {
            const trimmedAccessCode = String(access_code).trim();
            if (!trimmedAccessCode) {
                return res.status(400).json({ error: 'Course passkey cannot be empty' });
            }
            if (trimmedAccessCode.length < 4) {
                return res.status(400).json({ error: 'Course passkey must be at least 4 characters' });
            }
            updateFields.access_code_hash = await bcrypt.hash(trimmedAccessCode, 10);
        }

        const result = await updateCourseInDB(courseId, req.user.userId, updateFields);
        if (!result.updated) {
            return res.status(400).json({ error: 'No changes applied' });
        }

        const updatedCourse = await getCourseById(courseId);
        const responseCourse = {
            id: updatedCourse.id,
            title: updatedCourse.title,
            description: updatedCourse.description,
            created_by: updatedCourse.created_by,
            created_at: updatedCourse.created_at,
            requires_access_code: Boolean(updatedCourse.access_code_hash),
            local_repo_folder: localRepoFolder
        };

        res.json({
            course: responseCourse,
            passkey_updated: typeof access_code !== 'undefined',
            message: localRepoFolder ? `Course updated and repository cloned to courses/${localRepoFolder}` : 'Course updated successfully'
        });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete course (teacher only)
app.delete('/api/courses/:courseId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.params;
        const course = await getCourseById(courseId);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        // Extract repo folder name from docs_local_path or docs_repo_url
        let repoFolderName = null;
        if (course.docs_local_path) {
            // Extract from /docs/repo_name/site/
            const match = course.docs_local_path.match(/\/docs\/([^\/]+)\//);
            if (match) {
                repoFolderName = match[1];
            }
        } else if (course.docs_repo_url && isGitUrl(course.docs_repo_url)) {
            // Extract from git URL
            repoFolderName = getRepoFolderName(course.docs_repo_url);
        }

        // Delete from database first
        const result = await deleteCourseInDB(courseId, req.user.userId);
        if (!result.deleted) {
            return res.status(500).json({ error: 'Failed to delete course' });
        }

        // Clean up git submodule and directory if applicable
        if (repoFolderName) {
            console.log(`Cleaning up course repository: ${repoFolderName}`);
            removeFromGitmodules(repoFolderName);
            removeCourseDirectory(repoFolderName);
        }

        res.json({
            message: 'Course deleted',
            cleaned_up: repoFolderName ? `Removed courses/${repoFolderName}` : null
        });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// App configuration endpoint
app.get('/api/config', (req, res) => {
    res.json({
        baseUrl: BASE_URL,
        environment: process.env.NODE_ENV || 'development',
        version: APP_VERSION ? `v${APP_VERSION}` : null,
        buildDate: APP_BUILD_DATE || null,
        appName: 'Tutoriaz',
        appDescription: 'Real-time Quiz Platform'
    });
});

// List courses (context-aware)
app.get('/api/courses', authenticateToken, async (req, res) => {
    try {
        if (req.user.role === 'teacher') {
            const courses = await getCoursesForTeacher(req.user.userId);
            return res.json({ courses });
        }

        if (req.user.role === 'student') {
            const courses = await getCoursesForStudent(req.user.userId);
            const normalized = courses.map(course => ({
                ...course,
                is_enrolled: Boolean(course.is_enrolled),
                teacher_display_name: course.teacher_display_name || course.teacher_username,
                teacher_username: course.teacher_username
            }));
            return res.json({ courses: normalized });
        }

        res.status(400).json({ error: 'Unsupported role' });
    } catch (error) {
        console.error('List courses error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Enroll in a course (student only)
app.post('/api/courses/:courseId/enroll', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        const { courseId } = req.params;
        const { access_code } = req.body || {};
        const course = await getCourseById(courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        if (!course.access_code_hash) {
            return res.status(400).json({ error: 'Course is not open for enrollment yet' });
        }

        if (!access_code || !String(access_code).trim()) {
            return res.status(400).json({ error: 'Course passkey required' });
        }

        const providedCode = String(access_code).trim();
        const passkeyValid = await bcrypt.compare(providedCode, course.access_code_hash);
        if (!passkeyValid) {
            return res.status(401).json({ error: 'Invalid course passkey' });
        }

        const result = await enrollStudentInCourse(courseId, req.user.userId);

        if (result.alreadyEnrolled) {
            return res.status(200).json({ message: 'Already enrolled', course_id: courseId });
        }

        res.status(201).json({ message: 'Enrolled successfully', course_id: courseId });
    } catch (error) {
        console.error('Enroll course error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/courses/:courseId/attend', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        const courseId = String(req.params.courseId);
        const status = normalizeAttendanceStatus(req.body?.status);
        const tabId = req.body?.tab_id ? String(req.body.tab_id) : null;
        const studentId = req.user.userId;

        const enrolled = await isStudentEnrolledInCourse(studentId, courseId);
        if (!enrolled) {
            return res.status(403).json({ error: 'Enrollment required to attend this course.' });
        }

        let session = await getActiveAttendanceSession(studentId);

        if (session && session.course_id !== courseId) {
            return res.status(409).json({
                error: 'active_session_exists',
                message: 'Please leave your current course before attending a new one.',
                active_course: {
                    course_id: session.course_id,
                    status: session.status,
                    started_at: session.started_at,
                    last_status_at: session.last_status_at,
                    active_tab_id: session.active_tab_id || null
                }
            });
        }

        if (session) {
            const updateResult = await updateAttendanceSessionStatus(session.id, status, {
                tabId,
                studentId
            });
            session = {
                ...session,
                status: updateResult.status,
                last_status_at: updateResult.last_status_at,
                active_tab_id: updateResult.active_tab_id || tabId || session.active_tab_id || null
            };
        } else {
            session = await createAttendanceSession(studentId, courseId, status, tabId || null);
        }

        const activeTabId = session.active_tab_id || tabId || null;
        syncConnectedUserAttendance(studentId, courseId, session.status, activeTabId);
        emitAttendanceUpdate(studentId, { session });
        updateOnlineListDebounced();

        res.json({ session });
    } catch (error) {
        console.error('Attend course error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/courses/:courseId/unattend', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        const courseId = String(req.params.courseId);
        const studentId = req.user.userId;
        const tabId = req.body?.tab_id ? String(req.body.tab_id) : null;

        const session = await getActiveAttendanceSession(studentId);

        if (!session) {
            return res.status(400).json({ error: 'No active course session to end.' });
        }

        if (session.course_id !== courseId) {
            return res.status(409).json({
                error: 'different_active_course',
                message: 'You are actively attending another course.',
                active_course: {
                    course_id: session.course_id,
                    status: session.status,
                    started_at: session.started_at,
                    last_status_at: session.last_status_at,
                    active_tab_id: session.active_tab_id || null
                }
            });
        }

        const endResult = await endAttendanceSession(session.id, { studentId });
        const endedSession = {
            ...session,
            status: ATTENDANCE_ENDED_STATUS,
            ended_at: endResult.ended_at,
            last_status_at: endResult.ended_at,
            active_tab_id: null
        };

        syncConnectedUserAttendance(studentId, null, null, tabId || null);
        emitAttendanceUpdate(studentId, { session: endedSession });
        updateOnlineListDebounced();

        res.json({ session: endedSession });
    } catch (error) {
        console.error('Unattend course error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// List student's enrolled courses
app.get('/api/my-courses', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        const query = `
            SELECT c.*, e.enrolled_at, u.display_name AS teacher_display_name, u.username AS teacher_username
            FROM course_enrollments e
            JOIN courses c ON e.course_id = c.id
            JOIN users u ON c.created_by = u.id
            WHERE e.student_id = ?
            ORDER BY e.enrolled_at DESC
        `;

        db.all(query, [req.user.userId], (err, rows) => {
            if (err) {
                console.error('My courses query error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            const courses = (rows || []).map(row => ({
                id: row.id,
                title: row.title,
                description: row.description,
                enrolled_at: row.enrolled_at,
                teacher_display_name: row.teacher_display_name || row.teacher_username,
                teacher_username: row.teacher_username
            }));

            res.json({ courses });
        });
    } catch (error) {
        console.error('List my courses error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get course enrollments (teacher only)
app.get('/api/courses/:courseId/enrollments', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.params;
        const course = await getCourseById(courseId);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        const query = `
            SELECT e.id, e.enrolled_at, u.id AS student_id, u.username, u.display_name
            FROM course_enrollments e
            JOIN users u ON e.student_id = u.id
            WHERE e.course_id = ?
            ORDER BY e.enrolled_at DESC
        `;

        db.all(query, [courseId], (err, rows) => {
            if (err) {
                console.error('Enrollments query error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            res.json({
                course: {
                    id: course.id,
                    title: course.title,
                    description: course.description,
                    created_at: course.created_at
                },
                enrollments: (rows || []).map(row => ({
                    enrollment_id: row.id,
                    enrolled_at: row.enrolled_at,
                    student_id: row.student_id,
                    username: row.username,
                    display_name: row.display_name || row.username
                }))
            });
        });
    } catch (error) {
        console.error('Get enrollments error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export student data as CSV (teacher only)
app.get('/api/courses/:courseId/export-csv', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.params;
        const { mode } = req.query; // 'basic' or 'full'

        const course = await getCourseById(courseId);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        // Get teacher info
        const teacher = await new Promise((resolve, reject) => {
            db.get('SELECT username, display_name FROM users WHERE id = ?', [course.created_by], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        const teacherName = teacher ? (teacher.display_name || teacher.username) : 'Unknown';
        const courseName = course.title || 'Unknown Course';

        // Get all enrolled students with basic info
        const students = await new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    u.id,
                    u.username,
                    u.display_name,
                    u.created_at as user_created_at,
                    e.enrolled_at
                FROM course_enrollments e
                JOIN users u ON e.student_id = u.id
                WHERE e.course_id = ?
                ORDER BY u.display_name
            `;
            db.all(query, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get quiz scores and statistics
        const scoresQuery = `
            SELECT 
                qr.user_id,
                qr.answer_text,
                qr.answered_at,
                qr.status,
                q.id as quiz_id,
                q.title as quiz_title,
                q.question_type,
                q.correct_answer,
                q.points,
                q.is_scored,
                qp.pushed_at as push_started_at
            FROM quiz_responses qr
            JOIN quizzes q ON qr.quiz_id = q.id
            JOIN quiz_pushes qp ON qr.push_id = qp.id
            WHERE q.course_id = ?
              AND (qp.undone_at IS NULL OR qp.undone_at = '')
              AND qr.status != 'ignored'
        `;

        const allResponses = await new Promise((resolve, reject) => {
            db.all(scoresQuery, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Get attendance data
        const attendanceQuery = `
            SELECT 
                student_id as user_id,
                status,
                started_at,
                ended_at,
                last_status_at
            FROM course_attendance_sessions
            WHERE course_id = ?
            ORDER BY student_id, started_at
        `;

        const attendanceData = await new Promise((resolve, reject) => {
            db.all(attendanceQuery, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Calculate statistics per student
        const studentStats = {};

        students.forEach(student => {
            studentStats[student.id] = {
                ...student,
                total_score: 0,
                answered_count: 0,
                correct_count: 0,
                incorrect_count: 0,
                timeout_count: 0,
                total_time_spent: 0
            };
        });

        // Process responses
        allResponses.forEach(response => {
            if (!studentStats[response.user_id]) return;

            const stats = studentStats[response.user_id];

            if (response.status === 'answered') {
                stats.answered_count++;

                // Check correctness for scored quizzes
                if (response.is_scored && response.correct_answer) {
                    const answerValue = parseStoredAnswer(response.answer_text);
                    const correctValue = parseStoredAnswer(response.correct_answer);

                    let isCorrect = false;

                    if (response.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                        const selectedText = answerValue.selected_text || '';
                        const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                        const extractedAnswer = match ? match[1].trim() : selectedText.trim();
                        isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                    } else {
                        const answerDisplay = formatAnswerForDisplay(answerValue);
                        const correctDisplay = formatAnswerForDisplay(correctValue);
                        isCorrect = answerDisplay.toLowerCase().trim() === correctDisplay.toLowerCase().trim();
                    }

                    if (isCorrect) {
                        stats.total_score += response.points || 0;
                        stats.correct_count++;
                    } else {
                        stats.incorrect_count++;
                    }
                }
            } else if (response.status === 'timeout') {
                stats.timeout_count++;
            }
        });

        // Calculate attendance time - calculate duration from timestamps
        attendanceData.forEach(session => {
            if (studentStats[session.user_id]) {
                // Calculate duration in seconds from started_at to ended_at or last_status_at
                const startTime = new Date(session.started_at);
                const endTime = session.ended_at ? new Date(session.ended_at) : new Date(session.last_status_at);
                const durationSeconds = Math.floor((endTime - startTime) / 1000);

                if (durationSeconds > 0) {
                    studentStats[session.user_id].total_time_spent += durationSeconds;
                }
            }
        });

        // Calculate percentiles for scored quizzes
        const scoredStudents = Object.values(studentStats)
            .filter(s => s.answered_count > 0)
            .sort((a, b) => a.total_score - b.total_score);

        scoredStudents.forEach((student, index) => {
            student.percentile = scoredStudents.length > 1
                ? Math.round((index / (scoredStudents.length - 1)) * 100)
                : 50;
        });

        // Generate CSV
        let csv = '';

        if (mode === 'full') {
            // Full data export - simplified with essential fields only
            csv = 'Course,Teacher,User ID,Username,Display Name,Enrolled At,Total Score,Answered,Correct,Incorrect,Timeout,Time Spent (seconds),Percentile\n';

            Object.values(studentStats).forEach(student => {
                csv += `${escapeCSV(courseName)},${escapeCSV(teacherName)},${escapeCSV(student.id)},${escapeCSV(student.username)},${escapeCSV(student.display_name || '')},${escapeCSV(student.enrolled_at || '')},${student.total_score},${student.answered_count},${student.correct_count},${student.incorrect_count},${student.timeout_count},${student.total_time_spent},${student.percentile || 0}\n`;
            });
        } else {
            // Basic export - one row per student with summary
            csv = 'Course,Teacher,Name,Username,Enrolled At,Time Spent (min),Total Score,Answered,Correct,Incorrect,Percentile\n';

            Object.values(studentStats).forEach(student => {
                const timeMinutes = Math.round(student.total_time_spent / 60);
                csv += `${escapeCSV(courseName)},${escapeCSV(teacherName)},${escapeCSV(student.display_name || student.username)},${escapeCSV(student.username)},${escapeCSV(student.enrolled_at || '')},${timeMinutes},${student.total_score},${student.answered_count},${student.correct_count},${student.incorrect_count},${student.percentile || 0}\n`;
            });
        }

        // Set headers for file download
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const cleanTitle = course.title.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
        const filename = `${cleanTitle}_students_${mode}_${timestamp}.csv`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send('\ufeff' + csv); // UTF-8 BOM for Excel compatibility
    } catch (error) {
        console.error('CSV export error:', error);
        res.status(500).json({ error: 'Failed to generate CSV export' });
    }
});

// Helper function to escape CSV values
function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

// Get student scores and rankings for a course (teacher only)
app.get('/api/courses/:courseId/scores', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.params;
        const course = await getCourseById(courseId);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        // Get all enrolled students
        const students = await new Promise((resolve, reject) => {
            const query = `
                SELECT u.id, u.username, u.display_name
                FROM course_enrollments e
                JOIN users u ON e.student_id = u.id
                WHERE e.course_id = ?
                ORDER BY u.display_name
            `;
            db.all(query, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Calculate scores for each student
        // We need to check correctness, so we'll fetch responses and check them programmatically
        const responsesQuery = `
            SELECT 
                qr.user_id,
                qr.answer_text,
                q.question_type,
                q.correct_answer,
                q.points,
                q.is_scored,
                qr.status
            FROM quiz_responses qr
            JOIN quizzes q ON qr.quiz_id = q.id
            JOIN quiz_pushes qp ON qr.push_id = qp.id
            WHERE q.course_id = ?
              AND (qp.undone_at IS NULL OR qp.undone_at = '')
              AND qr.status != 'ignored'
              AND q.is_scored = 1
              AND qr.status = 'answered'
        `;

        const responses = await new Promise((resolve, reject) => {
            db.all(responsesQuery, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Calculate scores by checking correctness
        const scoresMap = {};
        responses.forEach(response => {
            if (!scoresMap[response.user_id]) {
                scoresMap[response.user_id] = {
                    total_score: 0,
                    correct_count: 0,
                    incorrect_count: 0,
                    answered_count: 0
                };
            }

            scoresMap[response.user_id].answered_count++;

            // Check if answer is correct
            if (response.correct_answer) {
                const answerValue = parseStoredAnswer(response.answer_text);
                const correctValue = parseStoredAnswer(response.correct_answer);

                let isCorrect = false;

                if (response.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                    // Extract answer from select-type response
                    const selectedText = answerValue.selected_text || '';
                    const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                    const extractedAnswer = match ? match[1].trim() : selectedText.trim();
                    isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                } else {
                    // Direct comparison for text-type
                    const answerDisplay = formatAnswerForDisplay(answerValue);
                    const correctDisplay = formatAnswerForDisplay(correctValue);
                    isCorrect = answerDisplay.toLowerCase().trim() === correctDisplay.toLowerCase().trim();
                }

                if (isCorrect) {
                    scoresMap[response.user_id].total_score += response.points || 0;
                    scoresMap[response.user_id].correct_count++;
                } else {
                    scoresMap[response.user_id].incorrect_count++;
                }
            }
        });

        // Get timeout counts separately
        const timeoutQuery = `
            SELECT 
                qr.user_id,
                COUNT(*) as timeout_count
            FROM quiz_responses qr
            JOIN quizzes q ON qr.quiz_id = q.id
            JOIN quiz_pushes qp ON qr.push_id = qp.id
            WHERE q.course_id = ?
              AND (qp.undone_at IS NULL OR qp.undone_at = '')
              AND qr.status = 'timeout'
              AND q.is_scored = 1
            GROUP BY qr.user_id
        `;

        const timeouts = await new Promise((resolve, reject) => {
            db.all(timeoutQuery, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        timeouts.forEach(timeout => {
            if (!scoresMap[timeout.user_id]) {
                scoresMap[timeout.user_id] = {
                    total_score: 0,
                    correct_count: 0,
                    incorrect_count: 0,
                    answered_count: 0
                };
            }
            scoresMap[timeout.user_id].timeout_count = Number(timeout.timeout_count || 0);
        });

        // Build student scores array
        const studentScores = students.map(student => ({
            student_id: student.id,
            username: student.username,
            display_name: student.display_name || student.username,
            total_score: scoresMap[student.id]?.total_score || 0,
            answered_count: scoresMap[student.id]?.answered_count || 0,
            correct_count: scoresMap[student.id]?.correct_count || 0,
            incorrect_count: scoresMap[student.id]?.incorrect_count || 0,
            timeout_count: scoresMap[student.id]?.timeout_count || 0
        }));

        // Sort by total_score descending and assign rankings
        studentScores.sort((a, b) => b.total_score - a.total_score);

        let currentRank = 1;
        studentScores.forEach((student, index) => {
            if (index > 0 && student.total_score < studentScores[index - 1].total_score) {
                currentRank = index + 1;
            }
            student.rank = currentRank;
        });

        res.json({
            course: {
                id: course.id,
                title: course.title,
                description: course.description
            },
            scores: studentScores
        });
    } catch (error) {
        console.error('Get course scores error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Push quiz answers to students (teacher only)
app.post('/api/courses/:courseId/push-answers', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.params;
        const course = await getCourseById(courseId);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        // Get all students enrolled in this course
        const students = await new Promise((resolve, reject) => {
            db.all(
                'SELECT student_id FROM course_enrollments WHERE course_id = ?',
                [courseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        if (students.length === 0) {
            return res.json({ message: 'No students enrolled', pushed_to: 0 });
        }

        // Get all quiz responses for students in this course
        const responsesQuery = `
            SELECT 
                qr.user_id,
                qr.quiz_id,
                qr.answer_text,
                qr.status,
                qr.answered_at,
                q.title as quiz_title,
                q.content_text as quiz_content,
                q.correct_answer,
                q.question_type,
                q.points,
                q.is_scored
            FROM quiz_responses qr
            JOIN quizzes q ON qr.quiz_id = q.id
            JOIN quiz_pushes qp ON qr.push_id = qp.id
            WHERE q.course_id = ?
              AND (qp.undone_at IS NULL OR qp.undone_at = '')
              AND qr.status != 'ignored'
            ORDER BY qr.answered_at
        `;

        const allResponses = await new Promise((resolve, reject) => {
            db.all(responsesQuery, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // Group responses by student
        const studentResults = {};
        students.forEach(s => {
            studentResults[s.student_id] = [];
        });

        allResponses.forEach(response => {
            if (!studentResults[response.user_id]) return;

            const answerValue = parseStoredAnswer(response.answer_text);
            const correctValue = parseStoredAnswer(response.correct_answer);

            let isCorrect = false;
            let studentAnswer = formatAnswerForDisplay(answerValue);
            let correctAnswer = formatAnswerForDisplay(correctValue);

            // Check correctness for scored quizzes
            if (response.is_scored && response.correct_answer) {
                if (response.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                    // Single choice - extract selected_text and compare
                    const selectedText = answerValue.selected_text || '';
                    const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                    const extractedAnswer = match ? match[1].trim() : selectedText.trim();
                    isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                } else if (response.question_type === 'checkbox') {
                    // Multiple choice - compare arrays
                    if (Array.isArray(answerValue) && Array.isArray(correctValue)) {
                        // Sort both arrays and compare
                        const sortedAnswer = answerValue.map(a => String(a).toLowerCase().trim()).sort();
                        const sortedCorrect = correctValue.map(c => String(c).toLowerCase().trim()).sort();
                        isCorrect = JSON.stringify(sortedAnswer) === JSON.stringify(sortedCorrect);
                    }
                } else {
                    // Text answer - direct comparison
                    isCorrect = studentAnswer.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
                }
            }

            studentResults[response.user_id].push({
                quiz_title: response.quiz_title,
                quiz_content: response.quiz_content,
                your_answer: response.status === 'answered' ? studentAnswer : 'No answer (timeout)',
                correct_answer: correctAnswer || 'Not graded',
                is_correct: isCorrect,
                status: response.status,
                points: response.points || 0,
                is_scored: response.is_scored,
                answered_at: response.answered_at
            });
        });

        // Emit to all students in the course
        let pushedCount = 0;
        students.forEach(student => {
            // Find connected socket for this student
            const connectedStudent = Array.from(connectedUsers.values())
                .find(user => user.userId === student.student_id && user.role === 'student');

            if (connectedStudent) {
                const socket = io.sockets.sockets.get(connectedStudent.socketId);
                if (socket) {
                    socket.emit('show_answers', {
                        course_title: course.title,
                        results: studentResults[student.student_id] || []
                    });
                    pushedCount++;
                }
            }
        });

        res.json({
            message: 'Answers pushed to students',
            pushed_to: pushedCount,
            total_students: students.length
        });
    } catch (error) {
        console.error('Push answers error:', error);
        res.status(500).json({ error: 'Failed to push answers' });
    }
});

// Get current user
app.get('/api/me', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

// Get quizzes (teacher only)
app.get('/api/quizzes', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.query;
        const course = await ensureTeacherOwnsCourse(req.user.userId, courseId);

        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        const quizzes = await getQuizzesFromDB(req.user.userId, courseId);
        res.json({ quizzes });
    } catch (error) {
        console.error('Get quizzes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create quiz (teacher only)
app.post('/api/quizzes', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { title, content_text, images, question_type, options, correct_answer, category_id, course_id, timeout_seconds, is_scored, points } = req.body;

        if (!title || !question_type) {
            return res.status(400).json({ error: 'Title and question type required' });
        }

        // Basic validation and length limits (no XSS sanitization for trusted teacher content)
        const sanitizedTitle = String(title).trim().slice(0, 200);
        const sanitizedContent = content_text ? String(content_text).trim() : '';

        // Options array validation
        let sanitizedOptions = [];
        if (Array.isArray(options)) {
            sanitizedOptions = options.map(opt => String(opt).trim().slice(0, 500)).slice(0, 20);
        }

        // Correct answer validation
        let sanitizedCorrectAnswer = correct_answer;
        if (typeof correct_answer === 'string') {
            sanitizedCorrectAnswer = correct_answer.trim().slice(0, 1000);
        } else if (Array.isArray(correct_answer)) {
            sanitizedCorrectAnswer = correct_answer.map(ans => String(ans).trim().slice(0, 500));
        }

        if (!course_id) {
            return res.status(400).json({ error: 'Course ID required' });
        }

        const course = await ensureTeacherOwnsCourse(req.user.userId, course_id);
        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        if (category_id) {
            const categoryValid = await verifyCategoryForTeacher(category_id, req.user.userId, course_id);
            if (!categoryValid) {
                return res.status(400).json({ error: 'Category does not belong to this course' });
            }
        }

        const quiz = {
            id: uuidv4(),
            title: sanitizedTitle,
            content_text: sanitizedContent,
            images: images || [],
            question_type,
            options: sanitizedOptions,
            correct_answer: sanitizedCorrectAnswer,
            category_id: category_id || null,
            course_id,
            created_by: req.user.userId,
            timeout_seconds: timeout_seconds || 60,
            is_scored: is_scored !== undefined ? (is_scored ? 1 : 0) : 1,
            points: points !== undefined ? parseInt(points, 10) : 1
        };

        const savedQuiz = await createQuizInDB(quiz);
        res.json({ quiz: savedQuiz });
    } catch (error) {
        console.error('Create quiz error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Edit quiz (teacher only)
app.put('/api/quizzes/:quizId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quizId } = req.params;
        const { title, content_text, images, question_type, options, correct_answer, category_id, course_id, timeout_seconds, is_scored, points } = req.body;

        if (!title || !question_type) {
            return res.status(400).json({ error: 'Title and question type required' });
        }

        // Basic validation and length limits (no XSS sanitization for trusted teacher content)
        const sanitizedTitle = String(title).trim().slice(0, 200);
        const sanitizedContent = content_text ? String(content_text).trim() : '';

        // Options array validation
        let sanitizedOptions = [];
        if (Array.isArray(options)) {
            sanitizedOptions = options.map(opt => String(opt).trim().slice(0, 500)).slice(0, 20);
        }

        // Correct answer validation
        let sanitizedCorrectAnswer = correct_answer;
        if (typeof correct_answer === 'string') {
            sanitizedCorrectAnswer = correct_answer.trim().slice(0, 1000);
        } else if (Array.isArray(correct_answer)) {
            sanitizedCorrectAnswer = correct_answer.map(ans => String(ans).trim().slice(0, 500));
        }

        let courseIdToUse = course_id || null;

        const existingQuiz = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM quizzes WHERE id = ? AND created_by = ?', [quizId, req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row || null);
            });
        });

        if (!existingQuiz) {
            return res.status(404).json({ error: 'Quiz not found or access denied' });
        }

        if (!courseIdToUse) {
            courseIdToUse = existingQuiz.course_id;
        }

        const course = await ensureTeacherOwnsCourse(req.user.userId, courseIdToUse);
        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        if (existingQuiz.course_id && existingQuiz.course_id !== course.id) {
            return res.status(400).json({ error: 'Cannot move quiz between courses' });
        }

        if (category_id) {
            const categoryValid = await verifyCategoryForTeacher(category_id, req.user.userId, course.id);
            if (!categoryValid) {
                return res.status(400).json({ error: 'Category does not belong to this course' });
            }
        }

        // Update quiz in database
        const stmt = db.prepare(`
            UPDATE quizzes 
            SET title = ?, content_text = ?, images = ?, question_type = ?, options = ?, correct_answer = ?, category_id = ?, timeout_seconds = ?, is_scored = ?, points = ?
            WHERE id = ? AND created_by = ?
        `);

        stmt.run([
            sanitizedTitle,
            sanitizedContent,
            JSON.stringify(images || []),
            question_type,
            JSON.stringify(sanitizedOptions),
            typeof sanitizedCorrectAnswer === 'string' ? sanitizedCorrectAnswer : JSON.stringify(sanitizedCorrectAnswer),
            category_id || null,
            timeout_seconds || 60,
            is_scored !== undefined ? (is_scored ? 1 : 0) : 1,
            points !== undefined ? parseInt(points, 10) : 1,
            quizId,
            req.user.userId
        ], function (err) {
            if (err) {
                console.error('Update quiz error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Quiz not found or access denied' });
            }

            res.json({ message: 'Quiz updated successfully', quizId });
        });

        stmt.finalize();
    } catch (error) {
        console.error('Edit quiz error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get quiz responses overview (teacher only)
app.get('/api/quizzes/:quizId/responses', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quizId } = req.params;

        // Get quiz details
        const quiz = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM quizzes WHERE id = ? AND created_by = ?', [quizId, req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!quiz) {
            return res.status(404).json({ error: 'Quiz not found or access denied' });
        }

        // Get all responses for this quiz
        const responses = await new Promise((resolve, reject) => {
            db.all(`
                SELECT qr.*, u.username, u.display_name, qp.pushed_at
                FROM quiz_responses qr
                JOIN users u ON qr.user_id = u.id
                JOIN quiz_pushes qp ON qr.push_id = qp.id
                WHERE qr.quiz_id = ?
                ORDER BY qp.pushed_at DESC, qr.answered_at ASC
            `, [quizId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const correctValue = parseStoredAnswer(quiz.correct_answer);
        const correctDisplay = formatAnswerForDisplay(correctValue);

        // Check if answer is correct
        const responsesWithGrading = responses.map(response => {
            const answerValue = parseStoredAnswer(response.answer_text);
            let answerDisplay = formatAnswerForDisplay(answerValue);
            const name = response.display_name || response.username;

            // For select-type questions, extract the actual answer from the object
            let isCorrect = null;
            if (quiz.correct_answer) {
                if (quiz.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                    // Student answer is {selected_index: 2, selected_text: "(c) 1945"}
                    // Need to extract just the answer part without the option label
                    const selectedText = answerValue.selected_text || '';
                    answerDisplay = selectedText;

                    // Extract the answer after the closing parenthesis, e.g., "(c) 1945" -> "1945"
                    const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                    const extractedAnswer = match ? match[1].trim() : selectedText.trim();

                    // Compare with correct answer (case-insensitive for text)
                    isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                } else {
                    // For text-type or other questions, direct comparison
                    isCorrect = answerDisplay.toLowerCase().trim() === String(correctDisplay).toLowerCase().trim();
                }
            }

            return {
                ...response,
                display_name: name,
                answer_text: answerDisplay,
                raw_answer_text: response.answer_text,
                correct_answer_text: correctDisplay,
                is_correct: isCorrect
            };
        });

        res.json({
            quiz: {
                ...quiz,
                images: JSON.parse(quiz.images || '[]'),
                options: JSON.parse(quiz.options || '[]')
            },
            responses: responsesWithGrading
        });
    } catch (error) {
        console.error('Get quiz responses error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get categories (teacher only)
app.get('/api/categories', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.query;

        const course = await ensureTeacherOwnsCourse(req.user.userId, courseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        const categories = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM quiz_categories 
                 WHERE created_by = ? AND course_id = ?
                 ORDER BY name`,
                [req.user.userId, courseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows);
                }
            );
        });

        res.json({ categories });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Create category (teacher only)
app.post('/api/categories', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { name, description, parent_id, course_id } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Category name required' });
        }

        if (!course_id) {
            return res.status(400).json({ error: 'Course ID required' });
        }

        const course = await ensureTeacherOwnsCourse(req.user.userId, course_id);
        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        if (parent_id) {
            const parentCategory = await getCategoryById(parent_id);
            if (!parentCategory || parentCategory.created_by !== req.user.userId || (parentCategory.course_id && parentCategory.course_id !== course_id)) {
                return res.status(400).json({ error: 'Parent category does not belong to this course' });
            }
        }

        const categoryId = uuidv4();
        const stmt = db.prepare(`
            INSERT INTO quiz_categories (id, name, description, parent_id, course_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        stmt.run([categoryId, name, description || '', parent_id || null, course_id, req.user.userId], function (err) {
            if (err) {
                console.error('Create category error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            res.json({
                category: {
                    id: categoryId,
                    name,
                    description: description || '',
                    parent_id: parent_id || null,
                    course_id
                }
            });
        });

        stmt.finalize();
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update category (teacher only)
app.put('/api/categories/:categoryId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { categoryId } = req.params;
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Category name required' });
        }

        const category = await getCategoryById(categoryId);
        if (!category || category.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Category not found or access denied' });
        }

        db.run('UPDATE quiz_categories SET name = ?, description = ? WHERE id = ? AND created_by = ?',
            [name, description || '', categoryId, req.user.userId],
            function (err) {
                if (err) {
                    console.error('Update category error:', err);
                    return res.status(500).json({ error: 'Internal server error' });
                }

                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Category not found or access denied' });
                }

                res.json({ message: 'Category updated successfully' });
            }
        );
    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete category (teacher only)
app.delete('/api/categories/:categoryId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { categoryId } = req.params;

        // Check if category has any quizzes
        const quizCount = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) as count FROM quizzes WHERE category_id = ?', [categoryId], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        if (quizCount > 0) {
            return res.status(400).json({ error: 'Cannot delete category that contains quizzes. Move or delete quizzes first.' });
        }

        const category = await getCategoryById(categoryId);
        if (!category || category.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Category not found or access denied' });
        }

        db.run('DELETE FROM quiz_categories WHERE id = ? AND created_by = ?', [categoryId, req.user.userId], function (err) {
            if (err) {
                console.error('Delete category error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Category not found or access denied' });
            }

            res.json({ message: 'Category deleted successfully' });
        });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete quiz (teacher only)
app.delete('/api/quizzes/:quizId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quizId } = req.params;

        db.run('DELETE FROM quizzes WHERE id = ? AND created_by = ?', [quizId, req.user.userId], function (err) {
            if (err) {
                console.error('Delete quiz error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Quiz not found or access denied' });
            }

            res.json({ message: 'Quiz deleted successfully' });
        });
    } catch (error) {
        console.error('Delete quiz error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Export quizzes as JSON (teacher only)
app.post('/api/quizzes/export', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quizIds, courseId } = req.body;

        let query = 'SELECT * FROM quizzes WHERE created_by = ?';
        let params = [req.user.userId];

        if (quizIds && Array.isArray(quizIds) && quizIds.length > 0) {
            // Export specific quizzes
            const placeholders = quizIds.map(() => '?').join(',');
            query += ` AND id IN (${placeholders})`;
            params.push(...quizIds);
        } else if (courseId) {
            // Export all quizzes from a course
            query += ' AND course_id = ?';
            params.push(courseId);
        }

        query += ' ORDER BY created_at DESC';

        db.all(query, params, (err, rows) => {
            if (err) {
                console.error('Export quizzes error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            // Parse JSON fields
            const quizzes = rows.map(row => ({
                title: row.title,
                content_text: row.content_text,
                images: JSON.parse(row.images || '[]'),
                question_type: row.question_type,
                options: JSON.parse(row.options || '[]'),
                correct_answer: row.correct_answer,
                category_id: row.category_id,
                course_id: row.course_id,
                timeout_seconds: row.timeout_seconds,
                is_scored: row.is_scored,
                points: row.points
            }));

            const exportData = {
                version: '1.0',
                exported_at: new Date().toISOString(),
                exported_by: req.user.userId,
                count: quizzes.length,
                quizzes: quizzes
            };

            res.json(exportData);
        });
    } catch (error) {
        console.error('Export quizzes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Import quizzes from JSON (teacher only)
app.post('/api/quizzes/import', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quizzes, targetCourseId, targetCategoryId } = req.body;

        if (!Array.isArray(quizzes) || quizzes.length === 0) {
            return res.status(400).json({ error: 'Invalid import data: quizzes array required' });
        }

        // Validate target course if provided
        if (targetCourseId) {
            const course = await ensureTeacherOwnsCourse(req.user.userId, targetCourseId);
            if (!course) {
                return res.status(404).json({ error: 'Target course not found or access denied' });
            }
        }

        const imported = [];
        const errors = [];

        for (let i = 0; i < quizzes.length; i++) {
            const quizData = quizzes[i];

            try {
                // Validate required fields
                if (!quizData.title || !quizData.question_type) {
                    errors.push({ index: i, title: quizData.title || 'Untitled', error: 'Missing required fields' });
                    continue;
                }

                // Create new quiz with new ID
                const newQuiz = {
                    id: uuidv4(),
                    title: quizData.title,
                    content_text: quizData.content_text || '',
                    images: quizData.images || [],
                    question_type: quizData.question_type,
                    options: quizData.options || [],
                    correct_answer: quizData.correct_answer || '',
                    category_id: targetCategoryId || quizData.category_id || null,
                    course_id: targetCourseId || quizData.course_id || null,
                    created_by: req.user.userId,
                    timeout_seconds: quizData.timeout_seconds || 60,
                    is_scored: quizData.is_scored !== undefined ? (quizData.is_scored ? 1 : 0) : 1,
                    points: quizData.points !== undefined ? parseInt(quizData.points, 10) : 1
                };

                await createQuizInDB(newQuiz);
                imported.push({ title: newQuiz.title, id: newQuiz.id });
            } catch (error) {
                console.error(`Import quiz ${i} error:`, error);
                errors.push({ index: i, title: quizData.title || 'Untitled', error: error.message });
            }
        }

        res.json({
            success: true,
            imported: imported.length,
            failed: errors.length,
            details: {
                imported: imported,
                errors: errors
            }
        });
    } catch (error) {
        console.error('Import quizzes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get student's quiz history (student only)
app.get('/api/my-quiz-history', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        // Get both queue entries AND responses to show complete history
        const query = `
            SELECT 
                COALESCE(sqq.id, qr.id) as id,
                COALESCE(sqq.push_id, qr.push_id) as push_id,
                COALESCE(sqq.quiz_id, qr.quiz_id) as quiz_id,
                sqq.added_at,
                sqq.first_viewed_at,
                COALESCE(sqq.status, qr.status) as status,
                q.title,
                q.question_type,
                q.timeout_seconds,
                qp.pushed_at,
                qp.undone_at,
                qr.answered_at,
                qr.answer_text,
                CASE 
                    WHEN sqq.id IS NOT NULL THEN sqq.added_at
                    WHEN qr.answered_at IS NOT NULL THEN qr.answered_at
                    ELSE qp.pushed_at
                END as sort_time
            FROM (
                SELECT DISTINCT push_id, quiz_id, user_id FROM student_quiz_queue WHERE user_id = ?
                UNION
                SELECT DISTINCT push_id, quiz_id, user_id FROM quiz_responses WHERE user_id = ?
            ) combined
            LEFT JOIN student_quiz_queue sqq ON combined.push_id = sqq.push_id AND combined.user_id = sqq.user_id
            LEFT JOIN quiz_responses qr ON combined.push_id = qr.push_id AND combined.user_id = qr.user_id
            LEFT JOIN quizzes q ON combined.quiz_id = q.id
            LEFT JOIN quiz_pushes qp ON combined.push_id = qp.id
            WHERE combined.user_id = ?
            ORDER BY sort_time DESC
        `;

        db.all(query, [req.user.userId, req.user.userId, req.user.userId], (err, rows) => {
            if (err) {
                console.error('Get quiz history error:', err);
                return res.status(500).json({ error: 'Internal server error' });
            }

            // Check for orphaned records (quiz deleted from teacher's database)
            const history = rows.map(row => ({
                id: row.id,
                push_id: row.push_id,
                quiz_id: row.quiz_id,
                quiz_exists: !!row.title, // If title is null, quiz was deleted
                quiz_title: row.title || `[DELETED] Quiz ${row.quiz_id}`,
                question_type: row.question_type,
                timeout_seconds: row.timeout_seconds,
                status: row.status,
                added_at: row.added_at,
                first_viewed_at: row.first_viewed_at,
                pushed_at: row.pushed_at,
                undone_at: row.undone_at,
                answered_at: row.answered_at,
                answer_text: row.answer_text
            }));

            res.json({
                history,
                total: history.length,
                orphaned: history.filter(h => !h.quiz_exists).length
            });
        });
    } catch (error) {
        console.error('Get quiz history error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Clean up orphaned quiz records (student only)
app.post('/api/cleanup-orphaned-quizzes', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        const { all } = req.body; // If all=true, delete everything; otherwise only orphaned
        let totalRemoved = 0;

        if (all) {
            // Delete ALL quiz queue entries for this student
            const queueRemoved = await new Promise((resolve, reject) => {
                db.run(
                    `DELETE FROM student_quiz_queue WHERE user_id = ?`,
                    [req.user.userId],
                    function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(this.changes);
                        }
                    }
                );
            });

            totalRemoved += queueRemoved;

            // Delete ALL quiz responses for this student
            const responsesRemoved = await new Promise((resolve, reject) => {
                db.run(
                    `DELETE FROM quiz_responses WHERE user_id = ?`,
                    [req.user.userId],
                    function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(this.changes);
                        }
                    }
                );
            });

            totalRemoved += responsesRemoved;
        } else {
            // Delete quiz queue entries where the quiz no longer exists
            const queueRemoved = await new Promise((resolve, reject) => {
                db.run(
                    `DELETE FROM student_quiz_queue 
                     WHERE user_id = ? 
                     AND quiz_id NOT IN (SELECT id FROM quizzes)`,
                    [req.user.userId],
                    function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(this.changes);
                        }
                    }
                );
            });

            totalRemoved += queueRemoved;

            // Delete quiz responses where the quiz no longer exists
            const responsesRemoved = await new Promise((resolve, reject) => {
                db.run(
                    `DELETE FROM quiz_responses 
                     WHERE user_id = ? 
                     AND quiz_id NOT IN (SELECT id FROM quizzes)`,
                    [req.user.userId],
                    function (err) {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(this.changes);
                        }
                    }
                );
            });

            totalRemoved += responsesRemoved;
        }

        const snapshot = await getQueueSnapshot(req.user.userId);
        syncStudentQueueCache(req.user.userId, snapshot);
        updateOnlineListDebounced();

        res.json({
            message: 'Cleanup completed',
            removed: totalRemoved,
            queue: buildQueueUpdatePayload(snapshot)
        });
    } catch (error) {
        console.error('Cleanup orphaned quizzes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get active queue status (teacher only)
app.get('/api/queue-status', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { courseId } = req.query;

        // Get all active pushes with quiz details
        const activePushesArray = Array.from(activePushesByQuiz.entries())
            .map(([quizId, push]) => ({
                push_id: push.id,
                quiz_id: push.quiz_id,
                course_id: push.course_id || null,
                title: push.quiz ? push.quiz.title : 'Unknown Quiz',
                started_at: push.started_at,
                timeout_seconds: push.timeout_seconds
            }))
            .filter(push => !courseId || push.course_id === courseId);

        res.json({
            active_pushes: activePushesArray,
            count: activePushesArray.length
        });
    } catch (error) {
        console.error('Queue status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Push quiz to students (teacher only)
app.post('/api/pushes', authenticateToken, async (req, res) => {
    // Extend timeout for large classes (default is 120s, set to 5 minutes)
    req.setTimeout(300000);

    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quiz_id, target_scope, timeout_seconds, course_id } = req.body;

        if (!quiz_id) {
            return res.status(400).json({ error: 'Quiz ID required' });
        }

        // Get quiz details
        const quiz = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM quizzes WHERE id = ? AND created_by = ?', [quiz_id, req.user.userId], (err, row) => {
                if (err) reject(err);
                else if (!row) reject(new Error('Quiz not found'));
                else {
                    resolve({
                        ...row,
                        images: JSON.parse(row.images || '[]'),
                        options: JSON.parse(row.options || '[]')
                    });
                }
            });
        });

        if (!quiz.course_id && !course_id) {
            return res.status(400).json({ error: 'Quiz is not associated with a course' });
        }

        const effectiveCourseId = quiz.course_id || course_id;

        if (course_id && quiz.course_id && quiz.course_id !== course_id) {
            return res.status(400).json({ error: 'Quiz does not belong to the specified course' });
        }

        const course = await ensureTeacherOwnsCourse(req.user.userId, effectiveCourseId);
        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        const enrolledRows = await new Promise((resolve, reject) => {
            db.all('SELECT student_id FROM course_enrollments WHERE course_id = ?', [effectiveCourseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const enrolledSet = new Set(enrolledRows.map(row => row.student_id));

        const push = {
            id: uuidv4(),
            quiz_id,
            pushed_by: req.user.userId,
            target_scope: target_scope || 'all',
            timeout_seconds: timeout_seconds || quiz.timeout_seconds || 60,
            course_id: effectiveCourseId
        };

        // Create push in database
        await createPushInDB(push);

        // Get connected students who are enrolled and actively viewing the course
        const targetStudents = Array.from(connectedUsers.values())
            .filter(user => {
                if (user.role !== 'student') {
                    return false;
                }
                if (!enrolledSet.has(user.userId)) {
                    return false;
                }
                return user.activeCourseId === effectiveCourseId;
            });

        let addedCount = 0;
        let skippedCount = 0;

        // Process all students in parallel batches for better performance
        const batchSize = 20; // Process 20 students at a time
        const studentBatches = [];
        for (let i = 0; i < targetStudents.length; i += batchSize) {
            studentBatches.push(targetStudents.slice(i, i + batchSize));
        }

        for (const batch of studentBatches) {
            const results = await Promise.all(
                batch.map(async (student) => {
                    try {
                        // Check if this quiz is already in student's queue
                        const alreadyInQueue = await checkQuizInStudentQueue(student.userId, quiz_id, effectiveCourseId);

                        if (alreadyInQueue) {
                            console.log(`Quiz "${quiz.title}" already in queue for ${student.username}`);
                            return { status: 'skipped', student };
                        }

                        // Check if student already answered this quiz
                        const alreadyAnswered = await checkQuizAlreadyAnswered(student.userId, quiz_id);

                        if (alreadyAnswered) {
                            console.log(`Quiz "${quiz.title}" already answered by ${student.username}`);
                            return { status: 'skipped', student };
                        }

                        // Add to student's queue
                        const result = await addToStudentQueue(student.userId, push.id, quiz_id, quiz);
                        if (result.added) {
                            const snapshot = await getQueueSnapshot(student.userId, effectiveCourseId);
                            syncStudentQueueCache(student.userId, snapshot);

                            io.to(student.socketId).emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

                            if (snapshot.currentQuiz && snapshot.currentQuiz.push_id === push.id) {
                                io.to(student.socketId).emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
                            }
                            return { status: 'added', student };
                        } else {
                            return { status: 'skipped', student };
                        }
                    } catch (err) {
                        console.error(`Error adding to queue for ${student.username}:`, err);
                        return { status: 'error', student, error: err };
                    }
                })
            );

            // Tally results from this batch
            results.forEach(result => {
                if (result.status === 'added') {
                    addedCount++;
                } else if (result.status === 'skipped' || result.status === 'error') {
                    skippedCount++;
                }
            });
        }

        // Store active push metadata for both push and quiz indexes
        const activeMeta = {
            ...push,
            quiz,
            targetUsers: targetStudents.map(s => s.userId),
            started_at: new Date().toISOString()
        };

        activePushes.set(push.id, activeMeta);
        activePushesByQuiz.set(push.quiz_id, activeMeta);

        schedulePushTimeoutCheck(push.id).catch((error) => {
            console.error('schedulePushTimeoutCheck error:', error);
        });

        // Notify teachers about the push
        const teachers = Array.from(connectedUsers.values())
            .filter(user => user.role === 'teacher');

        const message = skippedCount > 0
            ? `Quiz sent to ${addedCount}/${targetStudents.length} students (${skippedCount} already have it)`
            : `Quiz sent to ${addedCount} students`;

        teachers.forEach(teacher => {
            io.to(teacher.socketId).emit('push_created', {
                push_id: push.id,
                quiz_id,
                course_id: effectiveCourseId,
                target_count: addedCount,
                skipped_count: skippedCount,
                total_students: targetStudents.length,
                message: message
            });
        });

        // Note: updateOnlineList is debounced and will be triggered by socket events from students
        // No need to call it immediately here during mass push to avoid cascade

        res.json({
            push,
            added_count: addedCount,
            skipped_count: skippedCount,
            message: message
        });
    } catch (error) {
        console.error('Push quiz error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bulk push multiple quizzes
app.post('/api/pushes/bulk', authenticateToken, async (req, res) => {
    req.setTimeout(300000); // 5 minutes timeout for bulk operations

    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { quiz_ids, course_id } = req.body;

        if (!quiz_ids || !Array.isArray(quiz_ids) || quiz_ids.length === 0) {
            return res.status(400).json({ error: 'Quiz IDs array required' });
        }

        if (!course_id) {
            return res.status(400).json({ error: 'Course ID required' });
        }

        // Verify course ownership
        const course = await ensureTeacherOwnsCourse(req.user.userId, course_id);
        if (!course) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        // Get enrolled students
        const enrolledRows = await new Promise((resolve, reject) => {
            db.all('SELECT student_id FROM course_enrollments WHERE course_id = ?', [course_id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        const enrolledSet = new Set(enrolledRows.map(row => row.student_id));

        // Get connected students
        const targetStudents = Array.from(connectedUsers.values())
            .filter(user => {
                return user.role === 'student' &&
                    enrolledSet.has(user.userId) &&
                    user.activeCourseId === course_id;
            });

        const results = {
            total_quizzes: quiz_ids.length,
            pushed_quizzes: [],
            failed_quizzes: [],
            total_students: targetStudents.length,
            total_added: 0,
            total_skipped: 0
        };

        // Process each quiz
        for (const quiz_id of quiz_ids) {
            try {
                // Get quiz details
                const quiz = await new Promise((resolve, reject) => {
                    db.get('SELECT * FROM quizzes WHERE id = ? AND created_by = ?', [quiz_id, req.user.userId], (err, row) => {
                        if (err) reject(err);
                        else if (!row) reject(new Error('Quiz not found'));
                        else {
                            resolve({
                                ...row,
                                images: JSON.parse(row.images || '[]'),
                                options: JSON.parse(row.options || '[]')
                            });
                        }
                    });
                });

                // Verify quiz belongs to course
                if (quiz.course_id !== course_id) {
                    results.failed_quizzes.push({ quiz_id, error: 'Quiz does not belong to the course' });
                    continue;
                }

                // Create push
                const push = {
                    id: uuidv4(),
                    quiz_id,
                    pushed_by: req.user.userId,
                    target_scope: 'all',
                    timeout_seconds: quiz.timeout_seconds || 60,
                    course_id: course_id
                };

                await createPushInDB(push);

                let addedCount = 0;
                let skippedCount = 0;

                // Add to each student's queue
                const batchSize = 20;
                const studentBatches = [];
                for (let i = 0; i < targetStudents.length; i += batchSize) {
                    studentBatches.push(targetStudents.slice(i, i + batchSize));
                }

                for (const batch of studentBatches) {
                    const batchResults = await Promise.all(
                        batch.map(async (student) => {
                            try {
                                const alreadyInQueue = await checkQuizInStudentQueue(student.userId, quiz_id, course_id);
                                if (alreadyInQueue) return { status: 'skipped' };

                                const alreadyAnswered = await checkQuizAlreadyAnswered(student.userId, quiz_id);
                                if (alreadyAnswered) return { status: 'skipped' };

                                const result = await addToStudentQueue(student.userId, push.id, quiz_id, quiz);
                                if (result.added) {
                                    const snapshot = await getQueueSnapshot(student.userId, course_id);
                                    syncStudentQueueCache(student.userId, snapshot);
                                    io.to(student.socketId).emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));
                                    if (snapshot.currentQuiz && snapshot.currentQuiz.push_id === push.id) {
                                        io.to(student.socketId).emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
                                    }
                                    return { status: 'added' };
                                }
                                return { status: 'skipped' };
                            } catch (err) {
                                return { status: 'error' };
                            }
                        })
                    );

                    batchResults.forEach(result => {
                        if (result.status === 'added') addedCount++;
                        else skippedCount++;
                    });
                }

                // Store active push metadata
                const activeMeta = {
                    ...push,
                    quiz,
                    targetUsers: targetStudents.map(s => s.userId),
                    started_at: new Date().toISOString()
                };

                activePushes.set(push.id, activeMeta);
                activePushesByQuiz.set(push.quiz_id, activeMeta);

                schedulePushTimeoutCheck(push.id).catch((error) => {
                    console.error('schedulePushTimeoutCheck error:', error);
                });

                results.pushed_quizzes.push({
                    quiz_id,
                    push_id: push.id,
                    quiz_title: quiz.title,
                    added_count: addedCount,
                    skipped_count: skippedCount
                });

                results.total_added += addedCount;
                results.total_skipped += skippedCount;

            } catch (error) {
                console.error(`Error pushing quiz ${quiz_id}:`, error);
                results.failed_quizzes.push({ quiz_id, error: error.message });
            }
        }

        // Notify teachers
        const teachers = Array.from(connectedUsers.values())
            .filter(user => user.role === 'teacher');

        teachers.forEach(teacher => {
            io.to(teacher.socketId).emit('push_created', {
                bulk: true,
                course_id: course_id,
                total_quizzes: results.pushed_quizzes.length,
                total_students: targetStudents.length,
                message: `${results.pushed_quizzes.length} quizzes pushed to ${targetStudents.length} students`
            });
        });

        res.json(results);
    } catch (error) {
        console.error('Bulk push error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get push details for monitor (teacher only)
app.get('/api/pushes/:pushId/details', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { pushId } = req.params;

        // Try to get from active pushes first
        const activePush = activePushes.get(pushId);
        if (activePush) {
            return res.json({
                push_id: pushId,
                quiz_id: activePush.quiz_id,
                quiz_title: activePush.quiz?.title || 'Unknown Quiz',
                course_id: activePush.quiz?.course_id || null,
                target_students_count: activePush.targetUsers?.length || 0,
                started_at: activePush.started_at,
                timeout_seconds: activePush.timeout_seconds
            });
        }

        // Fall back to database
        const push = await new Promise((resolve, reject) => {
            db.get(
                `SELECT qp.*, q.title as quiz_title, q.course_id
                 FROM quiz_pushes qp
                 LEFT JOIN quizzes q ON qp.quiz_id = q.id
                 WHERE qp.id = ?`,
                [pushId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!push) {
            return res.status(404).json({ error: 'Push not found' });
        }

        // Count target students from queue
        const targetCount = await new Promise((resolve, reject) => {
            db.get(
                'SELECT COUNT(DISTINCT user_id) as count FROM student_quiz_queue WHERE push_id = ?',
                [pushId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        res.json({
            push_id: pushId,
            quiz_id: push.quiz_id,
            quiz_title: push.quiz_title || 'Unknown Quiz',
            course_id: push.course_id || null,
            target_students_count: targetCount,
            started_at: push.pushed_at,
            timeout_seconds: push.timeout_seconds
        });
    } catch (error) {
        console.error('Get push details error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get responses for a specific push (teacher only)
app.get('/api/pushes/:pushId/responses', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { pushId } = req.params;

        // Get push to verify it exists and get quiz info
        const push = await new Promise((resolve, reject) => {
            db.get(
                `SELECT qp.*, q.correct_answer, q.question_type 
                 FROM quiz_pushes qp
                 LEFT JOIN quizzes q ON qp.quiz_id = q.id
                 WHERE qp.id = ?`,
                [pushId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!push) {
            return res.status(404).json({ error: 'Push not found' });
        }

        // Get all responses for this push
        const responses = await new Promise((resolve, reject) => {
            db.all(
                `SELECT qr.*, u.username, u.display_name
                 FROM quiz_responses qr
                 JOIN users u ON qr.user_id = u.id
                 WHERE qr.push_id = ?
                 ORDER BY qr.answered_at DESC`,
                [pushId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Calculate correctness for each response
        const responsesWithCorrectness = responses.map(response => {
            let isCorrect = null;

            if (push.correct_answer && response.status === 'answered') {
                const answerValue = parseStoredAnswer(response.answer_text);
                const correctValue = parseStoredAnswer(push.correct_answer);

                if (push.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                    const selectedText = answerValue.selected_text || '';
                    const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                    const extractedAnswer = match ? match[1].trim() : selectedText.trim();
                    isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                } else {
                    const answerDisplay = formatAnswerForDisplay(answerValue);
                    const correctDisplay = formatAnswerForDisplay(correctValue);
                    isCorrect = answerDisplay.toLowerCase().trim() === correctDisplay.toLowerCase().trim();
                }
            }

            return {
                user_id: response.user_id,
                username: response.username,
                display_name: response.display_name || response.username,
                quiz_id: response.quiz_id,
                elapsed_ms: response.elapsed_ms,
                answered_at: response.answered_at,
                status: response.status,
                is_correct: isCorrect
            };
        });

        res.json({
            push_id: pushId,
            responses: responsesWithCorrectness
        });
    } catch (error) {
        console.error('Get push responses error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get all active quizzes with student progress for multi-quiz monitor (teacher only)
app.get('/api/monitor/all-active-quizzes', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        // Get all active pushes from student_quiz_queue
        const activePushesQuery = `
            SELECT DISTINCT 
                sqq.push_id,
                qp.quiz_id,
                qp.pushed_at,
                qp.pushed_by,
                qp.timeout_seconds,
                qp.course_id,
                q.title as quiz_title,
                q.correct_answer,
                q.question_type,
                q.is_scored
            FROM student_quiz_queue sqq
            JOIN quiz_pushes qp ON sqq.push_id = qp.id
            JOIN quizzes q ON sqq.quiz_id = q.id
            WHERE sqq.status IN ('pending', 'viewing', 'answered')
                AND (qp.undone_at IS NULL OR qp.undone_at = '')
            GROUP BY sqq.push_id
            ORDER BY qp.pushed_at DESC
        `;

        const pushes = await new Promise((resolve, reject) => {
            db.all(activePushesQuery, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // For each push, get student data
        const quizzesWithStudents = await Promise.all(pushes.map(async (push) => {
            // Get all students in queue for this push
            const studentsQuery = `
                SELECT 
                    sqq.user_id,
                    sqq.status as queue_status,
                    sqq.first_viewed_at,
                    u.username,
                    u.display_name,
                    qr.elapsed_ms,
                    qr.answered_at,
                    qr.answer_text,
                    qr.status as response_status
                FROM student_quiz_queue sqq
                JOIN users u ON sqq.user_id = u.id
                LEFT JOIN quiz_responses qr ON qr.push_id = sqq.push_id AND qr.user_id = sqq.user_id
                WHERE sqq.push_id = ?
                ORDER BY u.display_name
            `;

            const students = await new Promise((resolve, reject) => {
                db.all(studentsQuery, [push.push_id], (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            // Calculate correctness for answered students
            const studentsWithCorrectness = students.map(student => {
                let isCorrect = null;
                let status = student.queue_status || 'pending';

                // If student has answered, calculate correctness
                if (student.response_status === 'answered' && push.correct_answer && student.answer_text) {
                    const answerValue = parseStoredAnswer(student.answer_text);
                    const correctValue = parseStoredAnswer(push.correct_answer);

                    if (push.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                        const selectedText = answerValue.selected_text || '';
                        const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                        const extractedAnswer = match ? match[1].trim() : selectedText.trim();
                        isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                    } else if (push.question_type === 'checkbox' && Array.isArray(answerValue) && Array.isArray(correctValue)) {
                        // For checkbox, compare arrays
                        const answerSet = new Set(answerValue.map(v => String(v).toLowerCase().trim()));
                        const correctSet = new Set(correctValue.map(v => String(v).toLowerCase().trim()));
                        isCorrect = answerSet.size === correctSet.size &&
                            [...answerSet].every(v => correctSet.has(v));
                    } else {
                        const answerDisplay = formatAnswerForDisplay(answerValue);
                        const correctDisplay = formatAnswerForDisplay(correctValue);
                        isCorrect = answerDisplay.toLowerCase().trim() === correctDisplay.toLowerCase().trim();
                    }

                    status = 'answered';
                }

                return {
                    user_id: student.user_id,
                    display_name: student.display_name || student.username,
                    status: status,
                    elapsed_ms: student.elapsed_ms,
                    answered_at: student.answered_at,
                    is_correct: isCorrect
                };
            });

            return {
                push_id: push.push_id,
                quiz_id: push.quiz_id,
                quiz_title: push.quiz_title,
                pushed_at: push.pushed_at,
                timeout_seconds: push.timeout_seconds,
                course_id: push.course_id,
                students: studentsWithCorrectness
            };
        }));

        res.json({
            quizzes: quizzesWithStudents,
            count: quizzesWithStudents.length
        });
    } catch (error) {
        console.error('Get all active quizzes error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

async function resolveActivePush(identifier) {
    const normalized = identifier ? String(identifier).trim() : '';
    if (!normalized) {
        return null;
    }

    if (activePushes.has(normalized)) {
        const pushData = activePushes.get(normalized);
        return {
            pushId: normalized,
            pushData,
            quizId: pushData ? pushData.quiz_id : null
        };
    }

    if (activePushesByQuiz.has(normalized)) {
        const pushMeta = activePushesByQuiz.get(normalized);
        if (!pushMeta) {
            return null;
        }

        const normalizedPushId = pushMeta.id || pushMeta.push_id;
        if (!normalizedPushId) {
            return null;
        }

        const pushData = activePushes.get(normalizedPushId) || pushMeta;
        return {
            pushId: normalizedPushId,
            pushData,
            quizId: pushMeta.quiz_id || (pushData ? pushData.quiz_id : null)
        };
    }

    try {
        const pushRow = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM quiz_pushes
                 WHERE id = ?
                   AND (undone_at IS NULL OR undone_at = '')
                 LIMIT 1`,
                [normalized],
                (err, row) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(row || null);
                    }
                }
            );
        });

        let rowToUse = pushRow;

        if (!rowToUse) {
            rowToUse = await new Promise((resolve, reject) => {
                db.get(
                    `SELECT * FROM quiz_pushes
                     WHERE quiz_id = ?
                       AND (undone_at IS NULL OR undone_at = '')
                     ORDER BY pushed_at DESC
                     LIMIT 1`,
                    [normalized],
                    (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(row || null);
                        }
                    }
                );
            });
        }

        if (!rowToUse) {
            return null;
        }

        const fallbackPushId = rowToUse.id;
        const mapPush = activePushes.get(fallbackPushId) || activePushesByQuiz.get(rowToUse.quiz_id) || null;

        const pushData = mapPush || {
            id: fallbackPushId,
            push_id: fallbackPushId,
            quiz_id: rowToUse.quiz_id,
            course_id: rowToUse.course_id || null,
            pushed_at: rowToUse.pushed_at,
            started_at: rowToUse.pushed_at,
            timeout_seconds: rowToUse.timeout_seconds,
            targetUsers: []
        };

        return {
            pushId: fallbackPushId,
            pushData,
            quizId: pushData.quiz_id || rowToUse.quiz_id
        };
    } catch (lookupError) {
        console.error('resolveActivePush lookup error:', lookupError);
        return null;
    }
}

// Undo push (teacher only)
app.post('/api/pushes/:identifier/undo', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { identifier } = req.params;
        const resolvedPush = await resolveActivePush(identifier);

        if (!resolvedPush) {
            return res.status(404).json({ error: 'Push not found or already completed' });
        }

        const { pushId, pushData, quizId: resolvedQuizId } = resolvedPush;
        const targetQuizId = resolvedQuizId || (pushData ? pushData.quiz_id : null);
        const pushCourseId = pushData ? pushData.course_id || null : null;

        // Clear timeout
        if (pushTimeouts.has(pushId)) {
            clearTimeout(pushTimeouts.get(pushId));
            pushTimeouts.delete(pushId);
        }

        // Mark as undone in database
        db.run('UPDATE quiz_pushes SET undone_at = CURRENT_TIMESTAMP WHERE id = ?', [pushId]);

        // Remove ALL queue entries for this quiz (not just this push) from all students
        if (targetQuizId) {
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM student_quiz_queue WHERE quiz_id = ?', [targetQuizId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } else {
            // Fallback: remove by push_id if quiz_id unavailable
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM student_quiz_queue WHERE push_id = ?', [pushId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        // Mark prior responses for this quiz as ignored so students can re-answer
        // BUT only mark responses that belong to pushes BEFORE the current one being undone
        // This way, if a student answered during this push, their response stays valid
        if (targetQuizId) {
            await new Promise((resolve, reject) => {
                db.run(
                    `UPDATE quiz_responses 
                     SET status = 'ignored' 
                     WHERE quiz_id = ? 
                       AND push_id != ?
                       AND status != 'ignored'`,
                    [targetQuizId, pushId],
                    (err) => {
                        if (err) {
                            console.error('Error marking responses ignored:', err);
                            reject(err);
                        } else {
                            resolve();
                        }
                    }
                );
            });
        }

        // Send undo only to students who received this quiz
        console.log('=== UNDO DEBUG ===');
        console.log('Identifier:', identifier);
        console.log('Resolved Push ID:', pushId);
        console.log('Quiz ID:', targetQuizId);
        console.log('Push data exists:', !!pushData);

        // Gather ALL students who have this quiz in their queue or responses (not just this push)
        let targetUsers = (pushData && Array.isArray(pushData.targetUsers)) ? pushData.targetUsers : [];

        if (targetQuizId) {
            try {
                // Get all students who have ANY queue entry or response for this quiz
                const allAffectedRows = await new Promise((resolve, reject) => {
                    db.all(
                        `SELECT DISTINCT user_id FROM (
                            SELECT user_id FROM student_quiz_queue WHERE quiz_id = ?
                            UNION
                            SELECT user_id FROM quiz_responses WHERE quiz_id = ?
                        )`,
                        [targetQuizId, targetQuizId],
                        (err, rows) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(rows || []);
                            }
                        }
                    );
                });

                const affectedUserIds = allAffectedRows.map(row => row.user_id).filter(Boolean);

                // Merge with in-memory targets
                const allUsers = new Set([...targetUsers, ...affectedUserIds]);
                targetUsers = Array.from(allUsers);
            } catch (lookupError) {
                console.error('Error loading all affected users for undo:', lookupError);
            }
        }

        if ((!Array.isArray(targetUsers) || targetUsers.length === 0) && pushId) {
            try {
                const responseUserRows = await new Promise((resolve, reject) => {
                    db.all(
                        `SELECT DISTINCT user_id FROM quiz_responses WHERE push_id = ?`,
                        [pushId],
                        (err, rows) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(rows || []);
                            }
                        }
                    );
                });

                targetUsers = responseUserRows.map(row => row.user_id).filter(Boolean);
            } catch (responseLookupError) {
                console.error('Error loading response participants for undo:', responseLookupError);
                targetUsers = Array.isArray(targetUsers) ? targetUsers : [];
            }
        }
        const teachers = Array.from(connectedUsers.values())
            .filter(user => user.role === 'teacher');

        console.log('Total target users for undo:', targetUsers.length);

        if (targetUsers.length > 0) {
            const connectedTargets = Array.from(connectedUsers.values())
                .filter(user => user.role === 'student' && targetUsers.includes(user.userId));

            console.log('Connected targets found:', connectedTargets.length);

            for (const student of connectedTargets) {
                console.log(`Processing undo for student: ${student.username} (${student.socketId})`);

                // Send undo event to close dialog if they're viewing this quiz
                io.to(student.socketId).emit('quiz_undo', {
                    push_id: pushId,
                    quiz_id: targetQuizId,
                    course_id: pushCourseId || student.activeCourseId || null
                });

                const snapshot = await getQueueSnapshot(student.userId, pushCourseId || student.activeCourseId || null);
                syncStudentQueueCache(student.userId, snapshot);

                io.to(student.socketId).emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

                if (snapshot.currentQuiz) {
                    io.to(student.socketId).emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
                } else {
                    io.to(student.socketId).emit('queue_empty', {
                        message: 'Quiz removed. No quizzes remaining.',
                        course_id: pushCourseId || student.activeCourseId || null
                    });
                }

                const studentDisplayName = student.display_name || student.username;
                teachers.forEach(teacher => {
                    io.to(teacher.socketId).emit('quiz_response', {
                        push_id: pushId,
                        quiz_id: targetQuizId,
                        user_id: student.userId,
                        username: student.username,
                        display_name: studentDisplayName,
                        displayName: studentDisplayName,
                        status: 'ignored',
                        elapsed_ms: null,
                        answered_at: new Date().toISOString(),
                        course_id: pushCourseId || null
                    });
                });
            }
        }

        // Notify teachers
        teachers.forEach(teacher => {
            io.to(teacher.socketId).emit('push_undone', { push_id: pushId, quiz_id: targetQuizId, course_id: pushCourseId });
        });

        if (targetQuizId) {
            activePushesByQuiz.delete(String(targetQuizId).trim());
        } else if (identifier) {
            activePushesByQuiz.delete(String(identifier).trim());
        }

        activePushes.delete(pushId);

        // Update online list to reflect queue changes (debounced)
        updateOnlineListDebounced();

        res.json({ message: 'Push undone successfully' });
    } catch (error) {
        console.error('Undo push error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get online students (teacher only)
app.get('/api/students/online', authenticateToken, (req, res) => {
    if (req.user.role !== 'teacher') {
        return res.status(403).json({ error: 'Teacher access required' });
    }

    const onlineStudents = Array.from(connectedUsers.values())
        .filter(user => user.role === 'student')
        .map(user => {
            const displayName = user.display_name || user.username;
            return {
                user_id: user.userId,
                username: user.username,
                display_name: displayName,
                displayName,
                connected_at: user.connectedAt
            };
        });

    res.json({ students: onlineStudents });
});

// Check if student has already answered a push
app.get('/api/check-response/:pushId', authenticateToken, (req, res) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ error: 'Student access required' });
    }

    const { pushId } = req.params;

    db.get('SELECT id FROM quiz_responses WHERE push_id = ? AND user_id = ?',
        [pushId, req.user.userId], (err, row) => {
            if (err) {
                console.error('Error checking response:', err);
                return res.status(500).json({ error: 'Database error' });
            }

            res.json({ already_answered: !!row });
        });
});

// Handle push timeouts using per-student first view timestamps
async function finalizePushIfComplete(pushId, pushMeta) {
    let remaining = 0;
    try {
        remaining = await countActiveQueueEntriesForPush(pushId);
    } catch (error) {
        console.error('Error counting remaining quiz queue entries:', error);
        return false;
    }

    if (remaining > 0) {
        return false;
    }

    if (pushMeta && pushMeta.quiz_id) {
        const quizKey = String(pushMeta.quiz_id).trim();
        activePushesByQuiz.delete(quizKey);
    }
    activePushes.delete(pushId);
    pushTimeouts.delete(pushId);

    if (pushMeta && currentActiveQuiz === pushMeta.quiz_id) {
        currentActiveQuiz = null;
        setTimeout(() => processNextInQueue(), 100);
    }

    return true;
}

async function handlePushTimeout(pushId) {
    if (!pushId) {
        return;
    }

    if (pushTimeouts.has(pushId)) {
        clearTimeout(pushTimeouts.get(pushId));
        pushTimeouts.delete(pushId);
    }

    if (!activePushes.has(pushId)) {
        return;
    }

    const push = activePushes.get(pushId);

    let viewingRows;
    try {
        viewingRows = await getViewingQueueEntriesForPush(pushId);
    } catch (error) {
        console.error('Error loading viewing queue entries for timeout:', error);
        return;
    }

    if (!Array.isArray(viewingRows) || viewingRows.length === 0) {
        const completedNoRows = await finalizePushIfComplete(pushId, push);
        if (completedNoRows) {
            updateOnlineListDebounced();
        }
        return;
    }

    const now = Date.now();
    const dueEntries = [];

    for (const row of viewingRows) {
        const firstViewedMs = parseTimestampToMs(row.first_viewed_at);
        if (firstViewedMs === null) {
            continue;
        }

        const timeoutSeconds = Number(push.timeout_seconds) || Number(row.push_timeout) || Number(row.quiz_timeout) || 60;
        const expiresAt = firstViewedMs + timeoutSeconds * 1000;
        if (!Number.isFinite(expiresAt)) {
            continue;
        }

        if (expiresAt <= now) {
            dueEntries.push({ row, firstViewedMs, timeoutSeconds });
        }
    }

    if (dueEntries.length === 0) {
        await schedulePushTimeoutCheck(pushId);
        return;
    }

    const teachers = Array.from(connectedUsers.values())
        .filter(user => user.role === 'teacher');

    const connectedStudents = Array.from(connectedUsers.values())
        .filter(user => user.role === 'student');
    const connectedStudentMap = new Map(connectedStudents.map(student => [student.userId, student]));

    for (const entry of dueEntries) {
        const { row, firstViewedMs, timeoutSeconds } = entry;
        const userId = row.user_id;

        let hasResponse = true;
        try {
            hasResponse = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM quiz_responses WHERE push_id = ? AND user_id = ?',
                    [pushId, userId], (err, responseRow) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve(!!responseRow);
                        }
                    });
            });
        } catch (error) {
            console.error('Error checking response for timeout:', error);
            continue;
        }

        if (hasResponse) {
            continue;
        }

        const elapsedMs = Math.max(timeoutSeconds * 1000, now - firstViewedMs);
        const startedAtIso = Number.isFinite(firstViewedMs) ? new Date(firstViewedMs).toISOString() : push.started_at;

        const timeoutResponse = {
            id: uuidv4(),
            push_id: pushId,
            quiz_id: push.quiz_id,
            user_id: userId,
            answer_text: null,
            started_at: startedAtIso,
            answered_at: new Date().toISOString(),
            elapsed_ms: elapsedMs,
            status: 'timeout'
        };

        try {
            await createResponseInDB(timeoutResponse);
        } catch (error) {
            console.error('Error creating timeout response:', error);
            continue;
        }

        try {
            await removeFromStudentQueue(userId, pushId, 'removed');
        } catch (error) {
            console.error('Error updating queue status after timeout:', error);
        }

        if (Array.isArray(push.targetUsers)) {
            push.targetUsers = push.targetUsers.filter(id => id !== userId);
        }

        const studentInfo = connectedStudentMap.get(userId);

        if (studentInfo) {
            io.to(studentInfo.socketId).emit('quiz_timeout', {
                push_id: pushId,
                course_id: push.course_id || studentInfo.activeCourseId || null
            });

            try {
                const snapshot = await getQueueSnapshot(userId, push.course_id || studentInfo.activeCourseId || null);
                syncStudentQueueCache(userId, snapshot);

                io.to(studentInfo.socketId).emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

                if (snapshot.currentQuiz) {
                    io.to(studentInfo.socketId).emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
                } else {
                    io.to(studentInfo.socketId).emit('queue_empty', {
                        message: 'All quizzes completed!',
                        course_id: push.course_id || studentInfo.activeCourseId || null
                    });
                }
            } catch (error) {
                console.error('Error refreshing student queue after timeout:', error);
            }
        }

        let teacherPayload = null;
        if (studentInfo) {
            const studentDisplayName = studentInfo.display_name || studentInfo.username;
            teacherPayload = {
                push_id: pushId,
                quiz_id: push.quiz_id,
                user_id: studentInfo.userId,
                username: studentInfo.username,
                display_name: studentDisplayName,
                displayName: studentDisplayName,
                status: 'timeout',
                elapsed_ms: elapsedMs,
                answered_at: timeoutResponse.answered_at,
                course_id: push.course_id || null
            };
        } else {
            try {
                teacherPayload = await new Promise((resolve, reject) => {
                    db.get('SELECT id, username, display_name FROM users WHERE id = ?', [userId], (err, userRow) => {
                        if (err) {
                            reject(err);
                        } else if (!userRow) {
                            resolve(null);
                        } else {
                            const displayName = userRow.display_name || userRow.username;
                            resolve({
                                push_id: pushId,
                                quiz_id: push.quiz_id,
                                user_id: userRow.id,
                                username: userRow.username,
                                display_name: displayName,
                                displayName: displayName,
                                status: 'timeout',
                                elapsed_ms: elapsedMs,
                                answered_at: timeoutResponse.answered_at,
                                course_id: push.course_id || null
                            });
                        }
                    });
                });
            } catch (error) {
                console.error('Error fetching user info for timeout notification:', error);
            }
        }

        if (teacherPayload) {
            teachers.forEach(teacher => {
                io.to(teacher.socketId).emit('quiz_response', teacherPayload);
            });
        } else {
            const fallbackPayload = {
                push_id: pushId,
                quiz_id: push ? push.quiz_id : null,
                user_id: userId,
                username: null,
                display_name: null,
                displayName: null,
                status: 'timeout',
                elapsed_ms: elapsedMs,
                answered_at: timeoutResponse.answered_at,
                course_id: push && push.course_id ? push.course_id : null
            };

            teachers.forEach(teacher => {
                io.to(teacher.socketId).emit('quiz_response', fallbackPayload);
            });
        }
    }

    const completed = await finalizePushIfComplete(pushId, push);
    if (!completed) {
        await schedulePushTimeoutCheck(pushId);
    }

    updateOnlineListDebounced();
}

async function schedulePushTimeoutCheck(pushId) {
    if (!pushId) {
        return;
    }

    if (pushTimeouts.has(pushId)) {
        clearTimeout(pushTimeouts.get(pushId));
        pushTimeouts.delete(pushId);
    }

    if (!activePushes.has(pushId)) {
        return;
    }

    let viewingRows;
    try {
        viewingRows = await getViewingQueueEntriesForPush(pushId);
    } catch (error) {
        console.error('Error scheduling push timeout:', error);
        return;
    }

    if (!Array.isArray(viewingRows) || viewingRows.length === 0) {
        return;
    }

    const push = activePushes.get(pushId);
    const now = Date.now();
    let nextDelay = null;

    for (const row of viewingRows) {
        const firstViewedMs = parseTimestampToMs(row.first_viewed_at);
        if (firstViewedMs === null) {
            continue;
        }

        const timeoutSeconds = Number(push.timeout_seconds) || Number(row.push_timeout) || Number(row.quiz_timeout) || 60;
        const expiresAt = firstViewedMs + timeoutSeconds * 1000;
        if (!Number.isFinite(expiresAt)) {
            continue;
        }

        const remaining = expiresAt - now;
        if (remaining <= 0) {
            nextDelay = 0;
            break;
        }

        if (nextDelay === null || remaining < nextDelay) {
            nextDelay = remaining;
        }
    }

    if (nextDelay === null) {
        return;
    }

    const delay = Math.max(0, Math.floor(nextDelay));
    const timeoutId = setTimeout(() => {
        handlePushTimeout(pushId).catch((error) => {
            console.error('handlePushTimeout error:', error);
        });
    }, delay);

    pushTimeouts.set(pushId, timeoutId);
}

// WebSocket handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('auth', async (data = {}) => {
        try {
            const { token } = data;
            if (!token) {
                socket.emit('auth_error', { message: 'Authentication token missing' });
                return;
            }

            let user;
            try {
                user = jwt.verify(token, JWT_SECRET);
            } catch (verifyError) {
                socket.emit('auth_error', { message: 'Invalid token' });
                return;
            }

            const displayName = user.display_name || user.username;
            let activeSession = null;
            const providedTabId = data && data.tab_id ? String(data.tab_id) : null;
            const tabId = providedTabId || uuidv4();

            if (user.role === 'student') {
                try {
                    activeSession = await getActiveAttendanceSession(user.userId);
                } catch (sessionError) {
                    console.error('Auth attendance lookup error:', sessionError);
                }
            }

            let activeAttendanceTabId = null;
            if (activeSession) {
                activeAttendanceTabId = activeSession.active_tab_id || getActiveTabForSession(activeSession.id) || getActiveTabForStudent(user.userId) || null;

                if (!activeAttendanceTabId) {
                    activeAttendanceTabId = tabId;
                    setActiveTabForSession(activeSession.id, activeAttendanceTabId);
                    setActiveTabForStudent(user.userId, activeAttendanceTabId);
                    activeSession.active_tab_id = activeAttendanceTabId;
                } else {
                    setActiveTabForStudent(user.userId, activeAttendanceTabId);
                    setActiveTabForSession(activeSession.id, activeAttendanceTabId);
                }
            }

            const connectedRecord = {
                socketId: socket.id,
                userId: user.userId,
                username: user.username,
                display_name: displayName,
                role: user.role,
                connectedAt: new Date().toISOString(),
                activeCourseId: activeSession ? activeSession.course_id : null,
                attendanceStatus: activeSession ? activeSession.status : null,
                tabId,
                isVisible: true,
                activeAttendanceTabId,
                isPrimaryTab: activeAttendanceTabId ? tabId === activeAttendanceTabId : true
            };

            connectedUsers.set(socket.id, connectedRecord);

            socket.emit('auth_ok', { user: { ...user, display_name: displayName, tab_id: tabId } });

            if (activeSession) {
                socket.emit('attendance_session_updated', { session: activeSession });
            }

            if (user.role === 'student') {
                try {
                    const snapshot = await getQueueSnapshot(user.userId, connectedRecord.activeCourseId || null);
                    console.log(`[AUTH] Student ${user.username} queue loaded: total ${snapshot.total}`);

                    syncStudentQueueCache(user.userId, snapshot);

                    socket.emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

                    if (snapshot.currentQuiz) {
                        socket.emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
                    } else if (connectedRecord.activeCourseId) {
                        socket.emit('queue_empty', {
                            message: 'No quizzes waiting in this course.',
                            course_id: connectedRecord.activeCourseId
                        });
                    } else {
                        console.log(`[AUTH] No active quiz for ${user.username}`);
                    }
                } catch (snapshotError) {
                    console.error('Error loading student queue:', snapshotError);
                }
            }

            updateOnlineListDebounced();
        } catch (error) {
            console.error('Auth error:', error);
            socket.emit('auth_error', { message: 'Authentication failed' });
        }
    });

    socket.on('student_visibility_change', (payload = {}) => {
        const info = connectedUsers.get(socket.id);
        if (!info || info.role !== 'student') {
            return;
        }

        const visible = payload && Object.prototype.hasOwnProperty.call(payload, 'visible')
            ? Boolean(payload.visible)
            : true;

        info.isVisible = visible;

        if (payload && payload.tab_id) {
            const incomingTabId = String(payload.tab_id);
            info.tabId = incomingTabId;
        }

        if (info.activeAttendanceTabId) {
            info.isPrimaryTab = info.tabId === info.activeAttendanceTabId;
        } else {
            info.isPrimaryTab = visible;
        }

        updateOnlineListDebounced();
    });

    socket.on('get_my_queue', async () => {
        try {
            const user = connectedUsers.get(socket.id);
            if (!user || user.role !== 'student') {
                return;
            }

            const snapshot = await getQueueSnapshot(user.userId, user.activeCourseId || null);
            syncStudentQueueCache(user.userId, snapshot);

            socket.emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

            if (snapshot.currentQuiz) {
                socket.emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
            }
        } catch (error) {
            console.error('Get queue error:', error);
        }
    });

    socket.on('student_active_course', async (data = {}) => {
        try {
            const user = connectedUsers.get(socket.id);
            if (!user || user.role !== 'student') {
                return;
            }

            const requestedCourse = data && data.course_id ? String(data.course_id) : null;
            const providedTabId = data && data.tab_id ? String(data.tab_id) : null;
            const tabId = providedTabId || user.tabId || null;
            const studentId = user.userId;

            let activeSession = null;
            try {
                activeSession = await getActiveAttendanceSession(studentId);
            } catch (sessionError) {
                console.error('student_active_course attendance lookup error:', sessionError);
            }

            let nextCourseId = null;

            if (requestedCourse) {
                const enrolled = await isStudentEnrolledInCourse(studentId, requestedCourse);
                if (!enrolled) {
                    socket.emit('course_activation_error', {
                        message: 'You are not enrolled in that course.'
                    });
                    return;
                }

                if (activeSession && activeSession.course_id !== requestedCourse) {
                    socket.emit('course_activation_error', {
                        error: 'active_session_exists',
                        message: 'Please leave your current course before joining a different one.',
                        active_course: {
                            course_id: activeSession.course_id,
                            status: activeSession.status,
                            started_at: activeSession.started_at,
                            last_status_at: activeSession.last_status_at,
                            active_tab_id: activeSession.active_tab_id || getActiveTabForStudent(studentId) || null
                        }
                    });
                    return;
                }

                let sessionToUse = activeSession;

                if (sessionToUse) {
                    try {
                        const updateResult = await updateAttendanceSessionStatus(sessionToUse.id, 'viewing', {
                            tabId,
                            studentId
                        });
                        sessionToUse = {
                            ...sessionToUse,
                            status: updateResult.status,
                            last_status_at: updateResult.last_status_at,
                            active_tab_id: updateResult.active_tab_id || tabId || sessionToUse.active_tab_id || null
                        };
                    } catch (updateError) {
                        console.error('student_active_course status update error:', updateError);
                    }
                } else {
                    try {
                        sessionToUse = await createAttendanceSession(studentId, requestedCourse, 'viewing', tabId || null);
                    } catch (createError) {
                        console.error('student_active_course session create error:', createError);
                        socket.emit('course_activation_error', {
                            message: 'Could not start attendance session. Please try again.'
                        });
                        return;
                    }
                }

                const sessionActiveTabId = sessionToUse ? (sessionToUse.active_tab_id || tabId || null) : null;

                if (sessionActiveTabId) {
                    setActiveTabForStudent(studentId, sessionActiveTabId);
                    if (sessionToUse) {
                        setActiveTabForSession(sessionToUse.id, sessionActiveTabId);
                    }
                }

                user.activeCourseId = requestedCourse;
                user.attendanceStatus = sessionToUse ? sessionToUse.status : null;
                user.activeAttendanceTabId = sessionActiveTabId;
                user.isPrimaryTab = sessionActiveTabId ? (user.tabId === sessionActiveTabId) : Boolean(user.isVisible);
                nextCourseId = requestedCourse;

                emitAttendanceUpdate(studentId, { session: sessionToUse });
                syncConnectedUserAttendance(studentId, requestedCourse, sessionToUse ? sessionToUse.status : null, sessionActiveTabId);
            } else {
                user.activeCourseId = null;
                user.attendanceStatus = null;
                user.activeAttendanceTabId = null;
                user.isPrimaryTab = false;
                nextCourseId = null;

                if (activeSession) {
                    try {
                        const endResult = await endAttendanceSession(activeSession.id, { studentId });
                        const endedSession = {
                            ...activeSession,
                            status: ATTENDANCE_ENDED_STATUS,
                            ended_at: endResult.ended_at,
                            last_status_at: endResult.ended_at,
                            active_tab_id: null
                        };
                        emitAttendanceUpdate(studentId, { session: endedSession });
                        activeSession = null;
                    } catch (endError) {
                        console.error('student_active_course end session error:', endError);
                    }
                }

                setActiveTabForStudent(studentId, null);
                syncConnectedUserAttendance(studentId, null, null, null);
            }

            const snapshot = await getQueueSnapshot(studentId, nextCourseId);
            syncStudentQueueCache(studentId, snapshot);

            socket.emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

            if (snapshot.currentQuiz) {
                socket.emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
            } else if (nextCourseId) {
                socket.emit('queue_empty', {
                    message: 'No quizzes waiting in this course.',
                    course_id: nextCourseId
                });
            }

            updateOnlineListDebounced();
        } catch (error) {
            console.error('student_active_course error:', error);
            socket.emit('course_activation_error', {
                message: 'Could not update active course. Please try again.'
            });
        }
    });

    socket.on('quiz_answer', async (data) => {
        try {
            const user = connectedUsers.get(socket.id);
            if (!user || user.role !== 'student') {
                socket.emit('error', { message: 'Student authentication required' });
                return;
            }

            const { push_id, answer, answered_at } = data;

            if (!activePushes.has(push_id)) {
                socket.emit('error', { message: 'Quiz no longer active' });
                return;
            }

            // Check if already answered
            db.get('SELECT id FROM quiz_responses WHERE push_id = ? AND user_id = ?',
                [push_id, user.userId], async (err, existingResponse) => {
                    if (err) {
                        console.error('Error checking existing response:', err);
                        socket.emit('error', { message: 'Database error' });
                        return;
                    }

                    if (existingResponse) {
                        socket.emit('error', { message: 'Already answered this quiz' });
                        return;
                    }

                    const push = activePushes.get(push_id);

                    let queueRow = null;
                    try {
                        queueRow = await getQueueEntryForStudent(push_id, user.userId);
                    } catch (lookupError) {
                        console.error('Error loading queue entry for answer:', lookupError);
                    }

                    const providedAnsweredAt = (typeof answered_at === 'string' && answered_at.trim()) ? answered_at : null;
                    let answeredMs = providedAnsweredAt ? Date.parse(providedAnsweredAt) : Date.now();
                    if (Number.isNaN(answeredMs)) {
                        answeredMs = Date.now();
                    }
                    const normalizedAnsweredAt = new Date(answeredMs).toISOString();

                    const firstViewedMs = queueRow ? parseTimestampToMs(queueRow.first_viewed_at) : null;
                    let startMs = firstViewedMs;
                    if (startMs === null) {
                        const pushStartMs = parseTimestampToMs(push.started_at);
                        startMs = pushStartMs !== null ? pushStartMs : answeredMs;
                    }

                    const elapsedMs = Math.max(0, answeredMs - startMs);
                    const startedAtIso = new Date(startMs).toISOString();

                    const serializedAnswer = (typeof answer === 'string' || typeof answer === 'number')
                        ? String(answer)
                        : JSON.stringify(answer);

                    const response = {
                        id: uuidv4(),
                        push_id,
                        quiz_id: push.quiz_id,
                        user_id: user.userId,
                        answer_text: serializedAnswer,
                        started_at: startedAtIso,
                        answered_at: normalizedAnsweredAt,
                        elapsed_ms: elapsedMs,
                        status: 'answered'
                    };

                    try {
                        await createResponseInDB(response);

                        // Remove from student's queue
                        await removeFromStudentQueue(user.userId, push_id);

                        if (Array.isArray(push.targetUsers)) {
                            push.targetUsers = push.targetUsers.filter(id => id !== user.userId);
                        }

                        const pushMeta = activePushes.get(push_id);
                        const completed = await finalizePushIfComplete(push_id, pushMeta || push);
                        if (!completed) {
                            schedulePushTimeoutCheck(push_id).catch((error) => {
                                console.error('schedulePushTimeoutCheck error:', error);
                            });
                        }

                        socket.emit('answer_submitted', {
                            push_id,
                            message: 'Answer submitted successfully',
                            course_id: push.course_id || user.activeCourseId || null
                        });

                        const snapshot = await getQueueSnapshot(user.userId, push.course_id || user.activeCourseId || null);
                        syncStudentQueueCache(user.userId, snapshot);

                        socket.emit('quiz_queue_updated', buildQueueUpdatePayload(snapshot));

                        if (snapshot.currentQuiz) {
                            socket.emit('show_next_quiz', buildShowQuizPayload(snapshot.currentQuiz));
                        } else {
                            socket.emit('queue_empty', {
                                message: 'All quizzes completed!',
                                course_id: push.course_id || user.activeCourseId || null
                            });
                        }

                        // Update online list to reflect queue changes (debounced to prevent cascade)
                        updateOnlineListDebounced();

                        // Notify teachers with correctness information
                        const teachers = Array.from(connectedUsers.values())
                            .filter(u => u.role === 'teacher');

                        // Calculate correctness
                        let isCorrect = null;
                        if (push.quiz && push.quiz.correct_answer) {
                            const answerValue = parseStoredAnswer(serializedAnswer);
                            const correctValue = parseStoredAnswer(push.quiz.correct_answer);

                            if (push.quiz.question_type === 'select' && answerValue && typeof answerValue === 'object') {
                                const selectedText = answerValue.selected_text || '';
                                const match = selectedText.match(/^\([a-z]\)\s*(.+)$/i);
                                const extractedAnswer = match ? match[1].trim() : selectedText.trim();
                                isCorrect = extractedAnswer.toLowerCase() === String(correctValue).toLowerCase().trim();
                            } else {
                                const answerDisplay = formatAnswerForDisplay(answerValue);
                                const correctDisplay = formatAnswerForDisplay(correctValue);
                                isCorrect = answerDisplay.toLowerCase().trim() === correctDisplay.toLowerCase().trim();
                            }
                        }

                        teachers.forEach(teacher => {
                            const studentDisplayName = user.display_name || user.username;
                            io.to(teacher.socketId).emit('quiz_response', {
                                push_id,
                                quiz_id: push.quiz_id,
                                user_id: user.userId,
                                username: user.username,
                                display_name: studentDisplayName,
                                displayName: studentDisplayName,
                                answer,
                                elapsed_ms: elapsedMs,
                                answered_at: normalizedAnsweredAt,
                                status: 'answered',
                                is_correct: isCorrect,
                                course_id: push.course_id || null
                            });
                        });
                    } catch (error) {
                        console.error('Error saving response:', error);
                        socket.emit('error', { message: 'Failed to save response' });
                    }
                });
        } catch (error) {
            console.error('Quiz answer error:', error);
            socket.emit('error', { message: 'Internal server error' });
        }
    });

    socket.on('disconnect', async () => {
        console.log('Client disconnected:', socket.id);
        const info = connectedUsers.get(socket.id);

        if (info && info.role === 'student') {
            const activeTabId = getActiveTabForStudent(info.userId);
            if (activeTabId && info.tabId && activeTabId === info.tabId) {
                setActiveTabForStudent(info.userId, null);
                const sessionId = getActiveSessionForStudent(info.userId);

                if (sessionId) {
                    clearActiveTabForSession(sessionId);
                    try {
                        const session = await getActiveAttendanceSession(info.userId);
                        if (session && session.id === sessionId) {
                            session.active_tab_id = null;
                            emitAttendanceUpdate(info.userId, { session });
                        }
                    } catch (lookupError) {
                        console.error('Disconnect session lookup error:', lookupError);
                    }
                }
            }
        }

        connectedUsers.delete(socket.id);
        updateOnlineListDebounced();
    });
});

// Debounce updateOnlineList to prevent cascade during mass operations
let updateOnlineListTimeout = null;
let isUpdateOnlineListRunning = false;

const updateOnlineListDebounced = () => {
    if (updateOnlineListTimeout) {
        clearTimeout(updateOnlineListTimeout);
    }
    updateOnlineListTimeout = setTimeout(() => {
        if (!isUpdateOnlineListRunning) {
            updateOnlineList();
        }
    }, 500); // Wait 500ms after last call
};

// Update online users list for teachers
const updateOnlineList = () => {
    // Prevent concurrent executions
    if (isUpdateOnlineListRunning) {
        console.log('[updateOnlineList] Skipping - already running');
        return;
    }

    isUpdateOnlineListRunning = true;

    const teachers = Array.from(connectedUsers.values())
        .filter(user => user.role === 'teacher');

    if (teachers.length === 0) {
        isUpdateOnlineListRunning = false;
        return;
    }

    const students = Array.from(connectedUsers.values())
        .filter(user => user.role === 'student');

    Promise.all(students.map(async (student) => {
        const displayName = student.display_name || student.username;
        try {
            const activeSession = await getActiveAttendanceSession(student.userId);
            const activeCourseId = activeSession ? activeSession.course_id : (student.activeCourseId || null);

            const [snapshot, courseIds, quizStats] = await Promise.all([
                getQueueSnapshot(student.userId, activeCourseId || null),
                getCourseIdsForStudent(student.userId),
                getStudentQuizStats(student.userId, activeCourseId || null)
            ]);

            syncStudentQueueCache(student.userId, snapshot);

            const attendanceStatus = activeSession ? activeSession.status : (student.attendanceStatus || null);
            const sessionActiveTabId = activeSession ? (activeSession.active_tab_id || getActiveTabForSession(activeSession.id) || null) : getActiveTabForStudent(student.userId);
            const isPrimaryTab = sessionActiveTabId
                ? student.tabId === sessionActiveTabId
                : Boolean(student.isVisible);
            let attendanceDurationSeconds = null;
            if (activeSession && activeSession.started_at) {
                const startedAtMs = Date.parse(activeSession.started_at);
                // Validate that the timestamp is reasonable (not in the future, not too old)
                const now = Date.now();
                const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);
                if (Number.isFinite(startedAtMs) && startedAtMs <= now && startedAtMs >= oneYearAgo) {
                    attendanceDurationSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));
                } else {
                    console.warn(`Invalid attendance started_at for student ${student.userId}: ${activeSession.started_at} (parsed: ${startedAtMs})`);
                }
            }

            return {
                user_id: student.userId,
                username: student.username,
                display_name: displayName,
                displayName,
                connected_at: student.connectedAt,
                active_course_id: activeCourseId,
                queue_length: snapshot.total,
                current_quiz: snapshot.currentQuiz ? {
                    push_id: snapshot.currentQuiz.push_id,
                    quiz_id: snapshot.currentQuiz.quiz_id,
                    title: snapshot.currentQuiz.quiz ? snapshot.currentQuiz.quiz.title : 'Unknown Quiz'
                } : null,
                pending_count: snapshot.pending.length,
                enrolled_course_ids: courseIds,
                attendance_status: attendanceStatus,
                attendance_started_at: activeSession ? activeSession.started_at : null,
                attendance_last_status_at: activeSession ? activeSession.last_status_at : null,
                attendance_duration_seconds: attendanceDurationSeconds,
                quiz_stats: quizStats,
                tab_id: student.tabId,
                is_visible: student.isVisible !== false,
                is_primary_tab: isPrimaryTab,
                active_attendance_tab_id: sessionActiveTabId || null
            };
        } catch (error) {
            console.error('updateOnlineList snapshot error:', error);

            let courseIds = [];
            try {
                courseIds = await getCourseIdsForStudent(student.userId);
            } catch (courseErr) {
                console.error('updateOnlineList enrollment error:', courseErr);
            }

            let quizStats = { total_responses: 0, answered_count: 0, last_answered_at: null };
            try {
                quizStats = await getStudentQuizStats(student.userId, student.activeCourseId || null);
            } catch (statsErr) {
                console.error('updateOnlineList quiz stats error:', statsErr);
            }

            const activeCourseId = student.activeCourseId || null;
            const attendanceStatus = student.attendanceStatus || null;
            const sessionActiveTabId = getActiveTabForStudent(student.userId);
            const isPrimaryTab = sessionActiveTabId
                ? student.tabId === sessionActiveTabId
                : Boolean(student.isVisible);

            return {
                user_id: student.userId,
                username: student.username,
                display_name: displayName,
                displayName,
                connected_at: student.connectedAt,
                active_course_id: activeCourseId,
                queue_length: 0,
                current_quiz: null,
                pending_count: 0,
                enrolled_course_ids: courseIds,
                attendance_status: attendanceStatus,
                attendance_started_at: null,
                attendance_last_status_at: null,
                attendance_duration_seconds: null,
                quiz_stats: quizStats,
                tab_id: student.tabId,
                is_visible: student.isVisible !== false,
                is_primary_tab: isPrimaryTab,
                active_attendance_tab_id: sessionActiveTabId || null
            };
        }
    })).then(onlineStudents => {
        const dedupedMap = new Map();

        onlineStudents.forEach(studentInfo => {
            const key = studentInfo.user_id;
            const existing = dedupedMap.get(key);
            const score = (studentInfo.is_primary_tab ? 3 : 0) + (studentInfo.is_visible ? 1 : 0);

            if (!existing) {
                dedupedMap.set(key, { ...studentInfo, dedupe_score: score });
                return;
            }

            const existingScore = existing.dedupe_score;
            if (score > existingScore) {
                dedupedMap.set(key, { ...studentInfo, dedupe_score: score });
            } else if (score === existingScore) {
                const existingConnectedAt = existing.connected_at ? Date.parse(existing.connected_at) : 0;
                const currentConnectedAt = studentInfo.connected_at ? Date.parse(studentInfo.connected_at) : 0;
                if (currentConnectedAt > existingConnectedAt) {
                    dedupedMap.set(key, { ...studentInfo, dedupe_score: score });
                }
            }
        });

        const studentsForTeachers = Array.from(dedupedMap.values()).map(student => {
            const { dedupe_score, ...rest } = student;
            return rest;
        });

        teachers.forEach(teacher => {
            io.to(teacher.socketId).emit('online_students', { students: studentsForTeachers });
        });

        isUpdateOnlineListRunning = false;
    }).catch(err => {
        console.error('updateOnlineList error:', err);
        isUpdateOnlineListRunning = false;
    });
};

// ==================== IMAGE UPLOAD ROUTES ====================

// Upload image for assignments
app.post('/api/upload/assignment-image', authenticateToken, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const { assignmentId, type } = req.body; // type: 'assignment' or 'submission'

        // Compress and convert to WebP
        const result = await compressImage(req.file.buffer, req.file.originalname);

        // Generate filename with assignmentId prefix for easy cleanup
        // Format: {assignmentId}_{uuid}.webp
        const fileId = uuidv4();
        const prefix = assignmentId || 'temp';
        const filename = `${prefix}_${fileId}.webp`;

        // Organize files by type and ID
        let subDir;
        if (type === 'submission' && assignmentId) {
            // uploads/assignments/{assignmentId}/submissions/
            subDir = path.join('assignments', assignmentId, 'submissions');
        } else if (type === 'assignment' && assignmentId) {
            // uploads/assignments/{assignmentId}/
            subDir = path.join('assignments', assignmentId);
        } else {
            // uploads/assignments/temp/ (for new assignments being created)
            subDir = path.join('assignments', 'temp');
        }

        const uploadDir = path.join(uploadsDir, subDir);

        // Create directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filepath = path.join(uploadDir, filename);

        // Save compressed image to disk
        await fs.promises.writeFile(filepath, result.buffer);

        // Return the URL path
        const imageUrl = `/uploads/${subDir.replace(/\\/g, '/')}/${filename}`;

        console.log(`Uploaded and converted to WebP: ${req.file.originalname} -> ${subDir}/${filename} (${result.buffer.length} bytes, ${Math.round((1 - result.buffer.length / req.file.size) * 100)}% smaller)`);

        res.json({
            success: true,
            imageUrl,
            originalSize: req.file.size,
            compressedSize: result.buffer.length,
            compressionRatio: Math.round((1 - result.buffer.length / req.file.size) * 100),
            format: 'webp'
        });
    } catch (error) {
        console.error('Image upload error:', error);
        res.status(500).json({ error: 'Failed to upload image' });
    }
});

// ==================== ASSIGNMENT ROUTES ====================

// Helper: Calculate deadline from assignment
function calculateAssignmentDeadline(assignment) {
    if (!assignment.opened_at) return null;

    if (assignment.deadline_type === 'specific' && assignment.deadline_datetime) {
        return assignment.deadline_datetime;
    } else if (assignment.deadline_type === 'duration') {
        const openedTime = new Date(assignment.opened_at);
        const hours = assignment.deadline_duration_hours || 0;
        const minutes = assignment.deadline_duration_minutes || 0;
        const deadline = new Date(openedTime.getTime() + (hours * 60 + minutes) * 60 * 1000);
        return deadline.toISOString();
    }
    return null;
}

// Helper: Check if assignment is past deadline
function isAssignmentPastDeadline(assignment) {
    const deadline = calculateAssignmentDeadline(assignment);
    if (!deadline) return false;
    return new Date() > new Date(deadline);
}

// Create assignment (teacher only)
app.post('/api/assignments', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const {
            course_id,
            title,
            description,
            deadline_type,
            deadline_datetime,
            deadline_duration_hours,
            deadline_duration_minutes,
            auto_close,
            image_path
        } = req.body;

        if (!course_id || !title || !description) {
            return res.status(400).json({ error: 'Course ID, title, and description are required' });
        }

        // Verify teacher owns the course
        const course = await getCourseById(course_id);
        if (!course || course.created_by !== req.user.userId) {
            return res.status(404).json({ error: 'Course not found or access denied' });
        }

        const assignment = {
            id: uuidv4(),
            course_id,
            title: String(title).trim(),
            description: String(description).trim(),
            created_by: req.user.userId,
            created_at: new Date().toISOString(),
            status: 'closed',
            opened_at: null,
            deadline_type: deadline_type || 'specific',
            deadline_datetime: deadline_datetime || null,
            deadline_duration_hours: deadline_duration_hours || null,
            deadline_duration_minutes: deadline_duration_minutes || null,
            auto_close: auto_close !== false,
            image_path: image_path || null
        };

        await new Promise((resolve, reject) => {
            db.run(`
                INSERT INTO assignments (
                    id, course_id, title, description, created_by, created_at,
                    status, opened_at, deadline_type, deadline_datetime,
                    deadline_duration_hours, deadline_duration_minutes,
                    auto_close, image_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                assignment.id, assignment.course_id, assignment.title,
                assignment.description, assignment.created_by, assignment.created_at,
                assignment.status, assignment.opened_at, assignment.deadline_type,
                assignment.deadline_datetime, assignment.deadline_duration_hours,
                assignment.deadline_duration_minutes, assignment.auto_close ? 1 : 0,
                assignment.image_path
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.status(201).json({ assignment });
    } catch (error) {
        console.error('Create assignment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get assignments for a course
app.get('/api/courses/:courseId/assignments', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;

        // Check if user has access to this course
        if (req.user.role === 'teacher') {
            const course = await getCourseById(courseId);
            if (!course || course.created_by !== req.user.userId) {
                return res.status(404).json({ error: 'Course not found or access denied' });
            }
        } else if (req.user.role === 'student') {
            // Check if student is enrolled
            const isEnrolled = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT 1 FROM course_enrollments
                    WHERE course_id = ? AND student_id = ?
                `, [courseId, req.user.userId], (err, row) => {
                    if (err) reject(err);
                    else resolve(!!row);
                });
            });

            if (!isEnrolled) {
                return res.status(403).json({ error: 'Not enrolled in this course' });
            }
        }

        const assignments = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    a.*,
                    u.username as creator_username,
                    u.display_name as creator_display_name
                FROM assignments a
                JOIN users u ON a.created_by = u.id
                WHERE a.course_id = ?
                ORDER BY a.created_at DESC
            `, [courseId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        // For students, only show open assignments and add submission status
        if (req.user.role === 'student') {
            const openAssignments = assignments.filter(a => a.status === 'open');

            // Get submission status for each assignment
            const assignmentsWithStatus = await Promise.all(openAssignments.map(async (assignment) => {
                const submission = await new Promise((resolve, reject) => {
                    db.get(`
                        SELECT id, submitted_at, is_late, score
                        FROM assignment_submissions
                        WHERE assignment_id = ? AND student_id = ?
                    `, [assignment.id, req.user.userId], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                const deadline = calculateAssignmentDeadline(assignment);
                const isPastDeadline = deadline && new Date() > new Date(deadline);

                return {
                    ...assignment,
                    deadline,
                    is_past_deadline: isPastDeadline,
                    has_submitted: !!submission,
                    submission
                };
            }));

            return res.json({ assignments: assignmentsWithStatus });
        }

        // For teachers, add submission counts
        const assignmentsWithCounts = await Promise.all(assignments.map(async (assignment) => {
            const stats = await new Promise((resolve, reject) => {
                db.get(`
                    SELECT 
                        COUNT(*) as total_submissions,
                        SUM(CASE WHEN is_late = 0 THEN 1 ELSE 0 END) as on_time_count,
                        SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late_count
                    FROM assignment_submissions
                    WHERE assignment_id = ?
                `, [assignment.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row || { total_submissions: 0, on_time_count: 0, late_count: 0 });
                });
            });

            const deadline = calculateAssignmentDeadline(assignment);

            return {
                ...assignment,
                deadline,
                is_past_deadline: isAssignmentPastDeadline(assignment),
                ...stats
            };
        }));

        res.json({ assignments: assignmentsWithCounts });
    } catch (error) {
        console.error('Get assignments error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Open/Close assignment (teacher only)
app.patch('/api/assignments/:assignmentId/status', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { assignmentId } = req.params;
        const { status } = req.body;

        if (!status || !['open', 'closed'].includes(status)) {
            return res.status(400).json({ error: 'Valid status required (open or closed)' });
        }

        // Get assignment and verify ownership
        const assignment = await new Promise((resolve, reject) => {
            db.get(`
                SELECT a.*, c.created_by as course_owner
                FROM assignments a
                JOIN courses c ON a.course_id = c.id
                WHERE a.id = ?
            `, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!assignment || assignment.course_owner !== req.user.userId) {
            return res.status(404).json({ error: 'Assignment not found or access denied' });
        }

        const updates = {
            status,
            opened_at: status === 'open' && !assignment.opened_at ? new Date().toISOString() : assignment.opened_at
        };

        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE assignments
                SET status = ?, opened_at = ?
                WHERE id = ?
            `, [updates.status, updates.opened_at, assignmentId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Get updated assignment
        const updatedAssignment = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        const deadline = calculateAssignmentDeadline(updatedAssignment);

        // Notify students in this course via socket
        io.to(`course:${assignment.course_id}`).emit('assignment_status_changed', {
            assignment_id: assignmentId,
            status,
            deadline
        });

        res.json({
            assignment: {
                ...updatedAssignment,
                deadline
            }
        });
    } catch (error) {
        console.error('Update assignment status error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Submit assignment (student only)
app.post('/api/assignments/:assignmentId/submit', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'student') {
            return res.status(403).json({ error: 'Student access required' });
        }

        const { assignmentId } = req.params;
        const { content, image_path } = req.body;

        if (!content || !String(content).trim()) {
            return res.status(400).json({ error: 'Submission content required' });
        }

        // Get assignment
        const assignment = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!assignment) {
            return res.status(404).json({ error: 'Assignment not found' });
        }

        if (assignment.status !== 'open') {
            return res.status(400).json({ error: 'Assignment is not open' });
        }

        // Check if student is enrolled
        const isEnrolled = await new Promise((resolve, reject) => {
            db.get(`
                SELECT 1 FROM course_enrollments
                WHERE course_id = ? AND student_id = ?
            `, [assignment.course_id, req.user.userId], (err, row) => {
                if (err) reject(err);
                else resolve(!!row);
            });
        });

        if (!isEnrolled) {
            return res.status(403).json({ error: 'Not enrolled in this course' });
        }

        const now = new Date();
        const deadline = calculateAssignmentDeadline(assignment);
        const isLate = deadline ? now > new Date(deadline) : false;

        const submission = {
            id: uuidv4(),
            assignment_id: assignmentId,
            student_id: req.user.userId,
            course_id: assignment.course_id,
            content: String(content).trim(),
            image_path: image_path || null,
            submitted_at: now.toISOString(),
            is_late: isLate ? 1 : 0
        };

        // Insert or replace submission
        await new Promise((resolve, reject) => {
            db.run(`
                INSERT OR REPLACE INTO assignment_submissions (
                    id, assignment_id, student_id, course_id, content,
                    image_path, submitted_at, is_late
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                submission.id, submission.assignment_id, submission.student_id,
                submission.course_id, submission.content, submission.image_path,
                submission.submitted_at, submission.is_late
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        res.status(201).json({ submission });
    } catch (error) {
        console.error('Submit assignment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Get submissions for an assignment (teacher only)
app.get('/api/assignments/:assignmentId/submissions', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { assignmentId } = req.params;

        // Verify ownership
        const assignment = await new Promise((resolve, reject) => {
            db.get(`
                SELECT a.*, c.created_by as course_owner
                FROM assignments a
                JOIN courses c ON a.course_id = c.id
                WHERE a.id = ?
            `, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!assignment || assignment.course_owner !== req.user.userId) {
            return res.status(404).json({ error: 'Assignment not found or access denied' });
        }

        const submissions = await new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    s.*,
                    u.username,
                    u.display_name
                FROM assignment_submissions s
                JOIN users u ON s.student_id = u.id
                WHERE s.assignment_id = ?
                ORDER BY s.submitted_at DESC
            `, [assignmentId], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        res.json({ submissions });
    } catch (error) {
        console.error('Get submissions error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Update assignment (teacher only)
app.put('/api/assignments/:assignmentId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { assignmentId } = req.params;
        const {
            title,
            description,
            deadline_type,
            deadline_datetime,
            deadline_duration_hours,
            deadline_duration_minutes,
            auto_close,
            image_path
        } = req.body;

        // Verify ownership
        const assignment = await new Promise((resolve, reject) => {
            db.get(`
                SELECT a.*, c.created_by as course_owner
                FROM assignments a
                JOIN courses c ON a.course_id = c.id
                WHERE a.id = ?
            `, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!assignment || assignment.course_owner !== req.user.userId) {
            return res.status(404).json({ error: 'Assignment not found or access denied' });
        }

        await new Promise((resolve, reject) => {
            db.run(`
                UPDATE assignments
                SET title = ?, description = ?, deadline_type = ?,
                    deadline_datetime = ?, deadline_duration_hours = ?,
                    deadline_duration_minutes = ?, auto_close = ?, image_path = ?
                WHERE id = ?
            `, [
                title || assignment.title,
                description || assignment.description,
                deadline_type || assignment.deadline_type,
                deadline_datetime !== undefined ? deadline_datetime : assignment.deadline_datetime,
                deadline_duration_hours !== undefined ? deadline_duration_hours : assignment.deadline_duration_hours,
                deadline_duration_minutes !== undefined ? deadline_duration_minutes : assignment.deadline_duration_minutes,
                auto_close !== undefined ? (auto_close ? 1 : 0) : assignment.auto_close,
                image_path !== undefined ? image_path : assignment.image_path,
                assignmentId
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const updated = await new Promise((resolve, reject) => {
            db.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        res.json({ assignment: updated });
    } catch (error) {
        console.error('Update assignment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Delete assignment (teacher only)
app.delete('/api/assignments/:assignmentId', authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'teacher') {
            return res.status(403).json({ error: 'Teacher access required' });
        }

        const { assignmentId } = req.params;

        // Verify ownership
        const assignment = await new Promise((resolve, reject) => {
            db.get(`
                SELECT a.*, c.created_by as course_owner
                FROM assignments a
                JOIN courses c ON a.course_id = c.id
                WHERE a.id = ?
            `, [assignmentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!assignment || assignment.course_owner !== req.user.userId) {
            return res.status(404).json({ error: 'Assignment not found or access denied' });
        }

        // Delete assignment from database
        await new Promise((resolve, reject) => {
            db.run(`DELETE FROM assignments WHERE id = ?`, [assignmentId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Delete all associated files
        // 1. Delete assignment folder: uploads/assignments/{assignmentId}/
        const assignmentDir = path.join(uploadsDir, 'assignments', assignmentId);
        if (fs.existsSync(assignmentDir)) {
            fs.rmSync(assignmentDir, { recursive: true, force: true });
            console.log(`Deleted assignment folder: ${assignmentDir}`);
        }

        // 2. Delete files with assignmentId prefix in temp folder (if any)
        const tempDir = path.join(uploadsDir, 'assignments', 'temp');
        if (fs.existsSync(tempDir)) {
            const tempFiles = fs.readdirSync(tempDir);
            const filesToDelete = tempFiles.filter(f => f.startsWith(`${assignmentId}_`));
            for (const file of filesToDelete) {
                fs.unlinkSync(path.join(tempDir, file));
                console.log(`Deleted temp file: ${file}`);
            }
        }

        res.json({ message: 'Assignment and all associated files deleted successfully' });
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== END ASSIGNMENT ROUTES ====================

// ==================== READING PROGRESS TRACKING ROUTES ====================

/**
 * POST /api/progress
 * Record reading progress for a section
 * Now supports chapter-based progress structure
 */
app.post('/api/progress', async (req, res) => {
    try {
        const {
            userId,
            courseId,
            sessionId,
            pageUrl,
            progress,
            trigger,
            // Legacy format support
            sectionId,
            sectionTitle,
            completedSections = []
        } = req.body;

        if (!userId || !courseId) {
            return res.status(400).json({ error: 'Missing required fields: userId, courseId' });
        }

        const now = new Date().toISOString();

        // Handle new chapter-based progress format
        if (progress && progress.chapters) {
            console.log(`📊 Progress update for user ${userId} in course ${courseId}:`);
            console.log(`   Overall: ${progress.overall.completed}/${progress.overall.total} (${progress.overall.percentage}%)`);

            // Store chapter-based progress
            const progressId = uuidv4();
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO reading_progress 
                    (id, user_id, course_id, section_id, section_title, page_url, completed_at, session_id, progress_data)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        progressId,
                        userId,
                        courseId,
                        trigger ? trigger.sectionId : 'summary',
                        trigger ? trigger.sectionTitle : 'Progress Update',
                        pageUrl || '',
                        now,
                        sessionId || null,
                        JSON.stringify(progress)
                    ],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Auto-register all sections from chapters
            const allSections = [];
            Object.values(progress.chapters).forEach(chapter => {
                chapter.sections.forEach(section => {
                    allSections.push({
                        sectionId: section.sectionId,
                        title: section.title,
                        chapterId: chapter.chapterId
                    });
                });
            });

            for (const section of allSections) {
                await new Promise((resolve, reject) => {
                    db.run(
                        `INSERT OR IGNORE INTO course_sections (id, course_id, section_id, section_title, chapter_id)
                        VALUES (?, ?, ?, ?, ?)`,
                        [uuidv4(), courseId, section.sectionId, section.title, section.chapterId],
                        function (err) {
                            if (err) reject(err);
                            else resolve();
                        }
                    );
                });
            }

            // Update course progress summary with chapter details
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO course_progress_summary 
                    (id, user_id, course_id, total_sections, completed_sections, progress_percentage, last_accessed_at, chapter_progress)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, course_id) DO UPDATE SET 
                        total_sections = excluded.total_sections,
                        completed_sections = excluded.completed_sections,
                        progress_percentage = excluded.progress_percentage,
                        last_accessed_at = excluded.last_accessed_at,
                        chapter_progress = excluded.chapter_progress`,
                    [
                        uuidv4(),
                        userId,
                        courseId,
                        progress.overall.total,
                        progress.overall.completed,
                        progress.overall.percentage,
                        now,
                        JSON.stringify(progress.chapters)
                    ],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            res.json({
                success: true,
                progress: {
                    overall: progress.overall,
                    chaptersCount: Object.keys(progress.chapters).length
                }
            });

        } else {
            // Legacy format support - handle old single-section updates
            if (!sectionId) {
                return res.status(400).json({ error: 'Missing sectionId in legacy format' });
            }

            const progressId = uuidv4();
            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT OR REPLACE INTO reading_progress 
                    (id, user_id, course_id, section_id, section_title, page_url, completed_at, session_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [progressId, userId, courseId, sectionId, sectionTitle || '', pageUrl || '', now, sessionId || null],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            // Auto-register sections
            if (completedSections.length > 0) {
                for (const secId of completedSections) {
                    await new Promise((resolve, reject) => {
                        db.run(
                            `INSERT OR IGNORE INTO course_sections (id, course_id, section_id, section_title)
                            VALUES (?, ?, ?, ?)`,
                            [uuidv4(), courseId, secId, ''],
                            function (err) {
                                if (err) reject(err);
                                else resolve();
                            }
                        );
                    });
                }
            }

            // Calculate progress percentage
            const progressData = await new Promise((resolve, reject) => {
                db.all(
                    `SELECT 
                        (SELECT COUNT(DISTINCT section_id) FROM course_sections WHERE course_id = ?) as total_sections,
                        (SELECT COUNT(*) FROM reading_progress WHERE user_id = ? AND course_id = ?) as completed_sections`,
                    [courseId, userId, courseId],
                    (err, rows) => {
                        if (err) reject(err);
                        else resolve(rows[0] || { total_sections: 0, completed_sections: 0 });
                    }
                );
            });

            const totalSections = progressData.total_sections || completedSections.length;
            const completedCount = progressData.completed_sections;
            const progressPercentage = totalSections > 0 ? (completedCount / totalSections) * 100 : 0;

            await new Promise((resolve, reject) => {
                db.run(
                    `INSERT INTO course_progress_summary 
                    (id, user_id, course_id, total_sections, completed_sections, progress_percentage, last_accessed_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, course_id) DO UPDATE SET 
                        total_sections = excluded.total_sections,
                        completed_sections = excluded.completed_sections,
                        progress_percentage = excluded.progress_percentage,
                        last_accessed_at = excluded.last_accessed_at`,
                    [uuidv4(), userId, courseId, totalSections, completedCount, progressPercentage, now],
                    function (err) {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

            res.json({
                success: true,
                progressPercentage: progressPercentage
            });
        }

    } catch (error) {
        console.error('Progress tracking error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/progress/:courseId/:userId
 * Get reading progress for a specific user and course
 */
app.get('/api/progress/:courseId/:userId', async (req, res) => {
    try {
        const { courseId, userId } = req.params;

        // Get progress summary
        const summary = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM course_progress_summary 
                WHERE user_id = ? AND course_id = ?`,
                [userId, courseId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row || {
                        total_sections: 0,
                        completed_sections: 0,
                        progress_percentage: 0
                    });
                }
            );
        });

        // Get completed sections
        const sections = await new Promise((resolve, reject) => {
            db.all(
                `SELECT section_id, section_title, completed_at, time_spent_seconds 
                FROM reading_progress 
                WHERE user_id = ? AND course_id = ?
                ORDER BY completed_at DESC`,
                [userId, courseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({
            success: true,
            summary,
            completedSections: sections
        });
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(500).json({ error: 'Failed to retrieve progress' });
    }
});

/**
 * GET /api/courses/:courseId/progress
 * Get all students' progress for a course (teacher view)
 * Similar to Udemy's teacher dashboard
 */
app.get('/api/courses/:courseId/progress', authenticateToken, async (req, res) => {
    const { courseId } = req.params;
    const userId = req.user.userId;

    try {
        // Verify user is teacher or owner of the course
        const course = await new Promise((resolve, reject) => {
            db.get(
                `SELECT created_by FROM courses WHERE id = ?`,
                [courseId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        if (req.user.role !== 'teacher' && course.created_by !== userId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get all enrolled students with their progress
        const studentsProgress = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    u.id as user_id,
                    u.username,
                    u.display_name,
                    ce.enrolled_at,
                    COALESCE(cps.total_sections, 0) as total_sections,
                    COALESCE(cps.completed_sections, 0) as completed_sections,
                    COALESCE(cps.progress_percentage, 0) as progress_percentage,
                    cps.last_accessed_at,
                    cps.first_accessed_at,
                    cps.chapter_progress,
                    (SELECT COUNT(*) FROM reading_sessions WHERE user_id = u.id AND course_id = ?) as total_sessions,
                    (SELECT SUM(total_time_seconds) FROM reading_sessions WHERE user_id = u.id AND course_id = ?) as total_time_spent
                FROM course_enrollments ce
                JOIN users u ON ce.student_id = u.id
                LEFT JOIN course_progress_summary cps ON cps.user_id = u.id AND cps.course_id = ce.course_id
                WHERE ce.course_id = ?
                ORDER BY cps.progress_percentage DESC, u.display_name ASC`,
                [courseId, courseId, courseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Get course sections count
        const sectionsCount = await new Promise((resolve, reject) => {
            db.get(
                `SELECT COUNT(*) as count FROM course_sections WHERE course_id = ?`,
                [courseId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row?.count || 0);
                }
            );
        });

        res.json({
            success: true,
            courseId,
            totalSections: sectionsCount,
            students: studentsProgress.map(s => {
                let chapterProgress = null;
                try {
                    chapterProgress = s.chapter_progress ? JSON.parse(s.chapter_progress) : null;
                } catch (e) {
                    console.error('Error parsing chapter progress:', e);
                }

                // Always use the actual section count from course_sections table
                // to ensure consistency between overview and detail views
                const actualTotalSections = sectionsCount;
                const completedSections = s.completed_sections;
                // Recalculate percentage based on actual section count
                const actualPercentage = actualTotalSections > 0
                    ? Math.round((completedSections / actualTotalSections) * 10000) / 100
                    : 0;

                return {
                    userId: s.user_id,
                    username: s.username,
                    displayName: s.display_name,
                    enrolledAt: s.enrolled_at,
                    progress: {
                        totalSections: actualTotalSections,
                        completedSections: completedSections,
                        percentage: actualPercentage,
                        lastAccessedAt: s.last_accessed_at,
                        firstAccessedAt: s.first_accessed_at,
                        totalSessions: s.total_sessions || 0,
                        totalTimeSpent: s.total_time_spent || 0,
                        chapters: chapterProgress
                    }
                };
            })
        });
    } catch (error) {
        console.error('Get course progress error:', error);
        console.error('Error stack:', error.stack);
        console.error('Course ID:', courseId);
        res.status(500).json({ error: 'Failed to retrieve course progress' });
    }
});

/**
 * GET /api/courses/:courseId/progress/:userId/details
 * Get detailed progress for a specific student (teacher view)
 */
app.get('/api/courses/:courseId/progress/:userId/details', authenticateToken, async (req, res) => {
    try {
        const { courseId, userId: studentId } = req.params;
        const requesterId = req.user.userId;

        // Verify requester is teacher or the student themselves
        if (req.user.role !== 'teacher' && requesterId !== studentId) {
            return res.status(403).json({ error: 'Access denied' });
        }

        // Get student info
        const student = await new Promise((resolve, reject) => {
            db.get(
                `SELECT id, username, display_name FROM users WHERE id = ?`,
                [studentId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Get progress summary
        const summary = await new Promise((resolve, reject) => {
            db.get(
                `SELECT * FROM course_progress_summary 
                WHERE user_id = ? AND course_id = ?`,
                [studentId, courseId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        // Get all sections with completion status
        const sections = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    cs.section_id,
                    cs.section_title,
                    cs.page_url,
                    cs.section_order,
                    cs.is_quiz_trigger,
                    rp.completed_at,
                    rp.time_spent_seconds,
                    CASE WHEN rp.id IS NOT NULL THEN 1 ELSE 0 END as is_completed
                FROM course_sections cs
                LEFT JOIN reading_progress rp ON 
                    rp.section_id = cs.section_id AND 
                    rp.user_id = ? AND 
                    rp.course_id = cs.course_id
                WHERE cs.course_id = ?
                ORDER BY cs.section_order ASC, cs.section_id ASC`,
                [studentId, courseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        // Get reading sessions
        const sessions = await new Promise((resolve, reject) => {
            db.all(
                `SELECT * FROM reading_sessions 
                WHERE user_id = ? AND course_id = ?
                ORDER BY started_at DESC
                LIMIT 20`,
                [studentId, courseId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({
            success: true,
            student: {
                id: student.id,
                username: student.username,
                displayName: student.display_name
            },
            summary: summary || {
                total_sections: sections.length,
                completed_sections: 0,
                progress_percentage: 0
            },
            sections: sections,
            recentSessions: sessions
        });
    } catch (error) {
        console.error('Get student progress details error:', error);
        res.status(500).json({ error: 'Failed to retrieve progress details' });
    }
});

/**
 * POST /api/courses/:courseId/sections
 * Register course sections (called when course structure is initialized)
 */
app.post('/api/courses/:courseId/sections', authenticateToken, async (req, res) => {
    try {
        const { courseId } = req.params;
        const { sections } = req.body;

        if (!Array.isArray(sections)) {
            return res.status(400).json({ error: 'Sections must be an array' });
        }

        // Verify user has access to course
        const course = await new Promise((resolve, reject) => {
            db.get(
                `SELECT created_by FROM courses WHERE id = ?`,
                [courseId],
                (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                }
            );
        });

        if (!course) {
            return res.status(404).json({ error: 'Course not found' });
        }

        // Insert or update sections
        const stmt = db.prepare(
            `INSERT INTO course_sections 
            (id, course_id, section_id, section_title, page_url, section_order, parent_section, is_quiz_trigger, quiz_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_id, section_id) DO UPDATE SET 
                section_title = excluded.section_title,
                page_url = excluded.page_url,
                section_order = excluded.section_order,
                parent_section = excluded.parent_section,
                is_quiz_trigger = excluded.is_quiz_trigger,
                quiz_id = excluded.quiz_id`
        );

        let insertedCount = 0;
        for (const section of sections) {
            const sectionDbId = uuidv4();
            stmt.run(
                sectionDbId,
                courseId,
                section.sectionId,
                section.title || '',
                section.pageUrl || '',
                section.order || 0,
                section.parentSection || null,
                section.isQuizTrigger ? 1 : 0,
                section.quizId || null,
                (err) => {
                    if (!err) insertedCount++;
                }
            );
        }

        stmt.finalize(() => {
            res.json({
                success: true,
                message: `Registered ${insertedCount} sections`,
                sectionsCount: insertedCount
            });
        });
    } catch (error) {
        console.error('Register sections error:', error);
        res.status(500).json({ error: 'Failed to register sections' });
    }
});

/**
 * GET /api/my-progress
 * Get current user's progress across all courses (student view)
 */
app.get('/api/my-progress', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Get progress for all enrolled courses
        const coursesProgress = await new Promise((resolve, reject) => {
            db.all(
                `SELECT 
                    c.id as course_id,
                    c.title as course_title,
                    c.description,
                    ce.enrolled_at,
                    COALESCE(cps.total_sections, 0) as total_sections,
                    COALESCE(cps.completed_sections, 0) as completed_sections,
                    COALESCE(cps.progress_percentage, 0) as progress_percentage,
                    cps.last_accessed_at,
                    cps.first_accessed_at
                FROM course_enrollments ce
                JOIN courses c ON ce.course_id = c.id
                LEFT JOIN course_progress_summary cps ON cps.user_id = ce.student_id AND cps.course_id = ce.course_id
                WHERE ce.student_id = ?
                ORDER BY cps.last_accessed_at DESC NULLS LAST, ce.enrolled_at DESC`,
                [userId],
                (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                }
            );
        });

        res.json({
            success: true,
            courses: coursesProgress.map(c => ({
                courseId: c.course_id,
                title: c.course_title,
                description: c.description,
                enrolledAt: c.enrolled_at,
                progress: {
                    totalSections: c.total_sections,
                    completedSections: c.completed_sections,
                    percentage: Math.round(c.progress_percentage * 100) / 100,
                    lastAccessedAt: c.last_accessed_at,
                    firstAccessedAt: c.first_accessed_at
                }
            }))
        });
    } catch (error) {
        console.error('Get my progress error:', error);
        res.status(500).json({ error: 'Failed to retrieve progress' });
    }
});

// ==================== END READING PROGRESS TRACKING ROUTES ====================

// Static file serving
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
server.listen(PORT, HOST, () => {
    const protocol = isHttpsEnabled ? 'https' : 'http';
    console.log(`Server running on ${protocol}://${HOST}:${PORT}`);
    if (!isHttpsEnabled) {
        console.log('HTTPS certificates not configured. Set HTTPS_KEY_PATH and HTTPS_CERT_PATH to enable TLS.');
    }
    console.log(`Teacher login: username=teacher, password=admin123`);
    console.log(`Student login: username=student1, password=student123`);
});