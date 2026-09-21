/* 遥测与反馈收集：零依赖、默认不出网、绝不阻塞回合。
   设计约束（都来自这个仓库自己踩过的坑）：
   1) 事件只进内存 + localStorage，玩家断网/被墙也不丢，攒着等下次上传；
   2) 任何采集都不能 await 在游戏回合里——判断层曾因 await 网络把 95% 按键吞掉；
   3) 无 PII：只有随机匿名 id，玩家可一键关，可看见将要上传的全部内容。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Insight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const KEY = 'yinyang.insight.v1';
  const MAX_EVENTS = 400;
  const MAX_PENDING = 12;
  const rid = () => Math.random().toString(36).slice(2, 10);

  function store() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  }

  function make(opts) {
    const cfg = Object.assign({ endpoint: null, enabled: true, sample: true }, opts || {});
    const s = store();
    const state = {
      uid: s.uid || rid() + rid(),
      session: rid(),
      run: null,
      events: s.events || [],
      pending: s.pending || [],
      feedback: s.feedback || [],
      enabled: s.enabled !== false,
      storageOk: save(s),
      turnStart: 0,
      mode: null,
      turns: [],
      errors: [],
      seq: s.seq || 0,
    };
    const env = () => ({
      v: '0.3.0', mode: state.mode || null,
      vw: innerWidth, vh: innerHeight, touch: navigator.maxTouchPoints > 0, lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone, ua: navigator.userAgent.slice(0, 160),
    });

    const api = {
      cfg, state, env,
      startRun(cls) {
        state.run = { id: rid(), cls, t0: Date.now(), floors: [], deaths: 0 };
        api.ev('run_start', { cls });
      },
      ev(name, props) {
        if (!state.enabled) return;
        state.seq++;
        const row = Object.assign({ n: state.seq, t: Date.now() - (state.run ? state.run.t0 : Date.now()), ev: name }, props || {});
        if (state.run) row.run = state.run.id;
        state.events.push(row);
        if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
        api.flush();
        if (cfg.endpoint && state.events.length % 20 === 0) api.upload();
      },
      markTurnStart() { state.turnStart = performance.now(); },
      markTurnEnd(kind) {
        if (!state.turnStart) return;
        const ms = Math.round(performance.now() - state.turnStart);
        state.turnStart = 0;
        state.turns.push(ms);
        if (state.turns.length > 200) state.turns.shift();
        // 回合延迟是"判断层有没有卡住输入"的哨兵指标（曾实测 p50 470ms 吞键）
        if (ms > 250) api.ev('turn_slow', { ms, kind });
      },
      diag() {
        const sorted = state.turns.slice().sort((a, b) => a - b);
        return {
          uid: state.uid, session: state.session, run: state.run && Object.assign({}, state.run, { floors: state.run.floors.length }),
          env: env(), events: state.events.length, storage: state.storageOk, pending_uploads: state.pending.length,
          turn_ms: sorted.length ? { n: sorted.length, p50: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1] } : null,
          errors: state.errors.slice(-5),
          jev: state.jevSummary ? state.jevSummary() : null,
        };
      },
      bundle(note) {
        return { kind: 'yinyang-diagnostic', note: note || '', diag: api.diag(), env: env(), last_events: state.events.slice(-120) };
      },
      feedback(note) {
        const b = api.bundle(note);
        state.feedback.push({ t: Date.now(), note: note || '' });
        b.kind = 'yinyang-feedback';
        api.ev('feedback', { len: (note || '').length });
        if (cfg.endpoint) api.post(b, true);
        else state.pending.push(b);
        api.flush();
        return b;
      },
      post(body, keepOnFail) {
        if (!cfg.endpoint) return Promise.resolve(false);
        try {
          return fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
            .then((r) => r.ok)
            .catch(() => { if (keepOnFail) { state.pending.push(body); api.flush(); } return false; });
        } catch (e) { if (keepOnFail) state.pending.push(body); return Promise.resolve(false); }
      },
      upload() {
        if (!cfg.endpoint || !state.pending.length) return Promise.resolve(0);
        const batch = state.pending.splice(0, 3);
        return Promise.all(batch.map((b) => api.post(b, true))).then((oks) => {
          const sent = oks.filter(Boolean).length;
          if (sent < batch.length) state.pending = batch.slice(sent).concat(state.pending);
          if (state.pending.length > MAX_PENDING) state.pending = state.pending.slice(-MAX_PENDING);
          api.flush();
          return sent;
        });
      },
      setMode(m) { state.mode = m; },
      bindJev(j) { state.jevSummary = () => j.summary(); state.mode = j.cfg.mode; },
      setEnabled(on) { state.enabled = !!on; api.flush(); if (on) api.ev('telemetry_on'); },
      clear() { state.events = []; state.pending = []; state.feedback = []; state.seq = 0; save({ uid: state.uid, enabled: state.enabled }); },
      flush() {
        save({ uid: state.uid, enabled: state.enabled, events: state.events, pending: state.pending, feedback: state.feedback, seq: state.seq });
      },
    };

    addEventListener('error', (e) => {
      state.errors.push({ t: Date.now(), msg: String(e.message).slice(0, 200), at: String(e.filename || '').split('/').pop() + ':' + e.lineno });
      api.ev('js_error', { msg: String(e.message).slice(0, 160), at: String(e.filename || '').split('/').pop() + ':' + e.lineno });
    });
    addEventListener('unhandledrejection', (e) => api.ev('promise_reject', { msg: String((e.reason && e.reason.message) || e.reason).slice(0, 160) }));
    document.addEventListener('visibilitychange', () => { if (document.hidden) { api.ev('hidden', {}); api.flush(); api.upload(); } });

    api.ev('boot', env());
    if (cfg.endpoint) api.upload();
    return api;
  }

  return { make };
});
