import { chromium } from 'playwright';
import fs from 'fs';

const OPENROUTER_BASE = 'https://openrouter.ai';

async function analyzePage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  // Capture console logs
  page.on('console', msg => {
    console.log(`[Console] ${msg.type()}: ${msg.text()}`);
  });
  
  // Capture network requests
  const networkLogs = [];
  page.on('request', request => {
    const url = request.url();
    if (url.includes('openrouter') && (url.includes('/api/') || url.includes('_next'))) {
      networkLogs.push({
        type: 'request',
        method: request.method(),
        url: url,
        headers: request.headers()
      });
    }
  });
  
  page.on('response', response => {
    const url = response.url();
    if (url.includes('openrouter') && url.includes('/api/')) {
      networkLogs.push({
        type: 'response',
        status: response.status(),
        url: url
      });
    }
  });
  
  console.log('Navigating to /settings/management-keys...');
  const response = await page.goto(`${OPENROUTER_BASE}/settings/management-keys`, { 
    waitUntil: 'networkidle',
    timeout: 30000 
  });
  
  console.log(`Page loaded: ${response.status()}`);
  console.log(`Final URL: ${page.url()}`);
  
  // Wait for React to render
  await page.waitForTimeout(5000);
  
  // 1. Screenshot the page
  console.log('\n=== 1. SCREENSHOT ===');
  await page.screenshot({ path: 'management-keys-page.png', fullPage: true });
  console.log('Screenshot saved to management-keys-page.png');
  
  // Check if we're on login page
  const currentUrl = page.url();
  const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/sign-in');
  
  if (isLoginPage) {
    console.log('\n⚠️ REDIRECTED TO LOGIN PAGE - Session required');
    
    // Analyze login page too
    await page.screenshot({ path: 'login-page.png', fullPage: true });
    console.log('Login page screenshot saved to login-page.png');
  }
  
  // 2. Find all buttons
  console.log('\n=== 2. ALL BUTTONS ===');
  const buttons = await page.$$('button');
  console.log(`Found ${buttons.length} buttons:\n`);
  
  const buttonData = [];
  for (let i = 0; i < buttons.length; i++) {
    const btn = buttons[i];
    const text = await btn.textContent();
    const type = await btn.getAttribute('type');
    const className = await btn.getAttribute('class');
    const dataTestId = await btn.getAttribute('data-testid');
    const id = await btn.getAttribute('id');
    const disabled = await btn.evaluate(el => el.disabled);
    
    const info = {
      index: i + 1,
      text: text?.trim() || '',
      type: type,
      className: className,
      dataTestId: dataTestId,
      id: id,
      disabled: disabled,
      selector: id ? `#${id}` : dataTestId ? `[data-testid="${dataTestId}"]` : `button:nth-of-type(${i + 1})`
    };
    buttonData.push(info);
    
    console.log(`Button ${i + 1}:`);
    console.log(`  Text: "${info.text}"`);
    console.log(`  Type: ${type}`);
    console.log(`  Class: ${className?.slice(0, 80)}`);
    console.log(`  data-testid: ${dataTestId}`);
    console.log(`  id: ${id}`);
    console.log(`  Disabled: ${disabled}`);
    console.log(`  Selector: ${info.selector}`);
    console.log('');
  }
  
  // 3. Find all form inputs
  console.log('\n=== 3. ALL FORM INPUTS ===');
  const inputs = await page.$$('input, textarea, select');
  console.log(`Found ${inputs.length} form elements:\n`);
  
  const inputData = [];
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const tagName = await input.evaluate(el => el.tagName.toLowerCase());
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    const id = await input.getAttribute('id');
    const placeholder = await input.getAttribute('placeholder');
    const className = await input.getAttribute('class');
    const dataTestId = await input.getAttribute('data-testid');
    const value = await input.inputValue().catch(() => '');
    const required = await input.evaluate(el => el.required);
    
    const info = {
      index: i + 1,
      tagName: tagName,
      type: type,
      name: name,
      id: id,
      placeholder: placeholder,
      className: className,
      dataTestId: dataTestId,
      value: value,
      required: required,
      selector: id ? `#${id}` : dataTestId ? `[data-testid="${dataTestId}"]` : name ? `${tagName}[name="${name}"]` : `${tagName}:nth-of-type(${i + 1})`
    };
    inputData.push(info);
    
    console.log(`${tagName} ${i + 1}:`);
    console.log(`  Type: ${type}`);
    console.log(`  Name: ${name}`);
    console.log(`  ID: ${id}`);
    console.log(`  Placeholder: ${placeholder}`);
    console.log(`  Class: ${className?.slice(0, 80)}`);
    console.log(`  data-testid: ${dataTestId}`);
    console.log(`  Required: ${required}`);
    console.log(`  Value: ${value?.substring(0, 50)}`);
    console.log(`  Selector: ${info.selector}`);
    console.log('');
  }
  
  // 4. Analyze form structure
  console.log('\n=== 4. FORM STRUCTURE ===');
  const forms = await page.$$('form');
  console.log(`Found ${forms.length} forms\n`);
  
  const formData = [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const action = await form.getAttribute('action');
    const method = await form.getAttribute('method');
    const className = await form.getAttribute('class');
    const dataTestId = await form.getAttribute('data-testid');
    
    const formInputs = await form.$$('input, textarea, select, button');
    
    const info = {
      index: i + 1,
      action: action,
      method: method,
      className: className,
      dataTestId: dataTestId,
      elementCount: formInputs.length
    };
    formData.push(info);
    
    console.log(`Form ${i + 1}:`);
    console.log(`  Action: ${action}`);
    console.log(`  Method: ${method}`);
    console.log(`  Class: ${className?.slice(0, 80)}`);
    console.log(`  data-testid: ${dataTestId}`);
    console.log(`  Contains ${formInputs.length} elements`);
    console.log('');
  }
  
  // 5. Check for data-testid attributes globally
  console.log('\n=== 5. ALL DATA-TESTID ATTRIBUTES ===');
  const elementsWithTestId = await page.$$('[data-testid]');
  console.log(`Found ${elementsWithTestId.length} elements with data-testid\n`);
  
  const testIdData = [];
  for (const el of elementsWithTestId) {
    const testId = await el.getAttribute('data-testid');
    const tagName = await el.evaluate(el => el.tagName.toLowerCase());
    const text = await el.textContent();
    testIdData.push({ testId, tagName, text: text?.trim().slice(0, 50) });
    console.log(`[data-testid="${testId}"] (${tagName}) - "${text?.trim().slice(0, 50)}"`);
  }
  
  // 6. Look for React component clues
  console.log('\n=== 6. REACT COMPONENT CLUES ===');
  
  // Check for React root
  const reactRoot = await page.$('#__next, #root, [data-reactroot]');
  console.log(`React root found: ${reactRoot ? 'YES' : 'NO'}`);
  
  // Check for Next.js
  const nextRoot = await page.$('#__next');
  console.log(`Next.js app detected: ${nextRoot ? 'YES' : 'NO'}`);
  
  // Check for common React classes
  const reactClasses = await page.evaluate(() => {
    const allElements = document.querySelectorAll('*');
    const classHints = [];
    const seen = new Set();
    for (const el of allElements) {
      const classes = el.className;
      if (typeof classes === 'string') {
        // Look for CSS-in-JS patterns
        if (classes.includes('css-') && !seen.has(classes)) {
          seen.add(classes);
          classHints.push({ tag: el.tagName, class: classes.slice(0, 100) });
        }
        // Look for Tailwind patterns
        if ((classes.includes('bg-') || classes.includes('text-')) && !seen.has(classes)) {
          seen.add(classes);
          if (classHints.length < 30) {
            classHints.push({ tag: el.tagName, class: classes.slice(0, 100), type: 'tailwind' });
          }
        }
      }
    }
    return classHints.slice(0, 30);
  });
  
  console.log(`\nSample CSS classes found (${reactClasses.length}):`);
  reactClasses.forEach((c, i) => console.log(`  ${i + 1}. ${c.tag}: ${c.class?.slice(0, 100)}`));
  
  // 7. Check page source for API hints
  console.log('\n=== 7. API ENDPOINT HINTS ===');
  
  // Check for __NEXT_DATA__
  const nextData = await page.evaluate(() => {
    return window.__NEXT_DATA__ || null;
  });
  
  if (nextData) {
    console.log('Found window.__NEXT_DATA__:');
    console.log(JSON.stringify(nextData, null, 2).substring(0, 2000));
    fs.writeFileSync('next-data.json', JSON.stringify(nextData, null, 2));
    console.log('\nFull __NEXT_DATA__ saved to next-data.json');
  } else {
    console.log('No window.__NEXT_DATA__ found');
  }
  
  // Get page HTML and look for API patterns
  const html = await page.content();
  
  // Look for API endpoints in scripts
  const apiPatterns = [
    /\/api\/[^"\s<>]+/g,
    /https:\/\/[^"\s<>]*openrouter\.ai[^"\s<>]*/g,
    /["']\/(?:settings|keys|management)[^"\s<>]*["']/g,
    /fetch\(["'][^"\s<>]+["']/g,
    /apiKey/i,
    /management.?key/i,
    /createKey/i,
    /generateKey/i
  ];
  
  console.log('\n=== 8. SOURCE CODE PATTERNS ===');
  
  // Extract script tags content
  const scriptContents = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script:not([src])'))
      .map(s => s.textContent)
      .join('\n');
  });
  
  // Look for API routes in inline scripts
  const apiMatches = scriptContents.match(/\/api\/[^"'\s\]\)]+/g) || [];
  const uniqueApis = [...new Set(apiMatches)].slice(0, 30);
  
  console.log('API endpoints found in scripts:');
  uniqueApis.forEach(api => console.log(`  ${api}`));
  
  // Look for tRPC routes
  const trpcMatches = scriptContents.match(/trpc[^"'\s]*/gi) || [];
  if (trpcMatches.length > 0) {
    console.log('\ntRPC references found:');
    [...new Set(trpcMatches)].slice(0, 20).forEach(m => console.log(`  ${m}`));
  }
  
  // Check for key management related strings
  const keyPatterns = [
    'createKey',
    'generateKey', 
    'deleteKey',
    'apiKey',
    'managementKey',
    'keyData',
    'keyName',
    'keyHash',
    'maskedKey'
  ];
  
  console.log('\nKey management function references:');
  for (const pattern of keyPatterns) {
    const regex = new RegExp(pattern, 'gi');
    const matches = scriptContents.match(regex);
    if (matches) {
      console.log(`  ${pattern}: ${matches.length} occurrences`);
    }
  }
  
  // 9. Save full analysis
  const fullAnalysis = {
    url: page.url(),
    timestamp: new Date().toISOString(),
    isLoginPage: isLoginPage,
    buttons: buttonData,
    inputs: inputData,
    forms: formData,
    testIds: testIdData,
    hasNextData: !!nextData,
    networkLogs: networkLogs.slice(0, 50),
    apiEndpoints: uniqueApis
  };
  
  fs.writeFileSync('dom-analysis.json', JSON.stringify(fullAnalysis, null, 2));
  console.log('\n=== Full analysis saved to dom-analysis.json ===');
  
  // 10. Try to find modal/dialog elements
  console.log('\n=== 9. MODAL/DIALOG ELEMENTS ===');
  const modals = await page.$$('[role="dialog"], .modal, [data-testid*="modal"], [data-testid*="dialog"], [aria-modal="true"]');
  console.log(`Found ${modals.length} potential modal/dialog elements`);
  
  if (modals.length > 0) {
    for (let i = 0; i < modals.length; i++) {
      const modal = modals[i];
      const className = await modal.getAttribute('class');
      const role = await modal.getAttribute('role');
      const ariaModal = await modal.getAttribute('aria-modal');
      const text = await modal.textContent();
      
      console.log(`\nModal ${i + 1}:`);
      console.log(`  Role: ${role}`);
      console.log(`  Aria-modal: ${ariaModal}`);
      console.log(`  Class: ${className?.slice(0, 80)}`);
      console.log(`  Text preview: ${text?.slice(0, 100)}...`);
    }
  }
  
  await browser.close();
  
  console.log('\n========================================');
  console.log('ANALYSIS COMPLETE');
  console.log('========================================');
  console.log('\nFiles created:');
  console.log('  - management-keys-page.png (screenshot)');
  console.log('  - login-page.png (if redirected)');
  console.log('  - dom-analysis.json (full data)');
  console.log('  - next-data.json (Next.js data if found)');
}

analyzePage().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
