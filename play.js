/* 참가자(휴대폰) 화면 */
(function () {
  const { el, show } = QZ;
  const QS = QUIZ.questions;
  const $ = (id) => document.getElementById(id);

  let db, pin, pid, roomRef, state = null, players = {}, me = null;
  let ticker = null, builtQi = null;
  const submitted = {}; // qi -> 보여 줄 답 문구

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function boot() {
    db = QZ.initDb();
    if (!db) { show("setup"); return; }
    const urlPin = (QZ.params.get("pin") || "").replace(/\D/g, "").slice(0, 6);
    $("pinIn").value = urlPin;
    $("joinForm").addEventListener("submit", (e) => { e.preventDefault(); join(); });
    const saved = urlPin && store.get(`qz-player-${urlPin}`);
    if (saved && saved.pid) {
      db.ref(`rooms/${urlPin}/players/${saved.pid}`).once("value").then((s) => {
        if (s.exists()) enter(urlPin, saved.pid);
        else { show("join"); focusFirst(); }
      });
    } else { show("join"); focusFirst(); }
  }

  function focusFirst() { ($("pinIn").value ? $("nameIn") : $("pinIn")).focus(); }

  async function join() {
    const p = $("pinIn").value.replace(/\D/g, "");
    const name = $("nameIn").value.trim().replace(/\s+/g, " ");
    const err = $("joinErr");
    err.textContent = "";
    if (p.length !== 6) { err.textContent = "PIN 번호 6자리를 입력해 주세요."; return; }
    if (!name) { err.textContent = "닉네임을 입력해 주세요."; $("nameIn").focus(); return; }
    $("joinBtn").disabled = true;
    try {
      const st = await db.ref(`rooms/${p}/state`).once("value");
      if (!st.exists()) { err.textContent = "그 PIN의 퀴즈 방이 없어요. 번호를 확인해 주세요."; return; }
      if (st.val().phase === "final") { err.textContent = "이미 끝난 퀴즈예요."; return; }
      const ps = (await db.ref(`rooms/${p}/players`).once("value")).val() || {};
      if (Object.values(ps).some((x) => x.name === name)) { err.textContent = "같은 닉네임이 이미 있어요. 다른 닉네임을 써 주세요."; return; }
      const ref = db.ref(`rooms/${p}/players`).push();
      await ref.set({ name, score: 0, joinedAt: firebase.database.ServerValue.TIMESTAMP });
      store.set(`qz-player-${p}`, { pid: ref.key });
      enter(p, ref.key);
    } catch (e) {
      err.textContent = "연결이 잠시 불안정해요. 다시 눌러 주세요.";
    } finally {
      $("joinBtn").disabled = false;
    }
  }

  function enter(p, id) {
    pin = p; pid = id;
    roomRef = db.ref(`rooms/${p}`);
    roomRef.child("players").on("value", (s) => {
      players = s.val() || {};
      const mine = players[pid];
      if (!mine) {
        // 진행자가 내보냈거나 방이 정리됨
        roomRef.child("players").off(); roomRef.child("state").off(); me = null; state = null; stopTicker(); store.del(`qz-player-${p}`);
        $("meTag").hidden = true;
        $("joinErr").textContent = "방에서 나오게 되었어요. 다시 입장할 수 있어요.";
        show("join");
        return;
      }
      me = mine;
      $("meTag").hidden = false;
      $("meTag").textContent = me.name;
      if (state && (state.phase === "reveal" || state.phase === "final")) render();
    });
    roomRef.child("state").on("value", (s) => { state = s.val(); render(); });
  }

  function myRank() {
    const r = QZ.rank(players);
    return { pos: r.findIndex((x) => x.id === pid) + 1, total: r.length };
  }

  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  function render() {
    if (!state || !me) return;
    if (state.phase !== "question") { stopTicker(); builtQi = null; }
    switch (state.phase) {
      case "lobby":
        $("waitTitle").textContent = `${me.name}님, 입장 완료!`;
        $("waitMsg").textContent = "진행자가 시작하면 이 화면에 문제가 나와요.";
        return show("wait");
      case "question": return renderQuestion();
      case "reveal": return renderResult();
      case "explain": return renderExplain();
      case "final": return renderFinal();
    }
  }

  /* ---------- 문제 ---------- */
  async function renderQuestion() {
    const qi = state.qi, q = QS[qi];
    if (submitted[qi] === undefined) {
      const a = await roomRef.child(`answers/${qi}/${pid}`).once("value");
      if (a.exists()) submitted[qi] = describe(q, a.val().v);
    }
    if (!state || state.phase !== "question" || state.qi !== qi) return;
    if (submitted[qi] !== undefined) return showSent(qi);

    if (builtQi !== qi) {
      builtQi = qi;
      $("qNo").textContent = `${qi + 1} / ${QS.length}`;
      $("qType").textContent = QZ.TYPE_LABEL[q.type];
      $("qText").textContent = q.text;
      buildAnswerUI(q, qi);
    }
    show("q");
    stopTicker();
    const tick = () => {
      const t = QZ.now();
      if (t < state.startAt) {
        $("qCount").hidden = false; $("qMain").hidden = true;
        $("qCount").textContent = Math.ceil((state.startAt - t) / 1000);
        $("tFill").style.width = "100%";
        return;
      }
      $("qCount").hidden = true; $("qMain").hidden = false;
      const left = Math.max(0, state.endAt - t);
      $("tFill").style.width = `${(left / (q.time * 1000)) * 100}%`;
      if (left <= 0 && submitted[qi] === undefined) {
        stopTicker();
        submitted[qi] = null;
        $("sentTitle").textContent = "시간이 끝났어요";
        $("sentAns").textContent = "이번 문제는 답을 보내지 못했어요.";
        show("sent");
      }
    };
    tick();
    ticker = setInterval(tick, 150);
  }

  function describe(q, v) {
    if (q.type === "choice") return `${Number(v) + 1}번 · ${q.options[Number(v)]}`;
    if (q.type === "order") return String(v).split(",").map((i) => q.items[Number(i)]).join(" → ");
    return String(v);
  }

  function showSent(qi) {
    stopTicker();
    $("sentTitle").textContent = submitted[qi] === null ? "시간이 끝났어요" : "답을 보냈어요";
    $("sentAns").textContent = submitted[qi] ? `내 답: ${submitted[qi]}` : "이번 문제는 답을 보내지 못했어요.";
    show("sent");
  }

  function submit(qi, v) {
    const q = QS[qi];
    if (submitted[qi] !== undefined || !state || state.phase !== "question" || state.qi !== qi) return;
    if (QZ.now() > state.endAt + 300) return;
    submitted[qi] = describe(q, v);
    showSent(qi);
    roomRef.child(`answers/${qi}/${pid}`).set({ v, at: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
  }

  function buildAnswerUI(q, qi) {
    const body = $("qBody");
    body.textContent = "";
    if (q.type === "choice") {
      body.append(el("div", { class: "choices" }, q.options.map((o, i) =>
        el("button", { class: `choice opt-${i}`, type: "button", onclick: () => submit(qi, i) },
          el("span", { class: "tag-num" }, String(i + 1)), o))));
    } else if (q.type === "ox") {
      body.append(el("div", { class: "ox" },
        el("button", { class: "choice opt-o", type: "button", "aria-label": "O 맞다", onclick: () => submit(qi, "O") }, "O"),
        el("button", { class: "choice opt-x", type: "button", "aria-label": "X 아니다", onclick: () => submit(qi, "X") }, "X")));
    } else if (q.type === "order") {
      const seq = [];
      const sendBtn = el("button", { class: "btn coral", type: "button", disabled: "" }, "이 순서로 제출");
      const btns = q.shuffle.map((i) => {
        const badge = el("span", { class: "badge" }, "");
        const b = el("button", { type: "button" }, badge, q.items[i]);
        b.addEventListener("click", () => {
          const at = seq.indexOf(i);
          if (at >= 0) seq.splice(at, 1); else seq.push(i);
          paint();
        });
        b._i = i; b._badge = badge;
        return b;
      });
      const paint = () => {
        btns.forEach((b) => {
          const at = seq.indexOf(b._i);
          b.classList.toggle("on", at >= 0);
          b._badge.textContent = at >= 0 ? String(at + 1) : "";
        });
        if (seq.length === q.items.length) sendBtn.removeAttribute("disabled"); else sendBtn.setAttribute("disabled", "");
      };
      sendBtn.addEventListener("click", () => { if (seq.length === q.items.length) submit(qi, seq.join(",")); });
      body.append(
        el("p", { class: "muted", style: "margin:0 0 10px" }, "첫 단계부터 차례로 누르세요. 다시 누르면 취소돼요."),
        el("div", { class: "order-pick" }, btns),
        el("div", { class: "row", style: "margin-top:14px;justify-content:flex-end" }, sendBtn));
    } else {
      if (q.hint) body.append(el("div", { class: "hint" }, q.hint));
      const inp = el("input", { id: `ans-${qi}`, autocomplete: "off", placeholder: "정답을 입력하세요", maxlength: "40" });
      const form = el("form", { class: "row", style: "margin-top:12px", novalidate: "" },
        el("div", { class: "grow" }, inp), el("button", { class: "btn coral", type: "submit" }, "제출"));
      form.addEventListener("submit", (e) => { e.preventDefault(); const v = inp.value.trim(); if (v) submit(qi, v); });
      body.append(form);
    }
  }

  /* ---------- 결과 ---------- */
  function renderResult() {
    const qi = state.qi, q = QS[qi];
    const last = me.last && me.last.qi === qi ? me.last : null;
    show("result");
    const box = $("resBox");
    if (!last) {
      box.className = "result none";
      $("resTitle").textContent = "채점 중…";
      $("resPts").textContent = "";
    } else if (!last.answered) {
      box.className = "result none";
      $("resTitle").textContent = "답을 못 보냈어요";
      $("resPts").textContent = "+0점";
    } else if (last.correct) {
      box.className = "result ok";
      $("resTitle").textContent = "정답이에요!";
      $("resPts").textContent = `+${last.points.toLocaleString()}점`;
    } else {
      box.className = "result no";
      $("resTitle").textContent = "아쉬워요";
      $("resPts").textContent = "+0점";
    }
    $("resAnswer").textContent = QZ.answerLabel(q);
    const r = myRank();
    $("resRank").textContent = `${r.pos}위 / ${r.total}명`;
    $("resScore").textContent = `${(me.score || 0).toLocaleString()}점`;
  }

  function renderExplain() {
    const ex = QS[state.qi].explain;
    $("exTitle").textContent = ex.title;
    $("exComment").textContent = ex.comment;
    const img = $("exImg");
    img.hidden = !ex.img;
    if (ex.img) { img.src = ex.img; img.alt = ex.title; }
    show("ex");
  }

  function renderFinal() {
    const r = myRank();
    const medal = ["🥇", "🥈", "🥉"][r.pos - 1];
    $("finEmoji").textContent = medal || "🎉";
    $("finTitle").textContent = r.pos <= 3 ? `${r.pos}등 축하해요!` : "수고하셨어요!";
    $("finMsg").textContent = "진행자 화면에서 최종 순위를 확인하세요.";
    $("finRank").textContent = `${r.pos}위 / ${r.total}명`;
    $("finScore").textContent = `${(me.score || 0).toLocaleString()}점`;
    show("final");
  }

  boot();
})();
