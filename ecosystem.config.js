module.exports = {
  apps: [{
    name: 'tutoriaz',
    script: './server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3030,
      HOST: '0.0.0.0',
      BASE_URL: 'http://YOUR_SERVER_IP:3030',
      JWT_SECRET: 'your-secure-secret-key-change-this',
      DB_PATH: '/var/lib/tutoriaz/database.sqlite'  // Database outside git directory
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true
  }]
};
