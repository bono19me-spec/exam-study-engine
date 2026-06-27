const CONTENT_PACKS = [
  {
    id: "hisho2",
    title: "秘書検定2級",
    path: "./content/hisho2",
    lessonFiles: [
      "lesson-001.md",
      "lesson-002.md",
      "lesson-003.md",
      "lesson-004.md",
      "lesson-005.md",
      "lesson-006.md",
      "lesson-007.md",
      "lesson-008.md",
      "lesson-009.md",
      "lesson-010.md",
      "lesson-011.md",
      "lesson-012.md",
      "lesson-013.md",
      "lesson-014.md",
      "lesson-015.md",
    ],
    questionFiles: [
      "chapter-01.json",
      "chapter-02.json",
      "chapter-03.json",
      "chapter-04.json",
      "chapter-05.json",
    ],
  },
];

const STORAGE_KEY = "ai-study-engine:v1";
const app = document.querySelector("#app");

let state = {
  pack: null,
  config: null,
  chapters: [],
  lessons: [],
  questions: [],
  resources: [],
  progress: loadProgress(),
  route: parseRoute(),
  translated: false,
};

window.addEventListener("hashchange", () => {
  state.route = parseRoute();
  state.translated = false;
  render();
});

init();

async function init() {
  state.pack = CONTENT_PACKS.find((pack) => pack.id === state.progress.selectedExam) || CONTENT_PACKS[0];
  await loadPack(state.pack);
  render();
}

async function loadPack(pack) {
  const [config, chapters, resources] = await Promise.all([
    getJson(`${pack.path}/exam.config.json`),
    getJson(`${pack.path}/chapters.json`),
    getJson(`${pack.path}/resources.json`),
  ]);
  const lessons = await Promise.all(pack.lessonFiles.map((file) => getText(`${pack.path}/lessons/${file}`).then(parseMarkdownLesson)));
  const questionGroups = await Promise.all(pack.questionFiles.map((file) => getJson(`${pack.path}/questions/${file}`)));
  state.config = config;
  state.chapters = chapters;
  state.lessons = lessons;
  state.questions = questionGroups.flat();
  state.resources = resources;
}

async function getJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

async function getText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

function parseMarkdownLesson(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const frontmatter = {};
  const body = match ? match[2].trim() : source.trim();
  if (match) {
    match[1].split("\n").forEach((line) => {
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      frontmatter[key.trim()] = parseFrontmatterValue(value);
    });
  }
  return { ...frontmatter, body };
}

function parseFrontmatterValue(value) {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  }
  const number = Number(value);
  return Number.isNaN(number) ? value : number;
}

function parseRoute() {
  const [name = "home", param = ""] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "home", param };
}

function navigate(path) {
  location.hash = path;
}

function render() {
  const route = state.route.name;
  const views = {
    home: renderHome,
    exams: renderExams,
    lessons: renderLessons,
    lesson: renderLesson,
    quiz: renderQuiz,
    review: renderReview,
    wrong: renderWrongNotes,
    bookmarks: renderBookmarks,
    mock: renderMockExam,
    result: renderMockResult,
    stats: renderStats,
    resources: renderResources,
    settings: renderSettings,
  };
  app.innerHTML = shell((views[route] || renderHome)());
  bindGlobalActions();
  bindViewActions();
}

function shell(content) {
  return `
    <div class="app-shell">
      <header class="topbar">
        <button class="icon-button" data-nav="home" aria-label="Home">⌂</button>
        <div>
          <p class="eyebrow">AI Study Engine</p>
          <h1>${state.config.title}</h1>
        </div>
        <button class="icon-button" data-action="toggle-theme" aria-label="Theme">◐</button>
      </header>
      <main>${content}</main>
      <nav class="bottom-nav">
        ${navItem("home", "今日")}
        ${navItem("lessons", "レッスン")}
        ${navItem("review", "復習")}
        ${navItem("mock", "模試")}
        ${navItem("stats", "分析")}
      </nav>
    </div>
  `;
}

