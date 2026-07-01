const cards = window.NOY_GAME_CARDS || [];
const STORAGE_KEY = "noy-memory-reveal-v3";
const answerLetters = ["א", "ב", "ג"];
const rightAnswerKeys = ["answer a", "answer b", "answer c"];
const OPENING_GUEST_SEQUENCE = ["נוי", "אורטל", "איתי"];

const gallery = document.getElementById("gallery");
const galleryShell = document.querySelector(".gallery-shell");
const stageOverlay = document.getElementById("stageOverlay");
const progressText = document.getElementById("progressText");
const progressFill = document.getElementById("progressFill");
const nextBtn = document.getElementById("nextBtn");
const answerBtn = document.getElementById("answerBtn");
const drawingBtn = document.getElementById("drawingBtn");
const finaleBtn = document.getElementById("finaleBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const resetBtn = document.getElementById("resetBtn");
const operatorBar = document.querySelector(".operator-bar");
const app = document.getElementById("app");
const confettiCanvas = document.getElementById("confetti");
const confettiContext = confettiCanvas.getContext("2d");

let revealed = new Set(loadRevealed());
let selectedIndex = null;
let highlightedIndex = null;
let stage = "idle";
let pickedAnswerIndex = null;
let answerIsVisible = false;
let isCheckingAnswer = false;
let isRevealAnimating = false;
let justRevealedId = null;
let controlsExpanded = false;
let spotlitId = null;
let flyingRevealId = null;
let selectionSkipRequested = false;
let revealHoldResolver = null;
let confettiParticles = [];
let animationFrame = null;
const answerOrderByCard = new Map();

function loadRevealed() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return saved.filter((id) => Number.isInteger(id));
  } catch {
    return [];
  }
}

function saveRevealed() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...revealed]));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitForRevealHold(ms) {
  return new Promise((resolve) => {
    let timer = null;
    let settled = false;

    const done = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (revealHoldResolver === done) revealHoldResolver = null;
      resolve();
    };

    timer = window.setTimeout(done, ms);
    revealHoldResolver = done;
  });
}

function skipRevealHold() {
  if (revealHoldResolver) revealHoldResolver();
}

function hasQuestion(card) {
  return Boolean(String(card?.question || "").trim());
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function applyQuestionOverrides(csvText) {
  const rows = parseCsvRows(csvText);
  const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) || [];
  const questionsByGuest = new Map();

  rows.forEach((row) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] || ""]));
    const guest = record.guest?.trim();
    if (!guest) return;
    questionsByGuest.set(guest, record);
  });

  cards.forEach((card) => {
    const record = questionsByGuest.get(card.guest);
    if (!record) return;
    if (Object.hasOwn(record, "question")) {
      card.question = record.question.trim();
    }
    card.answers = [
      Object.hasOwn(record, "answer a") ? record["answer a"].trim() : card.answers[0] || "",
      Object.hasOwn(record, "answer b") ? record["answer b"].trim() : card.answers[1] || "",
      Object.hasOwn(record, "answer c") ? record["answer c"].trim() : card.answers[2] || "",
    ];
    card.rightAnswer = "answer a";
    answerOrderByCard.delete(card.id);
  });
}

