// email/reportUploader.js
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { getAsync, allAsync, runAsync } = require('../db/db');
const logger = require('../utils/logger');

// Flag to control whether to attempt R2 uploads - set to false to disable
const USE_R2_STORAGE = false;
const BASE_URL = process.env.SCANNER_BASE_URL || 'http://localhost:3000';

// Initialize R2 client only if enabled (but we've disabled it)
let r2Client = null;
if (USE_R2_STORAGE) {
  try {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
    logger.info('⚙️ R2 client initialized');
  } catch (error) {
    logger.error(`❌ Error initializing R2 client: ${error.message}`);
  }
}

// Initialize SMTP client
const smtpClient = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify SMTP connection
async function verifySmtpConnection() {
  try {
    await smtpClient.verify();
    logger.info('✅ SMTP connection verified successfully');
    return true;
  } catch (error) {
    logger.error(`❌ SMTP connection error: ${error.message}`);
    return false;
  }
}

/**
 * Get local file URL for reports when R2 is not available
 * @param {string} filePath - Path to the report file
 * @returns {string} URL to the file
 */
function getLocalFileUrl(filePath) {
  try {
    // Extract the relative path from the full path
    // Assuming reports are stored in public/reports directory
    const relativePath = filePath.split('public/')[1] || filePath;
    return `${BASE_URL}/${relativePath}`;
  } catch (error) {
    logger.error(`Error creating local file URL: ${error.message}`);
    return filePath; // Fallback to just returning the path
  }
}

/**
 * Get file URL without trying to upload to R2
 */
async function uploadReportToR2(filePath, scanId, fileType) {
  // Simply return the local URL without trying to upload
  return getLocalFileUrl(filePath);
}

/**
 * Send results email (now disabled by default)
 */
async function sendResultsEmail(to, url, scanId, reportUrls) {
  // Skip sending emails
  logger.info(`Email sending disabled - would have sent results for ${url} to ${to}`);
  return true;
}

/**
 * Get scan summary
 */
async function getScanSummary(scanId) {
  try {
    // Count pages scanned
    const pagesResult = await getAsync(
      'SELECT COUNT(*) as count FROM scan_results WHERE scan_id = ?',
      [scanId]
    );
    
    // Get violation counts
    const issuesResult = await getAsync(`
      SELECT 
        SUM(JSON_EXTRACT(violations, '$.violationCounts.total')) as total,
        SUM(JSON_EXTRACT(violations, '$.violationCounts.critical')) as critical,
        SUM(JSON_EXTRACT(violations, '$.violationCounts.warning')) as warning,
        SUM(JSON_EXTRACT(violations, '$.violationCounts.info')) as info
      FROM scan_results 
      WHERE scan_id = ?
    `, [scanId]);
    
    // Handle null or undefined values
    const total = issuesResult && issuesResult.total ? issuesResult.total : 0;
    const critical = issuesResult && issuesResult.critical ? issuesResult.critical : 0;
    const warning = issuesResult && issuesResult.warning ? issuesResult.warning : 0;
    const info = issuesResult && issuesResult.info ? issuesResult.info : 0;
    
    return {
      pagesScanned: pagesResult ? pagesResult.count : 0,
      totalIssues: Math.round(total),
      criticalIssues: Math.round(critical),
      warningIssues: Math.round(warning),
      infoIssues: Math.round(info)
    };
  } catch (error) {
    logger.error(`Error getting scan summary: ${error.message}`);
    return {
      pagesScanned: 0,
      totalIssues: 0,
      criticalIssues: 0,
      warningIssues: 0,
      infoIssues: 0
    };
  }
}

/**
 * Mark scan as processed regardless of success or failure
 * This ensures we don't keep retrying problematic scans
 */
async function markScanAsProcessed(scanId, success = true) {
  try {
    const result = await runAsync(
      'UPDATE scan_email_requests SET report_sent = ?, report_sent_at = CURRENT_TIMESTAMP, processing_error = ? WHERE scan_id = ?',
      [success ? 1 : -1, success ? null : 'Failed to process scan', scanId]
    );
    
    // Check if any rows were affected
    if (result && result.changes && result.changes > 0) {
      logger.info(`✅ Marked scan ${scanId} as ${success ? 'successfully sent' : 'failed to send'}`);
      return true;
    } else {
      logger.warn(`⚠️ No scan_email_requests records were updated for scan ${scanId}`);
      
      // Create a record if none exists
      try {
        // Get URL from scan_results
        const scanInfo = await getAsync('SELECT url FROM scan_results WHERE scan_id = ?', [scanId]);
        if (scanInfo && scanInfo.url) {
          await runAsync(
            'INSERT INTO scan_email_requests (scan_id, url, requester_email, requested_at, report_sent) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)',
            [scanId, scanInfo.url, process.env.EMAIL_ADMIN || process.env.EMAIL_FROM, success ? 1 : -1]
          );
          logger.info(`✅ Created and marked scan_email_requests record for ${scanId}`);
        }
      } catch (insertError) {
        logger.error(`❌ Error creating scan_email_requests record: ${insertError.message}`);
      }
      
      return false;
    }
  } catch (error) {
    logger.error(`❌ Error marking scan ${scanId} as processed: ${error.message}`);
    return false;
  }
}

