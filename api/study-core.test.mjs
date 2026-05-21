import test from "node:test";
import assert from "node:assert/strict";
import { createStudyService, isMastered, itemId, rowToItem } from "./study-core.mjs";

const sampleEntries = [
  { letter: "A", category: "名词", word: "apple", phonetic: "/ap-el/", meaning: "苹果", raw: "apple 苹果" },
  { letter: "B", category: "动词", word: "build", phonetic: "/bild/", meaning: "建造", raw: "build 建造" },
  { letter: "F", category: "短语", word: "for example", phraseHead: "for", phraseTail: "example", phonetic: "", meaning: "例如", raw: "for example 例如" },
];

class MemoryDb {
  constructor() { this.items = new Map(); this.students = new Map(); this.progress = new Map(); this.nextStudentId = 1; }
  async batch(statements) { for (const statement of statements) await this.execute(statement); }
  async execute(statement) {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : statement.args ?? [];
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.startsWith("INSERT INTO study_items")) { const [id, type, letter, category, word, phrase_head, phrase_tail, phonetic, meaning, raw] = args; this.items.set(id, { id, type, letter, category, word, phrase_head, phrase_tail, phonetic, meaning, raw }); return { rows: [] }; }
    if (sql.startsWith("INSERT INTO students")) { const [name] = args; if (!this.students.has(name)) this.students.set(name, { id: this.nextStudentId++, name }); return { rows: [] }; }
    if (sql.startsWith("SELECT id, name FROM students")) return { rows: [this.students.get(args[0])] };
    if (sql.startsWith("SELECT id, type")) return { rows: [...this.items.values()].sort((a, b) => a.word.localeCompare(b.word)) };
    if (sql.startsWith("SELECT item_id")) return { rows: [...this.progress.values()].filter((row) => row.student_id === args[0]) };
    if (sql.startsWith("INSERT INTO student_item_progress")) { const key = args[0] + ":" + args[1]; if (!this.progress.has(key)) this.progress.set(key, { student_id: args[0], item_id: args[1], correct_count: 0, wrong_count: 0, mastered_at: null }); return { rows: [] }; }
    if (sql.startsWith("UPDATE student_item_progress") && sql.includes("correct_count = correct_count")) { const row = this.progress.get(args[3] + ":" + args[4]); row.correct_count += args[0]; row.wrong_count += args[1]; return { rows: [] }; }
    if (sql.startsWith("SELECT correct_count, wrong_count")) return { rows: [this.progress.get(args[0] + ":" + args[1])] };
    if (sql.startsWith("UPDATE student_item_progress") && sql.includes("mastered_at")) { this.progress.get(args[1] + ":" + args[2]).mastered_at = args[0] ? "now" : null; return { rows: [] }; }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM study_items")) return { rows: [{ n: this.items.size }] };
    if (sql.includes("COUNT(*) AS n") && sql.includes("mastered_at IS NOT NULL")) return { rows: [{ n: [...this.progress.values()].filter((row) => row.student_id === args[0] && row.mastered_at).length }] };
    if (sql.includes("SUM(correct_count)")) return { rows: [{ n: [...this.progress.values()].filter((row) => row.student_id === args[0]).reduce((sum, row) => sum + row.correct_count, 0) }] };
    if (sql.includes("SUM(wrong_count)")) return { rows: [{ n: [...this.progress.values()].filter((row) => row.student_id === args[0]).reduce((sum, row) => sum + row.wrong_count, 0) }] };
    if (sql.includes("correct_count + wrong_count")) return { rows: [{ n: [...this.progress.values()].filter((row) => row.student_id === args[0] && row.correct_count + row.wrong_count > 0).length }] };
    if (sql.includes("SELECT DISTINCT category")) return { rows: [{ category: "名词" }, { category: "动词" }] };
    if (sql.includes("SELECT DISTINCT letter")) return { rows: [{ letter: "A" }, { letter: "B" }, { letter: "F" }] };
    if (sql.includes("SELECT id, name, created_at")) return { rows: [...this.students.values()] };
    throw new Error("Unhandled SQL in test: " + sql);
  }
}

test("study service imports entries and keeps phrase drills separate", async () => {
  const service = createStudyService({ db: new MemoryDb(), entries: sampleEntries, random: () => 0 });
  await service.init();
  const { student } = await service.login("Ada");
  const words = await service.session({ studentId: student.id, mode: "cn-to-en", count: 10 });
  assert.deepEqual(words.items.map((item) => item.word).sort(), ["apple", "build"]);
  const phrases = await service.session({ studentId: student.id, mode: "phrase-tail-choice", categories: ["名词"], count: 10 });
  assert.deepEqual(phrases.items.map((item) => item.word), ["for example"]);
});

test("study service marks mastered items and excludes them from later sessions", async () => {
  const service = createStudyService({ db: new MemoryDb(), entries: sampleEntries, random: () => 0 });
  await service.init();
  const { student } = await service.login("Grace");
  const appleId = itemId(sampleEntries[0]);
  assert.equal(isMastered(3, 0), true);
  for (let i = 0; i < 3; i++) await service.answer({ studentId: student.id, itemId: appleId, correct: true });
  const session = await service.session({ studentId: student.id, mode: "cn-to-en", count: 10 });
  assert.deepEqual(session.items.map((item) => item.word), ["build"]);
  assert.equal(session.summary.mastered, 1);
});

test("rowToItem maps database rows to frontend shape", () => {
  assert.deepEqual(rowToItem({ id: "x", type: "phrase", letter: "F", category: "短语", word: "for example", phrase_head: "for", phrase_tail: "example", phonetic: "", meaning: "例如" }), { id: "x", type: "phrase", letter: "F", category: "短语", word: "for example", phraseHead: "for", phraseTail: "example", phonetic: "", meaning: "例如" });
});