async function loadQuestionOverrides() {
  if (window.location.protocol === "file:") return;
  try {
    const response = await fetch(`questions.csv?updated=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    applyQuestionOverrides(await response.text());
  } catch (error) {
    console.warn("Could not load questions.csv; using bundled data.js questions.", error);
  }
}

function correctIndex(card) {
  return displayAnswersForCard(card).findIndex((answer) => answer.sourceIndex === sourceCorrectIndex(card));
}

function sourceCorrectIndex(card) {
  const index = rightAnswerKeys.indexOf(card.rightAnswer);
  return index >= 0 ? index : 0;
}

function seededShuffle(values, seed) {
  const result = [...values];
  let value = seed || 1;
  for (let i = result.length - 1; i > 0; i -= 1) {
    value = (value * 9301 + 49297) % 233280;
    const j = value % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function displayAnswersForCard(card) {
  if (answerOrderByCard.has(card.id)) {
    return answerOrderByCard.get(card.id).map((sourceIndex) => ({
      sourceIndex,
      text: card.answers[sourceIndex] || "",
    }));
  }

  const correctSourceIndex = sourceCorrectIndex(card);
  const availableIndexes = card.answers.map((_, index) => index);
  const targetCorrectIndex = card.answers.length ? card.id % card.answers.length : 0;
  const otherIndexes = seededShuffle(
    availableIndexes.filter((index) => index !== correctSourceIndex),
    card.id * 37,
  );
  const order = [];
  let otherCursor = 0;
  for (let index = 0; index < availableIndexes.length; index += 1) {
    order.push(index === targetCorrectIndex ? correctSourceIndex : otherIndexes[otherCursor++]);
  }
  answerOrderByCard.set(card.id, order);
  return order.map((sourceIndex) => ({
    sourceIndex,
    text: card.answers[sourceIndex] || "",
  }));
}

function setStage(nextStage) {
  stage = nextStage;
  app.classList.toggle("finale", stage === "finale");
}

function render() {
  renderGallery();
  renderPanel();
  renderProgress();
  renderButtons();
}

function renderGallery() {
  gallery.replaceChildren(
    ...cards.map((card, index) => {
      const isRevealed = revealed.has(card.id);
      const isSelected = index === selectedIndex;
      const isHighlighted = index === highlightedIndex;
      const orientation = card.orientation === "portrait" ? "portrait" : "landscape";
      const artAspect = card.width && card.height ? card.width / card.height : orientation === "portrait" ? 0.72 : 1.36;
      const button = document.createElement("button");
      button.className = [
        "memory-card",
        `is-${orientation}`,
        isRevealed ? "is-revealed" : "",
        isSelected ? "is-selected" : "",
        isHighlighted ? "is-selecting" : "",
        spotlitId === card.id ? "is-spotlit" : "",
        flyingRevealId === card.id ? "is-flying-source" : "",
        selectedIndex !== null && !isSelected ? "is-dimmed" : "",
        justRevealedId === card.id ? "just-revealed" : "",
      ]
        .filter(Boolean)
        .join(" ");
      button.type = "button";
      button.dataset.cardId = String(card.id);
      button.style.setProperty("--art-aspect", String(artAspect));
      button.setAttribute("aria-label", isRevealed ? `הציור של ${card.guest}` : `כרטיס מוסתר ${card.id}`);
      button.innerHTML = `
        <span class="card-inner">
          <span class="card-face card-back"><span class="brand-mark" dir="rtl"><bdi>${escapeHtml(card.guest)}</bdi></span></span>
          <span class="card-face card-front">
            <img src="${escapeHtml(card.art)}" alt="הציור של ${escapeHtml(card.guest)}" loading="eager" />
            <span class="guest-ribbon">${escapeHtml(card.guest)}</span>
          </span>
        </span>
      `;
      if (!isRevealed) {
        button.addEventListener("click", () => selectCardByIndex(index));
      }
      return button;
    }),
  );
}

function renderProgress() {
  const done = revealed.size;
  const total = cards.length;
  progressText.textContent = `${done} / ${total} נחשפו`;
  progressFill.style.width = `${total ? (done / total) * 100 : 0}%`;
}

function renderPanel() {
  if (!cards.length) {
    setOverlay(`
      <p class="panel-kicker">אין כרטיסים</p>
      <h2 class="panel-title">לא נמצאו ציורים</h2>
      <p class="panel-copy">ודאו שקובצי הציורים נמצאים בתיקיית המשחק.</p>
    `);
    return;
  }

  if (stage === "finale") {
    setOverlay("", false);
    return;
  }

  if (stage === "selecting") {
    setOverlay("", false);
    return;
  }

  const card = selectedIndex === null ? null : cards[selectedIndex];
  if (!card) {
    setOverlay("", false);
    return;
  }

  if (!hasQuestion(card)) {
    setOverlay("", false);
    return;
  }

  if (stage === "revealed") {
    setOverlay(`
      <p class="panel-kicker">${escapeHtml(card.guest)} פתח/ה מקור של נוי</p>
      <h2 class="panel-title">הציור נחשף</h2>
      <p class="panel-copy">פותחים את החולצה וממשיכים לכרטיס הבא.</p>
    `);
    return;
  }

  const shouldStageQuestion = !answerIsVisible && pickedAnswerIndex === null;
  const displayAnswers = displayAnswersForCard(card);
  setOverlay(`
    <h2 class="panel-title ${shouldStageQuestion ? "question-sequence intro-name" : ""}">${escapeHtml(card.guest)}</h2>
    <p class="question ${shouldStageQuestion ? "question-sequence intro-question" : ""}">${escapeHtml(card.question)}</p>
    <div class="answers ${shouldStageQuestion ? "question-sequence intro-answers" : ""}">
      ${displayAnswers
        .map((answer, index) => {
          const classes = ["answer-choice"];
          const right = correctIndex(card);
          if (pickedAnswerIndex === index) classes.push("is-picked");
          if (answerIsVisible && right === index) classes.push("is-correct");
          if (answerIsVisible && pickedAnswerIndex === index && pickedAnswerIndex !== right) classes.push("is-wrong");
          return `
            <button class="${classes.join(" ")}" type="button" data-answer="${index}" style="--choice-delay: ${index * 120}ms">
              <span class="answer-letter">${answerLetters[index]}</span>
              <span class="answer-text">${escapeHtml(answer.text)}</span>
            </button>
          `;
        })
        .join("")}
    </div>
    ${answerIsVisible ? renderAnswerResult(card) : ""}
  `);

  stageOverlay.querySelectorAll("[data-answer]").forEach((button) => {
    button.addEventListener("click", () => {
      pickedAnswerIndex = Number(button.dataset.answer);
      if (pickedAnswerIndex === correctIndex(card)) {
        answerIsVisible = true;
        burstConfetti(28, ["#58d68d", "#f7c948", "#40d3e8"]);
      }
      render();
    });
  });
}

function setOverlay(html, visible = true) {
  stageOverlay.innerHTML = html;
  stageOverlay.classList.toggle("is-visible", visible);
}

function renderAnswerResult(card) {
  const right = correctIndex(card);
  const rightLetter = right >= 0 ? answerLetters[right] : "";
  const rightText = right >= 0 ? displayAnswersForCard(card)[right]?.text : "עוד לא הוגדרה תשובה";
  return `
    <div class="answer-result">
      <span>התשובה הנכונה: ${rightLetter} — ${escapeHtml(rightText)}</span>
    </div>
  `;
}

function renderButtons() {
  const hasHidden = cards.some((card) => !revealed.has(card.id));
  nextBtn.disabled = stage === "selecting" || isRevealAnimating || !cards.length;
  answerBtn.disabled = selectedIndex === null || stage === "selecting" || stage === "revealed" || answerIsVisible || isCheckingAnswer;
  drawingBtn.disabled = selectedIndex === null || stage === "selecting" || isRevealAnimating || !answerIsVisible || revealed.has(cards[selectedIndex]?.id);
  finaleBtn.disabled = stage === "selecting" || isRevealAnimating;
  operatorBar.classList.toggle("is-expanded", controlsExpanded);
}

function selectCardByIndex(index) {
  if (stage === "selecting" || isCheckingAnswer || isRevealAnimating || revealed.has(cards[index]?.id)) return;
  highlightedIndex = null;
  selectedIndex = index;
  pickedAnswerIndex = null;
  answerIsVisible = false;
  isCheckingAnswer = false;
  justRevealedId = null;
  setStage("question");
  render();
  revealQuestionlessCard(index);
}

function revealQuestionlessCard(index) {
  const card = cards[index];
  if (!card || hasQuestion(card)) return;
  answerIsVisible = true;
  window.setTimeout(() => {
    if (selectedIndex === index && !revealed.has(card.id) && !isRevealAnimating) {
      revealDrawing();
    }
  }, 120);
}

function randomHiddenIndex() {
  for (const guest of OPENING_GUEST_SEQUENCE) {
    const fixedIndex = cards.findIndex((card) => card.guest === guest && !revealed.has(card.id));
    if (fixedIndex >= 0) return fixedIndex;
  }

  const hidden = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !revealed.has(card.id));
  if (!hidden.length) return null;
  return hidden[Math.floor(Math.random() * hidden.length)].index;
}

async function revealNextCard() {
  if (cards.length && revealed.size >= cards.length) {
    revealed = new Set();
    saveRevealed();
    setStage("idle");
  }

  const finalIndex = randomHiddenIndex();
  if (finalIndex === null) {
    render();
    return;
  }

  setStage("selecting");
  selectionSkipRequested = false;
  selectedIndex = null;
  pickedAnswerIndex = null;
  answerIsVisible = false;
  isCheckingAnswer = false;
  justRevealedId = null;
  render();

  const hiddenIndexes = cards
    .map((card, index) => (!revealed.has(card.id) ? index : null))
    .filter((index) => index !== null);
  const revealNumber = revealed.size + 1;
  const speedFactor = revealNumber <= 3 ? 1 : Math.max(0.35, 0.95 ** (revealNumber - 3));

  for (let step = 0; step < 68; step += 1) {
    if (selectionSkipRequested) break;
    const delay = (35 + Math.pow(step / 67, 2.8) * 210) * speedFactor;
    highlightedIndex = step > 59 ? finalIndex : hiddenIndexes[Math.floor(Math.random() * hiddenIndexes.length)];
    render();
    await sleep(delay);
  }

  selectionSkipRequested = false;
  highlightedIndex = null;
  selectedIndex = finalIndex;
  setStage("question");
  render();
  revealQuestionlessCard(finalIndex);
}

async function showCorrectAnswer() {
  if (selectedIndex === null || answerIsVisible || isCheckingAnswer) return;
  const right = correctIndex(cards[selectedIndex]);
  if (pickedAnswerIndex === null) pickedAnswerIndex = right >= 0 ? right : 0;

  isCheckingAnswer = true;
  stageOverlay.insertAdjacentHTML("beforeend", `<p class="panel-copy" id="checkingLine">בודקים עם נוי...</p>`);
  renderButtons();
  await sleep(900);
  answerIsVisible = true;
  isCheckingAnswer = false;
  render();
  burstConfetti(45, ["#58d68d", "#f7c948", "#40d3e8"]);
}

async function revealDrawing() {
  if (selectedIndex === null) return;
  const card = cards[selectedIndex];
  if (revealed.has(card.id) || isRevealAnimating) return;

  const sourceCard = gallery.querySelector(`[data-card-id="${card.id}"]`);
  if (!sourceCard) return;

  isRevealAnimating = true;
  flyingRevealId = card.id;
  setOverlay("", false);
  const sourceRect = (sourceCard.querySelector(".card-inner") || sourceCard).getBoundingClientRect();
  renderGallery();
  renderButtons();

  await animateDrawingReveal(card, sourceRect);

  revealed.add(card.id);
  saveRevealed();
  flyingRevealId = null;
  justRevealedId = card.id;
  selectedIndex = null;
  setStage("idle");
  isRevealAnimating = false;
  render();
  burstConfetti(80, ["#f7c948", "#40d3e8", "#ff6b6b", "#ffffff"]);
  window.setTimeout(() => {
    justRevealedId = null;
    if (revealed.size === cards.length) {
      startFinale();
    } else {
      render();
    }
  }, 900);
}

async function animateDrawingReveal(card, sourceRect) {
  const orientation = card.orientation === "portrait" ? "portrait" : "landscape";
  const maxWidth = Math.min(window.innerWidth * 0.46, 660);
  const maxHeight = Math.min(window.innerHeight * 0.56, 620);
  const scale = Math.min(maxWidth / sourceRect.width, maxHeight / sourceRect.height);
  const centerWidth = sourceRect.width * scale;
  const centerHeight = sourceRect.height * scale;
  const centerX = (window.innerWidth - centerWidth) / 2;
  const centerY = (window.innerHeight - centerHeight) / 2;

  const showcase = document.createElement("div");
  showcase.className = `reveal-showcase is-${orientation}`;
  if (card.width && card.height) {
    showcase.style.setProperty("--art-aspect", String(card.width / card.height));
  }
  showcase.style.left = `${sourceRect.left}px`;
  showcase.style.top = `${sourceRect.top}px`;
  showcase.style.width = `${sourceRect.width}px`;
  showcase.style.height = `${sourceRect.height}px`;
  showcase.innerHTML = `
    <span class="reveal-card-inner">
      <span class="card-face card-back"><span class="brand-mark" dir="rtl"><bdi>${escapeHtml(card.guest)}</bdi></span></span>
      <span class="card-face card-front">
        <img src="${escapeHtml(card.art)}" alt="הציור של ${escapeHtml(card.guest)}" />
        <span class="guest-ribbon is-always-visible">${escapeHtml(card.guest)}</span>
      </span>
    </span>
  `;
  document.body.append(showcase);

  const inner = showcase.querySelector(".reveal-card-inner");
  await showcase.animate(
    [
      { left: `${sourceRect.left}px`, top: `${sourceRect.top}px`, width: `${sourceRect.width}px`, height: `${sourceRect.height}px` },
      { left: `${centerX}px`, top: `${centerY}px`, width: `${centerWidth}px`, height: `${centerHeight}px` },
    ],
    { duration: 520, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "forwards" },
  ).finished;

  await sleep(120);
  inner.classList.add("is-flipped");
  burstConfetti(55, ["#f7c948", "#40d3e8", "#ffffff"]);
  await waitForRevealHold(7000);

  await showcase.animate(
    [
      { left: `${centerX}px`, top: `${centerY}px`, width: `${centerWidth}px`, height: `${centerHeight}px` },
      { left: `${sourceRect.left}px`, top: `${sourceRect.top}px`, width: `${sourceRect.width}px`, height: `${sourceRect.height}px` },
    ],
    { duration: 680, easing: "cubic-bezier(0.65, 0, 0.35, 1)", fill: "forwards" },
  ).finished;

  showcase.remove();
}

function startFinale() {
  cards.forEach((card) => revealed.add(card.id));
  saveRevealed();
  selectedIndex = null;
  highlightedIndex = null;
  pickedAnswerIndex = null;
  answerIsVisible = false;
  isCheckingAnswer = false;
  isRevealAnimating = false;
  flyingRevealId = null;
  setStage("finale");
  render();
  burstConfetti(260, ["#f7c948", "#40d3e8", "#ff6b6b", "#ffffff", "#58d68d"]);
}

async function resetGame() {
  if (!window.confirm("לאפס את כל הכרטיסים שנחשפו?")) return;
  await loadQuestionOverrides();
  answerOrderByCard.clear();
  revealed = new Set();
  selectedIndex = null;
  highlightedIndex = null;
  pickedAnswerIndex = null;
  answerIsVisible = false;
  isCheckingAnswer = false;
  isRevealAnimating = false;
  flyingRevealId = null;
  justRevealedId = null;
  localStorage.removeItem(STORAGE_KEY);
  setStage("idle");
  render();
}

function progressWithSpace() {
  if (stage === "selecting") {
    selectionSkipRequested = true;
    return;
  }
  if (isRevealAnimating) {
    skipRevealHold();
    return;
  }
  if (isCheckingAnswer) return;

  if (stage === "idle" || selectedIndex === null || stage === "revealed") {
    if (!nextBtn.disabled) revealNextCard();
    return;
  }

  if (!answerIsVisible) {
    showCorrectAnswer();
    return;
  }

  if (!drawingBtn.disabled) {
    revealDrawing();
  }
}

function progressFromBackdropClick(event) {
  if (event.target.closest(".stage-overlay, .operator-bar, .reveal-showcase")) return;
  if (selectedIndex === null && event.target.closest(".memory-card")) return;
  progressWithSpace();
}

function toggleOperatorControls() {
  controlsExpanded = !controlsExpanded;
  renderButtons();
}

function updateSpotlight() {
  if (!cards.length || stage === "selecting" || isRevealAnimating) return;
  const visibleArt = cards.filter((card) => revealed.has(card.id));
  const pool = (visibleArt.length ? visibleArt : cards).filter((card) => card.id !== spotlitId);
  if (!pool.length) return;
  spotlitId = pool[Math.floor(Math.random() * pool.length)].id;
  renderGallery();
}

function resizeConfetti() {
  const ratio = window.devicePixelRatio || 1;
  confettiCanvas.width = Math.floor(window.innerWidth * ratio);
  confettiCanvas.height = Math.floor(window.innerHeight * ratio);
  confettiCanvas.style.width = `${window.innerWidth}px`;
  confettiCanvas.style.height = `${window.innerHeight}px`;
  confettiContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function burstConfetti(count, colors) {
  for (let i = 0; i < count; i += 1) {
    confettiParticles.push({
      x: window.innerWidth * (0.18 + Math.random() * 0.64),
      y: window.innerHeight * (0.18 + Math.random() * 0.22),
      vx: (Math.random() - 0.5) * 12,
      vy: -7 - Math.random() * 9,
      size: 5 + Math.random() * 9,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.28,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 90 + Math.random() * 70,
    });
  }
  if (!animationFrame) animateConfetti();
}

function animateConfetti() {
  confettiContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  confettiParticles = confettiParticles
    .map((particle) => ({
      ...particle,
      x: particle.x + particle.vx,
      y: particle.y + particle.vy,
      vy: particle.vy + 0.24,
      rotation: particle.rotation + particle.spin,
      life: particle.life - 1,
    }))
    .filter((particle) => particle.life > 0 && particle.y < window.innerHeight + 40);

  for (const particle of confettiParticles) {
    confettiContext.save();
    confettiContext.translate(particle.x, particle.y);
    confettiContext.rotate(particle.rotation);
    confettiContext.globalAlpha = Math.min(1, particle.life / 35);
    confettiContext.fillStyle = particle.color;
    confettiContext.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.62);
    confettiContext.restore();
  }

  if (confettiParticles.length) {
    animationFrame = window.requestAnimationFrame(animateConfetti);
  } else {
    animationFrame = null;
  }
}

nextBtn.addEventListener("click", revealNextCard);
answerBtn.addEventListener("click", showCorrectAnswer);
drawingBtn.addEventListener("click", revealDrawing);
finaleBtn.addEventListener("click", startFinale);
resetBtn.addEventListener("click", resetGame);
galleryShell.addEventListener("click", progressFromBackdropClick);
fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});

window.addEventListener("resize", resizeConfetti);
window.addEventListener("keydown", (event) => {
  if (event.key === " ") {
    event.preventDefault();
    progressWithSpace();
  }
  if (event.key.toLowerCase() === "h") {
    event.preventDefault();
    toggleOperatorControls();
  }
  if (event.key === "a" || event.key === "A") showCorrectAnswer();
  if (event.key === "r" || event.key === "R") revealDrawing();
});

async function initializeGame() {
  await loadQuestionOverrides();
  cards.forEach((card) => {
    const img = new Image();
    img.src = card.art;
  });

  resizeConfetti();
  render();
  window.setTimeout(updateSpotlight, 900);
  window.setInterval(updateSpotlight, 3600);
}

initializeGame();
