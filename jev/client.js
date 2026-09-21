/* 判断层出口：off|local|norule|auto|bridge 五档 + 置信度门 + 硬否决 + fallback + 遥测 + 执行前重校验
   auto = 只在"模拟差值大"或"本来没规则"的地方才花钱问 Jev。 */
(function (root, factory) {
  const g = typeof globalThis !== 'undefined' ? globalThis : root;
  const api = factory(g.JEVCore || require('./core.js'), g.JEVPolicies || require('./policies.js'), g.JEVQuestions || require('./questions.js'));
  if (typeof module === 'object' && module.exports) module.exports = api;
  g.JEVClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (C, P, Q) {
  const EMPTY_MEM = () => ({ frozenTurns: 0, lastAction: null, lastDir: null, fingerprint: null, reusedDecision: null });
  const newStats = () => ({ decisions: 0, asks: 0, calls: 0, reused: 0, gated: 0, fallbacks: 0, errors: 0, stale: 0, low_stakes: 0, escalated: 0, no_rule: 0, hold_breaks: 0, advisory_pending: 0, latency_ms_total: 0, tokens_in: 0, tokens_out: 0, latencies: [], models: [] });

  function makeClient(overrides) {
    const cfg = Object.assign({ mode: 'off', endpoint: '/decide', auto: 0.6, margin: 0.15, noulGate: 0.6, stakeDelta: 2, timeoutMs: 4000, adviceTtlMs: 1500, telemetryCap: 200 }, overrides || {});
    const client = {
      cfg,
      memory: new Map(),
      advice: new Map(),
      inflight: new Set(),
      telemetry: [],
      stats: newStats(),
      reset() { client.memory.clear(); client.advice.clear(); client.inflight.clear(); client.telemetry = []; client.stats = newStats(); },
      mem(u) { if (!client.memory.has(u.id)) client.memory.set(u.id, EMPTY_MEM()); return client.memory.get(u.id); },
      record(row) { client.telemetry.unshift(row); if (client.telemetry.length > cfg.telemetryCap) client.telemetry.pop(); return row; },

      async rawAsk(packet) {
        const t0 = Date.now();
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
          if (json.usage && json.usage.model && !client.stats.models.includes(json.usage.model)) client.stats.models.push(json.usage.model);
          if (json.usage) { client.stats.tokens_in += json.usage.input_tokens_total || json.usage.input_tokens || 0; client.stats.tokens_out += json.usage.output_tokens_total || json.usage.output_tokens || 0; }
          return { answers: json.answers, usage: json.usage, latency: Date.now() - t0, error: null };
        } catch (e) {
          return { answers: null, usage: null, latency: Date.now() - t0, error: e && e.message ? e.message : String(e) };
        } finally {
          const ms = Date.now() - t0;
          client.stats.calls++; client.stats.latency_ms_total += ms; client.stats.latencies.push(ms);
        }
      },

      // 慢层只建议、快层立即行动：网络档绝不 await 回合线程（实测一次 /decide p50 ~470ms，
      // 阻塞会让玩家按键被丢弃）。答案晚一回合落地，落地时照样过合法域与重校验。
      advise(key, packet) {
        const now = Date.now();
        const hit = client.advice.get(key);
        if (hit && now - hit.at < cfg.adviceTtlMs) return hit.answers;
        if (!client.inflight.has(key)) {
          client.inflight.add(key);
          client.rawAsk(packet).then((r) => {
            if (r.error) client.stats.errors++;
            client.advice.set(key, { answers: r.answers || null, at: r.answers ? Date.now() : Date.now() - cfg.adviceTtlMs + 200 });
          }).catch(() => {}).then(() => client.inflight.delete(key));
        }
        return hit && hit.answers ? hit.answers : null;
      },

      async decide(u, w) {
        const mem = client.mem(u);
        const ctx = C.legalActions(u, w, { memory: mem });
        client.stats.decisions++;
        if (cfg.mode === 'off') {
          return client.track(u, w, ctx, mem, { action: P.baseline(u, w, ctx), path: 'baseline' });
        }
        const need = Q.needsJudgment(u, w, ctx);
        if (!need.ask) return client.track(u, w, ctx, mem, { action: C.find(ctx.offered, C.HOLD), path: 'skip', reason: need.reason });
        client.stats.asks++;
        if (cfg.mode === 'local' || cfg.mode === 'norule') return client.track(u, w, ctx, mem, { action: P.local(u, w, ctx, mem), path: cfg.mode === 'local' ? 'local' : 'local_norule' });
        if (cfg.mode === 'auto') {
          const st = P.stakes(ctx, cfg.stakeDelta);
          // 差值小 = 选哪个都一样，不值得花一次网络往返
          if (!st.high) {
            client.stats.low_stakes++;
            return client.track(u, w, ctx, mem, { action: P.local(u, w, ctx, mem), path: 'local_lowstakes', spread: st.spread });
          }
          client.stats.escalated++;
        }

        const fp = C.fingerprint(u, w, ctx);
        if (mem.fingerprint === fp && mem.reusedDecision) {
          const reused = C.find(ctx.offered, mem.reusedDecision);
          // 只有"会改变世界"的决策才可能被复用：hold 不改指纹，复用它会原地锁死，
          // 场景没变 yet 又要推进时交给 local 保底
          if (reused && reused.kind !== 'hold') {
            client.stats.reused++;
            return client.track(u, w, ctx, mem, { action: reused, path: 'reused' });
          }
          if (reused) {
            client.stats.hold_breaks++;
            return client.track(u, w, ctx, mem, { action: P.local(u, w, ctx, mem), path: 'hold_to_local' });
          }
        }
        const answers = client.advise('move:' + u.id, Q.build(u, w, ctx, mem));
        if (!answers) {
          // 答案还在路上：本回合先按 local 行动，输入线程一次都不等网络
          client.stats.advisory_pending++;
          return client.track(u, w, ctx, mem, { action: P.local(u, w, ctx, mem), path: 'advisory_pending' });
        }
        const g = P.gate(answers, u, w, ctx, cfg);
        if (g.chosen) {
          client.stats.gated++;
          mem.fingerprint = fp; mem.reusedDecision = g.chosen.id;
          return client.track(u, w, ctx, mem, { action: g.chosen, path: g.path, confidence: g.confidence, margin: g.margin, proposed: answers.action && answers.action.choice });
        }
        client.stats.fallbacks++;
        return client.track(u, w, ctx, mem, { action: P.local(u, w, ctx, mem), path: 'fallback', reason: g.reason, proposed: answers.action && answers.action.choice, confidence: g.confidence });
      },

      // judge = 无规则决策（长老三选、技能时机）。没有更好规则时不假装聪明：
      // off/local 直接用调用方给的旧规则值；bridge/auto 问 Jev，问不到或置信不足仍回旧值。
      async judge(name, packet, legacyValue) {
        if (cfg.mode === 'off' || cfg.mode === 'local') {
          client.stats.no_rule++;
          return { value: legacyValue, path: cfg.mode === 'off' ? 'legacy' : 'no_rule_local' };
        }
        client.stats.asks++;
        const answers = client.advise('judge:' + name, packet);
        const a = answers && answers[name];
        const allowed = Object.keys((packet.questions[name] || {}).criteria || {});
        if (!answers) { client.stats.advisory_pending++; return { value: legacyValue, path: 'advisory_pending' }; }
        if (!a || a.type !== 'choice') { client.stats.fallbacks++; return { value: legacyValue, path: 'fallback', reason: '缺答案' }; }
        if (!allowed.includes(a.choice)) { client.stats.fallbacks++; return { value: legacyValue, path: 'fallback', reason: '非法标签：' + a.choice }; }
        if (a.confidence != null && a.confidence < cfg.auto) { client.stats.fallbacks++; return { value: legacyValue, path: 'fallback', reason: '置信不足 ' + a.confidence, confidence: a.confidence }; }
        client.stats.gated++;
        return { value: a.choice, path: 'jev', confidence: a.confidence, probabilities: a.probabilities };
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
          escalate_rate: s.asks ? +(s.escalated / s.asks).toFixed(3) : 0,
        });
      },
    };
    return client;
  }

  return { makeClient, EMPTY_MEM };
});
