// 오토 밸런싱 엔진 검증 테스트
// 실행: node --test tests/
// index.html 안의 ENGINE START ~ ENGINE END 구간을 그대로 꺼내서 검사한다 (화면과 같은 코드).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.split('// ===== ENGINE START =====')[1].split('// ===== ENGINE END =====')[0];
const { Engine, SAMPLE } = new Function(code + '\nreturn { Engine, SAMPLE };')();

const DAY = 1440;
const clone = o => JSON.parse(JSON.stringify(o));
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

// 계산을 손으로 확인하기 쉬운 "고정 수치" 프로젝트: 스테이지가 오르지 않고, 보상이 일정하다.
function flat(over = {}) {
  const p = clone(SAMPLE);
  p.sim.days = 3;
  p.hunt = { killsPerMin: 1, goldPerKill: 10, expPerKill: 0, rewardGrowth: 1 };
  p.stage = { reqAtkBase: 10, reqAtkGrowth: 3, maxStage: 1000 }; // 2스테이지 요구 공격력 30
  p.atk = { base: 10, perLevel: 0, enhancePct: 0 };
  p.level = { expBase: 1e12, expGrowth: 1, maxLevel: 300 };
  p.offline = { ratePct: 0, capHours: 8 };
  p.daily = { gold: 0, exp: 0 };
  p.player = { onlineMin: 60, useDungeons: false, autoEnhance: false };
  p.dungeons[0] = { ...p.dungeons[0], unlockType: 'level', unlockValue: 1, ticketsPerDay: 2, runMin: 5, rewardBase: 1000, rewardGrowth: 1 };
  p.dungeons[1] = { ...p.dungeons[1], unlockType: 'level', unlockValue: 99999 };
  for (const [k, v] of Object.entries(over)) {
    const ks = k.split('.'); let x = p;
    while (ks.length > 1) x = x[ks.shift()];
    x[ks[0]] = v;
  }
  return p;
}
const goldAt = (r, t) => r.series.find(s => s.t === t).goldGain;

test('고정 수급량이 시간에 따라 정확히 누적된다', () => {
  const r = Engine.simulate(flat({ 'daily.gold': 1000 }));
  // 하루 60분 × 10G + 일일 1000G, 3일
  assert.equal(r.ledger.gold.gain.hunt, 60 * 10 * 3);
  assert.equal(r.ledger.gold.gain.daily, 3000);
  assert.equal(r.final.gold, 1800 + 3000);
});

test('수급과 소모 후 재화 잔액이 일치한다 (샘플 프로젝트, 이벤트 포함)', () => {
  for (const onlineMin of [30, 120, 480]) {
    const p = clone(SAMPLE); p.player.onlineMin = onlineMin; p.sim.days = 30;
    const r = Engine.simulate(p, [{ type: 'expMult', startDay: 3, days: 3, value: 2 }, { type: 'grant', currency: 'gold', startDay: 2, value: 1e6 }]);
    assert.ok(r.check.gold.ok, 'gold'); assert.ok(r.check.exp.ok, 'exp');
    assert.ok(r.ledger.gold.spend.enhance > 0);
  }
});

test('재화가 부족하면 강화하지 않는다', () => {
  const r = Engine.simulate(flat({ 'player.autoEnhance': true, 'enhance.costBase': 1e9 }));
  assert.equal(r.final.enh, 0);
  assert.equal(r.ledger.gold.spend.enhance, 0);
  assert.equal(r.final.gold, 1800);
});

test('경험치가 충분하면 여러 레벨을 한 번에 올린다', () => {
  const r = Engine.simulate(flat({ 'level.expBase': 100, 'level.expGrowth': 1, 'daily.exp': 1050 }));
  // 첫 접속(0분)에 1050 EXP → 10레벨 상승, 50 EXP 남음
  assert.equal(r.levelAt[11], 0);
  assert.equal(r.levelAt[12], DAY); // 다음 날 접속에서 1100 → 11번 더 (총 21레벨)
  assert.equal(r.series.find(s => s.t === 60).level, 11); // series[0]은 첫 접속 전 상태
  assert.equal(r.series.find(s => s.t === DAY + 60).level, 22);
  assert.ok(r.check.exp.ok);
});

test('던전 해금 조건이 정확히 적용된다', () => {
  const p = clone(SAMPLE);
  const r = Engine.simulate(p);
  const gold = r.dungeons[0]; // 레벨 조건
  assert.equal(gold.unlockAt, r.levelAt[gold.unlockValue]);
  const exp = r.dungeons[1]; // 스테이지 조건
  assert.equal(exp.unlockAt, r.stageAt[exp.unlockValue]);
  assert.notEqual(gold.unlockAt, null); assert.notEqual(exp.unlockAt, null);
});

test('해금 전 던전은 이용할 수 없다', () => {
  const r = Engine.simulate(flat({ 'player.useDungeons': true, 'dungeons.0.unlockValue': 99999 }));
  assert.equal(r.dungeons[0].runs, 0);
  assert.equal(r.dungeons[0].unlockAt, null);
});

