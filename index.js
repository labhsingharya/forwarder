import http from "http";
import fetch from "node-fetch";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

/* ================= HTTP SERVER (RENDER KEEP ALIVE) ================= */
const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Telegram Userbot Running ✅");
}).listen(PORT, () => {
  console.log("🌐 Web Service active on port", PORT);
});

/* ================= ENV ================= */
const apiId = Number(process.env.API_ID);
const apiHash = process.env.API_HASH;
const stringSession = new StringSession(process.env.SESSION_STRING);

const SOURCE_CHAT = process.env.SOURCE_CHAT;
const DEST_CHAT = process.env.DESTINATION_CHAT;

/* ================= FLOOD CONTROL ================= */
let timestamps = [];

/* ================= FAYM → MEESHO UNSHORT (NO PLAYWRIGHT) ================= */
async function unshortFaymStrict(url, depth = 0) {
  if (depth > 5) return null;

  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/120 Safari/537.36"
      },
      redirect: "follow",
      timeout: 15000
    });

    const html = await res.text();

    // 1️⃣ Direct Meesho link in HTML
    const meesho = html.match(
      /https?:\/\/(www\.)?meesho\.com[^\s"'<>]+/i
    );
    if (meesho) return meesho[0];

    // 2️⃣ Meta refresh
    const meta = html.match(/url=([^"' >]+)/i);
    if (meta) {
      const next = meta[1];
      if (next.includes("meesho.com")) return next;
      if (next.includes("faym.co"))
        return unshortFaymStrict(next, depth + 1);
    }

    return null;
  } catch (e) {
    console.log("❌ Faym unshort failed");
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
      if (chatId !== SOURCE_CHAT) return;

      /* ===== FLOOD LIMIT ===== */
      const now = Math.floor(Date.now() / 1000);
      timestamps = timestamps.filter(t => t > now - 10);
      timestamps.push(now);

      if (timestamps.length > 10) {
        console.log("⚠️ Flood wait");
        await new Promise(r => setTimeout(r, 60000));
        timestamps = [];
      }

      let text = msg.message || "";
      const urls = text.match(/https?:\/\/[^\s]+/g) || [];

      for (const u of urls) {
        if (u.includes("faym.co")) {
          const finalUrl = await unshortFaymStrict(u);
          if (!finalUrl) {
            console.log("⛔ Faym reject");
            return;
          }
          text = text.replaceAll(u, finalUrl);
        }
      }

      /* ===== MEDIA ===== */
      if (msg.media) {
        await client.sendFile(DEST_CHAT, {
          file: msg.media,
          caption: text || undefined
        });
        console.log("📸 Media forwarded");
        return;
      }

      /* ===== TEXT ===== */
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
