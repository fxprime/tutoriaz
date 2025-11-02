#!/usr/bin/env node
/**
 * Security Test Script
 * Tests the enhanced security features of the registration system
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3030';
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

async function testRegistration(testName, data, shouldFail = false) {
    try {
        const response = await axios.post(`${BASE_URL}/api/register`, data);
        if (shouldFail) {
            log('red', `✗ ${testName}: Expected to fail but succeeded`);
            return false;
        } else {
            log('green', `✓ ${testName}: Success`);
            return true;
        }
    } catch (error) {
        if (shouldFail) {
            const errorMsg = error.response?.data?.error || error.message;
            log('green', `✓ ${testName}: Correctly rejected - ${errorMsg}`);
            return true;
        } else {
            const errorMsg = error.response?.data?.error || error.message;
            log('red', `✗ ${testName}: Failed - ${errorMsg}`);
            return false;
        }
    }
}

async function runTests() {
    log('blue', '\n=== Security Registration Tests ===\n');
    
    const tests = [
        // Username validation tests
        {
            name: 'Reject username starting with number',
            data: { username: '123test', password: 'Test123!', display_name: 'Test' },
            shouldFail: true
        },
        {
            name: 'Reject username starting with underscore',
            data: { username: '_test', password: 'Test123!', display_name: 'Test' },
            shouldFail: true
        },
        {
            name: 'Reject reserved username (admin)',
            data: { username: 'admin', password: 'Test123!', display_name: 'Admin' },
            shouldFail: true
        },
        {
            name: 'Reject reserved username (root)',
            data: { username: 'root', password: 'Test123!', display_name: 'Root' },
            shouldFail: true
        },
        {
            name: 'Reject username too short (2 chars)',
            data: { username: 'ab', password: 'Test123!', display_name: 'Test' },
            shouldFail: true
        },
        {
            name: 'Reject username with special chars',
            data: { username: 'test@user', password: 'Test123!', display_name: 'Test' },
            shouldFail: true
        },
        
        // Password validation tests
        {
            name: 'Reject password too short (< 8 chars)',
            data: { username: 'testuser1', password: 'Test1!', display_name: 'Test' },
            shouldFail: true
        },
        {
            name: 'Reject password without letters',
            data: { username: 'testuser2', password: '12345678!', display_name: 'Test' },
            shouldFail: true
        },
        {
            name: 'Reject password without numbers or symbols',
            data: { username: 'testuser3', password: 'TestPassword', display_name: 'Test' },
            shouldFail: true
        },
        
        // XSS attempt tests
        {
            name: 'Sanitize XSS in display name',
            data: { username: 'testxss1', password: 'Test123!', display_name: '<script>alert("xss")</script>' },
            shouldFail: false // Should succeed but sanitize
        },
        {
            name: 'Sanitize HTML tags in display name',
            data: { username: 'testxss2', password: 'Test123!', display_name: '<b>Bold Name</b>' },
            shouldFail: false // Should succeed but sanitize
        },
        
        // Valid registration tests
        {
            name: 'Accept valid username and password (letters + numbers)',
            data: { username: 'validuser1', password: 'Valid123', display_name: 'Valid User' },
            shouldFail: false
        },
        {
            name: 'Accept valid username and password (letters + symbols)',
            data: { username: 'validuser2', password: 'Valid@Pass', display_name: 'Another User' },
            shouldFail: false
        },
        {
            name: 'Accept username with underscores (not at start)',
            data: { username: 'valid_user_3', password: 'Test123!', display_name: 'Test' },
            shouldFail: false
        },
        {
            name: 'Accept empty display name (uses username)',
            data: { username: 'validuser4', password: 'Test123!', display_name: '' },
            shouldFail: false
        }
    ];
    
    let passed = 0;
    let failed = 0;
    
    for (const test of tests) {
        const result = await testRegistration(test.name, test.data, test.shouldFail);
        if (result) {
            passed++;
        } else {
            failed++;
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between tests
    }
    
    log('blue', `\n=== Test Summary ===`);
    log('green', `Passed: ${passed}`);
    if (failed > 0) {
        log('red', `Failed: ${failed}`);
    }
    log('blue', `Total: ${tests.length}\n`);
    
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
    log('red', `\nFatal error: ${error.message}`);
    process.exit(1);
});
