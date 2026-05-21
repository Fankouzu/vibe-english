import { MODES, PHRASE_MODE_IDS, WORD_MODE_IDS, buildQuestion, checkAnswer, isPhraseEntry, shuffle } from "./quiz-core.mjs";

const state = {
  student: null,
  summary: null,
  session: null,
  question: null,
  selectedMode: "mixed",
  activeChoice: "",
  streak: 0,
  lastResult: null,
  meta: { letters: [], categories: [], total: 0 },
  students: [],
};

const wordModePool = [...WORD_MODE_IDS];
const phraseModePool = [...PHRASE_MODE_IDS];
const $ = (selector) => document.querySelector(selector);

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "请求失败");
  return payload;
}

function buildFilterButtons(container, items, className) {
  container.innerHTML = items
    .map((item) => `<button class="chip ${className}" type="button" data-value="${item}">${item}</button>`)
    .join("");
}

function selectedValues(selector) {
  return [...document.querySelectorAll(`${selector}.active`)].map((item) => item.dataset.value);
}

function bindChips(selector) {
  document.querySelectorAll(selector).forEach((button) => {
    button.addEventListener("click", () => button.classList.toggle("active"));
  });
}

function sessionOptions() {
  const mode = $("#modeSelect").value;
  return {
    studentId: state.student.id,
    letters: selectedValues(".letter-chip"),
    categories: PHRASE_MODE_IDS.has(mode) ? [] : selectedValues(".category-chip"),
    count: Number($("#sessionCount").value),
    mode,
  };
}

function nextMode(word) {
  if (state.selectedMode !== "mixed") return state.selectedMode;
  const pool = isPhraseEntry(word) ? phraseModePool : wordModePool;
  return pool[Math.floor(Math.random() * pool.length)];
}

function currentWordPool() {
  const sessionWords = state.session?.queue ?? [];
  return sessionWords.length >= 4 ? sessionWords : state.session?.allItems ?? sessionWords;
}

async function loadMeta() {
  state.meta = await api("/api/meta");
  const studentsPayload = await api("/api/students");
  state.students = studentsPayload.students;
  buildFilterButtons($("#letterFilters"), state.meta.letters, "letter-chip");
  buildFilterButtons($("#categoryFilters"), state.meta.categories, "category-chip");
  bindChips(".chip");
  $("#totalWords").textContent = state.meta.total;
  $("#loginTotalWords").textContent = state.meta.total;
  renderStudentList();
}

async function login(name) {
  const payload = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  state.student = payload.student;
  state.summary = payload.summary;
  $("#studentBadge").textContent = `当前学生：${state.student.name}`;
  $("#activeStudentName").textContent = `当前学生：${state.student.name}`;
  $("#loginScreen").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
  renderStats();
  await startSession();
}

function renderStudentList() {
  $("#studentList").innerHTML = state.students.length
    ? state.students
        .map((student) => `<button type="button" class="student-pick" data-name="${escapeAttr(student.name)}">${student.name}</button>`)
        .join("")
    : `<div class="muted">还没有学生记录。</div>`;
  document.querySelectorAll(".student-pick").forEach((button) => {
    button.addEventListener("click", () => login(button.dataset.name));
  });
}

async function startSession() {
  if (!state.student) {
    $(".question-card").innerHTML = `<div class="empty-state">先输入学生名字或 ID 登录。</div>`;
    return;
  }
  state.selectedMode = $("#modeSelect").value;
  updateCategoryFilterState();
  const payload = await api("/api/session", {
    method: "POST",
    body: JSON.stringify(sessionOptions()),
  });
  state.summary = payload.summary;
  state.session = {
    queue: payload.items,
    allItems: payload.items,
    index: 0,
    correct: 0,
    wrong: 0,
    mistakes: [],
  };
  state.streak = 0;
  state.lastResult = null;
  if (!state.session.queue.length) {
    $(".question-card").innerHTML = `<div class="empty-state">当前范围都已掌握，或筛选没有可练习词条。</div>`;
    renderStats();
    return;
  }
  nextQuestion();
  renderStats();
}

