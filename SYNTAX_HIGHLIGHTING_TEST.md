# Syntax Highlighting Test

This document helps you test the new syntax highlighting feature in quiz questions and options.

## What Was Fixed

**Problem:** Code blocks in markdown (using triple backticks with language specifiers) were not syntax-highlighted.

**Solution:** Added Highlight.js library and configured marked.js to use it for code syntax highlighting.

## Changes Made

1. **Added Highlight.js CDN** to both `student.html` and `teacher.html`:
   - Main library
   - GitHub theme (light mode)
   - Language modules: C++, Python, JavaScript, Arduino

2. **Configured marked.js** to use Highlight.js for code blocks

3. **Added CSS styling** for code blocks with proper formatting

## Supported Languages

The following languages are pre-loaded:
- `cpp` - C++
- `python` - Python
- `javascript` - JavaScript
- `arduino` - Arduino (C++ variant)

Highlight.js will auto-detect other languages, but these 4 are explicitly loaded for best performance.

## How to Test

### 1. Create a Quiz with Code

In the teacher dashboard, create a new quiz with this markdown in the question:

```markdown
What does this C++ code do?

```cpp
int led = 13;
void setup() {
  pinMode(led, OUTPUT);
}
void loop() {
  digitalWrite(led, HIGH);
  delay(1000);
  digitalWrite(led, LOW);
  delay(1000);
}
```
```

### 2. Test Different Languages

**Python Example:**
```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

print(fibonacci(10))
```

**JavaScript Example:**
```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.listen(3000);
```

**Arduino Example:**
```arduino
#define LED_PIN 13

void setup() {
  Serial.begin(9600);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("LED ON");
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  Serial.println("LED OFF");
  delay(1000);
}
```

### 3. Inline Code

You can also use inline code like `int a = 5;` within your text.

## Expected Results

When viewing the quiz as a student or in the quiz preview:

✅ **Code blocks should have:**
- Light gray background (#f6f8fa)
- Rounded corners (6px border-radius)
- Proper padding (16px)
- Syntax highlighting with colors for:
  - Keywords (blue/purple)
  - Strings (green)
  - Comments (gray)
  - Numbers (orange/brown)
  - Functions (various colors)

✅ **Inline code should have:**
- Light gray background
- Small rounded corners
- Slightly smaller font size

## Troubleshooting

**If code is not highlighted:**

1. Check browser console for errors
2. Verify Highlight.js loaded: Type `hljs` in browser console - should return an object
3. Verify marked is configured: Type `marked.options` in console
4. Clear browser cache and reload

**If highlighting looks wrong:**

1. Check that you're using the correct language identifier (cpp, not c++)
2. Verify the CDN links are accessible
3. Try auto-detection by not specifying a language:
   ````markdown
   ```
   int a = 5;
   ```
   ````

## Additional Language Support

To add more languages, edit `student.html` and `teacher.html` and add language modules after the main Highlight.js script:

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/java.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/rust.min.js"></script>
```

See full language list at: https://github.com/highlightjs/highlight.js/blob/main/SUPPORTED_LANGUAGES.md

## Changing the Theme

To use a different color theme, replace the CSS link in the HTML files:

**Dark themes:**
- `github-dark.min.css`
- `monokai.min.css`
- `atom-one-dark.min.css`

**Light themes:**
- `github.min.css` (current)
- `stackoverflow-light.min.css`
- `atom-one-light.min.css`

Browse themes at: https://highlightjs.org/demo
