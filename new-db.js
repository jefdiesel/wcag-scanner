/**
 * Update database schema to latest version
 * @returns {Promise<boolean>} True if update successful
 */
async function updateDatabaseSchema() {
  try {
    logger.info('🔄 Running database schema update...');
    
    // Check if error_message column exists in scan_results
    const scanResultsColumns = await allAsync("PRAGMA table_info(scan_results)");
    const hasErrorMessage = scanResultsColumns.some(col => col.name === 'error_message');
    
    if (!hasErrorMessage) {
      logger.info('➕ Adding error_message column to scan_results table');
      await runAsync('ALTER TABLE scan_results ADD COLUMN error_message TEXT');
      logger.info('✅ Added error_message column to scan_results table');
    } else {
      logger.info('✓ error_message column already exists in scan_results table');
    }
    
    // Add any future schema updates here
    // For example, if you need to add another column in the future:
    // const hasNewColumn = scanResultsColumns.some(col => col.name === 'new_column_name');
    // if (!hasNewColumn) {
    //   await runAsync('ALTER TABLE scan_results ADD COLUMN new_column_name TEXT');
    // }
    
    // Verify indexes exist
    const indexes = await allAsync("SELECT name FROM sqlite_master WHERE type='index'");
    const indexNames = indexes.map(index => index.name);
    
    const requiredIndexes = [
      { name: 'idx_scan_results_scan_id', sql: 'CREATE INDEX idx_scan_results_scan_id ON scan_results(scan_id)' },
      { name: 'idx_scan_results_url', sql: 'CREATE INDEX idx_scan_results_url ON scan_results(url)' },
      { name: 'idx_scan_email_requests_scan_id', sql: 'CREATE INDEX idx_scan_email_requests_scan_id ON scan_email_requests(scan_id)' }
    ];
    
    for (const index of requiredIndexes) {
      if (!indexNames.includes(index.name)) {
        logger.info(`➕ Creating missing index: ${index.name}`);
        await runAsync(index.sql);
        logger.info(`✅ Created index: ${index.name}`);
      }
    }
    
    // Update database version if you want to track schema versions
    await runAsync(`
      CREATE TABLE IF NOT EXISTS db_version (
        version INTEGER PRIMARY KEY,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Get current version
    const versionRow = await getAsync('SELECT MAX(version) as current_version FROM db_version');
    const currentVersion = versionRow && versionRow.current_version ? versionRow.current_version : 0;
    const newVersion = currentVersion + 1;
    
    // Insert new version
    await runAsync('INSERT INTO db_version (version) VALUES (?)', [newVersion]);
    logger.info(`📊 Database schema updated to version ${newVersion}`);
    
    return true;
  } catch (error) {
    logger.error(`❌ Database schema update error: ${error.message}`);
    logger.error(error.stack);
    return false;
  }
}

// Modify initDatabase to call the update function
async function initDatabase() {
  try {
    logger.info('Initializing database schema...');
    
    const dbPath = path.join(__dirname, '..', 'data', 'wcag_scanner.db');
    logger.info(`Connected to SQLite database at ${dbPath}`);
    
    // Create tables if they don't exist
    await runAsync(`
      CREATE TABLE IF NOT EXISTS queue (
        url TEXT PRIMARY KEY,
        max_pages INTEGER DEFAULT 100,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await runAsync(`
      CREATE TABLE IF NOT EXISTS scan_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT,
        url TEXT,
        violations TEXT,
        links TEXT,
        status TEXT,
        scanned_at TIMESTAMP,
        report_pdf TEXT,
        report_csv TEXT,
        error_message TEXT
      )
    `);
    
    await runAsync(`
      CREATE TABLE IF NOT EXISTS scan_email_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scan_id TEXT,
        url TEXT,
        requester_email TEXT,
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        report_sent INTEGER DEFAULT 0,
        report_sent_at TIMESTAMP,
        processing_error TEXT
      )
    `);
    
    // Create indexes for faster lookups
    await runAsync('CREATE INDEX IF NOT EXISTS idx_scan_results_scan_id ON scan_results(scan_id)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_scan_results_url ON scan_results(url)');
    await runAsync('CREATE INDEX IF NOT EXISTS idx_scan_email_requests_scan_id ON scan_email_requests(scan_id)');
    
    // Run schema updates for any changes needed after initial creation
    await updateDatabaseSchema();
    
    logger.info('Database initialization complete');
    return true;
  } catch (error) {
    logger.error(`Database initialization error: ${error.message}`);
    throw error;
  }
}

module.exports = { 
  initDatabase,
  updateDatabaseSchema,
  getAsync,
  allAsync,
  runAsync 
};