function updateCategoryFilterState() {
  const phraseMode = PHRASE_MODE_IDS.has($("#modeSelect").value);
  $("#categoryFilters").classList.toggle("disabled", phraseMode);
  $("#categoryNote").classList.toggle("visible", phraseMode);
}

function nextQuestion() {
  if (!state.session || state.session.index >= state.session.queue.length) {
    finishSession();
    return;
  }
  const word = state.session.queue[state.session.index];
  state.question = buildQuestion(word, currentWordPool(), nextMode(word));
  state.activeChoice = "";
  state.lastResult = null;
  renderQuestion();
}

function renderQuestion() {
  const q = state.question;
  const s = state.session;
  const progress = Math.round((s.index / s.queue.length) * 100);
  $("#progressFill").style.width = `${progress}%`;
  $("#progressText").textContent = `${s.index + 1} / ${s.queue.length}`;

  const isChoice = q.inputType === "choice";
  $(".question-card").innerHTML = `
    <div class="mode-pill">${q.title}</div>
    <div class="prompt">${q.prompt}</div>
    <div class="hint-line">${q.hint}</div>
    ${
      isChoice
        ? `<div class="choice-grid">${q.choices
            .map((choice) => `<button class="choice" type="button" data-choice="${escapeAttr(choice)}">${choice}</button>`)
            .join("")}</div>`
        : `<form id="answerForm" class="answer-form">
            <input id="answerInput" autocomplete="off" placeholder="输入答案后按 Enter" />
            <button type="submit">提交</button>
          </form>`
    }
    <div class="feedback" aria-live="polite"></div>
  `;

  if (isChoice) {
    document.querySelectorAll(".choice").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeChoice = button.dataset.choice;
        document.querySelectorAll(".choice").forEach((item) => item.classList.remove("selected"));
        button.classList.add("selected");
        submitAnswer();
      });
    });
  } else {
    $("#answerForm").addEventListener("submit", (event) => {
      event.preventDefault();
      state.activeChoice = $("#answerInput").value;
      submitAnswer();
    });
    $("#answerInput").focus();
  }
}

async function submitAnswer() {
  if (!state.question || state.lastResult) return;
  const q = state.question;
  const value = state.activeChoice;
  if (!value.trim()) return;
  const ok = checkAnswer(value, q.answer);
  state.lastResult = ok ? "correct" : "wrong";
  state.session.index += 1;
  if (ok) {
    state.session.correct += 1;
    state.streak += 1;
  } else {
    state.session.wrong += 1;
    state.streak = 0;
    state.session.mistakes.push(q.word);
  }
  const payload = await api("/api/answer", {
    method: "POST",
    body: JSON.stringify({ studentId: state.student.id, itemId: q.word.id, correct: ok }),
  });
  state.summary = payload.summary;
  renderFeedback(ok, value, payload.result.mastered);
  renderStats();
}

function renderFeedback(ok, value, mastered) {
  const feedback = $(".feedback");
  feedback.className = `feedback ${ok ? "correct" : "wrong"}`;
  feedback.innerHTML = ok
    ? `<strong>答对了</strong><span>${mastered ? "这个项目已掌握，之后不会再出现。" : `连续 ${state.streak} 题，继续保持。`}</span>`
    : `<strong>再看一眼</strong><span>你的答案：${value}</span><span>正确答案：${state.question.answer}</span>`;
  document.querySelectorAll(".choice").forEach((button) => {
    if (button.dataset.choice === state.question.answer) button.classList.add("correct-choice");
    if (!ok && button.dataset.choice === value) button.classList.add("wrong-choice");
  });
  $("#nextButton").disabled = false;
}

