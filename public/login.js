// Login page handler

const API_BASE = window.location.origin + '/api';

// Fetch app configuration
async function fetchAppConfig() {
    try {
        const response = await fetch(`${API_BASE}/config`);
        if (response.ok) {
            const config = await response.json();
            
            // Update page title and description
            if (config.appName) {
                const titleEl = document.getElementById('appTitle');
                if (titleEl) {
                    titleEl.textContent = `${config.appName} - ${config.appDescription || 'Real-time Quiz Platform'}`;
                }
                document.title = config.appName;
            }
            
            if (config.appDescription) {
                const descEl = document.getElementById('appDescription');
                if (descEl) {
                    descEl.textContent = 'Choose to register as a student or log in to access your dashboard.';
                }
            }
        }
    } catch (error) {
        console.warn('Could not fetch app config:', error);
    }
}

const openLoginButton = document.getElementById('openLogin');
const loginSection = document.getElementById('loginSection');

function showLoginPanel() {
    loginSection.classList.remove('hidden');
    loginSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

openLoginButton.addEventListener('click', () => {
    showLoginPanel();
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const messageDiv = document.getElementById('loginMessage');
    messageDiv.innerHTML = '';
    showLoginPanel();

    try {
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            messageDiv.innerHTML = '<div class="success">Login successful! Redirecting...</div>';

            document.getElementById('loginSection').classList.add('hidden');
            document.getElementById('redirectSection').classList.remove('hidden');

            setTimeout(() => {
                if (data.user.role === 'teacher') {
                    window.location.href = '/teacher.html';
                } else {
                    window.location.href = '/student.html';
                }
            }, 1500);
        } else {
            messageDiv.innerHTML = `<div class="error">${data.error}</div>`;
        }
    } catch (error) {
        console.error('Login error:', error);
        messageDiv.innerHTML = '<div class="error">Network error. Please try again.</div>';
    }
});

// ── Google OAuth button setup ──────────────────────────────────────────────
async function initGoogleButton() {
    const btn = document.getElementById('googleLoginBtn');
    if (!btn) return;
    try {
        const res = await fetch(`${API_BASE}/auth/providers`);
        if (res.ok) {
            const { googleOAuth } = await res.json();
            if (googleOAuth) {
                btn.classList.remove('hidden');
                btn.addEventListener('click', () => {
                    window.location.href = '/auth/google';
                });
            }
        }
    } catch (e) {
        console.warn('Could not check OAuth providers:', e);
    }
}

window.addEventListener('load', () => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    const params = new URLSearchParams(window.location.search);

    // ── Handle Google OAuth callback token ────────────────────────────────
    const googleToken = params.get('google_token');
    if (googleToken) {
        try {
            // Decode payload (JWT is not encrypted – safe to read client-side)
            const payload = JSON.parse(atob(googleToken.split('.')[1]));
            localStorage.setItem('token', googleToken);
            localStorage.setItem('user', JSON.stringify({
                id: payload.userId,
                username: payload.username,
                display_name: payload.display_name,
                role: payload.role
            }));
            // Clean URL then redirect
            history.replaceState({}, '', '/');
            window.location.href = payload.role === 'teacher' ? '/teacher.html' : '/student.html';
            return;
        } catch (e) {
            console.error('Failed to parse Google token:', e);
        }
    }

    // ── Handle OAuth error ────────────────────────────────────────────────
    const oauthError = params.get('error');
    if (oauthError) {
        showLoginPanel();
        const messageDiv = document.getElementById('loginMessage');
        if (messageDiv) {
            const msg = oauthError === 'google_auth_failed'
                ? 'Google sign-in failed. Please try again or use username/password.'
                : 'Authentication error. Please try again.';
            messageDiv.innerHTML = `<div class="error">${msg}</div>`;
        }
        history.replaceState({}, '', '/');
    }

    if (params.get('login') === '1') {
        showLoginPanel();
    }

    if (token && user) {
        try {
            const userData = JSON.parse(user);
            if (userData.role === 'teacher') {
                window.location.href = '/teacher.html';
            } else {
                window.location.href = '/student.html';
            }
        } catch (error) {
            console.error('Error parsing user data:', error);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
        }
    }

    initGoogleButton();
});

// Initialize app config
fetchAppConfig();
