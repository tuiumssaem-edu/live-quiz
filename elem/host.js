/* 진행자 화면 */
(function () {
  const { el, show } = QZ;
  const QS = QUIZ.questions;
  const $ = (id) => document.getElementById(id);

  let db, pin, roomRef, state = null, players = {};
  let ticker = null, ansRef = null, ansCount = 0, revealing = false, qrDone = false;

  function stopQuestionWatch() {
    if (ticker) { clearInterval(ticker); ticker = null; }
    if (ansRef) { ansRef.off(); ansRef = null; }
  }

  function joinUrl() {
    const u = new URL("./", location.href);
    u.search = "";
    u.hash = "";
    const p = new URLSearchParams({ pin });
    if (QZ.params.get("emu")) p.set("emu", "1");
    return u.href + "?" + p.toString();
  }

  /* ---------- 시작 ---------- */
  function boot() {
    db = QZ.initDb();
    if (!db) { show("setup"); return; }
    $("quizTitle").textContent = QUIZ.title;
    $("quizInfo").textContent = `${QS.length}문제 · 빨리 맞힐수록 높은 점수(500~1000점)`;
    show("start");
    let saved = null;
    try { saved = sessionStorage.getItem("qz-host-pin"); } catch (e) {}
    if (saved) {
      db.ref(`rooms/${saved}/state`).once("value").then((s) => {
        if (!s.exists()) return;
        const b = $("resumeBtn");
        b.hidden = false;
        b.textContent = `이어서 진행 (PIN ${saved})`;
        b.onclick = () => enterRoom(saved);
      });
    }
    $("createBtn").onclick = createRoom;
  }

  async function createRoom() {
    $("createBtn").disabled = true;
    let p;
    for (let i = 0; i < 8; i++) {
      p = String(Math.floor(100000 + Math.random() * 900000));
      const s = await db.ref(`rooms/${p}/state`).once("value");
      if (!s.exists()) break;
    }
    await db.ref(`rooms/${p}`).set({
      meta: { title: QUIZ.title, total: QS.length, createdAt: firebase.database.ServerValue.TIMESTAMP },
      state: { phase: "lobby", qi: -1 }
    });
    $("createBtn").disabled = false;
    enterRoom(p);
  }

  function enterRoom(p) {
    pin = p;
    try { sessionStorage.setItem("qz-host-pin", p); } catch (e) {}
    roomRef = db.ref(`rooms/${p}`);
    $("roomLabel").hidden = false;
    $("roomLabel").textContent = `PIN ${p}`;
    roomRef.child("players").on("value", (s) => { players = s.val() || {}; onPlayers(); });
    roomRef.child("state").on("value", (s) => { state = s.val(); render(); });
  }

  function onPlayers() {
    const n = Object.keys(players).length;
    $("pCount").textContent = n;
    $("ansTotal").textContent = n;
    const chips = $("chips");
    chips.textContent = "";
    if (!n) {
      chips.append(el("span", { class: "muted" }, "아직 아무도 없어요. QR을 찍고 닉네임을 입력하면 여기에 이름이 보여요."));
    } else {
      Object.entries(players)
        .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0))
        .forEach(([id, p]) => chips.append(
          el("span", { class: "chip" }, p.name,
            el("button", { "aria-label": `${p.name} 내보내기`, onclick: () => roomRef.child(`players/${id}`).remove() }, "×"))
        ));
    }
    if (state && state.phase === "reveal") renderTop();
  }

  /* ---------- 화면 그리기 ---------- */
  function render() {
    if (!state) { show("start"); return; }
    stopQuestionWatch();
    switch (state.phase) {
      case "lobby": return renderLobby();
      case "question": return renderQuestion();
      case "reveal": return renderReveal();
      case "explain": return renderExplain();
      case "final": return renderFinal();
    }
  }

  function renderLobby() {
    show("lobby");
    $("pinText").textContent = pin;
    const url = joinUrl();
    $("joinUrl").textContent = url;
    if (!qrDone && window.QRCode) {
      $("qr").textContent = "";
      new QRCode($("qr"), { text: url, width: 640, height: 640, colorDark: "#1F2D5A", colorLight: "#FFFFFF", correctLevel: QRCode.CorrectLevel.M });
      qrDone = true;
    }
    $("startBtn").onclick = () => startQuestion(0);
  }

  function startQuestion(qi) {
    const q = QS[qi];
    const startAt = QZ.now() + 3000;
    revealing = false;
    roomRef.child(`answers/${qi}`).remove().then(() =>
      roomRef.child("state").set({ phase: "question", qi, startAt, endAt: startAt + q.time * 1000 })
    );
  }

  function renderQuestion() {
    const qi = state.qi, q = QS[qi];
    show("question");
    $("qNo").textContent = `${qi + 1} / ${QS.length}`;
    $("qType").textContent = QZ.TYPE_LABEL[q.type];
    $("qDouble").hidden = !q.double;
    $("countDouble").hidden = !q.double;
    $("qText").textContent = q.text;
    const body = $("qBody");
    body.textContent = "";
    if (q.type === "choice") {
      body.append(el("div", { class: "opts" }, q.options.map((o, i) =>
        el("div", { class: `opt opt-${i}` }, el("span", { class: "tag-num" }, String(i + 1)), o))));
    } else if (q.type === "ox") {
      body.append(el("div", { class: "opts" },
        el("div", { class: "opt big opt-o" }, "O"), el("div", { class: "opt big opt-x" }, "X")));
    } else if (q.type === "order") {
      body.append(el("div", { class: "order-items" }, q.shuffle.map((i) => el("div", {}, q.items[i]))));
    } else {
      if (q.hint) body.append(el("div", { class: "hint" }, q.hint));
      body.append(el("p", { class: "center muted", style: "font-size:1.3rem" }, "휴대폰에 정답을 입력하세요"));
    }

    ansCount = 0;
    $("ansCount").textContent = 0;
    ansRef = roomRef.child(`answers/${qi}`);
    ansRef.on("value", (s) => { ansCount = s.numChildren(); $("ansCount").textContent = ansCount; });

    $("revealNow").onclick = () => reveal();
    const tick = () => {
      const t = QZ.now();
      const over = $("countOver");
      if (t < state.startAt) {
        over.hidden = false;
        $("countLabel").textContent = `${qi + 1}번 문제`;
        $("countNum").textContent = Math.ceil((state.startAt - t) / 1000);
        return;
      }
      over.hidden = true;
      const left = Math.max(0, state.endAt - t);
      $("timerNum").textContent = Math.ceil(left / 1000);
      $("timer").style.setProperty("--p", `${(left / (q.time * 1000)) * 100}%`);
      const n = Object.keys(players).length;
      if (left <= 0 || (n > 0 && ansCount >= n)) reveal();
    };
    tick();
    ticker = setInterval(tick, 150);
  }

  async function reveal() {
    if (revealing || !state || state.phase !== "question") return;
    revealing = true;
    stopQuestionWatch();
    $("countOver").hidden = true;
    const qi = state.qi, q = QS[qi];
    const [aSnap, pSnap] = await Promise.all([
      roomRef.child(`answers/${qi}`).once("value"),
      roomRef.child("players").once("value")
    ]);
    const answers = aSnap.val() || {}, ps = pSnap.val() || {};
    const dist = q.type === "choice" ? [0, 0, 0, 0] : q.type === "ox" ? [0, 0] : null;
    let answered = 0, correct = 0;
    const updates = {};
    for (const [pid, p] of Object.entries(ps)) {
      const a = answers[pid];
      const ok = !!a && QZ.isCorrect(q, a.v);
      const pts = ok ? QZ.points(q, a.at, state.startAt) : 0;
      if (a) {
        answered++;
        if (dist && q.type === "choice") dist[Number(a.v)] = (dist[Number(a.v)] || 0) + 1;
        if (dist && q.type === "ox") dist[a.v === "O" ? 0 : 1]++;
      }
      if (ok) correct++;
      updates[`players/${pid}/score`] = (p.score || 0) + pts;
      updates[`players/${pid}/last`] = { qi, correct: ok, points: pts, answered: !!a };
    }
    updates.state = { ...state, phase: "reveal", stats: { answered, correct, total: Object.keys(ps).length, dist: dist || null } };
    await roomRef.update(updates);
    revealing = false;
  }

  function renderTop() {
    const list = $("rTop");
    list.textContent = "";
    const r = QZ.rank(players).slice(0, 5);
    if (!r.length) list.append(el("li", {}, el("span"), el("span", { class: "muted" }, "참가자가 없어요"), el("span")));
    r.forEach((p, i) => list.append(el("li", {},
      el("span", { class: "pos" }, String(i + 1)),
      el("span", { class: "nm" }, p.name),
      el("span", { class: "sc" }, `${p.score.toLocaleString()}점`))));
  }

  function nextLabel(qi) { return qi + 1 < QS.length ? "다음 문제" : "최종 결과 보기"; }
  function goNext() {
    const qi = state.qi;
    if (qi + 1 < QS.length) startQuestion(qi + 1);
    else roomRef.child("state").set({ phase: "final", qi });
  }

  function renderReveal() {
    const qi = state.qi, q = QS[qi], st = state.stats || {};
    show("reveal");
    $("rNo").textContent = `${qi + 1} / ${QS.length}`;
    $("rAnswer").textContent = QZ.answerLabel(q);
    $("rStat").textContent = `${st.total || 0}명 중 ${st.correct || 0}명 정답 · ${st.answered || 0}명 제출`;
    const bars = $("rBars");
    bars.textContent = "";
    if (st.dist) {
      const labels = q.type === "choice" ? q.options.map((o, i) => `${i + 1}. ${o}`) : ["O", "X"];
      const okIdx = q.type === "choice" ? q.answer : (q.answer === "O" ? 0 : 1);
      const dist = labels.map((_, i) => Number((st.dist || {})[i]) || 0);
      const max = Math.max(1, ...dist);
      labels.forEach((lb, i) => {
        const cls = q.type === "choice" ? `opt-${i}` : (i === 0 ? "opt-o" : "opt-x");
        const fill = el("div", { class: "fill" });
        bars.append(el("div", { class: `bar ${cls} ${i === okIdx ? "ok" : ""}` },
          el("span", { class: "nm" }, lb), el("div", { class: "track" }, fill), el("span", {}, `${dist[i]}명`)));
        requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = `${(dist[i] / max) * 100}%`; }));
      });
    }
    renderTop();
    $("toExplain").onclick = () => roomRef.child("state/phase").set("explain");
    $("rNext").textContent = nextLabel(qi);
    $("rNext").onclick = goNext;
  }

  function renderVisual(v) {
    if (!v) return null;
    switch (v.type) {
      case "flow":
        return el("div", { class: "flow" }, v.steps.map((st, i) =>
          el("div", { class: "step" }, el("span", { class: "n" }, String(i + 1)), el("div", { class: "t" }, st.t), st.when ? el("span", { class: "fwhen" }, "⏱ " + st.when) : null, st.s ? el("div", { class: "s" }, st.s) : null)));
      case "process":
        return el("ol", { class: "proc", style: `--n:${v.steps.length}` }, v.steps.map((st, i) =>
          el("li", { class: `pstep p${i % 4}` },
            el("div", { class: "pnode" }, el("span", {}, String(i + 1))),
            el("div", { class: "pcard" },
              el("div", { class: "pt" }, st.t),
              el("div", { class: "pchips" },
                el("span", { class: "pwho" }, st.who),
                st.when ? el("span", { class: "pwhen" }, "⏱ " + st.when) : null),
              st.to ? el("div", { class: "pnote" }, "→ " + st.to) : null,
              st.note ? el("div", { class: "pnote" }, st.note) : null))));
      case "compare":
        return el("table", { class: "tbl cmp" },
          el("thead", {}, el("tr", {}, el("th", {}, ""), v.cols.map((c) => el("th", {}, c)))),
          el("tbody", {}, v.rows.map((r) => el("tr", {}, el("th", {}, r[0]), r.slice(1).map((c) => el("td", {}, c))))));
      case "table":
        return el("table", { class: "tbl" },
          el("thead", {}, el("tr", {}, v.head.map((h) => el("th", {}, h)))),
          el("tbody", {}, v.rows.map((r, i) => el("tr", { class: i === v.hi ? "hi" : "" },
            el("th", {}, r[0]), r.slice(1).map((c) => el("td", {}, el("span", { class: "num" }, c)))))));
      case "timeline":
        return el("div", { class: "tline" }, v.segs.map((g) =>
          el("div", { class: `seg ${g.tone}`, style: `flex:${g.flex}` },
            el("div", { class: "lb" }, g.label), el("span", { class: "tg" }, g.tag), g.sub ? el("div", { class: "sb" }, g.sub) : null)));
      case "checklist":
        return el("div", {}, v.lead ? el("p", { class: "lead" }, v.lead) : null,
          el("ul", { class: "check" }, v.items.map((it) =>
            el("li", {}, el("span", { class: "ck", "aria-hidden": "true" }, "✓"), el("div", {}, el("div", { class: "t" }, it.t), el("div", { class: "s" }, it.s))))));
      case "cards":
        return el("div", {}, v.lead ? el("p", { class: "lead" }, v.lead) : null,
          el("div", { class: "cards" }, v.items.map((it) => el("div", { class: "cd" }, el("div", { class: "t" }, it.t), el("div", { class: "s" }, it.s)))));
      case "chips":
        return el("div", {}, v.lead ? el("p", { class: "lead" }, v.lead) : null,
          el("div", { class: "chipset" }, v.items.map((c) => el("span", {}, c))),
          v.bad ? el("div", { class: "badbox" }, el("b", {}, v.bad.t), el("span", {}, v.bad.s)) : null);
      case "define": {
        const q = el("blockquote", {});
        let rest = v.quote;
        // 핵심 구절을 형광펜으로
        ["일반학교에서", "차별을 받지 아니하고", "또래와 함께", "개개인의 교육적 요구에 적합한"].forEach((k) => {
          const i = rest.indexOf(k);
          if (i < 0) return;
          q.append(rest.slice(0, i), el("mark", {}, k));
          rest = rest.slice(i + k.length);
        });
        q.append(rest);
        return el("div", { class: "define" }, el("div", { class: "word" }, v.word), q,
          el("div", { class: "chipset" }, v.keys.map((k) => el("span", {}, k))));
      }
    }
    return null;
  }

  function renderExplain() {
    const qi = state.qi, ex = QS[qi].explain;
    show("explain");
    $("exNo").textContent = `${qi + 1}번 문제 설명`;
    $("exTitle").textContent = ex.title;
    $("exComment").textContent = ex.comment;
    const vis = $("exVisual");
    vis.textContent = "";
    const v = renderVisual(ex.visual);
    if (v) vis.append(v);
    vis.hidden = !v;
    const art = $("exArt");
    art.hidden = !ex.art;
    $("exBody").classList.toggle("has-art", !!ex.art);
    if (ex.art) { $("exImg").src = ex.art; $("exImg").alt = ex.title; }
    $("exNext").textContent = nextLabel(qi);
    $("exNext").onclick = goNext;
  }

  function renderFinal() {
    show("final");
    const r = QZ.rank(players);
    const pod = $("podium");
    pod.textContent = "";
    [1, 0, 2].forEach((i) => {
      const p = r[i];
      pod.append(el("div", { class: `pod p${i + 1}` },
        el("div", { class: "nm" }, p ? p.name : "—"),
        el("div", { class: "sc" }, p ? `${p.score.toLocaleString()}점` : ""),
        el("div", { class: "block" }, String(i + 1))));
    });
    const all = $("allRank");
    all.textContent = "";
    r.forEach((p, i) => all.append(el("li", {},
      el("span", { class: "pos" }, String(i + 1)), el("span", { class: "nm" }, p.name),
      el("span", { class: "sc" }, `${p.score.toLocaleString()}점`))));
    $("newRoom").onclick = () => { try { sessionStorage.removeItem("qz-host-pin"); } catch (e) {} location.reload(); };
    $("closeRoom").onclick = async () => {
      const b = $("closeRoom");
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "한 번 더 누르면 지워져요"; return; }
      roomRef.child("players").off(); roomRef.child("state").off();
      await roomRef.remove();
      try { sessionStorage.removeItem("qz-host-pin"); } catch (e) {}
      location.reload();
    };
  }

  // 전체화면 켜기/끄기 (F 키도 가능)
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  $("fsBtn").onclick = toggleFs;
  document.addEventListener("keydown", (e) => {
    if ((e.key === "f" || e.key === "F") && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) toggleFs();
  });
  document.addEventListener("fullscreenchange", () => {
    $("fsBtn").textContent = document.fullscreenElement ? "전체화면 끄기" : "전체화면";
  });

  boot();
})();
