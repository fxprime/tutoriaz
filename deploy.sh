#!/bin/bash

# Deployment script for Tutoriaz
# This script handles git submodules and builds MkDocs documentation

set -e  # Exit on error

echo "======================================"
echo "Tutoriaz Deployment Script"
echo "======================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running in correct directory
if [ ! -f "server.js" ]; then
    echo -e "${RED}Error: server.js not found. Run this script from the tutoriaz directory.${NC}"
    exit 1
fi

echo -e "${YELLOW}Step 1: Pulling latest code...${NC}"
git pull origin main || {
    echo -e "${RED}Warning: Git pull failed. Continuing anyway...${NC}"
}

echo -e "${YELLOW}Step 2: Initializing and updating git submodules...${NC}"
git submodule init
git submodule update --recursive --remote

echo -e "${YELLOW}Step 3: Checking submodule status...${NC}"
git submodule status

# Check if courses/esp32_basic/site directory exists and has content
if [ -d "courses/esp32_basic/site" ] && [ -f "courses/esp32_basic/site/index.html" ]; then
    echo -e "${GREEN}✓ Documentation site found!${NC}"
else
    echo -e "${RED}✗ Documentation site not found. Checking if MkDocs is available...${NC}"
    
    # Check if we need to build the docs
    if [ -f "courses/esp32_basic/mkdocs.yml" ]; then
        echo -e "${YELLOW}Found mkdocs.yml. Attempting to build documentation...${NC}"
        
        # Check if mkdocs is installed
        if command -v mkdocs &> /dev/null; then
            echo -e "${YELLOW}Building documentation with MkDocs...${NC}"
            cd courses/esp32_basic
            mkdocs build
            cd ../..
            echo -e "${GREEN}✓ Documentation built successfully!${NC}"
        else
            echo -e "${RED}✗ MkDocs not installed. Install with: pip install mkdocs mkdocs-material${NC}"
            echo -e "${YELLOW}Alternatively, use the pre-built site/ directory from the repository.${NC}"
        fi
    else
        echo -e "${RED}✗ Cannot find or build documentation. Please check the submodule.${NC}"
    fi
fi

echo -e "${YELLOW}Step 4: Installing Node.js dependencies...${NC}"
npm install --production

echo -e "${YELLOW}Step 5: Verifying documentation access...${NC}"
if [ -f "courses/esp32_basic/site/index.html" ]; then
    echo -e "${GREEN}✓ Documentation ready at: /docs/esp32_basic/site/${NC}"
    echo "File: $(ls -lh courses/esp32_basic/site/index.html)"
else
    echo -e "${RED}✗ Documentation index.html not found!${NC}"
    echo "Contents of courses/esp32_basic/:"
    ls -la courses/esp32_basic/ || echo "Directory not found"
fi

echo -e "\n${YELLOW}Step 6: Setting up environment...${NC}"
echo "Make sure to set these environment variables:"
echo "  export NODE_ENV=production"
echo "  export HOST=0.0.0.0"
echo "  export PORT=3030"
echo "  export BASE_URL=http://YOUR_SERVER_IP:3030"
echo "  export JWT_SECRET=your-secure-secret-key"

echo -e "\n${GREEN}======================================"
echo "Deployment preparation complete!"
echo "======================================${NC}"
echo ""
echo "Next steps:"
echo "1. Set environment variables (see above)"
echo "2. Start server with: npm start"
echo "   Or use PM2: pm2 start server.js --name tutoriaz"
echo ""
echo "To verify documentation access:"
echo "  curl http://localhost:3030/docs/esp32_basic/site/index.html"
echo ""
