import crypto from "node:crypto";

export const MASTERED_CORRECT = 3;
export const MASTERED_MARGIN = 2;
export const WORD_MODES = new Set(["cn-to-en", "en-to-cn-choice", "letter-fill", "cn-to-en-choice", "cn-meaning-fill"]);
export const PHRASE_MODES = new Set(["phrase-tail-choice", "phrase-tail-fill"]);

export function isPhrase(entry = {}) {
  return entry.category === "短语" || entry.category === "短语与固定搭配" || Boolean(entry.phraseTail || entry.phrase_tail);
}

export function isMastered(correct = 0, wrong = 0) {
  return correct >= MASTERED_CORRECT && correct - wrong >= MASTERED_MARGIN;
}

export function itemId(entry) {
  const kind = isPhrase(entry) ? "phrase" : "word";
  const raw = [kind, entry.letter ?? "", entry.category ?? "", entry.word ?? ""].join(":");
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const stable = {
    category: entry.category ?? "",
    letter: entry.letter ?? "",
    meaning: entry.meaning ?? "",
    raw: entry.raw ?? "",
    type: kind,
    word: entry.word ?? "",
  };
  const fingerprint = crypto.createHash("sha1").update(JSON.stringify(stable)).digest("hex").slice(0, 12);
  return slug.slice(0, 86) + "-" + fingerprint;
}

export function rowToItem(row) {
  return {
    id: row.id,
    type: row.type,
    letter: row.letter,
    category: row.category,
    word: row.word,
    phraseHead: row.phrase_head ?? "",
    phraseTail: row.phrase_tail ?? "",
    phonetic: row.phonetic ?? "",
    meaning: row.meaning ?? "",
  };
}

