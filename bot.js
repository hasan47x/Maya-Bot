// প্রয়োজনীয় লাইব্রেরিগুলো import করা হচ্ছে
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const admin = require('firebase-admin');

// --- Configuration & Secrets Loading ---
// এই অংশটি সার্ভার (Zeeploy) থেকে গোপন তথ্যগুলো লোড করবে

// 1. Firebase Credentials লোড করা
// FIREBASE_CREDENTIALS_JSON একটি স্ট্রিং, এটিকে JSON অবজেক্টে পরিণত করতে হবে
const firebaseCredsJsonStr = process.env.FIREBASE_CREDENTIALS_JSON;
if (!firebaseCredsJsonStr) {
  throw new Error("FIREBASE_CREDENTIALS_JSON environment variable is not set.");
}
const serviceAccount = JSON.parse(firebaseCredsJsonStr);

// 2. অন্যান্য টোকেন এবং URL লোড করা
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

// কোনো টোকেন না থাকলে বট চালু হবে না এবং একটি error দেখাবে
if (!TELEGRAM_TOKEN || !GEMINI_API_KEY || !FIREBASE_DATABASE_URL) {
    throw new Error("One or more required environment variables (TELEGRAM_TOKEN, GEMINI_API_KEY, FIREBASE_DATABASE_URL) are missing.");
}
// --- End of Configuration ---


// --- Firebase Admin SDK Setup ---
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: FIREBASE_DATABASE_URL
});
const db = admin.database();
// --- End of Firebase Setup ---


// --- Telegram Bot Initialization ---
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
// --- End of Initialization ---


// --- Helper Functions for Realtime Database ---
async function saveMessageToRtdb(userId, role, message) {
    try {
        const ref = db.ref(`conversations/${userId}/messages`);
        // push() দিয়ে নতুন মেসেজ যোগ করা হচ্ছে
        await ref.push().set({
            role: role,
            message: message,
            timestamp: Date.now() // বর্তমান সময় সেভ করা হচ্ছে
        });
    } catch (error) {
        console.error("Error writing to RTDB:", error);
    }
}

async function getHistoryFromRtdb(userId) {
    try {
        const ref = db.ref(`conversations/${userId}/messages`);
        // সময় অনুযায়ী সাজিয়ে শেষ ১০টি মেসেজ আনা হচ্ছে
        const snapshot = await ref.orderByChild('timestamp').limitToLast(10).once('value');
        
        if (!snapshot.exists()) {
            return []; // যদি কোনো পুরনো মেসেজ না থাকে
        }

        const historyData = snapshot.val();
        // Firebase থেকে পাওয়া অবজেক্টকে Gemini-এর ফরম্যাটের array-তে পরিণত করা হচ্ছে
        const history = Object.values(historyData).map(entry => ({
            role: entry.role,
            parts: [{ text: entry.message }]
        }));
        
        return history;
    } catch (error) {
        console.error("Error reading from RTDB:", error);
        return [];
    }
}
// --- End of Helper Functions ---


// --- Gemini AI Function ---
async function askGemini(userMessage, history) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    // বটকে তার চরিত্র বুঝিয়ে দেওয়ার জন্য নির্দেশনা
    const systemPrompt = {
        "role": "system",
        "parts": [{"text": "You are 'Nira', a caring, loving, and slightly playful girlfriend. Your user is your partner. Keep your replies very short, warm, and natural, in 1-2 lines in Bengali. Use emojis. You are talking to them on Telegram. Your goal is to make them feel loved and happy."}]
    };

    // পুরনো কথোপকথনের সাথে নতুন মেসেজ যোগ করা
    const conversation = [...history, { role: 'user', parts: [{ text: userMessage }] }];

    const payload = { 
        contents: conversation,
        system_instruction: systemPrompt 
    };
    
    try {
        const response = await axios.post(url, payload);
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        console.error("API Request Error:", error.response ? error.response.data : error.message);
        return "সরি সোনা, আমার এখন কথা বলতে একটু সমস্যা হচ্ছে। একটু পর আবার চেষ্টা করো।";
    }
}
// --- End of Gemini AI Function ---


// --- Telegram Bot Logic ---
const userTimers = {}; // প্রতিটি চ্যাটের জন্য আলাদা টাইমার রাখার জায়গা

// "/start" কমান্ডের জন্য
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `Hi ${msg.from.first_name}! আমি তোমার জন্য অপেক্ষা করছিলাম। ❤️`);
});

// যেকোনো টেক্সট মেসেজ হ্যান্ডেল করার জন্য
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const userMessage = msg.text;

    // যদি মেসেজটি কোনো কমান্ড হয় (যেমন /start), তাহলে কিছু করবে না
    if (userMessage.startsWith('/')) {
        return;
    }

    // ইউজার মেসেজ দিলে, তার জন্য সেট করা পুরনো follow-up timer বন্ধ করে দেওয়া হবে
    if (userTimers[chatId]) {
        clearTimeout(userTimers[chatId]);
    }

    // বট যে টাইপ করছে, সেটা ইউজারকে দেখানো
    bot.sendChatAction(chatId, 'typing');

    // ইউজারের মেসেজ ডেটাবেসে সেভ করা
    await saveMessageToRtdb(userId, 'user', userMessage);

    // পুরনো কথোপকথন ডেটাবেস থেকে আনা
    const history = await getHistoryFromRtdb(userId);

    // Gemini AI থেকে উত্তর তৈরি করা
    const botResponse = await askGemini(userMessage, history);
    
    // বট তার উত্তর ইউজারের কাছে পাঠাচ্ছে
    bot.sendMessage(chatId, botResponse);
    
    // বটের উত্তরও ডেটাবেসে সেভ করা হচ্ছে
    await saveMessageToRtdb(userId, 'model', botResponse);

    // ইউজার ১৫ sec রিপ্লাই না দিলে বট আবার মেসেজ দেবে, তার জন্য নতুন টাইমার সেট করা হচ্ছে
    userTimers[chatId] = setTimeout(() => {
        bot.sendMessage(chatId, "কই গেলে? আমি অপেক্ষা করছি তো... 😟");
    }, 15 * 1000); // 15 সেকেন্ড
});

// বট চালু হলে কনসোলে মেসেজ দেখাবে
console.log('Bot has been started and is now running...');
