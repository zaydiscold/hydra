import { chromium } from "playwright";
import fs from "fs";

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

async function captureRealRequests() {
  const store = await import("./server/services/store.js");

  const session = await store.getAccountSession(
    "26d94c8c-5294-4841-855c-2ae12d4490fe",
    "cecff6a9-cbcc-4110-93ec-409299474b82"
  );

  const freshJwt = await getFreshJwt(
    session.sessionCookie,
    session.clientCookie
  );

  console.log("🔍 CAPTURING REAL NETWORK REQUESTS");
  console.log("==================================");
  console.log("Session Expiry:", session.sessionExpiry);
  console.log("Fresh JWT:", freshJwt ? freshJwt.substring(0, 30) + "..." : "FAILED");
  console.log("");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  const capturedData = [];

  context.on("page", async (page) => {
    page.on("requestfinished", async (req) => {
      const url = req.url();
      if (!url.includes("openrouter.ai") || url.includes("css") || url.includes(".js") || url.includes("font")) {
        return;
      }

      try {
        const res = await req.response();
        if (!res) return;

        const reqData = {
          url: url,
          method: req.method(),
          headers: req.headers(),
          postData: req.postData()
        };

        const resData = {
          status: res.status(),
          headers: res.headers()
        };

        try {
          const contentType = res.headers()["content-type"] || "";
          if (contentType.includes("json")) {
            resData.body = await res.json();
          } else if (contentType.includes("text")) {
            resData.bodyText = await res.text();
          }
        } catch(e) {
          resData.bodyError = e.message;
        }

        capturedData.push({ request: reqData, response: resData, timestamp: Date.now() });

        console.log("\n📡 REQUEST:", req.method(), url);
        console.log("  Headers:", JSON.stringify(req.headers(), null, 2));
        if (req.postData()) {
          console.log("  Body:", req.postData());
        }
        console.log("📥 RESPONSE:", res.status(), res.statusText());
        if (resData.body) {
          console.log("  JSON:", JSON.stringify(resData.body, null, 2).substring(0, 500));
        } else if (resData.bodyText) {
          console.log("  Text:", resData.bodyText.substring(0, 300));
        }
        console.log("==================================");
      } catch(e) {
        console.log("Error:", e.message);
      }
    });
  });

  const page = await context.newPage();

  const clientParts = {};
  for (const part of session.clientCookie.split("; ")) {
    if (part.includes("=")) {
      const idx = part.indexOf("=");
      clientParts[part.slice(0, idx)] = part.slice(idx + 1);
    }
  }

  const cookies = [
    { name: "__session", value: freshJwt || session.sessionCookie, domain: "openrouter.ai", path: "/" },
    { name: "__client", value: clientParts["__client"], domain: "openrouter.ai", path: "/" },
    { name: "__client_uat", value: clientParts["__client_uat"], domain: "openrouter.ai", path: "/" },
    { name: "__cf_bm", value: clientParts["__cf_bm"], domain: "openrouter.ai", path: "/" },
    { name: "_cfuvid", value: clientParts["_cfuvid"], domain: "openrouter.ai", path: "/" }
  ].filter(c => c.value);

  await context.addCookies(cookies);

  console.log("Navigating to management keys...");
  await page.goto("https://openrouter.ai/settings/management-keys");

  await page.waitForTimeout(3000);

  console.log("\n\n🔘 Looking for Create/Add button...");

  const selectors = [
    'button:has-text("Create")',
    'button:has-text("Add")',
    'button:has-text("New")',
    '[data-testid*="create"]',
    '[data-testid*="add"]',
    'a:has-text("Create")'
  ];

  let createBtn = null;
  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible().catch(() => false)) {
      createBtn = btn;
      console.log("Found button with selector:", selector);
      break;
    }
  }

  if (createBtn) {
    console.log("Clicking Create button...");
    await createBtn.click();
    await page.waitForTimeout(2000);

    const inputSelectors = [
      'input[type="text"]',
      'input[placeholder*="name" i]',
      'input[name*="name"]'
    ];

    let nameInput = null;
    for (const selector of inputSelectors) {
      const input = page.locator(selector).first();
      if (await input.isVisible().catch(() => false)) {
        nameInput = input;
        console.log("Found input with selector:", selector);
        break;
      }
    }

    if (nameInput) {
      console.log("Filling name input...");
      await nameInput.fill("Network Capture Test");
      await page.waitForTimeout(500);

      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Save")',
        'button:has-text("Create")',
        'button:has-text("Confirm")'
      ];

      let submitBtn = null;
      for (const selector of submitSelectors) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible().catch(() => false)) {
          submitBtn = btn;
          console.log("Found submit button with selector:", selector);
          break;
        }
      }

      if (submitBtn) {
        console.log("Submitting form...");
        await submitBtn.click();
        await page.waitForTimeout(4000);
      }
    }
  } else {
    console.log("No Create button found - page content:");
    const html = await page.content();
    console.log(html.substring(0, 1500));
  }

  console.log("\n\n📊 CAPTURE COMPLETE");
  console.log("Total requests:", capturedData.length);

  fs.writeFileSync("/tmp/captured-requests.json", JSON.stringify(capturedData, null, 2));
  console.log("Saved to /tmp/captured-requests.json");

  await browser.close();
}

captureRealRequests().catch(console.error);
