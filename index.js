const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { NewMessage } = require("telegram/events");
const { chromium } = require("playwright");

/* ===== ENV ========== */
const apiId = parseInt(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.SESSION_STRING);

const sourceChat = process.env.SOURCE_CHAT || "-1003508245377";
const destinationChat = process.env.DESTINATION_CHAT || "-1001208173141";

/* ===== RATE LIMIT ===== */
let messageTimestamps = [];

/* ===== PLAYWRIGHT BROWSER ===== */
let browser;

/* ===== LAZY BROWSER START ===== */
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
   🔁 STRICT faym.co → ONLY meesho.com UNSHORT
===================================================== */
async function unshortFaymStrict(url, depth = 0) {
  if (depth > 6) return null; // safety limit

  let page;
  try {
    const br = await getBrowser();
    page = await br.newPage();

    let finalUrl = null;

    page.on("request", req => {
      const reqUrl = req.url();
      if (reqUrl.startsWith("http") && !reqUrl.includes("faym.co")) {
        finalUrl = reqUrl;
      }
    });

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    await page.waitForTimeout(6000);
    await page.close();

    if (!finalUrl) return null;

    // ✅ ACCEPT ONLY MEESHO
    if (finalUrl.includes("meesho.com")) {
      return finalUrl;
    }

    // 🔁 AGAIN faym.co → REPEAT
    if (finalUrl.includes("faym.co")) {
      return await unshortFaymStrict(finalUrl, depth + 1);
    }

    // ❌ ANYTHING ELSE → REJECT
    return null;

  } catch (err) {
    if (page) await page.close();
    console.error("❌ Unshort Error:", err.message);
    return null;
  }
}

/* =====================================================
   🚀 START BOT
===================================================== */
(async () => {
  console.log("🚀 Bot Starting...");

  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5
  });

  await client.connect();
  console.log("✅ Bot Connected | Watching:", sourceChat);

  client.addEventHandler(async (event) => {
    const message = event.message;
    if (!message || !message.peerId) return;

    try {
      const senderChatId = (await client.getPeerId(message.peerId)).toString();
      if (senderChatId !== sourceChat) return;

      /* ===== RATE LIMIT ===== */
      const now = Math.floor(Date.now() / 1000);
      messageTimestamps = messageTimestamps.filter(ts => ts > now - 10);
      messageTimestamps.push(now);

      if (messageTimestamps.length > 10) {
        console.log("⚠️ Flood Control Sleep...");
        await new Promise(r => setTimeout(r, 100000));
        messageTimestamps = [];
      }

      /* ===== TEXT / CAPTION ===== */
      let text = message.message || message.text || "";

      /* ===== PROCESS faym.co LINKS ===== */
      const urls = text.match(/https?:\/\/[^\s]+/g) || [];
      let rejectMessage = false;

      for (const url of urls) {
        if (url.includes("faym.co")) {
          const finalUrl = await unshortFaymStrict(url);

          if (!finalUrl) {
            rejectMessage = true;
            break;
          }

          text = text.split(url).join(finalUrl);
        }
      }

      /* 🚫 REJECT MESSAGE COMPLETELY */
      if (rejectMessage) {
        console.log("⛔ Non-Meesho link found → Message skipped");
        return;
      }

      /* ===== MEDIA MESSAGE ===== */
      if (message.media) {
        await client.sendFile(destinationChat, {
          file: message.media,
          caption: text || undefined
        });
        console.log("📸 Media forwarded");
        return;
      }

      /* ===== TEXT MESSAGE ===== */
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
      if (err.message && err.message.includes("FLOOD_WAIT")) {
        const sleepTime = err.seconds || 30;
        console.log(`🚨 FLOOD_WAIT ${sleepTime}s`);
        await new Promise(r => setTimeout(r, sleepTime * 1000));
      } else {
        console.error("❌ Handler Error:", err.message);
      }
    }
  }, new NewMessage({}));

})();

/* =====================================================
   🛑 GRACEFUL SHUTDOWN
===================================================== */
process.on("SIGTERM", async () => {
  console.log("🛑 Closing Browser...");
  if (browser) await browser.close();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 Closing Browser...");
  if (browser) await browser.close();
  process.exit(0);
});
