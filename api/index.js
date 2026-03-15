import fs from "fs";
import path from "path";
import https from "https";

const TOKEN    = process.env.TOKEN;
const API_BASE = `https://api.telegram.org/bot${TOKEN}`;

const ALL_SUBJECTS = [
  "Physics", "Chemistry", "Computer",
  "Calculus", "Linear", "English",
  "Materials", "History"
];

// ── ترتيب طبيعي للأرقام ──
function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

// ── قراءة الملفات من مجلد files/ ──
function getSubjects() {
  const subjects   = {};
  const subjectMap = {};
  ALL_SUBJECTS.forEach(s => subjectMap[s.toLowerCase()] = s);

  const filesDir = path.join(process.cwd(), "files");
  if (!fs.existsSync(filesDir)) return subjects;

  fs.readdirSync(filesDir).forEach(filename => {
    if (!filename.toLowerCase().endsWith(".pdf")) return;
    const name = filename.slice(0, -4);
    const dash = name.indexOf("-");
    if (dash === -1) return;
    const rawSubject = name.slice(0, dash);
    const lecture    = name.slice(dash + 1);
    const subject    = subjectMap[rawSubject.toLowerCase()] || rawSubject;
    if (!subjects[subject]) subjects[subject] = {};
    subjects[subject][lecture] = path.join(filesDir, filename);
  });

  return subjects;
}

// ── إرسال طلب لـ Telegram API ──
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

// ── إرسال ملف PDF ──
function sendDocument(chatId, filePath, caption) {
  return new Promise((resolve) => {
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const fileData = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    const pre  = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
      (caption ? `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n` : "") +
      `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const post = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([pre, fileData, post]);

    const options = {
      hostname: "api.telegram.org",
      path:     `/bot${TOKEN}/sendDocument`,
      method:   "POST",
      headers:  { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.length }
    };

    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => resolve(JSON.parse(raw)));
    });
    req.on("error", () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ── بناء الأزرار ──
function subjectsKeyboard() {
  return { inline_keyboard: ALL_SUBJECTS.map(s => [{ text: `📘 ${s}`, callback_data: `sub|${s}` }]) };
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

// ── معالجة الأحداث ──
async function handleStart(chatId) {
  await telegramRequest("sendMessage", {
    chat_id:      chatId,
    text:         "👋 أهلاً! اختر المادة لتصفح الشيتات:",
    reply_markup: subjectsKeyboard()
  });
}

async function handleCallback(callback) {
  const queryId = callback.id;
  const chatId  = callback.message.chat.id;
  const msgId   = callback.message.message_id;
  const data    = callback.data;
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
    const filePath           = subjects[subject]?.[lecture];
    if (filePath && fs.existsSync(filePath)) {
      await sendDocument(chatId, filePath, `📚 ${subject}\n📄 ${lecture}`);
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

// ── Vercel Handler ──
export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).send("البوت شغال ✅");
  }

  if (req.method === "POST") {
    const update = req.body;
    if (update?.message?.text?.startsWith("/start")) {
      await handleStart(update.message.chat.id);
    } else if (update?.callback_query) {
      await handleCallback(update.callback_query);
    }
    return res.status(200).send("OK");
  }

  res.status(405).send("Method Not Allowed");
}
