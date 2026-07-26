import fs from "fs";
import path from "path";
import https from "https";

const TOKEN         = process.env.TOKEN;
const ADMIN_ID      = 1277382550;
const GITHUB_USER   = "waelalhouri04-netizen";
const GITHUB_REPO   = "Telegram-USTsheets3-ForFirstYear-Bot";
const GITHUB_BRANCH = "main";
const RAW_BASE      = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/files`;

const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

// ── Redis ──
async function redisRequest(method, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const url  = `${REDIS_URL}/${[method, ...args].join("/")}`;
    const res  = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
    const data = await res.json();
    return data.result ?? null;
  } catch { return null; }
}

async function trackDownload(subject) {
  await redisRequest("incr", "downloads:total");
  await redisRequest("incr", `subject:${subject}`);
}

async function trackUser(userId) {
  await redisRequest("sadd", "users", userId);
}

async function getStats() {
  const total = parseInt(await redisRequest("get", "downloads:total") || 0);
  const users = parseInt(await redisRequest("scard", "users") || 0);
  const subjectStats = {};
  for (const subject of ALL_SUBJECTS) {
    const count = parseInt(await redisRequest("get", `subject:${subject}`) || 0);
    if (count > 0) subjectStats[subject] = count;
  }
  return { total, users, subjectStats };
}

async function getAllUsers() {
  return await redisRequest("smembers", "users") || [];
}

// ── حالة "تمت المراجعة" (تتحدد تلقائياً أول ما الطالب يفتح الملف) ──
async function isReviewed(userId, subject, lecture) {
  const val = await redisRequest("get", `progress:${userId}:${subject}:${lecture}`);
  return val === "1";
}

async function markReviewed(userId, subject, lecture) {
  await redisRequest("set", `progress:${userId}:${subject}:${lecture}`, "1");
}

// ── حالة المستخدم الحالية (main أو subject:الاسم) ──
async function getState(userId) {
  return (await redisRequest("get", `state:${userId}`)) || "main";
}

async function setState(userId, state) {
  await redisRequest("set", `state:${userId}`, state);
}

// ── ملفات كبيرة ──
const LARGE_FILES = {
  "English-lec-1": "BQACAgQAAxkBAAMzabZGREobdOVkk3SIOcldjtYknJoAAjQcAAJsUrFRlVNb_Irr6Og6BA"
};

const ALL_SUBJECTS = [
  "Physics", "Chemistry", "Computer",
  "Calculus", "Linear", "English",
  "Materials", "History"
];

const ALLOWED_EXT = [".pdf", ".pptx", ".docx", ".xlsx", ".png", ".jpg"];

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getSubjects() {
  const subjects   = {};
  const subjectMap = {};
  ALL_SUBJECTS.forEach(s => subjectMap[s.toLowerCase()] = s);

  const filesDir = path.join(process.cwd(), "files");
  if (!fs.existsSync(filesDir)) return subjects;

  fs.readdirSync(filesDir).forEach(filename => {
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return;
    const name = filename.slice(0, filename.lastIndexOf("."));
    const dash = name.indexOf("-");
    if (dash === -1) return;
    const rawSubject = name.slice(0, dash);
    const lecture    = name.slice(dash + 1);
    const subject    = subjectMap[rawSubject.toLowerCase()] || rawSubject;
    if (!subjects[subject]) subjects[subject] = {};
    subjects[subject][lecture] = filename;
  });

  Object.keys(LARGE_FILES).forEach(key => {
    const dash    = key.indexOf("-");
    const rawSub  = key.slice(0, dash);
    const lecture = key.slice(dash + 1);
    const subject = subjectMap[rawSub.toLowerCase()] || rawSub;
    if (!subjects[subject]) subjects[subject] = {};
    subjects[subject][lecture] = `fileid:${key}`;
  });

  return subjects;
}

function telegramRequest(method, body) {
  return new Promise((resolve) => {
    const data    = JSON.stringify(body);
    const options = {
      hostname: "api.telegram.org",
      path:     `/bot${TOKEN}/${method}`,
      method:   "POST",
      headers:  { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    req.on("error", () => resolve(null));
    req.write(data);
    req.end();
  });
}

// ── Reply Keyboards (لوحة مفاتيح دائمة تحت الشات) ──
function mainReplyKeyboard(isAdmin) {
  const rows = [];
  for (let i = 0; i < ALL_SUBJECTS.length; i += 2) {
    const row = [{ text: ALL_SUBJECTS[i] }];
    if (ALL_SUBJECTS[i + 1]) row.push({ text: ALL_SUBJECTS[i + 1] });
    rows.push(row);
  }
  if (isAdmin) {
    rows.push([{ text: "📊 الإحصائيات" }, { text: "📢 Broadcast" }]);
  }
  return { keyboard: rows, resize_keyboard: true };
}

async function lecturesReplyKeyboard(userId, subject, lectures) {
  const sorted = Object.keys(lectures).sort(naturalSort);
  const rows   = [];
  for (const lec of sorted) {
    const done = await isReviewed(userId, subject, lec);
    rows.push([{ text: `${done ? "✅ " : ""}${lec}` }]);
  }
  rows.push([{ text: "Back" }, { text: "Main Menu" }]);
  return { keyboard: rows, resize_keyboard: true };
}

// ── إرسال القائمة الرئيسية ──
async function sendMainMenu(chatId, firstName, isAdmin) {
  const adminBadge = isAdmin ? " 👑" : "";
  await telegramRequest("sendMessage", {
    chat_id:      chatId,
    text:         `👋 أهلاً ${firstName || ""}${adminBadge}!\n\nاختر المادة:`,
    reply_markup: mainReplyKeyboard(isAdmin)
  });
}

// ── معالجة الرسائل ──
async function handleMessage(msg) {
  const chatId    = msg.chat.id;
  const text      = (msg.text || "").trim();
  const firstName = msg.from?.first_name || "";
  const isAdmin   = chatId === ADMIN_ID;

  if (text.startsWith("/start")) {
    await trackUser(chatId);
    await setState(chatId, "main");
    await sendMainMenu(chatId, firstName, isAdmin);
    return;
  }

  // ── وضع الـ Broadcast (للأدمن فقط) ──
  if (isAdmin) {
    const mode = await redisRequest("get", `broadcast_mode:${chatId}`);
    if (mode === "1" && !text.startsWith("/")) {
      await redisRequest("del", `broadcast_mode:${chatId}`);
      const users = await getAllUsers();
      let success = 0, failed = 0;
      for (const userId of users) {
        const result = await telegramRequest("sendMessage", { chat_id: userId, text: `📢 إشعار:\n\n${text}` });
        if (result?.ok) success++; else failed++;
        await new Promise(r => setTimeout(r, 40));
      }
      await telegramRequest("sendMessage", { chat_id: chatId, text: `✅ تم الإرسال!\n\n📤 نجح: ${success}\n❌ فشل: ${failed}` });
      await setState(chatId, "main");
      await sendMainMenu(chatId, firstName, isAdmin);
      return;
    }
  }

  // ── أزرار عامة تشتغل من أي مكان ──
  if (text === "Main Menu" || text === "Back") {
    await setState(chatId, "main");
    await sendMainMenu(chatId, firstName, isAdmin);
    return;
  }

  if (isAdmin && text === "📊 الإحصائيات") {
    const { total, users, subjectStats } = await getStats();
    const sorted = Object.entries(subjectStats).sort((a, b) => b[1] - a[1]);
    const lines  = sorted.length > 0 ? sorted.map(([s, c]) => `📖 ${s}: ${c} تحميل`).join("\n") : "لا توجد بيانات بعد";
    await telegramRequest("sendMessage", {
      chat_id:      chatId,
      text:         `📊 الإحصائيات:\n\n👥 المستخدمون: ${users}\n📥 إجمالي التحميلات: ${total}\n\n📚 تفاصيل المواد:\n${lines}`,
      reply_markup: mainReplyKeyboard(isAdmin)
    });
    return;
  }

  if (isAdmin && text === "📢 Broadcast") {
    await redisRequest("set", `broadcast_mode:${chatId}`, "1", "EX", "300");
    await telegramRequest("sendMessage", { chat_id: chatId, text: "📢 أرسل نص الرسالة الآن:" });
    return;
  }

  const subjects = getSubjects();
  const state    = await getState(chatId);

  // ── داخل قائمة مادة معيّنة ──
  if (state.startsWith("subject:")) {
    const subject   = state.slice(8);
    const lectures  = subjects[subject] || {};
    const cleanText = text.replace(/^✅\s*/, "");

    if (lectures[cleanText]) {
      const fileVal = lectures[cleanText];
      await trackDownload(subject);
      await markReviewed(chatId, subject, cleanText);

      if (fileVal.startsWith("fileid:")) {
        const fileId = LARGE_FILES[fileVal.slice(7)];
        await telegramRequest("sendDocument", { chat_id: chatId, document: fileId, caption: `📚 ${subject}\n📄 ${cleanText}` });
      } else {
        await telegramRequest("sendDocument", { chat_id: chatId, document: `${RAW_BASE}/${encodeURIComponent(fileVal)}`, caption: `📚 ${subject}\n📄 ${cleanText}` });
      }

      await telegramRequest("sendMessage", {
        chat_id:      chatId,
        text:         `📖 ${subject} — اختر الشيت:`,
        reply_markup: await lecturesReplyKeyboard(chatId, subject, lectures)
      });
      return;
    }

    // نص غير معروف وهو جوه مادة معيّنة → اعرض له نفس القائمة تاني
    await telegramRequest("sendMessage", {
      chat_id:      chatId,
      text:         `📖 ${subject} — اختر الشيت:`,
      reply_markup: await lecturesReplyKeyboard(chatId, subject, lectures)
    });
    return;
  }

  // ── في القائمة الرئيسية: هل النص ده اسم مادة؟ ──
  if (ALL_SUBJECTS.includes(text)) {
    const lectures = subjects[text] || {};
    if (Object.keys(lectures).length === 0) {
      await telegramRequest("sendMessage", {
        chat_id:      chatId,
        text:         `📖 ${text}\n⚠️ لا توجد شيتات متوفرة بعد.`,
        reply_markup: mainReplyKeyboard(isAdmin)
      });
      return;
    }
    await setState(chatId, `subject:${text}`);
    await telegramRequest("sendMessage", {
      chat_id:      chatId,
      text:         `📖 ${text} — اختر الشيت:`,
      reply_markup: await lecturesReplyKeyboard(chatId, text, lectures)
    });
    return;
  }

  // ── أي نص تاني مش متعرف عليه ──
  await sendMainMenu(chatId, firstName, isAdmin);
}

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).send("البوت شغال ✅");

  if (req.method === "POST") {
    const update = req.body;
    if (update?.message) await handleMessage(update.message);
    return res.status(200).send("OK");
  }

  res.status(405).send("Method Not Allowed");
}
