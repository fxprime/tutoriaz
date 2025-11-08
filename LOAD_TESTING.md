# Load Testing Guide

This guide explains how to test your Tutoriaz system with 40+ simulated students.

## Quick Start

### 1. Start Your Server
```bash
npm start
# Or if using PM2:
pm2 start ecosystem.config.js
```

### 2. Run Load Test (Basic)
```bash
# Test with 40 students (default)
node scripts/loadTest.js

# Test with custom number of students
node scripts/loadTest.js 50

# Test against remote server
node scripts/loadTest.js 40 http://your-server.com:3030
```

### 3. Monitor Server Performance (Optional)
```bash
# In a separate terminal
node scripts/monitorServer.js
```

## What the Load Test Does

1. **Creates Test Students**: Registers 40 students (loadtest_[timestamp]_1 through loadtest_[timestamp]_40)
2. **Connects via WebSocket**: All 40 students connect simultaneously
3. **Enrolls in Course**: All students join the test course
4. **Test 1 - First Push**: Teacher pushes Quiz 1 to all students
5. **Auto-Answer**: Students answer within 1-5 seconds randomly
6. **Test 2 - Second Push**: Teacher pushes Quiz 2 (this is where the timeout bug occurred)
7. **Verification**: Checks if second push completes without timeout

## Expected Results

### ✅ Success Indicators
- First quiz push completes in < 5 seconds
- Second quiz push completes in < 5 seconds
- No timeout errors
- Student count stays at 40 (doesn't inflate)
- Server remains responsive

### ❌ Failure Indicators
- Timeout errors on second push
- Student count increases beyond 40
- Server hangs or becomes unresponsive
- Response time > 10 seconds

## Performance Benchmarks

| Metric | Before Fix | After Fix |
|--------|-----------|-----------|
| First quiz push | ~5-10s | ~3-5s |
| Second quiz push | TIMEOUT | ~3-5s |
| Student count | 40+ (inflated) | 40 (stable) |
| DB queries during push | 200-240 | 80-120 |
| updateOnlineList calls | 40+ concurrent | 1 (debounced) |

## Advanced Testing

### Stress Test with More Students
```bash
node scripts/loadTest.js 100  # Test with 100 students
```

### Custom Test Scenarios

Edit `scripts/loadTest.js` to customize:
- Number of quizzes pushed
- Answer delay timing
- Question types tested
- Course enrollment patterns

### Monitor Database Performance
```bash
# Watch SQLite performance
watch -n 1 "ls -lh database.sqlite"

# Or check with PM2 logs
pm2 logs tutoriaz --lines 50
```

## Troubleshooting

### Test Students Already Exist
```bash
# Clean up old test students
sqlite3 database.sqlite "DELETE FROM users WHERE username LIKE 'loadtest_%';"
```

### Server Not Responding
```bash
# Check if server is running
curl http://localhost:3030/health

# Restart server
pm2 restart tutoriaz
```

### Memory Issues
```bash
# Check memory usage
node scripts/monitorServer.js

# If memory is high, restart:
pm2 restart tutoriaz
```

### Socket Connection Failures
- Check firewall settings
- Verify WebSocket port is open
- Ensure CORS is configured correctly

## Integration with CI/CD

### GitHub Actions Example
```yaml
name: Load Test

on: [push, pull_request]

jobs:
  load-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm start &
      - run: sleep 5
      - run: node scripts/loadTest.js 40
```

## Cloud Load Testing

### Using Artillery (Alternative Tool)
```bash
npm install -g artillery

# Create artillery config
artillery quick --count 40 --num 10 http://localhost:3030
```

### Using Apache Bench
```bash
# Test HTTP endpoints
ab -n 1000 -c 40 http://localhost:3030/api/quizzes
```

## Key Metrics to Watch

1. **Response Time**: Should be < 5 seconds for quiz push
2. **Memory Usage**: Should not grow continuously
3. **CPU Usage**: Should return to normal after push
4. **Student Count**: Should match actual connections
5. **Database Locks**: No "database is locked" errors
6. **Socket Events**: All students receive quiz_queue_updated

## Results Interpretation

### Good Performance
```
✅ Push completed in 3421ms
📊 Added: 40, Skipped: 0
⏱️  Response Time: 145ms
```

### Poor Performance (Needs Investigation)
```
❌ Push timeout after 120000ms
⚠️  Response Time: 15234ms
📊 Students inflated to 67 (should be 40)
```

## Next Steps After Testing

1. Review server logs: `pm2 logs tutoriaz`
2. Check database size: `ls -lh database.sqlite`
3. Monitor production metrics
4. Set up alerts for response time > 10s
5. Plan for horizontal scaling if needed

## Contact

If load test reveals issues, check:
- Recent code changes
- Database indexes
- WebSocket connection limits
- Server resource allocation
