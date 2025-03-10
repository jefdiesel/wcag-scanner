const imaplib = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { runAsync, getAsync } = require('../db/db');
const { sanitizeUrlForFilename } = require('../utils/helpers');

// Configuration
const config = {
  email: {
    imap: {
      user: process.env.EMAIL_USER,
      password: process.env.EMAIL_PASSWORD,
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || '993', 10),
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    },
    smtp: {
      host: process.env.SMTP_HOST || process.env.EMAIL_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_USER,
        pass: process.env.SMTP_PASSWORD || process.env.EMAIL_PASSWORD
      }
    },
    checkInterval: parseInt(process.env.EMAIL_CHECK_INTERVAL || '60000', 10), // 1 minute by default
    fromAddress: process.env.EMAIL_FROM || 'wcag-scanner@yourdomain.com',
    replyToAddress: process.env.EMAIL_REPLY_TO || process.env.EMAIL_FROM || 'wcag-scanner@yourdomain.com'
  },
  r2: {
    endpoint: process.env.R2_ENDPOINT,
    region: process.env.R2_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    },
    bucket: process.env.R2_BUCKET_NAME
  },
  apiBase: process.env.SCANNER_BASE_URL || 'http://localhost:3000',
  reportLinkExpiry: 60 * 60 * 24 * 7 // 7 days in seconds
};

// Initialize S3 client for Cloudflare R2 if credentials are provided
let s3Client = null;
if (config.r2.endpoint && config.r2.credentials.accessKeyId && config.r2.credentials.secretAccessKey) {
  s3Client = new S3Client({
    region: config.r2.region,
    endpoint: config.r2.endpoint,
    credentials: {
      accessKeyId: config.r2.credentials.accessKeyId,
      secretAccessKey: config.r2.credentials.secretAccessKey
    }
  });
}

// Initialize SMTP client for sending emails
const smtpTransporter = nodemailer.createTransport(config.email.smtp);

/**
 * Check for new scan requests in the inbox
 */
async function checkEmails() {
  try {
    logger.info('Checking for new scan requests via email');
    
    const imap = new imaplib({
      user: config.email.imap.user,
      password: config.email.imap.password,
      host: config.email.imap.host,
      port: config.email.imap.port,
      tls: config.email.imap.tls,
      tlsOptions: config.email.imap.tlsOptions
    });
    
    return new Promise((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }
          
          // Search for unread emails
          imap.search(['UNSEEN'], (err, results) => {
            if (err) {
              imap.end();
              return reject(err);
            }
            
            if (results.length === 0) {
              logger.info('No new scan requests found');
              imap.end();
              return resolve([]);
            }
            
            logger.info(`Found ${results.length} new email(s) to process`);
            
            const scanRequests = [];
            let processed = 0;
            
            const f = imap.fetch(results, { bodies: '', markSeen: true });
            
            f.on('message', (msg, seqno) => {
              msg.on('body', (stream) => {
                simpleParser(stream, async (err, parsed) => {
                  if (err) {
                    logger.error(`Error parsing message #${seqno}: ${err.message}`);
                    return;
                  }
                  
                  try {
                    // Parse the email for scan requests
                    const sender = parsed.from.value[0].address;
                    const subject = parsed.subject;
                    const text = parsed.text || '';
                    
                    // Extract URLs from the email text
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const urls = text.match(urlRegex) || [];
                    
                    if (urls.length > 0) {
                      // Add URLs to scan queue
                      for (const url of urls) {
                        try {
                          // Validate URL
                          new URL(url);
                          
                          // Add to scan requests array
                          scanRequests.push({
                            url: url.trim(),
                            requester: sender,
                            subject: subject,
                            receivedAt: new Date()
                          });
                          
                          logger.info(`Found valid URL to scan: ${url} from ${sender}`);
                        } catch (e) {
                          logger.warn(`Invalid URL found in email: ${url}`);
                        }
                      }
                    } else {
                      logger.info(`No valid URLs found in email from ${sender}`);
                      // Reply to sender about no URLs
                      await sendEmailReply(sender, subject, 'No valid URLs were found in your email. Please include a URL to scan.');
                    }
                  } catch (parseError) {
                    logger.error(`Error processing email: ${parseError.message}`);
                  }
                });
              });
              
              msg.once('end', () => {
                processed++;
                if (processed === results.length) {
                  imap.end();
                  resolve(scanRequests);
                }
              });
            });
            
            f.once('error', (err) => {
              logger.error(`Fetch error: ${err.message}`);
              imap.end();
              reject(err);
            });
            
            f.once('end', () => {
              logger.info('Done fetching messages');
            });
          });
        });
      });
      
      imap.once('error', (err) => {
        logger.error(`IMAP error: ${err.message}`);
        reject(err);
      });
      
      imap.connect();
    });
  } catch (error) {
    logger.error(`Error checking emails: ${error.message}`);
    return [];
  }
}

