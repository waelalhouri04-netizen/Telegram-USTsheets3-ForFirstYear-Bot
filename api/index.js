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

// ── جدول المحاضرات ──
const SCHEDULE = {
  "السبت":    [{ time: "20:00 – 22:00", subject: "Physics - 1" }],
  "الأحد":    [],
  "الاثنين":  [{ time: "10:00 – 12:00", subject: "General Chemistry" }],
  "الثلاثاء": [],
  "الأربعاء": [
    { time: "08:00 – 10:00", subject: "Introduction to Computer" },
    { time: "10:00 – 12:00", subject: "Calculus and its Application - 1" },
    { time: "13:00 – 15:00", subject: "Linear Algebra and Matrices" }
  ],
  "الخميس":   [
    { time: "11:00 – 13:00", subject: "General English Language" },
    { time: "13:00 – 15:00", subject: "Introduction to Materials Science" }
  ]
};

const DAY_NAMES = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

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

// ── لوحات التحكم ──
function mainMenuKeyboard(isAdmin) {
  const rows = [
    [
      { text: "📚 الشيتات",  callback_data: "menu|sheets"   },
      { text: "📅 الجدول",  callback_data: "menu|schedule" }
    ]
  ];
  if (isAdmin) {
    rows.push([
      { text: "📊 الإحصائيات", callback_data: "menu|stats"     },
      { text: "📢 Broadcast",  callback_data: "menu|broadcast" }
    ]);
  }
  return { inline_keyboard: rows };
}

