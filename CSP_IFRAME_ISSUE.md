# CSP Frame-Ancestors Issue

## Error Message
```
Framing 'https://tutoriaz.modulemore.com/' violates the following Content Security Policy directive: "frame-ancestors 'self'". The request has been blocked.
```

## Problem Explanation

This error occurs when trying to embed `https://tutoriaz.modulemore.com/` in an iframe on the student page. The issue is **NOT** with our application's CSP configuration - our server correctly allows the iframe source.

### What's Happening

The external documentation site (`tutoriaz.modulemore.com`) has its own Content Security Policy header that includes:
```
frame-ancestors 'self'
```

This directive **prevents the site from being embedded** in iframes on any domain except itself. It's a security measure set by the documentation server to prevent clickjacking attacks.

## Our CSP Configuration (Correct)

In `server.js`, we already allow embedding content from the documentation domain:

```javascript
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            frameSrc: ["'self'", "https://tutoriaz.modulemore.com", "https://*.modulemore.com"]
        }
    }
}));
```

This configuration is **correct** - it allows our page to create iframes pointing to tutoriaz.modulemore.com.

## The Real Issue

The problem is on the **external server** (tutoriaz.modulemore.com), which needs to modify its CSP headers to allow being embedded. The documentation server needs to either:

1. **Remove** the `frame-ancestors 'self'` directive, OR
2. **Add our domain** to the allowed list: `frame-ancestors 'self' https://tutoriaz.modulemore.com https://localhost:3030`

## Solutions

### Option 1: Host Documentation Locally (Recommended)
Instead of embedding external documentation, serve it from our own server:

1. Copy documentation files to `courses/` directory
2. Serve via `/docs` endpoint (already configured)
3. Update iframe src to local path:
   ```javascript
   document.getElementById('courseDocsFrame').src = '/docs/esp32_basic/site/index.html';
   ```

**Pros:**
- No CSP issues
- Faster loading (local files)
- Works offline
- Full control over content

**Cons:**
- Need to sync documentation updates manually

### Option 2: Contact Documentation Server Admin
Request the administrator of `tutoriaz.modulemore.com` to modify their server's CSP headers to allow embedding from your domain.

They need to add this header:
```
Content-Security-Policy: frame-ancestors 'self' https://localhost:3030 https://your-production-domain.com
```

**Pros:**
- Always shows latest documentation
- No need to sync files

**Cons:**
- Requires external server configuration
- Depends on external availability
- Slower loading (network request)

### Option 3: Use Proxy/CORS Proxy
Create a server-side proxy that fetches the documentation and serves it without the restrictive CSP headers.

**Not Recommended** - Complex and may violate the documentation site's terms of service.

## Current Workaround

The student page currently has a button to "Open in new tab" which opens the documentation in a separate browser tab, bypassing the iframe embedding issue:

```javascript
function openDocsNewTab() {
    const frame = document.getElementById('courseDocsFrame');
    if (frame && frame.src) {
        window.open(frame.src, '_blank');
    }
}
```

## Implementation Status

✅ Our CSP allows embedding external documentation (frameSrc configured)
❌ External server blocks embedding (frame-ancestors 'self')
✅ Local documentation serving already configured (`/docs` endpoint)
✅ Workaround: "Open in new tab" button available

## Recommended Action

**Switch to local documentation hosting:**

1. Documentation files already exist in `courses/esp32_basic/site/`
2. Already served via `/docs` endpoint
3. Update iframe src in student.js to use local path:
   ```javascript
   // Instead of:
   const docsUrl = course.docs_url; // External URL
   
   // Use:
   const docsUrl = `/docs/esp32_basic/site/index.html`; // Local path
   ```

This avoids the CSP issue entirely and provides better performance.

## Testing Local Documentation

1. Navigate to: `http://localhost:3030/docs/esp32_basic/site/index.html`
2. Verify the documentation loads correctly
3. Update the iframe src in the student experience code
4. Refresh student page and verify iframe works without CSP errors

## Related Files
- `server.js` (lines 120-175) - CSP configuration
- `public/student.js` - iframe source configuration
- `courses/esp32_basic/site/` - Local documentation files
- `server.js` (line 193) - `/docs` static file serving
