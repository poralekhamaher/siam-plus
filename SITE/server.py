import json
import math
import os
import secrets
import shutil
import string
import time
import uuid
from datetime import datetime
from typing import Optional
from urllib.parse import quote
import csv
import io

import generate_schedule_json
from flask import Flask, request, redirect, send_from_directory, abort, make_response, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SCHEDULE_PATH = os.path.join(BASE_DIR, "schedule.json")
# Legacy scraper output location (SCRIPT/ schedule.json) to keep compatibility.
app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")

MAX_SCHEDULE_AGE_SECONDS = 7 * 24 * 60 * 60  # one week
USER_STORE_PATH = os.path.join(BASE_DIR, "users.json")
CAMPUS_LAT = 13.720399
CAMPUS_LNG = 100.453165
CAMPUS_RADIUS_M = 300  # meters
ATTENDANCE_DIR = os.path.join(BASE_DIR, "data", "attendance")
ATTENDANCE_HISTORY_DIR = os.path.join(BASE_DIR, "data", "attendance_history")
ALLOW_OFFCAMPUS = os.environ.get("ALLOW_OFFCAMPUS", "").strip().lower() in ("1", "true", "yes", "on")


def haversine_distance_m(lat1, lon1, lat2, lon2):
    R = 6371000  # meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def is_on_campus(lat, lng):
    return haversine_distance_m(lat, lng, CAMPUS_LAT, CAMPUS_LNG) <= CAMPUS_RADIUS_M


def _clean_student_id(student_id: str) -> str:
    return "".join(ch for ch in (student_id or "") if ch.isalnum() or ch in ("-", "_"))


def _clean_session_token(token: str) -> str:
    return "".join(ch for ch in (token or "") if ch.isalnum() or ch in ("-", "_"))


def _schedule_filename(student_id: str) -> str:
    return f"schedule_{student_id}.json"


def _schedule_path(student_id: str) -> str:
    return os.path.join(BASE_DIR, _schedule_filename(student_id))


def _legacy_schedule_path(student_id: str) -> str:
    return os.path.join(os.path.dirname(BASE_DIR), "SCRIPT", _schedule_filename(student_id))


def _schedule_is_recent(student_id: str, max_age_seconds: int = MAX_SCHEDULE_AGE_SECONDS) -> bool:
    """Return True if schedule file exists and is newer than max_age_seconds (defaults to one week)."""
    schedule_path = _schedule_path(student_id)
    if not os.path.isfile(schedule_path):
        return False
    try:
        age_seconds = time.time() - os.path.getmtime(schedule_path)
    except OSError:
        return False
    return age_seconds < max_age_seconds


def _load_users() -> dict:
    if not os.path.isfile(USER_STORE_PATH):
        return {}
    try:
        with open(USER_STORE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, dict):
            return data
    except Exception:
        app.logger.exception("Failed to read user store")
    return {}


def _save_users(users: dict) -> None:
    tmp_path = USER_STORE_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(users, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, USER_STORE_PATH)


def _ensure_attendance_dir() -> None:
    os.makedirs(ATTENDANCE_DIR, exist_ok=True)


def _ensure_attendance_history_dir() -> None:
    os.makedirs(ATTENDANCE_HISTORY_DIR, exist_ok=True)


def _attendance_path(session_id: str) -> str:
    return os.path.join(ATTENDANCE_DIR, f"{session_id}.json")


def _generate_session_token(length: int = 5) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _generate_code(length: int = 5) -> str:
    alphabet = string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _load_attendance_session(session_id: str) -> Optional[dict]:
    path = _attendance_path(session_id)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        app.logger.exception("Failed to read attendance session %s", session_id)
        return None


def _save_attendance_session(session_id: str, payload: dict) -> None:
    _ensure_attendance_dir()
    path = _attendance_path(session_id)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _ensure_current_code(session_id: str, attendance: dict, now: Optional[float] = None) -> str:
    now = now or time.time()
    issued_at = float(attendance.get("code_issued_at") or 0)
    current_code = attendance.get("current_code")
    if not current_code or (now - issued_at) >= 10:
        current_code = _generate_code()
        attendance["current_code"] = current_code
        attendance["code_issued_at"] = now
        _save_attendance_session(session_id, attendance)
    return current_code


def _find_session_by_code(code: str) -> Optional[tuple]:
    _ensure_attendance_dir()
    for filename in os.listdir(ATTENDANCE_DIR):
        if not filename.endswith(".json"):
            continue
        session_id = filename.rsplit(".", 1)[0]
        attendance = _load_attendance_session(session_id)
        if not attendance:
            continue
        current = _ensure_current_code(session_id, attendance)
        if current == code:
            return session_id, attendance
    return None


