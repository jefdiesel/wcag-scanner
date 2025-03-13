const imaplib = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { getAsync, allAsync, runAsync } = require('../db/db');
const logger = require('../utils/logger');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Flag to control email sending
const emailEnabled = process.env.EMAIL_ENABLED !== 'false';

// Track connection attempts to implement backoff strategy
let connectionAttempts = 0;
let lastConnectionTime = 0;
const MAX_RETRIES = 3;
const BACKOFF_TIME = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Create IMAP client with current configuration
 * @returns {imaplib} IMAP client instance
 */
const createImapClient = () => {
  return new imaplib({
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    tls: true,
    tlsOptions: { 
      rejectUnauthorized: false 
    },
    // Add connection timeout options
    connTimeout: 30000, // 30 seconds connection timeout (reduced from default)
    authTimeout: 30000  // 30 seconds auth timeout
  });
};

// Initialize SMTP client
const smtpClient = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT, 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  },
  tls: {
    rejectUnauthorized: false
  }
});

/**
 * Clean a URL - remove problematic patterns
 * @param {string} url - URL to clean
 * @returns {string} Cleaned URL
 */
function cleanUrl(url) {
  try {
    let cleaned = url.trim();
    
    // Add protocol if missing
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
      cleaned = `https://${cleaned}`;
    }
    
    // Remove trailing periods or .The
    while (cleaned.endsWith('.') || cleaned.endsWith('.The')) {
      if (cleaned.endsWith('.The')) {
        cleaned = cleaned.slice(0, -4);
      } else if (cleaned.endsWith('.')) {
        cleaned = cleaned.slice(0, -1);
      }
    }
    
    // Replace consecutive periods with a single one
    cleaned = cleaned.replace(/\.+/g, '.');
    
    // Try to construct a proper URL
    const urlObj = new URL(cleaned);
    
    // Return the normalized URL
    return urlObj.toString();
  } catch (error) {
    // If cleaning fails, return the original
    logger.debug(`Failed to clean URL: ${url} - ${error.message}`);
    return url;
  }
}

/**
 * Filter for URLs to prevent problematic patterns and infinite loops
 * @param {string} url - URL to check
 * @returns {boolean} - True if URL should be allowed, false if it should be filtered out
 */
function shouldAllowUrl(url) {
  try {
    // Check if URL contains obvious problems
    if (!url || typeof url !== 'string') {
      return false;
    }
    
    // Check for URLs ending with periods or .The which cause loops
    if (url.endsWith('.') || url.endsWith('.The') || url.includes('..')) {
      logger.debug(`🚫 URL rejected - contains trailing periods: ${url}`);
      return false;
    }
    
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
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      
      // If the last part of the URL ends with these keywords, it's likely a user-added
      // URL from copy-pasting from an email or error message
      if (scanKeywords.some(keyword => lastPart.endsWith(keyword))) {
        return false;
      }
    }
    
    // Try to parse as a valid URL
    try {
      new URL(url);
    } catch (e) {
      logger.debug(`🚫 URL rejected - invalid format: ${url}`);
      return false;
    }
    
    // Otherwise, let the URL through
    return true;
  } catch (error) {
    // If we can't parse the URL, better to filter it out
    logger.debug(`🚫 URL rejected due to error: ${url} - ${error.message}`);
    return false;
  }
}

/**
 * Extract valid URLs from text
 * @param {string} text - Text to extract URLs from
 * @returns {string[]} Array of valid URLs
 */
