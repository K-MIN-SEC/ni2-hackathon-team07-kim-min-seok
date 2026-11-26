// 목표 기반 자동 밸런싱 테스트
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AB = require('../v2/engine.js');
const O = require('../v2/optimize.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.split('// ===== ENGINE START =====')[1].split('// ===== ENGINE END =====')[0];
const V1 = new Function(code + '\nreturn { Engine, SAMPLE };')();
const DAY = 1440;
const sample = () => AB.fromV1(JSON.parse(JSON.stringify(V1.SAMPLE)), []);
const EXP_REWARD = 'modules/m_hunt/rewards/res_exp/amount/base';
const LV_GROWTH = 'modules/m_level/cost/res_exp/amount/growth';

// 조정 변수 외에는 아무것도 바뀌지 않았는지 확인
function onlyVarsChanged(before, after, keys) {
  const a = JSON.parse(JSON.stringify(before)), b = JSON.parse(JSON.stringify(after));
  for (const k of keys) { O.setParam(a, k, 0); O.setParam(b, k, 0); }
  assert.deepEqual(b, a);
}

test('변수 1개(단조): 이분 탐색으로 “이내 달성” 목표를 맞추고 재시뮬레이션으로 검증한다', async () => {
  const p = sample();
  const goal = { type: 'state', stateId: 'st_level', value: 130, targetMin: 4 * DAY, mode: 'within' };
  const r = await O.optimize(p, goal, [{ key: EXP_REWARD, min: 2, max: 20 }], { budget: 200 });
  assert.match(r.method, /이분 탐색/);
  assert.equal(r.verified, true);
  assert.ok(r.verifyTime <= goal.targetMin);
  // 결과 프로젝트로 직접 다시 계산해도 같은 결과
  const again = AB.simulate(r.project, { days: r.horizonDays });
  assert.equal(AB.reachTime(again, 'st_level', 130), r.verifyTime);
  assert.ok(r.baseline.time > goal.targetMin);  // 기존에는 미달성이었음
  onlyVarsChanged(p, r.project, [EXP_REWARD]);
});

test('“이내 달성”은 가능한 한 적게 바꾼다 (이미 달성 중이면 바꾸지 않음)', async () => {
  const p = sample();
  const goal = { type: 'state', stateId: 'st_level', value: 130, targetMin: 7 * DAY, mode: 'within' };
  const r = await O.optimize(p, goal, [{ key: EXP_REWARD, min: 2, max: 20 }], { budget: 100 });
  assert.equal(r.verified, true);
  assert.equal(r.best.values[0].value, 4);
  assert.equal(r.best.change, 0);
});

test('변수 여러 개: 각자 범위 안에서, 서로 다른 방향으로 움직일 수 있다 (“최대한 가깝게”)', async () => {
  const p = sample();
  const goal = { type: 'state', stateId: 'st_level', value: 130, targetMin: 5 * DAY, mode: 'closest' };
  const vars = [{ key: EXP_REWARD, min: 2, max: 20 }, { key: LV_GROWTH, min: 1.07, max: 1.11 }];
  const r = await O.optimize(p, goal, vars, { budget: 200 });
  assert.match(r.method, /그리드/);
  assert.equal(r.verified, true);
  assert.ok(Math.abs(r.verifyTime - goal.targetMin) <= r.toleranceMin);
  r.best.values.forEach((v, i) => { assert.ok(v.value >= vars[i].min && v.value <= vars[i].max, v.key + ' 범위'); });
  onlyVarsChanged(p, r.project, vars.map(v => v.key));
});

test('감소 방향 범위도 지원한다 (필요 경험치 배율만 낮춰서 목표 달성)', async () => {
  const p = sample();
  const goal = { type: 'state', stateId: 'st_level', value: 130, targetMin: 4 * DAY, mode: 'within' };
  const r = await O.optimize(p, goal, [{ key: LV_GROWTH, min: 1.05, max: 1.09 }], { budget: 120 });
  assert.equal(r.verified, true);
  assert.ok(r.best.values[0].value < 1.09);
});

test('던전 해금 목표: 해금 조건 수치를 조정한다', async () => {
  const p = sample();
  const goal = { type: 'unlock', moduleId: 'm_dungeon1', targetMin: 2 * DAY, mode: 'within' };
  const r = await O.optimize(p, goal, [{ key: 'modules/m_dungeon1/unlock/0/min', min: 60, max: 105, int: true }], { budget: 100 });
  assert.equal(r.verified, true);
  assert.ok(Number.isInteger(r.best.values[0].value));
  assert.ok(r.verifyTime <= 2 * DAY);
});

test('허용 범위 안에서 불가능하면 실패로 표시하고 적용할 수정안을 주지 않는다', async () => {
  const p = sample();
  const goal = { type: 'state', stateId: 'st_level', value: 130, targetMin: 1 * DAY, mode: 'within' };
  const r = await O.optimize(p, goal, [{ key: EXP_REWARD, min: 3.9, max: 4.1 }], { budget: 60 });
  assert.equal(r.verified, false);
  assert.equal(r.project, null);
  assert.ok(r.candidateProject);
});

test('기간 안에 도달하지 못하는 목표도 늘린 기간으로 평가한다', async () => {
  const p = sample(); p.sim.days = 7;
  const goal = { type: 'state', stateId: 'st_level', value: 170, targetMin: 20 * DAY, mode: 'closest' };
  const r = await O.optimize(p, goal, [{ key: EXP_REWARD, min: 2, max: 20 }], { budget: 120 });
  assert.ok(r.horizonDays >= 21);
  assert.equal(r.verified, true);
});

test('신뢰 불가 결과를 내는 후보는 채택하지 않는다', async () => {
  const p = sample();
  const goal = { type: 'state', stateId: 'st_level', value: 300, targetMin: 2 * DAY, mode: 'within' };
  // 사냥 보상 배율이 극단적으로 커지면 수치가 폭주한다
  const r = await O.optimize(p, goal, [{ key: 'modules/m_hunt/rewards/res_exp/amount/growth', min: 1.08, max: 1e6 }, { key: 'modules/m_stage/req/growth', min: 1.0, max: 1.1 }], { budget: 80 });
  assert.ok(r.rejectedUnreliable > 0);
  if (r.verified) assert.equal(r.verifyReliable, true);
});

test('원본 프로젝트는 탐색으로 바뀌지 않는다', async () => {
  const p = sample(); const before = JSON.stringify(p);
  await O.optimize(p, { type: 'state', stateId: 'st_level', value: 130, targetMin: 4 * DAY, mode: 'within' }, [{ key: EXP_REWARD, min: 2, max: 20 }], { budget: 60 });
  assert.equal(JSON.stringify(p), before);
});

test('조정 가능한 수치 목록은 ID 경로로 읽고 쓸 수 있다', () => {
  const p = sample();
  const list = O.listParams(p);
  assert.ok(list.length > 20);
  for (const item of list) assert.equal(O.getParam(p, item.key), item.value, item.key);
});
