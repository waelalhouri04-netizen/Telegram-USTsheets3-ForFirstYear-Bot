import os
import re
import json
import requests
from flask import Flask, request, Response

app = Flask(__name__)

TOKEN = os.environ.get("TOKEN")
API   = f"https://api.telegram.org/bot{TOKEN}"

BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES_DIR = os.path.join(BASE_DIR, "files")

ALL_SUBJECTS = [
    "Physics", "Chemistry", "Computer",
    "Calculus", "Linear", "English",
    "Materials", "History"
]


def natural_sort_key(text):
    return [
        int(c) if c.isdigit() else c.lower()
        for c in re.split(r'(\d+)', text)
    ]


def get_subjects():
    subjects    = {}
    subject_map = {s.lower(): s for s in ALL_SUBJECTS}
    if not os.path.exists(FILES_DIR):
        return subjects
    for filename in os.listdir(FILES_DIR):
        if not filename.lower().endswith(".pdf"):
            continue
        name = filename[:-4]
        dash = name.find("-")
        if dash == -1:
            continue
        raw_subject = name[:dash]
        lecture     = name[dash + 1:]
        subject     = subject_map.get(raw_subject.lower(), raw_subject)
        subjects.setdefault(subject, {})[lecture] = os.path.join(FILES_DIR, filename)
    return subjects


def send_message(chat_id, text, reply_markup=None):
    data = {"chat_id": chat_id, "text": text}
    if reply_markup:
        data["reply_markup"] = json.dumps(reply_markup)
    requests.post(f"{API}/sendMessage", json=data)


def edit_message(chat_id, message_id, text, reply_markup=None):
    data = {"chat_id": chat_id, "message_id": message_id, "text": text}
    if reply_markup:
        data["reply_markup"] = json.dumps(reply_markup)
    requests.post(f"{API}/editMessageText", json=data)


def send_document(chat_id, file_path, caption=None):
    with open(file_path, "rb") as f:
        data = {"chat_id": chat_id}
        if caption:
            data["caption"] = caption
        requests.post(f"{API}/sendDocument", files={"document": f}, data=data)


def answer_callback(callback_id):
    requests.post(f"{API}/answerCallbackQuery",
                  json={"callback_query_id": callback_id})


def subjects_keyboard():
    return {
        "inline_keyboard": [
            [{"text": f"📘 {sub}", "callback_data": f"sub|{sub}"}]
            for sub in ALL_SUBJECTS
        ]
    }


def lectures_keyboard(subject, lectures):
    buttons = [
        [{"text": f"📄 {lec}", "callback_data": f"lec|{subject}|||{lec}"}]
        for lec in sorted(lectures.keys(), key=natural_sort_key)
    ]
    buttons.append([{"text": "🔙 رجوع", "callback_data": "back"}])
    return {"inline_keyboard": buttons}


def back_keyboard():
    return {"inline_keyboard": [[{"text": "🔙 رجوع", "callback_data": "back"}]]}


def handle_start(chat_id):
    send_message(chat_id,
                 "👋 أهلاً! اختر المادة لتصفح الشيتات:",
                 reply_markup=subjects_keyboard())


def handle_callback(callback):
    query_id = callback["id"]
    chat_id  = callback["message"]["chat"]["id"]
    msg_id   = callback["message"]["message_id"]
    data     = callback["data"]
    subjects = get_subjects()

    answer_callback(query_id)

    if data.startswith("sub|"):
        subject  = data[4:]
        lectures = subjects.get(subject, {})
        if not lectures:
            edit_message(chat_id, msg_id,
                         f"📖 {subject}\n⚠️ لا توجد شيتات متوفرة بعد.",
                         reply_markup=back_keyboard())
        else:
            edit_message(chat_id, msg_id,
                         f"📖 {subject} — اختر الشيت:",
                         reply_markup=lectures_keyboard(subject, lectures))

    elif data.startswith("lec|"):
        rest             = data[4:]
        subject, lecture = rest.split("|||", 1)
        file_path        = subjects.get(subject, {}).get(lecture)
        if file_path and os.path.exists(file_path):
            send_document(chat_id, file_path,
                          caption=f"📚 {subject}\n📄 {lecture}")
        else:
            send_message(chat_id, "❌ الملف غير موجود.")

    elif data == "back":
        edit_message(chat_id, msg_id,
                     "📚 اختر المادة:",
                     reply_markup=subjects_keyboard())


@app.route("/api/index", methods=["GET"])
def get_index():
    return Response("البوت شغال ✅", status=200, mimetype="text/plain; charset=utf-8")


@app.route("/api/index", methods=["POST"])
def post_index():
    update = request.get_json(force=True, silent=True)
    if update:
        if "message" in update:
            msg  = update["message"]
            text = msg.get("text", "")
            if text.startswith("/start"):
                handle_start(msg["chat"]["id"])
        elif "callback_query" in update:
            handle_callback(update["callback_query"])
    return Response("OK", status=200)