export function createStudyService({ db, entries, random = Math.random }) {
  async function init() {
    await db.batch([
      "CREATE TABLE IF NOT EXISTS study_items (id TEXT PRIMARY KEY, type TEXT NOT NULL, letter TEXT NOT NULL, category TEXT NOT NULL, word TEXT NOT NULL, phrase_head TEXT NOT NULL DEFAULT '', phrase_tail TEXT NOT NULL DEFAULT '', phonetic TEXT NOT NULL DEFAULT '', meaning TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL DEFAULT '')",
      "CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
      "CREATE TABLE IF NOT EXISTS student_item_progress (student_id INTEGER NOT NULL, item_id TEXT NOT NULL, correct_count INTEGER NOT NULL DEFAULT 0, wrong_count INTEGER NOT NULL DEFAULT 0, last_answer_correct INTEGER, last_seen_at TEXT, mastered_at TEXT, PRIMARY KEY (student_id, item_id), FOREIGN KEY (student_id) REFERENCES students(id), FOREIGN KEY (item_id) REFERENCES study_items(id))",
    ]);
    await importItems();
  }

  async function importItems() {
    const statements = entries.filter((entry) => entry.word && entry.meaning).map((entry) => {
      const phrase = isPhrase(entry);
      return {
        sql: "INSERT INTO study_items (id, type, letter, category, word, phrase_head, phrase_tail, phonetic, meaning, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET type=excluded.type, letter=excluded.letter, category=excluded.category, word=excluded.word, phrase_head=excluded.phrase_head, phrase_tail=excluded.phrase_tail, phonetic=excluded.phonetic, meaning=excluded.meaning, raw=excluded.raw",
        args: [itemId(entry), phrase ? "phrase" : "word", entry.letter ?? "", entry.category ?? "", entry.word ?? "", entry.phraseHead ?? "", entry.phraseTail ?? "", entry.phonetic ?? "", entry.meaning ?? "", entry.raw ?? ""],
      };
    });
    for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100));
  }

  async function meta() {
    const [categories, letters, total] = await Promise.all([
      db.execute("SELECT DISTINCT category FROM study_items WHERE type='word' ORDER BY category"),
      db.execute("SELECT DISTINCT letter FROM study_items ORDER BY letter"),
      db.execute("SELECT COUNT(*) AS n FROM study_items"),
    ]);
    return { categories: categories.rows.map((row) => row.category), letters: letters.rows.map((row) => row.letter), total: Number(total.rows[0]?.n ?? 0) };
  }

  async function listStudents() {
    const result = await db.execute("SELECT id, name, created_at, last_seen_at FROM students ORDER BY last_seen_at DESC, name ASC");
    return result.rows.map((row) => ({ ...row }));
  }

  async function login(nameValue) {
    const name = String(nameValue ?? "").trim();
    if (!name) throw new Error("请输入学生名字或 ID");
    await db.execute({ sql: "INSERT INTO students(name) VALUES (?) ON CONFLICT(name) DO UPDATE SET last_seen_at=CURRENT_TIMESTAMP", args: [name] });
    const result = await db.execute({ sql: "SELECT id, name FROM students WHERE name = ?", args: [name] });
    const student = { id: Number(result.rows[0].id), name: result.rows[0].name };
    return { student, summary: await summary(student.id) };
  }

  async function progressMap(studentId) {
    const result = await db.execute({ sql: "SELECT item_id, correct_count, wrong_count, mastered_at FROM student_item_progress WHERE student_id = ?", args: [studentId] });
    return new Map(result.rows.map((row) => [row.item_id, row]));
  }

  async function summary(studentId) {
    const [totalResult, masteredResult, correctResult, wrongResult, studiedResult] = await Promise.all([
      db.execute("SELECT COUNT(*) AS n FROM study_items"),
      db.execute({ sql: "SELECT COUNT(*) AS n FROM student_item_progress WHERE student_id = ? AND mastered_at IS NOT NULL", args: [studentId] }),
      db.execute({ sql: "SELECT COALESCE(SUM(correct_count),0) AS n FROM student_item_progress WHERE student_id = ?", args: [studentId] }),
      db.execute({ sql: "SELECT COALESCE(SUM(wrong_count),0) AS n FROM student_item_progress WHERE student_id = ?", args: [studentId] }),
      db.execute({ sql: "SELECT COUNT(*) AS n FROM student_item_progress WHERE student_id = ? AND (correct_count + wrong_count) > 0", args: [studentId] }),
    ]);
    const total = Number(totalResult.rows[0]?.n ?? 0);
    const mastered = Number(masteredResult.rows[0]?.n ?? 0);
    const correct = Number(correctResult.rows[0]?.n ?? 0);
    const wrong = Number(wrongResult.rows[0]?.n ?? 0);
    const studied = Number(studiedResult.rows[0]?.n ?? 0);
    const attempts = correct + wrong;
    const accuracy = attempts ? Math.round((correct / attempts) * 100) : 0;
    const percent = total ? Math.round((mastered / total) * 100) : 100;
    const score = Math.min(100, Math.round(percent * 0.7 + accuracy * 0.2 + Math.min(studied / Math.max(total, 1), 1) * 100 * 0.1));
    const status = percent >= 100 ? "全部掌握" : score >= 80 ? "非常稳定" : score >= 50 ? "稳步提升" : studied ? "正在起步" : "尚未开始";
    return { total, mastered, remaining: total - mastered, percent, correct, wrong, attempts, studied, accuracy, score, status };
  }

  async function session(params) {
    const studentId = Number(params.studentId);
    const mode = params.mode ?? "mixed";
    const letters = new Set(params.letters ?? []);
    const categories = new Set(params.categories ?? []);
    const count = Number(params.count ?? 20);
    const progress = await progressMap(studentId);
    const result = await db.execute("SELECT id, type, letter, category, word, phrase_head, phrase_tail, phonetic, meaning FROM study_items ORDER BY letter, category, word");
    const weighted = [];
    for (const row of result.rows) {
      const item = rowToItem(row);
      const phrase = item.type === "phrase";
      if (letters.size && !letters.has(item.letter)) continue;
      if (PHRASE_MODES.has(mode)) {
        if (!phrase) continue;
      } else if (WORD_MODES.has(mode)) {
        if (phrase) continue;
        if (categories.size && !categories.has(item.category)) continue;
      } else if (categories.size && !phrase && !categories.has(item.category)) {
        continue;
      }
      const p = progress.get(item.id);
      const correct = Number(p?.correct_count ?? 0);
      const wrong = Number(p?.wrong_count ?? 0);
      if (p?.mastered_at) continue;
      const weight = Math.max(1, 1 + wrong * 2 - Math.floor(correct / 2));
      for (let i = 0; i < weight; i++) weighted.push(item);
    }
    const candidates = shuffle(weighted, random);
    const unique = [];
    const seen = new Set();
    for (const item of candidates) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      unique.push(item);
      if (unique.length >= count) break;
    }
    return { items: unique, summary: await summary(studentId) };
  }

  async function answer({ studentId, itemId: itemIdValue, correct }) {
    await db.execute({ sql: "INSERT INTO student_item_progress(student_id, item_id) VALUES (?, ?) ON CONFLICT(student_id, item_id) DO NOTHING", args: [studentId, itemIdValue] });
    await db.execute({ sql: "UPDATE student_item_progress SET correct_count = correct_count + ?, wrong_count = wrong_count + ?, last_answer_correct = ?, last_seen_at = CURRENT_TIMESTAMP WHERE student_id = ? AND item_id = ?", args: [correct ? 1 : 0, correct ? 0 : 1, correct ? 1 : 0, studentId, itemIdValue] });
    const result = await db.execute({ sql: "SELECT correct_count, wrong_count FROM student_item_progress WHERE student_id = ? AND item_id = ?", args: [studentId, itemIdValue] });
    const row = result.rows[0];
    const mastered = isMastered(Number(row.correct_count), Number(row.wrong_count));
    await db.execute({ sql: "UPDATE student_item_progress SET mastered_at = CASE WHEN ? THEN COALESCE(mastered_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE student_id = ? AND item_id = ?", args: [mastered ? 1 : 0, studentId, itemIdValue] });
    return { result: { correctCount: Number(row.correct_count), wrongCount: Number(row.wrong_count), mastered }, summary: await summary(studentId) };
  }

  return { init, meta, listStudents, login, summary, session, answer };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
