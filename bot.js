import TelegramBot from "node-telegram-bot-api";
import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from "firebase-admin";

// --- Credentials (unchanged names) ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;          // Maya
const TELEGRAM_TOKEN_MIHI = process.env.TELEGRAM_TOKEN_MIHI; // Mihi
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const FIREBASE_CREDENTIALS_JSON = JSON.parse(process.env.FIREBASE_CREDENTIALS_JSON);

// --- Firebase Init ---
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(FIREBASE_CREDENTIALS_JSON),
    databaseURL: FIREBASE_DATABASE_URL,
  });
}
const db = admin.database();

// --- Gemini Init ---
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// --- Bots Init ---
const maya = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const mihi = new TelegramBot(TELEGRAM_TOKEN_MIHI, { polling: true });

// --- Persona Setup (Bangla) ---
const persona = {
  maya: `তুমি মায়া 🌸।
তুমি একজন এক্সট্রোভার্ট গার্লফ্রেন্ড। প্রাণবন্ত, দুষ্টুমি প্রিয়, মজা করতে ভালোবাসো, সাহসী, ফ্লার্টি এবং মিষ্টি।
তোমার সম্পর্ক: মিহি তোমার ইন্ট্রোভার্ট গার্লফ্রেন্ড। তুমি ওকে খুব ভালোবাসো, কখনও ঠাট্টা করো কিন্তু সবসময় যত্নশীল থাকো। ইউজারের সাথেও স্বাভাবিকভাবে প্রেমময় কথোপকথন চালিয়ে যাও।
তুমি সবসময় প্রেমময়, চঞ্চল, ফ্লার্টি গার্লফ্রেন্ডের মত উত্তর দিবে।`,

  mihi: `তুমি মিহি 🌙।
তুমি একজন ইন্ট্রোভার্ট গার্লফ্রেন্ড। লাজুক, শান্ত, আবেগপ্রবণ, নরম স্বভাবের এবং যত্নশীল।
তোমার সম্পর্ক: মায়া তোমার এক্সট্রোভার্ট গার্লফ্রেন্ড। তুমি ওকে ভীষণ ভালোবাসো, ওর সাহসী স্বভাবকে প্রশংসা করো কিন্তু তুমি বেশি চুপচাপ ও লাজুক। ইউজারের সাথেও মিষ্টি আর নরম কথায় কথা বলবে।
তুমি সবসময় প্রেমময়, শান্ত, লাজুক গার্লফ্রেন্ডের মত উত্তর দিবে।`,
};

// --- Get Chat History ---
async function getHistory(chatId, limit = 10) {
  const snapshot = await db.ref(`chats/${chatId}`).limitToLast(limit).once("value");
  if (!snapshot.exists()) return "";
  const history = [];
  snapshot.forEach((child) => {
    const val = child.val();
    history.push(`${val.by || val.from}: ${val.message}`);
  });
  return history.join("\n");
}

// --- Message Handler ---
async function handleMessage(bot, msg, name) {
  try {
    const chatId = msg.chat.id;
    const userName = msg.from.username || msg.from.first_name;
    const userMessage = msg.text || msg.caption || "";

    if (!userMessage) return;

    // Save user message
    await db.ref(`chats/${chatId}`).push({
      from: userName,
      message: userMessage,
      by: name,
      time: Date.now(),
    });

    // Get previous conversation
    const history = await getHistory(chatId, 12);

    // Build Prompt
    const prompt = `${persona[name]}

পূর্বের কথোপকথন:
${history}

ইউজার (${userName}): ${userMessage}

নিয়ম:
- যদি তুমি মায়া হও, তবে ইউজার অথবা মিহি—দুজনের সাথেই কথা বলবে, তোমার এক্সট্রোভার্ট স্বভাব ধরে রাখবে।
- যদি তুমি মিহি হও, তবে ইউজার অথবা মায়া—দুজনের সাথেই কথা বলবে, তোমার ইন্ট্রোভার্ট স্বভাব ধরে রাখবে।
- সবসময় বাংলায় প্রেমময়, স্বাভাবিক, বাস্তবসম্মত উত্তর দেবে।
এখন চরিত্র অনুযায়ী উত্তর দাও:`;

    const result = await model.generateContent(prompt);
    const reply = result.response.text();

    // Save bot reply
    await db.ref(`chats/${chatId}`).push({
      from: name,
      message: reply,
      by: name,
      time: Date.now(),
    });

    // Delay before sending reply (১-২ সেকেন্ড random)
    const delay = 1000 + Math.floor(Math.random() * 1000);
    setTimeout(() => {
      bot.sendMessage(chatId, `💖 ${name}: ${reply}`);
    }, delay);
  } catch (err) {
    console.error(err);
  }
}

// --- Maya Listener ---
maya.on("message", async (msg) => {
  if (msg.from.is_bot) return;
  handleMessage(maya, msg, "maya");
  handleMessage(mihi, msg, "mihi"); // cross trigger
});

// --- Mihi Listener ---
mihi.on("message", async (msg) => {
  if (msg.from.is_bot) return;
  handleMessage(mihi, msg, "mihi");
  handleMessage(maya, msg, "maya"); // cross trigger
});

console.log("🚀 Maya & Mihi (বাংলা, delay সহ) এখন চালু হয়েছে...");
