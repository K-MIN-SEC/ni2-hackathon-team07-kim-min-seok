/* 오토 밸런싱 v2 — 목표 기반 자동 밸런싱
 * engine.js의 AB.simulate를 반복 실행해서 목표에 맞는 수치를 찾는다.
 * - 변수 1개 + 단조: 이분 탐색
 * - 변수 여러 개 또는 비단조: 제한된 그리드 탐색 + 변수별 국소 정제
 * - 최종 수정안은 반드시 처음부터 다시 시뮬레이션해서 검증한다.
 */
(function (root) {
  'use strict';
  const AB = root.AB || (typeof require !== 'undefined' ? require('./engine.js') : null);
  const DAY = 1440;
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------------- 조정 가능한 수치 목록 ----------------
  const COLL = { modules: 'id', stats: 'id', links: 'id', resources: 'id', states: 'id', rewards: 'resourceId', cost: 'resourceId' };
  function resolve(p, key) {
    const seg = key.split('/');
    let o = p;
    for (let i = 0; i < seg.length - 1; i++) {
      const s = seg[i];
      if (COLL[s] && Array.isArray(o[s])) { const id = seg[++i]; o = o[s].find(x => x[COLL[s]] === id); }
      else if (s === 'unlock') { o = o.unlock[+seg[++i]]; }
      else o = o[s];
      if (o === undefined || o === null) return null;
    }
    return { obj: o, prop: seg[seg.length - 1] };
  }
  function getParam(p, key) { const r = resolve(p, key); return r ? r.obj[r.prop] : undefined; }
  function setParam(p, key, v) { const r = resolve(p, key); if (!r) throw new Error('없는 변수: ' + key); r.obj[r.prop] = v; }

  function formulaParams(out, keyBase, label, f, group) {
    if (!f || typeof f !== 'object') return;
    out.push({ key: keyBase + '/base', label: label + ' 기본값', group, value: f.base });
    if (f.type !== 'const') out.push({ key: keyBase + '/growth', label: label + (f.type === 'linear' ? ' 증가량' : ' 배율'), group, value: f.growth });
  }
  function listParams(p) {
    const out = [];
    const rn = id => (p.resources.find(r => r.id === id) || {}).name || id;
    const sn = id => ([...p.states, ...p.stats].find(r => r.id === id) || {}).name || id;
    for (const m of p.modules) {
      const g = m.name, K = `modules/${m.id}`;
      if (m.type === 'hunt') out.push({ key: K + '/killsPerMin', label: '분당 처치 수', group: g, value: m.killsPerMin });
      if (m.type === 'idle') {
        if (m.mode === 'fromHunt') out.push({ key: K + '/ratePct', label: '방치 효율(%)', group: g, value: m.ratePct });
        out.push({ key: K + '/capHours', label: '최대 누적 시간', group: g, value: m.capHours });
      }
      if (m.type === 'dungeon') out.push({ key: K + '/durationMin', label: '소요 시간(분)', group: g, value: m.durationMin, int: true });
      for (const r of m.rewards || []) formulaParams(out, `${K}/rewards/${r.resourceId}/amount`, `${rn(r.resourceId)} 보상`, r.amount, g);
      for (const c of m.cost || []) formulaParams(out, `${K}/cost/${c.resourceId}/amount`, `${rn(c.resourceId)} 비용`, c.amount, g);
      if (m.type === 'progress') formulaParams(out, `${K}/req`, '요구치', m.req, g);
      (m.unlock || []).forEach((c, i) => out.push({ key: `${K}/unlock/${i}/min`, label: `해금 조건 (${sn(c.ref)} ≥)`, group: g, value: c.min }));
    }
    for (const s of p.stats) out.push({ key: `stats/${s.id}/base`, label: '기본값', group: '능력치 ' + s.name, value: s.base });
    (p.links || []).forEach((l, i) => out.push({ key: `links/${l.id}/value`, label: `${sn(l.ref)} → 변화량`, group: `연결 규칙 ${i + 1}`, value: l.value }));
    for (const r of p.resources) out.push({ key: `resources/${r.id}/initial`, label: '시작 보유량', group: '재화 ' + r.name, value: r.initial || 0 });
    return out.filter(x => typeof x.value === 'number' && isFinite(x.value));
  }

  // ---------------- 목표 평가 ----------------
  function goalTime(res, goal) {
    if (goal.type === 'unlock') return res.unlockAt[goal.moduleId];
    return AB.reachTime(res, goal.stateId, goal.value);
  }
  function horizonDays(p, goal) {
    return Math.min(120, Math.max(p.sim.days, Math.ceil((goal.targetMin * 2) / DAY), Math.ceil(goal.targetMin / DAY) + 1));
  }
  function tolerance(goal) { return goal.toleranceMin !== undefined ? goal.toleranceMin : Math.max(60, Math.round(goal.targetMin * 0.02)); }

  function changeOf(vars, values) {
    // 변수별 변경률 |새 값 / 기존 값 − 1|의 평균 (기존 값이 0이면 범위 대비 변화량)
    let s = 0;
    vars.forEach((v, i) => {
      const o = v.old, n = values[i];
      if (o !== 0) s += Math.abs(n / o - 1);
      else s += Math.abs(n - o) / Math.max(1e-12, Math.abs(v.max - v.min));
    });
    return vars.length ? s / vars.length : 0;
  }

  function makeEvaluator(p, goal, vars, opts) {
    const H = horizonDays(p, goal);
    const tol = tolerance(goal);
    let sims = 0, rejected = 0;
    const cache = new Map();
    function evaluate(values) {
      const vals = values.map((x, i) => vars[i].int ? Math.round(x) : x);
      const ck = vals.join('|');
      if (cache.has(ck)) return cache.get(ck);
      const q = clone(p);
      vals.forEach((x, i) => setParam(q, vars[i].key, x));
      sims++;
      const res = AB.simulate(q, { playerId: goal.playerId, events: opts.events || [], days: H });
      const t = goalTime(res, goal);
      const time = t === null ? Infinity : t;
      const err = time - goal.targetMin;
      const reliable = res.reliable;
      if (!reliable) rejected++;
      const feasible = reliable && (goal.mode === 'within' ? time <= goal.targetMin : Math.abs(err) <= tol);
      const out = { values: vals, time, err, absErr: Math.abs(err), change: changeOf(vars, vals), feasible, reliable };
      cache.set(ck, out);
      return out;
    }
    return { evaluate, H, tol, stats: () => ({ sims, rejected }) };
  }
  // 정렬 기준: 신뢰 가능 → 달성 → (이내 모드: 변경량 → 오차) / (근접 모드: 오차 → 변경량)
  function better(a, b, mode) {
    if (!b) return true;
    if (a.reliable !== b.reliable) return a.reliable;
    if (a.feasible !== b.feasible) return a.feasible;
    if (a.feasible) {
      if (mode === 'within') { if (Math.abs(a.change - b.change) > 1e-12) return a.change < b.change; return a.absErr < b.absErr; }
      if (Math.abs(a.absErr - b.absErr) > 1e-9) return a.absErr < b.absErr;
      return a.change < b.change;
    }
    const ea = mode === 'within' ? Math.max(0, a.err) : a.absErr;
    const eb = mode === 'within' ? Math.max(0, b.err) : b.absErr;
    if (ea !== eb) return ea < eb;
    return a.change < b.change;
  }

  const linspace = (a, b, n) => n <= 1 ? [a] : Array.from({ length: n }, (_, i) => a + (b - a) * i / (n - 1));

  /**
   * @param p     프로젝트
   * @param goal  { type: 'state'|'unlock', stateId, value, moduleId, playerId, targetMin, mode: 'within'|'closest', toleranceMin? }
   * @param vars  [{ key, min, max, int? }]  조정할 변수 (목록에 없는 수치는 바뀌지 않는다)
   * @param opts  { budget, events, onProgress(done, budget), yieldEvery }
   */
  async function optimize(p, goal, varsIn, opts = {}) {
    const budget = Math.max(20, opts.budget || 300);
    const vars = varsIn.map(v => {
      const old = getParam(p, v.key);
      if (typeof old !== 'number') throw new Error('조정할 수 없는 변수: ' + v.key);
      const lo = Math.min(v.min, v.max), hi = Math.max(v.min, v.max);
      return { ...v, min: lo, max: hi, old };
    });
    const ev = makeEvaluator(p, goal, vars, opts);
    const yieldEvery = opts.yieldEvery || 8;
    let done = 0;
    const tick = async () => {
      done++;
      if (opts.onProgress) opts.onProgress(done, budget);
      if (done % yieldEvery === 0) await new Promise(r => setTimeout(r, 0));
    };
    const evalA = async values => { const r = ev.evaluate(values); await tick(); return r; };

    const baseline = await evalA(vars.map(v => v.old));
    let best = null;
    let method = '';
    const consider = r => { if (better(r, best, goal.mode)) best = r; };
    const baseValues = vars.map(v => Math.min(v.max, Math.max(v.min, v.old)));
    consider(await evalA(baseValues));

    if (!vars.length) {
      method = '변수 없음';
    } else if (vars.length === 1) {
      // 1) 표본으로 단조성 확인
      const v = vars[0];
      const xs = [...new Set([...linspace(v.min, v.max, 11), baseValues[0]].map(x => v.int ? Math.round(x) : x))].sort((a, b) => a - b);
      const samples = [];
      for (const x of xs) { const r = await evalA([x]); samples.push(r); consider(r); }
      const ts = samples.map(s => s.time);
      const nonInc = ts.every((t, i) => i === 0 || t <= ts[i - 1]);
      const nonDec = ts.every((t, i) => i === 0 || t >= ts[i - 1]);
      if (nonInc || nonDec) {
        method = '이분 탐색 (단조성 확인됨)';
        // 2) 목표 시간을 지나는 구간을 찾아 이분 탐색. 기존 값에 가장 가까운 구간부터.
        const pairs = [];
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1], b = samples[i];
          const side = s => goal.mode === 'within' ? (s.time <= goal.targetMin) : (s.err <= 0);
          if (side(a) !== side(b)) pairs.push([a, b]);
        }
        pairs.sort((P, Q) => Math.min(Math.abs(P[0].values[0] - v.old), Math.abs(P[1].values[0] - v.old)) - Math.min(Math.abs(Q[0].values[0] - v.old), Math.abs(Q[1].values[0] - v.old)));
        for (const [a0, b0] of pairs.slice(0, 2)) {
          let a = a0, b = b0;
          const side = s => goal.mode === 'within' ? (s.time <= goal.targetMin) : (s.err <= 0);
          for (let it = 0; it < 40 && done < budget; it++) {
            const xa = a.values[0], xb = b.values[0];
            let mid = (xa + xb) / 2;
            if (v.int) { mid = Math.round(mid); if (mid === xa || mid === xb) break; }
            if (Math.abs(xb - xa) <= 1e-9 * Math.max(1, Math.abs(xa))) break;
            const m = await evalA([mid]);
            consider(m);
            if (side(m) === side(a)) a = m; else b = m;
          }
        }
      } else {
        method = '그리드 탐색 (단조가 아님)';
        const n = Math.min(budget - done, 41);
        for (const x of linspace(v.min, v.max, n)) consider(await evalA([x]));
        await refine();
      }
    } else {
      method = `그리드 탐색 + 국소 정제 (변수 ${vars.length}개)`;
      const gridBudget = Math.floor(budget * 0.6);
      let L = Math.max(2, Math.floor(Math.pow(gridBudget, 1 / vars.length)));
      L = Math.min(L, 9);
      const levels = vars.map((v, i) => {
        const pts = linspace(v.min, v.max, L);
        if (!pts.some(x => Math.abs(x - baseValues[i]) < 1e-12)) pts.push(baseValues[i]);
        return pts.map(x => v.int ? Math.round(x) : x).sort((a, b) => a - b);
      });
      const idx = vars.map(() => 0);
      let count = 0;
      const totalGrid = levels.reduce((a, l) => a * l.length, 1);
      while (count < totalGrid && done < gridBudget + 1) {
        consider(await evalA(idx.map((k, i) => levels[i][k])));
        count++;
        for (let i = 0; i < idx.length; i++) { idx[i]++; if (idx[i] < levels[i].length) break; idx[i] = 0; }
      }
      await refine();
    }

    // 변수별 국소 정제: 한 변수씩 기존 값 쪽 / 반대쪽으로 반씩 좁혀 가며 더 나은 지점을 찾는다
    async function refine() {
      let step = vars.map(v => (v.max - v.min) / 4);
      for (let round = 0; round < 6 && done < budget; round++) {
        let improved = false;
        for (let i = 0; i < vars.length && done < budget; i++) {
          for (const dir of [-1, 1]) {
            if (done >= budget) break;
            const cand = best.values.slice();
            cand[i] = Math.min(vars[i].max, Math.max(vars[i].min, cand[i] + dir * step[i]));
            // 기존 값 쪽으로 당겨 보기 (변경량을 줄이는 방향)
            const r = await evalA(cand);
            if (better(r, best, goal.mode)) { best = r; improved = true; }
          }
          if (done < budget && best.values[i] !== vars[i].old) {
            const cand = best.values.slice();
            cand[i] = (cand[i] + Math.min(vars[i].max, Math.max(vars[i].min, vars[i].old))) / 2;
            const r = await evalA(cand);
            if (better(r, best, goal.mode)) { best = r; improved = true; }
          }
        }
        step = step.map(s => s / 2);
        if (!improved && round > 2) break;
      }
    }

    // 최종 검증: 캐시를 쓰지 않고 처음부터 다시 시뮬레이션
    const finalProject = clone(p);
    best.values.forEach((x, i) => setParam(finalProject, vars[i].key, x));
    const verifyRes = AB.simulate(finalProject, { playerId: goal.playerId, events: opts.events || [], days: ev.H });
    const vt = goalTime(verifyRes, goal);
    const verifyTime = vt === null ? Infinity : vt;
    const verified = verifyRes.reliable && (goal.mode === 'within' ? verifyTime <= goal.targetMin : Math.abs(verifyTime - goal.targetMin) <= ev.tol);

    // 다른 재화 균형 경고 (기간 기준 누적 획득량 비교)
    const warnings = [];
    if (verified) {
      const before = AB.simulate(p, { playerId: goal.playerId, events: opts.events || [] });
      const after = AB.simulate(finalProject, { playerId: goal.playerId, events: opts.events || [] });
      for (const r of p.resources) {
        const g0 = Object.values(before.ledger[r.id].gain).reduce((a, b) => a + b, 0);
        const g1 = Object.values(after.ledger[r.id].gain).reduce((a, b) => a + b, 0);
        if (g0 > 0 && Math.abs(g1 / g0 - 1) >= 0.5) warnings.push(`${r.name} 누적 획득량이 ${((g1 / g0 - 1) * 100).toFixed(0)}% 달라집니다 (${p.sim.days}일 기준)`);
      }
    }
    const st = ev.stats();
    return {
      method, sims: st.sims, rejectedUnreliable: st.rejected, horizonDays: ev.H, toleranceMin: ev.tol,
      baseline: { time: baseline.time, err: baseline.err, feasible: baseline.feasible, reliable: baseline.reliable },
      best: {
        time: best.time, err: best.err, feasible: best.feasible, change: best.change,
        values: vars.map((v, i) => ({ key: v.key, label: v.label, old: v.old, value: best.values[i], pct: v.old !== 0 ? (best.values[i] / v.old - 1) * 100 : null, min: v.min, max: v.max })),
      },
      verified, verifyTime, verifyReliable: verifyRes.reliable, warnings,
      project: verified ? finalProject : null,      // 검증을 통과한 수정안만 적용 후보로 돌려준다
      candidateProject: finalProject,               // 미달성이어도 참고용으로 비교할 수 있게
    };
  }

  const api = { listParams, getParam, setParam, optimize, goalTime, horizonDays };
  root.AB = Object.assign(root.AB || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
