// v2 엔진 단위 테스트: 기존 v1 테스트의 검증 의도 + 모듈 조합형 신규 기능
// 실행: node --test tests/*.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const AB = require('../v2/engine.js');

const DAY = 1440;
const clone = o => JSON.parse(JSON.stringify(o));
const C = base => ({ type: 'const', base });

// 손으로 계산하기 쉬운 최소 프로젝트: 골드만 있고 사냥터 1개(분당 10G)
function base(over) {
  const p = {
    schema: 2, id: 't', name: 't', sim: { days: 3 },
    resources: [
      { id: 'gold', name: '골드', initial: 0, cap: null },
      { id: 'exp', name: '경험치', initial: 0, cap: null },
      { id: 'ruby', name: '루비', initial: 0, cap: null },
      { id: 'ticket', name: '입장권', initial: 0, cap: null },
    ],
    states: [
      { id: 'lv', name: '레벨', initial: 1, max: 300 },
      { id: 'enh', name: '강화', initial: 0, max: 1000 },
      { id: 'skill', name: '스킬 레벨', initial: 0, max: 100 },
    ],
    stats: [{ id: 'atk', name: '공격력', base: 10 }, { id: 'hp', name: '체력', base: 100 }],
    modules: [
      { id: 'hunt', type: 'hunt', name: '사냥', killsPerMin: 1, rewards: [{ resourceId: 'gold', amount: C(10) }] },
    ],
    links: [],
    players: [{ id: 'pl', name: '유저', onlineMin: 60, loginAt: 0, useDungeons: true, autoUpgrade: true, upgradeMode: 'roundRobin' }],
    activePlayer: 'pl',
    events: [],
  };
  if (over) over(p);
  return p;
}
const mod = (p, m) => { p.modules.push(m); return p; };
const sim = (p, events) => AB.simulate(p, { events: events || [] });
const at = (r, t) => r.series.find(s => s.t === t);
const ok = r => Object.values(r.check).every(c => c.ok);

// ---------- 기존 검증 의도 ----------

test('고정 수급량이 시간에 따라 정확히 누적된다', () => {
  const r = sim(base());
  assert.equal(r.ledger.gold.gain.hunt, 60 * 10 * 3);
  assert.equal(r.final.R.gold, 1800);
  assert.ok(ok(r));
});

test('재화가 부족하면 강화하지 않고, 충분하면 강화한다', () => {
  const p = base(p => mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(1e9) }] }));
  assert.equal(sim(p).final.S.enh, 0);
  p.modules[1].cost[0].amount = C(400);
  const r = sim(p);
  assert.equal(r.final.S.enh, 4);
  assert.equal(r.ledger.gold.spend.up, 1600);
  assert.ok(ok(r));
});

test('경험치가 충분하면 여러 레벨을 한 번에 올린다', () => {
  const p = base(p => {
    mod(p, { id: 'daily', type: 'periodic', name: '출석', period: 'daily', gen: 'login', claim: 'instant', fill: 'add', rewards: [{ resourceId: 'exp', amount: C(1050) }] });
    mod(p, { id: 'lvup', type: 'levelup', name: '레벨업', target: 'lv', cost: [{ resourceId: 'exp', amount: C(100) }] });
  });
  const r = sim(p);
  assert.equal(r.reach.lv[11], 0);
  assert.equal(at(r, 60).S.lv, 11);
  assert.equal(r.final.S.lv, 32); // 3150 EXP → 31레벨
  assert.ok(ok(r));
});

