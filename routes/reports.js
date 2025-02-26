const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { allAsync } = require('../db/db');
const { generatePDF, generateCSV } = require('../services/reportGenerator');
const { sanitizeUrlForFilename } = require('../utils/helpers');
const logger = require('../utils/logger');
const { REPORT_DIR } = require('../config/config');

// Get completed scans data
router.get('/completed-scans', async (req, res) => {
  try {
    // Get completed scans with their report links, limited to recent scans
    const completedScans = await allAsync(
      'SELECT DISTINCT scan_id, url, status, report_pdf, report_csv, MAX(scanned_at) as completed_at ' +
      'FROM scan_results WHERE status = ? GROUP BY scan_id ORDER BY completed_at DESC LIMIT 50',
      ['completed']
    );
    
    // Format completed scans data for API response
    const formattedScans = completedScans.map(row => {
      const sanitizedUrl = sanitizeUrlForFilename(row.url);
      
      return {
        scanId: row.scan_id,
        url: row.url,
        completedAt: row.completed_at,
        pdfUrl: row.report_pdf ? `/reports/${sanitizedUrl}/${path.basename(row.report_pdf)}` : null,
        csvUrl: row.report_csv ? `/reports/${sanitizedUrl}/${path.basename(row.report_csv)}` : null
      };
    });
    
    res.json({ completedScans: formattedScans });
  } catch (error) {
    logger.error(`Error getting completed scans: ${error.stack}`);
    res.status(500).json({ error: error.message });
  }
});

// Generate or regenerate reports for a scan
router.post('/generate/:scanId', async (req, res) => {
  const scanId = req.params.scanId;
  
  try {
    // Get the URL for this scan ID
    const row = await allAsync(
      'SELECT url FROM scan_results WHERE scan_id = ? LIMIT 1',
      [scanId]
    );
    
    if (row.length === 0) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    
    const url = row[0].url;
    
    // Generate PDF and CSV reports
    logger.info(`Manually generating reports for scan ${scanId}`);
    const pdfPath = await generatePDF(scanId, url);
    const csvPath = await generateCSV(scanId, url);
    
    // Update scan_results with report paths
    await runAsync(
      'UPDATE scan_results SET report_pdf = ?, report_csv = ? WHERE scan_id = ?',
      [pdfPath, csvPath, scanId]
    );
    
    // Format URLs for response
    const sanitizedUrl = sanitizeUrlForFilename(url);
    const pdfUrl = pdfPath ? `/reports/${sanitizedUrl}/${path.basename(pdfPath)}` : null;
    const csvUrl = csvPath ? `/reports/${sanitizedUrl}/${path.basename(csvPath)}` : null;
    
    res.json({
      success: true,
      message: 'Reports generated successfully',
      pdfUrl,
      csvUrl
    });
  } catch (error) {
    logger.error(`Error generating reports for scan ${scanId}: ${error.stack}`);
    res.status(500).json({ error: error.message });
  }
});

// Serve PDF and CSV report files
router.get('/:urlFolder/:file', (req, res) => {
  const { urlFolder, file } = req.params;
  const filePath = path.join(REPORT_DIR, urlFolder, file);
  
  // Check if file exists
  if (fs.existsSync(filePath)) {
    // Set appropriate content type
    const contentType = file.endsWith('.pdf') ? 'application/pdf' : 'text/csv';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${file}`);
    
    // Send file
    res.sendFile(filePath);
  } else {
    logger.warn(`File not found: ${filePath}`);
    res.status(404).send('File not found');
  }
});

module.exports = router;
