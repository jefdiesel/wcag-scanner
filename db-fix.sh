#!/bin/bash
# db-fix.sh - Safe script to fix database issues

# First make sure no processes are accessing the database
echo "Checking for processes that might be locking the database..."
ps aux | grep node | grep -v grep

# Force kill any running node processes (adjust if needed)
echo "Attempting to kill any node processes..."
pkill -9 node

# Wait a moment for processes to fully terminate
sleep 2

# Create a backup
echo "Creating database backup..."
DATE_SUFFIX=$(date +%Y%m%d%H%M%S)
cp ./data/wcag_scanner.db "./data/wcag_scanner.db.${DATE_SUFFIX}.bak"
echo "Backup created at ./data/wcag_scanner.db.${DATE_SUFFIX}.bak"

# Run the SQLite script
echo "Running SQLite cleanup commands..."
sqlite3 ./data/wcag_scanner.db < cleanup.sql

echo "Database cleanup completed."
echo "You can now update the application files and restart the server."
