const fs = require('fs');
const path = require('path');
const { runAsync } = require('../db/db');
const logger = require('../utils/logger');

/**
 * Performs WCAG accessibility testing on a page
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} url - URL to test
 * @returns {Promise<Object>} - Test results
 */
async function testAccessibility(page, url) {
  try {
    // Inject axe-core library
    await page.addScriptTag({
      path: require.resolve('axe-core')
    });

    // Run axe-core analysis
    const results = await page.evaluate(async () => {
      return await new Promise((resolve) => {
        window.axe.run(document, {
          reporter: 'v2',
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'best-practice']
          }
        }, (err, results) => {
          if (err) resolve({ error: err.message });
          resolve(results);
        });
      });
    });

    // Create violation counts to be used in the UI
    const violationCounts = {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0
    };

    // Count violations by severity
    if (results.violations && Array.isArray(results.violations)) {
      results.violations.forEach(violation => {
        const count = violation.nodes?.length || 0;
        violationCounts.total += count;
        
        // Map axe impact levels to our severity levels
        switch (violation.impact) {
          case 'critical':
          case 'serious':
            violationCounts.critical += count;
            break;
          case 'moderate':
          case 'minor':
            violationCounts.warning += count;
            break;
          default:
            violationCounts.info += count;
            break;
        }
      });
    }

    // Store the violation counts for easy retrieval
    return {
      url,
      violations: results.violations || [],
      passes: results.passes || [],
      incomplete: results.incomplete || [],
      inapplicable: results.inapplicable || [],
      violationCounts // Add the counts to the result
    };
  } catch (error) {
    logger.error(`Error testing accessibility for ${url}: ${error.message}`);
    return {
      url,
      error: error.message,
      violations: [],
      passes: [],
      incomplete: [],
      inapplicable: [],
      violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
    };
  }
}

/**
 * Crawls a website and tests pages for accessibility
 * @param {string} baseUrl - Starting URL
 * @param {import('playwright').Browser} browser - Playwright browser instance
 * @param {number} maxPages - Maximum number of pages to crawl
 * @param {number} currentDepth - Current crawl depth
 * @param {Function} progressCallback - Callback for reporting progress
 * @param {string} scanId - Unique scan identifier
 * @param {number} maxDepth - Maximum crawl depth
 * @returns {Promise<void>}
 */
async function crawlAndTest(baseUrl, browser, maxPages = 100, currentDepth = 1, progressCallback = () => {}, scanId, maxDepth = 5) {
  const visitedUrls = new Set();
  const queue = [{ url: baseUrl, depth: currentDepth }];
  let pagesScanned = 0;
  const allFoundUrls = new Set(); // Track all discovered URLs
  
  logger.info(`Starting crawl of ${baseUrl} with max ${maxPages} pages, max depth ${maxDepth}`);

  while (queue.length > 0 && pagesScanned < maxPages) {
    const { url, depth } = queue.shift();
    
    // Skip if already visited or exceeded max depth
    if (visitedUrls.has(url) || depth > maxDepth) continue;
    
    visitedUrls.add(url);
    
    try {
      logger.info(`Scanning page ${pagesScanned + 1}/${maxPages}: ${url}`);
      
      // Create new context and page for each URL to avoid state leakage
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36 WCAG-Scanner/1.0'
      });
      
      const page = await context.newPage();
      let pageStatus = null;
      
      // Handle response status
      page.on('response', response => {
        if (response.url() === url) {
          pageStatus = response.status();
        }
      });

      // Set timeout for navigation
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout: 30000 
      }).catch(err => {
        logger.warn(`Navigation timeout or error for ${url}: ${err.message}`);
      });

      // Test accessibility
      const results = await testAccessibility(page, url);
      
      // Extract links if we're not at max depth
      let links = [];
      if (depth < maxDepth) {
        links = await page.evaluate(() => {
          const baseUrl = window.location.origin;
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => {
              try {
                const href = a.href;
                // Construct absolute URL
                if (!href.startsWith('http')) {
                  return new URL(href, baseUrl).href;
                }
                return href;
              } catch (e) {
                return null;
              }
            })
            .filter(url => url && url.startsWith(baseUrl) && !url.includes('#') && !url.match(/\.(jpg|jpeg|png|gif|pdf|zip|doc|xls|ppt|mp3|mp4|avi|mov)$/i));
        });
        
        // Add new links to queue and to found URLs set
        links.forEach(link => {
          allFoundUrls.add(link); // Add to all found URLs
          if (!visitedUrls.has(link)) {
            queue.push({ url: link, depth: depth + 1 });
          }
        });
      }
      
      // Store results in database including violationCounts
      await runAsync(
        'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify({ 
            violations: results.violations,
            violationCounts: results.violationCounts
          }),
          JSON.stringify(links),
          pageStatus
        ]
      );
      
      // Close context
      await context.close();
      
      // Update progress with both scanned and found counts
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size);
      
      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      logger.error(`Error scanning ${url}: ${error.stack}`);
      
      // Store error in database
      await runAsync(
        'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify({ 
            error: error.message,
            violationCounts: { total: 0, critical: 0, warning: 0, info: 0 }
          }),
          JSON.stringify([]),
          500 // Internal Server Error
        ]
      );
      
      // Still count this as a scanned page
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size);
    }
  }
  
  // Update the scan status to completed
  await runAsync(
    'UPDATE scan_results SET status = ? WHERE scan_id = ? AND status IS NULL',
    ['completed', scanId]
  );
  
  logger.info(`Crawl complete: Scanned ${pagesScanned} pages from ${baseUrl}, found ${allFoundUrls.size} total links`);
}

module.exports = {
  testAccessibility,
  crawlAndTest
};
