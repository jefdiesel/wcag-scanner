/**
 * Utility helper functions
 */
const path = require('path');

/**
 * Sanitize and format URL for folder/file names
 * @param {string} url - URL to sanitize
 * @returns {string} - Sanitized URL safe for file system
 */
function sanitizeUrlForFilename(url) {
  return url
    .replace(/^https?:\/\//, '') // Remove http:// or https://
    .replace(/[^\w.-]/g, '_') // Replace non-word characters with underscores
    .toLowerCase();
}

/**
 * Get the report file paths for a given scan
 * @param {string} url - Original URL
 * @param {string} reportsDir - Reports directory path
 * @returns {Object} - Object with paths for PDF and CSV reports
 */
function getReportPaths(url, reportsDir) {
  const sanitizedUrl = sanitizeUrlForFilename(url);
  const reportDir = path.join(reportsDir, sanitizedUrl);
  
  return {
    reportDir,
    pdfPath: path.join(reportDir, `${sanitizedUrl}.pdf`),
    csvPath: path.join(reportDir, `${sanitizedUrl}.csv`)
  };
}

/**
 * Parse JSON safely with a fallback value
 * @param {string} jsonString - JSON string to parse
 * @param {*} fallback - Fallback value if parsing fails
 * @returns {*} - Parsed object or fallback value
 */
function safeJsonParse(jsonString, fallback) {
  try {
    return jsonString ? JSON.parse(jsonString) : fallback;
  } catch (error) {
    return fallback;
  }
}

/**
 * Generate a random scan ID
 * @returns {string} - Unique scan ID
 */
function generateScanId() {
  return Date.now().toString() + Math.random().toString(36).substring(2, 8);
}

module.exports = {
  sanitizeUrlForFilename,
  getReportPaths,
  safeJsonParse,
  generateScanId
};