function subjectsKeyboard() {
  const rows = [];
  for (let i = 0; i < ALL_SUBJECTS.length; i += 2) {
    const row = [{ text: `📘 ${ALL_SUBJECTS[i]}`, callback_data: `sub|${ALL_SUBJECTS[i]}` }];
    if (ALL_SUBJECTS[i + 1]) {
      row.push({ text: `📘 ${ALL_SUBJECTS[i + 1]}`, callback_data: `sub|${ALL_SUBJECTS[i + 1]}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "🏠 القائمة الرئيسية", callback_data: "menu|home" }]);
  return { inline_keyboard: rows };
}

function lecturesKeyboard(subject, lectures) {
  const sorted  = Object.keys(lectures).sort(naturalSort);
  const buttons = sorted.map(lec => [{ text: `📄 ${lec}`, callback_data: `lec|${subject}|||${lec}` }]);
  buttons.push([{ text: "🔙 رجوع", callback_data: "back|sheets" }]);
  return { inline_keyboard: buttons };
}

function backToHomeKeyboard() {
  return { inline_keyboard: [[{ text: "🏠 القائمة الرئيسية", callback_data: "menu|home" }]] };
}

// ── معالجة الأوامر ──
async function handleStart(chatId, firstName, isAdmin) {
  await trackUser(chatId);
  const adminBadge = isAdmin ? " 👑" : "";
  await telegramRequest("sendMessage", {
    chat_id:      chatId,
    text:         `👋 أهلاً ${firstName || ""}${adminBadge}!\n\nاختر من القائمة:`,
    reply_markup: mainMenuKeyboard(isAdmin)
  });
}

function buildScheduleText() {
  const today     = new Date();
  const dayName   = DAY_NAMES[today.getDay()];
  const todayLecs = SCHEDULE[dayName] || [];

  let text = "";

  // محاضرات اليوم
  if (todayLecs.length > 0) {
    text += `⚡️ محاضرات اليوم (${dayName}):\n`;
    for (const lec of todayLecs) {
      text += `🕐 ${lec.time} — ${lec.subject}\n`;
    }
  } else {
    text += `✅ لا توجد محاضرات اليوم (${dayName})\n`;
  }

  text += "\n📅 الجدول الكامل:\n━━━━━━━━━━━━━━━\n\n";

  for (const [day, lectures] of Object.entries(SCHEDULE)) {
    const isToday = day === dayName;
    text += isToday ? `📍 ${day} (اليوم)\n` : `📆 ${day}\n`;
    if (lectures.length === 0) {
      text += "  لا توجد محاضرات\n";
    } else {
      for (const lec of lectures) {
        text += `  🕐 ${lec.time} — ${lec.subject}\n`;
      }
    }
    text += "\n";
  }

  return text;
}

async function handleCallback(callback) {
  const queryId   = callback.id;
  const chatId    = callback.message.chat.id;
  const msgId     = callback.message.message_id;
  const data      = callback.data;
  const isAdmin   = chatId === ADMIN_ID;
  const firstName = callback.from?.first_name || "";
  const subjects  = getSubjects();

  await telegramRequest("answerCallbackQuery", { callback_query_id: queryId });

  // ── القائمة الرئيسية ──
  if (data.startsWith("menu|")) {
    const action = data.slice(5);

    if (action === "home") {
      const adminBadge = isAdmin ? " 👑" : "";
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         `👋 أهلاً ${firstName}${adminBadge}!\n\nاختر من القائمة:`,
        reply_markup: mainMenuKeyboard(isAdmin)
      });

    } else if (action === "sheets") {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         "📚 اختر المادة:",
        reply_markup: subjectsKeyboard()
      });

    } else if (action === "schedule") {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         buildScheduleText(),
        reply_markup: backToHomeKeyboard()
      });

    } else if (action === "stats" && isAdmin) {
      const { total, users, subjectStats } = await getStats();
      const sorted = Object.entries(subjectStats).sort((a, b) => b[1] - a[1]);
      const lines  = sorted.length > 0
        ? sorted.map(([s, c]) => `📖 ${s}: ${c} تحميل`).join("\n")
        : "لا توجد بيانات بعد";
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         `📊 الإحصائيات:\n\n👥 المستخدمون: ${users}\n📥 إجمالي التحميلات: ${total}\n\n📚 تفاصيل المواد:\n${lines}`,
        reply_markup: backToHomeKeyboard()
      });

    } else if (action === "broadcast" && isAdmin) {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         "📢 أرسل نص الرسالة الآن:\n\nمثال: تم إضافة شيتات Physics الجديدة! 📚",
        reply_markup: backToHomeKeyboard()
      });
      await redisRequest("set", `broadcast_mode:${chatId}`, "1", "EX", "300");
    }

  // ── قائمة الشيتات ──
  } else if (data.startsWith("sub|")) {
    const subject  = data.slice(4);
    const lectures = subjects[subject] || {};
    if (Object.keys(lectures).length === 0) {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         `📖 ${subject}\n⚠️ لا توجد شيتات متوفرة بعد.`,
        reply_markup: backToHomeKeyboard()
      });
    } else {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         `📖 ${subject} — اختر الشيت:`,
        reply_markup: lecturesKeyboard(subject, lectures)
      });
    }

  } else if (data.startsWith("back|")) {
    const target = data.slice(5);
    if (target === "sheets") {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         "📚 اختر المادة:",
        reply_markup: subjectsKeyboard()
      });
    }

  // ── تحميل ملف ──
  } else if (data.startsWith("lec|")) {
    const rest               = data.slice(4);
    const [subject, lecture] = rest.split("|||");
    const fileVal            = subjects[subject]?.[lecture];

    if (fileVal) {
      await trackDownload(subject);
      if (fileVal.startsWith("fileid:")) {
        const fileId = LARGE_FILES[fileVal.slice(7)];
        await telegramRequest("sendDocument", {
          chat_id: chatId, document: fileId,
          caption: `📚 ${subject}\n📄 ${lecture}`
        });
      } else {
        await telegramRequest("sendDocument", {
          chat_id:  chatId,
          document: `${RAW_BASE}/${encodeURIComponent(fileVal)}`,
          caption:  `📚 ${subject}\n📄 ${lecture}`
        });
      }
    } else {
      await telegramRequest("sendMessage", { chat_id: chatId, text: "❌ الملف غير موجود." });
    }
  }
}

async function handleMessage(msg) {
  const chatId    = msg.chat.id;
  const text      = msg.text || "";
  const firstName = msg.from?.first_name || "";
  const isAdmin   = chatId === ADMIN_ID;

  if (text.startsWith("/start")) {
    await handleStart(chatId, firstName, isAdmin);
    return;
  }

  // تحقق إذا المشرف في وضع broadcast
  if (isAdmin) {
    const mode = await redisRequest("get", `broadcast_mode:${chatId}`);
    if (mode === "1" && !text.startsWith("/")) {
      await redisRequest("del", `broadcast_mode:${chatId}`);
      const users = await getAllUsers();
      let success = 0, failed = 0;
      for (const userId of users) {
        const result = await telegramRequest("sendMessage", {
          chat_id: userId,
          text:    `📢 إشعار:\n\n${text}`
        });
        if (result?.ok) success++; else failed++;
      }
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text:    `✅ تم الإرسال!\n\n📤 نجح: ${success}\n❌ فشل: ${failed}`
      });
      return;
    }
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("البوت شغال ✅");
  }

  if (req.method === "POST") {
    const update = req.body;
    if (update?.message) {
      await handleMessage(update.message);
    } else if (update?.callback_query) {
      await handleCallback(update.callback_query);
    }
    return res.status(200).send("OK");
  }

  res.status(405).send("Method Not Allowed");
}
