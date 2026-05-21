export const MODES = [
  {
    id: "cn-to-en",
    label: "中文填英文",
    inputType: "text",
  },
  {
    id: "en-to-cn-choice",
    label: "英文选中文",
    inputType: "choice",
  },
  {
    id: "letter-fill",
    label: "首尾补全",
    inputType: "text",
  },
  {
    id: "cn-to-en-choice",
    label: "中文选英文",
    inputType: "choice",
  },
  {
    id: "cn-meaning-fill",
    label: "英文填中文",
    inputType: "text",
  },
  {
    id: "phrase-tail-choice",
    label: "短语补全",
    inputType: "choice",
  },
  {
    id: "phrase-tail-fill",
    label: "短语填空",
    inputType: "text",
  },
];

export const WORD_MODE_IDS = new Set(["cn-to-en", "en-to-cn-choice", "letter-fill", "cn-to-en-choice", "cn-meaning-fill"]);
export const PHRASE_MODE_IDS = new Set(["phrase-tail-choice", "phrase-tail-fill"]);

export function normalize(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function pickChoices(words, answerWord, field, count = 4, random = Math.random) {
  const answer = answerWord[field];
  const distractors = words
    .filter((item) => item !== answerWord && item[field] && item[field] !== answer)
    .map((item) => item[field]);
  const uniqueDistractors = [...new Set(distractors)];
  return shuffle([answer, ...shuffle(uniqueDistractors, random).slice(0, count - 1)], random);
}

export function isPhraseEntry(word) {
  return word?.category === "短语" || word?.category === "短语与固定搭配" || Boolean(word?.phraseTail);
}

export function maskWord(word) {
  const chars = Array.from(String(word ?? ""));
  if (chars.length <= 1) return "_";
  if (chars.length === 2) return `${chars[0]} _`;
  return [chars[0], ...chars.slice(1, -1).map((char) => (/[a-z]/i.test(char) ? "_" : char)), chars.at(-1)].join(" ");
}

export function buildQuestion(word, words, mode, random = Math.random) {
  const base = {
    mode,
    word,
    phonetic: word.phonetic || "",
    category: word.category,
    letter: word.letter,
  };
  switch (mode) {
    case "cn-to-en":
      return {
        ...base,
        title: "根据中文写英文",
        prompt: word.meaning,
        hint: word.phonetic || `${word.letter} 开头 · ${word.category}`,
        answer: word.word,
        inputType: "text",
      };
    case "en-to-cn-choice":
      return {
        ...base,
        title: "选择正确中文",
        prompt: word.word,
        hint: word.phonetic || word.category,
        answer: word.meaning,
        choices: pickChoices(words, word, "meaning", 4, random),
        inputType: "choice",
      };
    case "letter-fill":
      return {
        ...base,
        title: "补全中间字母",
        prompt: maskWord(word.word),
        hint: `${word.meaning}${word.phonetic ? ` · ${word.phonetic}` : ""}`,
        answer: word.word,
        inputType: "text",
      };
    case "cn-to-en-choice":
      return {
        ...base,
        title: "根据中文选英文",
        prompt: word.meaning,
        hint: word.phonetic || `${word.letter} 开头`,
        answer: word.word,
        choices: pickChoices(words, word, "word", 4, random),
        inputType: "choice",
      };
    case "cn-meaning-fill":
      return {
        ...base,
        title: "根据英文写中文",
        prompt: word.word,
        hint: word.phonetic || word.category,
        answer: word.meaning,
        inputType: "text",
      };
    case "phrase-tail-choice":
      return {
        ...base,
        title: "补全短语",
        prompt: `${word.phraseHead || word.word.split(/\s+/)[0]} ___`,
        hint: word.meaning,
        answer: word.phraseTail || word.word.split(/\s+/).slice(1).join(" "),
        choices: pickChoices(words.filter(isPhraseEntry), word, "phraseTail", 4, random),
        inputType: "choice",
      };
    case "phrase-tail-fill":
      return {
        ...base,
        title: "填写短语后半部分",
        prompt: `${word.phraseHead || word.word.split(/\s+/)[0]} ___`,
        hint: word.meaning,
        answer: word.phraseTail || word.word.split(/\s+/).slice(1).join(" "),
        inputType: "text",
      };
    default:
      throw new Error(`Unknown quiz mode: ${mode}`);
  }
}

export function checkAnswer(input, answer) {
  return normalize(input) === normalize(answer);
}

export function createSession(words, options = {}) {
  const {
    letters = [],
    categories = [],
    count = 20,
    mode = "mixed",
    random = Math.random,
  } = options;
  const letterSet = new Set(letters);
  const categorySet = new Set(categories);
  const filtered = words.filter((item) => {
    const hasLetter = !letterSet.size || letterSet.has(item.letter);
    const isPhrase = isPhraseEntry(item);
    const usesPhraseMode = PHRASE_MODE_IDS.has(mode);
    const hasCategory = usesPhraseMode || !categorySet.size || categorySet.has(item.category);
    const matchesMode =
      mode === "mixed"
        ? true
        : usesPhraseMode
          ? isPhrase
          : WORD_MODE_IDS.has(mode)
            ? !isPhrase
            : true;
    return hasLetter && hasCategory && matchesMode && item.word && item.meaning;
  });
  const queue = shuffle(filtered, random).slice(0, Math.min(count, filtered.length));
  return {
    queue,
    index: 0,
    correct: 0,
    wrong: 0,
    mistakes: [],
  };
}
