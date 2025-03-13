/**
 * Main function to crawl and test a website
 * @param {string} startUrl - URL to start crawling from
 * @param {object} browser - Playwright browser instance
 * @param {number} maxPages - Maximum number of pages to crawl (default: 100)
 * @param {number} maxDepth - Maximum depth for crawling (default: 5)
 * @param {function} progressCallback - Callback for progress updates
 * @param {string} scanId - Unique identifier for this scan
 * @param {number} waitTime - Time to wait for page load in seconds (default: 5)
 * @returns {Promise<void>}
 */
async function crawlAndTest(
  startUrl,
  browser,
  maxPages = 100,
  maxDepth = 5,
  progressCallback = () => {},
  scanId = Date.now().toString(),
  waitTime = 5
) {
  // Reset the crawled URLs set for this scan
  const crawledUrls = new Set();
  const allFoundUrls = new Set([startUrl]); // Track all discovered URLs
  
  logger.info(`Starting scan ${scanId} for ${startUrl} (max: ${maxPages} pages, depth: ${maxDepth})`);
  
  // Initialize counters
  let pagesCrawled = 0;
  
  // Create a queue just for this crawl session
  const queue = [{ url: startUrl, depth: 0 }];
  
  // Function to log scan status periodically
  const logScanStatus = () => {
    logger.info(`📊 Scan status for ${scanId}: Found ${allFoundUrls.size} URLs, ${queue.length} in queue, ${pagesCrawled}/${maxPages} pages scanned`);
  };
  
  // Initial status log
  logScanStatus();
  
  // Process queue until empty or max pages reached
  while (queue.length > 0 && pagesCrawled < maxPages) {
    const { url, depth } = queue.shift();
    
    // Skip if we've already crawled this URL or if it exceeds max depth
    if (crawledUrls.has(url) || depth > maxDepth) {
      continue;
    }
    
    try {
      logger.debug(`Crawling URL (${pagesCrawled + 1}/${maxPages}): ${url} (depth: ${depth})`);
      
      // Test the page for accessibility issues
      const { violations, links } = await testPage(url, browser, waitTime);
      
      // Add the URL to the crawled set
      crawledUrls.add(url);
      pagesCrawled++;
      
      // Report progress with more details
      progressCallback(pagesCrawled, allFoundUrls.size, queue.length);
      
      // Store test results in the database
      await saveResults(url, violations, links, scanId);
      
      // Process the links
      if (Array.isArray(links) && links.length > 0) {
        logger.debug(`Found ${links.length} links on ${url}`);
        
        // Randomize links order to avoid pattern detection
        const shuffledLinks = [...links].sort(() => Math.random() - 0.5);
        
        // Count new links added for logging
        let newLinksCount = 0;
        
        // Add new links to the queue (but don't exceed max pages)
        for (const link of shuffledLinks) {
          // Make sure link is a string and not already discovered
          if (typeof link === 'string' && !allFoundUrls.has(link)) {
            allFoundUrls.add(link);
            newLinksCount++;
            
            // Only add to our local queue if we haven't reached the max pages yet
            if (pagesCrawled + queue.length < maxPages) {
              queue.push({ url: link, depth: depth + 1 });
            }
          }
        }
        
        // Log if we found significant new links
        if (newLinksCount > 0) {
          logger.debug(`Added ${newLinksCount} new links from ${url} to queue`);
          
          // Log status if we found many new links
          if (newLinksCount > 10) {
            logScanStatus();
          }
        }
      } else {
        logger.debug(`No valid links found on ${url}`);
      }
      
      // Log status periodically
      if (pagesCrawled % 5 === 0 || queue.length % 20 === 0) {
        logScanStatus();
      }
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error(`Error scanning ${url}: ${error.message}`);
      
      // Log the stack trace for debugging
      logger.debug(`Stack trace for error: ${error.stack}`);
      
      // Store error in database
      await saveError(url, error, scanId);
      
      // Still count this as a crawled page
      crawledUrls.add(url);
      pagesCrawled++;
      
      // Report progress
      progressCallback(pagesCrawled, allFoundUrls.size, queue.length);
    }
  }
  
  // Update with total pages found
  await updateScanWithTotalPages(scanId, allFoundUrls.size);
  
  // Final log showing complete stats
  logger.info(`Scan ${scanId} completed. Crawled: ${pagesCrawled} pages, Found: ${allFoundUrls.size} pages`);
  
  // Update scan status to completed in the database
  try {
    await runAsync(
      'UPDATE scan_results SET status = ? WHERE scan_id = ? AND (status IS NULL OR status != ?)',
      ['completed', scanId, 'completed']
    );
    logger.info(`Updated database: Scan ${scanId} marked as completed`);
  } catch (updateError) {
    logger.error(`Error updating scan status: ${updateError.message}`);
  }
}/**
 * WCAG Accessibility Scanner Service
 * 
 * This module provides functionality to crawl websites and test them for WCAG accessibility issues.
 * Key features:
 * - Crawls websites up to a specified limit
 * - Tests each page for accessibility using axe-core
 * - Stores results in the database
 * - Does NOT add discovered pages to a global queue
 */

