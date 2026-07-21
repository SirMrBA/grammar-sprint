(() => {
  "use strict";

  const DATA = window.GRAMMAR_DATA;
  if (!DATA) throw new Error("Grammar data failed to load.");

  const STORAGE_KEY = "grammar-sprint-progress-v1";
  const SECTION_LABELS = {
    nonfinite: "Non-finite verb forms",
    tense: "Tense & aspect",
    modals: "Modal items",
    relative: "Relative clauses",
    theory: "Theory & analysis",
    translation: "Translation"
  };
  const EXAM_SPEC = [
    { section: "nonfinite", count: 15, points: 15 },
    { section: "tense", count: 20, points: 20 },
    { section: "modals", count: 15, points: 15 },
    { section: "relative", count: 10, points: 10 },
    { section: "theory", count: 15, points: 15 },
    { section: "translation", count: 10, points: 25 }
  ];

  const allQuestions = DATA.questions.concat(DATA.translationMC);
  const questionById = new Map(allQuestions.map((item) => [item.id, item]));
  const translationById = new Map(DATA.translations.map((item) => [item.id, item]));

  let state = loadState();
  let cardDeck = [];
  let cardIndex = 0;
  let translationDeck = [];
  let translationIndex = 0;
  let practice = null;
  let exam = null;
  let examTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function freshState() {
    return {
      cards: {},
      attempts: 0,
      correct: 0,
      mistakes: {},
      translations: {},
      plan: {},
      examHistory: [],
      examDraft: null
    };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || typeof parsed !== "object") return freshState();
      return Object.assign(freshState(), parsed, {
        cards: parsed.cards || {},
        mistakes: parsed.mistakes || {},
        translations: parsed.translations || {},
        plan: parsed.plan || {},
        examHistory: parsed.examHistory || []
      });
    } catch {
      return freshState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateMetrics();
    updateExamResume();
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  function sample(items, count) {
    return shuffle(items).slice(0, Math.min(count, items.length));
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatPoints(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  function populateSelects() {
    DATA.categories.forEach((category) => {
      const cardOption = element("option", "", category.short);
      cardOption.value = category.id;
      $("#card-category").append(cardOption);

      const practiceOption = element("option", "", category.short);
      practiceOption.value = category.id;
      $("#practice-category").append(practiceOption);
    });
    const mistakes = element("option", "", "Saved mistakes");
    mistakes.value = "Mistakes";
    $("#practice-category").append(mistakes);
  }

  function showView(name) {
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === "view-" + name));
    $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === name));
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (name === "home") {
      renderStudyPlan();
      updateMetrics();
    }
    if (name === "cards") buildCardDeck();
    if (name === "translation") buildTranslationDeck();
    if (name === "exam") updateExamResume();
  }

  function updateCountdown() {
    const host = $("#exam-countdown");
    const now = Date.now();
    const start = new Date(DATA.course.examISO).getTime();
    const diff = start - now;

    if (diff > 0) {
      const totalMinutes = Math.floor(diff / 60000);
      const days = Math.floor(totalMinutes / 1440);
      const hours = Math.floor((totalMinutes % 1440) / 60);
      const minutes = totalMinutes % 60;
      const parts = [];
      if (days) parts.push(days + "d");
      if (hours || days) parts.push(hours + "h");
      parts.push(minutes + "m");
      host.textContent = parts.join(" ") + " remaining";
    } else if (diff > -2 * 60 * 60 * 1000) {
      host.textContent = "Exam in progress";
    } else {
      host.textContent = "Main exam finished";
    }
  }

  function updateMetrics() {
    const core = DATA.flashcards.filter((card) => Number(card.priority) === 1);
    const mastered = core.filter((card) => state.cards[card.id] === "good").length;
    $("#metric-mastered").textContent = mastered + " / " + core.length;
    $("#metric-accuracy").textContent = state.attempts
      ? Math.round((state.correct / state.attempts) * 100) + "%"
      : "—";
    $("#metric-mistakes").textContent = String(Object.keys(state.mistakes).length);

    if (state.examHistory.length) {
      const best = Math.max.apply(null, state.examHistory.map((entry) => Number(entry.score) || 0));
      $("#metric-mock").textContent = formatPoints(best) + " / 100";
    } else {
      $("#metric-mock").textContent = "—";
    }
  }

  function renderStudyPlan() {
    const host = $("#study-plan");
    host.innerHTML = "";

    DATA.studyPlan.forEach((item) => {
      const row = element("label", "plan-item" + (state.plan[item.id] ? " is-done" : ""));
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = Boolean(state.plan[item.id]);
      check.addEventListener("change", () => {
        state.plan[item.id] = check.checked;
        saveState();
        renderStudyPlan();
      });

      const time = element("span", "plan-time");
      const day = element("strong", "", item.day);
      const minutes = element("small", "", item.time);
      time.append(day, document.createElement("br"), minutes);

      const copy = element("div");
      copy.append(element("strong", "", item.title), element("p", "", item.detail));

      const action = element("button", "button ghost", item.action);
      action.type = "button";
      action.addEventListener("click", (event) => {
        event.preventDefault();
        runPlanAction(item);
      });

      row.append(check, time, copy, action);
      host.append(row);
    });
  }

  function runPlanAction(item) {
    if (item.action === "Diagnostic") {
      startDiagnostic();
      return;
    }
    if (item.action === "Cards") {
      $("#card-category").value = item.category || "All";
      $("#card-priority").value = "core";
      showView("cards");
      return;
    }
    if (item.action === "Drill") {
      $("#practice-category").value = item.category || "All";
      showView("practice");
      startPractice();
      return;
    }
    if (item.action === "Translation") {
      $("#translation-set").value = "all";
      showView("translation");
      return;
    }
    if (item.action === "Mock") {
      showView("exam");
      return;
    }
    if (item.action === "Mistakes") {
      $("#practice-category").value = "Mistakes";
      showView("practice");
      startPractice();
    }
  }

  function buildCardDeck(forceShuffle) {
    const category = $("#card-category").value;
    const set = $("#card-priority").value;
    let filtered = DATA.flashcards.filter((card) => category === "All" || card.category === category);

    if (set === "core") {
      filtered = filtered.filter((card) => Number(card.priority) === 1);
    } else if (set === "mistakes") {
      filtered = filtered.filter((card) => ["again", "hard"].includes(state.cards[card.id]));
    }

    if (!filtered.length) {
      filtered = DATA.flashcards.filter((card) =>
        (category === "All" || card.category === category) && Number(card.priority) === 1
      );
      $("#card-priority").value = "core";
    }

    const oldIds = cardDeck.map((card) => card.id).join("|");
    const newIds = filtered.map((card) => card.id).join("|");
    if (forceShuffle || !cardDeck.length || oldIds !== newIds) {
      cardDeck = shuffle(filtered);
      cardIndex = 0;
    }
    showCard();
  }

  function showCard() {
    const card = cardDeck[cardIndex];
    if (!card) return;

    $("#card-category-label").textContent = card.category;
    $("#card-counter").textContent = cardIndex + 1 + " / " + cardDeck.length;
    $("#card-progress").style.width = ((cardIndex + 1) / cardDeck.length * 100) + "%";
    $("#card-term").textContent = card.term;
    $("#card-back-term").textContent = card.term;
    $("#card-definition").textContent = card.definition;
    $("#card-cue").textContent = card.cue;
    $("#card-example").textContent = card.example;
    $("#card-trap").textContent = card.trap;
    $("#card-source").textContent = card.source || "Official course material";
    $("#card-front").classList.remove("is-hidden");
    $("#card-back").classList.add("is-hidden");
  }

  function rateCard(rating) {
    const card = cardDeck[cardIndex];
    if (!card) return;
    state.cards[card.id] = rating;
    saveState();
    cardIndex = (cardIndex + 1) % cardDeck.length;
    showCard();
  }

  function balancedSample(pool, count) {
    const grouped = new Map();
    DATA.categories.forEach((category) => grouped.set(category.id, []));
    pool.forEach((question) => {
      if (!grouped.has(question.category)) grouped.set(question.category, []);
      grouped.get(question.category).push(question);
    });

    const groups = Array.from(grouped.values()).filter((items) => items.length);
    const result = [];
    let cursor = 0;
    const shuffledGroups = groups.map((items) => shuffle(items));
    while (result.length < count && shuffledGroups.some((items) => items.length)) {
      const group = shuffledGroups[cursor % shuffledGroups.length];
      if (group.length) result.push(group.pop());
      cursor += 1;
    }
    return shuffle(result);
  }

  function startDiagnostic() {
    showView("practice");
    practice = {
      items: balancedSample(DATA.questions, 20),
      index: 0,
      correct: 0,
      results: []
    };
    $("#practice-start").classList.add("is-hidden");
    $("#practice-session").classList.remove("is-hidden");
    renderPracticeQuestion();
  }

  function startPractice() {
    const category = $("#practice-category").value;
    const count = Number($("#practice-count").value);
    let pool;

    if (category === "Mistakes") {
      pool = allQuestions.filter((question) => state.mistakes[question.id]);
      if (!pool.length) {
        pool = DATA.questions.slice();
        $("#practice-category").value = "All";
      }
    } else {
      pool = DATA.questions.filter((question) => category === "All" || question.category === category);
    }

    const items = category === "All"
      ? balancedSample(pool, count)
      : sample(pool, count);

    practice = { items: items, index: 0, correct: 0, results: [] };
    $("#practice-start").classList.add("is-hidden");
    $("#practice-session").classList.remove("is-hidden");
    renderPracticeQuestion();
  }

  function buildQuestionHeader(question, index, length, examMode) {
    const top = element("div", "quiz-topline");
    const left = element("div", "question-section");
    left.append(element("span", "question-type", SECTION_LABELS[question.section] || question.category));
    if (examMode) {
      left.append(element("span", "question-points", (question.points || 1) + " pt"));
    }
    top.append(left, element("span", "", "Question " + (index + 1) + " of " + length));
    return top;
  }

  function buildOptions(question, selected, onSelect, locked) {
    const options = element("div", "options");
    question.options.forEach((optionText, optionIndex) => {
      const button = element("button", "option");
      button.type = "button";
      if (selected === optionIndex) button.classList.add("is-selected");
      if (locked) {
        if (optionIndex === question.answer) button.classList.add("is-correct");
        if (selected === optionIndex && optionIndex !== question.answer) button.classList.add("is-wrong");
        button.disabled = true;
      }
      button.append(
        element("span", "option-letter", String.fromCharCode(65 + optionIndex)),
        element("span", "", optionText)
      );
      button.addEventListener("click", () => onSelect(optionIndex));
      options.append(button);
    });
    return options;
  }

  function renderPracticeQuestion() {
    const host = $("#practice-session");
    const question = practice.items[practice.index];
    host.innerHTML = "";
    if (!question) {
      renderPracticeResult();
      return;
    }

    host.append(buildQuestionHeader(question, practice.index, practice.items.length, false));
    const progress = element("div", "progress-line");
    const fill = element("span");
    fill.style.width = ((practice.index + 1) / practice.items.length * 100) + "%";
    progress.append(fill);
    host.append(progress, element("p", "question-text", question.text));

    let locked = false;
    let selected = null;
    const optionsHost = buildOptions(question, selected, selectAnswer, locked);
    host.append(optionsHost);

    function selectAnswer(optionIndex) {
      if (locked) return;
      locked = true;
      selected = optionIndex;
      const isCorrect = optionIndex === question.answer;
      if (isCorrect) practice.correct += 1;

      practice.results.push({ id: question.id, selected: optionIndex, correct: isCorrect });
      state.attempts += 1;
      if (isCorrect) {
        state.correct += 1;
        delete state.mistakes[question.id];
      } else {
        state.mistakes[question.id] = {
          type: "question",
          category: question.category,
          updatedAt: Date.now()
        };
      }
      saveState();

      optionsHost.replaceWith(buildOptions(question, selected, () => {}, true));
      const feedback = element("div", "feedback " + (isCorrect ? "correct" : "wrong"));
      feedback.append(
        element("strong", "", isCorrect ? "Correct" : "Not yet"),
        element("p", "", question.explanation),
        element("small", "", "Source: " + question.source)
      );
      host.append(feedback);

      const actions = element("div", "quiz-actions");
      const next = element("button", "button primary", practice.index + 1 === practice.items.length ? "See results" : "Next question");
      next.type = "button";
      next.addEventListener("click", () => {
        practice.index += 1;
        renderPracticeQuestion();
      });
      actions.append(next);
      host.append(actions);
    }
  }

  function renderPracticeResult() {
    const host = $("#practice-session");
    host.innerHTML = "";
    const total = practice.items.length;
    const percent = total ? Math.round(practice.correct / total * 100) : 0;

    const score = element("div", "result-score");
    score.append(
      element("span", "eyebrow", "Drill complete"),
      element("strong", "", practice.correct + " / " + total),
      element("p", "", percent + "% correct · wrong answers were saved automatically.")
    );
    host.append(score);

    const wrong = practice.results.filter((result) => !result.correct);
    if (wrong.length) {
      host.append(element("h3", "", "Review"));
      const list = element("div", "review-list");
      wrong.forEach((result) => {
        const question = questionById.get(result.id);
        const item = element("article", "review-item wrong");
        item.append(
          element("strong", "", question.text),
          element("p", "review-answer", "Correct: " + question.options[question.answer]),
          element("p", "", question.explanation)
        );
        list.append(item);
      });
      host.append(list);
    }

    const actions = element("div", "center-actions");
    const again = element("button", "button primary", "Start another drill");
    again.type = "button";
    again.addEventListener("click", startPractice);
    const mistakes = element("button", "button ghost", "Practise saved mistakes");
    mistakes.type = "button";
    mistakes.addEventListener("click", () => {
      $("#practice-category").value = "Mistakes";
      startPractice();
    });
    actions.append(again, mistakes);
    host.append(actions);
  }

  function buildTranslationDeck(forceShuffle) {
    const set = $("#translation-set").value;
    let filtered = DATA.translations.slice();

    if (set === "weak") {
      filtered = filtered.filter((item) => ["again", "hard"].includes(state.translations[item.id]));
    } else if (set === "unseen") {
      filtered = filtered.filter((item) => !state.translations[item.id]);
    }

    if (!filtered.length) {
      filtered = DATA.translations.slice();
      $("#translation-set").value = "all";
    }

    const oldIds = translationDeck.map((item) => item.id).join("|");
    const newIds = filtered.map((item) => item.id).join("|");
    if (forceShuffle || !translationDeck.length || oldIds !== newIds) {
      translationDeck = shuffle(filtered);
      translationIndex = 0;
    }
    showTranslation();
  }

  function showTranslation() {
    const item = translationDeck[translationIndex];
    if (!item) return;

    $("#translation-counter").textContent = translationIndex + 1 + " / " + translationDeck.length;
    $("#translation-progress").style.width = ((translationIndex + 1) / translationDeck.length * 100) + "%";
    $("#translation-german").textContent = item.german;
    $("#translation-answer").value = "";
    $("#translation-answer").disabled = false;
    $("#translation-before-actions").classList.remove("is-hidden");
    $("#translation-feedback").classList.add("is-hidden");
    $("#translation-model").textContent = item.answer;
    $("#translation-note").textContent = item.note || "";
    $("#translation-note").classList.toggle("is-hidden", !item.note);

    const alternatives = $("#translation-alternatives");
    alternatives.innerHTML = "";
    item.alternatives.forEach((answer) => {
      alternatives.append(element("p", "alternative-answer", "Also acceptable: " + answer));
    });

    const targets = $("#translation-targets");
    targets.innerHTML = "";
    item.targets.forEach((target) => targets.append(element("li", "", target)));
  }

  function revealTranslation() {
    $("#translation-answer").disabled = true;
    $("#translation-before-actions").classList.add("is-hidden");
    $("#translation-feedback").classList.remove("is-hidden");
    $("#translation-feedback").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function rateTranslation(rating) {
    const item = translationDeck[translationIndex];
    if (!item) return;

    state.translations[item.id] = rating;
    const mistakeId = "translation:" + item.id;
    if (rating === "good") {
      delete state.mistakes[mistakeId];
    } else {
      state.mistakes[mistakeId] = {
        type: "translation",
        category: "Translation",
        translationId: item.id,
        updatedAt: Date.now()
      };
    }
    saveState();

    translationIndex = (translationIndex + 1) % translationDeck.length;
    showTranslation();
  }

  function buildMockQuestions() {
    const items = [];
    EXAM_SPEC.forEach((spec) => {
      const pool = spec.section === "translation"
        ? DATA.translationMC
        : DATA.questions.filter((question) => question.section === spec.section);
      const chosen = sample(pool, spec.count);
      chosen.forEach((question) => {
        items.push(Object.assign({}, question, {
          points: question.points || (spec.points / spec.count)
        }));
      });
    });
    return items;
  }

  function startNewExam() {
    if (state.examDraft && !window.confirm("Replace the saved mock attempt with a new one?")) return;

    const items = buildMockQuestions();
    state.examDraft = {
      ids: items.map((item) => item.id),
      answers: {},
      index: 0,
      startedAt: Date.now(),
      durationMs: DATA.course.durationMinutes * 60 * 1000
    };
    saveState();
    resumeExam();
  }

  function resumeExam() {
    const draft = state.examDraft;
    if (!draft || !Array.isArray(draft.ids)) return;
    const items = draft.ids.map((id) => questionById.get(id)).filter(Boolean);
    if (items.length !== draft.ids.length) {
      state.examDraft = null;
      saveState();
      return;
    }

    exam = { draft: draft, items: items };
    $("#exam-start").classList.add("is-hidden");
    $("#exam-session").classList.remove("is-hidden");
    startExamTimer();
    renderExamQuestion();
  }

  function updateExamResume() {
    const button = $("#resume-exam");
    if (!button) return;
    const draft = state.examDraft;
    if (draft && Array.isArray(draft.ids)) {
      const answered = Object.keys(draft.answers || {}).length;
      button.textContent = "Resume saved mock (" + answered + " / " + draft.ids.length + " answered)";
      button.classList.remove("is-hidden");
    } else {
      button.classList.add("is-hidden");
    }
  }

  function remainingExamMs() {
    if (!exam || !exam.draft) return 0;
    return exam.draft.durationMs - (Date.now() - exam.draft.startedAt);
  }

  function formatClock(milliseconds) {
    const safe = Math.max(0, milliseconds);
    const totalSeconds = Math.ceil(safe / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function startExamTimer() {
    if (examTimer) window.clearInterval(examTimer);
    examTimer = window.setInterval(() => {
      const timer = $("#exam-timer");
      if (!timer || !exam) return;
      const remaining = remainingExamMs();
      timer.textContent = formatClock(remaining);
      timer.classList.toggle("is-low", remaining < 10 * 60 * 1000);
      if (remaining <= 0) finishExam(true);
    }, 1000);
  }

  function renderExamQuestion() {
    const host = $("#exam-session");
    const draft = exam.draft;
    const question = exam.items[draft.index];
    host.innerHTML = "";

    const top = buildQuestionHeader(question, draft.index, exam.items.length, true);
    const timer = element("span", "timer", formatClock(remainingExamMs()));
    timer.id = "exam-timer";
    top.append(timer);
    host.append(top);

    const progress = element("div", "progress-line");
    const fill = element("span");
    fill.style.width = ((draft.index + 1) / exam.items.length * 100) + "%";
    progress.append(fill);
    host.append(progress, element("p", "question-text", question.text));

    const selected = draft.answers[question.id];
    const options = buildOptions(question, selected, (optionIndex) => {
      draft.answers[question.id] = optionIndex;
      state.examDraft = draft;
      saveState();
      renderExamQuestion();
    }, false);
    host.append(options);

    const actions = element("div", "quiz-actions split");
    const back = element("button", "button ghost", "Previous");
    back.type = "button";
    back.disabled = draft.index === 0;
    back.addEventListener("click", () => {
      draft.index -= 1;
      state.examDraft = draft;
      saveState();
      renderExamQuestion();
    });

    const right = element("div", "center-actions");
    if (draft.index < exam.items.length - 1) {
      const next = element("button", "button primary", "Next");
      next.type = "button";
      next.addEventListener("click", () => {
        draft.index += 1;
        state.examDraft = draft;
        saveState();
        renderExamQuestion();
      });
      right.append(next);
    } else {
      const submit = element("button", "button primary", "Submit mock");
      submit.type = "button";
      submit.addEventListener("click", () => finishExam(false));
      right.append(submit);
    }

    actions.append(back, right);
    host.append(actions);
  }

  function finishExam(autoSubmitted) {
    if (!exam) return;
    const draft = exam.draft;
    const unanswered = exam.items.filter((item) => draft.answers[item.id] === undefined).length;
    if (!autoSubmitted && unanswered && !window.confirm("Submit with " + unanswered + " unanswered items?")) return;

    if (examTimer) {
      window.clearInterval(examTimer);
      examTimer = null;
    }

    let total = 0;
    let score = 0;
    const sectionScores = {};
    const results = [];

    EXAM_SPEC.forEach((spec) => {
      sectionScores[spec.section] = { score: 0, total: spec.points };
    });

    exam.items.forEach((question) => {
      const points = Number(question.points || 1);
      const selected = draft.answers[question.id];
      const correct = selected === question.answer;
      total += points;
      if (correct) {
        score += points;
        sectionScores[question.section].score += points;
        delete state.mistakes[question.id];
      } else {
        state.mistakes[question.id] = {
          type: "question",
          category: question.category,
          updatedAt: Date.now()
        };
      }
      results.push({ question: question, selected: selected, correct: correct, points: points });
    });

    score = Math.round(score * 10) / 10;
    state.examHistory.push({
      completedAt: Date.now(),
      score: score,
      total: total,
      percent: Math.round(score / total * 100),
      autoSubmitted: Boolean(autoSubmitted)
    });
    state.examHistory = state.examHistory.slice(-12);
    state.examDraft = null;
    saveState();

    renderExamResult({ score: score, total: total, sectionScores: sectionScores, results: results, autoSubmitted: autoSubmitted });
    exam = null;
  }

  function renderExamResult(result) {
    const host = $("#exam-session");
    host.innerHTML = "";

    const score = element("div", "result-score");
    score.append(
      element("span", "eyebrow", result.autoSubmitted ? "Time expired" : "Mock complete"),
      element("strong", "", formatPoints(result.score) + " / " + formatPoints(result.total)),
      element("p", "", Math.round(result.score / result.total * 100) + "% · Every wrong item has been saved for repair.")
    );
    host.append(score);

    const grid = element("div", "section-score-grid");
    EXAM_SPEC.forEach((spec) => {
      const data = result.sectionScores[spec.section];
      const box = element("article", "section-score");
      box.append(
        element("span", "", SECTION_LABELS[spec.section]),
        element("strong", "", formatPoints(data.score) + " / " + formatPoints(data.total))
      );
      grid.append(box);
    });
    host.append(grid);

    const wrong = result.results.filter((entry) => !entry.correct);
    if (wrong.length) {
      host.append(element("h3", "", "Wrong or unanswered"));
      const list = element("div", "review-list");
      wrong.forEach((entry) => {
        const question = entry.question;
        const selectedText = entry.selected === undefined
          ? "No answer"
          : question.options[entry.selected];
        const item = element("article", "review-item wrong");
        item.append(
          element("strong", "", question.text),
          element("p", "review-answer", "Your answer: " + selectedText),
          element("p", "review-answer", "Correct: " + question.options[question.answer]),
          element("p", "", question.explanation)
        );
        list.append(item);
      });
      host.append(list);
    }

    const actions = element("div", "center-actions");
    const restart = element("button", "button primary", "Start another mock");
    restart.type = "button";
    restart.addEventListener("click", startNewExam);
    const repair = element("button", "button ghost", "Repair saved mistakes");
    repair.type = "button";
    repair.addEventListener("click", () => {
      $("#practice-category").value = "Mistakes";
      showView("practice");
      startPractice();
    });
    actions.append(restart, repair);
    host.append(actions);
  }

  function resetProgress() {
    if (!window.confirm("Reset all card ratings, drill results, translations and mock history on this device?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = freshState();
    window.location.reload();
  }

  function registerEvents() {
    $$(".tab").forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
    $("#start-diagnostic").addEventListener("click", startDiagnostic);
    $("#start-practice").addEventListener("click", startPractice);
    $("#reset-progress").addEventListener("click", resetProgress);

    $("#card-category").addEventListener("change", () => buildCardDeck(true));
    $("#card-priority").addEventListener("change", () => buildCardDeck(true));
    $("#reveal-card").addEventListener("click", () => {
      $("#card-front").classList.add("is-hidden");
      $("#card-back").classList.remove("is-hidden");
    });
    $$("[data-rating]").forEach((button) => button.addEventListener("click", () => rateCard(button.dataset.rating)));
    $("#shuffle-cards").addEventListener("click", () => buildCardDeck(true));

    $("#translation-set").addEventListener("change", () => buildTranslationDeck(true));
    $("#reveal-translation").addEventListener("click", revealTranslation);
    $$("[data-translation-rating]").forEach((button) => {
      button.addEventListener("click", () => rateTranslation(button.dataset.translationRating));
    });
    $("#shuffle-translations").addEventListener("click", () => buildTranslationDeck(true));

    $("#start-exam").addEventListener("click", startNewExam);
    $("#resume-exam").addEventListener("click", resumeExam);
    $("#print-sheet").addEventListener("click", () => window.print());

    document.addEventListener("keydown", (event) => {
      if (!practice || !$("#view-practice").classList.contains("is-active")) return;
      const number = Number(event.key);
      if (number >= 1 && number <= 4) {
        const option = $(".option:nth-child(" + number + ")");
        if (option && !option.disabled) option.click();
      }
    });
  }

  function init() {
    populateSelects();
    registerEvents();
    renderStudyPlan();
    buildCardDeck(true);
    buildTranslationDeck(true);
    updateMetrics();
    updateExamResume();
    updateCountdown();
    window.setInterval(updateCountdown, 30000);

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  init();
})();
