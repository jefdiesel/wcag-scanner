// email/emailProcessor.js
const imaplib = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { runAsync } = require('../db/db');
const logger = require('../utils/logger');

// Initialize email clients
const imapClient = new imaplib({
  user: process.env.EMAIL_USER,
  password: process.env.EMAIL_PASSWORD,
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT, 10),
  tls: true,
  tlsOptions: { rejectUnauthorized: false }
});

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
 * Check emails for scan requests
 */
async function checkEmails() {
  try {
    logger.info('Checking for new scan requests via email');
    
    return new Promise((resolve, reject) => {
      imapClient.once('ready', () => {
        imapClient.openBox('INBOX', false, (err, box) => {
          if (err) {
            imapClient.end();
            return reject(err);
          }
          
          // Search for unread emails
          imapClient.search(['UNSEEN'], (err, results) => {
            if (err) {
              imapClient.end();
              return reject(err);
            }
            
            if (results.length === 0) {
              logger.info('No new scan requests found');
              imapClient.end();
              return resolve([]);
            }
            
            logger.info(`Found ${results.length} new email(s) to process`);
            
            const scanRequests = [];
            let processed = 0;
            
            const f = imapClient.fetch(results, { bodies: '', markSeen: true });
            
            f.on('message', (msg, seqno) => {
              msg.on('body', (stream) => {
                simpleParser(stream, async (err, parsed) => {
                  if (err) {
                    logger.error(`Error parsing message #${seqno}: ${err.message}`);
                    return;
                  }
                  
                  try {
                    // Parse email for scan requests
                    const sender = parsed.from.value[0].address;
                    const subject = parsed.subject;
                    const text = parsed.text || '';
                    
                    // Extract URLs from the email text
                    const urlRegex = /(https?:\/\/[^\s]+)/g;
                    const urls = text.match(urlRegex) || [];
                    
                    if (urls.length > 0) {
                      for (const url of urls) {
                        try {
                          // Validate URL
                          new URL(url);
                          
                          // Add to scan requests array
                          scanRequests.push({
                            url: url.trim(),
                            requester: sender,
                            subject: subject
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
                  imapClient.end();
                  resolve(scanRequests);
                }
              });
            });
            
            f.once('error', (err) => {
              logger.error(`Fetch error: ${err.message}`);
              imapClient.end();
              reject(err);
            });
          });
        });
      });
      
      imapClient.once('error', (err) => {
        logger.error(`IMAP error: ${err.message}`);
        reject(err);
      });
      
      imapClient.connect();
    });
  } catch (error) {
    logger.error(`Error checking emails: ${error.message}`);
    return [];
  }
}

/**
 * Add URL to scanner queue
 */
async function addUrlToQueue(url, requester) {
  try {
    // Generate unique ID for tracking
    const scanId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    
    // Add to queue table
    await runAsync(
      'INSERT INTO queue (url, max_pages) VALUES (?, ?)',
      [url, 100] // Default to 100 pages
    );
    
    // Add to email requests table
    await runAsync(
      'INSERT INTO scan_email_requests (scan_id, url, requester_email) VALUES (?, ?, ?)',
      [scanId, url, requester]
    );
    
    logger.info(`URL ${url} added to queue with scan ID ${scanId}`);
    return scanId;
  } catch (error) {
    logger.error(`Error adding URL to queue: ${error.message}`);
    throw error;
  }
}

/**
 * Send email reply
 */
async function sendEmailReply(to, originalSubject, message) {
  try {
    const subject = originalSubject.toLowerCase().startsWith('re:') 
      ? originalSubject 
      : `Re: ${originalSubject}`;
    
    await smtpClient.sendMail({
      from: process.env.EMAIL_FROM,
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
 * Process email scan requests
 */
async function processEmailRequests() {
  try {
    // Check for new emails
    const scanRequests = await checkEmails();
    
    // Process each scan request
    for (const request of scanRequests) {
      try {
        // Add URL to queue
        const scanId = await addUrlToQueue(request.url, request.requester);
        
        // Send confirmation email
        await sendEmailReply(request.requester, request.subject, `
Your scan request for ${request.url} has been received and added to our queue.

We'll email you when the scan is complete with a link to download your accessibility report.

Scan ID: ${scanId}

Thank you for using our WCAG Accessibility Scanner.
        `);
      } catch (error) {
        logger.error(`Error processing scan request: ${error.message}`);
        
        // Send error email
        await sendEmailReply(request.requester, request.subject, `
There was a problem processing your scan request for ${request.url}.

Error: ${error.message}

Please try again or contact support if this persists.
        `);
      }
    }
  } catch (error) {
    logger.error(`Error in email request processing: ${error.message}`);
  }
}

/**
 * Start the email processor service
 */
function startEmailProcessor() {
  logger.info('Starting email processor service');
  
  // Run immediately
  processEmailRequests();
  
  // Then run on interval
  setInterval(processEmailRequests, 
    parseInt(process.env.EMAIL_CHECK_INTERVAL || '60000', 10)
  );
}

module.exports = {
  startEmailProcessor
};
