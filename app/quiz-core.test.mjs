import assert from "node:assert/strict";
import test from "node:test";

import {
  buildQuestion,
  checkAnswer,
  createSession,
  isPhraseEntry,
  maskWord,
  pickChoices,
} from "./quiz-core.mjs";

const words = [
  { word: "ache", phonetic: "/eɪk/", meaning: "痛；疼痛", letter: "A", category: "名词" },
  { word: "activity", phonetic: "/ækˈtɪvəti/", meaning: "活动", letter: "A", category: "名词" },
  { word: "accept", phonetic: "/əkˈsept/", meaning: "接受", letter: "A", category: "动词" },
  { word: "beautiful", phonetic: "/ˈbjuːtɪfl/", meaning: "美丽的", letter: "B", category: "形容词" },
  { word: "banana", phonetic: "/bəˈnɑːnə/", meaning: "香蕉", letter: "B", category: "名词" },
  { word: "for example", phraseHead: "for", phraseTail: "example", phonetic: "", meaning: "例如", letter: "F", category: "短语" },
  { word: "take care of", phraseHead: "take", phraseTail: "care of", phonetic: "", meaning: "照顾；照料", letter: "T", category: "短语与固定搭配" },
];

test("pickChoices includes the answer and unique distractors", () => {
  const choices = pickChoices(words, words[0], "meaning", 4, () => 0.4);

  assert.equal(choices.length, 4);
  assert.equal(new Set(choices).size, 4);
  assert.ok(choices.includes("痛；疼痛"));
});

test("maskWord keeps first and last letters and blanks the middle", () => {
  assert.equal(maskWord("beautiful"), "b _ _ _ _ _ _ _ l");
  assert.equal(maskWord("go"), "g _");
});

test("buildQuestion supports required study modes", () => {
  const cnToEn = buildQuestion(words[0], words, "cn-to-en", () => 0.2);
  assert.equal(cnToEn.prompt, "痛；疼痛");
  assert.equal(cnToEn.answer, "ache");
  assert.equal(cnToEn.inputType, "text");

  const enToCn = buildQuestion(words[0], words, "en-to-cn-choice", () => 0.2);
  assert.equal(enToCn.prompt, "ache");
  assert.equal(enToCn.answer, "痛；疼痛");
  assert.equal(enToCn.inputType, "choice");

  const spell = buildQuestion(words[3], words, "letter-fill", () => 0.2);
  assert.equal(spell.prompt, "b _ _ _ _ _ _ _ l");
  assert.equal(spell.answer, "beautiful");
  assert.equal(spell.inputType, "text");

  const cnChoice = buildQuestion(words[4], words, "cn-to-en-choice", () => 0.2);
  assert.equal(cnChoice.prompt, "香蕉");
  assert.equal(cnChoice.answer, "banana");
  assert.equal(cnChoice.inputType, "choice");
});

test("checkAnswer accepts case-insensitive English and exact Chinese", () => {
  assert.equal(checkAnswer(" Ache ", "ache"), true);
  assert.equal(checkAnswer("疼痛", "痛；疼痛"), false);
});

test("createSession filters by letter and category", () => {
  const session = createSession(words, { letters: ["A"], categories: ["名词"], count: 10, random: () => 0.3 });

  assert.deepEqual(session.queue.map((item) => item.word).sort(), ["ache", "activity"]);
});

test("phrase entries are identified and excluded from normal word sessions", () => {
  assert.equal(isPhraseEntry(words[5]), true);

  const session = createSession(words, { mode: "cn-to-en", count: 10, random: () => 0.3 });

  assert.equal(session.queue.some((item) => isPhraseEntry(item)), false);
});

test("phrase mode asks for words after the leading word", () => {
  const q = buildQuestion(words[5], words, "phrase-tail-choice", () => 0.2);

  assert.equal(q.prompt, "for ___");
  assert.equal(q.answer, "example");
  assert.equal(q.inputType, "choice");
  assert.ok(q.choices.includes("example"));
  assert.equal(q.word.word, "for example");
});

test("phrase mode ignores part-of-speech category filters", () => {
  const session = createSession(words, {
    mode: "phrase-tail-choice",
    categories: ["名词"],
    count: 10,
    random: () => 0.3,
  });

  assert.equal(session.queue.length, 2);
  assert.equal(session.queue.every(isPhraseEntry), true);
});
