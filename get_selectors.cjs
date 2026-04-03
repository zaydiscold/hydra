const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  await page.goto('https://openrouter.ai/sign-up', { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  
  // Get all inputs
  const inputs = await page.locator('input').all();
  console.log('INPUTS:');
  for (const input of inputs.slice(0, 10)) {
    try {
      const type = await input.getAttribute('type') || 'no-type';
      const name = await input.getAttribute('name') || 'no-name';
      const id = await input.getAttribute('id') || 'no-id';
      const placeholder = await input.getAttribute('placeholder') || 'no-placeholder';
      const label = await input.getAttribute('aria-label') || 'no-label';
      console.log(`  type=${type} name=${name} id=${id} placeholder=${placeholder.slice(0, 30)} aria-label=${label.slice(0, 30)}`);
    } catch (e) {}
  }
  
  // Get all buttons
  const buttons = await page.locator('button').all();
  console.log('\nBUTTONS:');
  for (const btn of buttons.slice(0, 10)) {
    try {
      const text = await btn.textContent();
      const type = await btn.getAttribute('type') || 'no-type';
      console.log(`  type=${type} text="${text?.slice(0, 40)}"`);
    } catch (e) {}
  }
  
  await browser.close();
})();
