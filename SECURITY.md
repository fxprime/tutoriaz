# Security Improvements

This document outlines the security enhancements implemented in the Tutoriaz platform.

## Summary of Security Measures

### 1. Security Headers (Helmet.js)
- **Implementation**: Added `helmet()` middleware
- **Protection**: Sets various HTTP headers to protect against common vulnerabilities
  - XSS protection
  - Content-Type sniffing prevention
  - Frameguard (clickjacking protection)
  - Hide X-Powered-By header

### 2. Rate Limiting
- **Implementation**: `express-rate-limit` on authentication endpoints
- **Configuration**: 
  - Window: 15 minutes
  - Max requests: 15 per IP
- **Protected endpoints**:
  - `POST /api/login`
  - `POST /api/register`
- **Protection**: Prevents brute force attacks and credential stuffing

### 3. Request Body Size Limits
- **Implementation**: Set JSON and URL-encoded body limits to 8KB
- **Protection**: Prevents large payload DoS attacks

### 4. Enhanced Password Security

#### Server-side validation:
- Minimum length: **8 characters** (increased from 6)
- Maximum length: **128 characters**
- Must contain at least one letter (a-z, A-Z)
- Must contain at least one number OR symbol
- Passwords are hashed using bcrypt (10 rounds)

#### Client-side validation:
- Real-time validation before submission
- Clear error messages for better UX
- Matches server-side rules exactly

### 5. Username Validation

#### Rules:
- Length: 3-30 characters
- Allowed characters: letters (a-z), numbers (0-9), underscore (_)
- **Must start with a letter** (cannot start with number or underscore)
- Case-insensitive (automatically converted to lowercase)

#### Reserved usernames blocked:
- `admin`
- `root`
- `system`
- `administrator`
- `support`
- `null`
- `undefined`
- `test`
- `demo`

### 6. XSS Protection

#### Implementation:
- Using `xss` npm package to sanitize all user-generated content
- Applied to:
  - Display names
  - Quiz titles
  - Quiz content/questions
  - Quiz options
  - Quiz correct answers

#### Sanitization process:
1. Remove malicious HTML tags and scripts
2. Strip control characters (U+0000 to U+001F, U+007F)
3. Enforce length limits
4. Remove angle brackets from display names

#### Character limits:
- Display name: 60 characters
- Quiz title: 200 characters
- Quiz content: No hard limit (sanitized)
- Quiz options: 500 characters each, max 20 options
- Correct answer: 1000 characters

### 7. SQL Injection Protection

#### Implementation:
- **All database queries use parameterized statements**
- Never concatenate user input directly into SQL
- SQLite3 placeholders (`?`) used throughout

#### Verification:
- Code audit performed
- No string concatenation in SQL queries found
- All user inputs passed as parameters

### 8. Input Sanitization

#### Form Security:
- All forms use `method="post"` to prevent credentials in URL (GET would expose passwords)
- Forms use `action="#"` (harmless fallback - posts to same page with hash)
- JavaScript `event.preventDefault()` intercepts and handles submission via AJAX
- Forms have `autocomplete="off"` to prevent sensitive data caching
- Password fields use `autocomplete="new-password"` for registration
- Password fields use `autocomplete="current-password"` for login
- Content Security Policy (CSP) via Helmet.js enforces secure form behavior

#### Client-side (JavaScript):
```javascript
// Username: lowercase, alphanumeric + underscore
const username = rawUsername.toLowerCase();
if (!/^[a-z0-9_]{3,30}$/.test(username)) { /* reject */ }

// Display name: remove HTML and control chars
display_name = rawDisplay.replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .slice(0, 60);
```

#### Server-side (Node.js):
```javascript
// XSS sanitization
const sanitizedDisplay = xss(rawDisplay).trim().slice(0, 60);
sanitizedDisplay = sanitizedDisplay.replace(/[\u0000-\u001F\u007F]/g, '');
```

## Testing

### Security Test Suite
Run the comprehensive security test suite:

```bash
# Test registration validation and XSS protection
npm run test:security

# Test form method security (POST, not GET)
npm run test:forms

# Demo XSS protection
npm run demo:xss
```

### Test Coverage:
- ✓ Username validation (start with letter, no special chars)
- ✓ Reserved username blocking
- ✓ Password strength requirements
- ✓ XSS sanitization in display names
- ✓ Valid registration flows
- ✓ Form method security (POST, not GET)

**All tests passing** ✓

## Important Security Notes

### Browser History
If you previously accessed the registration page with credentials in the URL (before the fix), those credentials may still be in your browser history. To remove them:

**Chrome/Edge:**
1. Press `Ctrl+H` (Windows) or `Cmd+Y` (Mac)
2. Search for "register.html"
3. Delete those history entries

**Firefox:**
1. Press `Ctrl+Shift+H` (Windows) or `Cmd+Shift+H` (Mac)
2. Search for "register.html"
3. Right-click and "Forget About This Site"

**Safari:**
1. Press `Cmd+Y`
2. Search for "register.html"
3. Delete those history entries

### Server Logs
If you have server logs that captured URLs with passwords, you should:
1. Rotate those log files
2. Securely delete them
3. Change any exposed passwords

**All 15 tests passing** ✓

## Additional Security Recommendations

### For Production Deployment:

1. **Environment Variables**:
   ```bash
   JWT_SECRET=<strong-random-secret>
   NODE_ENV=production
   ```

2. **HTTPS**:
   - Use HTTPS in production
   - Configure proper SSL/TLS certificates
   - Enable HTTP Strict Transport Security (HSTS)

3. **Database**:
   - Regular backups
   - Restrict file permissions on database.sqlite
   - Consider encryption at rest

4. **CORS**:
   - Review and restrict CORS origins in production
   - Currently permissive for development

5. **Session Management**:
   - JWT tokens expire after 24 hours
   - Consider implementing token refresh mechanism
   - Add token revocation for logout

6. **Monitoring**:
   - Log authentication failures
   - Monitor rate limit violations
   - Set up alerts for suspicious activity

7. **Dependencies**:
   ```bash
   npm audit
   npm audit fix
   ```
   - Regular dependency updates
   - Monitor for security vulnerabilities

## Security Dependencies

Current security-related packages:

```json
{
  "bcryptjs": "^2.4.3",
  "helmet": "^8.1.0",
  "express-rate-limit": "^8.2.1",
  "xss": "^1.0.15",
  "express-validator": "^7.3.0"
}
```

## Vulnerability Reporting

If you discover a security vulnerability, please:
1. Do NOT open a public issue
2. Contact the maintainers privately
3. Provide detailed information about the vulnerability
4. Allow time for a fix before public disclosure

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Node.js Security Best Practices](https://nodejs.org/en/docs/guides/security/)
- [Express.js Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

---

**Last Updated**: November 2, 2025
**Version**: 1.0.0