function navItem(route, label) {
  const active = state.route.name === route ? "active" : "";
  return `<button class="${active}" data-nav="${route}">${label}</button>`;
}

function renderHome() {
  const due = dueQuestions();
  const wrong = Object.values(state.progress.answers).filter((item) => item.wrongCount > 0).length;
  const doneLessons = state.progress.completedLessons.length;
  return `
    <section class="hero">
      <p class="eyebrow">現在の試験</p>
      <h2>${state.config.title}</h2>
      <p>コンテンツパックを差し替えて使える、試験学習エンジンです。</p>
    </section>
    <section class="panel">
      <div class="section-title">
        <h2>今日の学習</h2>
        <span>${estimatedMinutes()}分</span>
      </div>
      <div class="metrics">
        ${metric("新規レッスン", Math.max(0, state.lessons.length - doneLessons))}
        ${metric("復習問題", due.length)}
        ${metric("間違えた問題", wrong)}
      </div>
      <div class="actions">
        <button class="primary" data-nav="lessons">学習を始める</button>
        <button data-nav="review">復習する</button>
        <button data-nav="mock">模擬試験</button>
        <button data-nav="stats">弱点分析</button>
      </div>
    </section>
    <section class="grid-links">
      <button data-nav="wrong">誤答ノート</button>
      <button data-nav="bookmarks">ブックマーク</button>
      <button data-nav="resources">資料リンク</button>
      <button data-nav="exams">試験切替</button>
    </section>
  `;
}

function metric(label, value) {
  return `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`;
}

function estimatedMinutes() {
  return Math.max(8, dueQuestions().length * 2 + Math.max(0, state.lessons.length - state.progress.completedLessons.length) * 6);
}

function renderExams() {
  return `
    <section class="panel">
      <h2>試験を切り替える</h2>
      ${CONTENT_PACKS.map((pack) => `
        <button class="list-row" data-select-exam="${pack.id}">
          <span>${pack.title}</span>
          <small>${pack.id === state.pack.id ? "選択中" : "利用可能"}</small>
        </button>
      `).join("")}
      <p class="note">新しい試験は content フォルダに同じ構造のパックを追加すると拡張できます。</p>
    </section>
  `;
}