def _find_history_file(clean_id: str) -> Optional[str]:
    """Locate an archived attendance history file by session id (in filename or contents)."""
    _ensure_attendance_history_dir()
    for filename in os.listdir(ATTENDANCE_HISTORY_DIR):
        if not filename.endswith(".json"):
            continue
        if clean_id in filename:
            return os.path.join(ATTENDANCE_HISTORY_DIR, filename)
    # Fallback: scan contents
    for filename in os.listdir(ATTENDANCE_HISTORY_DIR):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(ATTENDANCE_HISTORY_DIR, filename)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if (data.get("session_id") or "") == clean_id:
                return path
        except Exception:
            continue
    return None


def get_user(student_id: str) -> Optional[dict]:
    users = _load_users()
    return users.get(student_id)


def create_user(student_id: str, password: str) -> dict:
    users = _load_users()
    record = {
        "student_id": student_id,
        "password_hash": generate_password_hash(password),
        "created_at": time.time(),
    }
    users[student_id] = record
    _save_users(users)
    return record


def verify_local_password(student_id: str, password: str) -> bool:
    user = get_user(student_id)
    if not user:
        return False
    return check_password_hash(user.get("password_hash", ""), password)


def fetch_and_cache_schedule_from_sis(student_id: str, password: str) -> str:
    """
    Run the SIS scraper to verify credentials and refresh schedule_{student_id}.json.
    Removes any stale file before regenerating.
    """
    schedule_path = _schedule_path(student_id)
    if os.path.isfile(schedule_path):
        try:
            os.remove(schedule_path)
        except OSError:
            app.logger.warning("Could not remove existing schedule file for %s", student_id)

    out_path = generate_schedule_json.run_scraper(student_id, password)
    if not os.path.isfile(out_path):
        raise RuntimeError(f"Scraper did not create {out_path}")
    return out_path


@app.route("/", methods=["GET"])
def serve_login_page():
    sid = _clean_student_id((request.args.get("sid") or "").strip())
    dashboard_path = os.path.join(BASE_DIR, "index.html")
    login_path = os.path.join(BASE_DIR, "login.html")

    if sid and os.path.isfile(dashboard_path):
        return send_from_directory(BASE_DIR, "index.html")

    if not os.path.isfile(login_path):
        abort(404, description="login.html not found in project root")
    return send_from_directory(BASE_DIR, "login.html")


@app.route("/dashboard", methods=["GET"])
def serve_dashboard():
    dashboard_path = os.path.join(BASE_DIR, "index.html")
    if not os.path.isfile(dashboard_path):
        abort(404, description="index.html not found in project root")
    return send_from_directory(BASE_DIR, "index.html")


@app.route("/images/<path:filename>", methods=["GET"])
def serve_images(filename: str):
    images_dir = os.path.join(BASE_DIR, "images")
    if not os.path.isdir(images_dir):
        abort(404, description="images directory not found")
    return send_from_directory(images_dir, filename)


@app.route("/style.css", methods=["GET"])
def serve_css():
    css_path = os.path.join(BASE_DIR, "style.css")
    if not os.path.isfile(css_path):
        abort(404, description="style.css not found")
    return send_from_directory(BASE_DIR, "style.css")


@app.route("/app.js", methods=["GET"])
def serve_js():
    js_path = os.path.join(BASE_DIR, "app.js")
    if not os.path.isfile(js_path):
        abort(404, description="app.js not found")
    return send_from_directory(BASE_DIR, "app.js")


@app.route("/prototype.glb", methods=["GET"])
def serve_model():
    model_path = os.path.join(BASE_DIR, "prototype.glb")
    if not os.path.isfile(model_path):
        abort(404, description="prototype.glb not found")
    return send_from_directory(BASE_DIR, "prototype.glb")


@app.route("/schedule.json", methods=["GET"])
def serve_default_schedule():
    authed_id = _clean_student_id(session.get("sid", ""))
    if not authed_id:
        abort(401, description="Not authenticated")
    if not os.path.isfile(SCHEDULE_PATH):
        abort(404, description="schedule.json not found")
    resp = send_from_directory(BASE_DIR, "schedule.json")
    resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