test('던전: 해금 전 이용 불가, 입장권만큼만 이용, 사냥 시간과 중복 없음', () => {
  const p = base(p => {
    mod(p, { id: 'tk', type: 'periodic', name: '충전', period: 'daily', gen: 'auto', claim: 'instant', fill: 'refill', rewards: [{ resourceId: 'ticket', amount: C(2) }] });
    mod(p, { id: 'dg', type: 'dungeon', name: '던전', priority: 1, unlock: [], cost: [{ resourceId: 'ticket', amount: C(1) }], durationMin: 5, rewards: [{ resourceId: 'gold', amount: C(1000) }] });
  });
  const r = sim(p);
  assert.equal(r.runs.dg, 6);
  assert.equal(r.ledger.gold.gain.dg, 6000);
  assert.equal(r.ledger.gold.gain.hunt, (60 - 10) * 10 * 3);
  const q = clone(p); q.modules[2].unlock = [{ ref: 'lv', min: 99 }];
  assert.equal(sim(q).runs.dg, 0);
  assert.equal(sim(q).unlockAt.dg, null);
});

test('던전 하루 횟수 제한이 지켜진다', () => {
  const p = base(p => {
    p.resources[3].initial = 100;
    mod(p, { id: 'dg', type: 'dungeon', name: '던전', priority: 1, cost: [{ resourceId: 'ticket', amount: C(1) }], durationMin: 2, dailyLimit: 3, rewards: [{ resourceId: 'gold', amount: C(1) }] });
  });
  assert.equal(sim(p).runs.dg, 9);
});

test('해금 조건이 정확히 적용되고 해금 시각이 기록된다', () => {
  const p = base(p => {
    mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(100) }] });
    mod(p, { id: 'h2', type: 'hunt', name: '사냥터2', priority: 5, unlock: [{ ref: 'enh', min: 3 }], killsPerMin: 1, rewards: [{ resourceId: 'gold', amount: C(50) }] });
  });
  const r = sim(p);
  assert.equal(r.unlockAt.h2, r.reach.enh[3]);
  assert.ok(r.ledger.gold.gain.h2 > 0);
});

test('이벤트 시작·종료 시점이 정확하다', () => {
  const r = sim(base(), [{ type: 'rewardMult', startDay: 2, days: 1, value: 2, resourceId: '', moduleId: '' }]);
  assert.equal(at(r, DAY).G.gold, 600);
  assert.equal(at(r, 2 * DAY).G.gold - at(r, DAY).G.gold, 1200);
  assert.equal(at(r, 3 * DAY).G.gold - at(r, 2 * DAY).G.gold, 600);
});

test('재화 지급 이벤트는 한 번만 지급되고, 접속 수령이면 접속할 때 받는다', () => {
  const r = sim(base(), [{ type: 'grant', startDay: 2, value: 5000, resourceId: 'ruby', claim: 'instant' }]);
  assert.equal(r.ledger.ruby.gain.event, 5000);
  const p = base(p => { p.players[0].onlineMin = 0; });
  const q = sim(p, [{ type: 'grant', startDay: 1, value: 5000, resourceId: 'ruby', claim: 'login' }]);
  assert.equal(q.final.R.ruby, 0);
  assert.equal(q.pendingUnclaimed.ruby, 5000);
});

test('이벤트 종료 후에도 성장 결과가 유지된다', () => {
  const p = base(p => mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(100) }] }));
  p.sim.days = 5;
  const b = sim(p), e = sim(p, [{ type: 'rewardMult', startDay: 1, days: 1, value: 3 }]);
  assert.equal(e.final.S.enh - b.final.S.enh, 12); // 첫날 추가 1200G = 12단계, 이후 유지
});

test('조건부 이벤트는 조건을 넘은 유저에게 적용되지 않는다', () => {
  const r = sim(base(), [{ type: 'rewardMult', startDay: 1, days: 3, value: 2, cond: { ref: 'lv', max: 0.5 } }]);
  // cond.max가 0 이하이면 조건 없음으로 본다 → 0.5는 레벨 1보다 작음 → 미적용
  assert.equal(r.ledger.gold.gain.hunt, 1800);
});

test('강화 할인이 적용되고 겹친 할인은 곱으로 합쳐진다', () => {
  const p = base(p => mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(400) }] }));
  const e = sim(p, [{ type: 'costDiscount', startDay: 1, days: 3, value: 50 }, { type: 'costDiscount', startDay: 1, days: 3, value: 50 }]);
  assert.equal(e.final.S.enh, 18);
});

