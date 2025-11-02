#!/usr/bin/env node
/**
 * Form Method Security Test
 * Verifies that forms use POST method to prevent credentials in URLs
 */

const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFormSecurity(filePath, fileName) {
    const content = fs.readFileSync(filePath, 'utf8');
    const issues = [];
    let passed = 0;
    
    // Find all forms with password fields
    const formRegex = /<form[^>]*>([\s\S]*?)<\/form>/gi;
    const forms = content.match(formRegex) || [];
    
    log('blue', `\n📄 Checking ${fileName}...`);
    
    forms.forEach((form, index) => {
        const hasPassword = /type=["']password["']/i.test(form);
        
        if (hasPassword) {
            log('yellow', `  Form ${index + 1}: Contains password field`);
            
            // Check if form has method="post"
            const hasPost = /method=["']post["']/i.test(form);
            const hasAction = /action=/i.test(form);
            
            if (!hasPost && !hasAction) {
                issues.push(`Form ${index + 1}: Missing method="post" attribute (defaults to GET - SECURITY RISK!)`);
                log('red', `    ✗ Missing method="post" - passwords could be exposed in URL!`);
            } else if (hasPost) {
                passed++;
                log('green', `    ✓ Uses method="post"`);
            }
            
            // Check for autocomplete
            const hasAutocomplete = /autocomplete=["'](off|new-password|current-password)["']/i.test(form);
            if (hasAutocomplete) {
                log('green', `    ✓ Has autocomplete attributes`);
            } else {
                log('yellow', `    ⚠ Could add autocomplete attributes for better security`);
            }
        }
    });
    
    return { issues, passed, total: forms.filter(f => /type=["']password["']/.test(f)).length };
}

log('blue', '\n=== Form Method Security Check ===');
log('blue', 'Checking that forms with passwords use POST method\n');

const publicDir = path.join(__dirname, 'public');
const htmlFiles = [
    { path: path.join(publicDir, 'index.html'), name: 'index.html' },
    { path: path.join(publicDir, 'register.html'), name: 'register.html' },
    { path: path.join(publicDir, 'teacher.html'), name: 'teacher.html' }
];

let totalIssues = [];
let totalPassed = 0;
let totalForms = 0;

htmlFiles.forEach(({ path: filePath, name }) => {
    if (fs.existsSync(filePath)) {
        const result = checkFormSecurity(filePath, name);
        totalIssues = totalIssues.concat(result.issues);
        totalPassed += result.passed;
        totalForms += result.total;
    } else {
        log('yellow', `\n⚠ ${name} not found, skipping...`);
    }
});

log('blue', '\n=== Summary ===');
if (totalIssues.length === 0) {
    log('green', `✓ All ${totalPassed} forms with passwords use POST method`);
    log('green', '✓ No security issues found!\n');
    process.exit(0);
} else {
    log('red', `\n✗ Found ${totalIssues.length} security issue(s):\n`);
    totalIssues.forEach(issue => {
        log('red', `  • ${issue}`);
    });
    log('red', '\n⚠ CRITICAL: Forms without method="post" will expose passwords in URLs!');
    log('yellow', '\nFix: Add method="post" attribute to all forms with password fields.\n');
    process.exit(1);
}
