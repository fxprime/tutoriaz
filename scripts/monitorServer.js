/**
 * Server Performance Monitor
 * Monitors server health during load testing
 * 
 * Usage: node scripts/monitorServer.js [serverUrl]
 */

const fetch = require('node-fetch');

const SERVER_URL = process.argv[2] || 'http://localhost:3030';
const MONITOR_INTERVAL = 2000; // Check every 2 seconds

let previousStats = null;

async function checkHealth() {
    try {
        const startTime = Date.now();
        const response = await fetch(`${SERVER_URL}/health`, { timeout: 5000 });
        const responseTime = Date.now() - startTime;
        
        if (response.ok) {
            return { status: '✅', responseTime };
        } else {
            return { status: '⚠️', responseTime, error: response.status };
        }
    } catch (error) {
        return { status: '❌', error: error.message };
    }
}

function formatBytes(bytes) {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    return `${hours}h ${minutes}m ${secs}s`;
}

async function monitor() {
    const health = await checkHealth();
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage(previousStats ? previousStats.cpu : undefined);
    
    console.clear();
    console.log('═══════════════════════════════════════════════════');
    console.log('   TUTORIAZ SERVER MONITOR');
    console.log('═══════════════════════════════════════════════════\n');
    
    console.log(`🌐 Server: ${SERVER_URL}`);
    console.log(`📊 Status: ${health.status}`);
    
    if (health.responseTime) {
        console.log(`⏱️  Response Time: ${health.responseTime}ms`);
    }
    
    if (health.error) {
        console.log(`❌ Error: ${health.error}`);
    }
    
    console.log('\n📈 Process Memory:');
    console.log(`   RSS:      ${formatBytes(memUsage.rss)}`);
    console.log(`   Heap:     ${formatBytes(memUsage.heapUsed)} / ${formatBytes(memUsage.heapTotal)}`);
    console.log(`   External: ${formatBytes(memUsage.external)}`);
    
    console.log('\n⚙️  CPU Usage (since last check):');
    console.log(`   User:   ${(cpuUsage.user / 1000000).toFixed(2)}s`);
    console.log(`   System: ${(cpuUsage.system / 1000000).toFixed(2)}s`);
    
    console.log('\n⏰ Uptime:', formatUptime(process.uptime()));
    
    console.log('\n═══════════════════════════════════════════════════');
    console.log('Press Ctrl+C to stop monitoring');
    console.log('═══════════════════════════════════════════════════');
    
    previousStats = {
        cpu: process.cpuUsage()
    };
}

console.log('Starting server monitor...\n');
monitor();
setInterval(monitor, MONITOR_INTERVAL);

process.on('SIGINT', () => {
    console.log('\n\n👋 Monitor stopped');
    process.exit(0);
});
