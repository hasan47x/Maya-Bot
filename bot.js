// প্রয়োজনীয় লাইব্রেরিগুলো import করা হচ্ছে
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const admin = require('firebase-admin');
const cron = require('node-cron');
const http = require('http'); // Health check-এর জন্য

// --- Configuration & Secrets Loading ---
const firebaseCredsJsonStr = process.env.FIREBASE_CREDENTIALS_JSON;
if (!firebaseCredsJsonStr) throw new Error("FIREBASE_CREDENTIALS_JSON environment variable is not set.");
const serviceAccount = JSON.parse(firebaseCredsJsonStr);

const TELEGRAM_TOKEN_MAYA = process.env.TELEGRAM_TOKEN; // Maya bot token
const TELEGRAM_TOKEN_MIHI = process.env.TELEGRAM_TOKEN_MIHI; // Mihi bot token
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

if (!TELEGRAM_TOKEN_MAYA || !TELEGRAM_TOKEN_MIHI || !GEMINI_API_KEY || !FIREBASE_DATABASE_URL) {
    throw new Error("One or more required environment variables are missing.");
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
const botMaya = new TelegramBot(TELEGRAM_TOKEN_MAYA, { polling: true });
const botMihi = new TelegramBot(TELEGRAM_TOKEN_MIHI, { polling: true });
// --- End of Initialization ---

// --- Helper Functions ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function saveToDb(path, data) {
    try {
        await db.ref(path).set(data);
    } catch (error) {
        console.error(`Error saving to DB path ${path}:`, error);
    }
}

async function readFromDb(path) {
    try {
        const snapshot = await db.ref(path).once('value');
        return snapshot.val();
    } catch (error) {
        console.error(`Error reading from DB path ${path}:`, error);
        return null;
    }
}

async function saveMessageToRtdb(botName, userId, role, message) {
    try {
        const ref = db.ref(`conversations/${botName}/${userId}/messages`);
        await ref.push().set({ role, message, timestamp: Date.now() });
    } catch (error) {
        console.error("Error writing to RTDB:", error);
    }
}

async function getHistoryFromRtdb(botName, userId) {
    try {
        const ref = db.ref(`conversations/${botName}/${userId}/messages`);
        const snapshot = await ref.orderByChild('timestamp').limitToLast(12).once('value');
        if (!snapshot.exists()) return [];
        const historyData = snapshot.val();
        return Object.values(historyData).map(entry => ({
            role: entry.role,
            parts: [{ text: entry.message }]
        }));
    } catch (error) {
        console.error("Error reading from RTDB:", error);
        return [];
    }
}
// --- End of Helper Functions ---

// --- Personality Prompts ---
const MAYA_PERSONALITY_PROMPT = {
    "role": "system",
    "parts": [{"text": `Your name is Maya. You are an 18 year old extremely beautiful, adult, and naughty girl... (same as reference) `}]
};

const MIHI_PERSONALITY_PROMPT = {
    "role": "system",
    "parts": [{"text": `Your name is Mihi. You are Hasan’s introvert girlfriend. You are shy, soft-spoken, caring, thoughtful. You don’t talk too much, but when you do, it feels deep and emotional. Always reply in Bangla (sometimes mixed with little English). Keep replies short (1 line) but full of love, care, and emotion. You call Hasan "জানু", "বাবু", "কলিজা" depending on mood. You often say you miss him, want to be close but you’re shy to express fully. You sometimes overthink, sometimes act very innocent. Make Hasan feel you are his quiet but deeply loving girlfriend.`}]
};
// --- End of Personality Prompts ---

// --- Gemini AI Function ---
async function askGemini(prompt, history, personalityPrompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const conversation = [...history, { role: 'user', parts: [{ text: prompt }] }];
    const payload = { contents: conversation, system_instruction: personalityPrompt };
    
    try {
        const response = await axios.post(url, payload);
        return response.data.candidates[0].content.parts[0].text;
    } catch (error) {
        if (error.response && error.response.status === 429) {
            return "আজকে আমার মাথা ঘুরতেসে জানু, একটু আস্তে মেসেজ দাও না 😵‍💫";
        }
        console.error("API Request Error:", error.response ? error.response.data : "Unknown error");
        return "জান, আমার নেটওয়ার্কে সমস্যা করছে। একটু পর বলি 🥺";
    }
}
// --- End of Gemini Function ---