@app.route("/schedule/<student_id>.json", methods=["GET"])
def serve_schedule(student_id: str):
    authed_id = _clean_student_id(session.get("sid", ""))
    if not authed_id:
        abort(401, description="Not authenticated")

    requested_id = _clean_student_id(student_id)
    if requested_id and requested_id != authed_id:
        abort(403, description="Requested student_id does not match the authenticated session")

    filename = _schedule_filename(authed_id)
    schedule_path = _schedule_path(authed_id)
    if not os.path.isfile(schedule_path):
        abort(404, description=f"{filename} not found")

    resp = send_from_directory(BASE_DIR, filename)
    resp.headers["Cache-Control"] = "no-store, must-revalidate"
    return resp


@app.get("/dev/teacher-login")
def dev_teacher_login():
    """
    Dev-only helper: sets session['teacher_id'] so we can test the teacher APIs.
    Usage (local):
      /dev/teacher-login?tid=T001
    """
    tid = request.args.get("tid", "TEST_TEACHER")
    session["teacher_id"] = tid
    return {"ok": True, "teacher_id": session["teacher_id"]}


@app.get("/teacher")
def teacher_dashboard():
    if "teacher_id" not in session:
        return "No teacher_id in session. Hit /dev/teacher-login first.", 401

    teacher_id = session["teacher_id"]
    course_id = request.args.get("course_id", "TEST101")

    return render_template(
        "teacher.html",
        teacher_id=teacher_id,
        course_id=course_id,
    )


@app.post("/api/student/attendance/checkin")
def student_checkin():
    student_id = _clean_student_id(session.get("student_id") or session.get("sid") or "")
    if not student_id:
        return {"ok": False, "error": "Not authenticated"}, 401

    payload = request.get_json(silent=True) or {}
    raw_token = (
        payload.get("session_token")
        or payload.get("sessionToken")
        or payload.get("sessionId")
        or payload.get("token")
        or ""
    )
    session_token = _clean_session_token(raw_token)
    if not session_token:
        return {"ok": False, "error": "session_token is required"}, 400

    lookup = _find_session_by_code(session_token)
    if not lookup:
        return {"ok": False, "error": "Attendance session not found or code expired."}, 404

    session_id, attendance = lookup
    current_code = _ensure_current_code(session_id, attendance)
    if session_token != current_code:
        return {"ok": False, "error": "Invalid or expired code."}, 400

    students = attendance.get("students")
    if not isinstance(students, dict):
        students = {}
        attendance["students"] = students

    raw_name = payload.get("name") or session.get("student_name") or ""
    name = raw_name.strip() if isinstance(raw_name, str) else ""
    if not name:
        name = student_id

    checkin_time = datetime.now().strftime("%H:%M")
    students[student_id] = {"name": name, "status": "present", "time": checkin_time}
    attendance.setdefault("session_id", session_token)
    _save_attendance_session(session_id, attendance)

    return {"ok": True, "message": "Attendance recorded"}


@app.get("/api/teacher/attendance/<session_id>/status")
def teacher_session_status(session_id):
    teacher_id = (session.get("teacher_id") or "").strip()
    if not teacher_id:
        return {"ok": False, "error": "Not authenticated"}, 401

    clean_session_id = _clean_session_token(session_id)
    if not clean_session_id:
        return {"ok": False, "error": "session_id is required"}, 400

    attendance = _load_attendance_session(clean_session_id)
    if attendance is None:
        return {"ok": False, "error": "Attendance session not found."}, 404

    file_teacher_id = (attendance.get("teacher_id") or "").strip()
    if file_teacher_id and file_teacher_id != teacher_id:
        return {"ok": False, "error": "Not authorized for this session."}, 403

    students_dict = attendance.get("students") or {}
    current_code = _ensure_current_code(clean_session_id, attendance)
    student_list = []
    for sid, info in students_dict.items():
        record = info if isinstance(info, dict) else {}
        name = str(record.get("name") or sid)
        status = str(record.get("status") or "pending")
        time_value = str(record.get("time") or "")
        student_list.append({"id": sid, "name": name, "status": status, "time": time_value})

    student_list.sort(key=lambda s: (s.get("name") or s["id"]).lower())
    return {"session_id": clean_session_id, "students": student_list, "current_code": current_code}


