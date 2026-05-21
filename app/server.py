from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import random
import re
import sqlite3
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent.parent
APP_DIR = ROOT / "app"
DATA_FILE = ROOT / "build" / "word_entries.json"
DB_FILE = ROOT / "app" / "study.sqlite3"
MASTERED_CORRECT = 3
MASTERED_MARGIN = 2
WORD_MODES = {"cn-to-en", "en-to-cn-choice", "letter-fill", "cn-to-en-choice", "cn-meaning-fill"}
PHRASE_MODES = {"phrase-tail-choice", "phrase-tail-fill"}


def item_id(entry: dict) -> str:
    kind = "phrase" if is_phrase(entry) else "word"
    raw = f"{kind}:{entry.get('letter','')}:{entry.get('category','')}:{entry.get('word','')}"
    slug = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")
    fingerprint = hashlib.sha1(
        json.dumps(
            {
                "type": kind,
                "letter": entry.get("letter", ""),
                "category": entry.get("category", ""),
                "word": entry.get("word", ""),
                "meaning": entry.get("meaning", ""),
                "raw": entry.get("raw", ""),
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"{slug[:86]}-{fingerprint}"


def is_phrase(entry: dict) -> bool:
    return entry.get("category") in {"短语", "短语与固定搭配"} or bool(entry.get("phraseTail"))


def is_mastered(correct: int, wrong: int) -> bool:
    return correct >= MASTERED_CORRECT and correct - wrong >= MASTERED_MARGIN


def json_response(handler: SimpleHTTPRequestHandler, payload: object, status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def read_json(handler: SimpleHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS study_items (
              id TEXT PRIMARY KEY,
              type TEXT NOT NULL,
              letter TEXT NOT NULL,
              category TEXT NOT NULL,
              word TEXT NOT NULL,
              phrase_head TEXT NOT NULL DEFAULT '',
              phrase_tail TEXT NOT NULL DEFAULT '',
              phonetic TEXT NOT NULL DEFAULT '',
              meaning TEXT NOT NULL DEFAULT '',
              raw TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS students (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL UNIQUE,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS student_item_progress (
              student_id INTEGER NOT NULL,
              item_id TEXT NOT NULL,
              correct_count INTEGER NOT NULL DEFAULT 0,
              wrong_count INTEGER NOT NULL DEFAULT 0,
              last_answer_correct INTEGER,
              last_seen_at TEXT,
              mastered_at TEXT,
              PRIMARY KEY (student_id, item_id),
              FOREIGN KEY (student_id) REFERENCES students(id),
              FOREIGN KEY (item_id) REFERENCES study_items(id)
            );
            """
        )
    import_items()


def import_items() -> None:
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    rows = []
    for entry in payload["entries"]:
      if not entry.get("word") or not entry.get("meaning"):
          continue
      phrase = is_phrase(entry)
      rows.append(
          (
              item_id(entry),
              "phrase" if phrase else "word",
              entry.get("letter", ""),
              entry.get("category", ""),
              entry.get("word", ""),
              entry.get("phraseHead", ""),
              entry.get("phraseTail", ""),
              entry.get("phonetic", ""),
              entry.get("meaning", ""),
              entry.get("raw", ""),
          )
      )
    with db() as conn:
        conn.executemany(
            """
            INSERT INTO study_items
              (id, type, letter, category, word, phrase_head, phrase_tail, phonetic, meaning, raw)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              type=excluded.type,
              letter=excluded.letter,
              category=excluded.category,
              word=excluded.word,
              phrase_head=excluded.phrase_head,
              phrase_tail=excluded.phrase_tail,
              phonetic=excluded.phonetic,
              meaning=excluded.meaning,
              raw=excluded.raw
            """,
            rows,
        )


def row_to_item(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "type": row["type"],
        "letter": row["letter"],
        "category": row["category"],
        "word": row["word"],
        "phraseHead": row["phrase_head"],
        "phraseTail": row["phrase_tail"],
        "phonetic": row["phonetic"],
        "meaning": row["meaning"],
    }


def upsert_student(name: str) -> dict:
    name = name.strip()
    if not name:
        raise ValueError("请输入学生名字或 ID")
    with db() as conn:
        conn.execute(
            """
            INSERT INTO students(name) VALUES (?)
            ON CONFLICT(name) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP
            """,
            (name,),
        )
        row = conn.execute("SELECT id, name FROM students WHERE name = ?", (name,)).fetchone()
    return {"id": row["id"], "name": row["name"]}


def list_students() -> list[dict]:
    with db() as conn:
        rows = conn.execute(
            """
            SELECT id, name, created_at, last_seen_at
            FROM students
            ORDER BY last_seen_at DESC, name ASC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def progress_map(conn: sqlite3.Connection, student_id: int) -> dict[str, sqlite3.Row]:
    rows = conn.execute(
        """
        SELECT item_id, correct_count, wrong_count, mastered_at
        FROM student_item_progress
        WHERE student_id = ?
        """,
        (student_id,),
    ).fetchall()
    return {row["item_id"]: row for row in rows}


def student_summary(student_id: int) -> dict:
    with db() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM study_items").fetchone()["n"]
        mastered = conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM student_item_progress
            WHERE student_id = ? AND mastered_at IS NOT NULL
            """,
            (student_id,),
        ).fetchone()["n"]
        correct = conn.execute(
            "SELECT COALESCE(SUM(correct_count),0) AS n FROM student_item_progress WHERE student_id = ?",
            (student_id,),
        ).fetchone()["n"]
        wrong = conn.execute(
            "SELECT COALESCE(SUM(wrong_count),0) AS n FROM student_item_progress WHERE student_id = ?",
            (student_id,),
        ).fetchone()["n"]
        studied = conn.execute(
            "SELECT COUNT(*) AS n FROM student_item_progress WHERE student_id = ? AND (correct_count + wrong_count) > 0",
            (student_id,),
        ).fetchone()["n"]
    attempts = correct + wrong
    accuracy = round((correct / attempts) * 100) if attempts else 0
    percent = round((mastered / total) * 100) if total else 100
    score = min(100, round(percent * 0.7 + accuracy * 0.2 + min(studied / max(total, 1), 1) * 100 * 0.1))
    if percent >= 100:
        status = "全部掌握"
    elif score >= 80:
        status = "非常稳定"
    elif score >= 50:
        status = "稳步提升"
    elif studied:
        status = "正在起步"
    else:
        status = "尚未开始"
    return {
        "total": total,
        "mastered": mastered,
        "remaining": total - mastered,
        "percent": percent,
        "correct": correct,
        "wrong": wrong,
        "attempts": attempts,
        "studied": studied,
        "accuracy": accuracy,
        "score": score,
        "status": status,
    }


def query_items(student_id: int, params: dict) -> list[dict]:
    mode = params.get("mode", "mixed")
    letters = set(params.get("letters", []))
    categories = set(params.get("categories", []))
    count = int(params.get("count", 20))
    with db() as conn:
        progress = progress_map(conn, student_id)
        rows = conn.execute("SELECT * FROM study_items ORDER BY letter, category, word").fetchall()
    candidates = []
    for row in rows:
        item = row_to_item(row)
        is_phrase_item = item["type"] == "phrase"
        if letters and item["letter"] not in letters:
            continue
        if mode in PHRASE_MODES:
            if not is_phrase_item:
                continue
        elif mode in WORD_MODES:
            if is_phrase_item:
                continue
            if categories and item["category"] not in categories:
                continue
        else:
            if categories and not is_phrase_item and item["category"] not in categories:
                continue
        p = progress.get(item["id"])
        correct = p["correct_count"] if p else 0
        wrong = p["wrong_count"] if p else 0
        if p and p["mastered_at"]:
            continue
        weight = max(1, 1 + wrong * 2 - correct // 2)
        candidates.extend([item] * weight)
    random.shuffle(candidates)
    return candidates[: min(count, len(candidates))]


def record_answer(student_id: int, item_id_value: str, correct: bool) -> dict:
    with db() as conn:
        conn.execute(
            """
            INSERT INTO student_item_progress(student_id, item_id)
            VALUES (?, ?)
            ON CONFLICT(student_id, item_id) DO NOTHING
            """,
            (student_id, item_id_value),
        )
        conn.execute(
            f"""
            UPDATE student_item_progress
            SET
              correct_count = correct_count + ?,
              wrong_count = wrong_count + ?,
              last_answer_correct = ?,
              last_seen_at = CURRENT_TIMESTAMP
            WHERE student_id = ? AND item_id = ?
            """,
            (1 if correct else 0, 0 if correct else 1, 1 if correct else 0, student_id, item_id_value),
        )
        row = conn.execute(
            """
            SELECT correct_count, wrong_count
            FROM student_item_progress
            WHERE student_id = ? AND item_id = ?
            """,
            (student_id, item_id_value),
        ).fetchone()
        mastered = is_mastered(row["correct_count"], row["wrong_count"])
        conn.execute(
            """
            UPDATE student_item_progress
            SET mastered_at = CASE
              WHEN ? THEN COALESCE(mastered_at, CURRENT_TIMESTAMP)
              ELSE NULL
            END
            WHERE student_id = ? AND item_id = ?
            """,
            (1 if mastered else 0, student_id, item_id_value),
        )
    return {"correctCount": row["correct_count"], "wrongCount": row["wrong_count"], "mastered": mastered}


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        parsed = urlparse(path)
        clean = parsed.path.lstrip("/")
        if clean.startswith("app/"):
            return str(ROOT / clean)
        return str(APP_DIR / "index.html")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/meta":
            with db() as conn:
                categories = [
                    row["category"]
                    for row in conn.execute(
                        "SELECT DISTINCT category FROM study_items WHERE type='word' ORDER BY category"
                    )
                ]
                letters = [row["letter"] for row in conn.execute("SELECT DISTINCT letter FROM study_items ORDER BY letter")]
                total = conn.execute("SELECT COUNT(*) AS n FROM study_items").fetchone()["n"]
            json_response(self, {"categories": categories, "letters": letters, "total": total})
            return
        if parsed.path == "/api/students":
            json_response(self, {"students": list_students()})
            return
        if parsed.path == "/api/student/summary":
            qs = parse_qs(parsed.query)
            student_id = int(qs.get("studentId", ["0"])[0])
            json_response(self, student_summary(student_id))
            return
        return super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            body = read_json(self)
            if parsed.path == "/api/login":
                student = upsert_student(str(body.get("name", "")))
                json_response(self, {"student": student, "summary": student_summary(student["id"])})
                return
            if parsed.path == "/api/session":
                student_id = int(body["studentId"])
                items = query_items(student_id, body)
                json_response(self, {"items": items, "summary": student_summary(student_id)})
                return
            if parsed.path == "/api/answer":
                result = record_answer(int(body["studentId"]), str(body["itemId"]), bool(body["correct"]))
                json_response(self, {"result": result, "summary": student_summary(int(body["studentId"]))})
                return
            json_response(self, {"error": "Not found"}, HTTPStatus.NOT_FOUND)
        except Exception as exc:
            json_response(self, {"error": str(exc)}, HTTPStatus.BAD_REQUEST)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    init_db()
    mimetypes.add_type("text/javascript", ".mjs")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Study server: http://{args.host}:{args.port}/app/index.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
