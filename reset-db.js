// reset-db.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDatabase } = require('./db/db');

// Get database path from environment variable or use default
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'wcag_scanner.db');

// Main function to reset the database
async function resetDatabase() {
  console.log('Starting database reset process...');
  
  // Check if database file exists
  if (fs.existsSync(dbPath)) {
    // Create backup before deleting
    const backupPath = `${dbPath}.backup-${Date.now()}`;
    try {
      fs.copyFileSync(dbPath, backupPath);
      console.log(`Created backup at: ${backupPath}`);
    } catch (backupError) {
      console.error(`Warning: Could not create backup: ${backupError.message}`);
    }
    
    // Delete the old database file
    try {
      fs.unlinkSync(dbPath);
      console.log(`Deleted old database file: ${dbPath}`);
    } catch (unlinkError) {
      console.error(`Error: Could not delete database file: ${unlinkError.message}`);
      console.error('Please close any applications that might be using the database and try again.');
      process.exit(1);
    }
  } else {
    console.log('No existing database file found, creating a new one.');
  }
  
  // Initialize the new database
  try {
    await initDatabase();
    console.log('Successfully initialized new database with required tables!');
    console.log(`New database created at: ${dbPath}`);
  } catch (initError) {
    console.error(`Error initializing new database: ${initError.message}`);
    process.exit(1);
  }
}

// Run the reset process
resetDatabase()
  .then(() => {
    console.log('Database reset completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error(`Unexpected error during database reset: ${error.message}`);
    process.exit(1);
  });
