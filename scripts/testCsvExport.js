#!/usr/bin/env node
/**
 * Test script for CSV export functionality
 * This script tests both basic and full CSV export modes
 */

const fs = require('fs');
const path = require('path');

const token = process.env.TEST_TOKEN;
const courseId = process.env.TEST_COURSE_ID;
const baseUrl = process.env.BASE_URL || 'http://localhost:3030';

if (!token) {
    console.error('❌ Error: TEST_TOKEN environment variable is required');
    console.log('Usage: TEST_TOKEN=your_token TEST_COURSE_ID=course_id node scripts/testCsvExport.js');
    console.log('\nTo get a token:');
    console.log('1. Login as teacher at http://localhost:3030');
    console.log('2. Open browser console and run: localStorage.getItem("token")');
    process.exit(1);
}

if (!courseId) {
    console.error('❌ Error: TEST_COURSE_ID environment variable is required');
    console.log('Usage: TEST_TOKEN=your_token TEST_COURSE_ID=course_id node scripts/testCsvExport.js');
    process.exit(1);
}

async function testExport(mode) {
    console.log(`\n📊 Testing ${mode.toUpperCase()} export...`);
    
    try {
        const response = await fetch(`${baseUrl}/api/courses/${courseId}/export-csv?mode=${mode}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Export failed');
        }

        const csvData = await response.text();
        
        // Parse CSV to count rows and columns
        const lines = csvData.trim().split('\n');
        const headers = lines[0].split(',');
        const dataRows = lines.length - 1; // Exclude header
        
        console.log(`✅ Export successful!`);
        console.log(`   Columns: ${headers.length}`);
        console.log(`   Headers: ${headers.join(', ')}`);
        console.log(`   Data rows: ${dataRows}`);
        
        // Save to file
        const outputDir = path.join(__dirname, '..', 'exports');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
        const filename = `test_export_${mode}_${timestamp}.csv`;
        const filepath = path.join(outputDir, filename);
        
        fs.writeFileSync(filepath, csvData);
        console.log(`   Saved to: ${filepath}`);
        
        // Show first few lines
        console.log('\n   Preview (first 3 rows):');
        lines.slice(0, 4).forEach((line, idx) => {
            if (idx === 0) {
                console.log(`   ${line}`);
            } else {
                console.log(`   ${line.substring(0, 100)}${line.length > 100 ? '...' : ''}`);
            }
        });
        
        return true;
    } catch (error) {
        console.error(`❌ Export failed:`, error.message);
        return false;
    }
}

async function main() {
    console.log('🧪 CSV Export Test Suite');
    console.log('========================');
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Course ID: ${courseId}`);
    console.log(`Token: ${token.substring(0, 20)}...`);
    
    let passCount = 0;
    let failCount = 0;
    
    // Test basic export
    if (await testExport('basic')) {
        passCount++;
    } else {
        failCount++;
    }
    
    // Test full export
    if (await testExport('full')) {
        passCount++;
    } else {
        failCount++;
    }
    
    // Summary
    console.log('\n========================');
    console.log('📋 Test Summary');
    console.log(`✅ Passed: ${passCount}`);
    console.log(`❌ Failed: ${failCount}`);
    
    if (failCount === 0) {
        console.log('\n🎉 All tests passed!');
        process.exit(0);
    } else {
        console.log('\n⚠️  Some tests failed');
        process.exit(1);
    }
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