test('방치 보상은 한도까지만 쌓이고 접속할 때 받는다 (접속 0분이면 미수령)', () => {
  const p = base(p => mod(p, { id: 'idle', type: 'idle', name: '방치', mode: 'fromHunt', huntId: 'hunt', ratePct: 50, capHours: 8 }));
  const r = sim(p);
  assert.equal(r.ledger.gold.gain.idle, 2400 * 2);
  assert.equal(r.pendingUnclaimed.gold, 2400);
  p.players[0].onlineMin = 0;
  const q = sim(p);
  assert.equal(q.final.R.gold, 0);
  assert.equal(q.pendingUnclaimed.gold, 2400);
});

test('접속 0분: 출석은 발생하지 않고, 자동 지급·충전은 발생한다', () => {
  const p = base(p => {
    p.players[0].onlineMin = 0;
    mod(p, { id: 'att', type: 'periodic', name: '출석', period: 'daily', gen: 'login', claim: 'instant', fill: 'add', rewards: [{ resourceId: 'gold', amount: C(100) }] });
    mod(p, { id: 'auto', type: 'periodic', name: '자동', period: 'daily', gen: 'auto', claim: 'instant', fill: 'add', rewards: [{ resourceId: 'ruby', amount: C(10) }] });
    mod(p, { id: 'mail', type: 'periodic', name: '우편', period: 'daily', gen: 'auto', claim: 'login', fill: 'add', rewards: [{ resourceId: 'exp', amount: C(7) }] });
    mod(p, { id: 'tk', type: 'periodic', name: '충전', period: 'daily', gen: 'auto', claim: 'instant', fill: 'refill', rewards: [{ resourceId: 'ticket', amount: C(2) }] });
  });
  const r = sim(p);
  assert.equal(r.final.R.gold, 0);
  assert.equal(r.final.R.ruby, 30);
  assert.equal(r.final.R.exp, 0);
  assert.equal(r.pendingUnclaimed.exp, 21);  // 우편함에 쌓임
  assert.equal(r.final.R.ticket, 2);          // 충전은 한도까지만
});

test('원본 프로젝트는 시뮬레이션으로 바뀌지 않고, 같은 입력은 같은 결과를 낸다', () => {
  const p = base(); const before = JSON.stringify(p);
  const ev = [{ type: 'rewardMult', startDay: 1, days: 1, value: 2 }];
  const a = sim(p, ev), b = sim(p, ev);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(a.series, b.series);
});

test('수치가 폭주하면 신뢰 불가로 표시하고 멈추지 않는다', () => {
  const p = base(p => { p.modules[0].rewards[0].amount = { type: 'exp', base: 10, growth: 1e10, ref: 'enh', offset: 0 };
    mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(1) }] }); });
  const r = sim(p);
  assert.equal(r.reliable, false);
  assert.ok(r.issues.length > 0);
});

test('비용이 0이어도 최대치에서 멈춘다 (무한 루프 없음)', () => {
  const p = base(p => { p.states[1].max = 500; mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(0) }] }); });
  assert.equal(sim(p).final.S.enh, 500);
});

// ---------- v2 신규 기능 ----------

test('사용자 정의 상태(스킬 레벨)와 재화(루비): 강화 모듈이 공격력이 아닌 다른 상태를 올린다', () => {
  const p = base(p => {
    p.resources[2].initial = 50;
    mod(p, { id: 'sk', type: 'upgrade', name: '스킬 강화', target: 'skill', cost: [{ resourceId: 'ruby', amount: { type: 'linear', base: 5, growth: 5, offset: 0 } }] });
  });
  const r = sim(p);
  // 비용 5, 10, 15, 20 → 합 50 → 4레벨
  assert.equal(r.final.S.skill, 4);
  assert.equal(r.final.R.ruby, 0);
  assert.equal(r.final.T.atk, 10); // 공격력은 그대로
});