test('하루 입장권 수만큼만 던전을 이용한다', () => {
  const r = Engine.simulate(flat({ 'player.useDungeons': true, 'sim.days': 5 }));
  assert.equal(r.dungeons[0].runs, 2 * 5);
  assert.equal(r.ledger.gold.gain.dungeon0, 1000 * 10);
});

test('던전 시간과 사냥 시간이 중복 계산되지 않는다', () => {
  const r = Engine.simulate(flat({ 'player.useDungeons': true }));
  // 하루 60분 중 던전 2회 × 5분 = 10분은 사냥 보상이 없다
  assert.equal(r.ledger.gold.gain.hunt, (60 - 10) * 10 * 3);
});

test('남은 접속 시간이 모자라면 던전에 들어가지 않는다', () => {
  const r = Engine.simulate(flat({ 'player.useDungeons': true, 'player.onlineMin': 4 }));
  assert.equal(r.dungeons[0].runs, 0);
});

test('성장한 공격력이 이후 사냥 효율에 반영된다', () => {
  const p = clone(SAMPLE);
  const r = Engine.simulate(p);
  const firstHour = goldAt(r, 60) - r.series[0].goldGain;
  const day = r.series.find(s => s.t === 6 * DAY);
  // 7일 차 첫 1시간 사냥(던전 제외) 골드는 1일 차 첫 1시간보다 많아야 한다
  const p2 = clone(p); p2.player.useDungeons = false; p2.daily.gold = 0;
  const r2 = Engine.simulate(p2);
  const h1 = goldAt(r2, 60) - goldAt(r2, 0);
  const h7 = r2.series.find(s => s.t === 6 * DAY + 60).goldGain - r2.series.find(s => s.t === 6 * DAY).goldGain;
  assert.ok(day.stage > r.series[0].stage);
  assert.ok(h7 > h1 * 10, `h1=${h1} h7=${h7}`);
  assert.ok(firstHour > 0);
});

test('이벤트 시작·종료 시점이 정확하다 (2일 차 하루만 골드 2배)', () => {
  const r = Engine.simulate(flat(), [{ type: 'goldMult', startDay: 2, days: 1, value: 2 }]);
  const d1 = goldAt(r, DAY) - goldAt(r, 0);
  const d2 = goldAt(r, 2 * DAY) - goldAt(r, DAY);
  const d3 = goldAt(r, 3 * DAY) - goldAt(r, 2 * DAY);
  assert.equal(d1, 600); assert.equal(d2, 1200); assert.equal(d3, 600);
});

test('재화 지급 이벤트는 시작일에 한 번만 지급된다', () => {
  const r = Engine.simulate(flat(), [{ type: 'grant', currency: 'gold', startDay: 2, days: 5, value: 5000 }]);
  assert.equal(r.ledger.gold.gain.event, 5000);
  assert.equal(goldAt(r, DAY), 600);         // 1일 차 끝: 지급 전
  assert.equal(goldAt(r, DAY + 60), 600 + 5000 + 600); // 2일 차 접속 때 지급 + 2일 차 1시간 사냥
});

test('이벤트 종료 후에도 영구 성장 결과가 유지된다', () => {
  const p = clone(SAMPLE); p.sim.days = 14;
  const base = Engine.simulate(p);
  const evt = Engine.simulate(p, [{ type: 'expMult', startDay: 2, days: 3, value: 3 }]);
  const endT = 4 * DAY;
  assert.ok(evt.series.find(s => s.t === endT).level > base.series.find(s => s.t === endT).level);
  assert.ok(evt.final.level >= base.final.level);
});

test('레벨 조건 이벤트는 조건을 넘은 유저에게 적용되지 않는다', () => {
  const p = flat({ 'level.expBase': 100, 'level.expGrowth': 1, 'daily.exp': 1000 }); // 첫 접속에 11레벨
  const r = Engine.simulate(p, [{ type: 'goldMult', startDay: 1, days: 3, value: 2, levelMax: 5 }]);
  assert.equal(r.ledger.gold.gain.hunt, 1800); // 배율 미적용
});

test('강화 비용 할인이 적용되고, 겹친 할인은 곱으로 합쳐진다', () => {
  const p = flat({ 'player.autoEnhance': true, 'enhance.costBase': 400, 'enhance.costGrowth': 1, 'enhance.maxEnh': 1000 });
  const base = Engine.simulate(p);
  const evt = Engine.simulate(p, [{ type: 'discount', startDay: 1, days: 3, value: 50 }, { type: 'discount', startDay: 1, days: 3, value: 50 }]);
  // 할인 75% → 비용 100G, 총 1800G → 18회 / 기준 400G → 4회
  assert.equal(base.final.enh, 4);
  assert.equal(evt.final.enh, 18);
});

