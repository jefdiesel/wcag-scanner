/**
 * URL filtering utility
 * Provides functions for filtering and validating URLs
 */

const logger = require('./logger');

/**
 * Check if a URL should be allowed for scanning
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL should be allowed, false if it should be filtered out
 */
function shouldAllowUrl(url) {
  try {
    // Check if it's a valid URL string
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    // Check if it's in a valid format
    try {
      new URL(url);
    } catch (e) {
      return false;
    }
    
    // Check for protocol (should be http or https)
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return false;
    }
    
    // Check for local URLs
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return false;
    }
    
    // Check for common file extensions we don't want to scan
    const fileExtRegex = /\.(jpg|jpeg|png|gif|pdf|doc|docx|xls|xlsx|zip|rar|css|js|svg|woff|woff2|ttf|eot)$/i;
    if (url.match(fileExtRegex)) {
      return false;
    }
    
    // Check for common patterns that might indicate a report URL
    if (url.includes('/reports/') || url.includes('report_') || 
        url.includes('.pdf') || url.includes('.csv')) {
      return false;
    }
    
    // Check for suspiciously long URLs (likely garbage)
    if (url.length > 500) {
      return false;
    }
    
    // Otherwise, allow it
    return true;
  } catch (error) {
    logger.error(`Error in shouldAllowUrl: ${error.message}`);
    return false;
  }
}

/**
 * Check if URL is valid for crawling (more restrictive than shouldAllowUrl)
 * @param {string} url - URL to check
 * @param {string} baseUrl - Base URL of the current crawl
 * @returns {boolean} True if URL should be crawled
 */
function isValidCrawlUrl(url, baseUrl) {
  try {
    // First apply basic URL filtering
    if (!shouldAllowUrl(url)) {
      return false;
    }
    
    // For crawling, only allow same-domain URLs
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);
    
    // Must be from same hostname
    if (urlObj.hostname !== baseUrlObj.hostname) {
      return false;
    }
    
    return true;
  } catch (error) {
    logger.error(`Error in isValidCrawlUrl: ${error.message}`);
    return false;
  }
}

module.exports = {
  shouldAllowUrl,
  isValidCrawlUrl
};