test('연결 규칙: 스킬 레벨당 자동사냥 보상 +2% (선형)', () => {
  const p = base(p => {
    p.states[2].initial = 10;
    p.links.push({ id: 'l1', ref: 'skill', target: { kind: 'module', id: 'hunt' }, effect: 'reward', mode: 'linear', value: 2, offset: 0 });
  });
  assert.equal(Math.round(sim(p).ledger.gold.gain.hunt), Math.round(1800 * 1.2));
});

test('연결 규칙: 특정 재화에만 적용', () => {
  const p = base(p => {
    p.modules[0].rewards.push({ resourceId: 'exp', amount: C(10) });
    p.states[2].initial = 10;
    p.links.push({ id: 'l1', ref: 'skill', target: { kind: 'module', id: 'hunt', resourceId: 'exp' }, effect: 'reward', mode: 'linear', value: 10, offset: 0 });
  });
  const r = sim(p);
  assert.equal(r.ledger.gold.gain.hunt, 1800);
  assert.equal(Math.round(r.ledger.exp.gain.hunt), 3600);
});

test('연결 규칙: 능력치 가산·복리 배율 (레벨당 체력 +20, 강화당 공격력 +10%)', () => {
  const p = base(p => {
    p.states[0].initial = 6; p.states[1].initial = 2;
    p.links.push({ id: 'a', ref: 'lv', target: { kind: 'stat', id: 'hp' }, effect: 'add', mode: 'linear', value: 20, offset: 1 });
    p.links.push({ id: 'b', ref: 'enh', target: { kind: 'stat', id: 'atk' }, effect: 'mult', mode: 'compound', value: 10, offset: 0 });
  });
  const r = sim(p);
  assert.equal(r.final.T.hp, 200);
  assert.ok(Math.abs(r.final.T.atk - 12.1) < 1e-9);
});

test('연결 규칙: 공격력 → 처치 속도 (비율 모드, 최대 배율 제한)', () => {
  const p = base(p => {
    p.stats[0].base = 400;
    p.links.push({ id: 's', ref: 'atk', target: { kind: 'module', id: 'hunt' }, effect: 'speed', mode: 'ratio', value: 0.5, base: 100, max: 1.5 });
  });
  // (400/100)^0.5 = 2 → 최대 1.5배
  assert.equal(sim(p).ledger.gold.gain.hunt, 1800 * 1.5);
});

test('연결 규칙: 스킬 레벨당 강화 비용 −10% (하한 5%)', () => {
  const p = base(p => {
    p.states[2].initial = 5;
    mod(p, { id: 'up', type: 'upgrade', name: '강화', target: 'enh', cost: [{ resourceId: 'gold', amount: C(200) }] });
    p.links.push({ id: 'c', ref: 'skill', target: { kind: 'module', id: 'up' }, effect: 'cost', mode: 'linear', value: -10, offset: 0 });
  });
  assert.equal(sim(p).final.S.enh, 18); // 비용 100G → 1800G로 18회
});

test('진행 모듈: 능력치가 요구치를 넘으면 상태가 오른다 (스테이지)', () => {
  const p = base(p => {
    p.states.push({ id: 'stage', name: '스테이지', initial: 1, max: 100 });
    p.stats[0].base = 25;
    mod(p, { id: 'pg', type: 'progress', name: '진행', target: 'stage', stat: 'atk', req: { type: 'linear', base: 10, growth: 5, offset: 1 } });
  });
  // 요구치: 2단계 15, 3단계 20, 4단계 25, 5단계 30 → 공격력 25면 4단계
  assert.equal(sim(p).final.S.stage, 4);
});

