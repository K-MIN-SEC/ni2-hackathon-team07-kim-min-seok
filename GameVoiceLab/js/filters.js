/*
 * Game Voice Lab — 공통 필터 UI (FUNC-007, 12.1)
 * 필터 선택지는 데이터에서 생성한다.
 */
(function (root) {
  'use strict';
  var A = root.GVL.analytics;
  var esc = root.GVL.charts.esc;

  function opt(value, label, selected) {
    return '<option value="' + esc(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  /**
   * @param {HTMLFormElement} form
   * @param {object} data
   * @param {function(object)} onChange 필터 상태 전달
   */
  function FilterBar(form, data, onChange) {
    this.form = form;
    this.data = data;
    this.onChange = onChange;
    var types = uniq(data.reviews.map(function (r) { return r.dataType; }));
    this.defaultDataType = types.indexOf('actual') >= 0 ? 'actual' : (types[0] || null);
    this.state = Object.assign(A.emptyFilters(), { dataType: this.defaultDataType });
    this.render();
  }

  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { if (x !== null && x !== undefined && !seen[x]) { seen[x] = true; out.push(x); } });
    return out;
  }

  FilterBar.prototype.render = function () {
    var d = this.data, s = this.state;
    var types = uniq(d.reviews.map(function (r) { return r.dataType; }));
    var platforms = uniq(d.reviews.map(function (r) { return r.platform; }));
    var range = A.dateRange(d.reviews);
    var sentimentValue = s.sentiment ? (s.sentiment + (s.otherType ? ':' + s.otherType : '')) : '';
    var catName = {};
    d.categories.forEach(function (c) { catName[c.categoryId] = c.name; });
    var keywords = d.keywords.slice().sort(function (a, b) { return a.keyword.localeCompare(b.keyword, 'ko'); });

    var html = '' +
      '<label>데이터 유형<select name="dataType">' +
      (types.length ? types.map(function (t) { return opt(t, t === 'actual' ? '실제 데이터' : '샘플 데이터', s.dataType === t); }).join('') : opt('', '데이터 없음', true)) +
      '</select></label>' +
      '<label>게임<select name="gameId">' + opt('', '전체', !s.gameId) +
      d.games.map(function (g) { return opt(g.gameId, g.name, s.gameId === g.gameId); }).join('') + '</select></label>' +
      '<label>스토어<select name="platform">' + opt('', '전체', !s.platform) +
      platforms.map(function (p) { return opt(p, p, s.platform === p); }).join('') + '</select></label>' +
      '<label>작성일(KST)<span class="date-pair">' +
      '<input type="date" name="dateFrom" value="' + esc(s.dateFrom || '') + '"' + (range.min ? ' min="' + range.min + '" max="' + range.max + '"' : '') + ' aria-label="시작일">' +
      '<span class="muted">~</span>' +
      '<input type="date" name="dateTo" value="' + esc(s.dateTo || '') + '"' + (range.min ? ' min="' + range.min + '" max="' + range.max + '"' : '') + ' aria-label="종료일">' +
      '</span></label>' +
      '<label>별점<select name="rating">' + opt('', '전체', s.rating === null) +
      [5, 4, 3, 2, 1].map(function (n) { return opt(String(n), n + '점', s.rating === n); }).join('') + '</select></label>' +
      '<span class="divider" aria-hidden="true"></span>' +
      '<label>카테고리<select name="categoryId">' + opt('', '전체', !s.categoryId) +
      d.categories.map(function (c) { return opt(c.categoryId, c.name, s.categoryId === c.categoryId); }).join('') + '</select></label>' +
      '<label>감성<select name="sentiment">' + opt('', '전체', !sentimentValue) +
      opt('positive', '긍정', sentimentValue === 'positive') +
      opt('negative', '부정', sentimentValue === 'negative') +
      opt('other', '기타(전체)', sentimentValue === 'other') +
      A.OTHER_TYPES.map(function (t) { return opt('other:' + t, '기타 · ' + A.OTHER_TYPE_LABEL[t], sentimentValue === 'other:' + t); }).join('') +
      '</select></label>' +
      '<label>키워드<select name="keyword">' + opt('', '전체', !s.keyword) +
      keywords.map(function (k) { return opt(k.keyword, k.keyword + ' (' + (catName[k.categoryId] || '') + ')', s.keyword === k.keyword); }).join('') +
      '</select></label>' +
      '<button type="button" class="btn" data-action="reset">필터 초기화</button>';
    this.form.innerHTML = html;

    var self = this;
    this.form.onchange = function (e) { self.read(e.target); };
    this.form.querySelector('[data-action="reset"]').onclick = function () { self.reset(); };
  };

  FilterBar.prototype.read = function (target) {
    var f = this.form, s = this.state;
    s.dataType = f.dataType.value || null;
    s.gameId = f.gameId.value || null;
    s.platform = f.platform.value || null;
    s.dateFrom = f.dateFrom.value || null;
    s.dateTo = f.dateTo.value || null;
    if (s.dateFrom && s.dateTo && s.dateFrom > s.dateTo) {
      // 시작일이 종료일보다 늦으면 방금 바꾼 값에 맞춰 다른 쪽을 맞춘다
      if (target && target.name === 'dateFrom') { s.dateTo = s.dateFrom; f.dateTo.value = s.dateTo; }
      else { s.dateFrom = s.dateTo; f.dateFrom.value = s.dateFrom; }
    }
    s.rating = f.rating.value ? Number(f.rating.value) : null;
    s.categoryId = f.categoryId.value || null;
    var sv = f.sentiment.value;
    s.sentiment = sv ? sv.split(':')[0] : null;
    s.otherType = sv && sv.indexOf(':') > 0 ? sv.split(':')[1] : null;
    s.keyword = f.keyword.value || null;
    this.onChange(Object.assign({}, s));
  };

  /** 외부(차트 클릭 등)에서 일부 필터를 설정 */
  FilterBar.prototype.set = function (partial) {
    Object.assign(this.state, partial);
    this.render();
    this.onChange(Object.assign({}, this.state));
  };

  FilterBar.prototype.reset = function () {
    this.state = Object.assign(A.emptyFilters(), { dataType: this.defaultDataType });
    this.render();
    this.onChange(Object.assign({}, this.state));
  };

  /** 현재 필터를 사람이 읽는 문장으로 */
  FilterBar.prototype.describe = function () {
    var s = this.state, d = this.data, parts = [];
    var g = d.games.find(function (x) { return x.gameId === s.gameId; });
    if (g) parts.push('게임: ' + g.name);
    if (s.platform) parts.push('스토어: ' + s.platform);
    if (s.dateFrom || s.dateTo) parts.push('작성일: ' + (s.dateFrom || '처음') + ' ~ ' + (s.dateTo || '끝'));
    if (s.rating !== null) parts.push('별점: ' + s.rating + '점');
    var c = d.categories.find(function (x) { return x.categoryId === s.categoryId; });
    if (c) parts.push('카테고리: ' + c.name);
    if (s.sentiment) parts.push('감성: ' + A.SENTIMENT_LABEL[s.sentiment] + (s.otherType ? '·' + A.OTHER_TYPE_LABEL[s.otherType] : ''));
    if (s.keyword) parts.push('키워드: ' + s.keyword);
    return parts;
  };

  root.GVL.FilterBar = FilterBar;
})(window);