function renderLessons() {
  return `
    <section class="section-title">
      <h2>レッスン</h2>
      <span>${state.progress.completedLessons.length}/${state.lessons.length}</span>
    </section>
    <div class="card-list">
      ${state.lessons.map((lesson) => {
        const chapter = state.chapters.find((item) => item.id === lesson.chapterId);
        const done = state.progress.completedLessons.includes(lesson.id);
        return `
          <article class="card">
            <div class="card-head">
              <small>${chapter?.title || ""}</small>
              <span class="status ${done ? "done" : ""}">${done ? "完了" : "未完了"}</span>
            </div>
            <h2>${lesson.title}</h2>
            <p>${lesson.tags.join(" · ")}</p>
            <div class="actions compact">
              <button data-open-lesson="${lesson.id}">読む</button>
              <button data-start-quiz="${lesson.id}">確認問題</button>
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderLesson() {
  const lesson = state.lessons.find((item) => item.id === state.route.param) || state.lessons[0];
  return `
    <article class="lesson">
      <div class="toolbar">
        <button data-nav="lessons">← レッスン</button>
        <button data-action="translate">${state.translated ? "原文に戻す" : "翻訳"}</button>
      </div>
      ${markdownToHtml(state.translated ? translateText(lesson.body) : lesson.body)}
      <div class="actions">
        <button class="primary" data-complete-lesson="${lesson.id}">完了にする</button>
        <button data-start-quiz="${lesson.id}">確認問題へ</button>
      </div>
    </article>
  `;
}

function markdownToHtml(markdown) {
  return markdown
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>")
    .split(/\n{2,}/)
    .map((block) => block.startsWith("<") ? block : `<p>${block}</p>`)
    .join("");
}

function renderQuiz() {
  const questions = questionsForLesson(state.route.param);
  return quizView("確認問題", questions, { mode: "practice", allowSubmit: true });
}

function renderReview() {
  const questions = dueQuestions();
  if (!questions.length) {
    return emptyState("復習問題はありません", "今日の復習予定は空です。新しい問題を解くと復習日が登録されます。", "lessons", "レッスンへ");
  }
  return quizView("今日の復習", questions, { mode: "review", allowSubmit: true });
}

function renderWrongNotes() {
  const wrongIds = Object.entries(state.progress.answers).filter(([, item]) => item.wrongCount > 0).map(([id]) => id);
  const questions = state.questions.filter((question) => wrongIds.includes(question.id));
  return questionList("誤答ノート", questions, "間違えた問題はまだありません。");
}

function renderBookmarks() {
  const bookmarkedIds = Object.entries(state.progress.answers).filter(([, item]) => item.bookmarked).map(([id]) => id);
  const questions = state.questions.filter((question) => bookmarkedIds.includes(question.id));
  return questionList("ブックマーク", questions, "ブックマークはまだありません。");
}

function questionList(title, questions, empty) {
  if (!questions.length) return emptyState(title, empty, "lessons", "問題を解く");
  return `
    <section class="section-title"><h2>${title}</h2><span>${questions.length}</span></section>
    <div class="card-list">
      ${questions.map((question) => questionCard(question)).join("")}
    </div>
  `;
}

function questionCard(question) {
  return `
    <article class="card">
      <div class="card-head">
        <small>${question.tags.join(" · ")}</small>
        <button class="text-button" data-bookmark="${question.id}">${isBookmarked(question.id) ? "★" : "☆"}</button>
      </div>
      <h2>${question.question}</h2>
      <p>${question.explanation}</p>
      <div class="actions compact">
        <button data-start-quiz="${question.lessonId}">もう一度</button>
        <button data-ai-question="${question.id}">AIに質問</button>
      </div>
    </article>
  `;
}

function quizView(title, questions, options) {
  if (!questions.length) return emptyState(title, "この範囲の問題はまだありません。", "lessons", "戻る");
  return `
    <section class="quiz">
      <div class="toolbar">
        <h2>${title}</h2>
        <button data-action="translate">${state.translated ? "原文に戻す" : "翻訳"}</button>
      </div>
      ${questions.map((question, index) => renderQuestion(question, index, options.mode)).join("")}
    </section>
  `;
}

function renderQuestion(question, index, mode) {
  const saved = state.progress.sessionAnswers[sessionKey(mode, question.id)];
  const selected = saved?.selectedIndex;
  const isAnswered = selected !== undefined;
  const correct = selected === question.answerIndex;
  return `
    <article class="question-card">
      <div class="card-head">
        <small>Q${index + 1} · ${question.tags.join(" · ")}</small>
        <button class="text-button" data-bookmark="${question.id}">${isBookmarked(question.id) ? "★" : "☆"}</button>
      </div>
      <h2>${state.translated ? translateText(question.question) : question.question}</h2>
      <div class="choices">
        ${question.choices.map((choice, choiceIndex) => {
          const cls = isAnswered && choiceIndex === question.answerIndex ? "correct" : isAnswered && choiceIndex === selected ? "wrong" : "";
          return `<button class="${cls}" data-answer="${question.id}" data-choice="${choiceIndex}" data-mode="${mode}">${state.translated ? translateText(choice) : choice}</button>`;
        }).join("")}
      </div>
      ${isAnswered ? `
        <div class="explanation ${correct ? "correct" : "wrong"}">
          <strong>${correct ? "正解" : "不正解"}</strong>
          <p>${state.translated ? translateText(question.explanation) : question.explanation}</p>
          <button data-ai-question="${question.id}">AIに質問</button>
        </div>
      ` : ""}
    </article>
  `;
}

function renderMockExam() {
  const started = state.progress.mockSession?.startedAt;
  if (!started) {
    return `
      <section class="panel">
        <h2>模擬試験</h2>
        <p>${state.config.mockExam.questionCount}問 / ${state.config.mockExam.timeLimitMinutes}分。最後にまとめて採点します。</p>
        <button class="primary" data-action="start-mock">開始する</button>
      </section>
    `;
  }
  const ids = state.progress.mockSession.questionIds;
  const questions = ids.map((id) => getQuestion(id)).filter(Boolean);
  const answered = Object.keys(state.progress.mockSession.answers).length;
  return `
    <section class="section-title">
      <h2>模擬試験</h2>
      <span>${answered}/${questions.length}</span>
    </section>
    <section class="quiz">
      ${questions.map((question, index) => renderMockQuestion(question, index)).join("")}
      <button class="primary" data-action="finish-mock">採点する</button>
    </section>
  `;
}

function renderMockQuestion(question, index) {
  const selected = state.progress.mockSession.answers[question.id];
  return `
    <article class="question-card">
      <small>Q${index + 1}</small>
      <h2>${question.question}</h2>
      <div class="choices">
        ${question.choices.map((choice, choiceIndex) => `
          <button class="${selected === choiceIndex ? "selected" : ""}" data-mock-answer="${question.id}" data-choice="${choiceIndex}">${choice}</button>
        `).join("")}
      </div>
    </article>
  `;
}

function renderMockResult() {
  const result = state.progress.lastMockResult;
  if (!result) return emptyState("模擬試験結果", "まだ結果がありません。", "mock", "模擬試験へ");
  const rate = Math.round(result.correct / result.total * 100);
  return `
    <section class="result">
      <p class="eyebrow">模擬試験結果</p>
      <h2>${rate}%</h2>
      <p>${rate >= state.config.mockExam.passingScoreRate * 100 ? "合格圏" : "復習が必要"}</p>
      <div class="metrics">
        ${metric("正解", result.correct)}
        ${metric("問題数", result.total)}
        ${metric("弱点タグ", result.weakTags.length)}
      </div>
    </section>
    <section class="panel">
      <h2>弱点</h2>
      ${result.weakTags.map((tag) => `<span class="tag">${tag}</span>`).join("") || "<p>大きな弱点はありません。</p>"}
      <div class="actions">
        <button data-nav="wrong">間違えた問題を復習</button>
        <button data-action="start-mock">もう一度</button>
      </div>
    </section>
  `;
}

function renderStats() {
  const stats = tagStats();
  return `
    <section class="section-title">
      <h2>弱点分析</h2>
      <span>${stats.length}タグ</span>
    </section>
    <section class="panel">
      ${stats.map((item) => `
        <div class="stat-row">
          <span>${item.tag}</span>
          <meter min="0" max="100" value="${item.rate}"></meter>
          <strong>${item.rate}%</strong>
        </div>
      `).join("") || "<p>まだ分析できる回答がありません。</p>"}
    </section>
  `;
}

function renderResources() {
  return `
    <section class="section-title"><h2>外部無料資料</h2><span>リンクのみ</span></section>
    <div class="card-list">
      ${state.resources.map((resource) => `
        <a class="card link-card" href="${resource.url}" target="_blank" rel="noreferrer">
          <h2>${resource.title}</h2>
          <p>${resource.usage}</p>
        </a>
      `).join("")}
    </div>
  `;
}

function renderSettings() {
  return `
    <section class="panel">
      <h2>設定</h2>
      <label class="field">
        翻訳先
        <select data-setting="language">
          ${state.config.translation.supportedLanguages.map((lang) => `<option value="${lang}" ${state.progress.targetLanguage === lang ? "selected" : ""}>${lang}</option>`).join("")}
        </select>
      </label>
      <button data-action="reset-progress">学習データをリセット</button>
    </section>
  `;
}

function emptyState(title, text, route, label) {
  return `
    <section class="panel empty">
      <h2>${title}</h2>
      <p>${text}</p>
      <button class="primary" data-nav="${route}">${label}</button>
    </section>
  `;
}

function bindGlobalActions() {
  app.querySelectorAll("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  app.querySelector("[data-action='toggle-theme']")?.addEventListener("click", () => {
    document.body.classList.toggle("dark");
    state.progress.darkMode = document.body.classList.contains("dark");
    saveProgress();
  });
}