test('보유 한도를 넘는 재화는 사라지고 잔액 검증은 유지된다', () => {
  const p = base(p => { p.resources[0].cap = 1000; });
  const r = sim(p);
  assert.equal(r.final.R.gold, 1000);
  assert.equal(r.ledger.gold.spend.__cap, 800);
  assert.ok(ok(r));
});

test('강화 모듈 여러 개: 돌아가며 강화 vs 우선순위 강화', () => {
  const p = base(p => {
    mod(p, { id: 'u1', type: 'upgrade', name: 'A', priority: 2, target: 'enh', cost: [{ resourceId: 'gold', amount: C(100) }] });
    mod(p, { id: 'u2', type: 'upgrade', name: 'B', priority: 1, target: 'skill', cost: [{ resourceId: 'gold', amount: C(100) }] });
  });
  const rr = sim(p);
  assert.equal(rr.final.S.enh + rr.final.S.skill, 18);
  assert.ok(Math.abs(rr.final.S.enh - rr.final.S.skill) <= 1);
  p.players[0].upgradeMode = 'priority';
  const pr = sim(p);
  assert.equal(pr.final.S.enh, 18);
  assert.equal(pr.final.S.skill, 0);
});

test('사냥터가 여러 개면 해금된 것 중 우선순위가 가장 높은 곳만 이용한다', () => {
  const p = base(p => mod(p, { id: 'h2', type: 'hunt', name: '사냥터2', priority: 9, unlock: [], killsPerMin: 1, rewards: [{ resourceId: 'gold', amount: C(30) }] }));
  const r = sim(p);
  assert.equal(r.ledger.gold.gain.h2, 5400);
  assert.equal(r.ledger.gold.gain.hunt || 0, 0);
});

test('주간·N시간 주기 보상', () => {
  const p = base(p => {
    p.sim.days = 14;
    mod(p, { id: 'wk', type: 'periodic', name: '주간', period: 'weekly', gen: 'auto', claim: 'instant', fill: 'add', rewards: [{ resourceId: 'ruby', amount: C(100) }] });
    mod(p, { id: 'h6', type: 'periodic', name: '6시간', period: 'hours', everyHours: 6, gen: 'auto', claim: 'instant', fill: 'add', rewards: [{ resourceId: 'exp', amount: C(1) }] });
  });
  const r = sim(p);
  assert.equal(r.ledger.ruby.gain.wk, 200);
  assert.equal(r.ledger.exp.gain.h6, 14 * 4);
});

test('접속 시작 시각(loginAt)을 바꿔도 접속 시간과 수급량이 같다', () => {
  const p = base(p => { p.players[0].loginAt = 20 * 60; });
  const r = sim(p);
  // 1일 20:00~21:00, 2일, 3일 → 3번 (마지막 날도 21:00 전 종료)
  assert.equal(r.ledger.gold.gain.hunt, 1800);
});

// ---------- 검증 ----------

test('검증: 끊긴 참조·중복 ID·능력치끼리 연결·초기값 > 최대값을 잡아낸다', () => {
  const p = base(p => {
    p.states[0].initial = 400;
    p.modules.push({ id: 'hunt', type: 'hunt', name: '중복', killsPerMin: 1, rewards: [{ resourceId: 'nope', amount: C(1) }] });
    p.links.push({ id: 'x', ref: 'atk', target: { kind: 'stat', id: 'hp' }, effect: 'add', mode: 'linear', value: 1 });
  });
  const msgs = AB.validateProject(p).errors.map(e => e.msg).join(' | ');
  assert.match(msgs, /초기값은 최대값/);
  assert.match(msgs, /중복/);
  assert.match(msgs, /보상 재화/);
  assert.match(msgs, /능력치끼리는 연결할 수 없습니다/);
});

test('검증: 정상 프로젝트는 오류가 없고, 쓰이지 않는 재화는 경고만 한다', () => {
  const v = AB.validateProject(base());
  assert.equal(v.errors.length, 0);
  assert.ok(v.warnings.some(w => /쓰이지 않습니다/.test(w.msg)));
});
