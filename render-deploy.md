# Render.com Deployment Configuration

## Environment Variables to Set in Render.com:

1. **BASE_URL**: Set this to your Render app URL (e.g., `https://your-app-name.onrender.com`)
2. **NODE_ENV**: Set to `production`
3. **JWT_SECRET**: Set to a secure random string for production

## Example Environment Variables:

```
BASE_URL=https://tutoriaz-app.onrender.com
NODE_ENV=production
JWT_SECRET=your-super-secure-jwt-secret-key-here
PORT=10000
HOST=0.0.0.0
```

## Documentation Access:

The app will automatically:
1. Fetch the BASE_URL from the `/api/config` endpoint
2. Replace `localhost:3030` URLs in the database with the production URL
3. Serve documentation from `/docs` route using the production domain

## Database Documentation URLs:

Current ESP32 course documentation URL in database:
- Development: `http://localhost:3030/docs/esp32_basic/site/`
- Production: Will automatically become `https://your-app.onrender.com/docs/esp32_basic/site/`

## How it Works:

1. Frontend fetches config from `/api/config` on page load
2. When loading course documentation, replaces localhost URLs with production BASE_URL
3. Documentation served via Express static middleware from `/docs` route
4. Iframe loads documentation using production domain, accessible from external networks

## Testing:

1. Deploy to Render.com with proper environment variables
2. Access student/teacher interfaces
3. Verify ESP32 documentation loads in iframe from production URL
4. Documentation should be accessible from any network