#!/bin/bash

echo "🚀 Building Tutoriaz for Netlify..."

# Install dependencies for functions
echo "� Installing function dependencies..."
cd netlify/functions
npm install
cd ../..

# Copy courses to public directory for static serving
echo "📁 Setting up documentation..."
mkdir -p public/courses
cp -r courses/* public/courses/ 2>/dev/null || echo "No course docs found"

echo "✅ Build completed successfully!"