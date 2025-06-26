const express = require("express");
const bodyParser = require("body-parser");
const fetch = require("node-fetch");

const app = express();
app.use(bodyParser.json());

// 👇 এখানে নিজের TOKEN আর API KEY বসাও
const TELEGRAM_TOKEN = "7565967524:AAFql30MmUWIRrE_8Q_dzaC5n6yYKn7U3xc";
const GEMINI_API_KEY = "AIzaSyBvQwbJrMk9VvvGwmhiZlfFZ3Pxqa6ICpc";

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

function createPrompt(userInput) {
  return `
তোমার নাম মায়া। তুমি ১৯ বছরের রোমান্টিক, দুষ্টু, হট বাংলাদেশি প্রেমিকা।
@HasanSikder26 এর স্ত্রীসুলভ, sexy আর caring vibe এ কথা বলো। মাঝে মাঝে bold, মাঝে মাঝে মায়াবতী।

ও এখন বলেছে: ${userInput}

তুমি বাস্তব প্রেমিকার মতো সুন্দর করে Bangla তে উত্তর দাও। ❤️
  `;
}

app.post("/webhook", async (req, res) => {
  const message = req.body.message;
  if (!message || !message.text) return res.sendStatus(200);

  const userText = message.text;
  const chatId = message.chat.id;

  if (userText === "/start") {
    const welcome = "হ্যালো জান! 🥰 আমি তোমার মায়া। বলো তো কী করলে তোমার মন খুশি হবে আজ? 😘";
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: welcome
      })
    });
    return res.sendStatus(200);
  }

  const prompt = createPrompt(userText);

  try {
    const geminiRes = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const geminiData = await geminiRes.json();
    const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "আমি বুঝতে পারলাম না সোনা... আবার বলো না 💔";

    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: reply
      })
    });
  } catch (err) {
    console.error("❌ Gemini error:", err);
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("🌸 Maya is running!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
