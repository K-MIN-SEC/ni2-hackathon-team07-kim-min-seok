/*
 * Game Voice Lab — 화면 구성 및 연결 (FUNC-002~010, 12장)
 * 데이터 → analytics(집계) → charts(표시). 수치를 직접 고정하지 않는다.
 */
(function (root) {
  'use strict';
  var A = root.GVL.analytics;
  var C = root.GVL.charts;
  var L = root.GVL.loader;
  var esc = C.esc;

  var state = {
    data: null,
    filters: null,
    filterBar: null,
    tab: 'overview',
    drill: {},          // 의견 탐색 화면의 차트 클릭 조건 (전역 필터와 별도)
    otherTab: 'suggestion',
    idx: {},
  };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- 공통 ----------
  function catName(id) { var c = state.idx.cat[id]; return c ? c.name : id; }
  function gameName(id) { var g = state.idx.game[id]; return g ? g.name : id; }
  function ratingText(r) { return typeof r === 'number' ? '★' + r : '확인 필요'; }
  function dateText(d) { return d || '확인 필요'; }
  function statusBadge(o) {
    if (o.verificationStatus === 'on_hold') return '<span class="badge hold" title="' + esc(o.holdReason || '') + '">판단 보류</span>';
    return '<span class="badge">' + esc(A.STATUS_LABEL[o.verificationStatus] || o.verificationStatus) + '</span>';
  }
  function panel(title, basis, body, extraCls) {
    return '<div class="panel ' + (extraCls || '') + '"><h2>' + esc(title) + '</h2>' +
      (basis ? '<p class="basis">' + basis + '</p>' : '') + body + '</div>';
  }

  // ---------- 헤더 ----------
  function renderHeader(res) {
    var d = state.data, f = state.filters;
    var all = d.reviews.filter(function (r) { return r.dataType === f.dataType; });
    var ids = {}; all.forEach(function (r) { ids[r.reviewId] = true; });
    var allOps = d.opinions.filter(function (o) { return ids[o.reviewId]; });
    var collected = A.dateRange(all.map(function (r) { return { publishedAt: r.collectedAt }; }));
    var typeBadge = f.dataType === 'actual'
      ? '<span class="badge actual">실제 공개 리뷰</span>'
      : (f.dataType === 'sample' ? '<span class="badge sample">샘플 데이터(가상)</span>' : '');
    var distN = all.filter(function (r) { return (r.sampleRole || 'distribution') === 'distribution'; }).length;
    var teamN = all.filter(function (r) { return (r.labelSource || '').indexOf('team_') === 0; }).length;
    $('headerBadges').innerHTML = typeBadge +
      '<span class="badge" title="실제 분포용 ' + distN + '건 + 별점 보강분 ' + (all.length - distN) + '건">표본 리뷰 ' + all.length + '건 · 의견 ' + allOps.length + '건</span>' +
      (teamN ? '<span class="badge hold" title="review-analysis 팀원 라벨(규칙·AI)을 변환한 리뷰. 팀 검수 전">자동 분류 ' + teamN + '건 · 검수 전</span>' : '') +
      (collected.min ? '<span class="badge">수집일 ' + esc(collected.min === collected.max ? collected.min : collected.min + '~' + collected.max) + '</span>' : '');
  }

  // ---------- 알림 ----------
  function renderNotices(res, warnings) {
    var parts = [];
    var desc = state.filterBar.describe();
    if (res.opinionFilterActive) {
      parts.push('<div class="notice info"><b>의견 필터 적용 중</b> — 리뷰 수·평균 별점·별점 분포는 <b>조건에 맞는 의견이 있는 리뷰 ' +
        res.reviews.length + '건 기준</b>입니다. 한 리뷰가 긍정·부정 의견을 함께 가질 수 있어, 감성별 리뷰 수의 합은 전체 리뷰 수보다 클 수 있습니다.</div>');
    }
    if (res.sampleScope === 'all') {
      parts.push('<div class="notice"><b>별점 보강분 포함</b> — 1·2점 필터로 추가 수집한 리뷰가 들어 있어 별점·감성 비율이 <b>실제 사용자 분포가 아닙니다</b>. 키워드·근거 탐색용으로만 쓰세요.</div>');
    } else if (res.excludedSupplement > 0) {
      parts.push('<div class="notice info small">실제 분포용 리뷰만 집계 중 — 별점 보강분 ' + res.excludedSupplement + '건은 제외했습니다(필터 "수집 범위"에서 포함 가능).</div>');
    }
    if (desc.length) parts.push('<div class="notice info small">적용된 필터: ' + desc.map(esc).join(' · ') + '</div>');
    if (res.dateFilterActive && res.excludedNoDate > 0) {
      parts.push('<div class="notice small">작성일이 확인되지 않은 리뷰 ' + res.excludedNoDate + '건은 기간 필터에서 제외되었습니다.</div>');
    }
    if (warnings && warnings.length) {
      parts.push('<div class="notice small"><b>데이터 확인 필요</b><ul>' + warnings.slice(0, 10).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>');
    }
    $('notices').innerHTML = parts.join('');
  }

  // ---------- 12.2 전체 현황 ----------
  function renderOverview(res) {
    var rs = A.reviewStats(res.reviews), ss = A.sentimentStats(res.opinions);
    if (!rs.count) { $('panel-overview').innerHTML = '<div class="empty">조건에 맞는 데이터가 없습니다. 필터를 변경해 보세요.</div>'; return; }
    var perReview = rs.count ? (ss.total / rs.count).toFixed(2) : 'N/A';
    var kpi = function (label, value, sub, swatch) {
      return '<div class="kpi"><div class="label">' + (swatch ? '<span class="swatch ' + swatch + '"></span>' : '') + esc(label) + '</div>' +
        '<div class="value">' + value + '</div><div class="sub">' + sub + '</div></div>';
    };
    var html = '<div class="kpis">' +
      kpi('수집 리뷰 수', rs.count + '<small>건</small>', res.opinionFilterActive ? '조건에 맞는 의견이 있는 리뷰' : '고유 리뷰 기준') +
      kpi('평균 별점', A.fmtAvg(rs.avg), '분모: 별점 있는 리뷰 ' + rs.ratedCount + '건' + (rs.unratedCount ? ' (없음 ' + rs.unratedCount + '건 제외)' : '')) +
      kpi('추출 의견 수', ss.total + '<small>건</small>', '리뷰당 평균 ' + perReview + '건') +
      kpi('긍정 의견', ss.positive.count + '<small>' + A.fmtPct(ss.positive.pct) + '</small>', '분모: 의견 ' + ss.total + '건', 'positive') +
      kpi('부정 의견', ss.negative.count + '<small>' + A.fmtPct(ss.negative.pct) + '</small>', '분모: 의견 ' + ss.total + '건', 'negative') +
      kpi('기타 의견', ss.other.count + '<small>' + A.fmtPct(ss.other.pct) + '</small>', '건의 ' + ss.otherTypes.suggestion.count + '건 포함 · 판단 보류 ' + ss.onHold + '건', 'other') +
      '</div>';

    var starRows = [5, 4, 3, 2, 1].map(function (s) {
      var d = rs.dist[s];
      return { label: s + '점', value: d.count, valueText: d.count + '건 · ' + A.fmtPct(d.pct), tip: s + '점 리뷰 ' + d.count + '건\n분모: 별점 있는 리뷰 ' + rs.ratedCount + '건' };
    });
    html += '<div class="grid two">' +
      panel('별점 분포', '리뷰 기준 · 분모: 별점 있는 리뷰 ' + rs.ratedCount + '건. 별점은 감성 판단에 사용하지 않습니다.', C.hbars(starRows, { max: Math.max.apply(null, starRows.map(function (r) { return r.value; })) })) +
      panel('전체 감성 분포', '의견 기준 · 분모: 의견 ' + ss.total + '건. 막대나 범례를 누르면 해당 의견 목록으로 이동합니다.', C.sentimentStack(ss)) +
      '</div>';

    // 별점과 감성이 다른 리뷰 (6.2 원칙 안내용, 집계 결과로 계산)
    var mismatch = res.reviews.filter(function (r) {
      return r.rating >= 4 && res.opinions.some(function (o) { return o.reviewId === r.reviewId && o.sentiment === 'negative'; });
    }).length;
    html += '<p class="small muted section-gap">참고: 별점 4~5점 리뷰 중 부정 의견을 포함한 리뷰 ' + mismatch + '건 — 별점만으로 감성을 판단하지 않는 이유입니다.</p>';
    $('panel-overview').innerHTML = html;
  }

  // ---------- 12.3 주제별 분석 ----------
  function renderTopics(res) {
    var rows = A.categoryStats(res.opinions, state.data.categories);
    var total = res.opinions.length;
    if (!total) { $('panel-topics').innerHTML = '<div class="empty">조건에 맞는 의견이 없습니다.</div>'; return; }
    var chart = panel('카테고리별 의견 분포', '의견 기준 · 구간을 누르면 해당 카테고리·감성 의견 목록으로 이동합니다.', C.categoryStacks(rows, total));
    var table = '<div class="table-wrap"><table><thead><tr><th>카테고리</th><th>분류 대상</th><th class="num">의견 수</th><th class="num">전체 대비 비중</th>' +
      '<th class="num">긍정</th><th class="num">부정</th><th class="num">기타</th><th class="num">내부 긍정 비율</th><th class="num">내부 부정 비율</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="clickable" data-drill="' + esc(JSON.stringify({ categoryId: r.categoryId })) + '"><td>' + esc(r.name) + '</td><td class="small muted">' + esc(r.scope) + '</td>' +
          '<td class="num">' + r.total + '</td><td class="num">' + A.fmtPct(r.share) + '</td>' +
          '<td class="num">' + r.positive + '</td><td class="num">' + r.negative + '</td><td class="num">' + r.other + '</td>' +
          '<td class="num">' + A.fmtPct(r.positivePct) + '</td><td class="num">' + A.fmtPct(r.negativePct) + '</td></tr>';
      }).join('') +
      '</tbody><tfoot><tr><th>합계</th><th></th><th class="num">' + total + '</th><th class="num">' + A.fmtPct(A.pct(total, total)) + '</th>' +
      ['positive', 'negative', 'other'].map(function (s) { return '<th class="num">' + rows.reduce(function (a, r) { return a + r[s]; }, 0) + '</th>'; }).join('') +
      '<th></th><th></th></tr></tfoot></table></div>';
    $('panel-topics').innerHTML = chart + '<div class="section-gap">' +
      panel('카테고리 수치표', '"전체 대비 비중" 분모: 의견 ' + total + '건 / "내부 비율" 분모: 해당 카테고리 의견 수 (두 비율은 서로 다릅니다)', table) + '</div>';
  }

  // ---------- 12.4 키워드 분석 ----------
  function renderKeywords(res) {
    var d = state.data;
    function list(sentiment) {
      var ks = A.keywordStats(res.opinions, d.keywords, sentiment);
      var total = ks.reduce(function (a, k) { return a + k.count; }, 0);
      var rows = ks.map(function (k) {
        return {
          label: k.keyword, sub: catName(k.categoryId), value: k.count, cls: sentiment,
          valueText: k.count + '건 · ' + A.fmtPct(A.pct(k.count, total)),
          tip: k.keyword + ' — ' + A.SENTIMENT_LABEL[sentiment] + ' 의견 ' + k.count + '건\n관련 카테고리: ' + catName(k.categoryId) + '\n분모: ' + A.SENTIMENT_LABEL[sentiment] + ' 의견 ' + total + '건',
          drill: { keyword: k.keyword, sentiment: sentiment },
        };
      });
      return panel(A.SENTIMENT_LABEL[sentiment] + ' 키워드 순위',
        A.SENTIMENT_LABEL[sentiment] + ' 의견 ' + total + '건 · 키워드 ' + ks.length + '종 · 정규화 키워드 기준(같은 의견 중복 집계 없음). 키워드를 누르면 관련 리뷰로 이동합니다.',
        C.hbars(rows, { cls: 'kw-list', emptyText: '해당 의견 없음' }));
    }
    var others = A.keywordStats(res.opinions, d.keywords, 'other');
    $('panel-keywords').innerHTML = '<div class="grid two">' + list('negative') + list('positive') + '</div>' +
      '<p class="small muted section-gap">기타 의견 키워드(' + others.length + '종)는 순위에 포함하지 않고 "기타·건의 사항" 화면에서 확인합니다.</p>';
  }

  // ---------- 12.5 기타 및 건의 사항 ----------
  function opinionTable(ops, emptyText) {
    if (!ops.length) return '<div class="empty">' + esc(emptyText || '해당 의견 없음') + '</div>';
    var rv = state.idx.review;
    ops = ops.slice().sort(function (a, b) {
      var ra = rv[a.reviewId], rb = rv[b.reviewId];
      return (rb.publishedAt || '').localeCompare(ra.publishedAt || '') || a.opinionId.localeCompare(b.opinionId);
    });
    return '<div class="table-wrap"><table><thead><tr><th>게임 · 스토어</th><th>별점</th><th>작성일</th><th>카테고리</th><th>감성</th><th>키워드</th><th>의견 요약</th><th>원문 발췌</th><th>검수</th></tr></thead><tbody>' +
      ops.map(function (o) {
        var r = rv[o.reviewId];
        return '<tr class="clickable" data-review="' + esc(r.reviewId) + '" title="리뷰 상세 보기">' +
          '<td>' + esc(gameName(r.gameId)) + '<br><span class="small muted">' + esc(r.platform) + '</span></td>' +
          '<td class="num">' + esc(ratingText(r.rating)) + '</td><td class="num">' + esc(dateText(r.publishedAt)) + '</td>' +
          '<td>' + esc(catName(o.categoryId)) + '</td><td>' + C.sentimentChip(o) + '</td><td>' + esc(o.keyword) + '</td>' +
          '<td>' + esc(o.summary) + '</td><td>' + (o.evidenceText ? '<span class="excerpt">' + esc(o.evidenceText) + '</span>' : '<span class="muted">없음</span>') + '</td>' +
          '<td>' + statusBadge(o) + '<br><span class="small muted">' + esc(A.LABEL_SOURCE_LABEL[o.labelSource || 'gvl_manual'] || '') + '</span></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderOthers(res) {
    var ss = A.sentimentStats(res.opinions);
    var tabs = A.OTHER_TYPES.map(function (t) { return { key: t, label: A.OTHER_TYPE_LABEL[t], count: ss.otherTypes[t].count }; });
    var holdOps = res.opinions.filter(function (o) { return o.verificationStatus === 'on_hold'; });
    tabs.push({ key: 'on_hold', label: '판단 보류(검수 상태)', count: holdOps.length });
    var cur = state.otherTab;
    var ops = cur === 'on_hold' ? holdOps : A.otherOpinions(res.opinions, cur);
    var basis = cur === 'on_hold'
      ? '카테고리 또는 감성을 확정하지 못한 의견입니다. 잠정 분류로 집계에 포함되며, 사유는 리뷰 상세에서 확인합니다.'
      : '기타 의견 ' + ss.other.count + '건 중 ' + A.OTHER_TYPE_LABEL[cur] + ' ' + ops.length + '건 · 건의 사항은 기타 의견에 포함되며 별도로 합산하지 않습니다.';
    $('panel-others').innerHTML = panel('기타 의견 및 건의 사항', '',
      '<div class="subtabs">' + tabs.map(function (t) {
        return '<button type="button" data-othertab="' + t.key + '" aria-pressed="' + (t.key === cur) + '">' + esc(t.label) + ' ' + t.count + '</button>';
      }).join('') + '</div><p class="basis">' + esc(basis) + '</p>' + opinionTable(ops, '해당 유형의 의견이 없습니다.'));
  }

  // ---------- 의견 탐색 (차트 클릭 결과) ----------
  function drillMatches(o, dr) {
    if (dr.categoryId && o.categoryId !== dr.categoryId) return false;
    if (dr.sentiment && o.sentiment !== dr.sentiment) return false;
    if (dr.otherType && o.otherType !== dr.otherType) return false;
    if (dr.keyword && o.keyword !== dr.keyword) return false;
    return true;
  }
  function renderExplore(res) {
    var dr = state.drill;
    var ops = res.opinions.filter(function (o) { return drillMatches(o, dr); });
    var reviews = {}; ops.forEach(function (o) { reviews[o.reviewId] = true; });
    var chips = [];
    if (dr.categoryId) chips.push(['categoryId', '카테고리: ' + catName(dr.categoryId)]);
    if (dr.sentiment) chips.push(['sentiment', '감성: ' + A.SENTIMENT_LABEL[dr.sentiment]]);
    if (dr.otherType) chips.push(['otherType', '유형: ' + A.OTHER_TYPE_LABEL[dr.otherType]]);
    if (dr.keyword) chips.push(['keyword', '키워드: ' + dr.keyword]);
    var chipHtml = '<div class="drill-bar"><span class="small muted">차트에서 선택한 조건:</span>' +
      (chips.length ? chips.map(function (c) {
        return '<span class="drill-chip">' + esc(c[1]) + '<button type="button" data-undrill="' + c[0] + '" aria-label="조건 제거">×</button></span>';
      }).join('') + '<button type="button" class="btn" data-undrill="all">모두 해제</button>' : '<span class="small muted">없음 (공통 필터 결과 전체)</span>') + '</div>';
    $('panel-explore').innerHTML = panel('의견 탐색',
      '의견 ' + ops.length + '건 · 리뷰 ' + Object.keys(reviews).length + '건 · 공통 필터와 차트 선택 조건을 모두 만족하는 의견입니다. 행을 누르면 원본 리뷰와 출처를 확인합니다.',
      chipHtml + opinionTable(ops, '조건에 맞는 의견이 없습니다.'));
  }

  // ---------- 12.7 데이터 출처 및 분석 정보 ----------
  function renderSources() {
    var d = state.data, f = state.filters;
    var reviews = d.reviews.filter(function (r) { return r.dataType === f.dataType; });
    var ids = {}; reviews.forEach(function (r) { ids[r.reviewId] = true; });
    var ops = d.opinions.filter(function (o) { return ids[o.reviewId]; });
    var cols = d.collections.filter(function (c) { return c.dataType === f.dataType; });
    var sc = A.statusCounts(ops);
    var noRating = reviews.filter(function (r) { return r.rating === null; }).length;
    var noDate = reviews.filter(function (r) { return !r.publishedAt; }).length;
    var noVersion = reviews.filter(function (r) { return !r.appVersion; }).length;
    var allDates = A.dateRange(reviews);

    var cnt = function (arr, fn) { var m = {}; arr.forEach(function (x) { var k = fn(x); m[k] = (m[k] || 0) + 1; }); return m; };
    var bySource = cnt(reviews, function (r) { return r.labelSource || 'gvl_manual'; });
    var byRole = cnt(reviews, function (r) { return r.sampleRole || 'distribution'; });
    var opsBySource = cnt(ops, function (o) { return o.labelSource || 'gvl_manual'; });
    var colTable = '<div class="table-wrap"><table><thead><tr><th>게임</th><th>스토어</th><th>선정 방법</th><th>역할</th><th class="num">수집 건수</th><th>작성일 범위</th><th>수집일</th></tr></thead><tbody>' +
      (cols.length ? cols.map(function (c) {
        var rs = reviews.filter(function (r) { return r.collectionId === c.collectionId; });
        var n = rs.length;
        var role = rs.some(function (r) { return r.sampleRole === 'supplement'; }) ? '별점 보강분' : '실제 분포용';
        return '<tr><td>' + esc(gameName(c.gameId)) + '</td><td>' + esc(c.platform) + '</td><td class="small">' + esc(c.selectionMethod) + '</td><td>' + esc(role) + '</td>' +
          '<td class="num">' + n + '</td><td class="num">' + esc((c.publishedAtMin || '확인 필요') + ' ~ ' + (c.publishedAtMax || '확인 필요')) + '</td><td class="num">' + esc(c.collectedAt) + '</td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted">수집 정보 없음</td></tr>') + '</tbody></table></div>' +
      '<p class="small muted">같은 리뷰가 여러 묶음(최신순·별점 필터)에 함께 나오면 1건으로 세고, 실제 분포용 묶음에 둡니다. ' +
      '작성일: Google Play는 스토어 웹 표시 날짜(UTC 기준으로 확인됨), App Store는 KST 변환 날짜입니다.</p>';

    var storeRows = [];
    d.games.forEach(function (g) {
      (g.storeListings || []).forEach(function (s) {
        var sn = s.snapshot || {};
        storeRows.push('<tr><td>' + esc(g.name) + '</td><td>' + esc(s.platform) + '</td><td><a href="' + esc(s.storeUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(s.storeAppId) + '</a></td>' +
          '<td>' + esc(s.storeDeveloperName || '확인 필요') + '</td><td class="num">' + esc(sn.rating !== null && sn.rating !== undefined ? sn.rating : '확인 필요') + '</td>' +
          '<td>' + esc(sn.ratingCountText || '확인 필요') + '</td><td>' + esc(sn.downloadsText || '확인 필요') + '</td><td class="num">' + esc(sn.checkedAt || '') + '</td></tr>');
      });
    });
    var storeTable = '<div class="table-wrap"><table><thead><tr><th>게임</th><th>스토어</th><th>스토어 페이지</th><th>스토어 개발자 표기</th><th class="num">스토어 평점</th><th>스토어 평가 수</th><th>다운로드</th><th>확인일</th></tr></thead><tbody>' +
      (storeRows.join('') || '<tr><td colspan="8" class="muted">게임 정보 없음</td></tr>') + '</tbody></table></div>' +
      '<p class="small muted">스토어 평점·평가 수는 수집일 화면 표시값(참고용)입니다. 이 대시보드의 별점 통계는 수집한 표본 리뷰만으로 계산합니다.</p>';

    var relation = d.games.map(function (g) { return '<li><b>' + esc(g.name) + '</b>: ' + esc(g.companyRelation || '확인 필요') + '</li>'; }).join('');

    $('panel-sources').innerHTML =
      '<div class="grid two">' +
      panel('수집 개요', '',
        '<dl class="meta">' +
        '<dt>데이터 유형</dt><dd>' + (f.dataType === 'actual' ? '실제 공개 스토어 리뷰' : '샘플(가상) 데이터') + '</dd>' +
        '<dt>리뷰 수</dt><dd>' + reviews.length + '건</dd>' +
        '<dt>분석 의견 수</dt><dd>' + ops.length + '건</dd>' +
        '<dt>수집 역할</dt><dd>실제 분포용 ' + (byRole.distribution || 0) + '건 · 별점 보강분 ' + (byRole.supplement || 0) + '건</dd>' +
        '<dt>분류 출처</dt><dd>GVL 직접 분류 ' + (bySource.gvl_manual || 0) + '건 · 팀원 규칙 ' + (bySource.team_rule || 0) + '건 · 팀원 AI ' + (bySource.team_ai || 0) + '건 (리뷰 기준)</dd>' +
        '<dt>작성일 범위</dt><dd>' + esc((allDates.min || '확인 필요') + ' ~ ' + (allDates.max || '확인 필요')) + '</dd>' +
        '<dt>수집 플랫폼</dt><dd>' + esc(Array.from(new Set(reviews.map(function (r) { return r.platform; }))).join(', ') || '없음') + '</dd>' +
        '<dt>수집 방식</dt><dd>' + esc((cols[0] && cols[0].collectionTool) || '확인 필요') + '</dd>' +
        '<dt>저장하지 않은 정보</dt><dd>' + esc(((cols[0] && cols[0].excludedFields) || []).join(', ') || '확인 필요') + '</dd>' +
        '</dl><ul class="plain small">' + relation + '</ul>') +
      panel('분석 및 검수 방식', '',
        '<ul class="plain">' +
        '<li>리뷰를 개별 의견으로 분리하고, 의견마다 카테고리 1개와 감성 1개(긍정·부정·기타)를 사전 분류했습니다. 웹앱은 분류 결과를 집계만 합니다.</li>' +
        '<li>의견 ' + ops.length + '건 중 GVL 직접 분류 ' + (opsBySource.gvl_manual || 0) + '건, 팀원(review-analysis) 라벨 변환 ' + ((opsBySource.team_rule || 0) + (opsBySource.team_ai || 0)) +
        '건입니다. 변환분은 리뷰×주제마다 의견 1건으로 만들었고, 팀원 라벨이 "혼합"인 경우는 판단 보류로 두었습니다. 변환분의 원문 발췌는 키워드 단서가 있는 절에서 자동 추출했으며, 찾지 못하면 비워 두었습니다.</li>' +
        '<li>키워드는 정규화 사전(' + d.keywords.length + '종) 기준이며, 원문 발췌는 의견별로 최대 ' + L.EXCERPT_MAX + '자입니다(원문 전문은 저장하지 않음).</li>' +
        '<li>검수 상태: 미검수 ' + sc.unreviewed + '건 · 검수 완료 ' + sc.verified + '건 · 수정됨 ' + sc.corrected + '건 · 판단 보류 ' + sc.on_hold + '건</li>' +
        '<li>확인되지 않은 데이터: 별점 없음 ' + noRating + '건 · 작성일 없음 ' + noDate + '건 · 앱 버전 미확인 ' + noVersion + '건</li>' +
        '</ul>') +
      '</div><div class="section-gap">' + panel('수집 단위별 정보', '', colTable) + '</div>' +
      '<div class="section-gap">' + panel('스토어 출처', '', storeTable) + '</div>' +
      '<div class="section-gap">' + panel('표본 분석의 한계', '',
        '<ul class="plain">' +
        '<li>공개 리뷰 일부만 수집한 표본입니다. 전체 이용자의 의견이나 게임 평가로 일반화하지 않습니다.</li>' +
        '<li>스토어별 선정 방법이 다릅니다(Google Play 최신순, App Store 기본 노출). 스토어 간 수치 비교 시 기간 차이를 고려해야 합니다.</li>' +
        '<li>분류는 사전에 수행한 결과이며 팀 검수 상태를 함께 표시합니다. 개선 방향이나 우선순위는 제시하지 않으며, 판단은 기획자가 합니다.</li>' +
        '</ul>') + '</div>';
  }

  // ---------- 12.6 리뷰 상세 ----------
  function openReview(reviewId) {
    var r = state.idx.review[reviewId];
    if (!r) return;
    var ops = A.opinionsOfReview(state.data, reviewId);
    var col = state.idx.col[r.collectionId];
    $('dlgTitle').textContent = gameName(r.gameId) + ' · ' + r.platform;
    var dateBasis = r.platform === 'Google Play' ? '스토어 웹 표시 날짜(UTC 기준으로 확인됨)' : 'KST';
    var isTeam = (r.labelSource || '').indexOf('team_') === 0;
    $('dlgSub').textContent = ratingText(r.rating) + ' · 작성일 ' + dateText(r.publishedAt) + ' · 의견 ' + ops.length + '건' +
      ' · ' + (A.LABEL_SOURCE_LABEL[r.labelSource || 'gvl_manual'] || '') + ' · ' + (A.SAMPLE_ROLE_LABEL[r.sampleRole || 'distribution'] || '');
    $('dlgBody').innerHTML =
      '<dl class="meta">' +
      '<dt>게임</dt><dd>' + esc(gameName(r.gameId)) + '</dd>' +
      '<dt>스토어</dt><dd>' + esc(r.platform) + '</dd>' +
      '<dt>별점</dt><dd>' + esc(ratingText(r.rating)) + '</dd>' +
      '<dt>작성일</dt><dd>' + esc(dateText(r.publishedAt)) + ' <span class="muted small">(' + esc(dateBasis) + ')</span>' + (r.publishedAtRaw && r.publishedAtRaw !== r.publishedAt ? ' <span class="muted small">스토어 원래 값: ' + esc(r.publishedAtRaw) + '</span>' : '') + '</dd>' +
      '<dt>앱 버전</dt><dd>' + esc(r.appVersion || '확인 필요 (웹에 표시되지 않음)') + '</dd>' +
      '<dt>공감 수</dt><dd>' + (typeof r.helpfulCount === 'number' ? r.helpfulCount + '명 (스토어 웹 표시값)' : '확인 필요') + '</dd>' +
      '<dt>분류 출처</dt><dd>' + esc(A.LABEL_SOURCE_LABEL[r.labelSource || 'gvl_manual']) + (isTeam ? ' <span class="badge hold">팀 검수 전</span>' : '') + '</dd>' +
      '<dt>수집 역할</dt><dd>' + esc(A.SAMPLE_ROLE_LABEL[r.sampleRole || 'distribution']) + (r.sampleRole === 'supplement' ? ' <span class="muted small">(실제 분포 계산 제외)</span>' : '') + '</dd>' +
      '<dt>데이터 유형</dt><dd>' + (r.dataType === 'actual' ? '실제 공개 리뷰' : '샘플(가상)') + '</dd>' +
      '<dt>수집</dt><dd>' + esc(r.collectedAt) + (col ? ' · ' + esc(col.selectionMethod) : '') + '</dd>' +
      '<dt>스토어 리뷰 ID</dt><dd>' + esc(r.externalReviewId || '확인 필요') + '</dd>' +
      '<dt>출처</dt><dd><a href="' + esc(r.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(r.sourceUrl) + '</a>' +
      (r.platform === 'App Store' ? '<br><span class="small muted">App Store는 리뷰별 링크가 없어 리뷰 페이지와 스토어 리뷰 ID로 확인합니다.</span>' : '') + '</dd>' +
      '</dl>' +
      '<div class="summary-box"><span class="tag">' + (isTeam ? '자동 생성 요약 (팀원 라벨 기반 분류 결과 나열, 원문 아님)' : '리뷰 요약 (작성: 분석자, 원문 아님)') + '</span>' + esc(r.summary) + '</div>' +
      (r.originalText ? '<div class="summary-box"><span class="tag">원문</span>' + esc(r.originalText) + '</div>' : '<p class="small muted">원문 전문은 저장하지 않습니다(의견별 짧은 발췌만 표시). 전체 원문은 출처 링크에서 확인하세요.</p>') +
      '<h4 style="margin:12px 0 8px">추출 의견 ' + ops.length + '건</h4>' +
      ops.map(function (o) {
        return '<div class="op-card"><div class="top">' + C.sentimentChip(o) + '<span class="badge">' + esc(catName(o.categoryId)) + '</span>' +
          '<span class="badge">#' + esc(o.keyword) + '</span>' + statusBadge(o) + '<span class="small muted" style="margin-left:auto">' + esc(o.opinionId) + '</span></div>' +
          '<div>' + esc(o.summary) + '</div>' +
          (o.evidenceText ? '<div class="small" style="margin-top:4px"><span class="muted">원문 발췌:</span> <span class="excerpt">' + esc(o.evidenceText) + '</span></div>' : '') +
          (o.verificationStatus === 'on_hold' ? '<div class="hold">판단 보류 사유: ' + esc(o.holdReason) + '</div>' : '') +
          '</div>';
      }).join('');
    var dlg = $('reviewDialog');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  // ---------- 탭·이벤트 ----------
  function showTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    document.querySelectorAll('main section[data-panel]').forEach(function (s) { s.classList.toggle('hidden', s.dataset.panel !== tab); });
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
  }

  function render() {
    var res = A.applyFilters(state.data, state.filters);
    renderHeader(res);
    renderNotices(res, state.warnings);
    renderOverview(res);
    renderTopics(res);
    renderKeywords(res);
    renderOthers(res);
    renderExplore(res);
    renderSources();
  }

  function bindEvents() {
    document.getElementById('tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (b) showTab(b.dataset.tab);
    });
    var mainEl = document.querySelector('main');
    mainEl.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-undrill]'))) {
        var k = t.getAttribute('data-undrill');
        if (k === 'all') state.drill = {}; else delete state.drill[k];
        render(); return;
      }
      if ((t = e.target.closest('[data-othertab]'))) { state.otherTab = t.getAttribute('data-othertab'); render(); return; }
      if ((t = e.target.closest('[data-review]'))) { openReview(t.getAttribute('data-review')); return; }
      if ((t = e.target.closest('[data-drill]'))) {
        state.drill = JSON.parse(t.getAttribute('data-drill'));
        $('tooltip').style.display = 'none';
        render(); showTab('explore'); window.scrollTo({ top: 0 }); return;
      }
    });
    mainEl.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"], tr.clickable')) { e.preventDefault(); e.target.click(); }
    });
    $('dlgClose').addEventListener('click', function () { $('reviewDialog').close(); });
    $('reviewDialog').addEventListener('click', function (e) { if (e.target === this) this.close(); });
    C.attachTooltip(document.body, $('tooltip'));
  }

  function showFatal(title, items) {
    $('filters').innerHTML = '';
    document.querySelectorAll('main section[data-panel]').forEach(function (s) { s.innerHTML = ''; });
    $('notices').innerHTML = '<div class="notice error"><b>' + esc(title) + '</b>' +
      (items && items.length ? '<ul>' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
  }

  function init() {
    bindEvents();
    var initialTab = (location.hash || '').replace('#', '');
    if (document.querySelector('#tabs button[data-tab="' + initialTab + '"]')) showTab(initialTab);
    L.loadData('data/').then(function (out) {
      if (out.errors.length) {
        showFatal('데이터 검증 오류 — 집계를 표시하지 않습니다. data/*.json을 확인하세요. (' + out.errors.length + '건)', out.errors);
        return;
      }
      state.data = out.data;
      state.warnings = out.warnings;
      state.idx = {
        cat: A.indexBy(out.data.categories, 'categoryId'),
        game: A.indexBy(out.data.games, 'gameId'),
        col: A.indexBy(out.data.collections, 'collectionId'),
        review: A.indexBy(out.data.reviews, 'reviewId'),
      };
      state.filterBar = new root.GVL.FilterBar($('filters'), out.data, function (f) {
        state.filters = f;
        render();
      });
      state.filters = Object.assign({}, state.filterBar.state);
      render();
    }).catch(function (e) {
      var hint = location.protocol === 'file:'
        ? ['브라우저 보안 정책으로 파일을 직접 열면(file://) 데이터를 불러올 수 없습니다.', '프로젝트 폴더에서 "node tools/serve.js" 실행 후 http://localhost:8080 으로 접속하세요.']
        : [];
      showFatal('데이터를 불러오지 못했습니다: ' + e.message, hint);
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
