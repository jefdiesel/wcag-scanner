const express = require('express');
const router = express.Router();
const path = require('path');
const { allAsync } = require('../db/db');

// Utility function to sanitize URL for filenames
function sanitizeUrlForFilename(url) {
  return url
    .replace(/^https?:\/\//, '') // Remove http:// or https://
    .replace(/[^\w.-]/g, '_') // Replace non-word characters with underscores
    .toLowerCase();
}

// Serve the main page
router.get('/', (req, res) => {
  res.render('index', { results: null, maxPages: 1000, csvPath: null, pdfPath: null });
});

// Serve results by scan ID
router.get('/results/:scanId', async (req, res) => {
  const scanId = req.params.scanId;
  
  try {
    // Get scan results from database
    const rows = await allAsync(
      'SELECT url, violations, links, status FROM scan_results WHERE scan_id = ? ORDER BY scanned_at',
      [scanId]
    );
    
    // Process results
    const results = rows.map(row => {
      try {
        // Parse violations JSON
        const violationsData = JSON.parse(row.violations || '{}');
        let violations = [];
        
        // Handle the different potential formats of violations data
        if (Array.isArray(violationsData)) {
          // If it's an array, use it directly
          violations = violationsData;
        } else if (violationsData.violations && Array.isArray(violationsData.violations)) {
          // If it's an object with a violations array property
          violations = violationsData.violations;
        } else if (typeof violationsData === 'object' && violationsData !== null) {
          // If it's just an object with violations as a property
          violations = Object.values(violationsData).flat().filter(Array.isArray);
        }
        
        // Calculate violation counts if not already present
        let violationCounts = violationsData.violationCounts || { total: 0, critical: 0, warning: 0, info: 0 };
        
        // If violationCounts isn't present, calculate it from the violations
        if (violationCounts.total === 0 && violations.length > 0) {
          violations.forEach(violation => {
            const nodeCount = violation.nodes?.length || 0;
            violationCounts.total += nodeCount;
            
            // Map axe impact levels to our severity levels
            switch (violation.impact) {
              case 'critical':
              case 'serious':
                violationCounts.critical += nodeCount;
                break;
              case 'moderate':
              case 'minor':
                violationCounts.warning += nodeCount;
                break;
              default:
                violationCounts.info += nodeCount;
                break;
            }
          });
        }
        
        return {
          page: row.url,
          violationCounts,
          status: row.status || null
        };
      } catch (error) {
        console.error(`Error processing results for ${row.url}:`, error);
        return {
          page: row.url,
          violationCounts: { total: 0, critical: 0, warning: 0, info: 0 },
          status: row.status || null
        };
      }
    });

    // Get the original URL for this scanId to determine the report folder
    const urlRow = await allAsync(
      'SELECT url FROM scan_results WHERE scan_id = ? LIMIT 1',
      [scanId]
    );
    
    const url = urlRow.length > 0 ? urlRow[0].url : null;

    // Get PDF and CSV report paths
    let pdfUrl = null, csvUrl = null;
    
    if (url) {
      const sanitizedUrl = sanitizeUrlForFilename(url);
      
      // Check if reports exist in database
      const reportRow = await allAsync(
        'SELECT report_pdf, report_csv FROM scan_results WHERE scan_id = ? AND (report_pdf IS NOT NULL OR report_csv IS NOT NULL) LIMIT 1',
        [scanId]
      );
      
      if (reportRow.length > 0) {
        if (reportRow[0].report_pdf) {
          pdfUrl = `/reports/${sanitizedUrl}/${path.basename(reportRow[0].report_pdf)}`;
        }
        
        if (reportRow[0].report_csv) {
          csvUrl = `/reports/${sanitizedUrl}/${path.basename(reportRow[0].report_csv)}`;
        }
      }
    }

    res.render('index', { results, maxPages: 1000, csvPath: csvUrl, pdfPath: pdfUrl });
  } catch (error) {
    console.error(`Error fetching results for scan ${scanId}:`, error);
    res.status(500).send(`Error fetching results: ${error.message}`);
  }
});

// SSE for progress updates with enhanced information
router.get('/progress', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const scanId = req.query.scanId;
  if (!scanId) {
    res.write('data: error\n\n');
    res.end();
    return;
  }

  // Set up interval to check progress
  const checkProgress = setInterval(async () => {
    try {
      // Get count of scanned pages
      const scannedResult = await allAsync(
        'SELECT COUNT(*) as scanned FROM scan_results WHERE scan_id = ?',
        [scanId]
      );
      
      // Get count of found pages (from links column)
      const foundPagesResult = await allAsync(
        'SELECT links FROM scan_results WHERE scan_id = ?',
        [scanId]
      );
      
      // Calculate total unique links found
      let uniqueUrls = new Set();
      foundPagesResult.forEach(row => {
        try {
          const links = JSON.parse(row.links || '[]');
          links.forEach(link => uniqueUrls.add(link));
        } catch (e) {
          // Skip parsing errors
        }
      });
      
      // Get completion status
      const statusResult = await allAsync(
        'SELECT status FROM scan_results WHERE scan_id = ? AND status = ? LIMIT 1',
        [scanId, 'completed']
      );
      
      const scanned = scannedResult[0]?.scanned || 0;
      const found = uniqueUrls.size + scanned; // Include already scanned pages
      const completed = statusResult.length > 0;
      
      // Send progress data as JSON
      res.write(`data: ${JSON.stringify({
        scanned,
        found,
        completed
      })}\n\n`);
      
      // If scan is completed, close the connection
      if (completed) {
        clearInterval(checkProgress);
        res.end();
      }
    } catch (error) {
      console.error(`Progress check failed for scan ${scanId}:`, error);
      res.write(`data: ${JSON.stringify({ error: 'Failed to check progress' })}\n\n`);
      clearInterval(checkProgress);
      res.end();
    }
  }, 1000);

  // Clean up on client disconnect
  req.on('close', () => clearInterval(checkProgress));
});

module.exports = router;
