#!/usr/bin/env node
/**
 * Enhanced Network Capture for OpenRouter Management Key Creation
 * Captures REAL network requests including tRPC, REST, and Next.js Server Actions
 */

import { chromium } from "playwright";
import fs from "fs";

// Account credentials
const USER_ID = '26d94c8c-5294-4841-855c-2ae12d4490fe';
const ACCOUNT_ID = 'cecff6a9-cbcc-4110-93ec-409299474b82';

async function getFreshJwt(sessionCookie, clientCookie) {
  const fullCookie = `__session=${sessionCookie}; ${clientCookie}`;
  try {
    const res = await fetch("https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0", {
      headers: {
        "Cookie": fullCookie,
        "Origin": "https://openrouter.ai",
        "Referer": "https://openrouter.ai/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      }
    });
    const data = await res.json();
    return data?.response?.sessions?.[0]?.last_active_token?.jwt;
  } catch(e) {
    console.error("Failed to get fresh JWT:", e.message);
    return null;
  }
}

async function captureRealRequests() {
  const store = await import("./server/services/store.js");

  const session = await store.getAccountSession(USER_ID, ACCOUNT_ID);
  if (!session) {
    console.error("❌ No session found for account", ACCOUNT_ID);
    process.exit(1);
  }

  const freshJwt = await getFreshJwt(session.sessionCookie, session.clientCookie);

  console.log("🔍 CAPTURING REAL NETWORK REQUESTS - MANAGEMENT KEY CREATION");
  console.log("============================================================");
  console.log("Account ID:", ACCOUNT_ID);
  console.log("Session Expiry:", session.sessionExpiry);
  console.log("Fresh JWT:", freshJwt ? "✅ Obtained (" + freshJwt.substring(0, 30) + "...)" : "❌ FAILED");
  console.log("");

  const browser = await chromium.launch({ headless: true }); // Headless mode for automated capture
  const context = await browser.newContext();

  const capturedRequests = [];
  const capturedApiCalls = [];

  // Intercept all requests BEFORE they are sent
  await context.route('**/*', async (route, request) => {
    const url = request.url();
    const method = request.method();
    const headers = request.headers();
    const postData = request.postData();

    // Capture relevant API calls
    if (url.includes('openrouter.ai') && 
        (url.includes('/api/') || url.includes('/trpc') || url.includes('/_next/') || headers['next-action'])) {
      
      const capture = {
        type: 'request',
        timestamp: new Date().toISOString(),
        url: url,
        method: method,
        headers: headers,
        postData: postData,
        isNextAction: !!headers['next-action'],
        isTrpc: url.includes('/trpc') || url.includes('/api/trpc'),
        isRest: url.includes('/api/') && !url.includes('/trpc') && !url.includes('/_next/'),
      };
      
      capturedRequests.push(capture);
      
      // Print immediately for real-time monitoring
      console.log("\n📡 REQUEST CAPTURED");
      console.log("  URL:", method, url);
      console.log("  Type:", capture.isNextAction ? "Next.js Server Action" : capture.isTrpc ? "tRPC" : capture.isRest ? "REST API" : "Other");
      
      if (headers['next-action']) {
        console.log("  ⚡ Next-Action Header:", headers['next-action']);
      }
      
      if (headers['content-type']) {
        console.log("  Content-Type:", headers['content-type']);
      }
      
      if (postData) {
        console.log("  Body (first 1000 chars):", postData.substring(0, 1000));
      }
    }
    
    // Continue the request
    await route.continue();
  });

  // Capture responses
  context.on("page", async (page) => {
    page.on("response", async (response) => {
      const request = response.request();
      const url = request.url();
      
      if (url.includes('openrouter.ai') && 
          (url.includes('/api/') || url.includes('/trpc') || request.headers()['next-action'])) {
        
        try {
          const status = response.status();
          const responseHeaders = response.headers();
          
          let body = null;
          let bodyError = null;
          
          try {
            const contentType = responseHeaders['content-type'] || '';
            if (contentType.includes('json')) {
              body = await response.json();
            } else if (contentType.includes('text')) {
              body = await response.text();
            }
          } catch(e) {
            bodyError = e.message;
          }
          
          const capture = {
            type: 'response',
            timestamp: new Date().toISOString(),
            url: url,
            status: status,
            headers: responseHeaders,
            body: body,
            bodyError: bodyError,
          };
          
          capturedApiCalls.push(capture);
          
          console.log("\n📥 RESPONSE CAPTURED");
          console.log("  URL:", url);
          console.log("  Status:", status);
          if (body && typeof body === 'object') {
            console.log("  Body (JSON):", JSON.stringify(body, null, 2).substring(0, 1000));
          } else if (body && typeof body === 'string') {
            console.log("  Body (Text):", body.substring(0, 500));
          }
          
        } catch(e) {
          console.log("Error capturing response:", e.message);
        }
      }
    });
  });

  const page = await context.newPage();

  // Parse client cookies
  const clientParts = {};
  if (session.clientCookie) {
    for (const part of session.clientCookie.split("; ")) {
      if (part.includes("=")) {
        const idx = part.indexOf("=");
        clientParts[part.slice(0, idx)] = part.slice(idx + 1);
      }
    }
  }

  // Set up cookies
  const cookies = [
    { name: "__session", value: freshJwt || session.sessionCookie, domain: "openrouter.ai", path: "/" },
    { name: "__client", value: clientParts["__client"], domain: "openrouter.ai", path: "/" },
    { name: "__client_uat", value: clientParts["__client_uat"], domain: "openrouter.ai", path: "/" },
    { name: "__cf_bm", value: clientParts["__cf_bm"], domain: "openrouter.ai", path: "/" },
    { name: "_cfuvid", value: clientParts["_cfuvid"], domain: "openrouter.ai", path: "/" }
  ].filter(c => c.value);

  await context.addCookies(cookies);

  console.log("\n🌐 STEP 1: Navigating to management keys page...");
  await page.goto("https://openrouter.ai/settings/management-keys");
  await page.waitForTimeout(3000);

  // Take a screenshot for debugging
  await page.screenshot({ path: '/tmp/01-management-keys-page.png' });
  console.log("📸 Screenshot saved: /tmp/01-management-keys-page.png");

  console.log("\n🔘 STEP 2: Looking for Create/Add button...");

  // Try multiple selectors for the create button
  const createButtonSelectors = [
    'button:has-text("Create")',
    'button:has-text("Add")',
    'button:has-text("New")',
    'button:has-text("Create management key")',
    'button:has-text("Add management key")',
    'a:has-text("Create")',
    'a:has-text("Add")',
    '[data-testid*="create"]',
    '[data-testid*="add"]',
    'button[class*="create"]',
    'button[class*="add"]',
  ];

  let createBtn = null;
  let usedSelector = null;
  
  for (const selector of createButtonSelectors) {
    try {
      const btn = page.locator(selector).first();
      const isVisible = await btn.isVisible().catch(() => false);
      if (isVisible) {
        createBtn = btn;
        usedSelector = selector;
        console.log("✅ Found Create button with selector:", selector);
        break;
      }
    } catch(e) {
      // Continue to next selector
    }
  }

  if (!createBtn) {
    console.log("❌ No Create button found with standard selectors");
    console.log("📄 Page HTML:");
    const html = await page.content();
    console.log(html.substring(0, 3000));
    fs.writeFileSync('/tmp/page-debug.html', html);
    console.log("📄 Full HTML saved to /tmp/page-debug.html");
  } else {
    console.log("\n🖱️ STEP 3: Clicking Create button...");
    await createBtn.click();
    await page.waitForTimeout(2000);
    
    await page.screenshot({ path: '/tmp/02-create-dialog.png' });
    console.log("📸 Screenshot saved: /tmp/02-create-dialog.png");

    console.log("\n📝 STEP 4: Looking for form inputs...");
    
    // Find name input
    const inputSelectors = [
      'input[type="text"]',
      'input[name*="name"]',
      'input[placeholder*="name" i]',
      'input[id*="name"]',
      'input[aria-label*="name" i]',
      'textarea[name*="name"]',
      'textarea[placeholder*="name" i]',
    ];

    let nameInput = null;
    let inputSelector = null;
    
    for (const selector of inputSelectors) {
      try {
        const input = page.locator(selector).first();
        const isVisible = await input.isVisible().catch(() => false);
        if (isVisible) {
          nameInput = input;
          inputSelector = selector;
          console.log("✅ Found name input with selector:", selector);
          break;
        }
      } catch(e) {
        // Continue
      }
    }

    if (nameInput) {
      console.log("\n⌨️ STEP 5: Filling form...");
      await nameInput.fill("Network Capture Test Key");
      await page.waitForTimeout(500);
      
      await page.screenshot({ path: '/tmp/03-form-filled.png' });
      console.log("📸 Screenshot saved: /tmp/03-form-filled.png");

      // Look for submit button
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Save")',
        'button:has-text("Create")',
        'button:has-text("Submit")',
        'button:has-text("Confirm")',
        'button:has-text("Add")',
        'button[class*="submit"]',
        'button[class*="save"]',
      ];

      let submitBtn = null;
      let submitSelector = null;
      
      for (const selector of submitSelectors) {
        try {
          const btn = page.locator(selector).first();
          const isVisible = await btn.isVisible().catch(() => false);
          const isEnabled = await btn.isEnabled().catch(() => false);
          if (isVisible && isEnabled) {
            submitBtn = btn;
            submitSelector = selector;
            console.log("✅ Found submit button with selector:", selector);
            break;
          }
        } catch(e) {
          // Continue
        }
      }

      if (submitBtn) {
        console.log("\n🚀 STEP 6: Submitting form (this will trigger the API call)...");
        console.log("⏳ Capturing network activity...");
        
        // Clear previous captures to focus on the submit action
        const beforeLength = capturedRequests.length;
        
        await submitBtn.click();
        
        // Wait for network activity to complete
        await page.waitForTimeout(4000);
        
        await page.screenshot({ path: '/tmp/04-after-submit.png' });
        console.log("📸 Screenshot saved: /tmp/04-after-submit.png");
        
        // Show captured requests from the submit action
        const newRequests = capturedRequests.slice(beforeLength);
        console.log("\n📊 NEW REQUESTS CAPTURED AFTER SUBMIT:", newRequests.length);
        
        for (const req of newRequests) {
          console.log("\n  🔹", req.method, req.url);
          if (req.isNextAction) {
            console.log("     ⚡ NEXT-ACTION:", req.headers['next-action']);
          }
        }
      } else {
        console.log("❌ No submit button found");
      }
    } else {
      console.log("❌ No name input found");
    }
  }

  // Final analysis
  console.log("\n\n" + "=".repeat(80));
  console.log("📊 CAPTURE ANALYSIS");
  console.log("=".repeat(80));
  
  const nextActions = capturedRequests.filter(r => r.isNextAction);
  const trpcCalls = capturedRequests.filter(r => r.isTrpc);
  const restCalls = capturedRequests.filter(r => r.isRest);
  
  console.log("\nTotal requests captured:", capturedRequests.length);
  console.log("Next.js Server Actions:", nextActions.length);
  console.log("tRPC calls:", trpcCalls.length);
  console.log("REST API calls:", restCalls.length);
  
  if (nextActions.length > 0) {
    console.log("\n⚡ NEXT.JS SERVER ACTIONS DETECTED:");
    for (const action of nextActions) {
      console.log("\n  📌 ACTION ID:", action.headers['next-action']);
      console.log("     URL:", action.url);
      console.log("     Method:", action.method);
      console.log("     Content-Type:", action.headers['content-type']);
      if (action.postData) {
        console.log("     Body Preview:", action.postData.substring(0, 500));
      }
    }
  }
  
  if (trpcCalls.length > 0) {
    console.log("\n🔄 tRPC CALLS DETECTED:");
    for (const call of trpcCalls) {
      console.log("\n  📌 Route:", call.url);
      console.log("     Method:", call.method);
      if (call.postData) {
        console.log("     Body:", call.postData.substring(0, 500));
      }
    }
  }
  
  if (restCalls.length > 0) {
    console.log("\n🌐 REST API CALLS DETECTED:");
    for (const call of restCalls) {
      console.log("\n  📌 Endpoint:", call.url);
      console.log("     Method:", call.method);
      if (call.postData) {
        console.log("     Body:", call.postData.substring(0, 500));
      }
    }
  }

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    sessionExpiry: session.sessionExpiry,
    summary: {
      totalRequests: capturedRequests.length,
      nextActions: nextActions.length,
      trpcCalls: trpcCalls.length,
      restCalls: restCalls.length,
    },
    nextActions: nextActions,
    trpcCalls: trpcCalls,
    restCalls: restCalls,
    responses: capturedApiCalls,
    allRequests: capturedRequests,
  };
  
  fs.writeFileSync("/tmp/network-capture-report.json", JSON.stringify(report, null, 2));
  console.log("\n💾 Full report saved to: /tmp/network-capture-report.json");
  
  // Also save a focused analysis document
  const analysisDoc = generateAnalysisDoc(report);
  fs.writeFileSync("/tmp/api-analysis.md", analysisDoc);
  console.log("💾 Analysis document saved to: /tmp/api-analysis.md");

  await browser.close();
  console.log("\n✅ Capture complete!");
}

