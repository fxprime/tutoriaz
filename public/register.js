// Registration form handler

// Ensure DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initForm);
} else {
    initForm();
}

function initForm() {
    const form = document.getElementById('register-form');
    const messageEl = document.getElementById('message');

    if (!form) {
        console.error('Form not found!');
        return;
    }
    
    console.log('Form initialized, attaching submit handler');

    function showMessage(text, type) {
        messageEl.textContent = text;
        messageEl.className = `message ${type}`;
        messageEl.style.display = 'block';
    }

    form.addEventListener('submit', async (event) => {
        console.log('Submit event fired, preventing default');
        event.preventDefault();
        event.stopPropagation();
        
        messageEl.style.display = 'none';

        // Client-side sanitization and validation
        const rawUsername = form.username.value.trim();
        const rawDisplay = form.display_name.value.trim();
        const password = form.password.value;

        // Username policy: 3-30 chars, letters, numbers, underscore; must start with letter
        const username = rawUsername.toLowerCase();
        if (!/^[a-z0-9_]{3,30}$/.test(username)) {
            showMessage('Username must be 3-30 characters and contain only letters, numbers and underscore.', 'error');
            return false;
        }
        if (username.startsWith('_') || /^[0-9]/.test(username)) {
            showMessage('Username must start with a letter.', 'error');
            return false;
        }
        
        // Check reserved usernames
        const reserved = ['admin','root','system','administrator','support','null','undefined','test','demo'];
        if (reserved.includes(username)) {
            showMessage('Username not allowed.', 'error');
            return false;
        }

        // Stronger password validation (8+ chars, letter + number/symbol)
        if (!password || password.length < 8) {
            showMessage('Password must be at least 8 characters.', 'error');
            return false;
        }
        if (password.length > 128) {
            showMessage('Password too long (max 128 characters).', 'error');
            return false;
        }
        if (!/[a-zA-Z]/.test(password)) {
            showMessage('Password must contain at least one letter.', 'error');
            return false;
        }
        if (!/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            showMessage('Password must contain at least one number or symbol.', 'error');
            return false;
        }

        // Basic display name sanitization: remove angle brackets and control chars, limit length
        let display_name = rawDisplay.replace(/[<>]/g, '').replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 60);

        const data = { username, display_name, password };

        form.querySelector('button').disabled = true;

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Registration failed');
            }

            showMessage('Registration successful! Redirecting to login…', 'success');
            form.reset();
            setTimeout(() => {
                window.location.href = '/?login=1';
            }, 1200);
        } catch (error) {
            showMessage(error.message, 'error');
        } finally {
            form.querySelector('button').disabled = false;
        }
        
        return false;
    });
}
