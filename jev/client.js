/* 判断层出口：off|local|bridge 三模式 + 置信度门 + 硬否决 + fallback + 遥测 + 执行前重校验 */
(function (root, factory) {
  const g = typeof globalThis !== 'undefined' ? globalThis : root;
  const api = factory(g.JEVCore || require('./core.js'), g.JEVPolicies || require('./policies.js'), g.JEVQuestions || require('./questions.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  g.JEVClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, P, Q) {
  const EMPTY_MEM = () => ({ frozenTurns: 0, lastAction: null, lastDir: null, fingerprint: null, reusedDecision: null });

  function makeClient(overrides) {
    const cfg = Object.assign({ mode: 'off', endpoint: '/decide', auto: 0.6, margin: 0.15, noulGate: 0.6, timeoutMs: 4000, telemetryCap: 200 }, overrides || {});
    const client = {
      cfg,
      memory: new Map(),
      telemetry: [],
      stats: { decisions: 0, asks: 0, calls: 0, reused: 0, gated: 0, fallbacks: 0, errors: 0, stale: 0, latency_ms_total: 0, tokens_in: 0, tokens_out: 0, latencies: [], models: [] },
      reset() { client.memory.clear(); client.telemetry = []; client.stats = { decisions: 0, asks: 0, calls: 0, reused: 0, gated: 0, fallbacks: 0, errors: 0, stale: 0, latency_ms_total: 0, tokens_in: 0, tokens_out: 0, latencies: [], models: [] }; },
      mem(u) { if (!client.memory.has(u.id)) client.memory.set(u.id, EMPTY_MEM()); return client.memory.get(u.id); },
      record(row) { client.telemetry.unshift(row); if (client.telemetry.length > cfg.telemetryCap) client.telemetry.pop(); return row; },

      async decide(u, w) {
        const mem = client.mem(u);
        const ctx = C.legalActions(u, w, { memory: mem });
        client.stats.decisions++;
        if (cfg.mode === 'off') {
          const a = P.baseline(u, w, ctx);
          return client.track(u, w, ctx, mem, { action: a, path: 'baseline' });
        }
        const need = Q.needsJudgment(u, w, ctx);
        if (!need.ask) return client.track(u, w, ctx, mem, { action: C.find(ctx.offered, C.HOLD), path: 'skip', reason: need.reason });
        client.stats.asks++;
        if (cfg.mode === 'local') return client.track(u, w, ctx, mem, { action: P.local(u, w, ctx, mem), path: 'local' });

        const fp = C.fingerprint(u, w, ctx);
        if (mem.fingerprint === fp && mem.reusedDecision) {
          client.stats.reused++;
          const reused = C.find(ctx.offered, mem.reusedDecision);
          if (reused) return client.track(u, w, ctx, mem, { action: reused, path: 'reused' });
        }
        const packet = Q.build(u, w, ctx, mem);
        const t0 = Date.now();
        let answers = null, usage = null, modelSeen = null, err = null;
        try {
          const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = ctl ? setTimeout(() => ctl.abort(), cfg.timeoutMs) : null;
          const res = await fetch(cfg.endpoint, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ state: packet.state, questions: packet.questions }),
            signal: ctl ? ctl.signal : undefined,
          });
          if (timer) clearTimeout(timer);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const json = await res.json();
          answers = json.answers; usage = json.usage;
          modelSeen = (json.usage && json.usage.model) || null;
        } catch (e) { err = e && e.message ? e.message : String(e); }
        const latency = Date.now() - t0;
        client.stats.calls++; client.stats.latency_ms_total += latency; client.stats.latencies.push(latency);
        if (modelSeen && !client.stats.models.includes(modelSeen)) client.stats.models.push(modelSeen);
        if (usage) { client.stats.tokens_in += usage.input_tokens_total || usage.input_tokens || 0; client.stats.tokens_out += usage.output_tokens_total || usage.output_tokens || 0; }

        // 执行前重校验：await 期间玩家可能已移动/该敌可能已死，指纹变了就不落地
        const ctx2 = C.legalActions(u, w, { memory: mem });
        if (C.fingerprint(u, w, ctx2) !== fp) {
          client.stats.stale++;
          return client.track(u, w, ctx2, mem, { action: P.local(u, w, ctx2, mem), path: 'stale', latency_ms: latency, error: err });
        }
        if (err || !answers) {
          client.stats.errors++;
          return client.track(u, w, ctx2, mem, { action: P.local(u, w, ctx2, mem), path: 'fallback', reason: 'bridge 不可用：' + err, latency_ms: latency });
        }
        const g = P.gate(answers, u, w, ctx2, cfg);
        if (g.chosen) {
          client.stats.gated++;
          mem.fingerprint = fp; mem.reusedDecision = g.chosen.id;
          return client.track(u, w, ctx2, mem, { action: g.chosen, path: g.path, confidence: g.confidence, margin: g.margin, proposed: answers.action && answers.action.choice, latency_ms: latency });
        }
        client.stats.fallbacks++;
        return client.track(u, w, ctx2, mem, { action: P.local(u, w, ctx2, mem), path: 'fallback', reason: g.reason, proposed: answers.action && answers.action.choice, confidence: g.confidence, latency_ms: latency });
      },

      track(u, w, ctx, mem, out) {
        const a = out.action || C.find(ctx.offered, C.HOLD);
        if (a && a.kind === 'step') {
          // 用绕行步数而非曼哈顿距离判"卡住"：贴墙横移可能缩短直线距离却在绕远
          mem.frozenTurns = a.viaAfter >= ctx.via ? mem.frozenTurns + 1 : 0;
          mem.lastDir = a.dir;
        } else if (a && a.kind === 'strike') mem.frozenTurns = 0;
        mem.lastAction = a ? a.id : null;
        const evidence = { dist: ctx.dist, los: ctx.los, hp_ratio: +(u.hp / u.maxHp).toFixed(2), offered: ctx.offered.length, vetoed: ctx.vetoes.map((v) => v.id + ':' + v.reason) };
        client.record(Object.assign({ unit: u.id, kind: u.name, floor: w.floor, evidence, applied: a ? a.id : null, at: Date.now() }, out, { action: undefined }));
        return Object.assign(out, { action: a, evidence });
      },

      summary() {
        const s = client.stats;
        const sorted = s.latencies.slice().sort((a, b) => a - b);
        const { latencies, ...rest } = s;
        return Object.assign({}, rest, {
          avg_latency_ms: s.calls ? +(s.latency_ms_total / s.calls).toFixed(1) : 0,
          lat_min: sorted.length ? sorted[0] : null,
          lat_p50: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
          lat_max: sorted.length ? sorted[sorted.length - 1] : null,
          models: s.models.join('/'),
          reuse_rate: s.asks ? +(s.reused / s.asks).toFixed(3) : 0,
          auto_rate: s.calls ? +(s.gated / s.calls).toFixed(3) : 0,
        });
      },
    };
    return client;
  }

  return { makeClient, EMPTY_MEM };
});
