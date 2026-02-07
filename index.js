import http from "http";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { chromium } from "playwright";

/* ================= HTTP SERVER (RENDER KEEP ALIVE) ================= */
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Telegram Userbot Running ✅");
}).listen(PORT, () => {
  console.log("🌐 Web Service active on port", PORT);
});

/* ================= ENV ================= */
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.SESSION_STRING);

const sourceChat = process.env.SOURCE_CHAT;
const destinationChat = process.env.DESTINATION_CHAT;

/* ================= RATE LIMIT ================= */
let messageTimestamps = [];

/* ================= PLAYWRIGHT ================= */
let browser;

async function getBrowser() {
  if (browser) return browser;

  console.log("🧠 Launching Chromium...");
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  console.log("✅ Chromium Ready");
  return browser;
}

/* ================= STRICT faym.co → meesho.com ================= */
async function unshortFaymStrict(url, depth = 0) {
  if (depth > 4) return null;

  let page;
  try {
    const br = await getBrowser();
    page = await br.newPage();

    let finalUrl = null;

    page.on("request", req => {
      const u = req.url();
      if (u.startsWith("http") && !u.includes("faym.co")) {
        finalUrl = u;
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(4000);
    await page.close();

    if (!finalUrl) return null;

    if (finalUrl.includes("meesho.com")) return finalUrl;
    if (finalUrl.includes("faym.co")) return unshortFaymStrict(finalUrl, depth + 1);

    return null;

  } catch (e) {
    if (page) await page.close();
    console.error("❌ Unshort Error:", e.message);
    return null;
  }
}

/* ================= START TELEGRAM USERBOT ================= */
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
      if (chatId !== sourceChat) return;

      /* ===== Flood Control ===== */
      const now = Math.floor(Date.now() / 1000);
      messageTimestamps = messageTimestamps.filter(t => t > now - 10);
      messageTimestamps.push(now);

      if (messageTimestamps.length > 10) {
        console.log("⚠️ Flood sleep");
        await new Promise(r => setTimeout(r, 60000));
        messageTimestamps = [];
      }

      let text = msg.message || "";

      const urls = text.match(/https?:\/\/[^\s]+/g) || [];
      let reject = false;

      for (const u of urls) {
        if (u.includes("faym.co")) {
          const finalUrl = await unshortFaymStrict(u);
          if (!finalUrl) {
            reject = true;
            break;
          }
          text = text.replaceAll(u, finalUrl);
        }
      }

      if (reject) {
        console.log("⛔ Rejected non-meesho link");
        return;
      }

      if (msg.media) {
        await client.sendFile(destinationChat, {
          file: msg.media,
          caption: text || undefined
        });
        console.log("📸 Media forwarded");
        return;
      }

      if (text.trim()) {
        await client.invoke(
          new Api.messages.SendMessage({
            peer: destinationChat,
            message: text,
            noWebpage: false
          })
        );
        console.log("📝 Text forwarded");
      }

    } catch (err) {
      console.error("❌ Handler Error:", err.message);
    }
  }, new NewMessage({}));

})();

/* ================= GRACEFUL SHUTDOWN ================= */
async function shutdown() {
  console.log("🛑 Shutting down...");
  if (browser) await browser.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
