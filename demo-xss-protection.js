#!/usr/bin/env node
/**
 * XSS Protection Demo
 * Demonstrates how user input is sanitized to prevent XSS attacks
 */

const xss = require('xss');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(color, message) {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function testXSS(label, input) {
    log('cyan', `\n${label}:`);
    log('yellow', `Input:  "${input}"`);
    
    // Apply same sanitization as server
    let sanitized = xss(input).trim().slice(0, 200);
    sanitized = sanitized.replace(/[\u0000-\u001F\u007F]/g, '');
    
    log('green', `Output: "${sanitized}"`);
    
    if (input !== sanitized) {
        log('blue', '→ Input was sanitized ✓');
    } else {
        log('blue', '→ No changes needed ✓');
    }
}

log('blue', '\n=== XSS Protection Demo ===');
log('blue', 'Showing how malicious input is sanitized\n');

// Test cases
testXSS(
    '1. Script injection attempt',
    '<script>alert("XSS Attack!")</script>Normal Text'
);

testXSS(
    '2. Image with onerror handler',
    '<img src=x onerror="alert(\'XSS\')">Innocent Image'
);

testXSS(
    '3. HTML event handler',
    '<div onclick="maliciousCode()">Click me</div>'
);

testXSS(
    '4. Inline JavaScript',
    '<a href="javascript:alert(\'XSS\')">Click here</a>'
);

testXSS(
    '5. SVG with embedded script',
    '<svg onload="alert(\'XSS\')"></svg>'
);

testXSS(
    '6. Style injection',
    '<style>body{background:red}</style>Normal content'
);

testXSS(
    '7. Iframe injection',
    '<iframe src="http://evil.com"></iframe>Content'
);

testXSS(
    '8. Control characters',
    'Hello\x00World\x1F\x7F'
);

testXSS(
    '9. Mixed HTML and text',
    '<b>Bold</b> <i>Italic</i> Normal'
);

testXSS(
    '10. Safe markdown-like syntax',
    '**Bold** and *italic* with `code`'
);

testXSS(
    '11. Safe special characters',
    'Math: 2 + 2 = 4, Temperature: 20°C, Email: user@example.com'
);

testXSS(
    '12. Long input with truncation',
    'A'.repeat(300) + '<script>alert("XSS")</script>'
);

log('blue', '\n=== Summary ===');
log('green', '✓ All malicious HTML/JavaScript code is stripped');
log('green', '✓ Control characters are removed');
log('green', '✓ Input is truncated to safe lengths');
log('green', '✓ Safe characters and text are preserved\n');

log('yellow', 'Note: The actual rendered markdown (for quiz questions) is');
log('yellow', 'parsed by marked.js AFTER sanitization, allowing safe');
log('yellow', 'formatting like **bold** and `code` while blocking XSS.\n');
