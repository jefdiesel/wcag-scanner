const express = require('express');
const path = require('path');
const fs = require('fs');
const { initDatabase } = require('./db/db');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { PORT } = require('./config/config');

// Import route handlers
const indexRoutes = require('./routes/index');
const scanRoutes = require('./routes/scan');
const queueRoutes = require('./routes/queue');
const reportsRoutes = require('./routes/reports');

// Import queue processor
const { startQueueProcessor } = require('./services/queueProcessor');

// Import email processors
const { startEmailProcessor } = require('./email/emailProcessor');
const { startReportProcessor } = require('./email/reportUploader');

// Initialize the app
const app = express();

// Configure app
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure public directory and reports directory exist
const publicDir = path.join(__dirname, 'public');
const reportsDir = path.join(publicDir, 'reports');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);
if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);

// Register routes
app.use('/', indexRoutes);
app.use('/scan', scanRoutes);
app.use('/queue', queueRoutes);
app.use('/reports', reportsRoutes);

// Error handling middleware
app.use(errorHandler);

// Start the server
app.listen(PORT, async () => {
  logger.info(`Server running at http://localhost:${PORT}`);
  
  // Initialize database
  await initDatabase();
  
  // Start the scan queue processor in the background
  startQueueProcessor().catch(err => 
    logger.error(`Scan queue processor failed: ${err.stack}`)
  );
  
  // Start the email processor service (watches for incoming emails)
  startEmailProcessor().catch(err => 
    logger.error(`Email processor failed: ${err.stack}`)
  );
  
  // Start the report processor service (uploads reports to R2)
  startReportProcessor().catch(err => 
    logger.error(`Report processor failed: ${err.stack}`)
  );
  
  logger.info('All services started successfully');
});

module.exports = app;
