// db/migrations/runner.js
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { DB_PATH } = require('../config/config');

// Create a database connection
const db = new sqlite3.Database(DB_PATH);

// Read the migration SQL
const migrationSQL = fs.readFileSync(path.join(__dirname, 'add_emails.sql'), 'utf8');

// Run the migration
db.exec(migrationSQL, (err) => {
  if (err) {
    console.error('Migration error:', err.message);
  } else {
    console.log('Migration completed successfully');
  }
  db.close();
});
