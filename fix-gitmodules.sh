#!/bin/bash

# Script to fix .gitmodules by adding missing branch entries

GITMODULES_FILE=".gitmodules"

echo "Fixing .gitmodules file..."

# Check if .gitmodules exists
if [ ! -f "$GITMODULES_FILE" ]; then
    echo "Error: .gitmodules file not found"
    exit 1
fi

# Backup the original file
cp "$GITMODULES_FILE" "${GITMODULES_FILE}.backup"
echo "Created backup: ${GITMODULES_FILE}.backup"

# Add branch = main to esp32_loadcell_set_doc submodule if not present
if grep -q 'path = courses/esp32_loadcell_set_doc' "$GITMODULES_FILE"; then
    if ! grep -A 3 'path = courses/esp32_loadcell_set_doc' "$GITMODULES_FILE" | grep -q 'branch ='; then
        echo "Adding branch to esp32_loadcell_set_doc..."
        # Use sed to add branch line after the url line for this specific submodule
        sed -i '' '/\[submodule "courses\/esp32_loadcell_set_doc"\]/,/^$/ {
            /url = /a\
	branch = main
        }' "$GITMODULES_FILE"
    else
        echo "esp32_loadcell_set_doc already has branch specified"
    fi
else
    echo "esp32_loadcell_set_doc submodule not found in .gitmodules"
fi

echo "Done! Updated .gitmodules file."
echo ""
echo "To apply the changes, run:"
echo "  git submodule sync"
echo "  git submodule update --remote"