/**
 * Add URL to the scanner queue
 * @param {string} url - URL to scan
 * @param {string} requester - Email of the requester
 * @returns {Promise<string>} - Scan ID
 */
async function addUrlToQueue(url, requester) {
  try {
    // Get a unique scan ID
    const scanId = Date.now().toString() + Math.random().toString(36).substring(2, 8);
    
    // Insert into queue table
    await runAsync(
      'INSERT INTO queue (url, max_pages) VALUES (?, ?)',
      [url, 100] // Default to 100 pages
    );
    
    // Save requester's email to database
    await runAsync(
      'INSERT INTO scan_email_requests (scan_id, url, requester_email, requested_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [scanId, url, requester]
    );
    
    logger.info(`URL ${url} successfully added to queue with scan ID: ${scanId}`);
    return scanId;
  } catch (error) {
    logger.error(`Error adding URL to queue: ${error.message}`);
    throw error;
  }
}

/**
 * Send a reply email
 * @param {string} to - Recipient email
 * @param {string} originalSubject - Original email subject
 * @param {string} message - Email message
 */
async function sendEmailReply(to, originalSubject, message) {
  try {
    const subject = originalSubject.toLowerCase().startsWith('re:') 
      ? originalSubject 
      : `Re: ${originalSubject}`;
    
    await smtpTransporter.sendMail({
      from: config.email.fromAddress,
      replyTo: config.email.replyToAddress,
      to: to,
      subject: subject,
      text: message,
      html: message.replace(/\n/g, '<br>')
    });
    
    logger.info(`Email reply sent to ${to}`);
  } catch (error) {
    logger.error(`Error sending email reply: ${error.message}`);
  }
}

/**
 * Upload a file to R2 storage (if configured)
 * @param {string} filePath - Local file path
 * @param {string} key - S3 key (path in bucket)
 * @returns {Promise<string|null>} - Public URL or null if R2 is not configured
 */
async function uploadFileToR2(filePath, key) {
  if (!s3Client || !config.r2.bucket) {
    logger.warn('R2 storage not configured, skipping upload');
    return null;
  }
  
  try {
    const fileContent = fs.readFileSync(filePath);
    
    const uploadParams = {
      Bucket: config.r2.bucket,
      Key: key,
      Body: fileContent,
      ContentType: key.endsWith('.pdf') ? 'application/pdf' : 'text/csv'
    };
    
    await s3Client.send(new PutObjectCommand(uploadParams));
    
    // Generate a pre-signed URL for access
    const getObjectParams = {
      Bucket: config.r2.bucket,
      Key: key
    };
    
    const signedUrl = await getSignedUrl(
      s3Client, 
      new GetObjectCommand(getObjectParams),
      { expiresIn: config.reportLinkExpiry }
    );
    
    logger.info(`File uploaded to R2: ${key}`);
    return signedUrl;
  } catch (error) {
    logger.error(`Error uploading to R2: ${error.message}`);
    throw error;
  }
}

/**
 * Send email with report links
 * @param {string} to - Recipient email
 * @param {string} url - Scanned URL
 * @param {string|null} pdfUrl - PDF report URL or null for local file 
 * @param {string|null} csvUrl - CSV report URL or null for local file
 * @param {string} pdfPath - Local PDF path (used if R2 is not configured)
 * @param {string} csvPath - Local CSV path (used if R2 is not configured)
 */
async function sendReportEmail(to, url, pdfUrl, csvUrl, pdfPath, csvPath) {
  try {
    const urlObj = new URL(url);
    const subject = `WCAG Accessibility Scan Results for ${urlObj.hostname}`;
    
    // For message content, adjust based on whether R2 is available
    let message, htmlMessage;
    
    if (pdfUrl && csvUrl) {
      // R2 storage is available, use URLs
      message = `
Hello,

Your WCAG accessibility scan for ${url} has been completed. The reports are available for download:

PDF Report: ${pdfUrl}
CSV Report: ${csvUrl}

These links will expire in 7 days.

Thank you for using our WCAG Accessibility Scanner.
`;
      
      htmlMessage = `
<html>
<body>
  <h2>WCAG Accessibility Scan Results</h2>
  <p>Your WCAG accessibility scan for <a href="${url}">${url}</a> has been completed.</p>
  <p>The reports are available for download:</p>
  <ul>
    <li><a href="${pdfUrl}">PDF Report</a></li>
    <li><a href="${csvUrl}">CSV Report</a></li>
  </ul>
  <p><em>These links will expire in 7 days.</em></p>
  <p>Thank you for using our WCAG Accessibility Scanner.</p>
</body>
</html>
`;
    } else {
      // Using local files, direct user to web interface
      const webReportUrl = `${config.apiBase}/reports/${sanitizeUrlForFilename(url)}`;
      
      message = `
Hello,

Your WCAG accessibility scan for ${url} has been completed.

To view the reports, please visit:
${webReportUrl}

Thank you for using our WCAG Accessibility Scanner.
`;
      
      htmlMessage = `
<html>
<body>
  <h2>WCAG Accessibility Scan Results</h2>
  <p>Your WCAG accessibility scan for <a href="${url}">${url}</a> has been completed.</p>
  <p>To view the reports, please visit:</p>
  <p><a href="${webReportUrl}">${webReportUrl}</a></p>
  <p>Thank you for using our WCAG Accessibility Scanner.</p>
</body>
</html>
`;
    }
    
    await smtpTransporter.sendMail({
      from: config.email.fromAddress,
      replyTo: config.email.replyToAddress,
      to: to,
      subject: subject,
      text: message,
      html: htmlMessage
    });
    
    logger.info(`Report email sent to ${to} for ${url}`);
  } catch (error) {
    logger.error(`Error sending report email: ${error.message}`);
  }
}

