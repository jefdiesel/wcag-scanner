// emergency-queue-cleaner.js
require('dotenv').config();
const { runAsync, allAsync } = require('./db/db');
const logger = require('./utils/logger');

// Run the emergency cleanup
async function emergencyCleanup() {
  console.log("🚨 Starting emergency queue cleanup");
  
  try {
    // Get all URLs in the queue
    const urls = await allAsync("SELECT url FROM queue");
    
    if (!urls || urls.length === 0) {
      console.log("Queue is empty, nothing to clean up");
      return;
    }
    
    console.log(`Found ${urls.length} items in queue`);
    
    // 1. First remove all URLs that contain problematic patterns
    const problematicPatterns = [
      'localhost',      // Local URLs
      '/reports/',      // Report URLs
      '.pdf',           // PDF files
      '.csv',           // CSV files
      '.The',           // The weird .The pattern
      '...',            // Multiple periods
      '.Scan',          // Scan suffix
      '.Thank',         // Thank suffix
      '.Error',         // Error suffix
      '%20',            // URLs with spaces encoded
    ];
    
    let deletedCount = 0;
    
    for (const { url } of urls) {
      // Check if URL contains any problematic pattern
      const hasProblematicPattern = problematicPatterns.some(pattern => url.includes(pattern));
      
      // Check if URL has periods at end or multiple periods
      const hasPeriodsAtEnd = url.endsWith('.') || url.match(/\.{2,}/);
      
      // Check for excessive URL length
      const isTooLong = url.length > 300;
      
      if (hasProblematicPattern || hasPeriodsAtEnd || isTooLong) {
        await runAsync("DELETE FROM queue WHERE url = ?", [url]);
        console.log(`Deleted problematic URL: ${url}`);
        deletedCount++;
      }
    }
    
    console.log(`Deleted ${deletedCount} problematic URLs from queue`);
    
    // 2. Now find and deduplicate URLs based on base URL
    console.log("Looking for duplicated base URLs...");
    
    // Get remaining URLs
    const remainingUrls = await allAsync("SELECT url FROM queue");
    
    if (!remainingUrls || remainingUrls.length === 0) {
      console.log("No URLs left in queue after cleanup");
      return;
    }
    
    console.log(`${remainingUrls.length} URLs remain in queue`);
    
    // Map to track domains and their canonical URLs
    const domainMap = new Map();
    
    // Function to get domain from URL
    const getDomain = (urlString) => {
      try {
        const url = new URL(urlString);
        return url.hostname;
      } catch (e) {
        return null;
      }
    };
    
    // Find duplicates by domain
    for (const { url } of remainingUrls) {
      const domain = getDomain(url);
      if (!domain) continue;
      
      // Keep the shortest URL for each domain
      if (!domainMap.has(domain) || url.length < domainMap.get(domain).length) {
        domainMap.set(domain, url);
      }
    }
    
    // Delete all URLs except the chosen canonical one for each domain
    let deduplicatedCount = 0;
    
    for (const { url } of remainingUrls) {
      const domain = getDomain(url);
      if (!domain) continue;
      
      const canonicalUrl = domainMap.get(domain);
      
      // If this URL is not the canonical one, delete it
      if (url !== canonicalUrl) {
        await runAsync("DELETE FROM queue WHERE url = ?", [url]);
        console.log(`Removed duplicate URL for domain ${domain}: ${url}`);
        deduplicatedCount++;
      }
    }
    
    console.log(`Removed ${deduplicatedCount} duplicate URLs, keeping one per domain`);
    
    // Final count
    const finalUrls = await allAsync("SELECT COUNT(*) as count FROM queue");
    console.log(`Final queue count: ${finalUrls[0].count} URLs`);
    
    console.log("✅ Emergency cleanup completed successfully");
  } catch (error) {
    console.error("❌ Error during emergency cleanup:", error);
  }
}

// Run the cleanup and exit
emergencyCleanup()
  .then(() => {
    console.log("Emergency cleanup finished");
    process.exit(0);
  })
  .catch(error => {
    console.error("Uncaught error:", error);
    process.exit(1);
  });
