const imaplib = require('imap');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const { runAsync } = require('../db/db');
const logger = require('../utils/logger');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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
    }
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
      return cleaned;
    })
    .filter(url => {
      try {
        new URL(url);
        return true;
      } catch (e) {
        logger.debug(`❌ Invalid URL filtered out: ${url} - ${e.message}`);
        return false;
      }
    });
  logger.debug(`📡 Final Extracted URLs: ${JSON.stringify(processedUrls)}`);
  return processedUrls;
}

/**
 * Send email reply
 * @param {string} to - Recipient email
 * @param {string} originalSubject - Original email subject
 * @param {string} message - Reply message
 */
async function sendEmailReply(to, originalSubject, message) {
  try {
    const subject = originalSubject.toLowerCase().startsWith('re:') 
      ? originalSubject 
      : `Re: ${originalSubject}`;
    
    await smtpClient.sendMail({
      from: process.env.EMAIL_FROM,
      to: to,
      replyTo: process.env.EMAIL_REPLY_TO,
      subject: subject,
      text: message,
      html: message.replace(/\n/g, '<br>')
    });
    
    logger.info(`✉️ Reply sent to ${to}`);
  } catch (error) {
    logger.error(`❌ Error sending email reply: ${error.message}`);
  }
}

/**
 * Add URL to scanner queue
 * @param {string} url - URL to scan
 * @param {string} requester - Email of the requester
 * @param {number} [maxPages=100] - Maximum pages to scan
 * @returns {string} Scan ID
 */
async function addUrlToQueue(url, requester, maxPages = 100) {
  try {
    const scanId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
    const formattedUrl = url.startsWith('http') ? url : `https://${url}`;
    logger.debug(`🔗 Queueing URL: ${formattedUrl} (original: ${url})`);
    
    await runAsync('INSERT INTO queue (url, max_pages) VALUES (?, ?)', [formattedUrl, maxPages]);
    await runAsync(
      'INSERT INTO scan_email_requests (scan_id, url, requester_email) VALUES (?, ?, ?)',
      [scanId, formattedUrl, requester]
    );
    
    logger.info(`🔗 URL ${formattedUrl} added to queue with scan ID ${scanId}`);
    return scanId;
  } catch (error) {
    logger.error(`❌ Error adding URL to queue: ${error.message}`);
    throw error;
  }
}

/**
 * Process emails and extract scan requests
 * @returns {Promise<Array>} Array of scan requests
 */
async function checkEmails() {
  return new Promise((resolve, reject) => {
    logger.info('📨 Starting email scan request check');

    const imapClient = createImapClient();
    const scanRequests = new Set();
    let messagesProcessed = 0;
    let totalMessages = 0;

    imapClient.on('error', (err) => {
      logger.error(`❌ IMAP Connection Error: ${err.message}`);
      logger.error(`❌ Error Details: ${JSON.stringify(err, null, 2)}`);
      reject(err);
    });

    imapClient.once('ready', () => {
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
                    await sendEmailReply(
                      sender, 
                      subject, 
                      'No valid URLs were found in your email. Please include a full URL (starting with http:// or https://) to scan.'
                    );
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

    const connectionTimeout = setTimeout(() => {
      logger.error('❌ IMAP Connection timed out');
      imapClient.destroy();
      reject(new Error('IMAP Connection timed out'));
    }, 10000);

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
    const scanRequests = await checkEmails();
    logger.info(`📬 Total scan requests found: ${scanRequests.length}`);

    for (const request of scanRequests) {
      try {
        logger.info(`🔗 Processing scan request for URL: ${request.url}`);
        const scanId = await addUrlToQueue(request.url, request.requester);
        await sendEmailReply(
          request.requester, 
          request.subject, 
          `Your scan request for ${request.url} has been received and added to our queue.

We'll email you when the scan is complete with a link to download your accessibility report.

Scan ID: ${scanId}

Thank you for using our WCAG Accessibility Scanner.`
        );
        logger.info(`✅ Successfully processed scan request for ${request.url}`);
      } catch (requestError) {
        logger.error(`❌ Error processing scan request for ${request.url}: ${requestError.message}`);
        await sendEmailReply(
          request.requester, 
          request.subject, 
          `There was a problem processing your scan request for ${request.url}.

Error: ${requestError.message}

Please try again or contact support if this persists.`
        );
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
      
      processEmailRequests()
        .then(() => logger.info('✅ EMAIL PROCESSOR: Initial email check completed successfully'))
        .catch(initialError => logger.error(`❌ EMAIL PROCESSOR: Initial email check failed: ${initialError.message}`));
      
      const intervalId = setInterval(() => {
        logger.debug('🕒 EMAIL PROCESSOR: Running scheduled email check');
        processEmailRequests()
          .catch(intervalError => logger.error(`❌ EMAIL PROCESSOR: Scheduled email check failed: ${intervalError.message}`));
      }, parseInt(process.env.EMAIL_CHECK_INTERVAL || '60000', 10));
      
      logger.info('✅ EMAIL PROCESSOR: Service initialized successfully');
      resolve(intervalId);
    } catch (setupError) {
      logger.error(`❌ EMAIL PROCESSOR: Startup failed: ${setupError.message}`);
      reject(setupError);
    }
  });
}

// Debug export
logger.debug('📦 Exporting from emailProcessor:', { startEmailProcessor });
module.exports = { startEmailProcessor };
