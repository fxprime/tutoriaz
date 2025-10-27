#!/bin/bash

echo "🚀 Building Tutoriaz for Netlify..."

# Bootstrap database with demo data
echo "🗄️ Creating database and demo data..."
npm run bootstrap

# Install dependencies for functions
echo "📦 Installing function dependencies..."
cd netlify/functions
npm install
cd ../..

# Copy courses to public directory for static serving
echo "📁 Setting up documentation..."
mkdir -p public/courses
cp -r courses/* public/courses/ 2>/dev/null || echo "No course docs found"

# Copy database to functions directory so it can be accessed
echo "📋 Copying database for functions..."
cp database.sqlite netlify/functions/ 2>/dev/null || echo "Database not found, will be created at runtime"

echo "✅ Build completed successfully!"