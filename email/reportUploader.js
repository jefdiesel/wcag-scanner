// email/reportUploader.js
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { getAsync, allAsync, runAsync } = require('../db/db');
const logger = require('../utils/logger');

// Initialize R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
  }
});

// Initialize SMTP client
const smtpClient = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD
  }
});

/**
 * Upload report file to R2
 */
async function uploadReportToR2(filePath, scanId, fileType) {
  try {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    
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
    throw error;
  }
}

/**
 * Send results email
 */
async function sendResultsEmail(to, url, scanId, reportUrls) {
  try {
    // Get scan summary
    const summary = await getScanSummary(scanId);
    const hostname = new URL(url).hostname;
    
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
        
        <p>These links will expire in 7 days.</p>
        
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

These links will expire in 7 days.

Thank you for making the web more accessible for everyone!

Best regards,
The A11yscan Team
    `;
    
    await smtpClient.sendMail({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: `WCAG Accessibility Scan Results for ${hostname}`,
      text: textEmail,
      html: htmlEmail
    });
    
    logger.info(`Results email sent to ${to} for scan ${scanId}`);
  } catch (error) {
    logger.error(`Error sending results email: ${error.message}`);
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
    
    return {
      pagesScanned: pagesResult ? pagesResult.count : 0,
      totalIssues: Math.round(issuesResult ? issuesResult.total || 0 : 0),
      criticalIssues: Math.round(issuesResult ? issuesResult.critical || 0 : 0),
      warningIssues: Math.round(issuesResult ? issuesResult.warning || 0 : 0),
      infoIssues: Math.round(issuesResult ? issuesResult.info || 0 : 0)
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
 * Check for completed scans
 */
async function checkCompletedScans() {
  try {
    logger.info('Checking for completed scans to send reports');
    
    // Get completed scans that need reports sent
    const pendingScans = await allAsync(`
      SELECT e.scan_id, e.url, e.requester_email, s.report_pdf, s.report_csv
      FROM scan_email_requests e
      JOIN scan_results s ON e.scan_id = s.scan_id
      WHERE e.report_sent = 0 
      AND s.status = 'completed'
      AND s.report_pdf IS NOT NULL
      AND s.report_csv IS NOT NULL
      LIMIT 5
    `);
    
    if (!pendingScans || pendingScans.length === 0) {
      return;
    }
    
    logger.info(`Found ${pendingScans.length} completed scans to process`);
    
    for (const scan of pendingScans) {
      try {
        const { scan_id, url, requester_email, report_pdf, report_csv } = scan;
        
        // Check if files exist
        if (!fs.existsSync(report_pdf) || !fs.existsSync(report_csv)) {
          logger.warn(`Report files not found for scan ${scan_id}`);
          continue;
        }
        
        // Upload reports to R2
        const pdfUrl = await uploadReportToR2(report_pdf, scan_id, 'pdf');
        const csvUrl = await uploadReportToR2(report_csv, scan_id, 'csv');
        
        // Send results email
        await sendResultsEmail(requester_email, url, scan_id, {
          pdfUrl,
          csvUrl
        });
        
        // Mark report as sent
        await runAsync(
          'UPDATE scan_email_requests SET report_sent = 1, report_sent_at = CURRENT_TIMESTAMP WHERE scan_id = ?',
          [scan_id]
        );
        
        logger.info(`Successfully processed scan ${scan_id} for ${url}`);
      } catch (error) {
        logger.error(`Error processing scan ${scan.scan_id}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error checking completed scans: ${error.message}`);
  }
}

/**
 * Start the report processor
 */
function startReportProcessor() {
  logger.info('Starting report processor service');
  
  // Run immediately
  checkCompletedScans();
  
  // Then run on interval (every 2 minutes)
  setInterval(checkCompletedScans, 120000);
}

module.exports = {
  startReportProcessor
};