function bindViewActions() {
  app.querySelectorAll("[data-open-lesson]").forEach((button) => button.addEventListener("click", () => navigate(`lesson/${button.dataset.openLesson}`)));
  app.querySelectorAll("[data-start-quiz]").forEach((button) => button.addEventListener("click", () => navigate(`quiz/${button.dataset.startQuiz}`)));
  app.querySelectorAll("[data-complete-lesson]").forEach((button) => button.addEventListener("click", () => {
    addUnique(state.progress.completedLessons, button.dataset.completeLesson);
    saveProgress();
    navigate(`quiz/${button.dataset.completeLesson}`);
  }));
  app.querySelectorAll("[data-answer]").forEach((button) => button.addEventListener("click", () => answerQuestion(button.dataset.answer, Number(button.dataset.choice), button.dataset.mode)));
  app.querySelectorAll("[data-bookmark]").forEach((button) => button.addEventListener("click", () => toggleBookmark(button.dataset.bookmark)));
  app.querySelectorAll("[data-ai-question]").forEach((button) => button.addEventListener("click", () => copyAiPrompt(button.dataset.aiQuestion)));
  app.querySelector("[data-action='translate']")?.addEventListener("click", () => {
    state.translated = !state.translated;
    render();
  });
  app.querySelector("[data-action='start-mock']")?.addEventListener("click", startMock);
  app.querySelector("[data-action='finish-mock']")?.addEventListener("click", finishMock);
  app.querySelectorAll("[data-mock-answer]").forEach((button) => button.addEventListener("click", () => {
    state.progress.mockSession.answers[button.dataset.mockAnswer] = Number(button.dataset.choice);
    saveProgress();
    render();
  }));
  app.querySelector("[data-action='reset-progress']")?.addEventListener("click", () => {
    state.progress = defaultProgress();
    saveProgress();
    render();
  });
  app.querySelector("[data-setting='language']")?.addEventListener("change", (event) => {
    state.progress.targetLanguage = event.target.value;
    saveProgress();
  });
  app.querySelectorAll("[data-select-exam]").forEach((button) => button.addEventListener("click", async () => {
    state.progress.selectedExam = button.dataset.selectExam;
    state.pack = CONTENT_PACKS.find((pack) => pack.id === state.progress.selectedExam);
    await loadPack(state.pack);
    saveProgress();
    navigate("home");
  }));
}