function extractUrls(text) {
  if (!text) return [];

  const urlRegex = /(https?:\/\/[^\s'"<>\n]+)/g;
  const urls = text.match(urlRegex) || [];
  const processedUrls = urls
    .map(url => {
      const cleaned = url.replace(/['"<>\n]/g, '').trim();
      logger.debug(`🔍 URL Cleaning: Raw: ${url}, Cleaned: ${cleaned}`);
      // Apply the cleaning function to fix problematic URLs
      return cleanUrl(cleaned);
    })
    .filter(url => {
      try {
        new URL(url);
        // Apply the URL filter
        if (!shouldAllowUrl(url)) {
          logger.debug(`🚫 URL filtered out by policy: ${url}`);
          return false;
        }
        return true;
      } catch (e) {
        logger.debug(`❌ Invalid URL filtered out: ${url} - ${e.message}`);
        return false;
      }
    });
  
  // Remove duplicates
  const uniqueUrls = [...new Set(processedUrls)];
  
  logger.debug(`📡 Final Extracted URLs: ${JSON.stringify(uniqueUrls)}`);
  return uniqueUrls;
}

/**
 * Send email reply (now disabled by default)
 */
async function sendEmailReply(to, originalSubject, message) {
  // Skip sending emails
  logger.info(`Email replies disabled - would have sent to ${to}`);
  return true;
}

/**
 * Add URL to scanner queue
 * @param {string} url - URL to scan
 * @param {string} requester - Email of the requester
 * @param {number} [maxPages=10] - Maximum pages to scan - reduced to 10 for emails
 * @returns {string|null} Scan ID or null if URL was rejected
 */
async function addUrlToQueue(url, requester, maxPages = 10) {
  try {
    // Clean the URL first
    let cleanedUrl = cleanUrl(url);
    
    // Apply validation
    if (!shouldAllowUrl(cleanedUrl)) {
      logger.warn(`🚫 URL rejected by filter: ${cleanedUrl} (original: ${url})`);
      return null;
    }
    
    // Additional check - see if this URL has already been scanned recently
    try {
      const recentScans = await allAsync(`
        SELECT url FROM scan_results 
        WHERE url = ? AND status = 'completed' 
        AND scanned_at > datetime('now', '-1 day')
        LIMIT 1
      `, [cleanedUrl]);
      
      if (recentScans && recentScans.length > 0) {
        logger.info(`📋 URL ${cleanedUrl} was already scanned in the last 24 hours. Not adding to queue.`);
        // Return a scan ID anyway
        return Date.now().toString() + Math.random().toString(36).substring(2, 7);
      }
    } catch (checkError) {
      logger.error(`Error checking recent scans: ${checkError.message}`);
      // Continue even if this check fails
    }
    
    const scanId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    logger.debug(`🔗 Queueing URL: ${cleanedUrl} (original: ${url})`);
    
    // Check if this URL is already in the queue
    const existingQueue = await runAsync(
      'SELECT COUNT(*) as count FROM queue WHERE url = ?', 
      [cleanedUrl]
    );
    
    // Only add to queue if not already present
    if (existingQueue && existingQueue.count && existingQueue.count > 0) {
      logger.info(`🔄 URL ${cleanedUrl} already in queue, not adding duplicate`);
    } else {
      // Note the max_pages is now set to 10 by default for email
      await runAsync('INSERT INTO queue (url, max_pages) VALUES (?, ?)', [cleanedUrl, maxPages]);
      logger.info(`🔗 URL ${cleanedUrl} added to queue with maxPages=${maxPages}`);
    }
    
    // Add to scan_email_requests table
    await runAsync(
      'INSERT INTO scan_email_requests (scan_id, url, requester_email) VALUES (?, ?, ?)',
      [scanId, cleanedUrl, requester]
    );
    
    logger.info(`🔗 Created scan request with ID ${scanId} for URL ${cleanedUrl}`);
    return scanId;
  } catch (error) {
    logger.error(`❌ Error adding URL to queue: ${error.message}`);
    return null;
  }
}

/**
 * Process emails and extract scan requests
 * @returns {Promise<Array>} Array of scan requests
 */
async function checkEmails() {
  // Implement backoff strategy for connection issues
  const now = Date.now();
  if (connectionAttempts >= MAX_RETRIES && (now - lastConnectionTime) < BACKOFF_TIME) {
    logger.warn(`⚠️ Email connection attempts exceeded ${MAX_RETRIES} times. Backing off until ${new Date(lastConnectionTime + BACKOFF_TIME).toLocaleTimeString()}`);
    return Promise.resolve([]);
  }
  
  return new Promise((resolve, reject) => {
    logger.info('📨 Starting email scan request check');

    const imapClient = createImapClient();
    const scanRequests = new Set();
    let messagesProcessed = 0;
    let totalMessages = 0;
    
    // Update connection tracking
    connectionAttempts++;
    lastConnectionTime = Date.now();

    imapClient.on('error', (err) => {
      logger.error(`❌ IMAP Connection Error: ${err.message}`);
      logger.error(`❌ Error Details: ${JSON.stringify(err, null, 2)}`);
      reject(err);
    });

    imapClient.once('ready', () => {
      // Reset connection attempts on success
      connectionAttempts = 0;
      logger.debug('🔐 IMAP client connected successfully');

      imapClient.openBox('INBOX', false, (err, box) => {
        if (err) {
          logger.error(`❌ Failed to open INBOX: ${err.message}`);
          imapClient.end();
          return reject(err);
        }

        logger.debug(`📬 Opened mailbox: ${box.name}, Total messages: ${box.messages.total}`);

        imapClient.search(['UNSEEN'], (err, results) => {
          if (err) {
            logger.error(`❌ Email search error: ${err.message}`);
            imapClient.end();
            return reject(err);
          }

          if (results.length === 0) {
            logger.info('📭 No new unseen emails');
            imapClient.end();
            return resolve([]);
          }

          totalMessages = results.length;
          logger.info(`📬 Found ${totalMessages} unseen email(s)`);

          const f = imapClient.fetch(results, { 
            bodies: '',
            markSeen: true 
          });

          f.on('message', (msg) => {
            const chunks = [];

            msg.on('body', (stream) => {
              stream.on('data', (chunk) => chunks.push(chunk));
              stream.on('end', async () => {
                try {
                  const emailBuffer = Buffer.concat(chunks);
                  const parsed = await simpleParser(emailBuffer);

                  const sender = parsed.from.value[0].address;
                  const subject = parsed.subject || 'No Subject';
                  const textContent = [
                    parsed.text || '',
                    parsed.html ? parsed.html.replace(/<[^>]*>/g, '') : '',
                    parsed.textAsHtml ? parsed.textAsHtml.replace(/<[^>]*>/g, '') : ''
                  ].join('\n');

                  logger.debug(`🔍 Email Debug:
                    From: ${sender}
                    Subject: ${subject}
                    Text Content Length: ${textContent.length}
                  `);

                  const urls = extractUrls(textContent);
                  logger.debug(`📡 Extracted URLs after processing: ${JSON.stringify(urls)}`);

                  if (urls.length > 0) {
                    urls.forEach(url => {
                      const uniqueKey = `${sender}|${url}|${subject}`;
                      if (!scanRequests.has(uniqueKey)) {
                        scanRequests.add(uniqueKey);
                        logger.info(`🔍 Found scan request: ${url} from ${sender}`);
                      }
                    });
                  } else {
                    logger.info(`📭 No valid URLs found in email from ${sender}`);
                    // No email reply
                  }
                } catch (processError) {
                  logger.error(`❌ Error processing email: ${processError.message}`);
                  logger.error(`❌ Full error details: ${processError.stack}`);
                } finally {
                  messagesProcessed++;
                  logger.debug(`📬 Processed ${messagesProcessed}/${totalMessages} messages`);
                  if (messagesProcessed === totalMessages) {
                    const uniqueRequests = Array.from(scanRequests).map(key => {
                      const [requester, url, subject] = key.split('|');
                      logger.debug(`🔍 Resolved request: ${url} from ${requester} with subject ${subject}`);
                      return { url, requester, subject };
                    });
                    logger.info(`✅ Processed ${uniqueRequests.length} unique scan requests`);
                    imapClient.end();
                    resolve(uniqueRequests);
                  }
                }
              });
            });
          });

          f.once('error', (fetchErr) => {
            logger.error(`❌ Fetch error: ${fetchErr.message}`);
            imapClient.end();
            reject(fetchErr);
          });

          f.once('end', () => {
            logger.debug(`📬 Fetch end event fired, processed ${messagesProcessed}/${totalMessages} messages`);
            if (messagesProcessed < totalMessages) {
              logger.warn(`⚠️ Fetch ended before all messages processed, waiting for remaining`);
            }
          });
        });
      });
    });

    // Reduce connection timeout to avoid hanging
    const connectionTimeout = setTimeout(() => {
      logger.error('❌ IMAP Connection timed out');
      imapClient.destroy();
      reject(new Error('IMAP Connection timed out'));
    }, 30000); // 30 seconds timeout

    imapClient.connect();
    imapClient.on('ready', () => clearTimeout(connectionTimeout));
  });
}

/**
 * Process email scan requests
 */
async function processEmailRequests() {
  try {
    logger.debug('🔄 Starting email request processing');
    
    // Check if we should skip due to backoff
    const now = Date.now();
    if (connectionAttempts >= MAX_RETRIES && (now - lastConnectionTime) < BACKOFF_TIME) {
      logger.warn(`⚠️ Skipping email check due to connection backoff period. Will resume at ${new Date(lastConnectionTime + BACKOFF_TIME).toLocaleTimeString()}`);
      return;
    }
    
    const scanRequests = await checkEmails();
    logger.info(`📬 Total scan requests found: ${scanRequests.length}`);

    for (const request of scanRequests) {
      try {
        logger.info(`🔗 Processing scan request for URL: ${request.url}`);
        const scanId = await addUrlToQueue(request.url, request.requester);
        
        if (scanId) {
          // No email response - just log success
          logger.info(`✅ Successfully processed scan request for ${request.url}`);
        } else {
          // URL was filtered out - no email response
          logger.info(`🚫 Rejected scan request for filtered URL: ${request.url}`);
        }
      } catch (requestError) {
        logger.error(`❌ Error processing scan request for ${request.url}: ${requestError.message}`);
        // No email response on error
      }
    }
    logger.debug('✅ Email request processing completed');
  } catch (error) {
    logger.error(`❌ Error in email request processing: ${error.message}`);
    logger.error(`❌ Full error details: ${error.stack}`);
  }
}

/**
 * Start the email processor service
 * @returns {Promise<NodeJS.Timeout>} Interval ID for the email processor
 */
function startEmailProcessor() {
  return new Promise((resolve, reject) => {
    try {
      logger.info('🚀 EMAIL PROCESSOR: Initiating startup process');
      
      // Initial run is optional based on environment variable
      if (process.env.EMAIL_CHECK_ON_STARTUP !== 'false') {
        processEmailRequests()
          .then(() => logger.info('✅ EMAIL PROCESSOR: Initial email check completed successfully'))
          .catch(initialError => logger.error(`❌ EMAIL PROCESSOR: Initial email check failed: ${initialError.message}`));
      } else {
        logger.info('⏭️ EMAIL PROCESSOR: Skipping initial email check as per configuration');
      }
      
      // Adjust interval based on environment variables with a longer default
      const checkInterval = parseInt(process.env.EMAIL_CHECK_INTERVAL || '300000', 10); // Default to 5 minutes
      
      const intervalId = setInterval(() => {
        logger.debug('🕒 EMAIL PROCESSOR: Running scheduled email check');
        processEmailRequests()
          .catch(intervalError => logger.error(`❌ EMAIL PROCESSOR: Scheduled email check failed: ${intervalError.message}`));
      }, checkInterval);
      
      logger.info(`✅ EMAIL PROCESSOR: Service initialized successfully with check interval of ${checkInterval}ms`);
      resolve(intervalId);
    } catch (setupError) {
      logger.error(`❌ EMAIL PROCESSOR: Startup failed: ${setupError.message}`);
      reject(setupError);
    }
  });
}

// Export the function
module.exports = { startEmailProcessor };
