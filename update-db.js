const fs = require('fs');
const path = require('path');

// Path to your db.js file
const dbFilePath = path.join(__dirname, 'db', 'db.js');

// Read the current file
console.log(`Reading ${dbFilePath}...`);
let dbFileContent;
try {
  dbFileContent = fs.readFileSync(dbFilePath, 'utf8');
} catch (error) {
  console.error(`Error reading file: ${error.message}`);
  process.exit(1);
}

// Look for the pattern where we need to insert our new code
// We'll look for the end of the existing table creation and before the completion log message
const insertPoint = dbFileContent.indexOf("logger.info('Database initialization complete')");

if (insertPoint === -1) {
  console.error("Couldn't find the insertion point in the file.");
  process.exit(1);
}

// Find the start of the line with the completion message
let lineStart = dbFileContent.lastIndexOf('\n', insertPoint);
if (lineStart === -1) lineStart = 0;

// Code to insert
const codeToInsert = `
    // Add the email requests table
    await runAsync(\`
      CREATE TABLE IF NOT EXISTS scan_email_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT NOT NULL,
        url TEXT NOT NULL, 
        requester_email TEXT NOT NULL,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        report_sent BOOLEAN DEFAULT 0,
        report_sent_at TIMESTAMP
      )
    \`);
    
    // Add indexes for the email table
    await runAsync(\`
      CREATE INDEX IF NOT EXISTS idx_scan_email_requests_scan_id ON scan_email_requests(scan_id)
    \`);
    
    await runAsync(\`
      CREATE INDEX IF NOT EXISTS idx_scan_email_requests_report_sent ON scan_email_requests(report_sent)
    \`);
`;

// Create the updated content
const updatedContent = 
  dbFileContent.substring(0, lineStart) + 
  codeToInsert + 
  dbFileContent.substring(lineStart);

// Backup the original file
const backupPath = `${dbFilePath}.backup-${Date.now()}`;
console.log(`Creating backup at ${backupPath}...`);
fs.writeFileSync(backupPath, dbFileContent);

// Write the updated file
console.log(`Updating ${dbFilePath}...`);
fs.writeFileSync(dbFilePath, updatedContent);

console.log('Update complete! The email table will be created when your application starts.');
console.log(`If you need to restore the original file, use the backup at: ${backupPath}`);
