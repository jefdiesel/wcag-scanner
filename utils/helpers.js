/**
 * Normalize a URL to prevent duplication of similar URLs
 * @param {string} url - URL to normalize
 * @returns {string} - Normalized URL
 */
function normalizeUrl(url) {
  try {
    // Create URL object to parse the URL
    const urlObj = new URL(url);
    
    // Convert to lowercase (domains are case-insensitive)
    urlObj.hostname = urlObj.hostname.toLowerCase();
    
    // Remove trailing slash if present
    if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    
    // Remove hash fragments
    urlObj.hash = '';
    
    // Return the normalized URL
    return urlObj.toString();
  } catch (error) {
    // If URL parsing fails, return the original URL
    return url;
  }
}

/**
 * Sanitize a URL for use in filenames
 * @param {string} url - URL to sanitize
 * @returns {string} - Sanitized string safe for filenames
 */
function sanitizeUrlForFilename(url) {
  try {
    // Create URL object to parse the URL
    const urlObj = new URL(url);
    
    // Create a sanitized version based on hostname and pathname
    let sanitized = urlObj.hostname;
    
    // Add pathname if it's not just "/"
    if (urlObj.pathname && urlObj.pathname !== '/') {
      // Replace sequences of non-alphanumeric characters with single hyphens
      const sanitizedPath = urlObj.pathname.replace(/[^a-z0-9]/gi, '-').replace(/-+/g, '-');
      sanitized += sanitizedPath;
    }
    
    // Ensure no leading or trailing hyphens
    sanitized = sanitized.replace(/^-+|-+$/g, '');
    
    // Limit length to avoid excessively long filenames
    if (sanitized.length > 100) {
      sanitized = sanitized.substring(0, 100);
    }
    
    return sanitized;
  } catch (error) {
    // If URL parsing fails, create a unique timestamp-based name
    return `url-${Date.now()}`;
  }
}

/**
 * Check if a URL is valid for crawling based on our rules
 * @param {string} url - URL to check
 * @param {string} baseUrl - Base URL for same-origin check
 * @returns {boolean} - True if URL passes all checks
 */
function isValidCrawlUrl(url, baseUrl) {
  try {
    // Create URL objects for both URLs
    const urlObj = new URL(url);
    const baseUrlObj = new URL(baseUrl);
    
    // Must be http or https
    if (!urlObj.protocol.startsWith('http')) {
      return false;
    }
    
    // Must be same origin (host)
    if (urlObj.host !== baseUrlObj.host) {
      return false;
    }
    
    // No file extensions we don't want to crawl
    if (urlObj.pathname.match(/\.(jpg|jpeg|png|gif|css|js|json|xml|zip|pdf|doc|xls|mp3|mp4|avi|mov|woff|woff2|ttf|svg)$/i)) {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

module.exports = {
  normalizeUrl,
  sanitizeUrlForFilename,
  isValidCrawlUrl
};
