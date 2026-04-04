import { chromium } from 'playwright';
import fs from 'fs';

const OPENROUTER_BASE = 'https://openrouter.ai';
const MANAGEMENT_KEY = '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';

async function analyzeWithAPI() {
  console.log('Testing API endpoints with management key...\n');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Test 1: List keys via API
  console.log('=== API TEST 1: List Keys ===');
  try {
    const result = await page.evaluate(async ({ key, base }) => {
      try {
        const response = await fetch(`${base}/api/keys`, {
          headers: {
            'Authorization': `Bearer ${key}`,
            'Accept': 'application/json'
          }
        });
        return { 
          status: response.status, 
          url: response.url,
          headers: Object.fromEntries([...response.headers.entries()])
        };
      } catch (e) {
        return { error: e.message };
      }
    }, { key: MANAGEMENT_KEY, base: OPENROUTER_BASE });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // Test 2: Credits endpoint
  console.log('\n=== API TEST 2: Credits ===');
  try {
    const result = await page.evaluate(async ({ key, base }) => {
      try {
        const response = await fetch(`${base}/api/credits`, {
          headers: {
            'Authorization': `Bearer ${key}`,
            'Accept': 'application/json'
          }
        });
        return { 
          status: response.status,
          url: response.url 
        };
      } catch (e) {
        return { error: e.message };
      }
    }, { key: MANAGEMENT_KEY, base: OPENROUTER_BASE });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // Test 3: Try to access settings page with API key
  console.log('\n=== API TEST 3: Management Keys Endpoint ===');
  try {
    const result = await page.evaluate(async ({ key, base }) => {
      try {
        const response = await fetch(`${base}/api/settings/management-keys`, {
          headers: {
            'Authorization': `Bearer ${key}`,
            'Accept': 'application/json'
          }
        });
        return { 
          status: response.status,
          url: response.url 
        };
      } catch (e) {
        return { error: e.message };
      }
    }, { key: MANAGEMENT_KEY, base: OPENROUTER_BASE });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // Test 4: Create key attempt
  console.log('\n=== API TEST 4: Create Key Attempt ===');
  try {
    const result = await page.evaluate(async ({ key, base }) => {
      try {
        const response = await fetch(`${base}/api/keys`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ name: 'test-key', limit: 100 })
        });
        return { 
          status: response.status,
          url: response.url 
        };
      } catch (e) {
        return { error: e.message };
      }
    }, { key: MANAGEMENT_KEY, base: OPENROUTER_BASE });
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
  
  // Test 5: tRPC/GraphQL Discovery
  console.log('\n=== API TEST 5: tRPC/GraphQL Discovery ===');
  
  const apiPaths = [
    '/api/trpc/keys.list',
    '/api/trpc/user.keys',
    '/api/trpc/management.keys',
    '/api/graphql',
    '/trpc/keys.list',
    '/trpc/management.keys'
  ];
  
  for (const path of apiPaths) {
    try {
      const result = await page.evaluate(async ({ path, key, base }) => {
        try {
          const response = await fetch(`${base}${path}`, {
            headers: {
              'Authorization': `Bearer ${key}`,
              'Accept': 'application/json'
            }
          });
          return { 
            path,
            status: response.status 
          };
        } catch (e) {
          return { path, error: e.message };
        }
      }, { path, key: MANAGEMENT_KEY, base: OPENROUTER_BASE });
      console.log(`${result.path}: ${result.status || result.error}`);
    } catch (e) {
      console.log(`${path}: Error - ${e.message}`);
    }
  }
  
  // Test 6: Extract API patterns from page source
  console.log('\n=== API TEST 6: JavaScript Source Analysis ===');
  
  await page.goto(`${OPENROUTER_BASE}/sign-in`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  const html = await page.content();
  
  // Look for fetch calls in scripts
  const fetchPattern = /fetch\(['"]([^'"]+)['"]/g;
  const fetchMatches = [...html.matchAll(fetchPattern)];
  const uniqueFetchUrls = [...new Set(fetchMatches.map(m => m[1]))].slice(0, 20);
  
  console.log('Fetch URLs found in page source:');
  uniqueFetchUrls.forEach(url => console.log(`  ${url}`));
  
  // Look for tRPC router patterns
  const trpcPattern = /trpc[^'"\s]*/gi;
  const trpcMatches = [...html.matchAll(trpcPattern)];
  const uniqueTrpc = [...new Set(trpcMatches.map(m => m[0]))].slice(0, 20);
  
  console.log('\ntRPC patterns found:');
  uniqueTrpc.forEach(t => console.log(`  ${t}`));
  
  // Look for API key related patterns
  const keyApiPattern = /api[^'"\s]*key/gi;
  const keyMatches = [...html.matchAll(keyApiPattern)];
  const uniqueKeyApi = [...new Set(keyMatches.map(m => m[0]))].slice(0, 20);
  
  console.log('\nKey API patterns found:');
  uniqueKeyApi.forEach(k => console.log(`  ${k}`));
  
  // Save API analysis
  const apiAnalysis = {
    timestamp: new Date().toISOString(),
    fetchUrls: uniqueFetchUrls,
    trpcPatterns: uniqueTrpc,
    keyApiPatterns: uniqueKeyApi
  };
  
  fs.writeFileSync('api-analysis.json', JSON.stringify(apiAnalysis, null, 2));
  console.log('\nAPI analysis saved to api-analysis.json');
  
  await browser.close();
  console.log('\n=== API ANALYSIS COMPLETE ===');
}

analyzeWithAPI().catch(console.error);
