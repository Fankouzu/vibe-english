import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server  # noqa: E402


class ServerLearningTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.original_db = server.DB_FILE
        server.DB_FILE = Path(self.tmp.name) / "study.sqlite3"
        server.init_db()

    def tearDown(self):
        server.DB_FILE = self.original_db
        self.tmp.cleanup()

    def test_login_record_and_mastery_filter(self):
        student = server.upsert_student("alice")
        items = server.query_items(student["id"], {"mode": "cn-to-en", "count": 5})
        self.assertTrue(items)
        self.assertTrue(all(item["type"] == "word" for item in items))

        item_id = items[0]["id"]
        server.record_answer(student["id"], item_id, True)
        server.record_answer(student["id"], item_id, True)
        result = server.record_answer(student["id"], item_id, True)

        self.assertTrue(result["mastered"])
        later = server.query_items(student["id"], {"mode": "cn-to-en", "count": 200})
        self.assertNotIn(item_id, {item["id"] for item in later})

    def test_phrase_mode_ignores_word_categories(self):
        student = server.upsert_student("bob")
        items = server.query_items(student["id"], {"mode": "phrase-tail-choice", "categories": ["名词"], "count": 10})

        self.assertTrue(items)
        self.assertTrue(all(item["type"] == "phrase" for item in items))

    def test_student_list_and_summary_scores(self):
        student = server.upsert_student("cathy")
        item = server.query_items(student["id"], {"mode": "mixed", "count": 1})[0]
        server.record_answer(student["id"], item["id"], True)
        summary = server.student_summary(student["id"])
        students = server.list_students()

        self.assertIn("score", summary)
        self.assertIn("status", summary)
        self.assertEqual(summary["studied"], 1)
        self.assertGreater(summary["score"], 0)
        self.assertTrue(any(row["name"] == "cathy" for row in students))


if __name__ == "__main__":
    unittest.main()