function generateAnalysisDoc(report) {
  let doc = `# OpenRouter Management Key Creation - API Analysis

Generated: ${report.timestamp}
Account ID: ${report.accountId}

## Summary

- Total Requests Captured: ${report.summary.totalRequests}
- Next.js Server Actions: ${report.summary.nextActions}
- tRPC Calls: ${report.summary.trpcCalls}
- REST API Calls: ${report.summary.restCalls}

`;

  if (report.nextActions.length > 0) {
    doc += `## Next.js Server Actions Detected

`;
    for (const action of report.nextActions) {
      doc += `### Action ID: \`${action.headers['next-action']}\`

- **URL**: ${action.url}
- **Method**: ${action.method}
- **Timestamp**: ${action.timestamp}

**Headers**:
\`\`\`json
${JSON.stringify(action.headers, null, 2)}
\`\`\`

`;
      if (action.postData) {
        doc += `**Request Body**:
\`\`\`
${action.postData}
\`\`\`

`;
      }
      doc += `---

`;
    }
  }

  if (report.trpcCalls.length > 0) {
    doc += `## tRPC Calls Detected

`;
    for (const call of report.trpcCalls) {
      doc += `### Route: ${call.url}

- **Method**: ${call.method}
- **Timestamp**: ${call.timestamp}

**Headers**:
\`\`\`json
${JSON.stringify(call.headers, null, 2)}
\`\`\`

`;
      if (call.postData) {
        doc += `**Request Body**:
\`\`\`json
${call.postData}
\`\`\`

`;
      }
      doc += `---

`;
    }
  }

  if (report.restCalls.length > 0) {
    doc += `## REST API Calls Detected

`;
    for (const call of report.restCalls) {
      doc += `### ${call.method} ${call.url}

- **Timestamp**: ${call.timestamp}

**Headers**:
\`\`\`json
${JSON.stringify(call.headers, null, 2)}
\`\`\`

`;
      if (call.postData) {
        doc += `**Request Body**:
\`\`\`json
${call.postData}
\`\`\`

`;
      }
      doc += `---

`;
    }
  }

  // Add response information
  if (report.responses.length > 0) {
    doc += `## API Responses

`;
    for (const resp of report.responses) {
      doc += `### Response for: ${resp.url}

- **Status**: ${resp.status}
- **Timestamp**: ${resp.timestamp}

`;
      if (resp.body && typeof resp.body === 'object') {
        doc += `**Response Body**:
\`\`\`json
${JSON.stringify(resp.body, null, 2).substring(0, 2000)}
\`\`\`

`;
      }
      doc += `---

`;
    }
  }

  doc += `## Conclusion

Based on the captured network traffic, the OpenRouter dashboard uses the following API pattern(s) for management key creation:

`;

  if (report.summary.nextActions > 0) {
    doc += `- **Next.js Server Actions**: The dashboard uses Next.js Server Actions (identified by the \`Next-Action\` header).
`;
  }
  if (report.summary.trpcCalls > 0) {
    doc += `- **tRPC**: The dashboard uses tRPC for API communication.
`;
  }
  if (report.summary.restCalls > 0) {
    doc += `- **REST API**: The dashboard uses traditional REST endpoints.
`;
  }

  doc += `
See the individual sections above for the exact request formats, headers, and payload structures.
`;

  return doc;
}

captureRealRequests().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
