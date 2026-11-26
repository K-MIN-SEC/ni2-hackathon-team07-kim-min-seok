/* 오토 밸런싱 v2 — 화면
 * 프로젝트 홈 → 설정 마법사(새 프로젝트) → 밸런싱 워크스페이스
 * 계산은 engine.js / optimize.js, 프리셋은 presets.js
 */
(function () {
  'use strict';
  const AB = window.AB, PR = window.ABPresets;
  const DAY = 1440;
  const $ = s => document.querySelector(s);
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sumObj = o => Object.values(o || {}).reduce((a, b) => a + b, 0);
  const PALETTE = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#0891b2', '#db2777', '#ca8a04'];
  const SRC_COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#64748b', '#ef4444', '#0891b2', '#db2777', '#ca8a04', '#84cc16'];

  // ---------------- 표기 ----------------
  function fmt(n) {
    if (n === null || n === undefined || !isFinite(n)) return n === Infinity ? '∞' : '—';
    const a = Math.abs(n), s = n < 0 ? '-' : '';
    for (const [v, u] of [[1e16, '경'], [1e12, '조'], [1e8, '억'], [1e4, '만']]) if (a >= v) {
      const x = a / v;
      return s + (x >= 100 ? Math.round(x).toLocaleString('ko-KR') : x.toFixed(x >= 10 ? 1 : 2).replace(/\.?0+$/, '')) + u;
    }
    return s + (a >= 100 ? Math.round(a).toLocaleString('ko-KR') : a >= 10 ? (Math.round(a * 100) / 100).toLocaleString('ko-KR') : (Math.round(a * 10000) / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 4 }));
  }
  function fmtDur(min) {
    if (min === null || min === undefined) return '기간 내 미도달';
    if (min === Infinity) return '도달 못 함';
    if (min === 0) return '시작 즉시';
    const d = Math.floor(min / DAY), h = Math.floor((min % DAY) / 60), m = Math.round(min % 60);
    return [d ? d + '일' : '', h ? h + '시간' : '', m ? m + '분' : ''].filter(Boolean).join(' ');
  }
  function fmtDurDiff(a, b) {
    if (a === null || b === null || a === undefined || b === undefined || !isFinite(a) || !isFinite(b)) return '';
    const d = b - a;
    return d === 0 ? '변화 없음' : fmtDur(Math.abs(d)) + (d < 0 ? ' 빨라짐' : ' 늦어짐');
  }
  function fmtDelta(a, b) {
    if (!isFinite(a) || !isFinite(b)) return '';
    const d = b - a;
    if (Math.abs(d) < 1e-9) return '0';
    const pct = a !== 0 ? ` (${d > 0 ? '+' : ''}${(d / Math.abs(a) * 100).toFixed(1)}%)` : '';
    return (d > 0 ? '+' : '') + fmt(d) + pct;
  }
  const fmtErr = d => !isFinite(d) ? '—' : d === 0 ? '0 (정확히 일치)' : (d > 0 ? '+' : '−') + fmtDur(Math.abs(d));
  const fmtPct = v => v === null || v === undefined || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + v.toFixed(1) + '%';

  // ---------------- 이름표 ----------------
  const MOD_TYPES = {
    hunt: { name: '자동사냥', kind: 'source', desc: '접속 중 매 분 보상. 해금된 사냥터 중 우선순위가 가장 높은 1곳을 이용합니다.' },
    idle: { name: '오프라인 방치', kind: 'source', desc: '미접속 중 최대 누적 시간까지 쌓이고, 실제로 접속할 때 받습니다.' },
    periodic: { name: '주기 보상', kind: 'source', desc: '매일·매주·N시간마다 발생. 출석형(접속 시) / 자동 지급(즉시·우편함) / 충전형을 고릅니다.' },
    dungeon: { name: '던전', kind: 'source', desc: '접속 중 비용(입장권 등)과 시간을 써서 보상을 받습니다. 사냥보다 먼저 이용합니다.' },
    levelup: { name: '레벨업', kind: 'sink', desc: '비용 재화가 충분하면 접속과 상관없이 자동으로 대상 상태를 올립니다.' },
    upgrade: { name: '강화', kind: 'sink', desc: '접속 중, 유저 정책이 켜져 있으면 비용을 내고 대상 상태를 올립니다. 무엇이 좋아지는지는 연결 규칙으로 정합니다.' },
    progress: { name: '진행', kind: 'sink', desc: '능력치가 다음 단계 요구치 이상이면 대상 상태(스테이지 등)가 자동으로 오릅니다.' },
  };
  const FORMULA_TYPES = [['const', '고정값'], ['linear', '선형 (기본 + 증가량 × n)'], ['exp', '지수 (기본 × 배율^n)'], ['step', '계단 (기본 × 배율^⌊n÷단계⌋)']];
  const EVENT_TYPES = {
    grant: { name: '재화 지급', unit: '' },
    rewardMult: { name: '보상 배율', unit: '×' },
    costDiscount: { name: '비용 할인', unit: '%' },
    dailyGrant: { name: '매일 추가 지급', unit: '' },
  };
  const EFFECTS = {
    add: '능력치 가산', mult: '능력치 배율', reward: '보상량 증감', cost: '비용 증감', speed: '처치 속도', duration: '소요 시간',
  };

  // ---------------- 저장소 ----------------
  const Store = {
    key: id => 'ab2.p.' + id,
    index() { try { return JSON.parse(localStorage.getItem('ab2.index') || '[]'); } catch (e) { return memIndex; } },
    setIndex(list) { memIndex = list; try { localStorage.setItem('ab2.index', JSON.stringify(list)); } catch (e) { /* 저장 불가 환경 */ } },
    load(id) {
      try { const raw = localStorage.getItem(this.key(id)); if (raw) return JSON.parse(raw); } catch (e) { /* 무시 */ }
      return memProjects[id] ? clone(memProjects[id]) : null;
    },
    save(p) {
      p.updatedAt = new Date().toISOString();
      memProjects[p.id] = clone(p);
      try { localStorage.setItem(this.key(p.id), JSON.stringify(p)); } catch (e) { /* 무시 */ }
      const list = this.index().filter(x => x.id !== p.id);
      list.unshift({ id: p.id, name: p.name, genre: p.genre, updatedAt: p.updatedAt, setupDone: !!(p.meta && p.meta.setupDone), step: p.meta ? p.meta.wizardStep : 0, sample: !!(p.meta && p.meta.sample) });
      this.setIndex(list);
    },
    remove(id) {
      delete memProjects[id];
      try { localStorage.removeItem(this.key(id)); } catch (e) { /* 무시 */ }
      this.setIndex(this.index().filter(x => x.id !== id));
    },
  };
  let memIndex = [], memProjects = {};
  let saveTimer = null;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (project) { Store.save(project); setSaved(); } }, 300); }
  function setSaved() { const el = $('#saveState'); if (el) el.textContent = '자동 저장됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  // ---------------- 상태 ----------------
  let project = null;
  let route = { view: 'home' };
  let sim = { base: null, evt: null, errors: [], warnings: [], ms: 0, stale: true };
  let goalResult = null, goalRunning = false, goalFilter = '';
  let liveRenderers = [];

  const ui = () => (project.meta.ui = project.meta.ui || {});
  const resName = id => (project.resources.find(r => r.id === id) || {}).name || '(없음)';
  const resUnit = id => (project.resources.find(r => r.id === id) || {}).unit || '';
  const anyName = id => {
    const all = [...project.resources, ...project.states, ...project.stats, ...project.modules];
    return (all.find(x => x.id === id) || {}).name || '(없음)';
  };
  const activePlayer = () => project.players.find(p => p.id === project.activePlayer) || project.players[0];
  const mainState = () => {
    const lv = project.modules.find(m => m.type === 'levelup' && m.target);
    return (lv && project.states.find(s => s.id === lv.target)) || project.states[0] || null;
  };
  function uid(prefix, list) {
    let id;
    do { id = prefix + '_' + Math.random().toString(36).slice(2, 7); } while (list.some(x => x.id === id));
    return id;
  }

  // ---------------- 경로 읽기·쓰기 ----------------
  function resolvePath(obj, path) {
    const seg = path.split('.');
    let o = obj;
    for (let i = 0; i < seg.length - 1; i++) {
      const s = seg[i];
      o = s[0] === '#' ? (Array.isArray(o) ? o.find(x => x.id === s.slice(1)) : undefined) : o[s];
      if (o === undefined || o === null) return null;
    }
    return { o, k: seg[seg.length - 1] };
  }
  function getPath(path) {
    const r = resolvePath(project, path);
    if (!r) return undefined;
    if (r.k[0] === '#' && Array.isArray(r.o)) return r.o.find(x => x.id === r.k.slice(1));
    return r.o[r.k];
  }
  function setPath(path, v) { const r = resolvePath(project, path); if (r) r.o[r.k] = v; }
  // 검증 오류 경로(인덱스 기반)를 화면 경로(ID 기반)로 바꾼다
  function idPath(p) {
    const seg = p.split('.');
    if (['resources', 'states', 'stats', 'modules', 'links', 'players', 'events'].includes(seg[0]) && /^\d+$/.test(seg[1] || '')) {
      const item = project[seg[0]][+seg[1]];
      if (item && item.id) seg[1] = '#' + item.id;
    }
    return seg.join('.');
  }

  // ---------------- 참조 찾기·정리 ----------------
  function findRefs(id) {
    const out = [];
    for (const m of project.modules) {
      if (m.id === id) continue;
      const n = `모듈 ‘${m.name}’`;
      (m.unlock || []).forEach(c => { if (c.ref === id) out.push(n + '의 해금 조건'); });
      (m.rewards || []).forEach(r => { if (r.resourceId === id) out.push(n + '의 보상'); if (r.amount && r.amount.ref === id) out.push(n + ' 보상 공식'); });
      (m.cost || []).forEach(c => { if (c.resourceId === id) out.push(n + '의 비용'); if (c.amount && c.amount.ref === id) out.push(n + ' 비용 공식'); });
      if (m.target === id) out.push(n + '의 대상 상태');
      if (m.stat === id) out.push(n + '의 비교 능력치');
      if (m.huntId === id) out.push(n + '의 기준 사냥터');
      if (m.req && m.req.ref === id) out.push(n + ' 요구치 공식');
    }
    project.links.forEach((l, i) => { if (l.ref === id || (l.target && (l.target.id === id || l.target.resourceId === id))) out.push(`연결 규칙 ${i + 1}`); });
    project.events.forEach((e, i) => { if (e.resourceId === id || e.moduleId === id || (e.cond && e.cond.ref === id)) out.push(`이벤트 ‘${e.name || i + 1}’`); });
    return out;
  }
  function removeRefs(id) {
    for (const m of project.modules) {
      m.unlock = (m.unlock || []).filter(c => c.ref !== id);
      if (m.rewards) m.rewards = m.rewards.filter(r => r.resourceId !== id);
      if (m.cost) m.cost = m.cost.filter(c => c.resourceId !== id);
      for (const f of [...(m.rewards || []).map(r => r.amount), ...(m.cost || []).map(c => c.amount), m.req]) if (f && f.ref === id) f.ref = '';
      if (m.target === id) m.target = '';
      if (m.stat === id) m.stat = '';
      if (m.huntId === id) m.huntId = '';
    }
    project.links = project.links.filter(l => !(l.ref === id || (l.target && l.target.id === id)));
    project.links.forEach(l => { if (l.target && l.target.resourceId === id) l.target.resourceId = ''; });
    project.events = project.events.filter(e => !(e.resourceId === id && (e.type === 'grant' || e.type === 'dailyGrant')) && e.moduleId !== id);
    project.events.forEach(e => { if (e.resourceId === id) e.resourceId = ''; if (e.cond && e.cond.ref === id) e.cond = null; });
  }
  function deleteEntity(coll, id) {
    const item = project[coll].find(x => x.id === id);
    if (!item) return;
    const refs = findRefs(id);
    const msg = refs.length
      ? `‘${item.name}’을(를) 다른 곳에서 참조하고 있습니다.\n\n${[...new Set(refs)].slice(0, 12).map(r => '· ' + r).join('\n')}\n\n삭제하면 위 참조(보상·비용 줄, 해금 조건, 연결 규칙, 관련 이벤트)도 함께 정리됩니다. 삭제할까요?`
      : `‘${item.name}’을(를) 삭제할까요?`;
    if (!confirm(msg)) return;
    removeRefs(id);
    project[coll] = project[coll].filter(x => x.id !== id);
    if (coll === 'players' && project.activePlayer === id) project.activePlayer = (project.players[0] || {}).id;
    changed(true);
  }

  // ---------------- 새 항목 ----------------
  const QUICK = {
    resources: [['골드', 'G', 0], ['경험치', 'EXP', 0], ['루비', '개', 0], ['마력석', '개', 0], ['입장권', '장', 0]],
    states: [['레벨', 1, 300], ['강화 단계', 0, 1000], ['스킬 레벨', 0, 50], ['스테이지', 1, 1000]],
    stats: [['공격력', 10, ''], ['체력', 100, ''], ['치명타율', 5, '%']],
  };
  function addResource(name, unit, initial) { project.resources.push({ id: uid('res', project.resources), name: name || '새 재화', unit: unit || '', initial: initial || 0, cap: null }); }
  function addState(name, initial, max) { project.states.push({ id: uid('st', project.states), name: name || '새 상태', initial: initial === undefined ? 0 : initial, max: max === undefined ? 100 : max }); }
  function addStat(name, base, unit) { project.stats.push({ id: uid('stat', project.stats), name: name || '새 능력치', base: base === undefined ? 0 : base, unit: unit || '' }); }
  const findRes = re => project.resources.find(r => re.test(r.name));
  const firstRes = () => project.resources[0] ? project.resources[0].id : '';
  function newModule(type, tpl) {
    const r0 = firstRes();
    const gold = (findRes(/골드|gold|메소/i) || {}).id || r0;
    const exp = (findRes(/경험치|exp/i) || {}).id || r0;
    const ticket = (findRes(/입장권|티켓|ticket/i) || {}).id || r0;
    const lv = (project.states.find(s => /레벨|level/i.test(s.name) && !/스킬/.test(s.name)) || project.states[0] || {}).id || '';
    const st0 = (project.states.find(s => s.id !== lv) || project.states[0] || {}).id || '';
    const stat0 = (project.stats[0] || {}).id || '';
    const base = { id: uid('m', project.modules), type, name: MOD_TYPES[type].name, enabled: true, priority: 0, unlock: [] };
    const C = v => ({ type: 'const', base: v });
    let m;
    switch (type) {
      case 'hunt': m = { ...base, killsPerMin: 6, rewards: [{ resourceId: gold, amount: C(10) }] }; break;
      case 'idle': m = { ...base, mode: 'fromHunt', huntId: (project.modules.find(x => x.type === 'hunt') || {}).id || '', ratePct: 30, capHours: 8, rewards: [] }; break;
      case 'periodic': m = { ...base, name: '출석 보상', period: 'daily', everyHours: 24, gen: 'login', claim: 'instant', fill: 'add', rewards: [{ resourceId: gold, amount: C(500) }] }; break;
      case 'dungeon': m = { ...base, priority: 1, cost: ticket ? [{ resourceId: ticket, amount: C(1) }] : [], durationMin: 3, dailyLimit: null, rewards: [{ resourceId: gold, amount: C(5000) }] }; break;
      case 'levelup': m = { ...base, target: lv, cost: [{ resourceId: exp, amount: { type: 'exp', base: 100, growth: 1.1, offset: 1 } }] }; break;
      case 'upgrade': m = { ...base, target: st0, cost: [{ resourceId: gold, amount: { type: 'exp', base: 100, growth: 1.07, offset: 0 } }] }; break;
      case 'progress': m = { ...base, name: '스테이지 진행', target: (project.states.find(s => /스테이지|stage/i.test(s.name)) || {}).id || st0, stat: stat0, req: { type: 'exp', base: 10, growth: 1.1, offset: 1 } }; break;
    }
    if (tpl === 'mail') Object.assign(m, { name: '자동 지급 (우편함)', gen: 'auto', claim: 'login' });
    if (tpl === 'charge') Object.assign(m, { name: '입장권 충전', gen: 'auto', claim: 'instant', fill: 'refill', rewards: [{ resourceId: ticket, amount: C(2) }] });
    project.modules.push(m);
    return m;
  }
  function newLink() {
    const ref = (project.states[0] || {}).id || '';
    const stat = project.stats[0];
    project.links.push({ id: uid('l', project.links), ref, target: stat ? { kind: 'stat', id: stat.id } : { kind: 'module', id: (project.modules[0] || {}).id || '', resourceId: '' }, effect: stat ? 'add' : 'reward', mode: 'linear', value: 1, offset: 0, base: 1, min: null, max: null, enabled: true });
  }
  function newEvent(type) {
    const ev = { id: uid('ev', project.events), name: '', enabled: true, type: type || 'rewardMult', startDay: 1, days: 3, resourceId: '', moduleId: '', value: 2, claim: 'instant', cond: null };
    if (ev.type === 'grant' || ev.type === 'dailyGrant') { ev.resourceId = firstRes(); ev.value = ev.type === 'grant' ? 100000 : 1; }
    if (ev.type === 'costDiscount') ev.value = 30;
    project.events.push(ev);
  }

  // ---------------- 편집 처리 ----------------
  function changed(rerender) {
    saveSoon();
    if (goalResult) goalResult.stale = true;
    scheduleSim();
    if (rerender) rerenderKeepScroll();
  }
  function rerenderKeepScroll() { const y = window.scrollY; render(); window.scrollTo(0, y); }
  function readInput(el) {
    const t = el.dataset.type;
    if (t === 'bool') return el.checked;
    if (t === 'num') return el.value === '' ? NaN : Number(el.value);
    if (t === 'numnull') return el.value === '' ? null : Number(el.value);
    if (t === 'hours') return el.value === '' ? NaN : Math.round(Number(el.value) * 60);
    if (t === 'selnum') return Number(el.value);
    return el.value;
  }
  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    const isSel = el.tagName === 'SELECT' || el.type === 'checkbox';
    if (e.type === 'input' && isSel) return;
    if (e.type === 'change' && !isSel) return;
    const path = el.dataset.path;
    if (el.dataset.special) { const rr = special(el.dataset.special, path, el); changed(rr !== false); return; }
    setPath(path, readInput(el));
    if (/\.(amount|req)\.type$/.test(path)) normalizeFormula(getPath(path.replace(/\.type$/, '')));
    if (path === 'name' || /^(resources|states|stats)\.#[^.]+\.name$/.test(path)) { /* 이름 변경은 다른 곳 표시에도 반영 */ }
    changed(el.dataset.rerender === '1');
  }
  function normalizeFormula(f) {
    if (!f) return;
    if (f.type !== 'const' && (typeof f.growth !== 'number' || !isFinite(f.growth))) f.growth = f.type === 'linear' ? 0 : 1.1;
    if (f.type === 'step' && !(f.step >= 1)) f.step = 10;
    if (typeof f.offset !== 'number') f.offset = 0;
  }
  function special(kind, path, el) {
    if (kind === 'link-target') {
      const l = getPath(path);
      const [k, id] = el.value.split(':');
      l.target = { kind: k, id, resourceId: '' };
      l.effect = k === 'stat' ? 'add' : 'reward';
      if (k === 'stat' && project.stats.some(s => s.id === l.ref)) l.ref = (project.states[0] || {}).id || '';
    } else if (kind === 'cond-ref') {
      const ev = getPath(path);
      ev.cond = el.value ? { ref: el.value, max: (ev.cond && ev.cond.max) || 100 } : null;
    } else if (kind === 'cond-max') {
      const ev = getPath(path);
      if (ev.cond) ev.cond.max = Number(el.value);
      return false;
    }
  }

  // ---------------- 시뮬레이션 ----------------
  let simTimer = null;
  function scheduleSim() { clearTimeout(simTimer); simTimer = setTimeout(runSim, 220); }
  function runSim() {
    if (!project) return;
    const v = AB.validateProject(project);
    sim.errors = v.errors; sim.warnings = v.warnings;
    markInvalid();
    if (v.errors.length) { sim.stale = true; renderLive(); return; }
    const t0 = performance.now();
    try {
      const pl = activePlayer();
      const evs = project.events.filter(e => e.enabled !== false);
      sim.base = AB.simulate(project, { playerId: pl.id });
      sim.evt = evs.length ? AB.simulate(project, { playerId: pl.id, events: evs }) : null;
      sim.events = clone(evs);
      sim.player = clone(pl);
      sim.projectSnap = clone(project);
      sim.stale = false;
    } catch (e) {
      sim.stale = true;
      sim.errors = [{ path: '', msg: '계산 중 오류가 났습니다: ' + e.message }];
      console.error(e);
    }
    sim.ms = performance.now() - t0;
    renderLive();
  }
  function renderLive() { for (const f of liveRenderers) { try { f(); } catch (e) { console.error(e); } } }
  function markInvalid() {
    document.querySelectorAll('.field.invalid').forEach(el => { el.classList.remove('invalid'); el.removeAttribute('title'); });
    for (const e of sim.errors) {
      const el = document.querySelector(`[data-path="${CSS.escape(idPath(e.path))}"]`);
      const f = el && el.closest('.field');
      if (f) { f.classList.add('invalid'); f.title = e.msg; }
    }
  }

  // ---------------- 입력 부품 ----------------
  function numF(path, label, value, o = {}) {
    const v = value === null || value === undefined || (typeof value === 'number' && !isFinite(value)) ? '' : (o.hours ? value / 60 : value);
    return `<div class="field ${o.cls || ''}"><label>${esc(label)}</label><div class="input-wrap"><input type="number" inputmode="decimal" step="${o.step || 'any'}" data-path="${esc(path)}" data-type="${o.hours ? 'hours' : o.nullable ? 'numnull' : 'num'}" value="${esc(v)}" ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}>${o.unit ? `<span class="unit">${esc(o.unit)}</span>` : ''}</div>${o.help ? `<div class="help">${esc(o.help)}</div>` : ''}</div>`;
  }
  function textF(path, label, value, o = {}) {
    return `<div class="field ${o.cls || ''}"><label>${esc(label)}</label><div class="input-wrap"><input type="text" data-path="${esc(path)}" data-type="text" value="${esc(value)}" ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}></div></div>`;
  }
  function selF(path, label, value, options, o = {}) {
    const opts = options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value === null || value === undefined ? '' : value) ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const missing = value && !options.some(([v]) => String(v) === String(value)) ? `<option value="${esc(value)}" selected>(삭제된 항목)</option>` : '';
    return `<div class="field ${o.cls || ''}"><label>${esc(label)}</label><div class="input-wrap"><select data-path="${esc(path)}" data-type="${o.num ? 'selnum' : 'sel'}" ${o.rerender ? 'data-rerender="1"' : ''} ${o.special ? `data-special="${o.special}"` : ''}>${missing}${opts}</select></div>${o.help ? `<div class="help">${esc(o.help)}</div>` : ''}</div>`;
  }
  function checkF(path, label, value, o = {}) {
    return `<div class="field ${o.cls || ''}"><label class="check"><input type="checkbox" data-path="${esc(path)}" data-type="bool" ${value ? 'checked' : ''} ${o.rerender ? 'data-rerender="1"' : ''}> ${esc(label)}</label></div>`;
  }
  const resOpts = (blank) => [...(blank ? [['', blank]] : []), ...project.resources.map(r => [r.id, r.name])];
  const stateOpts = (blank) => [...(blank ? [['', blank]] : []), ...project.states.map(s => [s.id, s.name])];
  const statOpts = (blank) => [...(blank ? [['', blank]] : []), ...project.stats.map(s => [s.id, s.name])];
  const refOpts = (blank) => [...(blank ? [['', blank]] : []), ...project.states.map(s => [s.id, '상태: ' + s.name]), ...project.stats.map(s => [s.id, '능력치: ' + s.name])];
  const condOpts = (blank) => [...refOpts(blank), ...project.resources.map(r => [r.id, '재화: ' + r.name])];
  const modOpts = (filter, blank) => [...(blank ? [['', blank]] : []), ...project.modules.filter(filter || (() => true)).map(m => [m.id, m.name])];

  function formulaText(f, refLabel) {
    if (!f) return '';
    const x = f.ref ? anyName(f.ref) : refLabel;
    const n = (f.offset || 0) ? `(${x} − ${f.offset})` : x;
    switch (f.type) {
      case 'const': return `= ${fmt(f.base)}`;
      case 'linear': return `= ${fmt(f.base)} + ${f.growth} × ${n}`;
      case 'exp': return `= ${fmt(f.base)} × ${f.growth}^${n}`;
      case 'step': return `= ${fmt(f.base)} × ${f.growth}^⌊${n} ÷ ${f.step}⌋`;
    }
    return '';
  }
  function formulaEd(path, f, label, refDefault) {
    if (!f) return '';
    const x0 = f.offset || 0;
    const sample = f.type === 'const' ? '' : ` · 예: n=0 → ${fmt(AB.evalFormula(f, x0))}, n=10 → ${fmt(AB.evalFormula(f, x0 + 10))}, n=50 → ${fmt(AB.evalFormula(f, x0 + 50))}`;
    return `<div class="formula">
      ${selF(path + '.type', label + ' 공식', f.type, FORMULA_TYPES, { rerender: true })}
      ${numF(path + '.base', '기본값', f.base)}
      ${f.type !== 'const' ? numF(path + '.growth', f.type === 'linear' ? '증가량' : '배율', f.growth, { step: 0.01 }) : ''}
      ${f.type === 'step' ? numF(path + '.step', '단계 크기', f.step, { step: 1 }) : ''}
      ${f.type !== 'const' ? selF(path + '.ref', '기준 (n의 기준)', f.ref || '', refOpts(refDefault || '선택 안 함'), { rerender: true }) : ''}
      ${f.type !== 'const' ? numF(path + '.offset', '기준 시작값', f.offset || 0, { help: 'n = 기준값 − 시작값' }) : ''}
      <div class="formula-preview">${esc(formulaText(f, refDefault || 'x'))}${esc(sample)}</div>
    </div>`;
  }

  // ---------------- 편집기: 재화·상태·능력치 ----------------
  function entitiesEditor() {
    const row = (coll, item, cols) => `<div class="entity-row">
      <div class="field"><label>이름 <span class="id">${esc(item.id)}</span></label><div class="input-wrap"><input type="text" data-path="${coll}.#${item.id}.name" data-type="text" value="${esc(item.name)}"></div></div>
      ${cols}
      <button type="button" class="btn small ghost" data-act="del-entity" data-coll="${coll}" data-id="${item.id}" title="삭제">삭제</button>
    </div>`;
    const P = (c, i) => `${c}.#${i.id}`;
    const chips = (coll) => `<div class="chips"><span class="lbl small muted">빠른 추가</span>${QUICK[coll].map((q, i) => `<button type="button" class="btn chip" data-act="quick-${coll}" data-i="${i}">+ ${esc(q[0])}</button>`).join('')}<button type="button" class="btn chip" data-act="add-${coll}">+ 직접 추가</button></div>`;
    return `
    <div class="card">
      <h2>재화</h2><p class="desc">획득하고 소모하는 자원입니다. 골드·경험치·루비·마력석·입장권 등 원하는 만큼 만들 수 있습니다.</p>
      ${chips('resources')}
      ${project.resources.length ? `<div class="entity-head"><span>이름</span><span>시작 보유량</span><span>보유 한도</span><span>단위</span><span></span></div><div class="entity-list">${project.resources.map(r => row('resources', r,
        numF(P('resources', r) + '.initial', '시작 보유량', r.initial) + numF(P('resources', r) + '.cap', '보유 한도', r.cap, { nullable: true, placeholder: '없음' }) + textF(P('resources', r) + '.unit', '단위', r.unit))).join('')}</div>` : '<div class="empty">아직 재화가 없습니다.</div>'}
    </div>
    <div class="card">
      <h2>성장 상태</h2><p class="desc">단계로 오르는 값입니다 (정수). 레벨·강화 단계·스킬 레벨·스테이지 등.</p>
      ${chips('states')}
      ${project.states.length ? `<div class="entity-head"><span>이름</span><span>시작값</span><span>최대값</span><span></span><span></span></div><div class="entity-list">${project.states.map(s => row('states', s,
        numF(P('states', s) + '.initial', '시작값', s.initial, { step: 1 }) + numF(P('states', s) + '.max', '최대값', s.max, { step: 1, nullable: true, placeholder: '제한 없음' }) + '<div></div>')).join('')}</div>` : '<div class="empty">아직 성장 상태가 없습니다.</div>'}
    </div>
    <div class="card">
      <h2>능력치</h2><p class="desc">최종값 = (기본값 + 가산 규칙 합) × 배율 규칙 곱. 연결 규칙에서 어떤 상태가 능력치를 올리는지 정합니다.</p>
      ${chips('stats')}
      ${project.stats.length ? `<div class="entity-head"><span>이름</span><span>기본값</span><span>단위</span><span></span><span></span></div><div class="entity-list">${project.stats.map(s => row('stats', s,
        numF(P('stats', s) + '.base', '기본값', s.base) + textF(P('stats', s) + '.unit', '단위', s.unit) + '<div></div>')).join('')}</div>` : '<div class="empty">아직 능력치가 없습니다.</div>'}
    </div>`;
  }

  // ---------------- 편집기: 모듈 ----------------
  function lineList(m, list, title, kind) {
    const P = `modules.#${m.id}.${list}`;
    const rows = (m[list] || []).map((r, i) => {
      if (kind === 'unlock') return `<div class="line-row">${selF(`${P}.${i}.ref`, '항목', r.ref, condOpts('선택'), { cls: 'w-lg' })}${numF(`${P}.${i}.min`, '이상', r.min)}<button type="button" class="btn small ghost" data-act="del-line" data-mod="${m.id}" data-list="${list}" data-i="${i}">삭제</button></div>`;
      const refDefault = list === 'cost' ? `${anyName(m.target)}(현재 값)` : '선택 안 함';
      return `<div class="line-row">${selF(`${P}.${i}.resourceId`, '재화', r.resourceId, resOpts('선택'), { cls: 'w-lg', rerender: true })}${formulaEd(`${P}.${i}.amount`, r.amount, kind === 'perKill' ? '처치당' : kind === 'perMin' ? '분당' : '수량', refDefault)}<button type="button" class="btn small ghost" data-act="del-line" data-mod="${m.id}" data-list="${list}" data-i="${i}">삭제</button></div>`;
    }).join('');
    return `<div class="sub"><div class="sub-title">${esc(title)} <button type="button" class="btn small" data-act="add-line" data-mod="${m.id}" data-list="${list}">+ 추가</button></div>${rows || `<div class="help">${kind === 'unlock' ? '조건이 없으면 처음부터 해금됩니다.' : '항목이 없습니다.'}</div>`}</div>`;
  }
  function moduleCard(m) {
    const P = `modules.#${m.id}`;
    const T = MOD_TYPES[m.type];
    let body = '';
    const common = numF(P + '.priority', '우선순위', m.priority || 0, { step: 1, help: '클수록 먼저' });
    switch (m.type) {
      case 'hunt':
        body = `<div class="fields">${numF(P + '.killsPerMin', '분당 처치 수', m.killsPerMin, { unit: '마리' })}${common}</div>${lineList(m, 'rewards', '처치당 보상', 'perKill')}`;
        break;
      case 'idle':
        body = `<div class="fields">${selF(P + '.mode', '보상 방식', m.mode, [['fromHunt', '사냥터 보상의 일정 비율'], ['custom', '직접 지정 (분당)']], { rerender: true })}
          ${numF(P + '.capHours', '최대 누적 시간', m.capHours, { unit: '시간' })}
          ${m.mode === 'fromHunt' ? selF(P + '.huntId', '기준 사냥터', m.huntId || '', modOpts(x => x.type === 'hunt', '현재 이용 중인 사냥터')) + numF(P + '.ratePct', '방치 효율', m.ratePct, { unit: '%' }) : ''}</div>
          ${m.mode === 'custom' ? lineList(m, 'rewards', '분당 보상', 'perMin') : ''}`;
        break;
      case 'periodic':
        body = `<div class="fields">
          ${selF(P + '.period', '주기', m.period, [['daily', '매일 00:00'], ['weekly', '매주 (7일마다)'], ['hours', 'N시간마다']], { rerender: true })}
          ${m.period === 'hours' ? numF(P + '.everyHours', '몇 시간마다', m.everyHours, { unit: '시간' }) : ''}
          ${selF(P + '.gen', '발생 조건', m.gen, [['login', '그 주기 안에 접속할 때 (출석형)'], ['auto', '주기마다 자동 (접속 무관)']], { rerender: true })}
          ${m.gen === 'auto' ? selF(P + '.claim', '수령 조건', m.claim, [['instant', '즉시 계정 반영'], ['login', '우편함 보관 → 다음 접속 때']]) : ''}
          ${selF(P + '.fill', '지급 방식', m.fill || 'add', [['add', '더하기'], ['refill', '충전 (그 양까지 채움, 넘치면 유지)']])}
        </div>${lineList(m, 'rewards', '지급 보상', 'amount')}`;
        break;
      case 'dungeon':
        body = `<div class="fields">${numF(P + '.durationMin', '1회 소요 시간', m.durationMin, { unit: '분', step: 1 })}${numF(P + '.dailyLimit', '하루 최대 횟수', m.dailyLimit, { nullable: true, placeholder: '제한 없음', step: 1 })}${common}</div>
          ${lineList(m, 'cost', '입장 비용', 'amount')}${lineList(m, 'rewards', '클리어 보상 (입장 시점 기준)', 'amount')}`;
        break;
      case 'levelup': case 'upgrade':
        body = `<div class="fields">${selF(P + '.target', '대상 상태', m.target, stateOpts('선택'), { rerender: true })}${m.type === 'upgrade' ? common : ''}</div>${lineList(m, 'cost', '1단계 올리는 비용 (n = 대상 상태의 현재 값)', 'amount')}
          ${m.type === 'upgrade' ? `<div class="help" style="margin-top:6px">이 강화가 무엇을 좋게 하는지는 <b>연결 규칙</b>에서 정합니다 (예: ${esc(anyName(m.target))} → 공격력 +3%).</div>` : ''}`;
        break;
      case 'progress':
        body = `<div class="fields">${selF(P + '.target', '대상 상태', m.target, stateOpts('선택'), { rerender: true })}${selF(P + '.stat', '비교할 능력치', m.stat, statOpts('선택'), { rerender: true })}</div>
          <div class="sub"><div class="sub-title">다음 단계 요구치 (n = 대상 상태의 다음 값)</div><div class="line-row">${formulaEd(P + '.req', m.req, '요구치', `${anyName(m.target)}(다음 값)`)}</div></div>`;
        break;
    }
    return `<div class="mod-card t-${m.type} ${m.enabled === false ? 'off' : ''}">
      <div class="mod-head">
        <span class="tname">${esc(T.name)}</span>
        <input class="name" type="text" data-path="${P}.name" data-type="text" value="${esc(m.name)}" aria-label="모듈 이름">
        <label class="check small"><input type="checkbox" data-path="${P}.enabled" data-type="bool" ${m.enabled === false ? '' : 'checked'} data-rerender="1"> 사용</label>
        <button type="button" class="btn small" data-act="dup-module" data-id="${m.id}">복제</button>
        <button type="button" class="btn small ghost" data-act="del-module" data-id="${m.id}">삭제</button>
      </div>
      <div class="help" style="margin:-4px 0 8px">${esc(T.desc)}</div>
      ${body}
      ${lineList(m, 'unlock', '해금 조건 (모두 만족하면 해금, 한 번 해금되면 유지)', 'unlock')}
    </div>`;
  }
  function modulesEditor(kind) {
    const types = Object.keys(MOD_TYPES).filter(t => MOD_TYPES[t].kind === kind);
    const list = project.modules.filter(m => types.includes(m.type));
    const adds = kind === 'source'
      ? [['hunt', '', '자동사냥'], ['idle', '', '오프라인 방치'], ['periodic', '', '출석 보상 (접속 시)'], ['periodic', 'mail', '자동 지급 (우편함)'], ['periodic', 'charge', '입장권 충전'], ['dungeon', '', '던전']]
      : [['levelup', '', '레벨업'], ['upgrade', '', '강화'], ['progress', '', '진행 (스테이지 등)']];
    return `<div class="card">
      <h2>${kind === 'source' ? '수급 시스템' : '소모·성장 시스템'}</h2>
      <p class="desc">${kind === 'source' ? '재화가 들어오는 곳입니다. 같은 종류를 여러 개 만들 수 있습니다 (예: 골드 던전, 경험치 던전, 장비 던전).' : '재화를 써서 상태를 올리는 곳입니다. 강화 모듈은 공격력에 고정되지 않고, 어떤 상태든 대상으로 고를 수 있습니다.'}</p>
      <div class="chips"><span class="lbl small muted">모듈 추가</span>${adds.map(([t, tpl, l]) => `<button type="button" class="btn chip" data-act="add-module" data-type="${t}" data-tpl="${tpl}">+ ${esc(l)}</button>`).join('')}</div>
      ${!project.resources.length ? '<div class="banner warn">먼저 재화를 하나 이상 만들어야 보상·비용을 지정할 수 있습니다.</div>' : ''}
      ${list.length ? list.map(moduleCard).join('') : '<div class="empty">아직 모듈이 없습니다. 위에서 추가하세요.</div>'}
    </div>`;
  }

  // ---------------- 편집기: 연결 규칙 ----------------
  function linksEditor() {
    const targets = [...project.stats.map(s => ['stat:' + s.id, '능력치: ' + s.name]), ...project.modules.map(m => ['module:' + m.id, `${MOD_TYPES[m.type].name}: ${m.name}`])];
    const rows = project.links.map((l, i) => {
      const P = `links.#${l.id}`;
      const isStat = l.target && l.target.kind === 'stat';
      const tm = !isStat && l.target ? project.modules.find(m => m.id === l.target.id) : null;
      const effects = isStat ? [['add', EFFECTS.add], ['mult', EFFECTS.mult]]
        : tm && tm.type === 'hunt' ? [['reward', EFFECTS.reward], ['speed', EFFECTS.speed]]
        : tm && tm.type === 'dungeon' ? [['reward', EFFECTS.reward], ['cost', EFFECTS.cost], ['duration', EFFECTS.duration]]
        : tm && (tm.type === 'levelup' || tm.type === 'upgrade') ? [['cost', EFFECTS.cost]]
        : [['reward', EFFECTS.reward]];
      const modes = l.effect === 'add' ? [['linear', '참조값 1당 +변화량']] : [['linear', '선형 % (1 + 변화량% × n)'], ['compound', '복리 % ((1 + 변화량%)^n)'], ...(isStat ? [] : [['ratio', '비율 ((참조값 ÷ 기준값)^변화량)']])];
      const refs = isStat ? stateOpts('선택') : refOpts('선택');
      return `<div class="mod-card ${l.enabled === false ? 'off' : ''}" style="border-left-color:#0891b2">
        <div class="mod-head"><span class="tname">규칙 ${i + 1}</span><span class="small muted" style="flex:1">${esc(linkSentence(l))}</span>
          <label class="check small"><input type="checkbox" data-path="${P}.enabled" data-type="bool" ${l.enabled === false ? '' : 'checked'} data-rerender="1"> 사용</label>
          <button type="button" class="btn small ghost" data-act="del-link" data-id="${l.id}">삭제</button></div>
        <div class="fields">
          ${selF(P + '.ref', '참조 (무엇에 따라)', l.ref, refs, { rerender: true, help: isStat ? '능력치용 규칙은 상태만 참조 (순환 방지)' : '' })}
          ${selF(P, '적용 대상', l.target ? l.target.kind + ':' + l.target.id : '', [['', '선택'], ...targets], { special: 'link-target' })}
          ${!isStat ? selF(P + '.target.resourceId', '적용 재화', l.target.resourceId || '', resOpts('전체 재화'), { rerender: true }) : ''}
          ${selF(P + '.effect', '효과', l.effect, effects, { rerender: true })}
          ${l.effect !== 'add' ? selF(P + '.mode', '계산 방식', l.mode, modes, { rerender: true }) : ''}
          ${numF(P + '.value', l.effect === 'add' ? '변화량 (참조값 1당)' : l.mode === 'ratio' ? '지수' : '변화량 (%)', l.value, { step: 0.1, help: !isStat && l.effect !== 'reward' && l.effect !== 'speed' ? '음수면 감소 (예: −10 = 10% 할인)' : '' })}
          ${l.mode === 'ratio' ? numF(P + '.base', '기준값', l.base) : numF(P + '.offset', '참조 시작값', l.offset || 0, { help: 'n = 참조값 − 시작값' })}
          ${l.effect !== 'add' ? numF(P + '.min', '최소 배율', l.min, { nullable: true, placeholder: l.effect === 'cost' || l.effect === 'duration' ? '0.05' : '없음' }) + numF(P + '.max', '최대 배율', l.max, { nullable: true, placeholder: '없음' }) : ''}
        </div></div>`;
    }).join('');
    return `<div class="card">
      <h2>시스템 간 연결 규칙</h2>
      <p class="desc">한 줄 = <b>참조 → 적용 대상 → 효과 → 변화량</b>. 예: 스킬 레벨 → 자동사냥 → 보상량 증가 → 레벨당 2%. 적용 순서: 최종값 = (기본 + 가산 합) × 배율 곱 × 이벤트 배율.</p>
      <div class="chips"><button type="button" class="btn chip" data-act="add-link">+ 규칙 추가</button></div>
      ${rows || '<div class="empty">아직 연결 규칙이 없습니다. 연결이 없으면 상태가 올라도 능력치·보상이 바뀌지 않습니다.</div>'}
      <details class="rules" style="margin-top:10px"><summary>지원하는 규칙 유형과 계산 방식</summary><ul>
        <li><b>능력치 가산</b>: 상태 → 능력치, 변화량 × (상태값 − 시작값)</li>
        <li><b>능력치 배율</b>: 상태 → 능력치, 선형 1 + 변화량% × n 또는 복리 (1 + 변화량%)^n</li>
        <li><b>보상량 증감</b>: 상태·능력치 → 사냥·방치·주기·던전 (특정 재화만 가능)</li>
        <li><b>비용 증감</b>: 상태·능력치 → 레벨업·강화·던전 (음수면 할인, 하한 0.05배)</li>
        <li><b>처치 속도</b>: 상태·능력치 → 자동사냥. 비율 모드로 공격력 ÷ 기준값을 처치 속도에 직접 연결</li>
        <li><b>소요 시간</b>: 상태·능력치 → 던전 (하한 0.05배)</li>
        <li>모든 배율은 최소·최대로 제한할 수 있습니다. 능력치끼리는 연결할 수 없어 순환 참조가 생기지 않습니다.</li>
      </ul></details>
    </div>`;
  }
  function linkSentence(l) {
    if (!l.target) return '';
    const t = l.target.kind === 'stat' ? anyName(l.target.id) : anyName(l.target.id) + (l.target.resourceId ? `(${resName(l.target.resourceId)})` : '');
    const per = l.mode === 'ratio' ? `(${anyName(l.ref)} ÷ ${fmt(l.base)})^${l.value}` : l.effect === 'add' ? `${anyName(l.ref)} 1당 ${l.value >= 0 ? '+' : ''}${l.value}` : `${anyName(l.ref)} 1당 ${l.value >= 0 ? '+' : ''}${l.value}%${l.mode === 'compound' ? ' (복리)' : ''}`;
    return `${anyName(l.ref)} → ${t} · ${EFFECTS[l.effect] || ''} · ${per}`;
  }

  // ---------------- 편집기: 유저 모델 ----------------
  function playersEditor() {
    return `<div class="card">
      <h2>유저 행동 모델</h2>
      <p class="desc">게임 밸런스와 유저 행동을 분리합니다. 매일 접속 시작 시각에 들어와서 정한 시간만큼 플레이하고, 나머지는 오프라인입니다. 실제 이용자 데이터가 아니라 설정에 따른 예측입니다.</p>
      <div class="fields" style="margin-bottom:12px">${selF('activePlayer', '기본으로 계산할 유저', project.activePlayer, project.players.map(p => [p.id, p.name]), { rerender: true })}
        ${selF('sim.days', '시뮬레이션 기간', project.sim.days, [[7, '7일'], [14, '14일'], [30, '30일'], [60, '60일']], { num: true, rerender: true })}</div>
      <div class="chips"><button type="button" class="btn chip" data-act="add-player">+ 유저 유형 추가</button></div>
      ${project.players.map(pl => {
        const P = `players.#${pl.id}`;
        return `<div class="mod-card" style="border-left-color:${pl.id === project.activePlayer ? 'var(--accent)' : 'var(--line-2)'}">
          <div class="mod-head"><input class="name" type="text" data-path="${P}.name" data-type="text" value="${esc(pl.name)}">${pl.id === project.activePlayer ? '<span class="badge info">기본</span>' : ''}
            <button type="button" class="btn small ghost" data-act="del-entity" data-coll="players" data-id="${pl.id}">삭제</button></div>
          <div class="fields">
            ${numF(P + '.onlineMin', '하루 접속 시간', pl.onlineMin, { unit: '분', step: 1 })}
            ${numF(P + '.loginAt', '접속 시작 시각', pl.loginAt || 0, { unit: '시', hours: true, step: 0.5 })}
            ${checkF(P + '.useDungeons', '입장할 수 있으면 던전 이용', pl.useDungeons)}
            ${checkF(P + '.autoUpgrade', '재화가 있으면 바로 강화', pl.autoUpgrade)}
            ${selF(P + '.upgradeMode', '강화 모듈이 여러 개일 때', pl.upgradeMode || 'roundRobin', [['roundRobin', '돌아가며 한 단계씩'], ['priority', '우선순위 순으로 최대한']])}
          </div></div>`;
      }).join('')}
    </div>`;
  }

  // ---------------- 편집기: 이벤트 ----------------
  function eventsEditor() {
    const tpls = [['rewardMult', '보상 배율 (예: 경험치 2배)'], ['grant', '재화 지급'], ['costDiscount', '강화 비용 할인'], ['dailyGrant', '매일 추가 지급 (입장권 등)']];
    return `<div class="card">
      <h2>이벤트 실험</h2>
      <p class="desc">이벤트는 원본 밸런스를 바꾸지 않습니다. 같은 설정·같은 유저로 <b>기준</b>과 <b>이벤트 적용</b>을 따로 계산해 비교합니다. 이벤트가 끝나도 그동안 얻은 재화·성장은 유지됩니다.</p>
      <div class="chips"><span class="lbl small muted">추가</span>${tpls.map(([t, l]) => `<button type="button" class="btn chip" data-act="add-event" data-type="${t}">+ ${esc(l)}</button>`).join('')}</div>
      ${project.events.length ? project.events.map((ev, i) => {
        const P = `events.#${ev.id}`;
        const T = EVENT_TYPES[ev.type];
        const unit = ev.type === 'grant' || ev.type === 'dailyGrant' ? resUnit(ev.resourceId) : T.unit;
        return `<div class="mod-card ${ev.enabled === false ? 'off' : ''}" style="border-left-color:var(--event)">
          <div class="mod-head"><span class="tname">이벤트 ${i + 1}</span><input class="name" type="text" data-path="${P}.name" data-type="text" value="${esc(ev.name)}" placeholder="이벤트 이름">
            <label class="check small"><input type="checkbox" data-path="${P}.enabled" data-type="bool" ${ev.enabled === false ? '' : 'checked'} data-rerender="1"> 사용</label>
            <button type="button" class="btn small ghost" data-act="del-event" data-id="${ev.id}">삭제</button></div>
          <div class="fields">
            ${selF(P + '.type', '종류', ev.type, Object.entries(EVENT_TYPES).map(([k, v]) => [k, v.name]), { rerender: true })}
            ${ev.type === 'grant' || ev.type === 'dailyGrant' ? selF(P + '.resourceId', '지급 재화', ev.resourceId, resOpts('선택'), { rerender: true }) : ''}
            ${ev.type === 'rewardMult' ? selF(P + '.resourceId', '적용 재화', ev.resourceId, resOpts('전체 재화')) : ''}
            ${ev.type === 'rewardMult' ? selF(P + '.moduleId', '적용 모듈', ev.moduleId, modOpts(m => ['hunt', 'idle', 'dungeon', 'periodic'].includes(m.type), '사냥·방치·던전 전체')) : ''}
            ${ev.type === 'costDiscount' ? selF(P + '.moduleId', '적용 모듈', ev.moduleId, modOpts(m => ['upgrade', 'levelup', 'dungeon'].includes(m.type), '강화 모듈 전체')) : ''}
            ${numF(P + '.value', ev.type === 'grant' ? '지급량' : ev.type === 'dailyGrant' ? '하루 지급량' : ev.type === 'costDiscount' ? '할인율' : '배율', ev.value, { unit })}
            ${numF(P + '.startDay', ev.type === 'grant' ? '지급 일 차' : '시작 일 차', ev.startDay, { unit: '일 차', step: 1 })}
            ${ev.type !== 'grant' ? numF(P + '.days', '기간', ev.days, { unit: '일', step: 1 }) : ''}
            ${ev.type === 'grant' ? selF(P + '.claim', '수령 조건', ev.claim || 'instant', [['instant', '즉시 반영'], ['login', '접속할 때 수령']]) : ''}
            ${selF(P, '대상 조건', ev.cond ? ev.cond.ref : '', condOpts('전체 유저'), { special: 'cond-ref' })}
            ${ev.cond ? `<div class="field"><label>조건값 (이하)</label><div class="input-wrap"><input type="number" step="any" data-path="${P}" data-special="cond-max" value="${esc(ev.cond.max)}"></div></div>` : ''}
          </div></div>`;
      }).join('') : '<div class="empty">등록된 이벤트가 없습니다.</div>'}
    </div>`;
  }

  // ---------------- 차트 ----------------
  function niceStep(range, target) {
    const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  function drawChart(box, legendEl, series, o = {}) {
    if (!box) return;
    const W = Math.max(260, Math.floor(box.clientWidth || 600));
    const H = o.height || (W < 520 ? 210 : 250);
    const M = { l: W < 520 ? 48 : 60, r: 12, t: 14, b: 28 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const total = o.totalMin;
    let ymax = 0;
    for (const s of series) for (const [, y] of s.pts) if (isFinite(y) && y > ymax) ymax = y;
    if (o.hLine && isFinite(o.hLine) && o.hLine > ymax) ymax = o.hLine;
    if (ymax <= 0) ymax = 1;
    const step = niceStep(ymax, 4);
    ymax = Math.ceil(ymax / step) * step;
    const X = t => M.l + (t / total) * iw;
    const Y = v => M.t + ih - (Math.max(0, Math.min(isFinite(v) ? v : ymax, ymax)) / ymax) * ih;
    const days = total / DAY;
    const dStep = days <= 7 ? 1 : days <= 14 ? 2 : days <= 30 ? 5 : 10;
    let g = '';
    for (let v = 0; v <= ymax + 1e-9; v += step) {
      g += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${M.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(fmt(v))}</text>`;
    }
    for (let d = 0; d <= days + 1e-9; d += dStep) g += `<text x="${X(d * DAY)}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${d}일</text>`;
    let shades = '';
    for (const sh of o.shades || []) {
      if (sh.from >= total) continue;
      if (sh.to !== undefined) shades += `<rect x="${X(sh.from)}" y="${M.t}" width="${Math.max(1, X(Math.min(total, sh.to)) - X(sh.from))}" height="${ih}" fill="var(--event-soft)"/>`;
      else shades += `<line x1="${X(sh.from)}" x2="${X(sh.from)}" y1="${M.t}" y2="${M.t + ih}" stroke="var(--event)" stroke-dasharray="3 3"/>`;
    }
    if (o.vLine !== undefined && o.vLine <= total) shades += `<line x1="${X(o.vLine)}" x2="${X(o.vLine)}" y1="${M.t}" y2="${M.t + ih}" stroke="var(--ok)" stroke-width="1.5" stroke-dasharray="5 3"/><text x="${X(o.vLine) + 4}" y="${M.t + 12}" font-size="11" fill="var(--ok)">목표 시간</text>`;
    if (o.hLine !== undefined && isFinite(o.hLine)) shades += `<line x1="${M.l}" x2="${W - M.r}" y1="${Y(o.hLine)}" y2="${Y(o.hLine)}" stroke="var(--ok)" stroke-width="1.5" stroke-dasharray="5 3"/>`;
    const paths = series.map((s, i) => {
      const d = s.pts.map(([t, y], j) => (j ? 'L' : 'M') + X(t).toFixed(1) + ',' + Y(y).toFixed(1)).join('');
      return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.1" ${s.dash ? 'stroke-dasharray="6 4"' : ''} stroke-linejoin="round"/>`;
    }).join('');
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(o.title || '그래프')}">${shades}${g}<line x1="${M.l}" x2="${W - M.r}" y1="${M.t + ih}" y2="${M.t + ih}" stroke="var(--line-2)"/>${paths}<line class="cursor" x1="0" x2="0" y1="${M.t}" y2="${M.t + ih}" stroke="var(--muted)" style="display:none"/><rect x="${M.l}" y="${M.t}" width="${iw}" height="${ih}" fill="transparent"/></svg><div class="chart-tip"></div>`;
    if (legendEl) legendEl.innerHTML = series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('') + ((o.shades || []).length ? '<span><i class="shade"></i>이벤트 기간</span>' : '') + (o.title ? `<span>세로축: ${esc(o.title)}</span>` : '');
    const svg = box.querySelector('svg'), tip = box.querySelector('.chart-tip'), cursor = svg.querySelector('.cursor');
    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (W / rect.width);
      const t = Math.max(0, Math.min(total, ((px - M.l) / iw) * total));
      const idx = Math.round(t / 60);
      const pt = series[0] && series[0].pts[Math.min(idx, series[0].pts.length - 1)];
      if (!pt) return;
      cursor.setAttribute('x1', X(pt[0])); cursor.setAttribute('x2', X(pt[0])); cursor.style.display = '';
      tip.innerHTML = `<b>${fmtDur(pt[0]) || '시작'}</b><br>` + series.map(s => { const q = s.pts[Math.min(idx, s.pts.length - 1)]; return `<span style="color:${s.color}">●</span> ${esc(s.name)}: <b class="num">${esc((o.yFmt || fmt)(q[1]))}</b>`; }).join('<br>');
      tip.style.display = 'block';
      const bx = box.getBoundingClientRect();
      let left = ev.clientX - bx.left + 12;
      if (left + tip.offsetWidth > bx.width) left = ev.clientX - bx.left - tip.offsetWidth - 12;
      tip.style.left = Math.max(0, left) + 'px'; tip.style.top = '8px';
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { tip.style.display = 'none'; cursor.style.display = 'none'; });
  }
  function eventShades(events) {
    return (events || []).map(ev => ev.type === 'grant' ? { from: (ev.startDay - 1) * DAY } : { from: (ev.startDay - 1) * DAY, to: (ev.startDay - 1 + ev.days) * DAY });
  }
  // metric: 's:ID' 상태, 't:ID' 능력치, 'r:ID' 재화 보유, 'g:ID' 누적 획득, 'x:ID' 누적 소모
  function metricGet(metric) {
    const [k, id] = metric.split(':');
    const key = { s: 'S', t: 'T', r: 'R', g: 'G', x: 'X' }[k];
    return s => (s[key] || {})[id];
  }
  function metricLabel(metric) {
    const [k, id] = metric.split(':');
    return anyName(id) + ({ r: ' 보유량', g: ' 누적 획득', x: ' 누적 소모' }[k] || '');
  }
  function metricOptions(withRes) {
    return [...project.states.map(s => ['s:' + s.id, s.name]), ...project.stats.map(s => ['t:' + s.id, s.name]), ...(withRes ? project.resources.flatMap(r => [['r:' + r.id, r.name + ' 보유량'], ['g:' + r.id, r.name + ' 누적 획득']]) : [])];
  }

  // ---------------- 화면: 공통 ----------------
  function setHeader(crumbHtml, actionsHtml) { $('#crumb').innerHTML = crumbHtml || ''; $('#topActions').innerHTML = actionsHtml || ''; }
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const safeName = s => String(s || 'project').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  function exportJson(p) { download(`${safeName(p.name)}.json`, JSON.stringify(p, null, 2), 'application/json'); }
  function openProject(id, view) {
    const p = Store.load(id);
    if (!p) { alert('프로젝트를 찾을 수 없습니다.'); location.hash = '#/'; return; }
    location.hash = view === 'wizard' || !(p.meta && p.meta.setupDone) ? `#/wizard/${id}/${(p.meta && p.meta.wizardStep) || 0}` : `#/ws/${id}/overview`;
  }
  function createAndOpen(p) {
    p.meta = p.meta || {};
    Store.save(p);
    openProject(p.id);
  }

  // ---------------- 화면: 프로젝트 홈 ----------------
  function renderHome() {
    project = null; liveRenderers = [];
    setHeader('', '<a class="btn small" href="' + (location.pathname.includes('/v2/') ? '../v1/' : 'v1/') + '" title="이전 버전 (고정된 방치형 RPG 계산기)">v1 열기</a>');
    const list = Store.index();
    let v1 = null;
    try { const raw = localStorage.getItem('autoBalancing.v1'); if (raw) v1 = JSON.parse(raw); } catch (e) { /* 무시 */ }
    $('#app').innerHTML = `
      <section class="hero">
        <h2>내 게임 구조를 만들고, 성장과 경제를 숫자로 확인하세요</h2>
        <p>재화·성장 상태·능력치·모듈을 직접 구성하고, 유저 유형별 성장 곡선·재화 흐름·이벤트 효과를 시뮬레이션합니다. 목표(예: 5일 안에 레벨 130)를 정하면 수치를 자동으로 찾아 검증합니다.</p>
      </section>
      <div class="start-grid">
        <button type="button" class="start-card" data-act="new-blank"><span class="ico">＋</span><strong>새 프로젝트</strong><span>빈 프로젝트에서 재화·상태·모듈을 직접 구성합니다. 단계별 설정 마법사로 진행합니다.</span></button>
        <button type="button" class="start-card" data-act="new-preset"><span class="ico">▤</span><strong>장르 프리셋으로 시작</strong><span>방치형 RPG 기본 구조(사냥·방치·던전·레벨업·강화·스테이지)를 채운 상태로 마법사를 시작합니다. 모두 바꿀 수 있습니다.</span></button>
        <button type="button" class="start-card" data-act="import"><span class="ico">⇪</span><strong>기존 프로젝트 불러오기</strong><span>내보낸 JSON 파일을 불러옵니다.${v1 ? ' v1에서 쓰던 값도 가져올 수 있습니다.' : ''}</span></button>
        <button type="button" class="start-card" data-act="sample"><span class="ico">▶</span><strong>샘플 체험</strong><span>값이 채워진 가상 방치형 RPG로 바로 워크스페이스를 열어 기능을 체험합니다.</span></button>
      </div>
      ${v1 ? `<div class="banner info">이 브라우저에 v1에서 작업하던 값이 있습니다. <a href="#" data-act="import-v1">v2 프로젝트로 가져오기</a></div>` : ''}
      <div class="card">
        <div class="row-head"><h2>내 프로젝트</h2><span class="small muted">이 브라우저에만 저장됩니다. 다른 기기로 옮기려면 JSON으로 내보내세요.</span></div>
        ${list.length ? `<div class="proj-list">${list.map(x => `<div class="proj-item">
            <div><div class="name">${esc(x.name)} ${x.sample ? '<span class="badge">가상 샘플</span>' : ''}</div>
            <div class="meta">${x.setupDone ? '<span class="badge ok">설정 완료</span>' : `<span class="badge info">설정 중 · ${(x.step || 0) + 1}/7단계</span>`} · ${esc(new Date(x.updatedAt).toLocaleString('ko-KR'))}</div></div>
            <div class="acts"><button type="button" class="btn small primary" data-act="open" data-id="${x.id}">열기</button>
              <button type="button" class="btn small" data-act="dup" data-id="${x.id}">복제</button>
              <button type="button" class="btn small" data-act="export" data-id="${x.id}">JSON</button>
              <button type="button" class="btn small ghost" data-act="remove" data-id="${x.id}">삭제</button></div>
          </div>`).join('')}</div>` : '<div class="empty">아직 프로젝트가 없습니다. 위에서 시작 방법을 고르세요.</div>'}
      </div>`;
  }

  // ---------------- 화면: 설정 마법사 ----------------
  const WIZ = [
    { title: '프로젝트 기본 정보', todo: '프로젝트 이름과 시뮬레이션 기간을 정합니다.' },
    { title: '재화·상태·능력치', todo: '게임에 쓰이는 <b>재화</b>(골드·경험치·루비…), <b>성장 상태</b>(레벨·강화 단계·스킬 레벨…), <b>능력치</b>(공격력·체력…)를 만듭니다. 이름을 바꿔도 내부 ID로 연결되어 끊기지 않습니다.' },
    { title: '수급 시스템', todo: '재화가 들어오는 모듈(자동사냥·방치·주기 보상·던전)을 만들고, 각 모듈이 <b>어떤 재화를 얼마나</b> 주는지 고릅니다.' },
    { title: '소모·성장 시스템', todo: '재화를 써서 상태를 올리는 모듈(레벨업·강화·진행)을 만들고, <b>비용 재화</b>와 <b>대상 상태</b>를 고릅니다.' },
    { title: '시스템 간 연결 규칙', todo: '상태·능력치가 무엇에 영향을 주는지 연결합니다. 예: 레벨 → 공격력 +4, 강화 단계 → 공격력 +3%, 스킬 레벨 → 자동사냥 보상 +2%.' },
    { title: '유저 행동 모델', todo: '유저 유형별 하루 접속 시간·접속 시각·행동 정책을 정합니다.' },
    { title: '검증 및 완료', todo: '끊긴 참조·빠진 값을 확인하고, 미리보기 계산을 한 번 실행합니다. 오류가 없으면 워크스페이스로 들어갑니다.' },
  ];
  function renderWizard(step) {
    liveRenderers = [];
    step = Math.max(0, Math.min(WIZ.length - 1, step | 0));
    project.meta.wizardStep = step;
    saveSoon();
    setHeader(`<span>·</span><b>${esc(project.name)}</b><span class="badge info">설정 마법사 ${step + 1}/7</span>`, '<span class="small muted" id="saveState"></span>');
    let body = '';
    if (step === 0) {
      body = `<div class="card"><h2>프로젝트 기본 정보</h2><div class="fields">
        ${textF('name', '프로젝트 이름', project.name, { cls: 'full' })}
        ${selF('genre', '장르', project.genre, [['idle-rpg', '방치형 RPG'], ['custom', '기타 / 직접 구성']])}
        ${selF('sim.days', '시뮬레이션 기간', project.sim.days, [[7, '7일'], [14, '14일'], [30, '30일'], [60, '60일']], { num: true })}
        ${textF('description', '설명 (선택)', project.description, { cls: 'full' })}
      </div><p class="help" style="margin-top:10px">프리셋으로 시작했다면 다음 단계들에 기본 구조가 채워져 있습니다. 필요 없는 항목은 지우고, 필요한 항목은 추가하세요.</p></div>`;
    } else if (step === 1) body = entitiesEditor();
    else if (step === 2) body = modulesEditor('source');
    else if (step === 3) body = modulesEditor('sink');
    else if (step === 4) body = linksEditor();
    else if (step === 5) body = playersEditor();
    else body = `<div id="wizCheck"></div>`;
    $('#app').innerHTML = `<div class="wizard">
      <ol class="steps">${WIZ.map((w, i) => `<li class="${i === step ? 'cur' : i < step ? 'done' : ''}" data-act="wiz-go" data-step="${i}"><span class="n">${i < step ? '✓' : i + 1}</span><span class="t">${esc(w.title)}</span></li>`).join('')}</ol>
      <div><div class="todo"><b>${step + 1}단계 · ${esc(WIZ[step].title)}</b> — ${WIZ[step].todo}</div>${body}
        <div class="wiz-foot"><button type="button" class="btn" data-act="wiz-go" data-step="${step - 1}" ${step === 0 ? 'disabled' : ''}>← 이전</button>
          <span class="row"><a class="btn ghost" href="#/">나중에 계속</a>${step < WIZ.length - 1 ? `<button type="button" class="btn primary" data-act="wiz-go" data-step="${step + 1}">다음 →</button>` : '<button type="button" class="btn primary" data-act="wiz-finish" id="btnFinish">완료하고 워크스페이스로</button>'}</span></div></div>
    </div>`;
    if (step === WIZ.length - 1) liveRenderers.push(renderWizCheck);
    runSim();
  }
  function stepOfPath(path) {
    const s = path.split('.')[0];
    if (s === 'resources' || s === 'states' || s === 'stats') return 1;
    if (s === 'modules') { const m = project.modules[+path.split('.')[1]]; return m && MOD_TYPES[m.type].kind === 'sink' ? 3 : 2; }
    if (s === 'links') return 4;
    if (s === 'players') return 5;
    return 0;
  }
  function renderWizCheck() {
    const box = $('#wizCheck'); if (!box) return;
    const errs = sim.errors, warns = sim.warnings;
    const counts = `재화 ${project.resources.length} · 성장 상태 ${project.states.length} · 능력치 ${project.stats.length} · 모듈 ${project.modules.length} · 연결 규칙 ${project.links.length} · 유저 유형 ${project.players.length}`;
    let html = `<div class="card"><h2>구성 요약</h2><p class="desc">${counts}</p>`;
    html += errs.length ? `<div class="banner err"><b>오류 ${errs.length}개</b> — 고쳐야 완료할 수 있습니다.<ul class="issue-list">${errs.slice(0, 15).map(e => `<li>· ${esc(e.msg)} <a href="#" data-act="wiz-go" data-step="${stepOfPath(e.path)}">고치러 가기</a></li>`).join('')}</ul></div>` : '<div class="banner ok">✓ 오류가 없습니다.</div>';
    if (warns.length) html += `<div class="banner warn"><b>확인 권장 ${warns.length}개</b> (계산은 됩니다)<ul class="issue-list">${warns.map(w => `<li>· ${esc(w.msg)}</li>`).join('')}</ul></div>`;
    html += '</div>';
    if (!errs.length && sim.base) {
      const r = sim.base;
      html += `<div class="card"><h2>미리보기 (${esc(activePlayer().name)} · ${project.sim.days}일)</h2>
        ${!r.reliable ? `<div class="banner err">⚠ 계산 결과를 신뢰할 수 없습니다: ${r.issues.map(esc).join(' / ')}</div>` : ''}
        <div class="kpis">${project.states.slice(0, 4).map(s => `<div class="kpi"><div class="label">${esc(s.name)}</div><div class="value num">${fmt(r.final.S[s.id])}</div><div class="delta muted">시작 ${fmt(s.initial)}</div></div>`).join('')}</div>
        <div class="chart-box" id="wizChart"></div><div class="legend" id="wizLegend"></div></div>`;
    }
    box.innerHTML = html;
    const fin = $('#btnFinish'); if (fin) fin.disabled = errs.length > 0;
    if (!errs.length && sim.base) {
      const ms = mainState();
      if (ms) drawChart($('#wizChart'), $('#wizLegend'), [{ name: ms.name, color: PALETTE[0], pts: sim.base.series.map(s => [s.t, s.S[ms.id]]) }], { totalMin: sim.base.totalMin, title: ms.name });
    }
  }

  // ---------------- 화면: 워크스페이스 ----------------
  const WS = [
    ['개요', [['overview', '프로젝트 개요']]],
    ['게임 구조', [['entities', '재화·상태·능력치'], ['sources', '수급 시스템'], ['sinks', '소모·성장'], ['links', '연결 규칙'], ['players', '유저 모델']]],
    ['밸런싱', [['results', '시뮬레이션 결과'], ['events', '이벤트 실험'], ['goal', '목표 밸런싱'], ['compare', '유저 비교']]],
    ['파일', [['data', '가져오기·내보내기']]],
  ];
  const EDIT_SECTIONS = ['entities', 'sources', 'sinks', 'links', 'players', 'events'];
  function renderWorkspace(section) {
    liveRenderers = [];
    if (!WS.some(([, items]) => items.some(([k]) => k === section))) section = 'overview';
    ui().section = section;
    setHeader(`<span>·</span><b>${esc(project.name)}</b>${project.meta.sample ? '<span class="badge">가상 샘플 데이터</span>' : ''}`,
      `<span class="small muted" id="saveState"></span><button type="button" class="btn small" data-act="export-cur">JSON 내보내기</button>`);
    const side = WS.map(([g, items]) => `<div class="grp">${g}</div>${items.map(([k, l]) => `<a href="#/ws/${project.id}/${k}" class="${k === section ? 'cur' : ''}">${l}</a>`).join('')}`).join('');
    const withPreview = EDIT_SECTIONS.includes(section);
    let main = '<div id="wsBanner"></div>';
    switch (section) {
      case 'overview': main += overviewHtml(); liveRenderers.push(renderOverviewLive); break;
      case 'entities': main += entitiesEditor(); break;
      case 'sources': main += modulesEditor('source'); break;
      case 'sinks': main += modulesEditor('sink'); break;
      case 'links': main += linksEditor(); break;
      case 'players': main += playersEditor(); break;
      case 'events': main += eventsEditor(); break;
      case 'results': main += '<div id="results"></div>'; liveRenderers.push(renderResults); break;
      case 'goal': main += '<div id="goal"></div>'; liveRenderers.push(() => { if (!goalRunning) renderGoal(); }); break;
      case 'compare': main += '<div id="compare"></div>'; liveRenderers.push(renderCompare); break;
      case 'data': main += dataHtml(); break;
    }
    $('#app').innerHTML = `<div class="ws ${withPreview ? 'with-preview' : ''}"><nav class="side" aria-label="워크스페이스 메뉴">${side}</nav><div class="ws-main">${main}</div>${withPreview ? '<aside class="preview" id="preview"></aside>' : ''}</div>`;
    const curLink = document.querySelector('.side a.cur');
    if (curLink && window.innerWidth <= 900) curLink.scrollIntoView({ inline: 'center', block: 'nearest' });
    liveRenderers.unshift(renderWsBanner);
    if (withPreview) liveRenderers.push(renderPreview);
    if (sim.stale || !sim.projectSnap || sim.projectSnap.id !== project.id) runSim(); else { markInvalid(); renderLive(); }
  }
  function renderWsBanner() {
    const b = $('#wsBanner'); if (!b) return;
    let html = '';
    if (sim.errors.length) html += `<div class="banner err"><b>입력 오류 ${sim.errors.length}개</b> — 고칠 때까지 결과는 마지막으로 계산한 값입니다.<ul class="issue-list">${sim.errors.slice(0, 5).map(e => `<li>· ${esc(e.msg)}</li>`).join('')}</ul></div>`;
    const bad = [['기준', sim.base], ['이벤트 적용', sim.evt]].filter(([, r]) => r && !r.reliable);
    if (bad.length) html += `<div class="banner err"><b>⚠ 계산 결과를 신뢰할 수 없습니다.</b> 수치가 너무 커서 일부 계산을 할 수 없었습니다. 이 설정은 밸런싱 근거로 쓰지 마세요.<br>${bad.map(([n, r]) => `· ${n}: ${r.issues.map(esc).join(' / ')}`).join('<br>')}</div>`;
    b.innerHTML = html;
  }
  function renderPreview() {
    const box = $('#preview'); if (!box) return;
    if (!sim.base) { box.innerHTML = '<div class="card"><p class="muted small">계산 결과가 없습니다.</p></div>'; return; }
    const r = sim.base, e = sim.evt;
    box.innerHTML = `<div class="card ${sim.stale ? 'dim' : ''}"><div class="row-head"><h3 style="margin:0">실시간 미리보기</h3><a class="small" href="#/ws/${project.id}/results">자세히 →</a></div>
      <p class="desc">${esc(activePlayer().name)} · ${project.sim.days}일${sim.stale ? ' · <b style="color:var(--err)">입력 오류로 이전 결과</b>' : ` · ${sim.ms.toFixed(0)}ms`}</p>
      <div class="kpis">${project.states.slice(0, 4).map(s => `<div class="kpi"><div class="label">${esc(s.name)}</div><div class="value num">${fmt(r.final.S[s.id])}</div><div class="delta num">${e ? '이벤트 ' + fmt(e.final.S[s.id]) : ''}</div></div>`).join('')}</div>
      <div class="chart-box" id="pvChart"></div><div class="legend" id="pvLegend"></div></div>`;
    const ms = mainState();
    if (ms) {
      const series = [{ name: '기준', color: PALETTE[0], pts: r.series.map(s => [s.t, s.S[ms.id]]) }];
      if (e) series.push({ name: '이벤트', color: PALETTE[1], dash: true, pts: e.series.map(s => [s.t, s.S[ms.id]]) });
      drawChart($('#pvChart'), $('#pvLegend'), series, { totalMin: r.totalMin, title: ms.name, height: 180, shades: e ? eventShades(sim.events) : [] });
    }
  }

  function overviewHtml() {
    return `<div class="card"><h2>프로젝트 개요</h2><div class="fields">
      ${textF('name', '프로젝트 이름', project.name, { cls: 'full' })}
      ${textF('description', '설명', project.description, { cls: 'full' })}
      ${selF('activePlayer', '기본 유저', project.activePlayer, project.players.map(p => [p.id, p.name]), { rerender: true })}
      ${selF('sim.days', '시뮬레이션 기간', project.sim.days, [[7, '7일'], [14, '14일'], [30, '30일'], [60, '60일']], { num: true, rerender: true })}
    </div>
    <p class="desc" style="margin-top:12px">재화 ${project.resources.length} · 성장 상태 ${project.states.length} · 능력치 ${project.stats.length} · 모듈 ${project.modules.length} · 연결 규칙 ${project.links.length} · 이벤트 ${project.events.length} · 유저 유형 ${project.players.length}</p>
    <div class="row"><a class="btn small" href="#/ws/${project.id}/results">시뮬레이션 결과</a><a class="btn small" href="#/ws/${project.id}/goal">목표 밸런싱</a><a class="btn small" href="#/ws/${project.id}/compare">유저 비교</a><a class="btn small ghost" href="#/wizard/${project.id}/0">설정 마법사 다시 보기</a></div></div>
    <div id="ovLive"></div>`;
  }
  function renderOverviewLive() {
    const box = $('#ovLive'); if (!box) return;
    if (!sim.base) { box.innerHTML = ''; return; }
    const r = sim.base;
    const warn = sim.warnings.length ? `<div class="banner warn"><b>확인 권장 ${sim.warnings.length}개</b><ul class="issue-list">${sim.warnings.map(w => `<li>· ${esc(w.msg)}</li>`).join('')}</ul></div>` : '';
    box.innerHTML = `${warn}<div class="card ${sim.stale ? 'dim' : ''}"><h2>현재 밸런스 요약 (${esc(activePlayer().name)} · ${project.sim.days}일)</h2>
      <div class="kpis" style="margin-top:10px">${project.states.slice(0, 4).map(s => `<div class="kpi"><div class="label">${esc(s.name)}</div><div class="value num">${fmt(r.final.S[s.id])}</div><div class="delta muted">시작 ${fmt(s.initial)}</div></div>`).join('')}</div>
      <ul class="analysis">${analyze(r).slice(0, 4).map(x => `<li><div class="msg"><span class="tag ${x.tag || 'base'}">${x.tag === 'lim' ? '모델 한계' : '기준'}</span>${esc(x.msg)}</div><div class="basis">근거: ${esc(x.basis)}</div></li>`).join('')}</ul></div>`;
  }

  // ---------------- 시뮬레이션 결과 ----------------
  function renderResults() {
    const box = $('#results'); if (!box) return;
    if (!sim.base) { box.innerHTML = '<div class="card"><p class="muted">계산 결과가 없습니다. 입력 오류를 먼저 고치세요.</p></div>'; return; }
    const r = sim.base, e = sim.evt, u = ui();
    const mOpts = metricOptions(false);
    if (!u.growth || !mOpts.some(([v]) => v === u.growth)) u.growth = mOpts[0] ? mOpts[0][0] : '';
    if (!u.econRes || !project.resources.some(x => x.id === u.econRes)) u.econRes = (project.resources[0] || {}).id;
    u.econMode = u.econMode || 'r';
    const ms = mainState();
    if (!u.msState || !project.states.some(s => s.id === u.msState)) u.msState = ms ? ms.id : '';
    if (!(u.msValue >= 1)) u.msValue = ms ? Math.max((ms.initial || 0) + 1, Math.round(r.final.S[ms.id] * 0.9)) : 1;
    const allOk = [r, e].filter(Boolean).every(x => Object.values(x.check).every(c => c.ok));
    box.innerHTML = `
      <div class="status ${sim.stale ? 'dim' : ''}">
        <span class="pill">${sim.stale ? '입력 오류 — 이전 결과' : '자동 계산 · ' + sim.ms.toFixed(0) + 'ms'}</span>
        <span class="pill">${esc(sim.player.name)} · ${sim.player.onlineMin > 0 ? '하루 ' + fmtDur(sim.player.onlineMin) + ' 접속' : '접속 안 함'} · ${project.sim.days}일</span>
        <span class="pill">${e ? `기준 vs 이벤트 ${sim.events.length}개` : '이벤트 없음 (기준만)'}</span>
        <span class="pill ${allOk ? 'ok' : 'err'}" title="시작값 + 누적 획득 − 누적 소모 = 보유량">${allOk ? '✓ 재화 잔액 검증 통과' : '✕ 재화 잔액 불일치'}</span>
        <button type="button" class="btn small" data-act="csv-results">결과 CSV 내려받기</button>
      </div>
      <div class="${sim.stale ? 'dim' : ''}">
      <div class="kpis">${project.states.slice(0, 4).map(s => { const b = r.final.S[s.id], v = e ? e.final.S[s.id] : null; return `<div class="kpi"><div class="label">${esc(s.name)}</div><div class="value num">${fmt(b)}</div><div class="delta num">${e ? '이벤트 ' + fmt(v) + ' · ' + fmtDelta(b, v) : ''}</div></div>`; }).join('')}</div>
      <div class="card"><div class="row-head"><h2>성장 곡선</h2><div class="controls"><select data-ui="growth" aria-label="지표">${mOpts.map(([v, l]) => `<option value="${v}" ${v === u.growth ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div></div>
        <div class="chart-box" id="chGrowth"></div><div class="legend" id="lgGrowth"></div></div>
      <div class="card"><div class="row-head"><h2>재화 흐름</h2><div class="controls">
        <select data-ui="econRes" aria-label="재화">${project.resources.map(x => `<option value="${x.id}" ${x.id === u.econRes ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <div class="seg">${[['r', '보유량'], ['g', '누적 획득'], ['x', '누적 소모']].map(([v, l]) => `<button type="button" data-ui-seg="econMode" data-v="${v}" aria-pressed="${v === u.econMode}">${l}</button>`).join('')}</div></div></div>
        <div class="chart-box" id="chEcon"></div><div class="legend" id="lgEcon"></div></div>
      <div class="card"><h2>콘텐츠 해금 · 목표 도달 시간</h2><p class="desc">시뮬레이션 시작부터 걸린 시간입니다.</p>
        <div class="fields" style="margin-bottom:10px"><div class="field"><label>확인할 상태</label><div class="input-wrap"><select data-ui="msState">${project.states.map(s => `<option value="${s.id}" ${s.id === u.msState ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></div>
          <div class="field"><label>목표값</label><div class="input-wrap"><input type="number" data-ui="msValue" value="${u.msValue}" step="1"></div></div></div>
        <div class="timeline" id="timeline"></div></div>
      <div class="card"><h2>수급처별 비중</h2><p class="desc">기간 동안 실제로 들어온 양 기준입니다.</p><div id="shares"></div></div>
      <div class="card"><h2>기준 대비 결과 비교</h2><div class="table-scroll"><table class="cmp" id="cmpTable"></table></div></div>
      <div class="card"><h2>자동 분석</h2><p class="desc">계산 결과에 정해진 규칙을 적용해 만든 문장입니다. 각 문장 아래에 근거 수치를 적었습니다.</p><ul class="analysis" id="analysis"></ul></div>
      <div class="card"><details class="rules"><summary>계산 규칙 보기 (처리 순서와 가정)</summary><ol>
        <li>1분 단위 이산 시간 시뮬레이션. 확률 요소가 없어 같은 입력이면 항상 같은 결과입니다.</li>
        <li>매 분: ① 주기 경계면 자동 주기 보상·충전·던전 횟수 초기화·이벤트 지급 → ② 접속 시작이면 방치 보상·우편함·출석 보상 수령 → ③ 레벨업·진행(자동), 접속 중이면 강화 → ④ 접속 중: 던전(우선순위·비용·남은 시간 조건) 아니면 사냥 / 미접속: 방치 보상 누적 → ⑤ 60분마다 기록.</li>
        <li>최종값 = (기본 공식 + 가산 규칙 합) × 배율 규칙 곱 × 이벤트 배율. 능력치끼리는 연결할 수 없습니다 (순환 방지).</li>
        <li>던전 보상은 입장 시점의 상태로 계산하고, 이벤트 배율은 끝나는 시점 기준입니다.</li>
        <li>이벤트가 겹치면 배율은 곱하고 할인은 (1−a)(1−b)로 합칩니다. 끝나도 얻은 재화·성장은 유지됩니다.</li>
        <li>기간 마지막에 쌓였지만 받지 못한 방치 보상·우편함은 ‘미수령’으로 따로 표시합니다.</li>
        <li>재화는 소수점까지 계산하고 화면에는 반올림해 표시합니다. 수치가 1e300을 넘거나 무한대가 되면 ‘신뢰 불가’로 표시합니다.</li>
      </ol></details></div></div>`;
    const shades = e ? eventShades(sim.events) : [];
    const g = metricGet(u.growth);
    const gs = [{ name: '기준', color: PALETTE[0], pts: r.series.map(s => [s.t, g(s)]) }];
    if (e) gs.push({ name: '이벤트 적용', color: PALETTE[1], dash: true, pts: e.series.map(s => [s.t, g(s)]) });
    drawChart($('#chGrowth'), $('#lgGrowth'), gs, { totalMin: r.totalMin, title: metricLabel(u.growth), shades });
    const em = u.econMode + ':' + u.econRes, eg = metricGet(em);
    const es = [{ name: '기준', color: PALETTE[0], pts: r.series.map(s => [s.t, eg(s)]) }];
    if (e) es.push({ name: '이벤트 적용', color: PALETTE[1], dash: true, pts: e.series.map(s => [s.t, eg(s)]) });
    drawChart($('#chEcon'), $('#lgEcon'), es, { totalMin: r.totalMin, title: metricLabel(em), shades, yFmt: v => fmt(v) + ' ' + resUnit(u.econRes) });
    renderTimeline(); renderShares(); renderTable(); renderAnalysis();
  }
  function renderTimeline() {
    const r = sim.base, e = sim.evt, u = ui();
    const items = project.modules.filter(m => (m.unlock || []).length).map(m => ({
      name: m.name + ' 해금', cond: '조건: ' + m.unlock.map(c => `${anyName(c.ref)} ${fmt(c.min)} 이상`).join(', '), b: r.unlockAt[m.id], e: e ? e.unlockAt[m.id] : undefined,
    }));
    items.push({ name: `목표: ${anyName(u.msState)} ${fmt(u.msValue)} 도달`, cond: '위에서 목표를 바꿀 수 있습니다', b: AB.reachTime(r, u.msState, Math.floor(u.msValue)), e: e ? AB.reachTime(e, u.msState, Math.floor(u.msValue)) : undefined });
    $('#timeline').innerHTML = items.map(it => `<div class="tl-item"><div><div class="name">${esc(it.name)}</div><div class="cond">${esc(it.cond)}</div></div>
      <div class="when"><div class="num">${fmtDur(it.b)}</div>${e ? `<div class="ev num">이벤트: ${fmtDur(it.e)}${it.b !== null && it.e !== null ? ' · ' + fmtDurDiff(it.b, it.e) : ''}</div>` : ''}</div></div>`).join('');
  }
  function srcName(k) { return k === 'event' ? '이벤트 지급' : k === '__cap' ? '보유 한도 초과 소멸' : anyName(k); }
  function shareBlock(res, rid, caption) {
    const gmap = res.ledger[rid].gain;
    const total = sumObj(gmap);
    if (!(total > 0)) return '';
    const entries = Object.entries(gmap).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const color = k => SRC_COLORS[Math.abs([...k].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % SRC_COLORS.length];
    return `<div class="share-row"><div class="cap">${esc(caption)} · 합계 ${fmt(total)} ${esc(resUnit(rid))}</div>
      <div class="share-bar">${entries.map(([k, v]) => `<span title="${esc(srcName(k))} ${(v / total * 100).toFixed(1)}%" style="width:${v / total * 100}%;background:${color(k)}"></span>`).join('')}</div>
      <div class="share-legend">${entries.map(([k, v]) => `<span><i class="dot" style="background:${color(k)}"></i>${esc(srcName(k))} <b>${(v / total * 100).toFixed(1)}%</b> <span class="num">(${fmt(v)})</span></span>`).join('')}</div></div>`;
  }
  function renderShares() {
    const r = sim.base, e = sim.evt;
    const html = project.resources.map(x => shareBlock(r, x.id, x.name + ' · 기준') + (e ? shareBlock(e, x.id, x.name + ' · 이벤트 적용') : '')).join('');
    $('#shares').innerHTML = html || '<div class="empty">수급이 없습니다.</div>';
  }
  function renderTable() {
    const r = sim.base, e = sim.evt;
    const rows = [
      ...project.states.map(s => ['최종 ' + s.name, x => x.final.S[s.id]]),
      ...project.stats.map(s => ['최종 ' + s.name, x => x.final.T[s.id]]),
      ...project.resources.flatMap(rs => [[rs.name + ' 보유', x => x.final.R[rs.id]], [rs.name + ' 누적 획득', x => sumObj(x.ledger[rs.id].gain)], [rs.name + ' 누적 소모', x => sumObj(x.ledger[rs.id].spend)]]),
      ...project.modules.filter(m => m.type === 'dungeon').map(m => [m.name + ' 이용 횟수', x => x.runs[m.id]]),
      ...project.resources.map(rs => [rs.name + ' 미수령 (기간 종료 시)', x => x.pendingUnclaimed[rs.id]]).filter(([, f]) => f(r) > 0 || (e && f(e) > 0)),
    ];
    $('#cmpTable').innerHTML = `<thead><tr><th>지표</th><th>기준</th>${e ? '<th>이벤트 적용</th><th>차이</th>' : ''}</tr></thead><tbody>${rows.map(([l, f]) => { const b = f(r), v = e ? f(e) : null; return `<tr><td>${esc(l)}</td><td class="num">${fmt(b)}</td>${e ? `<td class="num">${fmt(v)}</td><td class="num diff">${fmtDelta(b, v)}</td>` : ''}</tr>`; }).join('')}</tbody>`;
  }

  // ---------------- 규칙 기반 분석 ----------------
  function analyze(r) {
    const out = [];
    const pl = sim.player || activePlayer();
    const at = t => r.series.find(s => s.t === t) || r.series[r.series.length - 1];
    const T = r.totalMin;
    const lastDayGain = id => r.series[r.series.length - 1].G[id] - at(Math.max(0, T - DAY)).G[id];
    for (const rs of project.resources) {
      const g = r.ledger[rs.id].gain, tot = sumObj(g);
      if (!(tot > 0)) continue;
      const [k, v] = Object.entries(g).sort((a, b) => b[1] - a[1])[0];
      if (v / tot >= 0.5 && Object.keys(g).filter(x => g[x] > 0).length > 1) out.push({ msg: `${rs.name} 수급의 ${(v / tot * 100).toFixed(0)}%가 ‘${srcName(k)}’에 몰려 있습니다.`, basis: `${srcName(k)} ${fmt(v)} ÷ 전체 ${fmt(tot)} (기준: 한 수급처 50% 이상)` });
    }
    const ms = mainState();
    if (ms && T >= 2 * DAY) {
      const first = at(DAY).S[ms.id] - r.series[0].S[ms.id], last = r.final.S[ms.id] - at(T - DAY).S[ms.id];
      if (first > 0) out.push({ msg: last <= first * 0.2 ? `후반 성장이 크게 느려졌습니다. 마지막 하루 ${ms.name} 상승은 첫날의 ${(last / first * 100).toFixed(0)}%입니다.` : `마지막 하루 ${ms.name} 상승은 첫날의 ${(last / first * 100).toFixed(0)}%입니다.`, basis: `첫 24시간 +${fmt(first)}, 마지막 24시간 +${fmt(last)} (기준: 20% 이하면 ‘크게 느려짐’)` });
    }
    for (const m of project.modules.filter(x => (x.type === 'upgrade' || x.type === 'levelup') && x.enabled !== false)) {
      const nc = r.nextCost[m.id];
      if (!nc || T < DAY) continue;
      for (const [rid, cost] of Object.entries(nc)) {
        const dg = lastDayGain(rid);
        if (dg > 0 && isFinite(cost)) {
          const ratio = cost / dg;
          if (ratio >= 1) out.push({ msg: `‘${m.name}’ 다음 1단계 비용이 마지막 날 하루 ${resName(rid)} 수급의 ${ratio.toFixed(1)}배입니다. 병목 구간입니다.`, basis: `다음 비용 ${fmt(cost)} ÷ 마지막 24시간 획득 ${fmt(dg)} (기준: 1배 이상)` });
        } else if (!(dg > 0) && isFinite(cost) && cost > r.final.R[rid]) out.push({ msg: `‘${m.name}’에 필요한 ${resName(rid)}이(가) 마지막 날 들어오지 않아 더 진행할 수 없습니다.`, basis: `마지막 24시간 ${resName(rid)} 획득 0 · 다음 비용 ${fmt(cost)} · 보유 ${fmt(r.final.R[rid])}` });
      }
    }
    for (const rs of project.resources) {
      const isCost = project.modules.some(m => (m.cost || []).some(c => c.resourceId === rs.id));
      const dg = lastDayGain(rs.id);
      if (isCost && dg > 0 && r.final.R[rs.id] > dg * 3) out.push({ msg: `${rs.name}이(가) 쌓이고 있습니다 (보유 ${fmt(r.final.R[rs.id])}). 소모처가 부족하거나 강화 정책이 꺼져 있을 수 있습니다.`, basis: `보유량 ÷ 마지막 하루 획득 = ${(r.final.R[rs.id] / dg).toFixed(1)}배 (기준: 3배 이상)` });
    }
    for (const m of project.modules) if ((m.unlock || []).length && r.unlockAt[m.id] === null) out.push({ msg: `‘${m.name}’은(는) 기간 안에 해금되지 않습니다.`, basis: m.unlock.map(c => `조건 ${anyName(c.ref)} ≥ ${fmt(c.min)}`).join(', ') });
    for (const m of project.modules.filter(x => x.type === 'idle' && x.enabled !== false)) {
      const off = DAY - pl.onlineMin, cap = m.capHours * 60;
      if (off > cap) out.push({ msg: `오프라인 ${fmtDur(off)} 중 ${fmtDur(off - cap)} 동안은 ‘${m.name}’ 한도를 넘어 보상이 쌓이지 않습니다.`, basis: `하루 1440분 − 접속 ${pl.onlineMin}분 = ${off}분 > 최대 누적 ${cap}분` });
    }
    const unclaimed = project.resources.filter(x => r.pendingUnclaimed[x.id] > 0);
    if (unclaimed.length) out.push({ msg: `기간 종료 시 받지 못한 보상이 있습니다: ${unclaimed.map(x => `${x.name} ${fmt(r.pendingUnclaimed[x.id])}`).join(', ')}.`, basis: '방치 보상·우편함·접속 수령 이벤트는 실제 접속할 때만 받습니다' });
    const hunts = project.modules.filter(m => m.type === 'hunt' && m.enabled !== false);
    const noSpeed = hunts.filter(h => !project.links.some(l => l.enabled !== false && l.target && l.target.id === h.id && l.effect === 'speed'));
    if (noSpeed.length) out.push({ tag: 'lim', msg: `모델 한계: ${noSpeed.map(h => `‘${h.name}’`).join(', ')}의 처치 속도는 능력치와 연결되어 있지 않습니다. 능력치는 진행(스테이지 등)과 보상 공식을 통해서만 수급에 영향을 줍니다.`, basis: '연결 규칙에서 ‘처치 속도’ 효과를 추가하면 능력치 → 처치 속도를 직접 연결할 수 있습니다' });
    return out;
  }
  function analyzeEvent(b, e) {
    const out = [];
    const ms = mainState();
    if (ms) out.push({ msg: `이벤트 적용 시 기간 종료 ${ms.name}이(가) ${fmtDelta(b.final.S[ms.id], e.final.S[ms.id])} 달라집니다 (${fmt(b.final.S[ms.id])} → ${fmt(e.final.S[ms.id])}).`, basis: '같은 설정·같은 유저로 두 번 계산한 결과 비교' });
    const lastEnd = Math.max(...sim.events.map(ev => (ev.startDay - 1 + (ev.type === 'grant' ? 0 : ev.days)) * DAY));
    if (ms && lastEnd < b.totalMin) {
      const at = (r, t) => r.series.find(s => s.t === t) || r.series[r.series.length - 1];
      const d1 = at(e, lastEnd).S[ms.id] - at(b, lastEnd).S[ms.id], d2 = e.final.S[ms.id] - b.final.S[ms.id];
      out.push({ msg: `이벤트가 끝난 ${fmtDur(lastEnd)} 시점의 ${ms.name} 차이 ${fmt(d1)}이(가) 기간 종료 때는 ${fmt(d2)}입니다.`, basis: '이벤트로 얻은 성장은 종료 후에도 유지' });
    }
    for (const m of project.modules) if ((m.unlock || []).length && b.unlockAt[m.id] !== e.unlockAt[m.id]) {
      const a = b.unlockAt[m.id], c = e.unlockAt[m.id];
      out.push({ msg: `‘${m.name}’ 해금이 ${a === null ? `기간 내 미해금 → ${fmtDur(c)}` : c === null ? `${fmtDur(a)} → 기간 내 미해금` : fmtDurDiff(a, c)}입니다.`, basis: `기준 ${fmtDur(a)} · 이벤트 ${fmtDur(c)}` });
    }
    for (const rs of project.resources) {
      const g0 = sumObj(b.ledger[rs.id].gain), g1 = sumObj(e.ledger[rs.id].gain);
      if (g0 > 0 && Math.abs(g1 / g0 - 1) >= 0.1) out.push({ msg: `${rs.name} 누적 획득이 ${fmtDelta(g0, g1)} 달라집니다.`, basis: `${fmt(g0)} → ${fmt(g1)} ${resUnit(rs.id)}` });
    }
    return out;
  }
  function renderAnalysis() {
    const r = sim.base, e = sim.evt;
    const items = analyze(r).map(x => ({ tag: 'base', ...x }));
    if (e) items.push(...analyzeEvent(r, e).map(x => ({ ...x, tag: 'evt' })));
    const ok = [r, e].filter(Boolean).every(x => Object.values(x.check).every(c => c.ok));
    items.push({ tag: 'chk', msg: ok ? '재화 잔액 검증을 통과했습니다.' : '재화 잔액이 맞지 않습니다. 계산 규칙을 확인해야 합니다.', basis: '시작값 + 누적 획득 − 누적 소모 = 보유량 · ' + project.resources.map(x => `${x.name} ${fmt(r.check[x.id].expected)} = ${fmt(r.check[x.id].actual)}`).join(', ') });
    const tn = { base: '기준', evt: '이벤트', chk: '검증', lim: '모델 한계' };
    $('#analysis').innerHTML = items.map(x => `<li><div class="msg"><span class="tag ${x.tag}">${tn[x.tag]}</span>${esc(x.msg)}</div><div class="basis">근거: ${esc(x.basis)}</div></li>`).join('');
  }
  function resultsCsv() {
    if (!sim.base) return;
    const r = sim.base, e = sim.evt;
    const cols = [...project.states.map(s => ['S', s.id, s.name]), ...project.stats.map(s => ['T', s.id, s.name]), ...project.resources.flatMap(x => [['R', x.id, x.name + ' 보유'], ['G', x.id, x.name + ' 누적획득'], ['X', x.id, x.name + ' 누적소모']])];
    const lines = [`# 오토 밸런싱 시뮬레이션 결과 - ${project.name} - ${sim.player.name} ${project.sim.days}일${project.meta.sample ? ' - 가상 샘플 데이터' : ''}`];
    if (!r.reliable || (e && !e.reliable)) lines.push('# 경고: 계산 결과를 신뢰할 수 없음 (수치 범위 초과)');
    lines.push(['경과(분)', '경과(일)', ...cols.map(c => '기준_' + c[2]), ...(e ? cols.map(c => '이벤트_' + c[2]) : [])].map(csvCell).join(','));
    r.series.forEach((s, i) => {
      const row = [s.t, (s.t / DAY).toFixed(4), ...cols.map(([k, id]) => +(+s[k][id]).toPrecision(10))];
      if (e) row.push(...cols.map(([k, id]) => +(+e.series[i][k][id]).toPrecision(10)));
      lines.push(row.join(','));
    });
    download(`${safeName(project.name)}-결과-${project.sim.days}d.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }
  const csvCell = s => /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s);

  // ---------------- 목표 밸런싱 ----------------
  function goalCfg() {
    const g = project.meta.goal = project.meta.goal || {};
    const ms = mainState();
    if (!g.type) g.type = 'state';
    if (!g.stateId || !project.states.some(s => s.id === g.stateId)) g.stateId = ms ? ms.id : '';
    if (!(g.value >= 1)) g.value = sim.base && ms ? Math.round(sim.base.final.S[ms.id] * 0.95) : 10;
    const unl = project.modules.filter(m => (m.unlock || []).length);
    if (!g.moduleId || !unl.some(m => m.id === g.moduleId)) g.moduleId = (unl[0] || {}).id || '';
    if (!g.playerId || !project.players.some(p => p.id === g.playerId)) g.playerId = project.activePlayer;
    if (!(g.targetDays >= 0)) g.targetDays = Math.max(1, Math.round(project.sim.days * 0.6));
    if (!(g.targetHours >= 0)) g.targetHours = 0;
    g.mode = g.mode || 'within';
    g.budget = g.budget || 300;
    g.vars = g.vars || {};
    return g;
  }
  function defaultRange(key, v) {
    if (/\/growth$/.test(key) && v > 1) return [+(1 + (v - 1) * 0.7).toFixed(4), +(1 + (v - 1) * 1.3).toFixed(4)];
    if (v === 0) return [0, 10];
    const lo = v * 0.7, hi = v * 1.3;
    return [Math.min(lo, hi), Math.max(lo, hi)].map(x => Math.abs(x) >= 100 ? Math.round(x) : +x.toPrecision(4));
  }
  function renderGoal() {
    const box = $('#goal'); if (!box) return;
    const g = goalCfg();
    const params = AB.listParams(project);
    const unl = project.modules.filter(m => (m.unlock || []).length);
    const filt = goalFilter.trim();
    const shown = params.filter(p => !filt || (p.group + ' ' + p.label).includes(filt));
    const nOn = params.filter(p => g.vars[p.key] && g.vars[p.key].on).length;
    let rows = '', lastGroup = '';
    for (const p of shown) {
      const cfg = g.vars[p.key] || {};
      const [dlo, dhi] = defaultRange(p.key, p.value);
      if (p.group !== lastGroup) { rows += `<tr><td colspan="5" style="font-weight:700;color:var(--text);padding-top:12px">${esc(p.group)}</td></tr>`; lastGroup = p.group; }
      rows += `<tr class="${cfg.on ? 'sel' : ''}"><td><label class="check small"><input type="checkbox" data-goalvar="${esc(p.key)}" ${cfg.on ? 'checked' : ''}> ${esc(p.label)}</label></td>
        <td class="num">${fmt(p.value)}</td>
        <td><input type="number" step="any" data-goalmin="${esc(p.key)}" value="${esc(cfg.min !== undefined ? cfg.min : dlo)}" ${cfg.on ? '' : 'disabled'} aria-label="최소"></td>
        <td><input type="number" step="any" data-goalmax="${esc(p.key)}" value="${esc(cfg.max !== undefined ? cfg.max : dhi)}" ${cfg.on ? '' : 'disabled'} aria-label="최대"></td>
        <td class="small muted">${cfg.on ? '조정' : '잠금'}</td></tr>`;
    }
    box.innerHTML = `
      <div class="card"><h2>목표 기반 자동 밸런싱</h2>
        <p class="desc">목표를 정하고 조정할 수치와 범위를 고르면, 시뮬레이션을 반복 실행해 맞는 수치를 찾습니다. 찾은 수정안은 처음부터 다시 계산해서 검증하고, <b>승인하기 전에는 원본을 바꾸지 않습니다.</b> 이벤트는 넣지 않고 기본 밸런스로 계산합니다.</p>
        <div class="fields">
          <div class="field"><label>목표 유형</label><div class="input-wrap"><select data-goal="type">${[['state', '상태 도달 (레벨·스테이지 등)'], ['unlock', '콘텐츠(모듈) 해금']].map(([v, l]) => `<option value="${v}" ${g.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
          ${g.type === 'state' ? `<div class="field"><label>상태</label><div class="input-wrap"><select data-goal="stateId">${project.states.map(s => `<option value="${s.id}" ${g.stateId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></div>
            <div class="field"><label>목표값</label><div class="input-wrap"><input type="number" step="1" data-goal="value" value="${esc(g.value)}"></div></div>`
            : `<div class="field"><label>해금할 콘텐츠</label><div class="input-wrap"><select data-goal="moduleId">${unl.length ? unl.map(m => `<option value="${m.id}" ${g.moduleId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('') : '<option value="">해금 조건이 있는 모듈 없음</option>'}</select></div></div>`}
          <div class="field"><label>목표 도달 시간</label><div class="row" style="flex-wrap:nowrap"><div class="input-wrap"><input type="number" min="0" step="1" data-goal="targetDays" value="${esc(g.targetDays)}"><span class="unit">일</span></div><div class="input-wrap"><input type="number" min="0" max="23" step="1" data-goal="targetHours" value="${esc(g.targetHours)}"><span class="unit">시간</span></div></div></div>
          <div class="field"><label>목표 시간의 의미</label><div class="input-wrap"><select data-goal="mode"><option value="within" ${g.mode === 'within' ? 'selected' : ''}>목표 시간 이내 달성 (변경 최소)</option><option value="closest" ${g.mode === 'closest' ? 'selected' : ''}>목표 시간에 최대한 가깝게</option></select></div></div>
          <div class="field"><label>기준 유저</label><div class="input-wrap"><select data-goal="playerId">${project.players.map(p => `<option value="${p.id}" ${g.playerId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
          <div class="field"><label>탐색 횟수 상한</label><div class="input-wrap"><select data-goal="budget">${[100, 300, 600].map(v => `<option value="${v}" ${+g.budget === v ? 'selected' : ''}>${v}회</option>`).join('')}</select></div></div>
        </div></div>
      <div class="card"><div class="row-head"><h2>조정할 변수 (${nOn}개 선택)</h2><div class="input-wrap" style="max-width:260px"><input type="search" placeholder="변수 검색 (예: 경험치, 던전)" id="goalFilter" value="${esc(goalFilter)}"></div></div>
        <p class="desc">체크한 변수만 바뀝니다. 체크하지 않은 변수는 <b>수정 금지(잠금)</b>입니다. 변수마다 최소·최대를 따로 정할 수 있고, 기존값보다 낮은 범위(감소)도 가능합니다. 변수 1개는 이분 탐색, 2개 이상은 그리드 탐색 + 국소 정제를 씁니다. 2~3개를 권장합니다.</p>
        <div class="table-scroll" style="max-height:420px;overflow-y:auto"><table class="cmp"><thead><tr><th>변수</th><th>현재값</th><th>최소</th><th>최대</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5">검색 결과가 없습니다.</td></tr>'}</tbody></table></div>
        <div class="row" style="margin-top:12px"><button type="button" class="btn primary" data-act="goal-run" ${nOn && !sim.errors.length ? '' : 'disabled'}>자동 밸런싱 실행</button>
          <span class="small muted">${sim.errors.length ? '입력 오류를 먼저 고치세요.' : nOn ? '' : '조정할 변수를 하나 이상 고르세요.'}</span></div>
        <div id="goalProgress" class="hidden" style="margin-top:10px"><div class="progress-bar"><span id="goalBar"></span></div><div class="small muted" id="goalProgText"></div></div>
      </div>
      <div id="goalResult"></div>`;
    renderGoalResult();
  }
  async function runGoal() {
    const g = goalCfg();
    const params = AB.listParams(project);
    const vars = params.filter(p => g.vars[p.key] && g.vars[p.key].on).map(p => {
      const [dlo, dhi] = defaultRange(p.key, p.value);
      const c = g.vars[p.key];
      return { key: p.key, label: `${p.group} · ${p.label}`, min: c.min !== undefined ? c.min : dlo, max: c.max !== undefined ? c.max : dhi, int: !!p.int };
    });
    const bad = vars.find(v => !isFinite(v.min) || !isFinite(v.max));
    if (bad) { alert(`‘${bad.label}’의 범위를 숫자로 입력하세요.`); return; }
    const targetMin = Math.round((+g.targetDays || 0) * DAY + (+g.targetHours || 0) * 60);
    if (!(targetMin > 0)) { alert('목표 도달 시간을 입력하세요.'); return; }
    const goal = { type: g.type, stateId: g.stateId, value: Math.floor(+g.value), moduleId: g.moduleId, playerId: g.playerId, targetMin, mode: g.mode };
    if (goal.type === 'unlock' && !goal.moduleId) { alert('해금할 콘텐츠를 고르세요.'); return; }
    goalRunning = true;
    $('#goalProgress').classList.remove('hidden');
    document.querySelectorAll('[data-act="goal-run"]').forEach(b => b.disabled = true);
    const t0 = performance.now();
    try {
      const snap = clone(project);
      const res = await AB.optimize(snap, goal, vars, { budget: +g.budget, onProgress: (d, b) => { const bar = $('#goalBar'); if (bar) bar.style.width = Math.min(100, d / b * 100) + '%'; const tx = $('#goalProgText'); if (tx) tx.textContent = `시뮬레이션 ${d}회 실행 중…`; } });
      goalResult = { ...res, goal, vars, snap, ms: performance.now() - t0, stale: false };
    } catch (e) {
      goalResult = null; alert('자동 밸런싱 중 오류: ' + e.message); console.error(e);
    }
    goalRunning = false;
    renderGoal();
    const el = $('#goalResult'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function goalLabel(goal) {
    return goal.type === 'unlock' ? `‘${anyName(goal.moduleId)}’ 해금` : `${anyName(goal.stateId)} ${fmt(goal.value)} 도달`;
  }
  function renderGoalResult() {
    const box = $('#goalResult'); if (!box || !goalResult) { if (box) box.innerHTML = ''; return; }
    const R = goalResult, goal = R.goal;
    const ok = R.verified;
    const modeTxt = goal.mode === 'within' ? '목표 시간 이내' : `목표 시간 ±${fmtDur(R.toleranceMin)}`;
    box.innerHTML = `<div class="card">
      <h2>결과: ${esc(goalLabel(goal))} · ${esc(modeTxt)} ${fmtDur(goal.targetMin)}</h2>
      ${R.stale ? '<div class="banner warn">결과를 낸 뒤 프로젝트가 바뀌었습니다. 다시 실행하는 것을 권장합니다.</div>' : ''}
      ${ok ? `<div class="banner ok"><b>✓ 목표 달성 — 재시뮬레이션 검증 통과.</b> 수정값으로 처음부터 다시 계산한 결과 ${fmtDur(R.verifyTime)}에 도달합니다.</div>`
        : `<div class="banner err"><b>지정한 범위 안에서 목표를 달성하는 수정안을 찾지 못했습니다.</b> 아래는 가장 가까운 후보이며 <b>미달성</b>입니다. 범위를 넓히거나 다른 변수를 추가해 보세요.${R.baseline.feasible ? ' (현재 값은 이미 목표를 만족합니다)' : ''}</div>`}
      <div class="table-scroll"><table class="cmp"><thead><tr><th>항목</th><th>기존</th><th>조정 후</th><th>목표</th></tr></thead><tbody>
        <tr><td>목표 도달 시간</td><td class="num">${fmtDur(R.baseline.time)}</td><td class="num">${fmtDur(R.verifyTime)}</td><td class="num">${fmtDur(goal.targetMin)}</td></tr>
        <tr><td>목표 시간과의 오차</td><td class="num">${fmtErr(R.baseline.err)}</td><td class="num">${fmtErr(R.verifyTime - goal.targetMin)}</td><td></td></tr>
        <tr><td>평균 변경률</td><td class="num">0%</td><td class="num">${(R.best.change * 100).toFixed(1)}%</td><td></td></tr>
      </tbody></table></div>
      <p class="small muted">탐색 방법: ${esc(R.method)} · 시뮬레이션 ${R.sims}회 · ${(R.ms / 1000).toFixed(1)}초 · 평가 기간 ${R.horizonDays}일${R.rejectedUnreliable ? ` · 신뢰 불가 후보 ${R.rejectedUnreliable}개 제외` : ''}</p>
      <h3 style="margin-top:12px">기존값과 수정값</h3>
      <div class="table-scroll"><table class="cmp"><thead><tr><th>변수</th><th>기존값</th><th>수정값</th><th>변경률</th><th>허용 범위</th></tr></thead><tbody>
        ${R.best.values.map(v => `<tr><td>${esc(v.label)}</td><td class="num">${fmt(v.old)}</td><td class="num"><b>${fmt(v.value)}</b></td><td class="num diff">${fmtPct(v.pct)}</td><td class="num muted">${fmt(v.min)} ~ ${fmt(v.max)}</td></tr>`).join('')}
      </tbody></table></div>
      ${R.warnings.length ? `<div class="banner warn" style="margin-top:12px"><b>다른 재화 균형 확인</b><ul class="issue-list">${R.warnings.map(w => `<li>· ${esc(w)}</li>`).join('')}</ul></div>` : ''}
      <h3 style="margin-top:12px">성장 곡선 비교</h3>
      <div class="chart-box" id="goalChart"></div><div class="legend" id="goalLegend"></div>
      <div class="row" style="margin-top:12px">
        <button type="button" class="btn primary" data-act="goal-apply" ${ok && !R.applied ? '' : 'disabled'}>${R.applied ? '원본에 적용됨' : '원본에 적용'}</button>
        <button type="button" class="btn" data-act="goal-copy" ${ok ? '' : 'disabled'}>새 프로젝트로 저장</button>
        <button type="button" class="btn" data-act="goal-csv">조정 입력값 CSV 내려받기</button>
      </div>
      <p class="help">‘원본에 적용’은 확인을 받은 뒤 위 변수만 바꿉니다. 조정 입력값 CSV는 시뮬레이션 결과 CSV와 다른 파일입니다.</p></div>`;
    const H = R.horizonDays;
    const base = AB.simulate(R.snap, { playerId: goal.playerId, days: H });
    const adj = AB.simulate(R.candidateProject, { playerId: goal.playerId, days: H });
    let sid = goal.stateId, hLine = goal.value;
    if (goal.type === 'unlock') {
      const m = R.snap.modules.find(x => x.id === goal.moduleId);
      const c = m && (m.unlock || [])[0];
      sid = c ? c.ref : (mainState() || {}).id;
      hLine = c ? c.min : undefined;
    }
    const get = s => (sid in s.S) ? s.S[sid] : (sid in s.T) ? s.T[sid] : s.R[sid];
    drawChart($('#goalChart'), $('#goalLegend'), [
      { name: '기존', color: PALETTE[0], pts: base.series.map(s => [s.t, get(s)]) },
      { name: ok ? '조정 후' : '조정 후보 (미달성)', color: ok ? PALETTE[2] : PALETTE[1], dash: true, pts: adj.series.map(s => [s.t, get(s)]) },
    ], { totalMin: base.totalMin, title: anyName(sid), vLine: goal.targetMin, hLine });
  }
  function goalCsv() {
    const R = goalResult; if (!R) return;
    const lines = [
      `# 오토 밸런싱 조정 입력값 - ${project.name}${project.meta.sample ? ' - 가상 샘플 데이터' : ''}`,
      `# 목표: ${goalLabel(R.goal)} / ${R.goal.mode === 'within' ? '이내 달성' : '최대한 가깝게'} ${fmtDur(R.goal.targetMin)} / 기준 유저 ${anyName(R.goal.playerId) === '(없음)' ? (project.players.find(p => p.id === R.goal.playerId) || {}).name : ''}`,
      `# 결과: ${R.verified ? '달성 (재시뮬레이션 검증 통과)' : '미달성 (참고용 후보)'} / 기존 ${fmtDur(R.baseline.time)} → 조정 후 ${fmtDur(R.verifyTime)}`,
      ['변수ID', '변수', '기존값', '수정값', '변경률(%)', '최소', '최대'].join(','),
      ...R.best.values.map(v => [v.key, v.label, v.old, +v.value.toPrecision(10), v.pct === null ? '' : v.pct.toFixed(2), v.min, v.max].map(csvCell).join(',')),
    ];
    download(`${safeName(project.name)}-조정입력값.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }
  function goalApply() {
    const R = goalResult; if (!R || !R.verified) return;
    const list = R.best.values.map(v => `· ${v.label}: ${fmt(v.old)} → ${fmt(v.value)} (${fmtPct(v.pct)})`).join('\n');
    if (!confirm(`다음 수치를 원본 프로젝트에 적용할까요?\n\n${list}\n\n다른 수치는 바뀌지 않습니다.`)) return;
    for (const v of R.best.values) AB.setParam(project, v.key, v.value);
    R.applied = true;
    Store.save(project);
    changed(false);
    renderGoal();
  }

  // ---------------- 유저 비교 ----------------
  function renderCompare() {
    const box = $('#compare'); if (!box) return;
    if (sim.errors.length) { box.innerHTML = '<div class="card"><p class="muted">입력 오류를 먼저 고치세요.</p></div>'; return; }
    const u = ui();
    const opts = metricOptions(true);
    if (!u.cmpMetric || !opts.some(([v]) => v === u.cmpMetric)) u.cmpMetric = opts[0] ? opts[0][0] : '';
    const withEv = !!u.cmpEvents;
    const evs = withEv ? project.events.filter(e => e.enabled !== false) : [];
    const runs = project.players.map(pl => ({ pl, r: AB.simulate(project, { playerId: pl.id, events: evs }) }));
    const g = metricGet(u.cmpMetric);
    const ms = mainState();
    const unl = project.modules.filter(m => (m.unlock || []).length);
    const finals = runs.map(x => g(x.r.series[x.r.series.length - 1]));
    const minV = Math.min(...finals.filter(v => v > 0)), maxV = Math.max(...finals);
    box.innerHTML = `<div class="card"><div class="row-head"><h2>유저 유형 비교</h2><div class="controls">
        <select data-ui="cmpMetric">${opts.map(([v, l]) => `<option value="${v}" ${v === u.cmpMetric ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <label class="check small"><input type="checkbox" data-ui-check="cmpEvents" ${withEv ? 'checked' : ''}> 이벤트 포함</label></div></div>
      <p class="desc">같은 밸런스${withEv ? '와 같은 이벤트' : ''}로 유저 유형만 바꿔 계산합니다. 유저 유형은 ‘유저 모델’에서 추가·수정할 수 있습니다.</p>
      <div class="chart-box" id="cmpChart"></div><div class="legend" id="cmpLegend"></div></div>
      <div class="card"><h2>유형별 결과 (${project.sim.days}일)</h2><div class="table-scroll"><table class="cmp"><thead><tr><th>유저</th><th>하루 접속</th><th>${esc(metricLabel(u.cmpMetric))}</th>${ms ? `<th>최종 ${esc(ms.name)}</th>` : ''}${unl.map(m => `<th>${esc(m.name)} 해금</th>`).join('')}</tr></thead><tbody>
        ${runs.map((x, i) => `<tr><td><span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${esc(x.pl.name)}</td><td class="num">${x.pl.onlineMin}분</td><td class="num">${fmt(finals[i])}</td>${ms ? `<td class="num">${fmt(x.r.final.S[ms.id])}</td>` : ''}${unl.map(m => `<td class="num">${fmtDur(x.r.unlockAt[m.id])}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>
      ${runs.length > 1 && minV > 0 && isFinite(maxV) ? `<p class="small muted" style="margin-top:8px">가장 높은 유형과 낮은 유형의 ${esc(metricLabel(u.cmpMetric))} 격차: <b>${(maxV / minV).toFixed(2)}배</b> (${fmt(minV)} ~ ${fmt(maxV)})</p>` : ''}
      ${runs.some(x => !x.r.reliable) ? '<div class="banner err">일부 유형의 계산 결과를 신뢰할 수 없습니다.</div>' : ''}</div>`;
    drawChart($('#cmpChart'), $('#cmpLegend'), runs.map((x, i) => ({ name: x.pl.name, color: PALETTE[i % PALETTE.length], pts: x.r.series.map(s => [s.t, g(s)]) })),
      { totalMin: runs[0].r.totalMin, title: metricLabel(u.cmpMetric), shades: withEv ? eventShades(evs) : [] });
  }

  // ---------------- 가져오기·내보내기 ----------------
  function dataHtml() {
    return `<div class="card"><h2>내보내기</h2><p class="desc">프로젝트 전체 구조는 JSON으로 저장·복원합니다. 결과 CSV는 시간별 기록, 조정 입력값 CSV는 목표 밸런싱 화면에서 내려받습니다.</p>
      <div class="row"><button type="button" class="btn" data-act="export-cur">프로젝트 JSON 내보내기</button><button type="button" class="btn" data-act="csv-results">시뮬레이션 결과 CSV</button></div></div>
      <div class="card"><h2>가져오기</h2><p class="desc">JSON 파일을 새 프로젝트로 불러옵니다 (지금 프로젝트는 바뀌지 않습니다).</p><button type="button" class="btn" data-act="import">JSON 불러오기</button></div>
      <div class="card"><h2>프로젝트 관리</h2><div class="row"><button type="button" class="btn" data-act="dup" data-id="${project.id}">이 프로젝트 복제</button><button type="button" class="btn danger" data-act="remove" data-id="${project.id}">이 프로젝트 삭제</button></div></div>`;
  }
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        let p;
        if (obj && obj.schema === 2 && Array.isArray(obj.resources) && Array.isArray(obj.modules)) p = obj;
        else if (obj && obj.params && obj.params.dungeons) p = v1ToProject(obj);
        else throw new Error('오토 밸런싱 프로젝트 파일이 아닙니다.');
        p = { ...PR.blankProject(), ...p };
        p.id = PR.uid('p');
        p.meta = { ...(p.meta || {}), setupDone: p.meta ? p.meta.setupDone !== false : true };
        for (const k of ['resources', 'states', 'stats', 'modules', 'links', 'players', 'events']) if (!Array.isArray(p[k])) p[k] = [];
        if (!p.players.length) p.players = PR.blankProject().players;
        if (!p.players.some(x => x.id === p.activePlayer)) p.activePlayer = p.players[0].id;
        createAndOpen(p);
      } catch (e) { alert('불러오기 실패: ' + e.message); }
    };
    reader.readAsText(file);
  }
  function v1ToProject(v1state) {
    const p = AB.fromV1(v1state.params, v1state.events || []);
    p.id = PR.uid('p');
    p.name = 'v1에서 가져온 프로젝트';
    p.players = [...PR.blankProject().players.filter(x => x.id !== 'pl_normal'), { ...p.players[0], id: 'pl_v1', name: 'v1 유저 모델' }];
    p.activePlayer = 'pl_v1';
    p.meta = { setupDone: true, wizardStep: 6, sample: true };
    p.createdAt = p.updatedAt = new Date().toISOString();
    return p;
  }

  // ---------------- 클릭 처리 ----------------
  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (el.tagName === 'A') e.preventDefault();
    switch (act) {
      case 'new-blank': createAndOpen(PR.blankProject('새 프로젝트')); break;
      case 'new-preset': createAndOpen(PR.idleRpgPreset()); break;
      case 'sample': { const p = PR.sampleProject(); Store.save(p); location.hash = `#/ws/${p.id}/overview`; break; }
      case 'import': $('#fileInput').click(); break;
      case 'import-v1': { try { createAndOpen(v1ToProject(JSON.parse(localStorage.getItem('autoBalancing.v1')))); } catch (er) { alert('가져오기 실패: ' + er.message); } break; }
      case 'open': openProject(el.dataset.id); break;
      case 'dup': { const p = Store.load(el.dataset.id); if (p) { p.id = PR.uid('p'); p.name += ' (복제)'; p.createdAt = new Date().toISOString(); Store.save(p); if (project) location.hash = `#/ws/${p.id}/overview`; else render(); } break; }
      case 'export': { const p = Store.load(el.dataset.id); if (p) exportJson(p); break; }
      case 'export-cur': exportJson(project); break;
      case 'remove': { const x = Store.index().find(i => i.id === el.dataset.id); if (x && confirm(`‘${x.name}’ 프로젝트를 삭제할까요? 되돌릴 수 없습니다. (필요하면 먼저 JSON으로 내보내세요)`)) { Store.remove(x.id); if (project && project.id === x.id) location.hash = '#/'; else render(); } break; }
      case 'wiz-go': { const s = +el.dataset.step; if (s >= 0) { Store.save(project); location.hash = `#/wizard/${project.id}/${s}`; } break; }
      case 'wiz-finish': { if (sim.errors.length) return; project.meta.setupDone = true; Store.save(project); location.hash = `#/ws/${project.id}/results`; break; }
      case 'quick-resources': { const q = QUICK.resources[+el.dataset.i]; addResource(q[0], q[1], q[2]); changed(true); break; }
      case 'quick-states': { const q = QUICK.states[+el.dataset.i]; addState(q[0], q[1], q[2]); changed(true); break; }
      case 'quick-stats': { const q = QUICK.stats[+el.dataset.i]; addStat(q[0], q[1], q[2]); changed(true); break; }
      case 'add-resources': addResource(); changed(true); break;
      case 'add-states': addState(); changed(true); break;
      case 'add-stats': addStat(); changed(true); break;
      case 'del-entity': deleteEntity(el.dataset.coll, el.dataset.id); break;
      case 'add-module': newModule(el.dataset.type, el.dataset.tpl); changed(true); break;
      case 'dup-module': { const m = project.modules.find(x => x.id === el.dataset.id); if (m) { const c = clone(m); c.id = uid('m', project.modules); c.name += ' (복제)'; project.modules.splice(project.modules.indexOf(m) + 1, 0, c); changed(true); } break; }
      case 'del-module': deleteEntity('modules', el.dataset.id); break;
      case 'add-line': {
        const m = project.modules.find(x => x.id === el.dataset.mod), list = el.dataset.list;
        m[list] = m[list] || [];
        if (list === 'unlock') m.unlock.push({ ref: (project.states[0] || {}).id || '', min: 10 });
        else m[list].push({ resourceId: firstRes(), amount: list === 'cost' && (m.type === 'levelup' || m.type === 'upgrade') ? { type: 'exp', base: 100, growth: 1.07, offset: 0 } : { type: 'const', base: list === 'cost' ? 1 : 100 } });
        changed(true); break;
      }
      case 'del-line': { const m = project.modules.find(x => x.id === el.dataset.mod); m[el.dataset.list].splice(+el.dataset.i, 1); changed(true); break; }
      case 'add-link': newLink(); changed(true); break;
      case 'del-link': project.links = project.links.filter(l => l.id !== el.dataset.id); changed(true); break;
      case 'add-player': project.players.push({ id: uid('pl', project.players), name: '새 유저 유형', onlineMin: 60, loginAt: 0, useDungeons: true, autoUpgrade: true, upgradeMode: 'roundRobin' }); changed(true); break;
      case 'add-event': newEvent(el.dataset.type); changed(true); break;
      case 'del-event': project.events = project.events.filter(x => x.id !== el.dataset.id); changed(true); break;
      case 'csv-results': resultsCsv(); break;
      case 'goal-run': if (!goalRunning) runGoal(); break;
      case 'goal-apply': goalApply(); break;
      case 'goal-csv': goalCsv(); break;
      case 'goal-copy': { if (!goalResult || !goalResult.project) return; const p = clone(goalResult.project); p.id = PR.uid('p'); p.name = project.name + ' (목표 밸런싱 적용안)'; Store.save(p); alert(`‘${p.name}’으로 저장했습니다. 홈의 프로젝트 목록에서 열 수 있습니다.`); break; }
    }
  }
  function onUiChange(e) {
    const el = e.target;
    if (!project) return;
    if (el.dataset.ui) {
      if (e.type === 'input' && el.tagName === 'SELECT') return;
      ui()[el.dataset.ui] = el.type === 'number' ? Number(el.value) : el.value;
      saveSoon();
      if (el.dataset.ui === 'msValue') renderTimeline(); else renderLive();
      return;
    }
    if (el.dataset.uiCheck && e.type === 'change') { ui()[el.dataset.uiCheck] = el.checked; saveSoon(); renderLive(); return; }
    if (el.id === 'goalFilter') { goalFilter = el.value; const pos = el.selectionStart; renderGoal(); const f = $('#goalFilter'); if (f) { f.focus(); try { f.setSelectionRange(pos, pos); } catch (er) { /* 무시 */ } } return; }
    if (el.dataset.goal) {
      if (e.type === 'input' && el.tagName === 'SELECT') return;
      const g = goalCfg();
      const k = el.dataset.goal;
      g[k] = ['value', 'targetDays', 'targetHours', 'budget'].includes(k) ? Number(el.value) : el.value;
      saveSoon();
      if (el.tagName === 'SELECT') renderGoal();
      return;
    }
    if (el.dataset.goalvar && e.type === 'change') {
      const g = goalCfg(); const k = el.dataset.goalvar;
      const p = AB.listParams(project).find(x => x.key === k);
      const [lo, hi] = defaultRange(k, p ? p.value : 0);
      g.vars[k] = { ...(g.vars[k] || { min: lo, max: hi }), on: el.checked };
      saveSoon(); renderGoal(); return;
    }
    if (el.dataset.goalmin || el.dataset.goalmax) {
      const g = goalCfg(); const k = el.dataset.goalmin || el.dataset.goalmax;
      g.vars[k] = g.vars[k] || { on: true };
      g.vars[k][el.dataset.goalmin ? 'min' : 'max'] = el.value === '' ? NaN : Number(el.value);
      saveSoon(); return;
    }
  }
  function onSegClick(e) {
    const b = e.target.closest('[data-ui-seg]');
    if (!b || !project) return;
    ui()[b.dataset.uiSeg] = b.dataset.v; saveSoon(); renderLive();
  }

  // ---------------- 라우터 ----------------
  function render() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    if (h[0] === 'wizard' || h[0] === 'ws') {
      const id = h[1];
      if (!project || project.id !== id) {
        const p = Store.load(id);
        if (!p) { location.hash = '#/'; return; }
        project = p;
        project.meta = project.meta || {};
        sim = { base: null, evt: null, errors: [], warnings: [], ms: 0, stale: true };
        goalResult = null;
      }
      if (h[0] === 'wizard') renderWizard(+h[2] || 0);
      else renderWorkspace(h[2] || 'overview');
    } else renderHome();
  }

  document.addEventListener('click', onClick);
  document.addEventListener('click', onSegClick);
  $('#app').addEventListener('input', e => { onInput(e); onUiChange(e); });
  $('#app').addEventListener('change', e => { onInput(e); onUiChange(e); });
  $('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
  window.addEventListener('hashchange', () => { if (project) Store.save(project); render(); window.scrollTo(0, 0); });
  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(renderLive, 150); });
  window.addEventListener('beforeunload', () => { if (project) Store.save(project); });
  render();
})();