function questionsForLesson(lessonId) {
  return state.questions.filter((question) => question.lessonId === lessonId);
}

function dueQuestions() {
  const now = Date.now();
  return state.questions.filter((question) => {
    const record = state.progress.answers[question.id];
    return record && new Date(record.nextReviewAt).getTime() <= now;
  });
}

function answerQuestion(questionId, selectedIndex, mode) {
  const question = getQuestion(questionId);
  const correct = selectedIndex === question.answerIndex;
  state.progress.sessionAnswers[sessionKey(mode, questionId)] = { selectedIndex, correct };
  const record = state.progress.answers[questionId] || {
    correctCount: 0,
    wrongCount: 0,
    confidence: 0,
    bookmarked: false,
  };
  if (correct) record.correctCount += 1;
  else record.wrongCount += 1;
  record.lastAnsweredAt = new Date().toISOString();
  record.confidence = Math.max(0, Math.min(5, record.confidence + (correct ? 1 : -1)));
  record.nextReviewAt = nextReviewDate(correct, correct ? record.correctCount : record.wrongCount);
  state.progress.answers[questionId] = record;
  saveProgress();
  render();
}

function nextReviewDate(correct, count) {
  const intervals = correct ? state.config.review.intervalsCorrect : state.config.review.intervalsWrong;
  const days = intervals[Math.min(count - 1, intervals.length - 1)];
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function sessionKey(mode, questionId) {
  return `${mode}:${questionId}`;
}

function getQuestion(id) {
  return state.questions.find((question) => question.id === id);
}

function toggleBookmark(questionId) {
  const record = state.progress.answers[questionId] || { correctCount: 0, wrongCount: 0, confidence: 0, bookmarked: false };
  record.bookmarked = !record.bookmarked;
  state.progress.answers[questionId] = record;
  saveProgress();
  render();
}

function isBookmarked(questionId) {
  return Boolean(state.progress.answers[questionId]?.bookmarked);
}

function startMock() {
  const ids = state.questions.slice(0, state.config.mockExam.questionCount).map((question) => question.id);
  state.progress.mockSession = { startedAt: new Date().toISOString(), questionIds: ids, answers: {} };
  saveProgress();
  navigate("mock");
}

function finishMock() {
  const session = state.progress.mockSession;
  const wrongTags = [];
  let correct = 0;
  session.questionIds.forEach((id) => {
    const question = getQuestion(id);
    const selected = session.answers[id];
    const ok = selected === question.answerIndex;
    if (ok) correct += 1;
    else wrongTags.push(...question.tags);
    answerForMock(question, selected, ok);
  });
  state.progress.lastMockResult = {
    correct,
    total: session.questionIds.length,
    weakTags: [...new Set(wrongTags)].slice(0, 5),
    finishedAt: new Date().toISOString(),
  };
  state.progress.mockSession = null;
  saveProgress();
  navigate("result");
}

function answerForMock(question, selectedIndex, correct) {
  const record = state.progress.answers[question.id] || { correctCount: 0, wrongCount: 0, confidence: 0, bookmarked: false };
  if (correct) record.correctCount += 1;
  else record.wrongCount += 1;
  record.lastAnsweredAt = new Date().toISOString();
  record.nextReviewAt = nextReviewDate(correct, correct ? record.correctCount : record.wrongCount);
  state.progress.answers[question.id] = record;
}

function tagStats() {
  const map = new Map();
  Object.entries(state.progress.answers).forEach(([id, record]) => {
    const question = getQuestion(id);
    if (!question) return;
    question.tags.forEach((tag) => {
      const item = map.get(tag) || { tag, correct: 0, total: 0, wrong: 0 };
      item.correct += record.correctCount;
      item.wrong += record.wrongCount;
      item.total += record.correctCount + record.wrongCount;
      map.set(tag, item);
    });
  });
  return [...map.values()]
    .map((item) => ({ ...item, rate: item.total ? Math.round(item.correct / item.total * 100) : 0 }))
    .sort((a, b) => a.rate - b.rate || b.wrong - a.wrong);
}

function copyAiPrompt(questionId) {
  const question = getQuestion(questionId);
  const text = [
    "以下の秘書検定2級の問題について、なぜこの答えになるのか説明してください。",
    "",
    `問題ID: ${question.id}`,
    `問題: ${question.question}`,
    `選択肢: ${question.choices.map((choice, index) => `${index + 1}. ${choice}`).join(" / ")}`,
    `正解: ${question.choices[question.answerIndex]}`,
    `公式解説: ${question.explanation}`,
    `苦手タグ: ${question.tags.join(", ")}`,
    "",
    "説明は韓国語で、必要な日本語表現も補足してください。"
  ].join("\n");
  navigator.clipboard?.writeText(text);
  toast("AI質問用テキストをコピーしました");
}

function translateText(text) {
  const dictionary = {
    "秘書": "비서",
    "上司": "상사",
    "電話応対": "전화 응대",
    "来客応対": "방문객 응대",
    "敬語": "경어",
    "正解": "정답",
    "不正解": "오답",
    "試験ポイント": "시험 포인트",
    "覚えること": "외울 것",
    "よくある誤り": "자주 하는 실수",
  };
  let output = text;
  Object.entries(dictionary).forEach(([ja, ko]) => {
    output = output.replaceAll(ja, `${ja}(${ko})`);
  });
  return output;
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 1800);
}

function loadProgress() {
  try {
    return { ...defaultProgress(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
  } catch {
    return defaultProgress();
  }
}

function defaultProgress() {
  return {
    selectedExam: "hisho2",
    targetLanguage: "ko",
    completedLessons: [],
    answers: {},
    sessionAnswers: {},
    mockSession: null,
    lastMockResult: null,
    darkMode: false,
  };
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

if (state.progress.darkMode) {
  document.body.classList.add("dark");
}