const { runAsync, getAsync } = require('../db/db');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const axeCore = require('axe-core');
const logger = require('../utils/logger');
const fs = require('fs');
const path = require('path');

// Set of URLs already crawled (to avoid duplicates)
const crawledUrls = new Set();

/**
 * Main function to crawl and test a website
 * @param {string} startUrl - URL to start crawling from
 * @param {object} browser - Playwright browser instance
 * @param {number} maxPages - Maximum number of pages to crawl (default: 100)
 * @param {number} maxDepth - Maximum depth for crawling (default: 5)
 * @param {function} progressCallback - Callback for progress updates
 * @param {string} scanId - Unique identifier for this scan
 * @param {number} waitTime - Time to wait for page load in seconds (default: 5)
 * @returns {Promise<void>}
 */
async function crawlAndTest(
  startUrl,
  browser,
  maxPages = 100,
  maxDepth = 5,
  progressCallback = () => {},
  scanId = Date.now().toString(),
  waitTime = 5
) {
  // Verify browser is ready
  try {
    const version = await browser.version();
    logger.debug(`Using browser: ${version}`);
  } catch (browserError) {
    logger.error(`Browser not ready: ${browserError.message}`);
    throw new Error('Browser not initialized properly');
  }
  
  // Reset the crawled URLs set for this scan
  crawledUrls.clear();
  
  logger.info(`Starting scan ${scanId} for ${startUrl} (max: ${maxPages} pages, depth: ${maxDepth})`);
  
  // Initialize counters
  let pagesCrawled = 0;
  let totalPagesFound = 1; // Start with 1 for the initial URL
  
  // Create a queue just for this crawl session
  const queue = [{ url: startUrl, depth: 0 }];
  const discoveredUrls = new Set([startUrl]); // Track all discovered URLs
  
  // Initialize a retry counter for access-blocked pages
  let accessBlockedCount = 0;
  const MAX_ACCESS_BLOCKED = 3; // Max number of consecutive blocked pages before giving up
  
  // Process queue until empty or max pages reached
  while (queue.length > 0 && pagesCrawled < maxPages) {
    const { url, depth } = queue.shift();
    
    // Skip if we've already crawled this URL or if it exceeds max depth
    if (crawledUrls.has(url) || depth > maxDepth) {
      continue;
    }
    
    try {
      logger.debug(`Crawling URL (${pagesCrawled + 1}/${maxPages}): ${url} (depth: ${depth})`);
      
      // Test the page for accessibility issues
      const { violations, links } = await testPage(url, browser, waitTime);
      
      // Check if we're getting blocked by the site (no links found)
      if (links.length === 0 && pagesCrawled > 0) {
        accessBlockedCount++;
        logger.warn(`No links found on ${url} - possibly being blocked by the site (count: ${accessBlockedCount}/${MAX_ACCESS_BLOCKED})`);
        
        if (accessBlockedCount >= MAX_ACCESS_BLOCKED) {
          logger.error(`Too many pages with no links (${MAX_ACCESS_BLOCKED}). Site is likely blocking our scanner. Ending scan early.`);
          break;
        }
      } else {
        // Reset counter if we find links
        accessBlockedCount = 0;
      }
      
      // Add the URL to the crawled set
      crawledUrls.add(url);
      pagesCrawled++;
      
      // Report progress with more details
      progressCallback(pagesCrawled, totalPagesFound, queue.length);
      
      // Store test results in the database
      await saveResults(url, violations, links, scanId);
      
      // Process the links
      if (Array.isArray(links) && links.length > 0) {
        logger.debug(`Found ${links.length} links on ${url}`);
        
        // Randomize links order to make crawling less predictable (avoid pattern detection)
        const shuffledLinks = [...links].sort(() => Math.random() - 0.5);
        
        // Add new links to the queue (but don't exceed max pages)
        for (const link of shuffledLinks) {
          // Make sure link is a string and not already discovered
          if (typeof link === 'string' && !discoveredUrls.has(link)) {
            discoveredUrls.add(link);
            totalPagesFound++;
            
            // Only add to our local queue if we haven't reached the max pages yet
            if (pagesCrawled + queue.length < maxPages) {
              queue.push({ url: link, depth: depth + 1 });
              
              // Only log if verbose 
              if (process.env.LOG_LEVEL === 'debug') {
                logger.debug(`Added to queue: ${link} (depth: ${depth + 1})`);
              }
            }
          }
        }
      } else {
        logger.debug(`No valid links found on ${url}`);
      }
    } catch (error) {
      logger.error(`Error testing URL ${url}: ${error.message}`);
      
      // Even on error, we count this as a crawled page
      crawledUrls.add(url);
      pagesCrawled++;
      
      // Store error result in database
      await saveError(url, error, scanId);
    }
  }
  
  // Update scan with total pages found
  await updateScanWithTotalPages(scanId, totalPagesFound);
  
  logger.info(`Scan ${scanId} completed. Crawled: ${pagesCrawled} pages, Found: ${totalPagesFound} pages`);
}

