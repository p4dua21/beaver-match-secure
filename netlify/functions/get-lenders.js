const https = require('https');

// Simple in-memory rate limiting
const requestLog = new Map();
const RATE_LIMIT = 100; // requests per hour per IP
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip) {
  const now = Date.now();
  const requests = requestLog.get(ip) || [];
  
  // Remove old requests outside the time window
  const recentRequests = requests.filter(time => now - time < WINDOW_MS);
  
  if (recentRequests.length >= RATE_LIMIT) {
    return false;
  }
  
  recentRequests.push(now);
  requestLog.set(ip, recentRequests);
  return true;
}

exports.handler = async function(event, context) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Rate limiting
  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  if (!checkRateLimit(ip)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify({ error: 'Too many requests. Please try again later.' })
    };
  }

  // Get secrets from environment variables
  const API_KEY = process.env.GOOGLE_SHEETS_API_KEY;
  const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

  // Check if environment variables are set
  if (!API_KEY || !SPREADSHEET_ID) {
    console.error('Missing environment variables');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  // Build Google Sheets API URL
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Lenders!A1:AE100?key=${API_KEY}`;

  // Fetch data from Google Sheets
  return new Promise((resolve) => {
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({
            statusCode: 200,
            headers,
            body: data
          });
        } else {
          console.error('Google Sheets API error:', res.statusCode, data);
          resolve({
            statusCode: res.statusCode,
            headers,
            body: JSON.stringify({ 
              error: 'Failed to fetch data from Google Sheets',
              details: data
            })
          });
        }
      });
    }).on('error', (err) => {
      console.error('Request error:', err);
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Network error: ' + err.message })
      });
    });
  });
};