@app.post("/api/teacher/attendance/start")
def start_session():
    teacher_id = (session.get("teacher_id") or "").strip()
    if not teacher_id:
        return {"ok": False, "error": "Not authenticated"}, 401

    payload = request.get_json(silent=True) or {}
    raw_course = payload.get("course_id") or payload.get("courseId") or ""
    course_id = raw_course.strip() if isinstance(raw_course, str) else ""
    course_title = (payload.get("course_title") or payload.get("courseTitle") or "").strip()
    course_code = (payload.get("course_code") or payload.get("courseCode") or "").strip()
    section = (payload.get("section") or "").strip()

    # Generate a short, human-friendly token and ensure it is unique on disk.
    _ensure_attendance_dir()
    session_id = _generate_session_token()
    attempts = 0
    while os.path.exists(_attendance_path(session_id)) and attempts < 5:
        session_id = _generate_session_token()
        attempts += 1

    timestamp = datetime.utcnow().replace(microsecond=0).isoformat()
    code = _generate_code()
    issued_at = time.time()
    attendance_record = {
        "session_id": session_id,
        "course_id": course_id,
        "course_title": course_title,
        "course_code": course_code,
        "section": section,
        "teacher_id": teacher_id,
        "timestamp": timestamp,
        "current_code": code,
        "code_issued_at": issued_at,
        "active": True,
        "students": {},
    }
    _save_attendance_session(session_id, attendance_record)
    return {"session_id": session_id, "token": session_id, "current_code": code}


@app.post("/api/teacher/attendance/stop")
def stop_session():
    teacher_id = (session.get("teacher_id") or "").strip()
    if not teacher_id:
        return {"ok": False, "error": "Not authenticated"}, 401

    payload = request.get_json(silent=True) or {}
    raw_session = payload.get("session_id") or payload.get("sessionId") or ""
    session_id = _clean_session_token(raw_session)
    if not session_id:
        return {"ok": False, "error": "session_id is required"}, 400

    attendance = _load_attendance_session(session_id)
    if attendance is None:
        return {"ok": False, "error": "Attendance session not found."}, 404

    if (attendance.get("teacher_id") or "").strip() and attendance.get("teacher_id") != teacher_id:
        return {"ok": False, "error": "Not authorized for this session."}, 403

    stopped_at = datetime.utcnow().replace(microsecond=0).isoformat()
    attendance["active"] = False
    attendance["stopped_at"] = stopped_at
    _save_attendance_session(session_id, attendance)

    _ensure_attendance_history_dir()
    course_code = _clean_session_token(attendance.get("course_code") or attendance.get("course_id") or "course")
    section = _clean_session_token(attendance.get("section") or "sec")
    date_str = datetime.utcnow().strftime("%Y%m%d")
    archive_name = f"{course_code or 'course'}_{section or 'sec'}_{date_str}_{session_id}.json"
    archive_path = os.path.join(ATTENDANCE_HISTORY_DIR, archive_name)
    tmp_path = archive_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(attendance, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, archive_path)

    return {"ok": True, "message": "Session stopped and archived", "session_id": session_id, "stopped_at": stopped_at}


@app.get("/api/teacher/attendance/history")
def attendance_history():
    teacher_id = (session.get("teacher_id") or "").strip()
    if not teacher_id:
        return {"ok": False, "error": "Not authenticated"}, 401

    _ensure_attendance_history_dir()
    records = []
    for filename in os.listdir(ATTENDANCE_HISTORY_DIR):
        if not filename.endswith(".json"):
            continue
        path = os.path.join(ATTENDANCE_HISTORY_DIR, filename)
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("teacher_id") and data.get("teacher_id") != teacher_id:
                continue
            records.append(
                {
                    "session_id": data.get("session_id") or filename.rsplit(".", 1)[0],
                    "course_title": data.get("course_title") or "",
                    "course_code": data.get("course_code") or data.get("course_id") or "",
                    "section": data.get("section") or "",
                    "timestamp": data.get("timestamp") or "",
                    "stopped_at": data.get("stopped_at") or "",
                    "students": data.get("students") or {},
                }
            )
        except Exception:
            continue

    records.sort(key=lambda r: r.get("stopped_at") or r.get("timestamp") or "", reverse=True)
    return {"ok": True, "history": records}