/**
 * Test a page for accessibility issues and extract links
 * @param {string} url - URL to test
 * @param {object} browser - Playwright browser instance
 * @param {number} waitTime - Time to wait for page load in seconds
 * @returns {Promise<Object>} - Test results with violations and links
 */
async function testPage(url, browser, waitTime) {
  // Create a more browser-like context to avoid bot detection
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    httpCredentials: process.env.HTTP_AUTH_USERNAME ? {
      username: process.env.HTTP_AUTH_USERNAME,
      password: process.env.HTTP_AUTH_PASSWORD
    } : undefined
  });
  
  // Add random delay to avoid pattern detection
  const randomDelay = Math.floor(Math.random() * 1000) + 500; // 500-1500ms
  await new Promise(resolve => setTimeout(resolve, randomDelay));
  
  const page = await context.newPage();
  let violations = [];
  let links = [];
  
  try {
    logger.debug(`Starting page load for ${url}`);
    
    // Set extra headers to look more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache'
    });
    
    // Navigate to the page with timeout
    let response;
    try {
      response = await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: waitTime * 1000 
      });
    } catch (navError) {
      logger.warn(`Navigation error for ${url}: ${navError.message}`);
    }
    
    // Check if page load was successful
    if (!response) {
      logger.warn(`No response received for ${url}`);
    } else if (response.status() === 403) {
      logger.warn(`Access forbidden (403) for ${url} - website is blocking our scanner`);
    } else if (response.status() !== 200) {
      logger.warn(`Non-200 status code for ${url}: ${response.status()}`);
    }
    
    // Wait a bit longer for sites with bot protection to load
    try {
      await page.waitForLoadState('load', { timeout: waitTime * 1000 });
      
      // Add a random delay between 1-3 seconds to simulate real user behavior
      await page.waitForTimeout(1000 + Math.random() * 2000);
    } catch (waitError) {
      logger.debug(`Load state timeout for ${url}: ${waitError.message}`);
    }
    
    // Sometimes a 403 page will still load but with a different content
    const pageTitle = await page.title().catch(() => '');
    const pageContent = await page.content().catch(() => '');
    
    if (pageTitle.includes('Forbidden') || 
        pageTitle.includes('Access Denied') || 
        pageContent.includes('403 Forbidden') ||
        pageContent.includes('Access Denied') ||
        pageContent.includes('has been blocked by the security rules')) {
      logger.warn(`Page content indicates access forbidden for ${url}`);
    }
    
    logger.debug(`Attempting to test page ${url}`);
    
    // Only continue with testing if we actually received content
    if (pageContent && pageContent.length > 0) {
      // Inject axe-core
      await page.evaluate(axeSource => {
        try {
          const script = document.createElement('script');
          script.text = axeSource;
          document.head.appendChild(script);
          return true;
        } catch (e) {
          console.error('Error injecting axe-core:', e);
          return false;
        }
      }, axeCore.source).catch(err => {
        logger.warn(`Failed to inject axe-core: ${err.message}`);
      });
      
      // Run accessibility tests
      try {
        const results = await page.evaluate(() => {
          return new Promise((resolve) => {
            if (typeof axe === 'undefined') {
              resolve({ violations: [] });
              return;
            }
            
            axe.run((err, results) => {
              if (err) {
                console.error('Error running axe:', err);
                resolve({ violations: [] });
              } else {
                resolve(results);
              }
            });
          });
        }).catch(err => {
          logger.warn(`Error running accessibility tests: ${err.message}`);
          return { violations: [] };
        });
        
        // Process violations
        violations = results.violations || [];
      } catch (axeError) {
        logger.warn(`Error during axe evaluation: ${axeError.message}`);
      }
      
      // Add impact and categorization
      const violationsData = {
        violations,
        violationCounts: countViolationsBySeverity(violations)
      };
      
      // Extract links even if axe testing fails
      try {
        logger.debug(`Extracting links from ${url}`);
        
        links = await page.evaluate(() => {
          try {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const currentHostname = window.location.hostname;
            const seenUrls = new Set();
            
            return anchors
              .map(a => {
                try {
                  return a.href;
                } catch (e) {
                  return null;
                }
              })
              .filter(href => {
                if (!href) return false;
                
                try {
                  // Filter for only HTTP/HTTPS links from the same domain
                  const url = new URL(href);
                  
                  // Skip if we've already seen this URL
                  if (seenUrls.has(href)) return false;
                  seenUrls.add(href);
                  
                  return (
                    (url.protocol === 'http:' || url.protocol === 'https:') && 
                    url.hostname === currentHostname && 
                    !url.pathname.includes('/cdn-cgi/') &&  // Skip Cloudflare URLs
                    !url.pathname.includes('/wp-content/') && // Skip WordPress direct content
                    !url.pathname.endsWith('.jpg') &&
                    !url.pathname.endsWith('.jpeg') &&
                    !url.pathname.endsWith('.png') &&
                    !url.pathname.endsWith('.gif') &&
                    !url.pathname.endsWith('.pdf') &&
                    !url.pathname.endsWith('.zip') &&
                    !url.pathname.endsWith('.css') &&
                    !url.pathname.endsWith('.js') &&
                    url.pathname !== '/' && // Skip root URL
                    !url.hash  // Skip anchor links (same page)
                  );
                } catch (e) {
                  return false;
                }
              });
          } catch (e) {
            console.error('Error extracting links:', e);
            return [];
          }
        }).catch(err => {
          logger.warn(`Error extracting links: ${err.message}`);
          return [];
        });
      } catch (linkError) {
        logger.warn(`Failed to extract links: ${linkError.message}`);
      }
    }
    
    // Log the number of links found
    logger.debug(`Found ${links ? links.length : 0} valid links on ${url}`);
    
    // Return both violations data and links
    return { 
      violations: { 
        violations: violations || [], 
        violationCounts: countViolationsBySeverity(violations || []) 
      }, 
      links: links || [] 
    };
  } catch (error) {
    logger.error(`Error during page testing for ${url}: ${error.message}`);
    return { 
      violations: { 
        violations: [], 
        violationCounts: { total: 0, critical: 0, warning: 0, info: 0 } 
      }, 
      links: [] 
    };
  } finally {
    // Always close the page and context when done
    try {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
    } catch (closeError) {
      logger.warn(`Error closing browser resources: ${closeError.message}`);
    }
  }
}

