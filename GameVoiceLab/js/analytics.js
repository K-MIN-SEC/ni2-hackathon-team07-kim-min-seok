/*
 * Game Voice Lab — 집계·필터 순수 함수 (FUNC-002~007)
 * DOM에 의존하지 않으며 브라우저(window.GVL.analytics)와 Node(require) 모두에서 동작한다.
 * 규칙 근거: project-plan.md 10장, 19.11(B-03), 19.12(B-04)
 */
(function (root) {
  'use strict';

  var SENTIMENTS = ['positive', 'negative', 'other'];
  var OTHER_TYPES = ['suggestion', 'neutral', 'question', 'unknown'];
  var SENTIMENT_LABEL = { positive: '긍정', negative: '부정', other: '기타' };
  var OTHER_TYPE_LABEL = { suggestion: '건의', neutral: '중립', question: '질문', unknown: '판단 불가' };
  var STATUS_LABEL = { unreviewed: '미검수', verified: '검수 완료', corrected: '수정됨', on_hold: '판단 보류' };

  /** 비율(%) 계산. 분모 0이면 null (화면에서 N/A). */
  function pct(n, d) {
    return d > 0 ? (n / d) * 100 : null;
  }

  /** 비율 표시: 소수점 첫째 자리, null이면 N/A */
  function fmtPct(x) {
    return x === null || x === undefined ? 'N/A' : x.toFixed(1) + '%';
  }

  /** 평균 별점 표시: 소수점 둘째 자리, null이면 N/A */
  function fmtAvg(x) {
    return x === null || x === undefined ? 'N/A' : x.toFixed(2);
  }

  function emptyFilters() {
    return {
      dataType: null, gameId: null, platform: null, dateFrom: null, dateTo: null, rating: null,
      categoryId: null, sentiment: null, otherType: null, keyword: null,
    };
  }

  function isOpinionFilterActive(f) {
    return !!(f.categoryId || f.sentiment || f.otherType || f.keyword);
  }

  function opinionMatches(o, f) {
    if (f.categoryId && o.categoryId !== f.categoryId) return false;
    if (f.sentiment && o.sentiment !== f.sentiment) return false;
    if (f.otherType && o.otherType !== f.otherType) return false;
    if (f.keyword && o.keyword !== f.keyword) return false;
    return true;
  }

  /**
   * 필터 적용.
   * - 리뷰 단위 필터: dataType, gameId, platform, 기간(KST 날짜, 양 끝 포함), rating
   * - 의견 단위 필터: categoryId, sentiment, otherType, keyword
   * - 의견 단위 필터가 하나라도 있으면 리뷰는 "조건에 맞는 의견이 1건 이상 있는 리뷰"로 좁힌다(B-04).
   * - 기간 필터 사용 시 작성일 null 리뷰는 제외하고 그 수를 excludedNoDate로 돌려준다(B-03).
   * - dataType은 항상 하나만 선택한다(실제·샘플 혼합 집계 금지).
   */
  function applyFilters(data, filters) {
    var f = Object.assign(emptyFilters(), filters || {});
    var dateActive = !!(f.dateFrom || f.dateTo);
    var excludedNoDate = 0;

    var baseReviews = data.reviews.filter(function (r) {
      if (f.dataType && r.dataType !== f.dataType) return false;
      if (f.gameId && r.gameId !== f.gameId) return false;
      if (f.platform && r.platform !== f.platform) return false;
      if (f.rating !== null && f.rating !== undefined && r.rating !== f.rating) return false;
      if (dateActive) {
        if (!r.publishedAt) { excludedNoDate++; return false; }
        if (f.dateFrom && r.publishedAt < f.dateFrom) return false;
        if (f.dateTo && r.publishedAt > f.dateTo) return false;
      }
      return true;
    });

    var reviewIds = {};
    baseReviews.forEach(function (r) { reviewIds[r.reviewId] = true; });

    var opinions = data.opinions.filter(function (o) {
      return reviewIds[o.reviewId] && opinionMatches(o, f);
    });

    var opinionFilterActive = isOpinionFilterActive(f);
    var reviews = baseReviews;
    if (opinionFilterActive) {
      var withOpinion = {};
      opinions.forEach(function (o) { withOpinion[o.reviewId] = true; });
      reviews = baseReviews.filter(function (r) { return withOpinion[r.reviewId]; });
    }

    return {
      reviews: reviews,
      opinions: opinions,
      opinionFilterActive: opinionFilterActive,
      dateFilterActive: dateActive,
      excludedNoDate: excludedNoDate,
    };
  }

  /** 리뷰 기준 통계(SPEC-002). 별점 없는 리뷰는 리뷰 수에는 포함, 평균·분포에서는 제외. */
  function reviewStats(reviews) {
    var rated = reviews.filter(function (r) { return typeof r.rating === 'number'; });
    var sum = rated.reduce(function (a, r) { return a + r.rating; }, 0);
    var dist = {};
    [5, 4, 3, 2, 1].forEach(function (s) {
      var c = rated.filter(function (r) { return r.rating === s; }).length;
      dist[s] = { count: c, pct: pct(c, rated.length) };
    });
    return {
      count: reviews.length,
      ratedCount: rated.length,
      unratedCount: reviews.length - rated.length,
      ratingSum: sum,
      avg: rated.length ? sum / rated.length : null,
      dist: dist,
    };
  }

  /** 의견 기준 감성 통계(SPEC-003). 건의 사항은 기타의 일부이며 별도 합산하지 않는다. */
  function sentimentStats(opinions) {
    var total = opinions.length;
    var out = { total: total, otherTypes: {} };
    SENTIMENTS.forEach(function (s) {
      var c = opinions.filter(function (o) { return o.sentiment === s; }).length;
      out[s] = { count: c, pct: pct(c, total) };
    });
    OTHER_TYPES.forEach(function (t) {
      var c = opinions.filter(function (o) { return o.sentiment === 'other' && o.otherType === t; }).length;
      out.otherTypes[t] = { count: c, pct: pct(c, out.other.count) };
    });
    out.onHold = opinions.filter(function (o) { return o.verificationStatus === 'on_hold'; }).length;
    return out;
  }

  /**
   * 카테고리별 교차 집계(SPEC-004).
   * share = 전체 의견 대비 비중, positivePct 등 = 카테고리 내부 감성 비율 (두 값을 구분).
   */
  function categoryStats(opinions, categories) {
    var total = opinions.length;
    var rows = categories.map(function (c) {
      var ops = opinions.filter(function (o) { return o.categoryId === c.categoryId; });
      var row = { categoryId: c.categoryId, name: c.name, scope: c.scope, total: ops.length, share: pct(ops.length, total) };
      SENTIMENTS.forEach(function (s) {
        var n = ops.filter(function (o) { return o.sentiment === s; }).length;
        row[s] = n;
        row[s + 'Pct'] = pct(n, ops.length);
      });
      return row;
    });
    rows.sort(function (a, b) { return b.total - a.total || (a.categoryId < b.categoryId ? -1 : 1); });
    return rows;
  }

  /** 정규화 키워드별 의견 수(SPEC-005). sentiment를 주면 해당 감성만 집계. */
  function keywordStats(opinions, keywords, sentiment) {
    var catOf = {};
    keywords.forEach(function (k) { catOf[k.keyword] = k.categoryId; });
    var counts = {};
    opinions.forEach(function (o) {
      if (sentiment && o.sentiment !== sentiment) return;
      counts[o.keyword] = (counts[o.keyword] || 0) + 1;
    });
    return Object.keys(counts).map(function (k) {
      return { keyword: k, count: counts[k], categoryId: catOf[k] || null };
    }).sort(function (a, b) { return b.count - a.count || a.keyword.localeCompare(b.keyword, 'ko'); });
  }

  /** 기타 의견 세부 유형별 목록(SPEC-006) */
  function otherOpinions(opinions, otherType) {
    return opinions.filter(function (o) { return o.sentiment === 'other' && (!otherType || o.otherType === otherType); });
  }

  /** 의견 ↔ 리뷰 연결(SPEC-008) */
  function indexBy(arr, key) {
    var m = {};
    arr.forEach(function (x) { m[x[key]] = x; });
    return m;
  }

  function opinionsOfReview(data, reviewId) {
    return data.opinions.filter(function (o) { return o.reviewId === reviewId; });
  }

  function statusCounts(opinions) {
    var out = {};
    Object.keys(STATUS_LABEL).forEach(function (s) { out[s] = 0; });
    opinions.forEach(function (o) { out[o.verificationStatus] = (out[o.verificationStatus] || 0) + 1; });
    return out;
  }

  function dateRange(reviews) {
    var d = reviews.map(function (r) { return r.publishedAt; }).filter(Boolean).sort();
    return { min: d[0] || null, max: d[d.length - 1] || null, missing: reviews.length - d.length };
  }

  var api = {
    SENTIMENTS: SENTIMENTS, OTHER_TYPES: OTHER_TYPES,
    SENTIMENT_LABEL: SENTIMENT_LABEL, OTHER_TYPE_LABEL: OTHER_TYPE_LABEL, STATUS_LABEL: STATUS_LABEL,
    pct: pct, fmtPct: fmtPct, fmtAvg: fmtAvg,
    emptyFilters: emptyFilters, isOpinionFilterActive: isOpinionFilterActive, applyFilters: applyFilters,
    reviewStats: reviewStats, sentimentStats: sentimentStats, categoryStats: categoryStats,
    keywordStats: keywordStats, otherOpinions: otherOpinions,
    indexBy: indexBy, opinionsOfReview: opinionsOfReview, statusCounts: statusCounts, dateRange: dateRange,
  };

  root.GVL = root.GVL || {};
  root.GVL.analytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
