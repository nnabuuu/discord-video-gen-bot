#!/usr/bin/env node

/**
 * Test script to verify Google Cloud authentication
 * Run: node scripts/test-auth.js
 */

require('dotenv').config();
const { GoogleAuth } = require('google-auth-library');
const fs = require('fs');

async function testAuth() {
  console.log('\n🔍 Testing Google Cloud Authentication...\n');

  // Check environment variables
  console.log('📋 Environment Variables:');
  console.log(`  GCP_PROJECT_ID: ${process.env.GCP_PROJECT_ID || '❌ NOT SET'}`);
  console.log(`  SERVICE_ACCOUNT_JSON: ${process.env.SERVICE_ACCOUNT_JSON || '(not set - will use ADC)'}`);

  // Check if service account file exists
  if (process.env.SERVICE_ACCOUNT_JSON) {
    const exists = fs.existsSync(process.env.SERVICE_ACCOUNT_JSON);
    console.log(`  Service Account File Exists: ${exists ? '✅' : '❌'}`);

    if (!exists) {
      console.error('\n❌ ERROR: SERVICE_ACCOUNT_JSON path is invalid');
      process.exit(1);
    }
  }

  // Try to authenticate
  try {
    console.log('\n🔐 Attempting authentication...');

    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      ...(process.env.SERVICE_ACCOUNT_JSON && {
        keyFilename: process.env.SERVICE_ACCOUNT_JSON,
      }),
    });

    const client = await auth.getClient();
    const projectId = await auth.getProjectId();

    console.log(`✅ Project ID: ${projectId}`);

    const token = await client.getAccessToken();
    console.log(`✅ Access Token: ${token.token?.substring(0, 20)}...`);

    // Test Vertex AI endpoint access
    console.log('\n🧪 Testing Vertex AI API access...');
    const location = process.env.GCP_LOCATION || 'us-central1';
    const testUrl = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models`;

    const response = await fetch(testUrl, {
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    });

    if (response.ok) {
      console.log('✅ Vertex AI API is accessible');
    } else {
      console.log(`⚠️  Vertex AI API returned: ${response.status} ${response.statusText}`);
      const errorText = await response.text();
      console.log('   Error:', errorText.substring(0, 200));
    }

    console.log('\n✅ Authentication test PASSED\n');
  } catch (error) {
    console.error('\n❌ Authentication test FAILED\n');
    console.error('Error:', error.message);

    if (error.message.includes('invalid_grant')) {
      console.error('\n💡 Possible solutions:');
      console.error('   1. Run: gcloud auth application-default login');
      console.error('   2. Or: Create a new service account key');
      console.error('   3. Or: Check SERVICE_ACCOUNT_JSON path is correct');
    }

    process.exit(1);
  }
}

testAuth();