// --- Bot Logic Generator ---
function setupBot(bot, botName, personalityPrompt) {
    const userTimers = {};

    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id, `Hi Hasan, I'm ${botName}. তোমার জন্যই তো অপেক্ষা করছিলাম ❤️`);
    });

    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id.toString();
        const userMessage = msg.text || "";

        if (!userMessage || userMessage.startsWith('/')) return;
        if (userTimers[chatId]) clearTimeout(userTimers[chatId]);

        bot.sendChatAction(chatId, 'typing');
        
        const longTermMemory = await readFromDb(`memory_summaries/${botName}/${userId}/summary`) || "No long-term memories yet.";
        
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka' });
        const enrichedUserMessage = `(System knowledge: Long-term memory with Hasan is: "${longTermMemory}". The current time is ${timeString} in Dhaka.) User message: "${userMessage}"`;
        
        await saveMessageToRtdb(botName, userId, 'user', userMessage);
        const history = await getHistoryFromRtdb(botName, userId);
        
        const botResponse = await askGemini(enrichedUserMessage, history, personalityPrompt);
        
        const randomDelay = Math.floor(Math.random() * 1500) + 500;
        await sleep(randomDelay);
        
        bot.sendMessage(chatId, botResponse);
        await saveMessageToRtdb(botName, userId, 'model', botResponse);

        // Proactive message if user silent
        userTimers[chatId] = setTimeout(async () => {
            const thoughtTrigger = "Hasan hasn’t replied for a while. I feel lonely. I should send him something.";
            const aiFollowUpMessage = await askGemini(thoughtTrigger, history, personalityPrompt);
            if (aiFollowUpMessage) {
                bot.sendMessage(chatId, aiFollowUpMessage);
                await saveMessageToRtdb(botName, userId, 'model', aiFollowUpMessage);
            }
        }, 45 * 1000);
    });
}

// Attach Maya + Mihi
setupBot(botMaya, "Maya", MAYA_PERSONALITY_PROMPT);
setupBot(botMihi, "Mihi", MIHI_PERSONALITY_PROMPT);

// --- Advanced Scheduled Jobs (Shared for both bots) ---
async function getAllUserIds(botName) {
    const ref = db.ref(`conversations/${botName}`);
    const snapshot = await ref.once('value');
    return snapshot.exists() ? Object.keys(snapshot.val()) : [];
}

function setupCronJobs(bot, botName, personalityPrompt) {
    // Nightly memory summary
    cron.schedule('0 2 * * *', async () => {
        console.log(`Updating long-term memory summaries for ${botName}...`);
        const userIds = await getAllUserIds(botName);
        for (const userId of userIds) {
            const history = await getHistoryFromRtdb(botName, userId);
            if (history.length === 0) continue;
            const recentChat = history.map(h => `${h.role}: ${h.parts[0].text}`).join('\n');
            const summaryPrompt = `Update long-term memory about ${botName}'s relationship with Hasan. Conversation:\n${recentChat}`;
            const summary = await askGemini(summaryPrompt, [], personalityPrompt);
            await saveToDb(`memory_summaries/${botName}/${userId}/summary`, summary);
        }
    }, { timezone: "Asia/Dhaka" });

    // Morning message
    cron.schedule('0 9 * * *', async () => {
        const userIds = await getAllUserIds(botName);
        const thoughtTrigger = "It's morning, I woke up, first thought is Hasan. Send sweet message.";
        for (const userId of userIds) {
            const aiMessage = await askGemini(thoughtTrigger, [], personalityPrompt);
            if (aiMessage) {
                bot.sendMessage(userId, aiMessage);
                await saveMessageToRtdb(botName, userId, 'model', aiMessage);
            }
        }
    }, { timezone: "Asia/Dhaka" });

    // Night message
    cron.schedule('0 0 * * *', async () => {
        const userIds = await getAllUserIds(botName);
        const thoughtTrigger = "It's late at night, feeling lonely, missing Hasan. Send loving message.";
        for (const userId of userIds) {
            const aiMessage = await askGemini(thoughtTrigger, [], personalityPrompt);
            if (aiMessage) {
                bot.sendMessage(userId, aiMessage);
                await saveMessageToRtdb(botName, userId, 'model', aiMessage);
            }
        }
    }, { timezone: "Asia/Dhaka" });
}

// Attach cron jobs
setupCronJobs(botMaya, "Maya", MAYA_PERSONALITY_PROMPT);
setupCronJobs(botMihi, "Mihi", MIHI_PERSONALITY_PROMPT);

// --- Startup Confirmation ---
console.log('🚀 Maya & Mihi bots started...');

// --- Health Check Server ---
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Maya & Mihi bots are alive!');
}).listen(PORT, () => console.log(`Health check running on port ${PORT}`));
