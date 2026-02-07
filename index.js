import http from "http";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { chromium } from "playwright";

/* =====================================================
   1️⃣ HTTP SERVER (keep service alive)
===================================================== */
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Telegram Userbot + Playwright Running ✅");
}).listen(PORT, () => {
  console.log("🌐 Web Service active on port", PORT);
});

/* =====================================================
   2️⃣ ENV
===================================================== */
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.SESSION_STRING);

const SOURCE_CHAT = process.env.SOURCE_CHAT;
const DEST_CHAT = process.env.DESTINATION_CHAT;

/* =====================================================
   3️⃣ PLAYWRIGHT (single browser instance)
===================================================== */
let browser;

async function getBrowser() {
  if (browser) return browser;

  console.log("🧠 Launching Chromium...");
  browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });

  console.log("✅ Chromium Ready");
  return browser;
}

/* =====================================================
   4️⃣ FAYM → MEESHO (REAL BROWSER UNSHORT)
===================================================== */
async function unshortFaymWithBrowser(url) {
  const br = await getBrowser();
  const page = await br.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    // Faym JS redirect ka wait
    await page.waitForTimeout(6000);

    const finalUrl = page.url();

    await page.close();

    if (finalUrl.includes("meesho.com")) {
      console.log("✅ Faym resolved via browser");
      return finalUrl;
    }

    console.log("⛔ Faym resolved but not Meesho");
    return null;

  } catch (e) {
    await page.close();
    console.log("❌ Playwright error:", e.message);
    return null;
  }
}

/* =====================================================
   5️⃣ TELEGRAM USERBOT
===================================================== */
(async () => {
  console.log("🚀 Telegram Bot Starting...");

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();
  console.log("✅ Telegram Connected");

  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg || !msg.peerId) return;

    try {
      const chatId = (await client.getPeerId(msg.peerId)).toString();
      if (chatId !== SOURCE_CHAT) return;

      let text = msg.message || "";
      const urls = text.match(/https?:\/\/[^\s]+/g) || [];

      for (const u of urls) {
        if (u.includes("faym.co")) {
          const finalUrl = await unshortFaymWithBrowser(u);

          if (!finalUrl) {
            console.log("⛔ Faym → Meesho not found, skip post");
            return; // ❌ poora message skip
          }

          text = text.replaceAll(u, finalUrl);
        }
      }

      /* MEDIA */
      if (msg.media) {
        await client.sendFile(DEST_CHAT, {
          file: msg.media,
          caption: text || undefined
        });
        console.log("📸 Media forwarded");
        return;
      }

      /* TEXT */
      if (text.trim()) {
        await client.invoke(
          new Api.messages.SendMessage({
            peer: DEST_CHAT,
            message: text
          })
        );
        console.log("📝 Text forwarded");
      }

    } catch (err) {
      console.error("❌ Handler error:", err.message);
    }
  }, new NewMessage({}));

})();

/* =====================================================
   6️⃣ GRACEFUL SHUTDOWN
===================================================== */
process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit(0);
});
