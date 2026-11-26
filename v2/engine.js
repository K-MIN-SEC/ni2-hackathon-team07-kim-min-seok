/* 오토 밸런싱 v2 엔진 — 모듈 조합형 시뮬레이션
 * 설계 문서: docs/data-model-v2.md
 * 브라우저에서는 window.AB, Node에서는 require('./engine.js')로 사용한다.
 * 화면(DOM)에 의존하지 않는다.
 */
(function (root) {
  'use strict';
  const DAY = 1440;
  const LOOP_GUARD = 100000;
  const LIMIT = 1e300;
  const ACTIVITY = { hunt: 1, idle: 1, dungeon: 1 };

  const clone = o => JSON.parse(JSON.stringify(o));
  const sumObj = o => Object.values(o).reduce((a, b) => a + b, 0);
  const byPriority = list => list.map((m, i) => [m, i]).sort((a, b) => ((b[0].priority || 0) - (a[0].priority || 0)) || (a[1] - b[1])).map(x => x[0]);

  // ---------------- 수치 공식 ----------------
  function evalFormula(f, x) {
    if (f === null || f === undefined) return 0;
    if (typeof f === 'number') return f;
    const n = x - (f.offset || 0);
    switch (f.type) {
      case 'const': return f.base;
      case 'linear': return f.base + f.growth * n;
      case 'exp': return f.base * Math.pow(f.growth, n);
      case 'step': return f.base * Math.pow(f.growth, Math.floor(n / (f.step || 1)));
      default: return NaN;
    }
  }

  // ---------------- 시뮬레이션 ----------------
  /**
   * @param {object} p  프로젝트 (읽기만 함)
   * @param {object} opts { playerId, events: [], days }
   */
  function simulate(p, opts = {}) {
    const days = Math.max(1, Math.round(opts.days || p.sim.days));
    const total = days * DAY;
    const player = p.players.find(x => x.id === (opts.playerId || p.activePlayer)) || p.players[0];
    const onlineMin = player.onlineMin;
    const loginAt = player.loginAt || 0;
    const events = (opts.events || []).filter(e => e.enabled !== false);

    const R = {}, S = {}, T = {};
    const resCap = {}, stateMax = {};
    for (const r of p.resources) { R[r.id] = r.initial || 0; if (r.cap !== null && r.cap !== undefined && r.cap !== '') resCap[r.id] = r.cap; }
    for (const s of p.states) { S[s.id] = s.initial || 0; stateMax[s.id] = (s.max === null || s.max === undefined || s.max === '') ? Infinity : s.max; }

    const mods = p.modules.filter(m => m.enabled !== false);
    const ofType = t => byPriority(mods.filter(m => m.type === t));
    const hunts = ofType('hunt'), idles = ofType('idle'), periodics = ofType('periodic'), dungeons = ofType('dungeon');
    const levelups = ofType('levelup'), upgrades = ofType('upgrade'), progresses = ofType('progress');
    const modById = {}; for (const m of mods) modById[m.id] = m;

    const statLinks = {}, modLinks = {};
    for (const l of (p.links || [])) {
      if (l.enabled === false || !l.target) continue;
      const bucket = l.target.kind === 'stat' ? statLinks : modLinks;
      (bucket[l.target.id] = bucket[l.target.id] || []).push(l);
    }

    const ledger = {};
    for (const r of p.resources) ledger[r.id] = { gain: {}, spend: {} };
    const issues = new Set();
    let guardHit = false;
    const flag = msg => issues.add(msg);

    const reach = {}; for (const s of p.states) reach[s.id] = [];
    const unlockAt = {}; const runs = {}; for (const m of mods) { unlockAt[m.id] = null; runs[m.id] = 0; }
    const counters = {}; for (const m of mods) counters[m.id] = 0;

    const val = id => (id in S) ? S[id] : (id in T) ? T[id] : (id in R) ? R[id] : NaN;

    function linkFactor(l) {
      const x = val(l.ref);
      const n = x - (l.offset || 0);
      let f;
      if (l.mode === 'compound') f = Math.pow(1 + l.value / 100, n);
      else if (l.mode === 'ratio') f = Math.pow(x / (l.base || 1), l.value);
      else f = 1 + (l.value / 100) * n;
      if (l.min !== null && l.min !== undefined && l.min !== '') f = Math.max(l.min, f);
      if (l.max !== null && l.max !== undefined && l.max !== '') f = Math.min(l.max, f);
      return f;
    }
    function recomputeStats() {
      for (const st of p.stats) {
        let add = 0, mult = 1;
        for (const l of statLinks[st.id] || []) {
          if (l.effect === 'add') add += l.value * (S[l.ref] - (l.offset || 0));
          else mult *= linkFactor(l);
        }
        const v = (st.base + add) * mult;
        T[st.id] = v;
        if (!isFinite(v) || Math.abs(v) > LIMIT) flag(`능력치 ‘${st.name}’이(가) 너무 커서 계산할 수 없습니다`);
      }
    }
    function modFactor(m, effect, resourceId) {
      let f = 1;
      for (const l of modLinks[m.id] || []) {
        if (l.effect !== effect) continue;
        if (l.target.resourceId && resourceId && l.target.resourceId !== resourceId) continue;
        f *= linkFactor(l);
      }
      if ((effect === 'cost' || effect === 'duration') && f < 0.05) f = 0.05;
      return f;
    }

    // 이벤트
    const evActive = (ev, t) => { const s = (ev.startDay - 1) * DAY; return t >= s && t < s + ev.days * DAY; };
    const evApplies = ev => !ev.cond || !ev.cond.ref || !(ev.cond.max > 0) || val(ev.cond.ref) <= ev.cond.max;
    function rewardEvent(t, m, resId) {
      let f = 1;
      for (const ev of events) {
        if (ev.type !== 'rewardMult' || !evActive(ev, t) || !evApplies(ev)) continue;
        if (ev.moduleId ? ev.moduleId !== m.id : !ACTIVITY[m.type]) continue;
        if (ev.resourceId && ev.resourceId !== resId) continue;
        f *= ev.value;
      }
      return f;
    }
    function costDiscount(t, m) {
      let keep = 1;
      for (const ev of events) {
        if (ev.type !== 'costDiscount' || !evActive(ev, t) || !evApplies(ev)) continue;
        if (ev.moduleId ? ev.moduleId !== m.id : m.type !== 'upgrade') continue;
        keep *= 1 - ev.value / 100;
      }
      return 1 - keep;
    }

    // 재화 증감
    function gain(resId, src, amt) {
      if (!(resId in R)) return;
      if (!isFinite(amt)) { flag('획득량이 무한대가 되어 계산할 수 없습니다'); return; }
      if (!(amt > 0)) return;
      const L = ledger[resId];
      L.gain[src] = (L.gain[src] || 0) + amt;
      R[resId] += amt;
      if (R[resId] > LIMIT) flag('재화량이 1e300을 넘어 정밀도를 보장할 수 없습니다');
      if (resId in resCap && R[resId] > resCap[resId]) {
        const lost = R[resId] - resCap[resId];
        L.spend.__cap = (L.spend.__cap || 0) + lost;
        R[resId] = resCap[resId];
      }
    }
    function spend(resId, src, amt) {
      const L = ledger[resId];
      L.spend[src] = (L.spend[src] || 0) + amt;
      R[resId] -= amt;
    }
    function costList(m, t) {
      const x = S[m.target];
      const disc = costDiscount(Math.min(t, total - 1), m);
      return (m.cost || []).map(c => {
        let a = evalFormula(c.amount, c.amount && c.amount.ref ? val(c.amount.ref) : x) * modFactor(m, 'cost', c.resourceId);
        if (disc) a = a * (1 - disc);
        return [c.resourceId, a];
      });
    }
    function canPay(list) {
      for (const [id, a] of list) {
        if (!isFinite(a)) return false;
        if (!(R[id] >= a)) return false;
      }
      return true;
    }
    function buyOne(m, t, now) {
      if (S[m.target] >= stateMax[m.target]) return false;
      const list = costList(m, t);
      for (const [, a] of list) if (!isFinite(a)) { flag(`‘${m.name}’ 비용이 무한대입니다`); return false; }
      if (!canPay(list)) return false;
      for (const [id, a] of list) spend(id, m.id, a);
      S[m.target]++;
      counters[m.id]++;
      if (reach[m.target][S[m.target]] === undefined) reach[m.target][S[m.target]] = now;
      return true;
    }
    function isUnlocked(m) {
      return !m.unlock || m.unlock.every(c => !c.ref || val(c.ref) >= c.min);
    }
    function updateUnlocks(now) {
      for (const m of mods) if (unlockAt[m.id] === null && isUnlocked(m)) unlockAt[m.id] = now;
    }
    const unlocked = m => unlockAt[m.id] !== null;

    function runProgress(now) {
      let changed = false;
      for (const m of progresses) {
        if (!unlocked(m)) continue;
        let k = 0;
        while (S[m.target] < stateMax[m.target]) {
          const nextV = S[m.target] + 1;
          const req = evalFormula(m.req, m.req && m.req.ref ? val(m.req.ref) : nextV);
          if (!isFinite(req)) { flag(`‘${m.name}’ ${nextV}단계 요구치가 무한대입니다`); break; }
          if (!(T[m.stat] >= req)) break;
          S[m.target]++; counters[m.id]++; changed = true;
          if (reach[m.target][S[m.target]] === undefined) reach[m.target][S[m.target]] = now;
          if (++k > LOOP_GUARD) { guardHit = true; break; }
        }
      }
      return changed;
    }

    let rrNext = 0;
    function progress(t, now, online) {
      for (let pass = 0; pass < 50; pass++) {
        let changed = false;
        for (const m of levelups) {
          if (!unlocked(m)) continue;
          let k = 0;
          while (buyOne(m, t, now)) { changed = true; if (++k > LOOP_GUARD) { guardHit = true; break; } }
        }
        recomputeStats();
        if (online && player.autoUpgrade) {
          const ups = upgrades.filter(unlocked);
          let k = 0;
          if (player.upgradeMode === 'priority') {
            for (const m of ups) while (buyOne(m, now, now)) { changed = true; if (++k > LOOP_GUARD) { guardHit = true; break; } }
          } else if (ups.length) {
            // 돌아가며 한 단계씩. 다음 차례(rrNext)를 기억해서 골드가 조금씩 들어와도 한 모듈만 사지 않게 한다.
            let miss = 0, i = rrNext % ups.length;
            while (miss < ups.length) {
              if (buyOne(ups[i], now, now)) { changed = true; miss = 0; rrNext = i + 1; }
              else miss++;
              i = (i + 1) % ups.length;
              if (++k > LOOP_GUARD) { guardHit = true; break; }
            }
          }
          recomputeStats();
        }
        if (runProgress(now)) { changed = true; recomputeStats(); }
        updateUnlocks(now);
        if (!changed || guardHit) break;
      }
      if (guardHit) issues.add('한 번에 처리하는 반복 횟수가 한도(10만 회)를 넘었습니다');
    }

    // 주기 보상
    const periodMin = m => m.period === 'weekly' ? 7 * DAY : m.period === 'hours' ? Math.max(1, Math.round((m.everyHours || 24) * 60)) : DAY;
    const mailbox = {};      // 우편함: 모듈별 { resId: amt }
    const loginAvail = {};   // 출석형: 발생한 주기 번호
    const loginClaimed = {};
    function giveRewards(m, src) {
      for (const r of m.rewards || []) {
        const x = r.amount && r.amount.ref ? val(r.amount.ref) : 0;
        const amt = evalFormula(r.amount, x) * modFactor(m, 'reward', r.resourceId);
        if (m.fill === 'refill') {
          const need = amt - R[r.resourceId];
          if (need > 0) gain(r.resourceId, src, need);
        } else gain(r.resourceId, src, amt);
      }
    }
    function addMailbox(m) {
      const box = mailbox[m.id] = mailbox[m.id] || {};
      for (const r of m.rewards || []) {
        const x = r.amount && r.amount.ref ? val(r.amount.ref) : 0;
        box[r.resourceId] = (box[r.resourceId] || 0) + evalFormula(r.amount, x) * modFactor(m, 'reward', r.resourceId);
      }
    }

    // 사냥
    function activeHunt() { return hunts.find(unlocked) || null; }
    function huntPerMin(h, resId, t) {
      const r = (h.rewards || []).find(x => x.resourceId === resId);
      if (!r) return 0;
      const x = r.amount && r.amount.ref ? val(r.amount.ref) : 0;
      return h.killsPerMin * modFactor(h, 'speed') * evalFormula(r.amount, x) * modFactor(h, 'reward', resId);
    }

    // 방치
    const idlePending = {}, idleAccrued = {};
    for (const m of idles) { idlePending[m.id] = {}; idleAccrued[m.id] = 0; }
    const loginGrants = {};  // 접속 시 수령하는 이벤트 지급

    // 던전
    let busy = 0, run = null;
    const runsToday = {};

    const series = [];
    function snapshot(t) {
      const G = {}, X = {};
      for (const id in ledger) { G[id] = sumObj(ledger[id].gain); X[id] = sumObj(ledger[id].spend); }
      series.push({ t, R: { ...R }, S: { ...S }, T: { ...T }, G, X });
    }

    // 초기 상태
    recomputeStats();
    for (const s of p.states) reach[s.id][S[s.id]] = 0;
    updateUnlocks(0);
    if (runProgress(0)) recomputeStats();
    for (const s of p.states) for (let v = 0; v <= S[s.id] && v <= 100000; v++) if (reach[s.id][v] === undefined && v >= (p.states.find(x => x.id === s.id).initial || 0)) reach[s.id][v] = 0;
    updateUnlocks(0);
    snapshot(0);

    for (let t = 0; t < total; t++) {
      const dayStart = t % DAY === 0;
      const sinceLogin = ((t - loginAt) % DAY + DAY) % DAY;
      const loginNow = onlineMin > 0 && sinceLogin === 0;
      const online = onlineMin > 0 && sinceLogin < onlineMin;
      let tick = false;

      // 1) 주기 경계
      for (const m of periodics) {
        const pm = periodMin(m);
        if (t % pm !== 0 || !unlocked(m)) continue;
        tick = true;
        if (m.gen === 'login') loginAvail[m.id] = t / pm;
        else if (m.claim === 'login') addMailbox(m);
        else giveRewards(m, m.id);
      }
      if (dayStart) {
        tick = true;
        for (const id in runsToday) runsToday[id] = 0;
        const day = t / DAY;
        for (const ev of events) {
          if (!evApplies(ev)) continue;
          if (ev.type === 'grant' && ev.startDay - 1 === day) {
            if (ev.claim === 'login') loginGrants[ev.resourceId] = (loginGrants[ev.resourceId] || 0) + ev.value;
            else gain(ev.resourceId, 'event', ev.value);
          }
          if (ev.type === 'dailyGrant' && evActive(ev, t)) gain(ev.resourceId, 'event', ev.value);
        }
      }
      // 2) 접속 시작
      if (loginNow) {
        tick = true;
        for (const m of idles) {
          for (const id in idlePending[m.id]) gain(id, m.id, idlePending[m.id][id]);
          idlePending[m.id] = {}; idleAccrued[m.id] = 0;
        }
        for (const mid in mailbox) { for (const id in mailbox[mid]) gain(id, mid, mailbox[mid][id]); delete mailbox[mid]; }
        for (const id in loginGrants) { gain(id, 'event', loginGrants[id]); delete loginGrants[id]; }
        for (const m of periodics) {
          if (m.gen === 'login' && loginAvail[m.id] !== undefined && loginClaimed[m.id] !== loginAvail[m.id]) {
            loginClaimed[m.id] = loginAvail[m.id];
            giveRewards(m, m.id);
          }
        }
      }
      // 3) 갱신
      if (tick) progress(t, t, online);

      // 4) 접속 중 / 5) 미접속
      if (online) {
        if (busy > 0) {
          busy--;
          if (busy === 0) finishRun(t);
        } else {
          let started = false;
          if (player.useDungeons) {
            const remaining = onlineMin - sinceLogin;
            for (const m of dungeons) {
              if (!unlocked(m)) continue;
              if (m.dailyLimit > 0 && (runsToday[m.id] || 0) >= m.dailyLimit) continue;
              const dur = Math.max(1, Math.round(m.durationMin * modFactor(m, 'duration')));
              if (remaining < dur) continue;
              const list = costList(m, t);
              if (!canPay(list)) continue;
              for (const [id, a] of list) spend(id, m.id, a);
              const amounts = {};
              for (const r of m.rewards || []) {
                const x = r.amount && r.amount.ref ? val(r.amount.ref) : 0;
                amounts[r.resourceId] = (amounts[r.resourceId] || 0) + evalFormula(r.amount, x) * modFactor(m, 'reward', r.resourceId);
              }
              run = { m, amounts };
              runsToday[m.id] = (runsToday[m.id] || 0) + 1;
              busy = dur - 1; started = true;
              if (busy === 0) finishRun(t);
              break;
            }
          }
          if (!started) {
            const h = activeHunt();
            if (h) for (const r of h.rewards || []) gain(r.resourceId, h.id, huntPerMin(h, r.resourceId, t) * rewardEvent(t, h, r.resourceId));
          }
        }
        progress(t + 1, t + 1, true);
      } else {
        for (const m of idles) {
          if (!unlocked(m) || idleAccrued[m.id] >= m.capHours * 60) continue;
          const pend = idlePending[m.id];
          if (m.mode === 'fromHunt') {
            const h = (m.huntId && modById[m.huntId]) || activeHunt();
            if (h && unlocked(h)) for (const r of h.rewards || []) {
              pend[r.resourceId] = (pend[r.resourceId] || 0) + huntPerMin(h, r.resourceId, t) * (m.ratePct / 100) * rewardEvent(t, m, r.resourceId);
            }
          } else {
            for (const r of m.rewards || []) {
              const x = r.amount && r.amount.ref ? val(r.amount.ref) : 0;
              pend[r.resourceId] = (pend[r.resourceId] || 0) + evalFormula(r.amount, x) * modFactor(m, 'reward', r.resourceId) * rewardEvent(t, m, r.resourceId);
            }
          }
          idleAccrued[m.id]++;
          for (const id in pend) if (!isFinite(pend[id])) flag('방치 보상이 무한대가 되어 계산할 수 없습니다');
        }
      }
      if ((t + 1) % 60 === 0) snapshot(t + 1);
    }

    function finishRun(t) {
      for (const id in run.amounts) gain(id, run.m.id, run.amounts[id] * rewardEvent(t, run.m, id));
      runs[run.m.id]++;
      run = null;
    }

    // 결과
    const pendingUnclaimed = {};
    for (const r of p.resources) pendingUnclaimed[r.id] = 0;
    for (const m of idles) for (const id in idlePending[m.id]) pendingUnclaimed[id] += idlePending[m.id][id];
    for (const mid in mailbox) for (const id in mailbox[mid]) pendingUnclaimed[id] += mailbox[mid][id];
    for (const id in loginGrants) pendingUnclaimed[id] += loginGrants[id];

    const check = {};
    for (const r of p.resources) {
      const expected = (r.initial || 0) + sumObj(ledger[r.id].gain) - sumObj(ledger[r.id].spend);
      const diff = Math.abs(expected - R[r.id]);
      check[r.id] = { expected, actual: R[r.id], ok: diff <= 1e-9 * Math.max(1, Math.abs(expected), sumObj(ledger[r.id].gain)) };
    }
    const nextCost = {};
    for (const m of [...levelups, ...upgrades]) {
      nextCost[m.id] = S[m.target] < stateMax[m.target] ? Object.fromEntries((m.cost || []).map(c => [c.resourceId, evalFormula(c.amount, c.amount && c.amount.ref ? val(c.amount.ref) : S[m.target]) * modFactor(m, 'cost', c.resourceId)])) : null;
    }
    return {
      final: { R: { ...R }, S: { ...S }, T: { ...T } },
      series, ledger, reach, unlockAt, runs, counters, nextCost, pendingUnclaimed, check,
      reliable: issues.size === 0 && !guardHit, issues: [...issues],
      totalMin: total, playerId: player.id,
    };
  }

  // 상태 값 v에 처음 도달한 시각 (없으면 null)
  function reachTime(result, stateId, v) {
    const arr = result.reach[stateId];
    if (!arr) return null;
    if (arr[v] !== undefined) return arr[v];
    const s0 = result.series[0].S[stateId];
    return s0 >= v ? 0 : null;
  }

  // ---------------- 검증 ----------------
  function validateProject(p) {
    const errors = [], warnings = [];
    const err = (path, msg) => errors.push({ path, msg });
    const warn = (path, msg) => warnings.push({ path, msg });
    const ids = new Map();
    const reg = (id, kind, path) => {
      if (!id) { err(path, 'ID가 비어 있습니다'); return; }
      if (ids.has(id)) err(path, `ID ‘${id}’가 중복됩니다`);
      ids.set(id, kind);
    };
    p.resources.forEach((r, i) => reg(r.id, 'resource', `resources.${i}`));
    p.states.forEach((s, i) => reg(s.id, 'state', `states.${i}`));
    p.stats.forEach((s, i) => reg(s.id, 'stat', `stats.${i}`));
    p.modules.forEach((m, i) => reg(m.id, 'module', `modules.${i}`));
    const kindOf = id => ids.get(id);
    const num = (v, path, label, min, max) => {
      if (typeof v !== 'number' || !isFinite(v)) { err(path, `${label}: 숫자를 입력하세요`); return false; }
      if (min !== undefined && v < min) { err(path, `${label}: ${min} 이상이어야 합니다`); return false; }
      if (max !== undefined && v > max) { err(path, `${label}: ${max} 이하여야 합니다`); return false; }
      return true;
    };
    const formula = (f, path, label) => {
      if (!f || typeof f !== 'object') { err(path, `${label}: 공식이 없습니다`); return; }
      if (!['const', 'linear', 'exp', 'step'].includes(f.type)) err(path, `${label}: 공식 종류가 올바르지 않습니다`);
      num(f.base, path + '.base', label + ' 기본값');
      if (f.type !== 'const') num(f.growth, path + '.growth', label + ' 증가값', f.type === 'linear' ? undefined : 0);
      if (f.type === 'step') num(f.step, path + '.step', label + ' 단계 크기', 1);
      if (f.ref && kindOf(f.ref) !== 'state' && kindOf(f.ref) !== 'stat') err(path + '.ref', `${label}: 기준 항목이 없습니다`);
    };
    num(p.sim.days, 'sim.days', '시뮬레이션 기간', 1, 365);
    p.resources.forEach((r, i) => {
      if (!r.name) err(`resources.${i}.name`, '재화 이름이 비어 있습니다');
      num(r.initial || 0, `resources.${i}.initial`, `${r.name} 초기값`, 0);
      if (r.cap !== null && r.cap !== undefined && r.cap !== '') num(r.cap, `resources.${i}.cap`, `${r.name} 보유 한도`, 0);
    });
    p.states.forEach((s, i) => {
      if (!s.name) err(`states.${i}.name`, '상태 이름이 비어 있습니다');
      if (num(s.initial, `states.${i}.initial`, `${s.name} 초기값`, 0) && s.max !== null && s.max !== undefined && s.max !== '') {
        if (num(s.max, `states.${i}.max`, `${s.name} 최대값`, 0) && s.initial > s.max) err(`states.${i}.initial`, `${s.name}: 초기값은 최대값(${s.max}) 이하여야 합니다`);
      }
    });
    p.stats.forEach((s, i) => { if (!s.name) err(`stats.${i}.name`, '능력치 이름이 비어 있습니다'); num(s.base, `stats.${i}.base`, `${s.name} 기본값`); });
    const used = new Set();
    const sources = new Set();
    p.modules.forEach((m, i) => {
      const P = `modules.${i}`;
      const L = m.name || m.type;
      (m.unlock || []).forEach((c, j) => {
        if (!kindOf(c.ref)) err(`${P}.unlock.${j}`, `${L}: 해금 조건 항목이 없습니다`);
        num(c.min, `${P}.unlock.${j}.min`, `${L} 해금 기준값`);
        const st = p.states.find(s => s.id === c.ref);
        if (st && st.max !== null && st.max !== undefined && st.max !== '' && c.min > st.max) warn(`${P}.unlock.${j}`, `${L}: 해금 기준(${c.min})이 ${st.name} 최대값(${st.max})보다 커서 해금되지 않습니다`);
      });
      const rewards = (m.rewards || []);
      rewards.forEach((r, j) => {
        if (kindOf(r.resourceId) !== 'resource') err(`${P}.rewards.${j}`, `${L}: 보상 재화를 선택하세요`);
        else { used.add(r.resourceId); sources.add(r.resourceId); }
        formula(r.amount, `${P}.rewards.${j}.amount`, `${L} 보상`);
      });
      (m.cost || []).forEach((c, j) => {
        if (kindOf(c.resourceId) !== 'resource') err(`${P}.cost.${j}`, `${L}: 비용 재화를 선택하세요`);
        else used.add(c.resourceId);
        formula(c.amount, `${P}.cost.${j}.amount`, `${L} 비용`);
      });
      if (m.type === 'hunt') num(m.killsPerMin, `${P}.killsPerMin`, `${L} 분당 처치 수`, 0);
      if (m.type === 'idle') {
        num(m.capHours, `${P}.capHours`, `${L} 최대 누적 시간`, 0, 24 * 7);
        if (m.mode === 'fromHunt') {
          num(m.ratePct, `${P}.ratePct`, `${L} 방치 효율`, 0);
          if (m.huntId && kindOf(m.huntId) !== 'module') err(`${P}.huntId`, `${L}: 기준 사냥터가 없습니다`);
          const h = p.modules.find(x => x.id === m.huntId) || p.modules.find(x => x.type === 'hunt');
          if (h) (h.rewards || []).forEach(r => sources.add(r.resourceId));
        }
      }
      if (m.type === 'periodic' && m.period === 'hours') num(m.everyHours, `${P}.everyHours`, `${L} 주기`, 0.1);
      if (m.type === 'dungeon') {
        num(m.durationMin, `${P}.durationMin`, `${L} 소요 시간`, 1, 1440);
        if (m.dailyLimit !== null && m.dailyLimit !== undefined && m.dailyLimit !== '') num(m.dailyLimit, `${P}.dailyLimit`, `${L} 하루 횟수`, 0);
      }
      if (m.type === 'levelup' || m.type === 'upgrade' || m.type === 'progress') {
        if (kindOf(m.target) !== 'state') err(`${P}.target`, `${L}: 대상 상태를 선택하세요`);
      }
      if ((m.type === 'levelup' || m.type === 'upgrade') && !(m.cost || []).length) err(`${P}.cost`, `${L}: 비용을 하나 이상 지정하세요`);
      if (m.type === 'progress') {
        if (kindOf(m.stat) !== 'stat') err(`${P}.stat`, `${L}: 비교할 능력치를 선택하세요`);
        formula(m.req, `${P}.req`, `${L} 요구치`);
      }
    });
    (p.links || []).forEach((l, i) => {
      const P = `links.${i}`;
      const rk = kindOf(l.ref);
      if (!rk || rk === 'module' || rk === 'resource') err(P + '.ref', `연결 규칙 ${i + 1}: 참조할 상태나 능력치를 선택하세요`);
      if (!l.target || !kindOf(l.target.id)) err(P + '.target', `연결 규칙 ${i + 1}: 적용 대상을 선택하세요`);
      else if (l.target.kind === 'stat') {
        if (kindOf(l.target.id) !== 'stat') err(P + '.target', `연결 규칙 ${i + 1}: 대상 능력치가 없습니다`);
        if (rk === 'stat') err(P + '.ref', `연결 규칙 ${i + 1}: 능력치끼리는 연결할 수 없습니다 (순환 참조 방지). 상태를 참조하세요`);
        if (!['add', 'mult'].includes(l.effect)) err(P + '.effect', `연결 규칙 ${i + 1}: 능력치에는 가산·배율만 쓸 수 있습니다`);
      } else {
        if (!['reward', 'cost', 'speed', 'duration'].includes(l.effect)) err(P + '.effect', `연결 규칙 ${i + 1}: 효과를 선택하세요`);
      }
      num(l.value, P + '.value', `연결 규칙 ${i + 1} 변화량`);
      if (l.mode === 'ratio') num(l.base, P + '.base', `연결 규칙 ${i + 1} 기준값`, 1e-12);
    });
    if (!p.players.length) err('players', '유저 모델이 하나 이상 필요합니다');
    p.players.forEach((pl, i) => num(pl.onlineMin, `players.${i}.onlineMin`, `${pl.name} 접속 시간`, 0, 1440));
    (p.events || []).forEach((ev, i) => {
      const P = `events.${i}`, L = `이벤트 ${i + 1}`;
      if (num(ev.startDay, P + '.startDay', `${L} 시작 일 차`, 1) && ev.startDay > p.sim.days) err(P + '.startDay', `${L}: 시작 일 차는 기간(${p.sim.days}일) 이하여야 합니다`);
      if (ev.type !== 'grant') num(ev.days, P + '.days', `${L} 기간`, 1, 365);
      num(ev.value, P + '.value', `${L} 수치`, 0, ev.type === 'costDiscount' ? 100 : undefined);
      if ((ev.type === 'grant' || ev.type === 'dailyGrant') && kindOf(ev.resourceId) !== 'resource') err(P + '.resourceId', `${L}: 지급할 재화를 선택하세요`);
    });
    p.resources.forEach((r, i) => {
      if (!used.has(r.id) && !(p.events || []).some(e => e.resourceId === r.id)) warn(`resources.${i}`, `재화 ‘${r.name}’은(는) 어느 모듈에서도 쓰이지 않습니다`);
      else if (!sources.has(r.id) && !(r.initial > 0) && !(p.events || []).some(e => e.resourceId === r.id)) warn(`resources.${i}`, `재화 ‘${r.name}’은(는) 소모처만 있고 수급처가 없습니다`);
    });
    return { errors, warnings };
  }

  // ---------------- v1 → v2 변환 ----------------
  function fromV1(v1, v1Events = []) {
    const d = v1.dungeons;
    const unlockRef = { level: 'st_level', stage: 'st_stage', atk: 'stat_atk' };
    const resources = [
      { id: 'res_gold', name: '골드', unit: 'G', initial: v1.start.gold, cap: null },
      { id: 'res_exp', name: '경험치', unit: 'EXP', initial: 0, cap: null },
      ...d.map((x, i) => ({ id: 'res_ticket' + i, name: x.name + ' 입장권', unit: '장', initial: 0, cap: null })),
    ];
    const resOf = cur => cur === 'gold' ? 'res_gold' : 'res_exp';
    const modules = [
      { id: 'm_hunt', type: 'hunt', name: '자동사냥', priority: 0, unlock: [], killsPerMin: v1.hunt.killsPerMin, rewards: [
        { resourceId: 'res_gold', amount: { type: 'exp', base: v1.hunt.goldPerKill, growth: v1.hunt.rewardGrowth, ref: 'st_stage', offset: 1 } },
        { resourceId: 'res_exp', amount: { type: 'exp', base: v1.hunt.expPerKill, growth: v1.hunt.rewardGrowth, ref: 'st_stage', offset: 1 } },
      ] },
      { id: 'm_idle', type: 'idle', name: '오프라인 방치', priority: 0, unlock: [], mode: 'fromHunt', huntId: 'm_hunt', ratePct: v1.offline.ratePct, capHours: v1.offline.capHours, rewards: [] },
      { id: 'm_daily', type: 'periodic', name: '일일 보상', priority: 0, unlock: [], period: 'daily', gen: 'login', claim: 'instant', fill: 'add', rewards: [
        { resourceId: 'res_gold', amount: { type: 'const', base: v1.daily.gold } },
        { resourceId: 'res_exp', amount: { type: 'const', base: v1.daily.exp } },
      ] },
      ...d.map((x, i) => ({ id: 'm_ticket' + i, type: 'periodic', name: x.name + ' 입장권 충전', priority: 0, unlock: [], period: 'daily', gen: 'auto', claim: 'instant', fill: 'refill', rewards: [
        { resourceId: 'res_ticket' + i, amount: { type: 'const', base: x.ticketsPerDay } },
      ] })),
      ...d.map((x, i) => ({ id: 'm_dungeon' + i, type: 'dungeon', name: x.name, priority: d.length - i, unlock: [{ ref: unlockRef[x.unlockType], min: x.unlockValue }],
        cost: [{ resourceId: 'res_ticket' + i, amount: { type: 'const', base: 1 } }], durationMin: x.runMin, dailyLimit: null, rewards: [
          { resourceId: resOf(x.reward), amount: { type: 'step', base: x.rewardBase, growth: x.rewardGrowth, step: x.tierStages, ref: 'st_stage', offset: 1 } },
        ] })),
      { id: 'm_level', type: 'levelup', name: '레벨업', priority: 0, unlock: [], target: 'st_level', cost: [
        { resourceId: 'res_exp', amount: { type: 'exp', base: v1.level.expBase, growth: v1.level.expGrowth, offset: 1 } },
      ] },
      { id: 'm_enh', type: 'upgrade', name: '공격력 강화', priority: 0, unlock: [], target: 'st_enh', cost: [
        { resourceId: 'res_gold', amount: { type: 'exp', base: v1.enhance.costBase, growth: v1.enhance.costGrowth, offset: 0 } },
      ] },
      { id: 'm_stage', type: 'progress', name: '스테이지 진행', priority: 0, unlock: [], target: 'st_stage', stat: 'stat_atk',
        req: { type: 'exp', base: v1.stage.reqAtkBase, growth: v1.stage.reqAtkGrowth, offset: 1 } },
    ];
    const events = [];
    v1Events.forEach((ev, i) => {
      const base = { id: 'ev' + i, name: '', enabled: ev.enabled !== false, startDay: ev.startDay, days: ev.days || 1,
        cond: ev.levelMax > 0 ? { ref: 'st_level', max: ev.levelMax } : null, claim: 'instant', moduleId: '' };
      if (ev.type === 'grant') events.push({ ...base, type: 'grant', resourceId: resOf(ev.currency), value: ev.value });
      else if (ev.type === 'goldMult') events.push({ ...base, type: 'rewardMult', resourceId: 'res_gold', value: ev.value });
      else if (ev.type === 'expMult') events.push({ ...base, type: 'rewardMult', resourceId: 'res_exp', value: ev.value });
      else if (ev.type === 'discount') events.push({ ...base, type: 'costDiscount', resourceId: '', value: ev.value });
      else if (ev.type === 'tickets') d.forEach((x, j) => events.push({ ...base, id: 'ev' + i + '_' + j, type: 'dailyGrant', resourceId: 'res_ticket' + j, value: ev.value }));
    });
    return {
      schema: 2, id: 'p_v1', name: 'v1에서 옮긴 프로젝트', genre: 'idle-rpg', description: '',
      sim: { days: v1.sim.days },
      resources,
      states: [
        { id: 'st_level', name: '레벨', initial: v1.start.level, max: v1.level.maxLevel },
        { id: 'st_enh', name: '강화 단계', initial: 0, max: v1.enhance.maxEnh },
        { id: 'st_stage', name: '스테이지', initial: 1, max: v1.stage.maxStage },
      ],
      stats: [{ id: 'stat_atk', name: '공격력', base: v1.atk.base, unit: '' }],
      modules,
      links: [
        { id: 'l_lv_atk', ref: 'st_level', target: { kind: 'stat', id: 'stat_atk' }, effect: 'add', mode: 'linear', value: v1.atk.perLevel, offset: 1 },
        { id: 'l_enh_atk', ref: 'st_enh', target: { kind: 'stat', id: 'stat_atk' }, effect: 'mult', mode: 'compound', value: v1.atk.enhancePct, offset: 0 },
      ],
      players: [{ id: 'pl_v1', name: '유저', onlineMin: v1.player.onlineMin, loginAt: 0, useDungeons: v1.player.useDungeons, autoUpgrade: v1.player.autoEnhance, upgradeMode: 'roundRobin' }],
      activePlayer: 'pl_v1',
      events,
    };
  }

  const api = { simulate, reachTime, validateProject, evalFormula, fromV1, clone, DAY };
  root.AB = Object.assign(root.AB || {}, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
