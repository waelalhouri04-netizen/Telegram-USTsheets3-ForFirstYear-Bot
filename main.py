import re
import os
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    ApplicationBuilder, CommandHandler,
    MessageHandler, CallbackQueryHandler,
    ContextTypes, filters
)

# ──────────────────────────────────────────
# إعداد المتغيرات
# ──────────────────────────────────────────
TOKEN = os.environ.get("TOKEN")
if not TOKEN:
    raise ValueError("❌ لم يتم ضبط متغير البيئة TOKEN")

RENDER_URL = os.environ.get("RENDER_EXTERNAL_URL")
if not RENDER_URL:
    raise ValueError("❌ لم يتم ضبط متغير البيئة RENDER_EXTERNAL_URL")

PORT = int(os.environ.get("PORT", 5000))

FILES_DIR = "files"
os.makedirs(FILES_DIR, exist_ok=True)

# ──────────────────────────────────────────
# المواد المتاحة (بالترتيب المعروض)
# ──────────────────────────────────────────
ALL_SUBJECTS = [
    "Physics", "Chemistry", "Computer",
    "Calculus", "Linear", "English",
    "Materials", "History"
]

# المستخدمون المسموح لهم برفع الملفات
ALLOWED_USERS = [1277382550]


# ──────────────────────────────────────────
# ترتيب طبيعي (Lecture1, Lecture2 ... Lecture10)
# ──────────────────────────────────────────
def natural_sort_key(text: str):
    """يرتّب النصوص بشكل طبيعي مع الأرقام."""
    return [
        int(c) if c.isdigit() else c.lower()
        for c in re.split(r'(\d+)', text)
    ]


# ──────────────────────────────────────────
# قراءة الملفات من المجلد
# ──────────────────────────────────────────
def get_subjects() -> dict:
    """
    يقرأ ملفات PDF من مجلد files/
    اتفاقية التسمية: SubjectName-LectureName.pdf
    مثال: Physics-Lecture1.pdf
    """
    subjects: dict[str, dict[str, str]] = {}
    for filename in os.listdir(FILES_DIR):
        if not filename.lower().endswith(".pdf"):
            continue
        name = filename[:-4]          # بدون .pdf
        dash = name.find("-")
        if dash == -1:
            continue                  # تجاهل ملفات بدون شرطة
        subject = name[:dash]
        lecture = name[dash + 1:]     # اسم المحاضرة (ممكن يحتوي على شرطة)
        subjects.setdefault(subject, {})[lecture] = os.path.join(FILES_DIR, filename)
    return subjects


# ──────────────────────────────────────────
# أوامر البوت
# ──────────────────────────────────────────
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """يعرض قائمة المواد."""
    buttons = [
        [InlineKeyboardButton(f"📘 {sub}", callback_data=f"sub|{sub}")]
        for sub in ALL_SUBJECTS
    ]
    await update.message.reply_text(
        "👋 أهلاً! اختر المادة لتصفح الشيتات:",
        reply_markup=InlineKeyboardMarkup(buttons)
    )


async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """يعالج ضغطات الأزرار."""
    query = update.callback_query
    await query.answer()
    data: str = query.data
    subjects = get_subjects()

    # ── عرض محاضرات مادة معينة ──
    if data.startswith("sub|"):
        subject = data[4:]            # كل شيء بعد "sub|"
        lectures = subjects.get(subject, {})

        if not lectures:
            await query.edit_message_text(
                f"📖 {subject}\n⚠️ لا توجد شيتات متوفرة بعد.",
                reply_markup=InlineKeyboardMarkup(
                    [[InlineKeyboardButton("🔙 رجوع", callback_data="back")]]
                )
            )
            return

        # ترتيب طبيعي (1، 2، 3 ... 10 وليس 1، 10، 2)
        sorted_lectures = sorted(lectures.keys(), key=natural_sort_key)
        buttons = [
            [InlineKeyboardButton(f"📄 {lec}", callback_data=f"lec|{subject}|||{lec}")]
            for lec in sorted_lectures
        ]
        buttons.append([InlineKeyboardButton("🔙 رجوع", callback_data="back")])

        await query.edit_message_text(
            f"📖 {subject} — اختر الشيت:",
            reply_markup=InlineKeyboardMarkup(buttons)
        )

    # ── إرسال ملف محاضرة ──
    elif data.startswith("lec|"):
        # الفاصل "|||" لتجنب مشكلة الشرطة العمودية في أسماء الملفات
        _, subject, lecture = data.split("|||", 1)
        subject = subject[4:]         # إزالة "lec|" من البداية
        file_path = subjects.get(subject, {}).get(lecture)

        if file_path and os.path.exists(file_path):
            with open(file_path, "rb") as f:
                await query.message.reply_document(
                    document=f,
                    filename=f"{subject} - {lecture}.pdf",
                    caption=f"📚 {subject}\n📄 {lecture}"
                )
        else:
            await query.message.reply_text("❌ الملف غير موجود، تأكد من رفعه.")

    # ── الرجوع للقائمة الرئيسية ──
    elif data == "back":
        buttons = [
            [InlineKeyboardButton(f"📘 {sub}", callback_data=f"sub|{sub}")]
            for sub in ALL_SUBJECTS
        ]
        await query.edit_message_text(
            "📚 اختر المادة:",
            reply_markup=InlineKeyboardMarkup(buttons)
        )


async def handle_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """
    يستقبل ملفات PDF من المستخدمين المسموح لهم.
    اتفاقية التسمية المطلوبة: SubjectName-LectureName.pdf
    """
    user_id = update.message.from_user.id
    if user_id not in ALLOWED_USERS:
        await update.message.reply_text("❌ غير مصرح برفع الملفات الا لـ الجنخر وائل بالهمزة")
        return

    doc = update.message.document
    if not doc.file_name.lower().endswith(".pdf"):
        await update.message.reply_text("⚠️ يُقبل ملفات PDF فقط.")
        return

    if "-" not in doc.file_name:
        await update.message.reply_text(
            "⚠️ اسم الملف غير صحيح!\n"
            "الصيغة الصحيحة: `SubjectName-LectureName.pdf`\n"
            "مثال: `Physics-Lecture3.pdf`",
            parse_mode="Markdown"
        )
        return

    file = await doc.get_file()
    save_path = os.path.join(FILES_DIR, doc.file_name)
    await file.download_to_drive(save_path)
    await update.message.reply_text(
        f"✅ تم حفظ الملف بنجاح:\n`{doc.file_name}`",
        parse_mode="Markdown"
    )


# ──────────────────────────────────────────
# تشغيل البوت
# ──────────────────────────────────────────
app = ApplicationBuilder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(CallbackQueryHandler(button))
app.add_handler(MessageHandler(filters.Document.ALL, handle_file))

app.run_webhook(
    listen="0.0.0.0",
    port=PORT,
    webhook_url=f"{RENDER_URL}/bot{TOKEN}"
)
