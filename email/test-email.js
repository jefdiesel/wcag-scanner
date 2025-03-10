#!/usr/bin/env node
const imaplib = require('imap');
const { simpleParser } = require('mailparser');
require('dotenv').config();

async function testEmailConnection() {
  console.log('Starting Email Configuration Test');
  
  // Validate required environment variables
  const requiredVars = [
    'EMAIL_USER', 'EMAIL_PASSWORD', 
    'EMAIL_HOST', 'EMAIL_PORT'
  ];
  
  const missingVars = requiredVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.error('Missing required environment variables:', missingVars);
    process.exit(1);
  }

  // IMAP Configuration
  const imapConfig = {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    tls: true,
    tlsOptions: { 
      rejectUnauthorized: false 
    }
  };

  console.log('IMAP Connection Configuration:');
  console.log(JSON.stringify({
    host: imapConfig.host,
    port: imapConfig.port,
    user: imapConfig.user.replace(/./g, '*'), // Mask user
    tlsOptions: imapConfig.tlsOptions
  }, null, 2));

  return new Promise((resolve, reject) => {
    const imapClient = new imaplib(imapConfig);

    imapClient.once('ready', () => {
      console.log('✅ Successfully connected to IMAP server');
      
      imapClient.openBox('INBOX', false, (err, box) => {
        if (err) {
          console.error('❌ Error opening INBOX:', err);
          imapClient.end();
          reject(err);
          return;
        }

        console.log('✅ Successfully opened INBOX');
        console.log(`Total messages: ${box.messages.total}`);

        // Only fetch messages if there are any
        if (box.messages.total > 0) {
          // Fetch the last 5 messages or all if less than 5
          const fetchRange = box.messages.total > 5 
            ? `${box.messages.total - 4}:${box.messages.total}` 
            : '1:*';

          const f = imapClient.seq.fetch(fetchRange, {
            bodies: ['HEADER', 'TEXT'],
            markSeen: false
          });

          f.on('message', (msg) => {
            msg.on('body', (stream, info) => {
              simpleParser(stream, (err, parsed) => {
                if (err) {
                  console.error('Error parsing email:', err);
                  return;
                }
                console.log('Sample Email:');
                console.log(`From: ${parsed.from ? parsed.from.text : 'N/A'}`);
                console.log(`Subject: ${parsed.subject || 'N/A'}`);
              });
            });
          });

          f.once('error', (err) => {
            console.error('Fetch error:', err);
          });

          f.once('end', () => {
            imapClient.end();
            resolve();
          });
        } else {
          console.log('No messages in INBOX');
          imapClient.end();
          resolve();
        }
      });
    });

    imapClient.once('error', (err) => {
      console.error('❌ IMAP Connection Error:', err);
      reject(err);
    });

    imapClient.once('end', () => {
      console.log('IMAP connection ended');
    });

    // Initiate connection
    try {
      imapClient.connect();
    } catch (connectError) {
      console.error('Connection attempt failed:', connectError);
      reject(connectError);
    }
  });
}

// Run the test
testEmailConnection()
  .then(() => {
    console.log('✅ Email configuration test completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Email configuration test failed', error);
    process.exit(1);
  });
