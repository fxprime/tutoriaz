# Debug Mode Feature

## Overview
The student page now has a debug view that can be enabled via URL parameter or console command.

## Activation Methods

### Method 1: URL Parameter
Access the student page with the debug code:
```
http://localhost:3030/student.html?debugcode=112255
```

The debug queue will appear in the bottom-right corner showing:
- Current quiz status
- Pending quizzes
- Queue position
- Remaining time

### Method 2: Console Command
While on the student page, open the browser console and run:
```javascript
toggleDebug('112255')
```

This will toggle debug mode ON/OFF.

## Features

### Debug Queue Display
- Shows real-time queue status
- Position: Fixed bottom-right corner
- Background: Semi-transparent black
- Updates automatically when queue changes

### Session Persistence
- Debug mode persists across page refreshes (using sessionStorage)
- Remains active until:
  - User closes the browser tab
  - User calls `toggleDebug('112255')` again to disable
  - User clears sessionStorage

### Security
- Debug code: `112255` (non-obvious)
- Hidden by default in production
- Only shows when explicitly activated
- No sensitive data exposed

## Implementation Details

### Files Modified
1. **public/student.js**
   - Added URL parameter parsing on initialization
   - Added `isDebugMode` flag with sessionStorage persistence
   - Added `applyDebugMode()` function to toggle visibility
   - Added `window.toggleDebug()` global function for console access
   - Checks for `?debugcode=112255` parameter

2. **public/student.html**
   - Modified `.debug-queue` CSS to `display: none` by default
   - Added `.debug-queue.active` class with `display: block`

### Code Flow
1. Page loads → Parse URL parameters
2. Check for `debugcode=112255` parameter
3. If found OR sessionStorage has `debugMode=true`:
   - Set `isDebugMode = true`
   - Store in sessionStorage for persistence
4. On DOMContentLoaded → Apply debug visibility
5. Console command allows runtime toggling

## Usage Examples

### Enable Debug Mode
```
# Via URL
http://localhost:3030/student.html?debugcode=112255

# Via Console
toggleDebug('112255')  // Returns: "Debug mode ON"
```

### Disable Debug Mode
```javascript
// In console
toggleDebug('112255')  // Returns: "Debug mode OFF"
```

### Check Current Status
```javascript
// The debug queue visibility indicates status:
// - Visible (bottom-right) = Debug mode ON
// - Hidden = Debug mode OFF
```

## Console Messages
When debug mode is activated, you'll see:
```
🐛 Debug mode activated via URL parameter
🐛 Debug queue is now visible
```

When toggled via console:
```
🐛 Debug mode ENABLED
🐛 Debug queue is now visible
```

Or:
```
🐛 Debug mode DISABLED
```

Invalid code attempt:
```
❌ Invalid debug code
```

## Testing Checklist
- [ ] Access with `?debugcode=112255` → Debug queue appears
- [ ] Access without parameter → Debug queue hidden
- [ ] Run `toggleDebug('112255')` → Toggle works
- [ ] Refresh page → Debug mode persists (if enabled)
- [ ] Close tab and reopen → Debug mode resets
- [ ] Try wrong code → Shows "Invalid code"
- [ ] Check sessionStorage → Contains `debugMode: true` when active

## Benefits
1. **Production-Safe**: Hidden by default, no code changes needed
2. **Easy Activation**: Simple URL parameter or console command
3. **Persistent**: Survives page refreshes during troubleshooting session
4. **Secure**: Requires non-obvious code to enable
5. **Flexible**: Can be toggled on/off without page reload
6. **No Performance Impact**: Only adds visibility toggle, existing debug functions unchanged
