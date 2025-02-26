const logger = require('../utils/logger');

/**
 * Global error handling middleware
 */
function errorHandler(err, req, res, next) {
  // Log the error
  logger.error(`Unhandled error: ${err.stack}`);
  
  // Determine response format based on request
  const isJsonRequest = req.headers['accept'] === 'application/json' || 
                        req.headers['content-type'] === 'application/json';
  
  // Set status code (default to 500 if not specified)
  const statusCode = err.statusCode || 500;
  
  if (isJsonRequest) {
    // JSON response for API requests
    return res.status(statusCode).json({
      error: err.message || 'Internal Server Error',
      status: statusCode
    });
  }
  
  // HTML response for web requests
  if (statusCode === 404) {
    return res.status(404).render('error', { 
      title: 'Page Not Found',
      message: 'The page you requested could not be found.',
      statusCode: 404
    });
  }
  
  // Default error page
  res.status(statusCode).render('error', { 
    title: 'Error',
    message: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred. Please try again later.'
      : err.message || 'Internal Server Error',
    statusCode
  });
}

module.exports = errorHandler;
