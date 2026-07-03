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
    mockExamFiles: ["mock-001.json", "mock-002.json"],
  },
];

const STORAGE_KEY = "ai-study-engine:v1";
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const REFRESH_ENTRY = [...PAGE_PARAMS.entries()].find(([key]) => key.trim() === "refresh");
const REFRESH_TOKEN = REFRESH_ENTRY?.[1]
  || sessionStorage.getItem("ai-study-engine:refresh-token")
  || "";
const app = document.querySelector("#app");

let state = {
  pack: null,
  config: null,
  chapters: [],
  lessons: [],
  questions: [],
  mockExams: [],
  resources: [],
  progress: loadProgress(),
  route: parseRoute(),
  translated: false,
};
let mockTimer = null;

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
  const mockExams = await Promise.all(pack.mockExamFiles.map((file) => getJson(`${pack.path}/mock-exams/${file}`)));
  state.config = config;
  state.chapters = chapters;
  state.lessons = lessons;
  state.questions = questionGroups.flat();
  state.mockExams = mockExams;
  state.resources = resources;
  if (state.progress.mockSession && state.progress.mockSession.questionIds.length !== config.mockExam.questionCount) {
    state.progress.mockSession = null;
    saveProgress();
  }
}

async function getJson(path) {
  const response = await fetch(cacheBustedPath(path), { cache: REFRESH_TOKEN ? "reload" : "default" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

async function getText(path) {
  const response = await fetch(cacheBustedPath(path), { cache: REFRESH_TOKEN ? "reload" : "default" });
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

function cacheBustedPath(path) {
  if (!REFRESH_TOKEN) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}v=${encodeURIComponent(REFRESH_TOKEN)}`;
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
  syncMockTimer();
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
  const session = state.progress.reviewSession;
  if (!session) {
    const candidates = reviewCandidates();
    if (!candidates.length) {
      return emptyState("復習問題はありません", "まずはレッスンの確認問題を解くと、復習カードを作れます。", "lessons", "レッスンへ");
    }
    return `
      <section class="panel">
        <h2>復習カード</h2>
        <p>復習対象からランダムに5問だけ出題します。1問ずつ解いて、すぐに正解と解説を確認できます。</p>
        <div class="metrics">
          ${metric("出題数", Math.min(5, candidates.length))}
          ${metric("復習候補", candidates.length)}
          ${metric("所要時間", "5分")}
        </div>
        <button class="primary" data-action="start-review">復習を始める</button>
      </section>
    `;
  }

  const questions = session.questionIds.map((id) => getQuestion(id)).filter(Boolean);
  const mode = reviewMode();
  const index = Math.min(session.index, questions.length);
  if (index >= questions.length) {
    const answered = questions.map((question) => state.progress.sessionAnswers[sessionKey(mode, question.id)]).filter(Boolean);
    const correct = answered.filter((item) => item.correct).length;
    return `
      <section class="panel quiz-summary">
        <div class="section-title">
          <h2>復習完了</h2>
          <span>${correct}/${questions.length}</span>
        </div>
        ${questions.map((question) => {
          const saved = state.progress.sessionAnswers[sessionKey(mode, question.id)];
          return `
            <div class="review-row ${saved?.correct ? "" : "wrong"}">
              <strong>${saved?.correct ? "正解" : "不正解"}</strong>
              <span>${question.tags.join(" · ")}</span>
              <p>${question.question}</p>
            </div>
          `;
        }).join("")}
        <div class="actions">
          <button class="primary" data-action="start-review">もう一度5問</button>
          <button data-action="clear-review">終了する</button>
        </div>
      </section>
    `;
  }

  const question = questions[index];
  const saved = state.progress.sessionAnswers[sessionKey(mode, question.id)];
  return `
    <section class="review-session">
      <div class="section-title">
        <h2>復習カード</h2>
        <span>${index + 1}/${questions.length}</span>
      </div>
      ${renderQuestion(question, index, mode)}
      <div class="actions">
        ${saved ? `<button class="primary" data-action="next-review">${index + 1 === questions.length ? "結果を見る" : "次の問題"}</button>` : ""}
        <button data-action="clear-review">終了する</button>
      </div>
    </section>
  `;
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
      ${renderQuizSummary(questions, options.mode)}
    </section>
  `;
}

function renderQuizSummary(questions, mode) {
  const answered = questions
    .map((question) => ({ question, saved: state.progress.sessionAnswers[sessionKey(mode, question.id)] }))
    .filter((item) => item.saved);
  if (answered.length !== questions.length) return "";
  const correct = answered.filter((item) => item.saved.correct).length;
  const wrong = answered.filter((item) => !item.saved.correct);
  return `
    <section class="panel quiz-summary">
      <div class="section-title">
        <h2>採点まとめ</h2>
        <span>${correct}/${questions.length}</span>
      </div>
      ${wrong.length ? wrong.map(({ question }) => `
        <div class="review-row wrong">
          <strong>${question.id}</strong>
          <span>${question.tags.join(" · ")}</span>
          <p>${question.question}</p>
        </div>
      `).join("") : "<p>全問正解です。</p>"}
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
          const answerAttrs = isAnswered ? "disabled" : `data-answer="${question.id}" data-choice="${choiceIndex}" data-mode="${mode}"`;
          return `<button class="${cls}" ${answerAttrs}>${state.translated ? translateText(choice) : choice}</button>`;
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
  const mockQuestionCount = state.config.mockExam.questionCount;
  const mockBankCount = mockQuestionBank().length;
  if (!started) {
    return `
      <section class="panel">
        <h2>模擬試験</h2>
        <p>選択式31問 + 記述式2問 / ${state.config.mockExam.timeLimitMinutes}分。問題銀行${mockBankCount}問から比率に合わせてランダム出題します。</p>
        <button class="primary" data-action="start-mock">開始する</button>
      </section>
    `;
  }
  const ids = state.progress.mockSession.questionIds;
  const questions = ids.map((id) => getQuestion(id)).filter(Boolean);
  const answered = questions.filter((question) => isMockAnswered(question)).length;
  const remaining = mockRemainingMs();
  return `
    <section class="section-title">
      <h2>模擬試験</h2>
      <span>${formatDuration(remaining)} · ${answered}/${questions.length}</span>
    </section>
    <section class="quiz">
      ${questions.map((question, index) => renderMockQuestion(question, index)).join("")}
      <button class="primary" data-action="finish-mock">採点する</button>
    </section>
  `;
}

function renderMockQuestion(question, index) {
  if (question.type === "fill_blank") return renderMockFillBlank(question, index);
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

function renderMockFillBlank(question, index) {
  const answers = state.progress.mockSession.answers[question.id] || [];
  return `
    <article class="question-card">
      <small>Q${index + 1} · 記述</small>
      <h2>${question.question}</h2>
      <div class="blank-list">
        ${question.blanks.map((blank, blankIndex) => `
          <label class="field">
            ${blank.label}
            <input value="${escapeHtml(answers[blankIndex] || "")}" data-mock-blank="${question.id}" data-blank-index="${blankIndex}" placeholder="解答を入力">
          </label>
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
        ${metric("得点", result.correct)}
        ${metric("配点", result.total)}
        ${metric("問題数", result.questionTotal || result.total)}
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
    <section class="section-title">
      <h2>答案レビュー</h2>
      <span>${result.details?.length || 0}</span>
    </section>
    <div class="card-list result-review">
      ${(result.details || []).map((detail, index) => renderMockResultDetail(detail, index)).join("") || "<p>この結果には詳細データがありません。もう一度模擬試験を実施してください。</p>"}
    </div>
  `;
}

function renderMockResultDetail(detail, index) {
  const question = getQuestion(detail.id);
  if (!question) return "";
  const ok = detail.correct === detail.total;
  return `
    <article class="card result-detail ${ok ? "correct" : "wrong"}">
      <div class="card-head">
        <small>Q${index + 1} · ${question.tags.join(" · ")}</small>
        <span class="status ${ok ? "done" : ""}">${ok ? "正解" : `${detail.correct}/${detail.total}`}</span>
      </div>
      <h2>${question.question}</h2>
      ${question.type === "fill_blank" ? renderBlankResult(question, detail.answer) : renderChoiceResult(question, detail.answer)}
      <p>${question.explanation}</p>
    </article>
  `;
}

function renderChoiceResult(question, answer) {
  const selected = answer === undefined ? "未解答" : question.choices[answer];
  return `
    <div class="answer-compare">
      <p><strong>自分の答え:</strong> ${escapeHtml(selected)}</p>
      <p><strong>正解:</strong> ${escapeHtml(question.choices[question.answerIndex])}</p>
    </div>
  `;
}

function renderBlankResult(question, answer = []) {
  return `
    <div class="answer-compare">
      ${question.blanks.map((blank, index) => {
        const mine = answer[index] || "未解答";
        const correct = blank.answers[0];
        const ok = isBlankCorrect(mine, blank.answers);
        return `<p class="${ok ? "correct-text" : "wrong-text"}"><strong>${blank.label}:</strong> ${escapeHtml(mine)} <span>正解: ${escapeHtml(correct)}</span></p>`;
      }).join("")}
    </div>
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
  app.querySelector("[data-action='start-review']")?.addEventListener("click", startReview);
  app.querySelector("[data-action='next-review']")?.addEventListener("click", nextReview);
  app.querySelector("[data-action='clear-review']")?.addEventListener("click", clearReview);
  app.querySelectorAll("[data-mock-answer]").forEach((button) => button.addEventListener("click", () => {
    state.progress.mockSession.answers[button.dataset.mockAnswer] = Number(button.dataset.choice);
    saveProgress();
    render();
  }));
  app.querySelectorAll("[data-mock-blank]").forEach((input) => input.addEventListener("input", () => {
    const id = input.dataset.mockBlank;
    const index = Number(input.dataset.blankIndex);
    const answers = state.progress.mockSession.answers[id] || [];
    answers[index] = input.value;
    state.progress.mockSession.answers[id] = answers;
    saveProgress();
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

function reviewCandidates() {
  const due = dueQuestions();
  if (due.length) return due;
  const answeredIds = new Set(Object.keys(state.progress.answers));
  const answered = state.questions.filter((question) => answeredIds.has(question.id));
  if (answered.length) return answered;
  return state.questions;
}

function startReview() {
  const questions = shuffle(reviewCandidates()).slice(0, 5);
  const sessionId = cryptoRandomId();
  state.progress.reviewSession = {
    id: sessionId,
    startedAt: new Date().toISOString(),
    index: 0,
    questionIds: questions.map((question) => question.id),
  };
  questions.forEach((question) => {
    delete state.progress.sessionAnswers[sessionKey(`review:${sessionId}`, question.id)];
  });
  saveProgress();
  render();
}

function nextReview() {
  if (!state.progress.reviewSession) return;
  state.progress.reviewSession.index += 1;
  saveProgress();
  render();
}

function clearReview() {
  state.progress.reviewSession = null;
  saveProgress();
  render();
}

function reviewMode() {
  return `review:${state.progress.reviewSession.id}`;
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
  return allQuestions().find((question) => question.id === id);
}

function allQuestions() {
  return [...state.questions, ...state.mockExams.flatMap((exam) => exam.questions || [])];
}

function mockQuestionBank() {
  return state.mockExams.flatMap((exam) => exam.questions || []);
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
  const mockExam = state.mockExams[0];
  const questions = selectMockQuestions(mockQuestionBank().length ? mockQuestionBank() : state.questions);
  const ids = questions.map((question) => question.id);
  const now = new Date();
  const endsAt = new Date(now.getTime() + state.config.mockExam.timeLimitMinutes * 60 * 1000);
  state.progress.mockSession = {
    startedAt: now.toISOString(),
    endsAt: endsAt.toISOString(),
    examId: mockExam?.id || "generated",
    title: mockExam?.title || "模擬試験",
    seed: cryptoRandomId(),
    questionIds: ids,
    answers: {},
  };
  saveProgress();
  if (state.route.name === "mock") render();
  else navigate("mock");
}

function selectMockQuestions(pool) {
  const multipleChoiceCount = state.config.mockExam.multipleChoiceCount || state.config.mockExam.questionCount;
  const writtenCount = state.config.mockExam.writtenCount || 0;
  const selection = state.config.mockExam.selection;
  const multipleChoicePool = pool.filter((question) => question.type !== "fill_blank");
  const writtenPool = pool.filter((question) => question.type === "fill_blank");
  const written = shuffle(writtenPool).slice(0, writtenCount);
  if (!selection || selection.mode !== "random_by_group") {
    return [...shuffle(multipleChoicePool).slice(0, multipleChoiceCount), ...written];
  }

  const usedIds = new Set();
  const selected = [];
  const groups = selection.groups || [];
  const quotas = buildQuotas(groups, multipleChoiceCount);

  groups.forEach((group) => {
    const chapterIds = new Set(group.chapterIds || []);
    const candidates = shuffle(multipleChoicePool.filter((question) => chapterIds.has(question.chapterId)));
    candidates.slice(0, quotas[group.id] || 0).forEach((question) => {
      usedIds.add(question.id);
      selected.push(question);
    });
  });

  if (selected.length < multipleChoiceCount) {
    shuffle(multipleChoicePool.filter((question) => !usedIds.has(question.id))).slice(0, multipleChoiceCount - selected.length).forEach((question) => selected.push(question));
  }

  return [...shuffle(selected).slice(0, multipleChoiceCount), ...written];
}

function buildQuotas(groups, total) {
  const quotas = {};
  let used = 0;
  groups.forEach((group, index) => {
    const quota = index === groups.length - 1 ? total - used : Math.round(total * group.ratio);
    quotas[group.id] = quota;
    used += quota;
  });
  return quotas;
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function random() {
  if (!window.crypto?.getRandomValues) return Math.random();
  const array = new Uint32Array(1);
  window.crypto.getRandomValues(array);
  return array[0] / 2 ** 32;
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.floor(random() * 1_000_000)}`;
}

function finishMock() {
  const session = state.progress.mockSession;
  const wrongTags = [];
  const details = [];
  let correctPoints = 0;
  let totalPoints = 0;
  session.questionIds.forEach((id) => {
    const question = getQuestion(id);
    const answer = session.answers[id];
    const score = scoreMockQuestion(question, answer);
    correctPoints += score.correct;
    totalPoints += score.total;
    const ok = score.correct === score.total;
    if (!ok) wrongTags.push(...question.tags);
    details.push({ id, answer, correct: score.correct, total: score.total });
    answerForMock(question, answer, ok);
  });
  state.progress.lastMockResult = {
    correct: correctPoints,
    total: totalPoints,
    questionTotal: session.questionIds.length,
    details,
    weakTags: [...new Set(wrongTags)].slice(0, 5),
    finishedAt: new Date().toISOString(),
  };
  state.progress.mockSession = null;
  saveProgress();
  navigate("result");
}

function scoreMockQuestion(question, answer) {
  if (question.type !== "fill_blank") {
    return { correct: answer === question.answerIndex ? 1 : 0, total: 1 };
  }
  return {
    correct: question.blanks.filter((blank, index) => isBlankCorrect(answer?.[index], blank.answers)).length,
    total: question.blanks.length,
  };
}

function isBlankCorrect(value, answers) {
  const normalized = normalizeAnswer(value);
  return answers.some((answer) => normalizeAnswer(answer) === normalized);
}

function normalizeAnswer(value = "") {
  return String(value).trim().replace(/\s+/g, "").toLowerCase();
}

function isMockAnswered(question) {
  const answer = state.progress.mockSession.answers[question.id];
  if (question.type !== "fill_blank") return answer !== undefined;
  return question.blanks.every((_, index) => String(answer?.[index] || "").trim());
}

function mockRemainingMs() {
  const endsAt = new Date(state.progress.mockSession.endsAt).getTime();
  return Math.max(0, endsAt - Date.now());
}

function formatDuration(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function syncMockTimer() {
  if (mockTimer) {
    clearInterval(mockTimer);
    mockTimer = null;
  }
  if (state.route.name !== "mock" || !state.progress.mockSession) return;
  mockTimer = setInterval(() => {
    if (!state.progress.mockSession) return;
    if (mockRemainingMs() <= 0) {
      clearInterval(mockTimer);
      mockTimer = null;
      finishMock();
      return;
    }
    const timerNode = app.querySelector(".section-title span");
    if (timerNode) {
      const ids = state.progress.mockSession.questionIds;
      const questions = ids.map((id) => getQuestion(id)).filter(Boolean);
      const answered = questions.filter((question) => isMockAnswered(question)).length;
      timerNode.textContent = `${formatDuration(mockRemainingMs())} · ${answered}/${questions.length}`;
    }
  }, 1000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    reviewSession: null,
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
