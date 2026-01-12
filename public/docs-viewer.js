// Get parameters from URL
const urlParams = new URLSearchParams(window.location.search);
const docsUrl = urlParams.get('url');
const userId = urlParams.get('user_id');
const courseId = urlParams.get('course_id');
const courseTitle = urlParams.get('title');

if (courseTitle) {
    document.getElementById('courseTitle').textContent = decodeURIComponent(courseTitle);
    document.title = `${decodeURIComponent(courseTitle)} - Tutoriaz`;
}

if (!docsUrl) {
    document.getElementById('loading').innerHTML = `
        <div style="color: #f44336; font-weight: 600;">❌ No documentation URL provided</div>
    `;
} else {
    // Construct the full documentation URL with parameters
    const urlSeparator = docsUrl.includes('?') ? '&' : '?';
    let fullDocsUrl = `${docsUrl}${urlSeparator}user_id=${encodeURIComponent(userId || 'anonymous')}&course_id=${encodeURIComponent(courseId || 'unknown')}`;

    const iframe = document.getElementById('docsFrame');
    
    // Show iframe when loaded
    iframe.onload = function() {
        document.getElementById('loading').style.display = 'none';
        iframe.style.display = 'block';
        
        // Try to inject script to handle internal navigation
        try {
            // This will only work for same-origin iframes
            injectNavigationHandler();
        } catch (e) {
            console.log('Cannot inject navigation handler (cross-origin):', e);
        }
    };

    iframe.onerror = function() {
        document.getElementById('loading').innerHTML = `
            <div style="color: #f44336; font-weight: 600;">❌ Failed to load documentation</div>
        `;
    };

    iframe.src = fullDocsUrl;
    console.log('Loading documentation:', fullDocsUrl);
}

function injectNavigationHandler() {
    try {
        const iframeDoc = document.getElementById('docsFrame').contentWindow;
        
        // Monitor iframe navigation to preserve query parameters
        const preserveParams = function() {
            try {
                const iframe = document.getElementById('docsFrame');
                const iframeLocation = iframe.contentWindow.location;
                
                // Check if the iframe URL has our required parameters
                if (!iframeLocation.search.includes('user_id=') || !iframeLocation.search.includes('course_id=')) {
                    const separator = iframeLocation.search ? '&' : '?';
                    const newUrl = `${iframeLocation.pathname}${iframeLocation.search}${separator}user_id=${encodeURIComponent(userId || 'anonymous')}&course_id=${encodeURIComponent(courseId || 'unknown')}${iframeLocation.hash}`;
                    
                    // Update the iframe URL to include parameters
                    if (iframeLocation.href !== newUrl) {
                        iframeLocation.href = newUrl;
                    }
                }
            } catch (e) {
                // Cross-origin error - expected for external sites
                console.log('Cannot access iframe location:', e);
            }
        };

        // Set up interval to check and preserve parameters
        setInterval(preserveParams, 500);

        // Also intercept link clicks if possible (same-origin only)
        if (iframeDoc.document) {
            iframeDoc.document.addEventListener('click', function(e) {
                if (e.target.tagName === 'A' && e.target.href) {
                    const link = e.target;
                    const url = new URL(link.href);
                    
                    // Add parameters if they're missing
                    if (!url.searchParams.has('user_id')) {
                        url.searchParams.set('user_id', userId || 'anonymous');
                    }
                    if (!url.searchParams.has('course_id')) {
                        url.searchParams.set('course_id', courseId || 'unknown');
                    }
                    
                    link.href = url.toString();
                }
            }, true);
        }
    } catch (e) {
        console.log('Cannot set up navigation handler:', e);
    }
}
