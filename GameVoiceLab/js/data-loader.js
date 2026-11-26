/*
 * Game Voice Lab — 데이터 로더 및 검증 (FUNC-001, SPEC-001, SPEC-010)
 * validateData는 순수 함수이며 Node 테스트에서도 사용한다.
 */
(function (root) {
  'use strict';

  var FILES = ['reviews', 'opinions', 'categories', 'keywords', 'games', 'collections'];
  var PLATFORMS = ['Google Play', 'App Store'];
  var DATA_TYPES = ['actual', 'sample'];
  var SENTIMENTS = ['positive', 'negative', 'other'];
  var OTHER_TYPES = ['suggestion', 'neutral', 'question', 'unknown'];
  var STATUSES = ['unreviewed', 'verified', 'corrected', 'on_hold'];
  var EXCERPT_MAX = 40;
  var SAMPLE_ROLES = ['distribution', 'supplement'];
  var LABEL_SOURCES = ['gvl_manual', 'team_rule', 'team_ai'];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isStr(v) { return typeof v === 'string' && v.trim() !== ''; }
  function isStrOrNull(v) { return v === null || typeof v === 'string'; }

  /**
   * 데이터 형식·참조 검증. errors가 하나라도 있으면 화면은 집계를 표시하지 않는다(QA-014).
   * @returns {{errors: string[], warnings: string[]}}
   */
  function validateData(d) {
    var errors = [];
    var warnings = [];
    function err(m) { if (errors.length < 200) errors.push(m); }

    FILES.forEach(function (k) {
      if (!Array.isArray(d[k])) err(k + '.json: 배열이 아닙니다');
    });
    if (errors.length) return { errors: errors, warnings: warnings };

    var cats = {}, games = {}, cols = {}, kws = {}, revs = {}, ops = {}, ext = {};
    d.categories.forEach(function (c, i) {
      if (!isStr(c.categoryId) || !isStr(c.name)) err('categories[' + i + ']: categoryId/name 누락');
      else if (cats[c.categoryId]) err('categories: 중복 ID ' + c.categoryId);
      else cats[c.categoryId] = c;
    });
    d.games.forEach(function (g, i) {
      if (!isStr(g.gameId) || !isStr(g.name)) err('games[' + i + ']: gameId/name 누락');
      else if (games[g.gameId]) err('games: 중복 ID ' + g.gameId);
      else games[g.gameId] = g;
    });
    d.collections.forEach(function (c, i) {
      var id = c.collectionId || ('[' + i + ']');
      if (!isStr(c.collectionId)) { err('collections[' + i + ']: collectionId 누락'); return; }
      if (cols[c.collectionId]) err('collections: 중복 ID ' + id);
      if (!games[c.gameId]) err('collections ' + id + ': 없는 gameId ' + c.gameId);
      if (PLATFORMS.indexOf(c.platform) < 0) err('collections ' + id + ': 잘못된 platform ' + c.platform);
      cols[c.collectionId] = c;
    });
    d.keywords.forEach(function (k, i) {
      if (!isStr(k.keyword)) { err('keywords[' + i + ']: keyword 누락'); return; }
      if (kws[k.keyword]) err('keywords: 중복 키워드 ' + k.keyword);
      if (!cats[k.categoryId]) err('keywords ' + k.keyword + ': 없는 categoryId ' + k.categoryId);
      kws[k.keyword] = k;
    });

    d.reviews.forEach(function (r, i) {
      var id = isStr(r.reviewId) ? r.reviewId : ('reviews[' + i + ']');
      if (!isStr(r.reviewId)) { err(id + ': reviewId 누락'); return; }
      if (revs[r.reviewId]) err('중복 리뷰 ID ' + r.reviewId);
      revs[r.reviewId] = r;
      if (!games[r.gameId]) err(id + ': 없는 gameId ' + r.gameId);
      if (PLATFORMS.indexOf(r.platform) < 0) err(id + ': 잘못된 platform ' + r.platform);
      if (DATA_TYPES.indexOf(r.dataType) < 0) err(id + ': 잘못된 dataType ' + r.dataType);
      var c = cols[r.collectionId];
      if (!c) err(id + ': 없는 collectionId ' + r.collectionId);
      else if (c.gameId !== r.gameId || c.platform !== r.platform) err(id + ': collection의 게임/플랫폼과 불일치');
      if (r.rating !== null && !(Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)) err(id + ': 별점은 1~5 정수 또는 null');
      if (r.publishedAt !== null && !(typeof r.publishedAt === 'string' && DATE_RE.test(r.publishedAt))) err(id + ': publishedAt은 YYYY-MM-DD(KST) 또는 null');
      if (!isStr(r.summary)) err(id + ': summary 누락');
      if (!isStr(r.collectedAt)) err(id + ': collectedAt 누락');
      if (!(typeof r.sourceUrl === 'string' && /^https?:\/\//.test(r.sourceUrl))) err(id + ': sourceUrl이 URL이 아님');
      if (!isStrOrNull(r.externalReviewId)) err(id + ': externalReviewId 형식 오류');
      if (r.sampleRole !== undefined && SAMPLE_ROLES.indexOf(r.sampleRole) < 0) err(id + ': 잘못된 sampleRole ' + r.sampleRole);
      if (r.labelSource !== undefined && LABEL_SOURCES.indexOf(r.labelSource) < 0) err(id + ': 잘못된 labelSource ' + r.labelSource);
      if (r.helpfulCount !== undefined && r.helpfulCount !== null && !(Number.isInteger(r.helpfulCount) && r.helpfulCount >= 0)) err(id + ': helpfulCount는 0 이상 정수 또는 null');
      if (r.externalReviewId) {
        var k = r.platform + '|' + r.externalReviewId;
        if (ext[k]) err(id + ': 동일 스토어 리뷰 중복 등록(' + ext[k] + ')');
        ext[k] = r.reviewId;
      }
    });

    var reviewHasOpinion = {};
    d.opinions.forEach(function (o, i) {
      var id = isStr(o.opinionId) ? o.opinionId : ('opinions[' + i + ']');
      if (!isStr(o.opinionId)) { err(id + ': opinionId 누락'); return; }
      if (ops[o.opinionId]) err('중복 의견 ID ' + o.opinionId);
      ops[o.opinionId] = o;
      if (!revs[o.reviewId]) err(id + ': 없는 reviewId ' + o.reviewId);
      else reviewHasOpinion[o.reviewId] = true;
      if (!cats[o.categoryId]) err(id + ': 없는 categoryId ' + o.categoryId);
      if (SENTIMENTS.indexOf(o.sentiment) < 0) err(id + ': 잘못된 sentiment ' + o.sentiment);
      if (o.sentiment === 'other') {
        if (OTHER_TYPES.indexOf(o.otherType) < 0) err(id + ': 기타 의견은 otherType 필요');
      } else if (o.otherType !== null) err(id + ': 긍정·부정 의견의 otherType은 null');
      var kw = kws[o.keyword];
      if (!kw) err(id + ': 키워드 사전에 없는 키워드 "' + o.keyword + '"');
      else if (kw.categoryId !== o.categoryId) err(id + ': 키워드 카테고리 불일치');
      if (STATUSES.indexOf(o.verificationStatus) < 0) err(id + ': 잘못된 verificationStatus ' + o.verificationStatus);
      if ((o.verificationStatus === 'on_hold') !== isStr(o.holdReason)) err(id + ': 판단 보류는 holdReason 필수, 그 외는 null');
      if (!isStr(o.summary)) err(id + ': summary 누락');
      if (o.labelSource !== undefined && LABEL_SOURCES.indexOf(o.labelSource) < 0) err(id + ': 잘못된 labelSource ' + o.labelSource);
      if (o.evidenceText !== null && !(typeof o.evidenceText === 'string' && Array.from(o.evidenceText).length <= EXCERPT_MAX)) err(id + ': evidenceText는 ' + EXCERPT_MAX + '자 이하');
    });

    d.reviews.forEach(function (r) {
      if (isStr(r.reviewId) && !reviewHasOpinion[r.reviewId]) warnings.push(r.reviewId + ': 추출된 의견이 없습니다');
    });
    var types = {};
    d.reviews.forEach(function (r) { types[r.dataType] = true; });
    if (Object.keys(types).length > 1) warnings.push('실제·샘플 데이터가 함께 있습니다. 데이터 유형별로 나누어 집계합니다.');

    return { errors: errors, warnings: warnings };
  }

  /** 브라우저: data/*.json을 불러와 검증한다. */
  function loadData(basePath) {
    var base = basePath || 'data/';
    return Promise.all(FILES.map(function (k) {
      return fetch(base + k + '.json', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error(k + '.json을 불러오지 못했습니다 (HTTP ' + res.status + ')');
        return res.json().catch(function () { throw new Error(k + '.json의 JSON 형식이 올바르지 않습니다'); });
      });
    })).then(function (arr) {
      var data = {};
      FILES.forEach(function (k, i) { data[k] = arr[i]; });
      var v = validateData(data);
      return { data: data, errors: v.errors, warnings: v.warnings };
    });
  }

  var api = { FILES: FILES, validateData: validateData, loadData: loadData, EXCERPT_MAX: EXCERPT_MAX };
  root.GVL = root.GVL || {};
  root.GVL.loader = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
