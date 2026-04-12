#!/usr/bin/env node
/**
 * Browser-based network capture using Playwright
 * Navigates the actual dashboard and captures real network traffic
 */

import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

const prisma = new PrismaClient();

async function decrypt(encryptedData) {
  // Simple placeholder - in real code this would use the actual decryption
  // For now we'll use the existing store service
  const store = await import('./server/services/store.js');
  // Can't directly use this, but we can query the account
  return encryptedData;
}

async function getAccountSession() {
  const account = await prisma.account.findFirst({
    where: { id: ACCOUNT_ID, userId: USER_ID }
  });
  
  if (!account) throw new Error('Account not found');
  
  // We need to decrypt the session token
  const store = await import('./server/services/store.js');
  const sessionData = await store.getAccountSession(USER_ID, ACCOUNT_ID);
  
  return sessionData;
}

async function getFreshJwt(sessionCookie, clientCookie) {
  try {
    const cookieHeader = `__session=${sessionCookie}; ${clientCookie}`;
    const res = await fetch("https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0", {
      headers: {
        "Cookie": cookieHeader,
        "Origin": "https://openrouter.ai",
      }
    });
    const data = await res.json();
    return data?.response?.sessions?.[0]?.last_active_token?.jwt;
  } catch(e) {
    console.error("Failed to get fresh JWT:", e.message);
    return null;
  }
}