/**
 * Check for completed scans
 */
async function checkCompletedScans() {
  try {
    logger.info('🔍 Checking for completed scans to send reports...');
    
    // First verify SMTP connection
    const smtpVerified = await verifySmtpConnection();
    if (!smtpVerified) {
      logger.error('❌ SMTP connection not available. Skipping email sending.');
      return;
    }
    
    // Get completed scans with reports that need to be sent
    // Method 1: Check scan_email_requests first, then join with scan_results
    let pendingScans = await allAsync(`
      SELECT DISTINCT e.scan_id, e.url, e.requester_email, s.report_pdf, s.report_csv
      FROM scan_email_requests e
      JOIN scan_results s ON e.scan_id = s.scan_id
      WHERE e.report_sent = 0 
      AND s.status = 'completed'
      AND s.report_pdf IS NOT NULL
      AND s.report_csv IS NOT NULL
      GROUP BY e.scan_id
      LIMIT 5
    `);
    
    // If no pending scans found through method 1, try method 2:
    // Looking for completed scans without a corresponding email request
    if (!pendingScans || pendingScans.length === 0) {
      logger.debug('No pending email requests found, checking for completed scans without email requests...');
      
      pendingScans = await allAsync(`
        SELECT DISTINCT s.scan_id, s.url, s.report_pdf, s.report_csv
        FROM scan_results s
        LEFT JOIN scan_email_requests e ON s.scan_id = e.scan_id
        WHERE s.status = 'completed'
        AND s.report_pdf IS NOT NULL
        AND s.report_csv IS NOT NULL
        AND (e.scan_id IS NULL OR e.report_sent = 0)
        GROUP BY s.scan_id
        LIMIT 5
      `);
    }
    
    if (!pendingScans || pendingScans.length === 0) {
      logger.debug('No completed scans found that need reports sent.');
      return;
    }
    
    logger.info(`📬 Found ${pendingScans.length} completed scans to process`);
    
    for (const scan of pendingScans) {
      try {
        const { scan_id, url, report_pdf, report_csv } = scan;
        
        // Get requester email, default to admin email if not specified
        const requester_email = scan.requester_email || process.env.EMAIL_ADMIN || process.env.EMAIL_FROM;
        
        // Debug log to track scan processing
        logger.debug(`Processing scan: ${scan_id} for URL: ${url}`);
        
        // Check if files exist
        if (!fs.existsSync(report_pdf) || !fs.existsSync(report_csv)) {
          logger.warn(`⚠️ Report files not found for scan ${scan_id}. Marking as failed.`);
          await markScanAsProcessed(scan_id, false);
          continue;
        }
        
        // Get URLs for reports (now just local URLs)
        const pdfUrl = getLocalFileUrl(report_pdf);
        const csvUrl = getLocalFileUrl(report_csv);
        
        // Skip email sending but mark as processed
        logger.info(`📄 Reports available at PDF: ${pdfUrl}, CSV: ${csvUrl}`);
        
        // Mark as processed
        await markScanAsProcessed(scan_id, true);
        
        logger.info(`✅ Successfully processed scan ${scan_id} for ${url}`);
      } catch (error) {
        logger.error(`❌ Error processing scan ${scan.scan_id}: ${error.message}`);
        // Mark the scan as processed but failed to prevent endless retries
        await markScanAsProcessed(scan.scan_id, false);
      }
    }
    
    logger.info('✅ Completed processing pending scans');
  } catch (error) {
    logger.error(`❌ Error checking completed scans: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
  }
}

/**
 * Start the report processor
 */
function startReportProcessor() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('🚀 Report Processor: Starting service');
      logger.info(`⚙️ R2 Storage is ${USE_R2_STORAGE ? 'enabled' : 'disabled'}`);
      
      // Run immediately with a slight delay to allow other services to initialize
      setTimeout(() => {
        checkCompletedScans()
          .then(() => logger.info('✅ Initial email check completed'))
          .catch(err => logger.error(`❌ Initial email check failed: ${err.message}`));
      }, 5000);
      
      // Then run on interval (every 2 minutes)
      const intervalId = setInterval(checkCompletedScans, 
        parseInt(process.env.REPORT_CHECK_INTERVAL || '120000', 10)
      );
      
      logger.info(`✅ Report Processor: Initialized with check interval of ${parseInt(process.env.REPORT_CHECK_INTERVAL || '120000', 10)}ms`);
      
      // Resolve with the interval ID for potential future cancellation
      resolve(intervalId);
    } catch (error) {
      logger.error(`❌ Failed to start report processor: ${error.message}`);
      reject(error);
    }
  });
}

module.exports = {
  startReportProcessor
};
