// email/reportUploader.js
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { getAsync, allAsync, runAsync } = require('../db/db');
const logger = require('../utils/logger');

// Flag to control whether to attempt R2 uploads
const USE_R2_STORAGE = process.env.USE_R2_STORAGE !== 'false';
const BASE_URL = process.env.SCANNER_BASE_URL || 'http://localhost:3000';

// Initialize R2 client only if enabled
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
 * Upload report file to R2 with fallback to local URLs
 */
async function uploadReportToR2(filePath, scanId, fileType) {
  // First check if the file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  
  // If R2 is disabled or not initialized, use local URLs
  if (!USE_R2_STORAGE || !r2Client) {
    logger.info(`R2 storage disabled or unavailable. Using local URL for ${fileType} report.`);
    return getLocalFileUrl(filePath);
  }
  
  try {
    const fileContent = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const key = `reports/${scanId}/${fileName}`;
    
    // Determine content type
    const contentType = fileType === 'pdf' ? 'application/pdf' : 'text/csv';
    
    // Upload to R2
    await r2Client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: fileContent,
      ContentType: contentType
    }));
    
    // Generate signed URL
    const signedUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key
      }),
      { expiresIn: 60 * 60 * 24 * 7 } // 7 days
    );
    
    logger.info(`Successfully uploaded ${fileType} report to R2: ${key}`);
    return signedUrl;
  } catch (error) {
    logger.error(`Error uploading report to R2: ${error.message}`);
    logger.info(`Falling back to local URL for ${fileType} report.`);
    return getLocalFileUrl(filePath);
  }
}

/**
 * Send results email
 */
async function sendResultsEmail(to, url, scanId, reportUrls) {
  try {
    // Get scan summary
    const summary = await getScanSummary(scanId);
    
    // Extract hostname from URL
    let hostname;
    try {
      hostname = new URL(url).hostname;
    } catch (error) {
      logger.warn(`Could not parse URL ${url}, using as-is for email subject`);
      hostname = url;
    }
    
    // Email template
    const htmlEmail = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="https://a11yscan.xyz/images/a11yscan-logo.svg" alt="A11yscan Logo" width="180" height="50" style="display: inline-block;">
        </div>
        
        <h1 style="color: #4f46e5; margin-bottom: 20px;">Your Accessibility Report is Ready</h1>
        
        <p>Hello,</p>
        
        <p>Good news! We've completed the accessibility scan for your website.</p>
        
        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 0;"><strong>Website URL:</strong> ${url}</p>
          <p style="margin: 10px 0 0;"><strong>Scan ID:</strong> ${scanId}</p>
        </div>
        
        <h2 style="color: #4f46e5; margin: 25px 0 15px;">Summary of Findings</h2>
        
        <div style="margin-bottom: 20px;">
          <p><strong>Pages Scanned:</strong> ${summary.pagesScanned}</p>
          <p><strong>Total Issues Found:</strong> ${summary.totalIssues}</p>
          <ul>
            <li><strong style="color: #ef4444;">Critical Issues:</strong> ${summary.criticalIssues}</li>
            <li><strong style="color: #f59e0b;">Warning Issues:</strong> ${summary.warningIssues}</li>
            <li><strong style="color: #3b82f6;">Info Issues:</strong> ${summary.infoIssues}</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <p><a href="${reportUrls.pdfUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block; margin-bottom: 10px;">Download PDF Report</a></p>
          
          <p><a href="${reportUrls.csvUrl}" style="background-color: #6b7280; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Download CSV Data</a></p>
        </div>
        
        <p>Thank you for making the web more accessible for everyone!</p>
        
        <p>Best regards,<br>The A11yscan Team</p>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
          <p>© ${new Date().getFullYear()} A11yscan. All rights reserved.</p>
        </div>
      </div>
    `;
    
    // Text version
    const textEmail = `
Your Accessibility Report is Ready

Hello,

Good news! We've completed the accessibility scan for your website.

Website URL: ${url}
Scan ID: ${scanId}

Summary of Findings:
- Pages Scanned: ${summary.pagesScanned}
- Total Issues Found: ${summary.totalIssues}
- Critical Issues: ${summary.criticalIssues}
- Warning Issues: ${summary.warningIssues}
- Info Issues: ${summary.infoIssues}

Download your reports:
- PDF Report: ${reportUrls.pdfUrl}
- CSV Data: ${reportUrls.csvUrl}

Thank you for making the web more accessible for everyone!

Best regards,
The A11yscan Team
    `;
    
    // Debug logging
    logger.debug(`Sending email to: ${to}`);
    logger.debug(`Email subject: WCAG Accessibility Scan Results for ${hostname}`);
    
    // Send email
    const info = await smtpClient.sendMail({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: `WCAG Accessibility Scan Results for ${hostname}`,
      text: textEmail,
      html: htmlEmail
    });
    
    logger.info(`✉️ Results email sent to ${to} for scan ${scanId} (Message ID: ${info.messageId})`);
    return true;
  } catch (error) {
    logger.error(`❌ Error sending results email: ${error.message}`);
    logger.error(`Stack trace: ${error.stack}`);
    return false;
  }
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
        
        // Get URLs for reports (either via R2 or direct local URLs)
        let pdfUrl, csvUrl;
        try {
          pdfUrl = await uploadReportToR2(report_pdf, scan_id, 'pdf');
          csvUrl = await uploadReportToR2(report_csv, scan_id, 'csv');
        } catch (uploadError) {
          logger.error(`❌ Failed to get report URLs: ${uploadError.message}`);
          logger.info('Falling back to direct file URLs...');
          pdfUrl = getLocalFileUrl(report_pdf);
          csvUrl = getLocalFileUrl(report_csv);
        }
        
        // Send results email
        const emailSent = await sendResultsEmail(requester_email, url, scan_id, {
          pdfUrl,
          csvUrl
        });
        
        // Mark report as sent regardless of email success
        // This prevents the same scan from being processed repeatedly
        await markScanAsProcessed(scan_id, emailSent);
        
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
