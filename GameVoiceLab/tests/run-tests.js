/*
 * Game Voice Lab — 집계·검증 테스트 (Node, 외부 의존성 없음)
 * 실행: node tests/run-tests.js
 * QA ID와 1:1로 대응한다. 화면 표시가 필요한 항목(QA-012 등)은 브라우저 점검으로 별도 기록한다.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const A = require('../js/analytics.js');
const L = require('../js/data-loader.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const load = () => Object.fromEntries(L.FILES.map(k => [k, JSON.parse(fs.readFileSync(path.join(DATA_DIR, k + '.json'), 'utf8'))]));
const clone = x => JSON.parse(JSON.stringify(x));

// ---- 손계산용 소형 픽스처 (설명용 가상 데이터, 실제 데이터 아님) ----
function fixture() {
  const categories = [
    { categoryId: 'CAT-A', name: '가', scope: '' },
    { categoryId: 'CAT-B', name: '나', scope: '' },
  ];
  const keywords = [
    { keyword: 'k-a', categoryId: 'CAT-A', aliases: [] },
    { keyword: 'k-b', categoryId: 'CAT-B', aliases: [] },
  ];
  const games = [{ gameId: 'g1', name: '게임1', storeListings: [] }];
  const collections = [{ collectionId: 'C1', gameId: 'g1', platform: 'Google Play' }];
  const rv = (id, rating, date, dataType = 'sample') => ({
    reviewId: id, externalReviewId: 'x-' + id, gameId: 'g1', collectionId: 'C1', platform: 'Google Play', rating,
    originalText: null, summary: 's', publishedAt: date, publishedAtRaw: date, collectedAt: '2026-11-26',
    sourceUrl: 'https://example.com/' + id, appVersion: null, dataType,
  });
  const op = (id, reviewId, cat, sentiment, otherType = null, status = 'unreviewed') => ({
    opinionId: id, reviewId, categoryId: cat, sentiment, otherType, keyword: cat === 'CAT-A' ? 'k-a' : 'k-b',
    summary: 's', evidenceText: 'e', verificationStatus: status, holdReason: status === 'on_hold' ? '사유' : null,
  });
  // 리뷰 3건: 5점(2026-01-01), 2점(2026-01-05), 별점 없음(작성일 없음)
  const reviews = [rv('R1', 5, '2026-01-01'), rv('R2', 2, '2026-01-05'), rv('R3', null, null)];
  // 의견 5건: R1 = A긍정 + B부정, R2 = A부정, R3 = B기타-건의 + A기타-질문
  const opinions = [
    op('O1', 'R1', 'CAT-A', 'positive'),
    op('O2', 'R1', 'CAT-B', 'negative'),
    op('O3', 'R2', 'CAT-A', 'negative'),
    op('O4', 'R3', 'CAT-B', 'other', 'suggestion'),
    op('O5', 'R3', 'CAT-A', 'other', 'question', 'on_hold'),
  ];
  return { reviews, opinions, categories, keywords, games, collections };
}

const results = [];
function qa(id, name, fn) {
  try { fn(); results.push([id, name, 'PASS', '']); }
  catch (e) { results.push([id, name, 'FAIL', e.message]); }
}

// QA-001 유효한 데이터 정상 등록
qa('QA-001', '실제 데이터 불러오기·검증', () => {
  const d = load();
  const v = L.validateData(d);
  assert.deepStrictEqual(v.errors, []);
  assert.strictEqual(d.reviews.length, 60);
  assert.strictEqual(d.opinions.length, 111);
  const fx = L.validateData(fixture());
  assert.deepStrictEqual(fx.errors, []);
});

// QA-002 중복 리뷰 검출
qa('QA-002', '중복 리뷰 검출', () => {
  const d = fixture();
  d.reviews.push(clone(d.reviews[0]));
  assert.ok(L.validateData(d).errors.some(e => e.includes('중복 리뷰 ID')));
  const d2 = fixture();
  const dup = clone(d2.reviews[0]); dup.reviewId = 'R9';
  d2.reviews.push(dup); d2.opinions.push({ ...clone(d2.opinions[0]), opinionId: 'O9', reviewId: 'R9' });
  assert.ok(L.validateData(d2).errors.some(e => e.includes('동일 스토어 리뷰 중복')));
});

// QA-003 리뷰 수와 의견 수 구분
qa('QA-003', '복수 의견 리뷰: 리뷰 수 ≠ 의견 수', () => {
  const d = fixture();
  const f = A.applyFilters(d, {});
  assert.strictEqual(A.reviewStats(f.reviews).count, 3);
  assert.strictEqual(A.sentimentStats(f.opinions).total, 5);
  const real = load();
  const fr = A.applyFilters(real, { dataType: 'actual' });
  assert.strictEqual(A.reviewStats(fr.reviews).count, 60);
  assert.strictEqual(A.sentimentStats(fr.opinions).total, 111);
});

// QA-004 평균 별점 손계산: (5+2)/2 = 3.5 / 실제 데이터 220/60
qa('QA-004', '평균 별점 손계산 일치', () => {
  const s = A.reviewStats(fixture().reviews);
  assert.strictEqual(s.avg, 3.5);
  assert.strictEqual(A.fmtAvg(s.avg), '3.50');
  const r = A.reviewStats(load().reviews);
  assert.strictEqual(r.ratingSum, 220);
  assert.strictEqual(A.fmtAvg(r.avg), '3.67');
  assert.deepStrictEqual([1, 2, 3, 4, 5].map(k => r.dist[k].count), [15, 1, 7, 3, 34]);
});

// QA-005 별점 누락: 리뷰 수에는 포함, 평균·분포 분모에서 제외
qa('QA-005', '별점 누락 리뷰 평균 제외', () => {
  const s = A.reviewStats(fixture().reviews);
  assert.strictEqual(s.count, 3);
  assert.strictEqual(s.ratedCount, 2);
  assert.strictEqual(s.unratedCount, 1);
  assert.strictEqual(A.fmtPct(s.dist[5].pct), '50.0%');
  assert.strictEqual(A.reviewStats([]).avg, null);
  assert.strictEqual(A.fmtAvg(null), 'N/A');
});

// QA-006 감성 비율: 픽스처 1/2/2 of 5, 실제 49/51/11 of 111
qa('QA-006', '감성 비율 = 실제 의견 수', () => {
  const s = A.sentimentStats(fixture().opinions);
  assert.deepStrictEqual([s.positive.count, s.negative.count, s.other.count], [1, 2, 2]);
  assert.strictEqual(A.fmtPct(s.positive.pct), '20.0%');
  assert.strictEqual(A.fmtPct(s.other.pct), '40.0%');
  const r = A.sentimentStats(load().opinions);
  assert.deepStrictEqual([r.positive.count, r.negative.count, r.other.count], [49, 51, 11]);
  assert.deepStrictEqual([A.fmtPct(r.positive.pct), A.fmtPct(r.negative.pct), A.fmtPct(r.other.pct)], ['44.1%', '45.9%', '9.9%']);
  assert.strictEqual(A.fmtPct(A.pct(0, 0)), 'N/A');
});

// QA-007 카테고리 통계: 비중과 내부 비율 구분, 합계 일치
qa('QA-007', '카테고리 교차 집계', () => {
  const d = fixture();
  const rows = A.categoryStats(d.opinions, d.categories);
  const a = rows.find(r => r.categoryId === 'CAT-A');
  assert.deepStrictEqual([a.total, a.positive, a.negative, a.other], [3, 1, 1, 1]);
  assert.strictEqual(A.fmtPct(a.share), '60.0%');        // 전체 5건 대비
  assert.strictEqual(A.fmtPct(a.positivePct), '33.3%');  // 카테고리 내부 3건 대비
  const real = load();
  const rr = A.categoryStats(real.opinions, real.categories);
  assert.strictEqual(rr.reduce((s, r) => s + r.total, 0), 111);
  const tech = rr.find(r => r.categoryId === 'CAT-007');
  assert.deepStrictEqual([tech.total, tech.positive, tech.negative, tech.other], [16, 2, 14, 0]);
  const content = rr.find(r => r.categoryId === 'CAT-005');
  assert.deepStrictEqual([content.total, content.positive, content.negative, content.other], [5, 2, 2, 1]);
  for (const r of rr) assert.strictEqual(r.positive + r.negative + r.other, r.total);
});

// QA-008 키워드 빈도
qa('QA-008', '키워드 빈도 = 의견 수', () => {
  const real = load();
  const neg = A.keywordStats(real.opinions, real.keywords, 'negative');
  assert.deepStrictEqual(neg.slice(0, 2).map(k => [k.keyword, k.count]), [['진행 데이터 손실', 6], ['비정상 종료', 5]]);
  const pos = A.keywordStats(real.opinions, real.keywords, 'positive');
  assert.deepStrictEqual(pos.slice(0, 2).map(k => [k.keyword, k.count]), [['전반적 만족', 14], ['재미', 13]]);
  assert.strictEqual(A.keywordStats(real.opinions, real.keywords).reduce((s, k) => s + k.count, 0), 111);
  assert.strictEqual(neg.reduce((s, k) => s + k.count, 0), 51);
});

// QA-009 건의 사항: 기타에 포함, 별도 조회, 중복 합산 없음
qa('QA-009', '건의 사항 조회', () => {
  const s = A.sentimentStats(fixture().opinions);
  assert.strictEqual(s.otherTypes.suggestion.count, 1);
  assert.strictEqual(s.positive.count + s.negative.count + s.other.count, s.total);
  const real = load();
  const sug = A.otherOpinions(real.opinions, 'suggestion');
  assert.strictEqual(sug.length, 6);
  assert.ok(sug.every(o => o.sentiment === 'other'));
});

// QA-010 필터링 (19.12 기준값 + B-03 기간 규칙)
qa('QA-010', '필터링 결과·리뷰 KPI 좁힘', () => {
  const real = load();
  const check = (f, ops, revs, sum, dist) => {
    const r = A.applyFilters(real, Object.assign({ dataType: 'actual' }, f));
    const st = A.reviewStats(r.reviews);
    assert.strictEqual(r.opinions.length, ops, JSON.stringify(f) + ' opinions');
    assert.strictEqual(st.count, revs, JSON.stringify(f) + ' reviews');
    assert.strictEqual(st.ratingSum, sum, JSON.stringify(f) + ' sum');
    assert.deepStrictEqual([1, 2, 3, 4, 5].map(k => st.dist[k].count), dist, JSON.stringify(f) + ' dist');
  };
  check({}, 111, 60, 220, [15, 1, 7, 3, 34]);
  check({ categoryId: 'CAT-007' }, 16, 14, 44, [5, 0, 2, 2, 5]);
  check({ sentiment: 'negative' }, 51, 31, 79, [15, 1, 5, 3, 7]);
  check({ sentiment: 'positive' }, 49, 33, 155, [0, 0, 4, 2, 27]);
  check({ categoryId: 'CAT-003', sentiment: 'negative' }, 10, 8, 22, [3, 1, 1, 1, 2]);
  check({ categoryId: 'CAT-005' }, 5, 4, 13, [1, 1, 0, 0, 2]);
  check({ categoryId: 'CAT-010' }, 4, 4, 20, [0, 0, 0, 0, 4]);
  // 리뷰 단위 필터
  const g = A.applyFilters(real, { dataType: 'actual', gameId: 'maple', platform: 'App Store' });
  assert.strictEqual(g.reviews.length, 10);
  assert.ok(g.reviews.every(r => r.gameId === 'maple' && r.platform === 'App Store'));
  const rt = A.applyFilters(real, { dataType: 'actual', rating: 1 });
  assert.strictEqual(rt.reviews.length, 15);
  // 기간: 양 끝 포함(KST)
  const p = A.applyFilters(real, { dataType: 'actual', dateFrom: '2026-11-20', dateTo: '2026-11-25' });
  assert.strictEqual(p.reviews.length, 20);
  const edge = A.applyFilters(real, { dataType: 'actual', dateFrom: '2025-12-02', dateTo: '2025-12-02' });
  assert.deepStrictEqual(edge.reviews.map(r => r.reviewId), ['R-MK-A04']);
  // 작성일 없는 리뷰는 기간 필터 시 제외되고 건수 표시
  const fx = A.applyFilters(fixture(), { dateFrom: '2026-01-01' });
  assert.strictEqual(fx.reviews.length, 2);
  assert.strictEqual(fx.excludedNoDate, 1);
  // 기타 세부 유형 필터
  const q = A.applyFilters(fixture(), { sentiment: 'other', otherType: 'question' });
  assert.deepStrictEqual(q.opinions.map(o => o.opinionId), ['O5']);
  assert.deepStrictEqual(q.reviews.map(r => r.reviewId), ['R3']);
});

// QA-011 원본 리뷰 연결
qa('QA-011', '의견 ↔ 원본 리뷰 연결', () => {
  const real = load();
  const rv = A.indexBy(real.reviews, 'reviewId');
  for (const o of real.opinions) {
    const r = rv[o.reviewId];
    assert.ok(r, o.opinionId);
    assert.ok(o.opinionId.startsWith('O-' + r.reviewId.slice(2) + '-'), o.opinionId);
    assert.ok(typeof o.evidenceText === 'string' && Array.from(o.evidenceText).length <= 40, o.opinionId);
  }
  const gp = real.reviews.filter(r => r.platform === 'Google Play');
  assert.ok(gp.every(r => r.sourceUrl.includes('reviewId=' + r.externalReviewId)));
  assert.strictEqual(A.opinionsOfReview(real, 'R-MK-A01').length, 6);
});

// QA-013 빈 데이터
qa('QA-013', '빈 데이터 오류 없이 처리', () => {
  const d = { reviews: [], opinions: [], categories: fixture().categories, keywords: [], games: [], collections: [] };
  assert.deepStrictEqual(L.validateData(d).errors, []);
  const f = A.applyFilters(d, {});
  const rs = A.reviewStats(f.reviews), ss = A.sentimentStats(f.opinions);
  assert.strictEqual(rs.count, 0);
  assert.strictEqual(A.fmtAvg(rs.avg), 'N/A');
  assert.strictEqual(A.fmtPct(ss.positive.pct), 'N/A');
  assert.ok(A.categoryStats(f.opinions, d.categories).every(r => r.share === null && r.total === 0));
  assert.deepStrictEqual(A.keywordStats(f.opinions, d.keywords), []);
});

// QA-014 잘못된 데이터 검출
qa('QA-014', '잘못된 데이터 검출', () => {
  const cases = [
    ['별점 범위', d => { d.reviews[0].rating = 7; }, '별점'],
    ['날짜 형식', d => { d.reviews[0].publishedAt = '2026/01/01'; }, 'publishedAt'],
    ['없는 리뷰 참조', d => { d.opinions[0].reviewId = 'R-none'; }, '없는 reviewId'],
    ['없는 카테고리', d => { d.opinions[0].categoryId = 'CAT-Z'; }, '없는 categoryId'],
    ['잘못된 감성', d => { d.opinions[0].sentiment = 'good'; }, 'sentiment'],
    ['기타 세부유형 누락', d => { d.opinions[3].otherType = null; }, 'otherType'],
    ['사전에 없는 키워드', d => { d.opinions[0].keyword = 'nope'; }, '키워드 사전'],
    ['보류 사유 누락', d => { d.opinions[4].holdReason = null; }, 'holdReason'],
    ['잘못된 상태값', d => { d.opinions[0].verificationStatus = 'done'; }, 'verificationStatus'],
    ['발췌 길이 초과', d => { d.opinions[0].evidenceText = 'ㄱ'.repeat(41); }, 'evidenceText'],
    ['배열 아님', d => { d.reviews = {}; }, '배열'],
  ];
  for (const [name, mut, needle] of cases) {
    const d = fixture(); mut(d);
    const v = L.validateData(d);
    assert.ok(v.errors.some(e => e.includes(needle)), name + ': ' + JSON.stringify(v.errors));
  }
});

// QA-015 데이터 변경 시 재집계
qa('QA-015', '데이터 변경 후 재집계', () => {
  const d = fixture();
  assert.strictEqual(A.sentimentStats(d.opinions).negative.count, 2);
  d.opinions[2].sentiment = 'positive';
  assert.strictEqual(A.sentimentStats(d.opinions).negative.count, 1);
  d.reviews[1].rating = 4;
  assert.strictEqual(A.reviewStats(d.reviews).avg, 4.5);
});

// QA-016 외부 AI API 의존성 없음: JS·HTML에 외부 호스트 호출이 없어야 함
qa('QA-016', '외부(유료 AI) API 호출 없음', () => {
  const root = path.join(__dirname, '..');
  const files = ['index.html', ...fs.readdirSync(path.join(root, 'js')).map(f => 'js/' + f)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/fetch\(\s*['"`]https?:/i.test(src), f + ': 외부 fetch');
    assert.ok(!/(openai|anthropic|api\.|googleapis|XMLHttpRequest)/i.test(src), f + ': 외부 API 문자열');
    assert.ok(!/<script[^>]+src=["']https?:/i.test(src), f + ': 외부 스크립트');
  }
});

// QA-017 실제·샘플 혼합 집계 방지
qa('QA-017', '실제·샘플 데이터 분리', () => {
  const real = load();
  const mixed = clone(real);
  const s = clone(fixture());
  // 샘플 리뷰를 실제 데이터 세트에 섞어도 dataType 필터로 분리되는지
  mixed.reviews.push(...s.reviews.map(r => ({ ...r, gameId: 'maple', collectionId: 'C-maple-google' })));
  mixed.opinions.push(...s.opinions.map(o => ({ ...o, categoryId: 'CAT-012', keyword: '재미' })));
  const v = L.validateData(mixed);
  assert.deepStrictEqual(v.errors, []);
  assert.ok(v.warnings.some(w => w.includes('실제·샘플')));
  assert.strictEqual(A.applyFilters(mixed, { dataType: 'actual' }).reviews.length, 60);
  assert.strictEqual(A.applyFilters(mixed, { dataType: 'actual' }).opinions.length, 111);
  assert.strictEqual(A.applyFilters(mixed, { dataType: 'sample' }).reviews.length, 3);
  assert.ok(real.reviews.every(r => r.dataType === 'actual'));
});

// ---- report ----
const w = Math.max(...results.map(r => r[1].length));
for (const [id, name, st, msg] of results) console.log(`${st === 'PASS' ? '✔' : '✘'} ${id} ${name.padEnd(w)} ${st}${msg ? '  → ' + msg : ''}`);
const failed = results.filter(r => r[2] !== 'PASS').length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
