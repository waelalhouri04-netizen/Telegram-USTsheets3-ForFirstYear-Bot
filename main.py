from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, CallbackQueryHandler, ContextTypes, filters
import os

# التوكن من Environment Variable
TOKEN = os.environ.get("TOKEN")
if not TOKEN:
    raise ValueError("❌ لم يتم ضبط متغير البيئة TOKEN")

FILES_DIR = "files"
if not os.path.exists(FILES_DIR):
    os.makedirs(FILES_DIR)

# جميع المواد تظهر دائمًا
ALL_SUBJECTS = ["Physics", "Chemistry", "Computer", "Calculus", "Linear", "English", "Materials", "History"]

def get_subjects():
    """إرجاع قاعدة بيانات المواد والمحاضرات الموجودة"""
    subjects = {}
    for filename in os.listdir(FILES_DIR):
        if filename.endswith(".pdf"):
            try:
                name = filename[:-4]
                parts = name.split("-")
                subject = parts[0]
                lecture = "-".join(parts[1:])
                if subject not in subjects:
                    subjects[subject] = {}
                subjects[subject][lecture] = os.path.join(FILES_DIR, filename)
            except:
                continue
    return subjects

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    buttons = [[InlineKeyboardButton(sub, callback_data=f"sub|{sub}")] for sub in ALL_SUBJECTS]
    await update.message.reply_text("📚 اختر المادة", reply_markup=InlineKeyboardMarkup(buttons))

async def button(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    data = query.data
    subjects = get_subjects()

    # اختيار مادة
    if data.startswith("sub|"):
        subject = data.split("|")[1]
        lectures = subjects.get(subject, {})

        if not lectures:
            buttons = [[InlineKeyboardButton("🔙 رجوع", callback_data="back")]]
            await query.edit_message_text(
                f"📖 {subject}\n⚠️ لا توجد محاضرات متوفرة بعد.",
                reply_markup=InlineKeyboardMarkup(buttons)
            )
            return

        buttons = [[InlineKeyboardButton(lec, callback_data=f"lec|{subject}|{lec}")] for lec in sorted(lectures)]
        buttons.append([InlineKeyboardButton("🔙 رجوع", callback_data="back")])
        await query.edit_message_text(f"📖 {subject}", reply_markup=InlineKeyboardMarkup(buttons))

    # اختيار محاضرة
    elif data.startswith("lec|"):
        _, subject, lecture = data.split("|")
        file = subjects.get(subject, {}).get(lecture)
        if file and os.path.exists(file):
            with open(file, "rb") as f:
                await query.message.reply_document(f)
            await query.message.reply_text(f"✅ تم إرسال المحاضرة: {lecture}")
        else:
            await query.message.reply_text("❌ الملف غير موجود")

    # زر رجوع
    elif data == "back":
        buttons = [[InlineKeyboardButton(sub, callback_data=f"sub|{sub}")] for sub in ALL_SUBJECTS]
        await query.edit_message_text("📚 اختر المادة", reply_markup=InlineKeyboardMarkup(buttons))

# ضع Telegram ID الخاص بك هنا
ALLOWED_USERS = [1277382550]

async def handle_file(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.message.from_user.id
    if user_id not in ALLOWED_USERS:
        await update.message.reply_text("❌ هذا البوت خاص ـ الجنخر وائل فقط")
        return

    file = await update.message.document.get_file()
    file_name = update.message.document.file_name
    path = os.path.join(FILES_DIR, file_name)
    await file.download_to_drive(path)
    await update.message.reply_text(f"✅ تم حفظ الملف:\n{file_name}")

# تشغيل البوت
app = ApplicationBuilder().token(TOKEN).build()
app.add_handler(CommandHandler("start", start))
app.add_handler(CallbackQueryHandler(button))
app.add_handler(MessageHandler(filters.Document.ALL, handle_file))

# لأمان Render Web Service
PORT = int(os.environ.get("PORT", 5000))
print(f"🤖 البوت جاهز ويعمل على المنفذ {PORT}")

app.run_polling()
