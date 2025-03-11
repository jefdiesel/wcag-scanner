// cleanup-queue.js
require('dotenv').config();
const { runAsync, getAsync, allAsync } = require('./db/db');
const logger = require('./utils/logger');

/**
 * Filter for URLs to prevent scanning local report URLs and breaking recursive loops
 */
function shouldAllowUrl(url) {
  try {
    // Check if it's a local report URL
    if (url.includes('/reports/') || url.includes('localhost')) {
      return false;
    }
    
    // Check for common report file extensions
    if (url.endsWith('.pdf') || url.endsWith('.csv') || 
        url.includes('.pdf') || url.includes('.csv')) {
      return false;
    }
    
    // Check for URLs that are responses to email scan requests
    // These often have text like "Scan", "Thank", or "Error:" appended
    const scanKeywords = ['Scan', 'Thank', 'Error:', 'pdf-', 'csv-'];
    if (scanKeywords.some(keyword => url.includes(keyword))) {
      return false;
    }
    
    // Otherwise, let the URL through
    return true;
  } catch (error) {
    // If we can't parse the URL, better to filter it out
    return false;
  }
}

async function cleanupQueue() {
  try {
    console.log('Starting queue cleanup...');
    
    // Get all URLs in the queue
    const queueItems = await allAsync('SELECT url FROM queue');
    
    if (!queueItems || queueItems.length === 0) {
      console.log('Queue is empty, nothing to clean up.');
      return;
    }
    
    console.log(`Found ${queueItems.length} items in queue.`);
    
    let itemsRemoved = 0;
    
    // Check each URL and remove if it shouldn't be allowed
    for (const item of queueItems) {
      if (!shouldAllowUrl(item.url)) {
        await runAsync('DELETE FROM queue WHERE url = ?', [item.url]);
        console.log(`Removed invalid URL from queue: ${item.url}`);
        itemsRemoved++;
      }
    }
    
    console.log(`Removed ${itemsRemoved} invalid URLs from queue.`);
    console.log('Remaining items in queue:', queueItems.length - itemsRemoved);
    
    // Now clean up any completed scan results with invalid URLs
    console.log('Cleaning up scan_results for invalid URLs...');
    
    const scanResults = await allAsync('SELECT scan_id, url FROM scan_results WHERE status = "completed"');
    let resultsRemoved = 0;
    
    for (const result of scanResults) {
      if (!shouldAllowUrl(result.url)) {
        // Don't actually delete the records, just mark them as special
        await runAsync(
          'UPDATE scan_results SET status = "filtered" WHERE scan_id = ?', 
          [result.scan_id]
        );
        console.log(`Marked invalid URL in scan_results: ${result.url}`);
        resultsRemoved++;
      }
    }
    
    console.log(`Marked ${resultsRemoved} invalid URLs in scan_results.`);
    
    console.log('Queue cleanup completed successfully!');
  } catch (error) {
    console.error('Error during queue cleanup:', error);
  }
}

// Run the cleanup function
cleanupQueue()
  .then(() => {
    console.log('Script completed.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
