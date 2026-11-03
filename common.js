/* 진행자 화면과 참가자 화면이 함께 쓰는 기능 */
(function () {
  const params = new URLSearchParams(location.search);

  function getConfig() {
    // 개발용: ?emu=1 이면 로컬 에뮬레이터에 연결
    if (params.get("emu")) {
      return { apiKey: "demo", projectId: "demo-quiz", databaseURL: "http://127.0.0.1:9000?ns=demo-quiz" };
    }
    return window.FIREBASE_CONFIG;
  }

  let db = null;
  let offset = 0;

  function initDb() {
    const cfg = getConfig();
    if (!cfg || !cfg.databaseURL || !window.firebase) return null;
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    db = firebase.database();
    db.ref(".info/serverTimeOffset").on("value", (s) => { offset = s.val() || 0; });
    return db;
  }

  const now = () => Date.now() + offset;

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s·・.,!?~\-_()\[\]「」『』'"“”‘’]/g, "");
  }

  function isCorrect(q, v) {
    if (v === undefined || v === null || v === "") return false;
    switch (q.type) {
      case "choice": return Number(v) === q.answer;
      case "ox": return String(v).toUpperCase() === q.answer;
      case "order": return String(v) === q.items.map((_, i) => i).join(",");
      default: return q.answers.some((a) => normalize(a) === normalize(v));
    }
  }

  function answerLabel(q) {
    switch (q.type) {
      case "choice": return `${"①②③④"[q.answer]} ${q.options[q.answer]}`;
      case "ox": return q.answer;
      case "order": return q.items.join(" → ");
      default: return q.display || q.answers[0];
    }
  }

  // 정답이면 500~1000점: 빨리 낼수록 높음
  function points(q, at, startAt) {
    const dur = q.time * 1000;
    const r = Math.min(Math.max((at - startAt) / dur, 0), 1);
    return Math.round(1000 * (1 - r / 2));
  }

  function rank(players) {
    return Object.entries(players || {})
      .map(([id, p]) => ({ id, ...p, score: p.score || 0 }))
      .sort((a, b) => b.score - a.score || (a.joinedAt || 0) - (b.joinedAt || 0));
  }

  const TYPE_LABEL = { choice: "선택형", ox: "OX", short: "단답형", chosung: "초성퀴즈", order: "순서완성" };

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null) n.append(k.nodeType ? k : document.createTextNode(k));
    return n;
  }

  function show(id) {
    document.querySelectorAll("[data-screen]").forEach((s) => { s.hidden = s.id !== id; });
  }

  window.QZ = { params, initDb, now, normalize, isCorrect, answerLabel, points, rank, TYPE_LABEL, el, show, get db() { return db; } };
})();
