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

// Import processors with explicit path and debugging
const queueProcessorModule = require('./services/queueProcessor');
const emailProcessorModule = require('./email/emailProcessor');
const reportProcessorModule = require('./email/reportUploader');

logger.debug('🔍 Queue Processor Module:', queueProcessorModule);
logger.debug('🔍 Email Processor Module:', emailProcessorModule);
logger.debug('🔍 Report Processor Module:', reportProcessorModule);

const { startQueueProcessor } = queueProcessorModule;
const { startEmailProcessor } = emailProcessorModule;
const { startReportProcessor } = reportProcessorModule;

// Initialize the app
const app = express();

// Configure app
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure required directories exist
const publicDir = path.join(__dirname, 'public');
const reportsDir = path.join(publicDir, 'reports');
const dataDir = path.join(__dirname, 'data');

[publicDir, reportsDir, dataDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info(`Created directory: ${dir}`);
  }
});

// Register routes - Make sure paths match what's being used in the templates
app.use('/', indexRoutes);
app.use('/scan', scanRoutes);  // This will handle /scan/submit and /scan/progress
app.use('/queue', queueRoutes); // This will handle /queue/add and other queue routes
app.use('/reports', reportsRoutes);

// Error handling middleware
app.use(errorHandler);

// Define a catch-all route for handling 404 errors
app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.url}`);
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: `The requested page (${req.url}) does not exist.`,
    error: { status: 404 }
  });
});

// Background services tracker
const backgroundServices = {
  queueProcessor: null,
  emailProcessor: null,
  reportProcessor: null
};

// Start the server
const server = app.listen(PORT, async () => {
  try {
    logger.info('🚀 Server startup initiated');
    logger.info(`Server is running on http://localhost:${PORT}`);

    // Initialize database
    await initDatabase();
    logger.info('💾 Database initialized successfully');

    // Start background services
    logger.info('🔧 Starting background services...');

    try {
      // Start queue processor
      backgroundServices.queueProcessor = await startQueueProcessor()
        .catch(err => {
          logger.error(`❌ Queue processor failed to start: ${err.message}`);
          throw err;
        });
      logger.info('✅ Queue processor started successfully');

      // Start email processor
      logger.info('📧 Attempting to start email processor...');
      logger.debug('🔍 startEmailProcessor type:', typeof startEmailProcessor);
      backgroundServices.emailProcessor = await startEmailProcessor()
        .catch(err => {
          logger.error(`❌ Email processor failed to start: ${err.message}`);
          logger.error(`🔍 Full error details: ${err.stack}`);
          throw err;
        });
      logger.info('✅ Email processor started successfully');

      // Start report processor
      backgroundServices.reportProcessor = await startReportProcessor()
        .catch(err => {
          logger.error(`❌ Report processor failed to start: ${err.message}`);
          throw err;
        });
      logger.info('✅ Report processor started successfully');

      logger.info('✅ All background services started successfully');
    } catch (serviceError) {
      logger.error(`❌ Failed to start one or more background services: ${serviceError.message}`);
      
      // Attempt to clean up any started services
      Object.entries(backgroundServices).forEach(([name, service]) => {
        if (service) {
          try {
            clearInterval(service);
            logger.info(`Stopped ${name} background service`);
          } catch (cleanupError) {
            logger.error(`Error stopping ${name} service: ${cleanupError.message}`);
          }
        }
      });

      // Don't exit process - continue running with just the web server
      logger.warn('⚠️ Continuing with web server only - some features may be limited');
    }
  } catch (initError) {
    logger.error(`❌ Initialization error: ${initError.message}`);
    process.exit(1);
  }
});

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  logger.info(`🛑 Received ${signal}. Starting graceful shutdown...`);

  // Stop background services
  Object.entries(backgroundServices).forEach(([name, service]) => {
    if (service) {
      try {
        clearInterval(service);
        logger.info(`Stopped ${name} background service`);
      } catch (error) {
        logger.error(`Error stopping ${name} service: ${error.message}`);
      }
    }
  });

  // Close the server
  server.close(() => {
    logger.info('🔒 HTTP server closed');
    process.exit(0);
  });

  // Force close server after 10 seconds
  setTimeout(() => {
    logger.error('🚨 Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

// Signal handlers for graceful shutdown
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => gracefulShutdown(signal));
});

// Unhandled error handling
process.on('uncaughtException', (error) => {
  logger.error(`🚨 Uncaught Exception: ${error.message}`);
  logger.error(error.stack);
  
  try {
    gracefulShutdown('UNCAUGHT_EXCEPTION');
  } catch (shutdownError) {
    logger.error(`Error during shutdown: ${shutdownError.message}`);
    process.exit(1);
  }
});

// Unhandled promise rejection handling
process.on('unhandledRejection', (reason, promise) => {
  logger.error('🚨 Unhandled Rejection at:', promise, 'reason:', reason);
  
  try {
    gracefulShutdown('UNHANDLED_REJECTION');
  } catch (shutdownError) {
    logger.error(`Error during shutdown: ${shutdownError.message}`);
    process.exit(1);
  }
});

module.exports = app;
