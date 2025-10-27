# 🚀 Netlify Deployment Guide สำหรับ Tutoriaz

## 📋 ขั้นตอนการ Deploy บน Netlify

### 1. เตรียม Repository
```bash
git add .
git commit -m "Add Netlify configuration"
git push origin main
```

### 2. สร้าง Site บน Netlify
1. ไปที่ [Netlify Dashboard](https://app.netlify.com)
2. Click "New site from Git"
3. เชื่อมต่อกับ GitHub repository ของคุณ
4. เลือก repository `tutoriaz`

### 3. ตั้งค่า Build Settings
- **Build command**: `npm run build`
- **Publish directory**: `public`
- **Functions directory**: `netlify/functions`

### 4. ตั้งค่า Environment Variables
ไปที่ Site settings > Environment variables และเพิ่ม:

```
BASE_URL=https://your-site-name.netlify.app
NODE_ENV=production
JWT_SECRET=your-super-secure-jwt-secret-here
```

### 5. ตั้งค่า Node.js Version
ไปที่ Site settings > Environment variables และเพิ่ม:
```
NODE_VERSION=18
```

## 🔧 Netlify Functions Configuration

### ไฟล์ที่สำคัญ:
- `netlify.toml` - Configuration หลัก
- `netlify/functions/server.js` - API handler
- `build.sh` - Build script
- `public/` - Static files

### URL Structure หลัง Deploy:
- **Frontend**: `https://your-site.netlify.app`
- **API**: `https://your-site.netlify.app/api/*`
- **Documentation**: `https://your-site.netlify.app/docs/*`

## 🎯 Features ที่รองรับ:

✅ **Static File Serving**: HTML, CSS, JS files  
✅ **API Endpoints**: `/api/config`, `/api/login`, etc.  
✅ **Course Documentation**: ESP32 docs accessible via iframe  
✅ **Database**: SQLite database (ephemeral storage)  
✅ **Authentication**: JWT-based auth system  
✅ **WebSocket**: Socket.io สำหรับ real-time features  

## ⚠️ ข้อจำกัดของ Netlify:

1. **Database**: ข้อมูลจะหายเมื่อ function restart (ใช้ external DB สำหรับ production)
2. **WebSocket**: จำกัดในแบบ serverless (อาจต้องใช้ alternative)
3. **File Upload**: จำกัด file size และ storage

## 🔄 สำหรับ Development:

```bash
# Local testing
npm run dev

# Build testing
npm run build
./build.sh
```

## 🌐 การทดสอบหลัง Deploy:

1. เข้า `https://your-site.netlify.app`
2. Login ด้วย:
   - Teacher: `teacher` / `admin123`
   - Student: `student1` / `student123`
3. ทดสอบ ESP32 documentation loading
4. ตรวจสอบ console สำหรับ BASE_URL configuration

## 📱 Production Considerations:

สำหรับ production จริง ควรพิจารณา:
- External database (PostgreSQL/MongoDB)
- Redis สำหรับ session storage  
- CDN สำหรับ static assets
- Monitoring และ logging