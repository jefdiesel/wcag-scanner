#!/usr/bin/env node

/**
 * Script to create an initial API user from the command line
 * 
 * Usage: node create-api-user.js --username admin --email admin@example.com --rateLimit 1000
 */

const { initDatabase } = require('../db/db');
const { createApiUser } = require('../utils/apiManager');
const logger = require('../utils/logger');

// Parse command line arguments
const args = process.argv.slice(2);
const params = {};

for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  const value = args[i + 1];
  params[key] = value;
}

// Validate required parameters
if (!params.username || !params.email) {
  console.error('Error: Username and email are required');
  console.log('Usage: node create-api-user.js --username NAME --email EMAIL [--rateLimit NUMBER]');
  process.exit(1);
}

// Initialize database and create user
async function run() {
  try {
    // Initialize database
    await initDatabase();
    
    // Create API user
    const rateLimit = parseInt(params.rateLimit) || 100;
    const user = await createApiUser(params.username, params.email, rateLimit);
    
    console.log('API User created successfully:');
    console.log(`Username: ${user.username}`);
    console.log(`Email: ${user.email}`);
    console.log(`API Key: ${user.api_key}`);
    console.log(`Rate Limit: ${user.rate_limit} requests per day`);
    console.log('\nIMPORTANT: Save this API key as it will not be shown again!');
    
    process.exit(0);
  } catch (error) {
    logger.error(`Failed to create API user: ${error.stack}`);
    console.error('Error creating API user:', error.message);
    process.exit(1);
  }
}

run();
