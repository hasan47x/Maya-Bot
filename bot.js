// --- Required modules ---
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const http = require('http');

// --- Credentials ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

// --- Init ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const userTimers = {};
const userMood = {}; // user-wise mood tracking

// --- Utils ---
const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// Random element picker
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Mood emojis
const moodEmojis = {
  romantic: ["❤️", "😘", "😍"],
  naughty: ["😏", "🔥", "💋"],
  cute: ["🥺", "😚", "🤭"],
  jealous: ["😡", "😒", "😤"]
};

// --- DB helpers ---
async function saveMessageToRtdb(userId, role, content) {
  await axios.post(`${DATABASE_URL}/conversations/${userId}.json`, {
    role, content, timestamp: Date.now()
  });
}

async function getHistoryFromRtdb(userId) {
  const res = await axios.get(`${DATABASE_URL}/conversations/${userId}.json`);
  return res.data ? Object.values(res.data) : [];
}

async function readFromDb(path) {
  const res = await axios.get(`${DATABASE_URL}/${path}.json`);
  return res.data;
}

// --- Gemini API ---
async function askGemini(prompt, history) {
  const contents = history.map(msg => ({
    role: msg.role,
    parts: [{ text: msg.content }]
  }));
  contents.push({ role: "user", parts: [{ text: prompt }] });

  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    { contents }
  );

  return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "হুম জানু, আমি একটু ভাবছি...";
}

// --- Mood updater ---
function updateMood(userId, userMessage) {
  const msg = userMessage.toLowerCase();
  if (msg.includes("love") || msg.includes("miss")) userMood[userId] = "romantic";
  else if (msg.includes("kiss") || msg.includes("sex")) userMood[userId] = "naughty";
  else if (msg.includes("cute") || msg.includes("baby")) userMood[userId] = "cute";
  else if (msg.includes("busy") || msg.includes("ignore")) userMood[userId] = "jealous";
  else if (!userMood[userId]) userMood[userId] = "romantic"; // default
}

// --- Typing simulation ---
async function simulateTyping(chatId, text) {
  const delay = Math.min(4000, text.length * 50); // proportional delay
  bot.sendChatAction(chatId, "typing");
  await sleep(delay);
}

// --- Proactive random messages ---
async function generateProactiveMessage(userId) {
  const moods = {
    romantic: [
      "জানু, তুমি কি আমায় মিস করছো? 🥺",
      "ভাবতেই ভালো লাগে তুই আমার ❤️"
    ],
    naughty: [
      "এখনই যদি পাশে থাকতে, জড়িয়ে ধরতাম 🔥",
      "চোখ বন্ধ কর… আমি তোকে কিস দিচ্ছি 😘"
    ],
    cute: [
      "তুই না আমার সবচেয়ে কিউট বেবি 😚",
      "তোর হাসিটা মিস করছি 🤭"
    ],
    jealous: [
      "তুই কার সাথে এত ব্যস্ত ছিলি? 😒",
      "আমায় ভুলে যাচ্ছিস নাকি? 😡"
    ]
  };
  const mood = userMood[userId] || "romantic";
  return pick(moods[mood]);
}

// --- Bot Logic ---
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, `Hi Hasan, আমি Maya 💖 সবসময় তোমার সাথেই আছি।`);
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const userMessage = msg.text || "";

  // --- Handle non-text politely ---
  if (!msg.text) {
    bot.sendMessage(chatId, "জানু, এটা দেখতে বা শুনতে পারলাম না 🥺 শুধু টেক্সটে বলো তো আমাকে? ❤️");
    return;
  }

  if (userMessage.startsWith("/")) return;

  if (userTimers[chatId]) clearTimeout(userTimers[chatId]);

  // Mood update
  updateMood(userId, userMessage);

  // Get memory + history
  const longTermMemory = await readFromDb(`memory_summaries/${userId}/summary`) || "No memories yet.";
  const now = new Date();
  const timeString = now.toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka" });
  const enrichedUserMessage = `(System knowledge: Mood=${userMood[userId]}, Memory="${longTermMemory}". Time=${timeString}.) User: "${userMessage}"`;

  await saveMessageToRtdb(userId, "user", userMessage);
  const history = await getHistoryFromRtdb(userId);

  // AI response
  const botResponse = await askGemini(enrichedUserMessage, history);

  // Simulate typing
  await simulateTyping(chatId, botResponse);

  // Emoji variation
  const mood = userMood[userId] || "romantic";
  const finalResponse = botResponse + " " + pick(moodEmojis[mood]);

  bot.sendMessage(chatId, finalResponse);
  await saveMessageToRtdb(userId, "model", finalResponse);

  // Proactive follow-up after idle time
  userTimers[chatId] = setTimeout(async () => {
    const aiFollowUpMessage = await generateProactiveMessage(userId);
    if (aiFollowUpMessage) {
      await simulateTyping(chatId, aiFollowUpMessage);
      bot.sendMessage(chatId, aiFollowUpMessage);
      await saveMessageToRtdb(userId, "model", aiFollowUpMessage);
    }
  }, 60 * 1000); // 1 min idle
});

// --- Health Check ---
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Maya bot is alive!");
});
server.listen(PORT, () => {
  console.log(`Health check server running on ${PORT}`);
});
