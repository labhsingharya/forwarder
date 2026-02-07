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

/* ================= FAYM → MEESHO (BEST POSSIBLE FREE LOGIC) ================= */
async function unshortFaymUntilMeesho(url, depth = 0) {
  if (depth > 3) return null; // 🔒 safety limit

  const headers = {
    "user-agent":
      "Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  };

  try {
    /* STEP 1: MANUAL REDIRECT CHECK */
    const r1 = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers
    });

    const loc = r1.headers.get("location");
    if (loc) {
      if (loc.includes("meesho.com")) {
        console.log("✅ Meesho via redirect");
        return loc;
      }

      if (loc.includes("faym.co")) {
        console.log("🔁 Faym → Faym redirect");
        return unshortFaymUntilMeesho(loc, depth + 1);
      }
    }

    /* STEP 2: HTML SCAN */
    const r2 = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers
    });

    const html = await r2.text();

    // Meesho link directly inside HTML / JS
    const meesho = html.match(
      /https?:\/\/(www\.)?meesho\.com[^\s"'<>]+/i
    );
    if (meesho) {
      console.log("✅ Meesho via HTML");
      return meesho[0];
    }

    // Faym inside HTML → try again
    const nextFaym = html.match(/https?:\/\/faym\.co[^\s"'<>]+/i);
    if (nextFaym) {
      console.log("🔁 Faym → Faym via HTML");
      return unshortFaymUntilMeesho(nextFaym[0], depth + 1);
    }

    return null;

  } catch (e) {
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

      /* ===== FLOOD CONTROL ===== */
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
          const finalUrl = await unshortFaymUntilMeesho(u);


          if (!finalUrl) {
            console.log("⛔ Faym removed");
            text = text.replaceAll(u, "");
            continue;
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
