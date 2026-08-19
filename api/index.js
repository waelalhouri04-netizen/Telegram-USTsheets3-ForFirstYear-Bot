import fs from "fs";
import path from "path";
import https from "https";

const TOKEN         = process.env.TOKEN;
const ADMIN_ID      = 1277382550;
const GITHUB_USER   = "waelalhouri04-netizen";
const GITHUB_REPO   = "Telegram-USTsheets3-ForFirstYear-Bot";
const GITHUB_BRANCH = "main";
const RAW_BASE      = `https://github.com/${GITHUB_USER}/${GITHUB_REPO}/raw/${GITHUB_BRANCH}/files`;

const REDIS_URL   = process.env.NEWREDIS_KV_REST_API_URL   || process.env.KV_REST_API_URL   || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.NEWREDIS_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// ── Redis (بيبعت الأمر كـ JSON في جسم الطلب، عشان أي نص فيه مسافات أو رموز خاصة يتبعت صح) ──
async function redisRequest(...args) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  try {
    const res = await fetch(REDIS_URL, {
      method:  "POST",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}`, "Content-Type": "application/json" },
      body:    JSON.stringify(args)
    });
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
  for (const { label } of SUBJECTS) {
    const count = parseInt(await redisRequest("get", `subject:${label}`) || 0);
    if (count > 0) subjectStats[label] = count;
  }
  return { total, users, subjectStats };
}

async function getAllUsers() {
  return await redisRequest("smembers", "users") || [];
}

// ── حالة المستخدم الحالية (main أو subject:الاسم) ──
async function getState(userId) {
  return (await redisRequest("get", `state:${userId}`)) || "main";
}

async function setState(userId, state) {
  await redisRequest("set", `state:${userId}`, state);
}

// ── ملفات كبيرة (لازم يتضاف بأكواد المواد الجديدة لو احتجت) ──
const LARGE_FILES = {
  // مثال: "Physics2-1": "FILE_ID_HERE"
};

// ── مواد الترم الجديد ──
// code: يستخدم في تسمية الملفات جوه مجلد files/  مثال: DataStructures-1.pdf
// label: الاسم اللي يظهر للطالب كزرار
const SUBJECTS = [
  { code: "DataStructures",     label: "Data Structures and Algorithms" },
  { code: "Physics2",           label: "Physics – 2" },
  { code: "TechEnglish",        label: "Technical English" },
  { code: "EngDrawing",         label: "Fundamentals of Engineering Drawing" },
  { code: "ProgPrinciples",     label: "Principles of Computer Programming" },
  { code: "AnalyticalGeometry", label: "Analytical Geometry" },
  { code: "Calculus2",          label: "Calculus and its Application - 2" }
];

const SUBJECT_LABELS = SUBJECTS.map(s => s.label);

const ALLOWED_EXT = [".pdf", ".pptx", ".docx", ".xlsx", ".png", ".jpg"];

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getSubjects() {
  const subjects  = {};
  const codeMap   = {};
  SUBJECTS.forEach(s => codeMap[s.code.toLowerCase()] = s.label);

  const filesDir = path.join(process.cwd(), "files");
  if (!fs.existsSync(filesDir)) return subjects;

  fs.readdirSync(filesDir).forEach(filename => {
    const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) return;
    const name = filename.slice(0, filename.lastIndexOf("."));
    const dash = name.indexOf("-");
    if (dash === -1) return;
    const rawCode = name.slice(0, dash);
    const lecture = name.slice(dash + 1);
    const label   = codeMap[rawCode.toLowerCase()] || rawCode;
    if (!subjects[label]) subjects[label] = {};
    subjects[label][lecture] = filename;
  });

  Object.keys(LARGE_FILES).forEach(key => {
    const dash    = key.indexOf("-");
    const rawCode = key.slice(0, dash);
    const lecture = key.slice(dash + 1);
    const label   = codeMap[rawCode.toLowerCase()] || rawCode;
    if (!subjects[label]) subjects[label] = {};
    subjects[label][lecture] = `fileid:${key}`;
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
  for (let i = 0; i < SUBJECT_LABELS.length; i += 2) {
    const row = [{ text: SUBJECT_LABELS[i] }];
    if (SUBJECT_LABELS[i + 1]) row.push({ text: SUBJECT_LABELS[i + 1] });
    rows.push(row);
  }
  if (isAdmin) {
    rows.push([{ text: "📊 الإحصائيات" }, { text: "📢 Broadcast" }]);
  }
  return { keyboard: rows, resize_keyboard: true };
}

// ── روابط فيديوهات المحاضرات (بوابة الجامعة) ──
// ضيف هنا: اسم المادة بالظبط (زي label فوق) → رقم المحاضرة → الرابط
const LECTURE_VIDEOS = {
  "Physics – 2": {
    "1": "https://scalelite.ust.edu.sd/playback/presentation/2.3/b484952f7d3510dd803396aeeefe5db6c46f26ee-1784966409912",
    "2": "https://scalelite.ust.edu.sd/playback/presentation/2.3/fbe347832d328dbb9e36c78884630f4660b7bde5-1785571207819",
    "3": "https://scalelite.ust.edu.sd/playback/presentation/2.3/b075af2961fed891ab5b37358818cbf35394a116-1786554007800",
  },
  "Data Structures and Algorithms": {
    "1": "https://scalelite.ust.edu.sd/playback/presentation/2.3/4b7137527d78029ec20de27402a6b67aea0f4582-1784959276474",
    "2": "https://lms.ust.edu.sd/mod/bigbluebuttonbn/bbb_view.php?action=play&bn=34544&rid=32958&rtype=presentation&sesskey=dXC320mbZx",
    "3": "https://scalelite.ust.edu.sd/playback/presentation/2.3/7e8bd3529c1c8338450b6bdb42e9332650f159a3-1786169030263",
  },
  "Fundamentals of Engineering Drawing": {
    "1": "https://scalelite.ust.edu.sd/playback/presentation/2.3/7aa9cee471567b925a775f1fddbf8c0785b3714b-1785049270063",
    "2": "https://scalelite.ust.edu.sd/playback/presentation/2.3/1989083a6a8dfa45ee66c67f628d0d506f3584ac-1785654014612",
    "3": "https://scalelite.ust.edu.sd/playback/presentation/2.3/e0c83087cd0302ed47e9d40d25b286c4ddf35e85-1786259564079",
    
  },
  "Principles of Computer Programming": {
    "1": "https://scalelite.ust.edu.sd/playback/presentation/2.3/775c448b22d4252bdc67ae832da230a0344515ae-1785056416780",
    "2": "https://scalelite.ust.edu.sd/playback/presentation/2.3/9bbd9fb56e6372c958d86c3824feb0a291d48884-1785661224601",
    "3": "https://scalelite.ust.edu.sd/playback/presentation/2.3/71fc6d244c71d68bc784a59d0d7f823e89a3bdeb-1786266016014",
  },
  "Analytical Geometry": {
  "1": "https://scalelite.ust.edu.sd/playback/presentation/2.3/f45270d235d98131ab2c1149c08db45b5af54b8a-1785322806264",
  "3": "https://scalelite.ust.edu.sd/playback/presentation/2.3/e0c83087cd0302ed47e9d40d25b286c4ddf35e85-1786259564079",
  "4": "https://scalelite.ust.edu.sd/playback/presentation/2.3/85d1d39538e4cd007f829b2ffec85d5eae852d82-1786532412887",
  },
  "Calculus and its Application - 2": {
  "1": "https://scalelite.ust.edu.sd/playback/presentation/2.3/9e720f148164c0d8886c27d2636f1bf1badd87e5-1785312522251",
  "2": "https://scalelite.ust.edu.sd/playback/presentation/2.3/daa6fa33bf20cbd16c92da9bd0ded579a5a44c39-1785917070524",
  }
  // "اسم المادة الكامل": { "1": "رابط", "2": "رابط" },
};

function lectureLabel(lec) {
  return /^\d+$/.test(lec) ? `Lec ${lec}` : lec;
}

async function lecturesReplyKeyboard(subject, lectures) {
  const sorted = Object.keys(lectures).sort(naturalSort);
  const rows   = [];
  for (const lec of sorted) {
    rows.push([{ text: lectureLabel(lec) }]);
  }
  rows.push([{ text: "Back" }, { text: "Main Menu" }]);
  return { keyboard: rows, resize_keyboard: true };
}

function subjectMenuKeyboard() {
  return {
    keyboard: [
      [{ text: "📄 الشيتات" }, { text: "🎥 المحاضرات" }],
      [{ text: "Back" }, { text: "Main Menu" }]
    ],
    resize_keyboard: true
  };
}

function videosReplyKeyboard(subject) {
  const videos = LECTURE_VIDEOS[subject] || {};
  const sorted = Object.keys(videos).sort(naturalSort);
  const rows   = sorted.map(lec => [{ text: lectureLabel(lec) }]);
  rows.push([{ text: "Back" }, { text: "Main Menu" }]);
  return { keyboard: rows, resize_keyboard: true };
}

// ── إرسال القائمة الرئيسية ──
async function sendMainMenu(chatId, firstName, isAdmin) {
  await telegramRequest("sendMessage", {
    chat_id:      chatId,
    text:         "اختر المادة:",
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

  // ── زرار Main Menu (يرجع للرئيسية من أي مكان) ──
  if (text === "Main Menu") {
    await setState(chatId, "main");
    await sendMainMenu(chatId, firstName, isAdmin);
    return;
  }

  const subjects = getSubjects();
  const state    = await getState(chatId);

  // ── زرار Back (بيرجع مستوى واحد بس، مش للرئيسية على طول) ──
  if (text === "Back") {
    if (state.startsWith("sheets:") || state.startsWith("videos:")) {
      const subject = state.slice(state.indexOf(":") + 1);
      await setState(chatId, `menu:${subject}`);
      await telegramRequest("sendMessage", {
        chat_id:      chatId,
        text:         `📖 ${subject} — اختر:`,
        reply_markup: subjectMenuKeyboard()
      });
      return;
    }
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

  // ── داخل قائمة مادة (اختيار شيتات / محاضرات) ──
  if (state.startsWith("menu:")) {
    const subject = state.slice(5);

    if (text === "📄 الشيتات") {
      const lectures = subjects[subject] || {};
      if (Object.keys(lectures).length === 0) {
        await telegramRequest("sendMessage", { chat_id: chatId, text: "⚠️ لا توجد شيتات متوفرة بعد.", reply_markup: subjectMenuKeyboard() });
        return;
      }
      await setState(chatId, `sheets:${subject}`);
      await telegramRequest("sendMessage", {
        chat_id:      chatId,
        text:         `📖 ${subject} — اختر الشيت:`,
        reply_markup: await lecturesReplyKeyboard(subject, lectures)
      });
      return;
    }

    if (text === "🎥 المحاضرات") {
      const videos = LECTURE_VIDEOS[subject] || {};
      if (Object.keys(videos).length === 0) {
        await telegramRequest("sendMessage", { chat_id: chatId, text: "⚠️ لا توجد روابط محاضرات متوفرة بعد.", reply_markup: subjectMenuKeyboard() });
        return;
      }
      await setState(chatId, `videos:${subject}`);
      await telegramRequest("sendMessage", {
        chat_id:      chatId,
        text:         `🎥 ${subject} — اختر المحاضرة:`,
        reply_markup: videosReplyKeyboard(subject)
      });
      return;
    }

    // نص غير معروف وهو جوه قائمة المادة → اعرض نفس القائمة تاني
    await telegramRequest("sendMessage", { chat_id: chatId, text: `📖 ${subject} — اختر:`, reply_markup: subjectMenuKeyboard() });
    return;
  }

  // ── داخل قائمة الشيتات ──
  if (state.startsWith("sheets:")) {
    const subject   = state.slice(7);
    const lectures  = subjects[subject] || {};
    const cleanText = text.replace(/^Lec\s+/i, "");

    if (lectures[cleanText]) {
      const fileVal = lectures[cleanText];
      await trackDownload(subject);

      if (fileVal.startsWith("fileid:")) {
        const fileId = LARGE_FILES[fileVal.slice(7)];
        await telegramRequest("sendDocument", { chat_id: chatId, document: fileId, caption: `📚 ${subject}\n📄 ${cleanText}` });
      } else {
        await telegramRequest("sendDocument", { chat_id: chatId, document: `${RAW_BASE}/${encodeURIComponent(fileVal)}`, caption: `📚 ${subject}\n📄 ${cleanText}` });
      }
      return;
    }

    await telegramRequest("sendMessage", {
      chat_id:      chatId,
      text:         `📖 ${subject} — اختر الشيت:`,
      reply_markup: await lecturesReplyKeyboard(subject, lectures)
    });
    return;
  }

  // ── داخل قائمة المحاضرات (روابط الفيديو) ──
  if (state.startsWith("videos:")) {
    const subject   = state.slice(7);
    const videos    = LECTURE_VIDEOS[subject] || {};
    const cleanText = text.replace(/^Lec\s+/i, "");

    if (videos[cleanText]) {
      await telegramRequest("sendMessage", { chat_id: chatId, text: `🎥 ${subject}\n📄 ${lectureLabel(cleanText)}\n\n${videos[cleanText]}` });
      return;
    }

    await telegramRequest("sendMessage", {
      chat_id:      chatId,
      text:         `🎥 ${subject} — اختر المحاضرة:`,
      reply_markup: videosReplyKeyboard(subject)
    });
    return;
  }

  // ── في القائمة الرئيسية: هل النص ده اسم مادة؟ ──
  if (SUBJECT_LABELS.includes(text)) {
    await setState(chatId, `menu:${text}`);
    await telegramRequest("sendMessage", {
      chat_id:      chatId,
      text:         `📖 ${text} — اختر:`,
      reply_markup: subjectMenuKeyboard()
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