/**
 * Check for completed scans and send reports
 */
async function checkCompletedScans() {
  try {
    logger.info('Checking for completed scans to send reports');
    
    // Get pending requests where reports have been generated but not sent
    const pendingRequests = await allAsync(`
      SELECT r.scan_id, r.url, r.requester_email, s.report_pdf, s.report_csv 
      FROM scan_email_requests r
      JOIN scan_results s ON r.scan_id = s.scan_id 
      WHERE r.report_sent = 0 
      AND s.status = 'completed' 
      AND s.report_pdf IS NOT NULL 
      AND s.report_csv IS NOT NULL
      LIMIT 10
    `);
    
    if (!pendingRequests || pendingRequests.length === 0) {
      logger.info('No completed scans pending report delivery');
      return;
    }
    
    logger.info(`Found ${pendingRequests.length} completed scans to send reports for`);
    
    for (const request of pendingRequests) {
      try {
        const { scan_id, url, requester_email, report_pdf, report_csv } = request;
        
        if (!report_pdf || !report_csv) {
          logger.warn(`Reports not found for scan ${scan_id}`);
          continue;
        }
        
        let pdfUrl = null;
        let csvUrl = null;
        
        // Upload to R2 if configured
        if (s3Client && config.r2.bucket) {
          const sanitizedUrl = sanitizeUrlForFilename(url);
          
          // Upload PDF to R2
          const pdfKey = `reports/${sanitizedUrl}/${scan_id}.pdf`;
          pdfUrl = await uploadFileToR2(report_pdf, pdfKey);
          
          // Upload CSV to R2
          const csvKey = `reports/${sanitizedUrl}/${scan_id}.csv`;
          csvUrl = await uploadFileToR2(report_csv, csvKey);
        }
        
        // Send email with links or local paths
        await sendReportEmail(
          requester_email, 
          url, 
          pdfUrl, 
          csvUrl, 
          report_pdf, 
          report_csv
        );
        
        // Update database to mark as sent
        await runAsync(
          'UPDATE scan_email_requests SET report_sent = 1, report_sent_at = CURRENT_TIMESTAMP WHERE scan_id = ?',
          [scan_id]
        );
        
        logger.info(`Successfully sent reports for scan ${scan_id} to ${requester_email}`);
      } catch (requestError) {
        logger.error(`Error processing completed scan: ${requestError.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error checking completed scans: ${error.message}`);
  }
}

/**
 * Main function to process email scan requests
 */
async function processEmailScanRequests() {
  try {
    // Check for new emails
    const scanRequests = await checkEmails();
    
    // Process scan requests
    for (const request of scanRequests) {
      try {
        // Add to queue
        const scanId = await addUrlToQueue(request.url, request.requester);
        
        // Send confirmation email
        const confirmationMessage = `
Your WCAG accessibility scan request for ${request.url} has been received and queued.
Scan ID: ${scanId}

You will receive another email with the scan results once the process is complete.

Thank you for using our WCAG Accessibility Scanner.
`;
        
        await sendEmailReply(request.requester, request.subject, confirmationMessage);
      } catch (requestError) {
        logger.error(`Error processing scan request: ${requestError.message}`);
        
        // Send error email
        const errorMessage = `
There was an error processing your WCAG accessibility scan request for ${request.url}.

Error: ${requestError.message}

Please try again or contact support if the issue persists.
`;
        
        await sendEmailReply(request.requester, request.subject, errorMessage);
      }
    }
    
    // Check for completed scans and send reports
    await checkCompletedScans();
  } catch (error) {
    logger.error(`Error in process email scan requests: ${error.message}`);
  }
}

/**
 * Start the email processor service
 */
function startEmailProcessor() {
  logger.info('Starting email processor service');
  
  // Run immediately on startup
  processEmailScanRequests();
  
  // Then run on the configured interval
  setInterval(processEmailScanRequests, config.email.checkInterval);
}

module.exports = {
  startEmailProcessor
};
