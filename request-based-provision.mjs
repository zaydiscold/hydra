import axios from 'axios';
import * as cheerio from 'cheerio';
import * as store from './server/services/store.js';

const OR_BASE = 'https://openrouter.ai';

async function getFreshJwt(sessionCookie, clientCookie) {
  const fullCookie = `__session=${sessionCookie}; ${clientCookie}`;
  try {
    const res = await fetch("https://clerk.openrouter.ai/v1/client?_clerk_js_version=5.0.0", {
      headers: {
        "Cookie": fullCookie,
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

async function requestBasedProvisioning(accountId) {
  console.log("🔧 REQUEST-BASED PROVISIONING");
  console.log("==============================");
  
  // 1. Get session
  const session = await store.getAccountSession(
    "26d94c8c-5294-4841-855c-2ae12d4490fe",
    accountId
  );
  
  // 2. Get fresh JWT
  const freshJwt = await getFreshJwt(session.sessionCookie, session.clientCookie);
  const jwtToUse = freshJwt || session.sessionCookie;
  
  // 3. Parse clientCookie for all cookies
  const cookies = {};
  for (const part of session.clientCookie.split("; ")) {
    if (part.includes("=")) {
      const idx = part.indexOf("=");
      cookies[part.slice(0, idx)] = part.slice(idx + 1);
    }
  }
  
  // 4. Build cookie string
  const cookieString = [
    `__session=${jwtToUse}`,
    cookies.__client && `__client=${cookies.__client}`,
    cookies.__client_uat && `__client_uat=${cookies.__client_uat}`,
    cookies.__cf_bm && `__cf_bm=${cookies.__cf_bm}`,
    cookies._cfuvid && `_cfuvid=${cookies._cfuvid}`,
  ].filter(Boolean).join("; ");
  
  console.log("Cookie string:", cookieString.substring(0, 100) + "...");
  
  // 5. Create axios instance with cookies
  const http = axios.create({
    baseURL: OR_BASE,
    headers: {
      'Cookie': cookieString,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://openrouter.ai/',
    },
    maxRedirects: 5,
    validateStatus: () => true, // Don't throw on any status
  });
  
  // 6. GET the management keys page
  console.log("\n📥 GET /settings/management-keys");
  const getResponse = await http.get('/settings/management-keys');
  
  console.log("Status:", getResponse.status);
  console.log("Content-Type:", getResponse.headers['content-type']);
  console.log("Response length:", getResponse.data?.length || 0);
  
  if (getResponse.status === 302 || getResponse.status === 301) {
    console.log("Redirect location:", getResponse.headers.location);
  }
  
  // 7. Check if we got HTML
  const isHtml = typeof getResponse.data === 'string' && 
                 (getResponse.data.includes('<!DOCTYPE html>') || 
                  getResponse.data.includes('<html'));
  
  if (!isHtml) {
    console.log("Response preview:", JSON.stringify(getResponse.data).substring(0, 500));
    return { success: false, error: "No HTML returned" };
  }
  
  // 8. Parse HTML with Cheerio
  const $ = cheerio.load(getResponse.data);
  
  console.log("\n🔍 PARSING HTML...");
  
  // Look for CSRF tokens
  const csrfToken = $('input[name="csrf_token"]').val() ||
                    $('meta[name="csrf-token"]').attr('content') ||
                    $('input[name="_token"]').val() ||
                    $('input[name="__token"]').val();
  console.log("CSRF Token found:", csrfToken ? "YES" : "NO", csrfToken?.substring(0, 30));
  
  // Look for forms
  const forms = $('form');
  console.log("Forms found:", forms.length);
  
  forms.each((i, form) => {
    const action = $(form).attr('action') || 'current page';
    const method = $(form).attr('method') || 'GET';
    console.log(`  Form ${i}: ${method} ${action}`);
    
    // List all inputs
    const inputs = $(form).find('input');
    inputs.each((j, input) => {
      const name = $(input).attr('name');
      const type = $(input).attr('type');
      const value = $(input).val();
      console.log(`    Input: ${name} (${type}) = ${value?.substring(0, 30)}`);
    });
  });
  
  // Look for buttons
  const buttons = $('button');
  console.log("\nButtons found:", buttons.length);
  buttons.each((i, btn) => {
    const text = $(btn).text().trim();
    const type = $(btn).attr('type');
    console.log(`  Button ${i}: "${text}" (type=${type})`);
  });
  
  // Look for Create/Add links or buttons
  const createElements = $('[data-testid*="create"], [data-testid*="add"], button:contains("Create"), button:contains("Add"), a:contains("Create"), a:contains("Add")');
  console.log("\nCreate/Add elements:", createElements.length);
  
  // Look for any hidden inputs with state
  const hiddenInputs = $('input[type="hidden"]');
  console.log("\nHidden inputs:", hiddenInputs.length);
  hiddenInputs.each((i, input) => {
    const name = $(input).attr('name');
    const value = $(input).val();
    if (name && value) {
      console.log(`  ${name}: ${value.substring(0, 50)}...`);
    }
  });
  
  // Look for script tags with data
  const scripts = $('script');
  console.log("\nScript tags:", scripts.length);
  scripts.each((i, script) => {
    const text = $(script).text();
    if (text.includes('window.__') || text.includes('initial') || text.includes('csrf')) {
      console.log(`  Script ${i} contains interesting data:`, text.substring(0, 200));
    }
  });
  
  // Check page title
  const title = $('title').text();
  console.log("\nPage title:", title);
  
  // Check if it's actually a login page (Management Keys page has 'clerk' in scripts too)
  const isLoginPage = title.toLowerCase().includes('sign in') || 
                      title.toLowerCase().includes('login') ||
                      getResponse.data.includes('sign-in?redirect');
  
  if (isLoginPage) {
    console.log("\n⚠️  REDIRECTED TO LOGIN PAGE - Session invalid/expired");
    return { success: false, error: "Session expired, needs re-authentication" };
  }
  
  console.log("\n✅ On Management Keys page (not login)");
  
  // Try to find any API endpoints in the page
  const apiMatches = getResponse.data.match(/\/api\/[^"'\s]+/g);
  if (apiMatches) {
    const uniqueApis = [...new Set(apiMatches)].slice(0, 10);
    console.log("\nAPI endpoints found in HTML:", uniqueApis);
  }
  
  // Try POST if we found a form
  if (forms.length > 0) {
    const form = forms.first();
    const action = $(form).attr('action') || '/settings/management-keys';
    const method = ($(form).attr('method') || 'POST').toUpperCase();
    
    // Build form data
    const formData = {};
    $(form).find('input').each((i, input) => {
      const name = $(input).attr('name');
      const value = $(input).val();
      if (name) formData[name] = value || '';
    });
    
    // Add our key name
    formData.name = formData.name || 'Hydra Request Key';
    
    console.log("\n📤 Attempting POST to", action);
    console.log("Form data:", JSON.stringify(formData, null, 2));
    
    const postResponse = await http({
      method: method,
      url: action,
      data: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    
    console.log("\nPOST response:");
    console.log("Status:", postResponse.status);
    console.log("Headers:", JSON.stringify(postResponse.headers, null, 2).substring(0, 500));
    
    if (typeof postResponse.data === 'string' && postResponse.data.includes('sk-or-v1-')) {
      const keyMatch = postResponse.data.match(/sk-or-v1-[a-f0-9]+/);
      if (keyMatch) {
        console.log("\n✅ KEY FOUND:", keyMatch[0].substring(0, 20) + "...");
        return { success: true, key: keyMatch[0] };
      }
    }
  }
  
  // Save HTML for inspection
  const fs = await import('fs');
  const path = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  
  const htmlPath = path.join(__dirname, 'mgmt-keys-page.html');
  fs.writeFileSync(htmlPath, getResponse.data);
  console.log("\n💾 HTML saved to", htmlPath);
  
  // Also save a sample of the scripts
  const $scripts = $('script');
  let scriptData = [];
  $scripts.each((i, script) => {
    const text = $(script).text();
    if (text.includes('self.__next_f') || text.includes('window.__') || text.includes('initial')) {
      scriptData.push({index: i, content: text.substring(0, 500)});
    }
  });
  fs.writeFileSync(
    path.join(__dirname, 'scripts-data.json'), 
    JSON.stringify(scriptData, null, 2)
  );
  console.log("💾 Scripts data saved to scripts-data.json");
  
  return { 
    success: false, 
    error: "Could not provision via request-based method",
    htmlLength: getResponse.data.length,
    title: title
  };
}

// Run it
const accountId = process.argv[2] || 'cecff6a9-cbcc-4110-93ec-409299474b82';
requestBasedProvisioning(accountId)
  .then(result => {
    console.log("\n==============================");
    console.log("RESULT:", JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  })
  .catch(err => {
    console.error("ERROR:", err);
    process.exit(1);
  });
