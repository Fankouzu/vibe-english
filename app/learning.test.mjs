import assert from "node:assert/strict";
import test from "node:test";

import {
  isMastered,
  progressSummary,
  weightedStudyQueue,
} from "./learning.mjs";

const items = [
  { id: "w-1", word: "ache", category: "名词", letter: "A" },
  { id: "w-2", word: "activity", category: "名词", letter: "A" },
  { id: "p-1", word: "for example", category: "短语", phraseTail: "example", letter: "F" },
];

const progress = {
  "w-1": { correctCount: 3, wrongCount: 0 },
  "w-2": { correctCount: 1, wrongCount: 3 },
  "p-1": { correctCount: 0, wrongCount: 2 },
};

test("isMastered requires repeated correct answers and error margin", () => {
  assert.equal(isMastered({ correctCount: 3, wrongCount: 0 }), true);
  assert.equal(isMastered({ correctCount: 3, wrongCount: 2 }), false);
  assert.equal(isMastered({ correctCount: 2, wrongCount: 0 }), false);
});

test("weightedStudyQueue excludes mastered items and repeats high-error items", () => {
  const queue = weightedStudyQueue(items, progress, { count: 10, random: () => 0.4 });
  const words = queue.map((item) => item.id);

  assert.equal(words.includes("w-1"), false);
  assert.ok(words.filter((id) => id === "w-2").length > 1);
  assert.ok(words.filter((id) => id === "p-1").length > 1);
});

test("progressSummary reports mastered percentage", () => {
  const summary = progressSummary(items, progress);

  assert.deepEqual(summary, {
    total: 3,
    mastered: 1,
    remaining: 2,
    percent: 33,
  });
});