async function captureNetworkTraffic() {
  console.log('='.repeat(80));
  console.log('PLAYWRIGHT NETWORK CAPTURE');
  console.log('='.repeat(80));
  
  // Get session
  const session = await getAccountSession();
  console.log('\nSession obtained');
  console.log('Session expiry:', session.sessionExpiry);
  
  // Get fresh JWT
  const freshJwt = await getFreshJwt(session.sessionCookie, session.clientCookie);
  if (freshJwt) {
    console.log('✅ Fresh JWT obtained');
  }
  
  const jwtToUse = freshJwt || session.sessionCookie;
  
  // Launch browser
  console.log('\nLaunching browser...');
  const browser = await chromium.launch({ headless: true });
  
  // Parse client cookie to get individual components
  const clientParts = {};
  if (session.clientCookie) {
    for (const part of session.clientCookie.split('; ')) {
      if (part.includes('=')) {
        const idx = part.indexOf('=');
        clientParts[part.slice(0, idx)] = part.slice(idx + 1);
      }
    }
  }
  
  // Create context with session
  const context = await browser.newContext();
  
  // Add cookies
  const cookies = [
    { name: "__session", value: jwtToUse, domain: "openrouter.ai", path: "/" },
    { name: "__client", value: clientParts["__client"], domain: "openrouter.ai", path: "/" },
    { name: "__client_uat", value: clientParts["__client_uat"], domain: "openrouter.ai", path: "/" },
    { name: "__cf_bm", value: clientParts["__cf_bm"], domain: "openrouter.ai", path: "/" },
    { name: "_cfuvid", value: clientParts["_cfuvid"], domain: "openrouter.ai", path: "/" }
  ].filter(c => c.value);
  
  await context.addCookies(cookies);
  console.log(`Added ${cookies.length} cookies`);
  
  // Store captured requests
  const capturedRequests = [];
  
  // Listen to all requests
  context.on('request', request => {
    const url = request.url();
    if (url.includes('openrouter.ai') && !url.includes('.css') && !url.includes('.js') && !url.includes('font')) {
      capturedRequests.push({
        type: 'request',
        url: url,
        method: request.method(),
        headers: request.headers(),
        postData: request.postData(),
        timestamp: Date.now()
      });
    }
  });
  
  // Listen to all responses
  context.on('response', async response => {
    const url = response.url();
    if (url.includes('openrouter.ai') && !url.includes('.css') && !url.includes('.js') && !url.includes('font')) {
      try {
        const body = await response.text().catch(() => '');
        capturedRequests.push({
          type: 'response',
          url: url,
          status: response.status(),
          headers: response.headers(),
          body: body.slice(0, 10000), // Limit body size
          hasKey: body.includes('sk-or-v1-'),
          timestamp: Date.now()
        });
      } catch (e) {
        // Ignore
      }
    }
  });
  
  // Create page
  const page = await context.newPage();
  
  // Navigate to management keys page
  console.log('\nNavigating to management keys page...');
  await page.goto('https://openrouter.ai/settings/management-keys');
  
  // Wait for page to load
  await page.waitForTimeout(3000);
  
  // Take screenshot for debugging
  await page.screenshot({ path: '/tmp/management-keys-page.png' });
  console.log('Screenshot saved to /tmp/management-keys-page.png');
  
  // Look for create/add button
  console.log('\nLooking for Create/Add button...');
  
  const createButtonSelectors = [
    'button:has-text("Create")',
    'button:has-text("Add")',
    'button:has-text("New")',
    '[data-testid*="create"]',
    '[data-testid*="add"]',
    'a:has-text("Create")',
    'button:has-text("Generate")',
  ];
  
  let createButton = null;
  for (const selector of createButtonSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        createButton = btn;
        console.log(`Found button with selector: ${selector}`);
        break;
      }
    } catch {
      // Continue
    }
  }
  
  if (!createButton) {
    console.log('No create button found. Page content:');
    const html = await page.content();
    console.log(html.slice(0, 2000));
  } else {
    console.log('Clicking create button...');
    
    // Set up response capture before clicking
    const responsePromise = page.waitForResponse(
      response => response.url().includes('openrouter.ai') && response.request().method() === 'POST',
      { timeout: 10000 }
    ).catch(() => null);
    
    await createButton.click();
    await page.waitForTimeout(2000);
    
    // Take screenshot after click
    await page.screenshot({ path: '/tmp/management-keys-after-click.png' });
    console.log('Post-click screenshot saved');
    
    // Look for form inputs
    const inputSelectors = [
      'input[type="text"]',
      'input[placeholder*="name" i]',
      'input[name*="name"]',
      'input#name',
    ];
    
    let nameInput = null;
    for (const selector of inputSelectors) {
      try {
        const input = page.locator(selector).first();
        if (await input.isVisible({ timeout: 1000 })) {
          nameInput = input;
          console.log(`Found input with selector: ${selector}`);
          break;
        }
      } catch {
        // Continue
      }
    }
    
    if (nameInput) {
      console.log('Filling name input...');
      const uniqueName = `Hydra Capture ${Date.now()}`;
      await nameInput.fill(uniqueName);
      await page.waitForTimeout(500);
      
      // Look for submit button
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Save")',
        'button:has-text("Create")',
        'button:has-text("Confirm")',
        'button:has-text("Generate")',
      ];
      
      let submitButton = null;
      for (const selector of submitSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.isVisible({ timeout: 1000 })) {
            submitButton = btn;
            console.log(`Found submit button with selector: ${selector}`);
            break;
          }
        } catch {
          // Continue
        }
      }
      
      if (submitButton) {
        console.log('Clicking submit button...');
        
        // Set up response capture
        const submitResponsePromise = page.waitForResponse(
          response => response.url().includes('openrouter.ai') && 
                     (response.request().method() === 'POST' || response.request().method() === 'PUT'),
          { timeout: 15000 }
        ).catch(() => null);
        
        await submitButton.click();
        
        const submitResponse = await submitResponsePromise;
        if (submitResponse) {
          console.log(`\n🎯 CAPTURED SUBMIT RESPONSE:`);
          console.log(`  URL: ${submitResponse.url()}`);
          console.log(`  Status: ${submitResponse.status()}`);
          console.log(`  Method: ${submitResponse.request().method()}`);
          
          const requestHeaders = submitResponse.request().headers();
          console.log(`  Request Headers:`);
          for (const [key, value] of Object.entries(requestHeaders)) {
            if (!['cookie', 'authorization'].includes(key.toLowerCase())) {
              console.log(`    ${key}: ${value}`);
            }
          }
          
          const postData = submitResponse.request().postData();
          if (postData) {
            console.log(`  Post Data: ${postData.slice(0, 500)}`);
          }
          
          // Try to get response body
          try {
            const body = await submitResponse.text();
            console.log(`  Response Body Preview: ${body.slice(0, 500)}`);
            
            const keyMatch = body.match(/sk-or-v1-[a-zA-Z0-9_.-]+/);
            if (keyMatch) {
              console.log(`\n🎉 KEY FOUND IN RESPONSE: ${keyMatch[0].slice(0, 30)}...`);
            }
          } catch (e) {
            console.log(`  Could not read response body: ${e.message}`);
          }
        }
        
        await page.waitForTimeout(4000);
        
        // Final screenshot
        await page.screenshot({ path: '/tmp/management-keys-final.png' });
        console.log('Final screenshot saved');
      }
    }
  }
  
  // Save all captured traffic
  console.log('\n' + '='.repeat(80));
  console.log(`Captured ${capturedRequests.length} requests/responses`);
  console.log('='.repeat(80));
  
  // Filter to interesting requests (POST/PUT/PATCH)
  const interestingRequests = capturedRequests.filter(
    r => r.type === 'request' && ['POST', 'PUT', 'PATCH'].includes(r.method)
  );
  
  console.log(`Interesting requests: ${interestingRequests.length}`);
  
  for (const req of interestingRequests) {
    console.log(`\n${req.method} ${req.url}`);
    console.log(`  Headers:`, JSON.stringify(req.headers, null, 2).slice(0, 500));
    if (req.postData) {
      console.log(`  Post Data: ${req.postData.slice(0, 500)}`);
    }
  }
  
  // Save to file
  const outputFile = '/tmp/captured-traffic.json';
  fs.writeFileSync(outputFile, JSON.stringify(capturedRequests, null, 2));
  console.log(`\nFull traffic log saved to: ${outputFile}`);
  
  // Save interesting requests separately
  const interestingFile = '/tmp/captured-requests.json';
  fs.writeFileSync(interestingFile, JSON.stringify(interestingRequests, null, 2));
  console.log(`Interesting requests saved to: ${interestingFile}`);
  
  await browser.close();
  await prisma.$disconnect();
  
  console.log('\nCapture complete!');
}

captureNetworkTraffic().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