test('방치 보상은 최대 누적 시간까지만 쌓이고 다음 접속 때 받는다', () => {
  const r = Engine.simulate(flat({ 'offline.ratePct': 50, 'offline.capHours': 8 }));
  // 하루 오프라인 1380분 중 480분만 → 480 × 10G × 0.5 = 2400G, 접속은 2일 차·3일 차 2번
  assert.equal(r.ledger.gold.gain.offline, 2400 * 2);
  assert.equal(r.pendingUnclaimed.gold, 2400); // 마지막 날 쌓였지만 못 받은 보상
});

test('원본 설정은 시뮬레이션·이벤트 실험으로 바뀌지 않는다', () => {
  const p = clone(SAMPLE); const before = JSON.stringify(p);
  const evs = [{ type: 'expMult', startDay: 1, days: 3, value: 2 }]; const evBefore = JSON.stringify(evs);
  Engine.simulate(p, evs);
  assert.equal(JSON.stringify(p), before);
  assert.equal(JSON.stringify(evs), evBefore);
});

test('같은 입력은 항상 같은 결과를 낸다', () => {
  const a = Engine.simulate(clone(SAMPLE), [{ type: 'goldMult', startDay: 2, days: 2, value: 1.5 }]);
  const b = Engine.simulate(clone(SAMPLE), [{ type: 'goldMult', startDay: 2, days: 2, value: 1.5 }]);
  assert.deepEqual(a.series, b.series);
});

test('수치가 무한대로 커져도 엔진이 멈추지 않는다', () => {
  const p = clone(SAMPLE);
  p.hunt.rewardGrowth = 3; p.stage.reqAtkGrowth = 1; p.stage.maxStage = 100000; p.sim.days = 30;
  const r = Engine.simulate(p);
  assert.ok(r.series.length > 0);
  assert.ok(r.overflow || r.guardHit || isFinite(r.final.gold));
});

test('비용이 0이어도 최대 강화 단계에서 멈춘다 (무한 루프 없음)', () => {
  const r = Engine.simulate(flat({ 'player.autoEnhance': true, 'enhance.costBase': 0, 'enhance.maxEnh': 500 }));
  assert.equal(r.final.enh, 500);
});

// ---- P0 버그 수정 검증 (2026-11-26 추가) ----

test('접속 0분이면 출석·방치 보상을 받지 않고, 방치 보상은 한도까지만 쌓인다', () => {
  const r = Engine.simulate(flat({ 'player.onlineMin': 0, 'daily.gold': 1000, 'offline.ratePct': 50, 'offline.capHours': 8 }));
  assert.equal(r.ledger.gold.gain.daily, 0);
  assert.equal(r.ledger.gold.gain.offline, 0);
  assert.equal(r.ledger.gold.gain.hunt, 0);
  assert.equal(r.final.gold, 0);
  assert.equal(r.pendingUnclaimed.gold, 480 * 10 * 0.5); // 3일이 지나도 8시간 한도에서 멈춤
});

test('접속 0분이어도 입장권 충전·이벤트 지급은 발생한다 (던전은 이용 못 함)', () => {
  const p = flat({ 'player.onlineMin': 0, 'player.useDungeons': true, 'level.expBase': 100, 'level.expGrowth': 1 });
  const r = Engine.simulate(p, [{ type: 'grant', currency: 'exp', startDay: 1, value: 1000 }]);
  assert.equal(r.ledger.exp.gain.event, 1000);
  assert.equal(r.final.level, 11);        // 지급된 경험치로 자동 레벨업
  assert.equal(r.dungeons[0].runs, 0);    // 접속하지 않으니 던전은 이용하지 않음
  assert.ok(r.check.exp.ok);
});

test('시작 레벨이 최대 레벨을 넘으면 관계 검증 오류가 난다', () => {
  const p = clone(SAMPLE); p.start.level = 400; p.level.maxLevel = 300;
  const errs = Engine.validateRelations(p, []);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].path, 'start.level');
  assert.equal(Engine.validateRelations(clone(SAMPLE), []).length, 0);
});

test('이벤트 시작일이 시뮬레이션 기간을 넘으면 관계 검증 오류가 난다', () => {
  const p = clone(SAMPLE); p.sim.days = 7;
  const errs = Engine.validateRelations(p, [{ type: 'goldMult', startDay: 10, days: 1, value: 2 }]);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].key, 'startDay');
});

test('정상 샘플은 신뢰 가능, 수치가 폭주하면 신뢰 불가로 표시하고 이유를 남긴다', () => {
  assert.equal(Engine.simulate(clone(SAMPLE)).reliable, true);
  const p = clone(SAMPLE);
  p.hunt.rewardGrowth = 3; p.stage.reqAtkGrowth = 1.0001; p.stage.maxStage = 100000; p.sim.days = 30;
  const r = Engine.simulate(p);
  assert.equal(r.reliable, false);
  assert.ok(r.issues.length > 0);
});

test('필요 경험치가 무한대가 되는 설정도 신뢰 불가로 표시한다', () => {
  const p = clone(SAMPLE); p.level.expGrowth = 3; p.level.maxLevel = 100000;
  p.daily.exp = 1e308; // 매우 큰 지급
  const r = Engine.simulate(p);
  assert.equal(r.reliable, false);
});
