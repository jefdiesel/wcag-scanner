// add-missing-column.js
require('dotenv').config();
const { runAsync } = require('./db/db');
const logger = require('./utils/logger');

async function addMissingColumn() {
  try {
    logger.info('Adding missing processing_error column...');
    
    await runAsync(`
      ALTER TABLE scan_email_requests 
      ADD COLUMN processing_error TEXT DEFAULT NULL
    `);
    
    logger.info('Successfully added processing_error column to scan_email_requests table');
    return true;
  } catch (error) {
    logger.error(`Error adding column: ${error.message}`);
    return false;
  }
}

// Run the function
addMissingColumn()
  .then((success) => {
    if (success) {
      logger.info('Database update completed successfully!');
    } else {
      logger.error('Database update failed!');
    }
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`Unexpected error: ${error.message}`);
    process.exit(1);
  });
