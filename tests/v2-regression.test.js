// v1 엔진(index.html)과 v2 엔진(v2/engine.js)이 같은 입력에서 같은 결과를 내는지 확인하는 회귀 테스트
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.split('// ===== ENGINE START =====')[1].split('// ===== ENGINE END =====')[0];
const V1 = new Function(code + '\nreturn { Engine, SAMPLE };')();
const AB = require('../v2/engine.js');
const clone = o => JSON.parse(JSON.stringify(o));

const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const srcMap = { hunt: 'm_hunt', offline: 'm_idle', daily: 'm_daily', event: 'event', dungeon0: 'm_dungeon0', dungeon1: 'm_dungeon1' };

function compare(v1p, v1Events, label) {
  const a = V1.Engine.simulate(clone(v1p), clone(v1Events));
  const proj = AB.fromV1(clone(v1p), clone(v1Events));
  assert.equal(AB.validateProject(proj).errors.length, 0, label + ' 검증 오류: ' + JSON.stringify(AB.validateProject(proj).errors));
  const b = AB.simulate(proj, { events: proj.events });
  assert.equal(a.series.length, b.series.length, label + ' 기록 수');
  for (let i = 0; i < a.series.length; i++) {
    const s = a.series[i], q = b.series[i];
    const where = `${label} t=${s.t}`;
    assert.equal(q.S.st_level, s.level, where + ' level');
    assert.equal(q.S.st_enh, s.enh, where + ' enh');
    assert.equal(q.S.st_stage, s.stage, where + ' stage');
    assert.ok(close(q.T.stat_atk, s.atk), where + ' atk');
    assert.ok(close(q.R.res_gold, s.gold), where + ` gold ${s.gold} vs ${q.R.res_gold}`);
    assert.ok(close(q.R.res_exp, s.exp), where + ' exp');
    assert.ok(close(q.G.res_gold, s.goldGain), where + ' goldGain');
    assert.ok(close(q.X.res_gold, s.goldSpend), where + ' goldSpend');
  }
  for (const cur of ['gold', 'exp']) {
    for (const [k, v] of Object.entries(a.ledger[cur].gain)) {
      assert.ok(close(b.ledger['res_' + cur].gain[srcMap[k]] || 0, v), `${label} ${cur} ${k}`);
    }
  }
  a.dungeons.forEach((d, i) => {
    assert.equal(b.unlockAt['m_dungeon' + i], d.unlockAt, `${label} unlock ${i}`);
    assert.equal(b.runs['m_dungeon' + i], d.runs, `${label} runs ${i}`);
  });
  assert.ok(close(b.pendingUnclaimed.res_gold, a.pendingUnclaimed.gold), label + ' pending');
  assert.equal(b.reliable, a.reliable, label + ' reliable');
  return { a, b };
}

test('샘플 프로젝트: 유저 3종 × 7·30일에서 v1과 v2 결과가 같다', () => {
  for (const onlineMin of [0, 30, 120, 480, 1440]) for (const days of [7, 30]) {
    const p = clone(V1.SAMPLE); p.player.onlineMin = onlineMin; p.sim.days = days;
    compare(p, [], `online=${onlineMin} days=${days}`);
  }
});

test('이벤트 4종을 넣어도 v1과 v2 결과가 같다', () => {
  const p = clone(V1.SAMPLE); p.sim.days = 14;
  const events = [
    { type: 'expMult', startDay: 3, days: 3, value: 2, levelMax: 0 },
    { type: 'grant', currency: 'gold', startDay: 2, days: 1, value: 1000000, levelMax: 0 },
    { type: 'discount', startDay: 4, days: 3, value: 30, levelMax: 0 },
    { type: 'tickets', startDay: 1, days: 7, value: 2, levelMax: 100 },
    { type: 'goldMult', startDay: 6, days: 2, value: 1.5, levelMax: 0 },
  ];
  compare(p, events, 'events');
});

test('정책·해금 조건을 바꿔도 v1과 v2 결과가 같다', () => {
  const p = clone(V1.SAMPLE);
  p.player.useDungeons = false; compare(p, [], 'no dungeon');
  const q = clone(V1.SAMPLE); q.player.autoEnhance = false; compare(q, [], 'no enhance');
  const r = clone(V1.SAMPLE); r.dungeons[0].unlockType = 'atk'; r.dungeons[0].unlockValue = 5000; r.dungeons[1].reward = 'gold'; compare(r, [], 'atk unlock');
  const s = clone(V1.SAMPLE); s.start.level = 50; s.start.gold = 1e6; compare(s, [], 'start level');
});
