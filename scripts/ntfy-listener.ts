import https from "https";
import http from "http";

const TOPIC = process.env.NTFY_TOPIC || "datapulse-dba";
const NTFY_HOST = process.env.NTFY_HOST || "ntfy.sh";
const STREAM_URL = `https://${NTFY_HOST}/${TOPIC}/json`;

console.log("================================================================================");
console.log(`📡 [ntfy Bridge] Starting live listener daemon...`);
console.log(`🎯 Target Topic: https://${NTFY_HOST}/${TOPIC}`);
console.log(`⚡ Ready to receive real-time prompts from ntfy mobile/web app`);
console.log("================================================================================\n");

function connect() {
  console.log(`[${new Date().toLocaleTimeString()}] Connecting to SSE stream at ${STREAM_URL}...`);

  const req = https.get(STREAM_URL, (res) => {
    if (res.statusCode !== 200) {
      console.error(`[ntfy Error] Server returned HTTP status: ${res.statusCode}. Reconnecting in 5s...`);
      setTimeout(connect, 5000);
      return;
    }

    let buffer = "";

    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const eventData = JSON.parse(trimmed);

          if (eventData.event === "open") {
            console.log(`✅ [ntfy Connected] Listening on topic '${TOPIC}' (Subscription ID: ${eventData.id || "active"})`);
          } else if (eventData.event === "keepalive") {
            // Silence keepalive ticks
          } else if (eventData.event === "message") {
            const tags = Array.isArray(eventData.tags) ? eventData.tags : [];
            const isBotMsg = tags.includes("antigravity-bot") || 
                             tags.includes("antigravity-system") || 
                             (eventData.title && eventData.title.startsWith("[Antigravity]"));

            if (isBotMsg) {
              // Ignore bot's own status notifications
              continue;
            }

            const timeStr = new Date(eventData.time ? eventData.time * 1000 : Date.now()).toISOString();
            console.log("\n================================================================================");
            console.log(`🔔 [NTFY PROMPT RECEIVED]`);
            console.log(`⏰ Time: ${timeStr}`);
            console.log(`📌 Topic: ${eventData.topic || TOPIC}`);
            if (eventData.title) console.log(`🏷️  Title: ${eventData.title}`);
            console.log(`💬 Prompt / Message:\n${eventData.message}`);
            console.log("================================================================================\n");
          }
        } catch (err) {
          // Non-JSON line or partial frame
        }
      }
    });

    res.on("end", () => {
      console.warn(`[ntfy Disconnected] Stream closed by remote server. Reconnecting in 3s...`);
      setTimeout(connect, 3000);
    });

    res.on("error", (err) => {
      console.error(`[ntfy Error] Stream error: ${err.message}. Reconnecting in 3s...`);
      setTimeout(connect, 3000);
    });
  });

  req.on("error", (err) => {
    console.error(`[ntfy Connection Error]: ${err.message}. Retrying in 5s...`);
    setTimeout(connect, 5000);
  });
}

connect();