function renderStats() {
  const s = state.session;
  const total = s?.queue.length ?? 0;
  const done = (s?.correct ?? 0) + (s?.wrong ?? 0);
  const accuracy = done ? Math.round(((s?.correct ?? 0) / done) * 100) : 0;
  $("#totalWords").textContent = state.summary?.total ?? state.meta.total ?? 0;
  $("#sessionStat").textContent = total;
  $("#correctStat").textContent = s?.correct ?? 0;
  $("#accuracyStat").textContent = `${accuracy}%`;
  $("#masteryStat").textContent = `${state.summary?.percent ?? 0}%`;
  $("#scoreStat").textContent = state.summary?.score ?? 0;
  $("#statusStat").textContent = state.summary?.status ?? "尚未开始";
  $("#overallStat").textContent = `${state.summary?.percent ?? 0}%`;
  $("#detailStat").textContent = `${state.summary?.mastered ?? 0} / ${state.summary?.total ?? state.meta.total ?? 0}`;
  renderMistakes();
}

function renderMistakes() {
  const mistakes = state.session?.mistakes ?? [];
  const unique = [...new Map(mistakes.map((item) => [item.id, item])).values()].slice(-8).reverse();
  $("#mistakeList").innerHTML = unique.length
    ? unique
        .map((item) => `<li><b>${item.word}</b><span>${item.phonetic || ""}</span><em>${item.meaning}</em></li>`)
        .join("")
    : `<li class="muted">错题会自动出现在这里，错误多的项目会更频繁出现。</li>`;
}

function finishSession() {
  const s = state.session;
  $("#progressFill").style.width = "100%";
  $("#progressText").textContent = `${s.queue.length} / ${s.queue.length}`;
  $(".question-card").innerHTML = `
    <div class="finish-mark">完成</div>
    <div class="prompt">本轮练习结束</div>
    <div class="hint-line">正确 ${s.correct} 题，错题 ${s.wrong} 题。总掌握进度 ${state.summary?.percent ?? 0}%。</div>
    <div class="finish-actions">
      <button id="restartInside" type="button">继续练习</button>
      <button id="mistakeInside" type="button" ${s.mistakes.length ? "" : "disabled"}>复习本轮错题</button>
    </div>
  `;
  $("#restartInside").addEventListener("click", startSession);
  $("#mistakeInside").addEventListener("click", startMistakeSession);
  renderStats();
}

function startMistakeSession() {
  const mistakes = [...new Map((state.session?.mistakes ?? []).map((item) => [item.id, item])).values()];
  if (!mistakes.length) return;
  state.session = {
    queue: shuffle(mistakes),
    allItems: mistakes,
    index: 0,
    correct: 0,
    wrong: 0,
    mistakes: [],
  };
  state.streak = 0;
  nextQuestion();
  renderStats();
}

function escapeAttr(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await login($("#studentName").value);
  } catch (error) {
    $("#studentBadge").textContent = error.message;
  }
});

$("#switchStudentButton").addEventListener("click", async () => {
  $("#appShell").classList.add("hidden");
  $("#loginScreen").classList.remove("hidden");
  await loadMeta();
});

$("#startButton").addEventListener("click", startSession);
$("#modeSelect").addEventListener("change", updateCategoryFilterState);
$("#nextButton").addEventListener("click", () => {
  $("#nextButton").disabled = true;
  nextQuestion();
});
$("#mistakeButton").addEventListener("click", startMistakeSession);
$("#shuffleButton").addEventListener("click", () => {
  document.querySelectorAll(".chip.active").forEach((item) => item.classList.remove("active"));
  shuffle([...document.querySelectorAll(".letter-chip")]).slice(0, 3).forEach((item) => item.classList.add("active"));
  startSession();
});

await loadMeta();
updateCategoryFilterState();
$(".question-card").innerHTML = `<div class="empty-state">输入学生名字或 ID 后开始记录个人学习进度。</div>`;
renderStats();