@app.get("/api/teacher/attendance/history/<session_id>")
def attendance_history_detail(session_id):
    teacher_id = (session.get("teacher_id") or "").strip()
    if not teacher_id:
        return {"ok": False, "error": "Not authenticated"}, 401

    clean_id = _clean_session_token(session_id)
    if not clean_id:
        return {"ok": False, "error": "session_id is required"}, 400

    target_file = _find_history_file(clean_id)

    if not target_file or not os.path.isfile(target_file):
        return {"ok": False, "error": "History not found"}, 404

    try:
        with open(target_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {"ok": False, "error": "Failed to read history"}, 500

    file_teacher = (data.get("teacher_id") or "").strip()
    if file_teacher and file_teacher != teacher_id:
        return {"ok": False, "error": "Not authorized"}, 403

    students = []
    for sid, info in (data.get("students") or {}).items():
        record = info if isinstance(info, dict) else {}
        students.append(
            {
                "id": sid,
                "name": record.get("name") or sid,
                "status": record.get("status") or "pending",
                "time": record.get("time") or "",
            }
        )
    students.sort(key=lambda s: (s.get("name") or s["id"]).lower())

    return {
        "ok": True,
        "session": {
            "session_id": data.get("session_id") or clean_id,
            "course_title": data.get("course_title") or "",
            "course_code": data.get("course_code") or data.get("course_id") or "",
            "section": data.get("section") or "",
            "timestamp": data.get("timestamp") or "",
            "stopped_at": data.get("stopped_at") or "",
        },
        "students": students,
    }


@app.get("/api/teacher/attendance/history/<session_id>/export")
def attendance_history_export(session_id):
    """
    Export an archived attendance session as CSV.
    """
    teacher_id = (session.get("teacher_id") or "").strip()
    if not teacher_id:
        return {"ok": False, "error": "Not authenticated"}, 401
    clean_id = _clean_session_token(session_id)
    if not clean_id:
        return {"ok": False, "error": "session_id is required"}, 400

    target_file = _find_history_file(clean_id)
    if not target_file or not os.path.isfile(target_file):
        return {"ok": False, "error": "History not found"}, 404

    try:
        with open(target_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return {"ok": False, "error": "Failed to read history"}, 500

    file_teacher = (data.get("teacher_id") or "").strip()
    if file_teacher and file_teacher != teacher_id:
        return {"ok": False, "error": "Not authorized"}, 403

    students = data.get("students") or {}
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["session_id", "course_code", "section", "student_id", "name", "status", "time"])
    session_val = data.get("session_id") or clean_id
    course_code = data.get("course_code") or data.get("course_id") or ""
    section = data.get("section") or ""
    for sid, info in sorted(
        students.items(),
        key=lambda kv: ((kv[1].get("name") if isinstance(kv[1], dict) else kv[0]) or kv[0]).lower(),
    ):
        record = info if isinstance(info, dict) else {}
        writer.writerow(
            [
                session_val,
                course_code,
                section,
                sid,
                record.get("name") or sid,
                record.get("status") or "pending",
                record.get("time") or "",
            ]
        )

    csv_data = output.getvalue()
    resp = make_response(csv_data)
    resp.headers["Content-Type"] = "text/csv; charset=utf-8"
    resp.headers["Content-Disposition"] = f"attachment; filename=attendance_{clean_id}.csv"
    return resp


@app.route("/login", methods=["POST"])
def login():
    # Accept credentials, run the scraper, then redirect back to "/".
    raw_student_id = (request.form.get("studentId") or "").strip()
    password = request.form.get("password") or ""
    role = (request.form.get("role") or "student").strip().lower()

    if raw_student_id == "teacher" and password == "1234":
        session.pop("sid", None)
        session["teacher_id"] = raw_student_id
        resp = make_response(redirect("/teacher"))
        resp.set_cookie("teacher_id", raw_student_id, max_age=86400, secure=False, httponly=False, samesite="Lax")
        return resp
    if role == "teacher":
        abort(401, description="Invalid teacher credentials")

    if not raw_student_id or not password:
        abort(400, description="studentId and password are required")

    student_id = _clean_student_id(raw_student_id)
    if not student_id:
        abort(400, description="studentId is invalid")

    user = get_user(student_id)
    try:
        if user:
            if not verify_local_password(student_id, password):
                abort(401, description="Invalid credentials")
            if not _schedule_is_recent(student_id):
                fetch_and_cache_schedule_from_sis(student_id, password)
        else:
            # First login: verify against SIS and create a local account.
            fetch_and_cache_schedule_from_sis(student_id, password)
            create_user(student_id, password)
    except Exception as exc:
        app.logger.exception("Failed to authenticate or refresh schedule")
        abort(401, description="Invalid credentials or failed to fetch schedule")

    session["sid"] = student_id
    session["student_id"] = student_id
    resp = make_response(redirect(f"/?sid={quote(student_id)}"))
    resp.set_cookie("sid", student_id, max_age=86400, secure=False, httponly=False, samesite="Lax")
    return resp


@app.route("/logout", methods=["GET"])
def logout():
    """Clear user session (student or teacher) and return to login page."""
    session.clear()
    resp = make_response(redirect("/"))
    # Clear cookies we set for convenience
    resp.set_cookie("sid", "", expires=0, path="/")
    resp.set_cookie("teacher_id", "", expires=0, path="/")
    return resp


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
