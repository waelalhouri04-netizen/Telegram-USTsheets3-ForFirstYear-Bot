import fs from "fs";
import path from "path";
import https from "https";

const TOKEN         = process.env.TOKEN;
const GITHUB_USER   = "waelalhouri04-netizen";
const GITHUB_REPO   = "Telegram-USTsheets3-ForFirstYear-Bot";
const GITHUB_BRANCH = "main";
const RAW_BASE      = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/files`;

// ── ملفات كبيرة على Google Drive ──
// الصيغة: "SubjectName-lectureName": "DRIVE_FILE_ID"
const DRIVE_FILES = {
  "English-lec-1": "1wHn3MTvF-fLx9LuYgyRpMfCBARDfFWl6"
};

const ALL_SUBJECTS = [
  "Physics", "Chemistry", "Computer",
  "Calculus", "Linear", "English",
  "Materials", "History"
];

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
    if (!filename.toLowerCase().endsWith(".pdf")) return;
    const name = filename.slice(0, -4);
    const dash = name.indexOf("-");
    if (dash === -1) return;
    const rawSubject = name.slice(0, dash);
    const lecture    = name.slice(dash + 1);
    const subject    = subjectMap[rawSubject.toLowerCase()] || rawSubject;
    if (!subjects[subject]) subjects[subject] = {};
    subjects[subject][lecture] = filename;
  });

  // أضف ملفات Drive لو ما هي موجودة في GitHub
  Object.keys(DRIVE_FILES).forEach(key => {
    const dash    = key.indexOf("-");
    const rawSub  = key.slice(0, dash);
    const lecture = key.slice(dash + 1);
    const subject = subjectMap[rawSub.toLowerCase()] || rawSub;
    if (!subjects[subject]) subjects[subject] = {};
    if (!subjects[subject][lecture]) {
      subjects[subject][lecture] = `drive:${key}`;
    }
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

async function handleStart(chatId) {
  await telegramRequest("sendMessage", {
    chat_id:      chatId,
    text:         "👋 أهلاً! اختر المادة لتصفح الشيتات:",
    reply_markup: subjectsKeyboard()
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
      let fileUrl;

      if (fileVal.startsWith("drive:")) {
        // ملف على Google Drive
        const driveKey = fileVal.slice(6);
        const driveId  = DRIVE_FILES[driveKey];
        fileUrl = `https://drive.google.com/uc?export=download&id=${driveId}`;
      } else {
        // ملف على GitHub
        fileUrl = `${RAW_BASE}/${encodeURIComponent(fileVal)}`;
      }

      await telegramRequest("sendDocument", {
        chat_id:  chatId,
        document: fileUrl,
        caption:  `📚 ${subject}\n📄 ${lecture}`
      });
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
    if (update?.message?.text?.startsWith("/start")) {
      await handleStart(update.message.chat.id);
    } else if (update?.callback_query) {
      await handleCallback(update.callback_query);
    }
    return res.status(200).send("OK");
  }
  res.status(405).send("Method Not Allowed");
}