/**
 * Count violations by severity level
 * @param {Array} violations - Array of axe-core violations
 * @returns {Object} - Counts by severity
 */
function countViolationsBySeverity(violations) {
  const counts = {
    total: 0,
    critical: 0,
    warning: 0,
    info: 0
  };
  
  violations.forEach(violation => {
    const nodeCount = violation.nodes?.length || 0;
    counts.total += nodeCount;
    
    // Map axe impact levels to our severity levels
    switch (violation.impact) {
      case 'critical':
      case 'serious':
        counts.critical += nodeCount;
        break;
      case 'moderate':
      case 'minor':
        counts.warning += nodeCount;
        break;
      default:
        counts.info += nodeCount;
        break;
    }
  });
  
  return counts;
}

/**
 * Save test results to the database
 * @param {string} url - URL tested
 * @param {Object} violations - Violations data
 * @param {Array} links - Links found on the page
 * @param {string} scanId - Scan ID
 */
async function saveResults(url, violations, links, scanId) {
  try {
    await runAsync(
      'INSERT INTO scan_results (scan_id, url, violations, links, status) VALUES (?, ?, ?, ?, ?)',
      [
        scanId,
        url,
        JSON.stringify(violations),
        JSON.stringify(links),
        'completed'
      ]
    );
    logger.debug(`Saved results for ${url} in scan ${scanId}`);
  } catch (error) {
    logger.error(`Error saving results for ${url}: ${error.message}`);
  }
}

