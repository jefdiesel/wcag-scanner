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
  // Normalize the base URL
  baseUrl = normalizeUrl(baseUrl);
  
  const visitedUrls = new Set();
  const crawlQueue = [{ url: baseUrl, depth: currentDepth }];
  let pagesScanned = 0;
  const allFoundUrls = new Set(); // Track all discovered URLs
  
  logger.info(`Starting crawl of ${baseUrl} with max ${maxPages} pages, max depth ${maxDepth}`);

  // Function to log current scanning status
  const logScanStatus = () => {
    logger.info(`Scan status for ${baseUrl}: Found ${allFoundUrls.size + crawlQueue.length} URLs, ${crawlQueue.length} in queue, ${pagesScanned}/${maxPages} pages scanned`);
  };

  // Initial status log
  logScanStatus();

  while (crawlQueue.length > 0 && pagesScanned < maxPages) {
    const { url, depth } = crawlQueue.shift();
    
    // Skip if already visited or exceeded max depth
    if (visitedUrls.has(url) || depth > maxDepth) continue;
    
    visitedUrls.add(url);
    
    try {
      logger.info(`Scanning page ${pagesScanned + 1}/${maxPages} (${crawlQueue.length} in queue): ${url}`);
      
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

      // Test accessibility with enhanced tests
      const results = await testAccessibility(page, url);
      
      // Extract links if we're not at max depth
      let links = [];
      if (depth < maxDepth) {
        // Use a more controlled method to extract links
        links = await page.$$eval('a[href]', (anchors, baseUrl) => {
          return anchors.map(a => {
            try {
              // Get the href attribute
              let href = a.getAttribute('href');
              
              // Skip if empty or javascript: or mailto: links
              if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || 
                  href.startsWith('#') || href === '/') {
                return null;
              }
              
              // Convert to absolute URL
              let absoluteUrl;
              try {
                absoluteUrl = new URL(href, baseUrl).href;
              } catch (e) {
                return null;
              }
              
              // Very strict filtering - only allow clean URLs
              try {
                const urlObj = new URL(absoluteUrl);
                
                // Must be http or https
                if (!urlObj.protocol.startsWith('http')) {
                  return null;
                }
                
                // Must be same origin
                if (urlObj.origin !== baseUrl) {
                  return null;
                }
                
                // No file extensions we don't want to crawl
                if (urlObj.pathname.match(/\.(jpg|jpeg|png|gif|css|js|json|xml|zip|doc|xls|mp3|mp4|avi|mov|woff|woff2|ttf|svg)$/i)) {
                  return null;
                }
                
                // Don't allow URLs with periods in the path (except domain and file extension)
                const pathParts = urlObj.pathname.split('/');
                const lastPart = pathParts[pathParts.length - 1];
                
                // If any path part has suspicious patterns, reject
                if (pathParts.some(part => part.includes('.') && part !== lastPart)) {
                  return null;
                }
                
                // For the last part, be more careful
                if (lastPart && lastPart.includes('.')) {
                  // Allow common web file extensions
                  if (!lastPart.match(/\.(html|php|aspx|jsp|pdf)$/i)) {
                    // For anything else, ensure it's simple
                    if (lastPart.split('.').length > 2) { // More than one period
                      return null;
                    }
                  }
                }
                
                // No fragments
                urlObj.hash = '';
                
                // No query parameters (but convert to clean URL instead of rejecting)
                if (urlObj.search) {
                  return urlObj.origin + urlObj.pathname;
                }
                
                return urlObj.href;
              } catch (e) {
                return null;
              }
            } catch (e) {
              return null;
            }
          }).filter(url => url !== null);
        }, url);
        
        // Further filter the links on the server side
        links = links.filter(link => {
          try {
            // Only keep very clean URLs
            return (
              isValidCrawlUrl(link, baseUrl) && 
              shouldAllowUrl(link)
            );
          } catch (e) {
            return false;
          }
        });
        
        // Normalize all URLs to prevent variants
        links = links.map(link => normalizeUrl(link));
        
        // Remove duplicates
        links = [...new Set(links)];
        
        // Add new links to queue and to found URLs set
        let newLinksCount = 0;
        
        links.forEach(link => {
          if (!allFoundUrls.has(link)) {
            newLinksCount++;
            allFoundUrls.add(link); // Add to all found URLs
          }
          
          // Modify this to use the internal crawlQueue
          if (!visitedUrls.has(link) && !crawlQueue.some(item => item.url === link)) {
            crawlQueue.push({ url: link, depth: depth + 1 });
          }
        });
        
        // Log if we found significant new links
        if (newLinksCount > 0) {
          logger.info(`Found ${newLinksCount} new links on ${url}`);
          // If we've found a lot of new links, log the current status
          if (newLinksCount > 10) {
            logScanStatus();
          }
        }
      }
      
      // Store results in database including violationCounts
      await runAsync(
        'INSERT INTO scan_results (scan_id, url, violations, links, status, scanned_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [
          scanId,
          url,
          JSON.stringify({ 
            violations: results.violations,
            violationCounts: results.violationCounts,
            additionalAnalysis: results.additionalAnalysis
          }),
          JSON.stringify(links),
          pageStatus
        ]
      );
      
      // Close context
      await context.close();
      
      // Update progress with both scanned and found counts, and queue size
      pagesScanned++;
      progressCallback(pagesScanned, allFoundUrls.size, crawlQueue.length);
      
      // Log status periodically
      if (pagesScanned % 5 === 0 || crawlQueue.length % 20 === 0) {
        logScanStatus();
      }
      
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
      progressCallback(pagesScanned, allFoundUrls.size, crawlQueue.length);
    }
  }
  
  // Final log showing complete stats
  logger.info(`Crawl complete for ${baseUrl}: Found ${allFoundUrls.size} total URLs, scanned ${pagesScanned} pages`);
  
  // Update the scan status to completed
  await runAsync(
    'UPDATE scan_results SET status = ? WHERE scan_id = ? AND status IS NULL',
    ['completed', scanId]
  );
}
