import fs from "fs";
import path from "path";
import https from "https";

const TOKEN         = process.env.TOKEN;
const ADMIN_ID      = 1277382550; // رقمك — يستلم الإشعارات
const GITHUB_USER   = "waelalhouri04-netizen";
const GITHUB_REPO   = "Telegram-USTsheets3-ForFirstYear-Bot";
const GITHUB_BRANCH = "main";
const RAW_BASE      = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/files`;

// ── Upstash Redis ──
const REDIS_URL   = process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN;

async function redisRequest(method, ...args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(`${REDIS_URL}/${method}/${args.join("/")}`, {
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` }
    });
    const data = await res.json();
    return data.result;
  } catch {
    return null;
  }
}

// زيادة عداد الإحصائيات
async function trackDownload(subject, lecture) {
  await redisRequest("incr", `downloads:${subject}:${lecture}`);
  await redisRequest("incr", "downloads:total");
}

// حفظ معرف المستخدم
async function trackUser(userId) {
  await redisRequest("sadd", "users", userId);
}

// جلب الإحصائيات
async function getStats() {
  const total   = await redisRequest("get", "downloads:total") || 0;
  const users   = await redisRequest("scard", "users") || 0;
  return { total, users };
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

function subjectsKeyboard() {
  const rows = [];
  for (let i = 0; i < ALL_SUBJECTS.length; i += 2) {
    const row = [{ text: `📘 ${ALL_SUBJECTS[i]}`, callback_data: `sub|${ALL_SUBJECTS[i]}` }];
    if (ALL_SUBJECTS[i + 1]) {
      row.push({ text: `📘 ${ALL_SUBJECTS[i + 1]}`, callback_data: `sub|${ALL_SUBJECTS[i + 1]}` });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

function lecturesKeyboard(subject, lectures) {
  const sorted  = Object.keys(lectures).sort(naturalSort);
  const buttons = sorted.map(lec => [{ text: `📄 ${lec}`, callback_data: `lec|${subject}|||${lec}` }]);
  buttons.push([{ text: "🔙 رجوع", callback_data: "back" }]);
  return { inline_keyboard: buttons };
}

function backKeyboard() {
  return { inline_keyboard: [[{ text: "🔙 رجوع", callback_data: "back" }]] };
}

async function handleStart(chatId, firstName) {
  await trackUser(chatId);
  await telegramRequest("sendMessage", {
    chat_id:      chatId,
    text:         `👋 أهلاً ${firstName || ""}! اختر المادة لتصفح الشيتات:`,
    reply_markup: subjectsKeyboard()
  });
}

async function handleStats(chatId) {
  if (chatId !== ADMIN_ID) {
    await telegramRequest("sendMessage", { chat_id: chatId, text: "❌ هذا الأمر للمشرف فقط." });
    return;
  }
  const { total, users } = await getStats();
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text:    `📊 الإحصائيات:\n\n👥 المستخدمون: ${users}\n📥 إجمالي التحميلات: ${total}`
  });
}

async function handleCallback(callback) {
  const queryId  = callback.id;
  const chatId   = callback.message.chat.id;
  const msgId    = callback.message.message_id;
  const data     = callback.data;
  const subjects = getSubjects();

  await telegramRequest("answerCallbackQuery", { callback_query_id: queryId });

  if (data.startsWith("sub|")) {
    const subject  = data.slice(4);
    const lectures = subjects[subject] || {};
    if (Object.keys(lectures).length === 0) {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         `📖 ${subject}\n⚠️ لا توجد شيتات متوفرة بعد.`,
        reply_markup: backKeyboard()
      });
    } else {
      await telegramRequest("editMessageText", {
        chat_id:      chatId, message_id: msgId,
        text:         `📖 ${subject} — اختر الشيت:`,
        reply_markup: lecturesKeyboard(subject, lectures)
      });
    }

  } else if (data.startsWith("lec|")) {
    const rest               = data.slice(4);
    const [subject, lecture] = rest.split("|||");
    const fileVal            = subjects[subject]?.[lecture];

    if (fileVal) {
      // تسجيل الإحصائيات
      await trackDownload(subject, lecture);

      if (fileVal.startsWith("fileid:")) {
        const key    = fileVal.slice(7);
        const fileId = LARGE_FILES[key];
        await telegramRequest("sendDocument", {
          chat_id:  chatId,
          document: fileId,
          caption:  `📚 ${subject}\n📄 ${lecture}`
        });
      } else {
        const fileUrl = `${RAW_BASE}/${encodeURIComponent(fileVal)}`;
        await telegramRequest("sendDocument", {
          chat_id:  chatId,
          document: fileUrl,
          caption:  `📚 ${subject}\n📄 ${lecture}`
        });
      }
    } else {
      await telegramRequest("sendMessage", { chat_id: chatId, text: "❌ الملف غير موجود." });
    }

  } else if (data === "back") {
    await telegramRequest("editMessageText", {
      chat_id:      chatId, message_id: msgId,
      text:         "📚 اختر المادة:",
      reply_markup: subjectsKeyboard()
    });
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("البوت شغال ✅");
  }

  if (req.method === "POST") {
    const update = req.body;

    if (update?.message) {
      const msg       = update.message;
      const chatId    = msg.chat.id;
      const text      = msg.text || "";
      const firstName = msg.from?.first_name || "";

      if (text.startsWith("/start")) {
        await handleStart(chatId, firstName);
      } else if (text.startsWith("/stats")) {
        await handleStats(chatId);
      }
    } else if (update?.callback_query) {
      await handleCallback(update.callback_query);
    }

    return res.status(200).send("OK");
  }

  res.status(405).send("Method Not Allowed");
}