/**
 * Save error information when testing a page fails
 * @param {string} url - URL tested
 * @param {Error} error - Error object
 * @param {string} scanId - Scan ID
 */
async function saveError(url, error, scanId) {
  try {
    const errorData = {
      message: error.message,
      stack: error.stack,
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
    
    await runAsync(
      'INSERT INTO scan_results (scan_id, url, violations, status) VALUES (?, ?, ?, ?)',
      [
        scanId,
        url,
        JSON.stringify(errorData),
        'error'
      ]
    );
    logger.debug(`Saved error for ${url} in scan ${scanId}: ${error.message}`);
  } catch (dbError) {
    logger.error(`Error saving error data for ${url}: ${dbError.message}`);
  }
}

/**
 * Update scan with total number of pages found
 * @param {string} scanId - Scan ID
 * @param {number} totalPagesFound - Total number of pages found during scan
 */
async function updateScanWithTotalPages(scanId, totalPagesFound) {
  try {
    // After looking at the logs, the database doesn't have a metadata column
    // Instead, we'll store this information in the links field of the first row
    
    // Find an existing row to update
    const existingRow = await getAsync(
      'SELECT url, links FROM scan_results WHERE scan_id = ? ORDER BY rowid ASC LIMIT 1', 
      [scanId]
    );
    
    if (existingRow) {
      // Parse existing links if any
      let links = [];
      try {
        links = JSON.parse(existingRow.links || '[]');
      } catch (e) {
        // If parsing fails, start with an empty array
        links = [];
      }
      
      // Create an updated links array with a special entry for total pages
      const updatedLinks = Array.isArray(links) ? links : [];
      
      // Add a comment at the beginning to indicate the total pages found
      // This will be used by the report generator but won't affect normal operation
      if (updatedLinks.length > 0) {
        updatedLinks.push(`// TOTAL_PAGES_FOUND: ${totalPagesFound}`);
      } else {
        updatedLinks.push(`// TOTAL_PAGES_FOUND: ${totalPagesFound}`);
      }
      
      // Update the first row with our enhanced links array
      await runAsync(
        'UPDATE scan_results SET links = ? WHERE scan_id = ? AND url = ?',
        [JSON.stringify(updatedLinks), scanId, existingRow.url]
      );
      
      logger.debug(`Updated scan ${scanId} with total pages found: ${totalPagesFound}`);
    }
  } catch (error) {
    logger.error(`Error updating total pages for scan ${scanId}: ${error.message}`);
  }
}

/**
 * Get scan results for a specific scan ID
 * @param {string} scanId - Scan ID
 * @returns {Promise<Array>} - Array of scan results
 */
async function getScanResults(scanId) {
  try {
    const results = await allAsync(
      'SELECT url, violations, links, status FROM scan_results WHERE scan_id = ?',
      [scanId]
    );
    
    return results.map(row => ({
      url: row.url,
      violations: JSON.parse(row.violations || '{}'),
      links: JSON.parse(row.links || '[]'),
      status: row.status
    }));
  } catch (error) {
    logger.error(`Error fetching scan results for ${scanId}: ${error.message}`);
    return [];
  }
}

module.exports = {
  crawlAndTest,
  testPage,
  getScanResults
};
