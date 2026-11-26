/*
 * Game Voice Lab — 자체 차트 렌더링 (FUNC-009)
 * 모든 수치는 analytics 결과에서 받는다. 하드코딩된 수치 없음.
 * 감성은 색상 + 텍스트 + 수치로 함께 표시한다(색상 단독 의존 금지).
 */
(function (root) {
  'use strict';
  var A = root.GVL.analytics;

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function drillAttr(obj) { return obj ? ' data-drill="' + esc(JSON.stringify(obj)) + '"' : ''; }
  function tipAttr(text) { return text ? ' data-tip="' + esc(text) + '"' : ''; }
  function width(v, max) { return max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0; }

  /**
   * 단일 계열 가로 막대 목록.
   * rows: [{label, sub, value, valueText, tip, drill, cls}]
   */
  function hbars(rows, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="empty">' + esc(opts.emptyText || '데이터 없음') + '</div>';
    var max = opts.max !== undefined ? opts.max : Math.max.apply(null, rows.map(function (r) { return r.value; }));
    return '<div class="hbars ' + esc(opts.cls || '') + '">' + rows.map(function (r) {
      return '<div class="hbar-row' + (r.drill ? ' clickable' : '') + '"' + drillAttr(r.drill) + tipAttr(r.tip) +
        (r.drill ? ' role="button" tabindex="0"' : '') + '>' +
        '<span class="lbl" title="' + esc(r.label) + '">' + esc(r.label) + (r.sub ? ' <span class="muted">' + esc(r.sub) + '</span>' : '') + '</span>' +
        '<span class="track"><span class="fill ' + esc(r.cls || opts.fillCls || 'neutral') + '" style="width:' + width(r.value, max).toFixed(2) + '%"></span></span>' +
        '<span class="val">' + esc(r.valueText !== undefined ? r.valueText : r.value) + '</span>' +
        '</div>';
    }).join('') + '</div>';
  }

  /** 감성 3분할 100% 누적 막대 + 범례(개수·비율 병기) */
  function sentimentStack(stats, extraDrill) {
    if (!stats.total) return '<div class="empty">데이터 없음</div>';
    var segs = A.SENTIMENTS.map(function (s) {
      var c = stats[s].count;
      if (!c) return '';
      var tip = A.SENTIMENT_LABEL[s] + ' ' + c + '건 (' + A.fmtPct(stats[s].pct) + ')\n분모: 의견 ' + stats.total + '건';
      return '<span class="seg ' + s + '" style="flex:' + c + ' 1 0"' + tipAttr(tip) + drillAttr(Object.assign({ sentiment: s }, extraDrill || {})) +
        ' role="button" tabindex="0" aria-label="' + esc(tip) + '"></span>';
    }).join('');
    var legend = A.SENTIMENTS.map(function (s) {
      return '<span class="item"' + drillAttr(Object.assign({ sentiment: s }, extraDrill || {})) + ' role="button" tabindex="0">' +
        '<span class="swatch ' + s + '"></span>' + A.SENTIMENT_LABEL[s] + ' <b>' + stats[s].count + '</b>건 (' + A.fmtPct(stats[s].pct) + ')</span>';
    }).join('');
    return '<div class="stack stack-big">' + segs + '</div><div class="legend">' + legend + '</div>';
  }

  /** 카테고리별 감성 누적 막대: 막대 길이 = 의견 수(최댓값 기준), 구간 = 감성 */
  function categoryStacks(rows, totalOpinions) {
    var nonEmpty = rows.filter(function (r) { return r.total > 0; });
    if (!nonEmpty.length) return '<div class="empty">데이터 없음</div>';
    var max = Math.max.apply(null, nonEmpty.map(function (r) { return r.total; }));
    var body = rows.map(function (r) {
      var segs = A.SENTIMENTS.map(function (s) {
        if (!r[s]) return '';
        var tip = r.name + ' · ' + A.SENTIMENT_LABEL[s] + ' ' + r[s] + '건\n카테고리 내부 비율 ' + A.fmtPct(r[s + 'Pct']) + ' (분모 ' + r.total + '건)';
        return '<span class="seg ' + s + '" style="flex:' + r[s] + ' 1 0"' + tipAttr(tip) +
          drillAttr({ categoryId: r.categoryId, sentiment: s }) + ' role="button" tabindex="0" aria-label="' + esc(tip) + '"></span>';
      }).join('');
      var bar = r.total
        ? '<div class="stack" style="width:' + width(r.total, max).toFixed(2) + '%">' + segs + '</div>'
        : '<div class="small muted">0건</div>';
      return '<div class="cat-row">' +
        '<span class="name"' + drillAttr({ categoryId: r.categoryId }) + ' role="button" tabindex="0"' + tipAttr(r.scope ? '분류 대상: ' + r.scope : '') + '>' + esc(r.name) + '</span>' +
        '<div class="bar-area">' + bar + '</div>' +
        '<span class="nums"><b>' + r.total + '</b>건 · 전체의 ' + A.fmtPct(r.share) +
        ' <span class="muted">(+' + r.positive + ' / −' + r.negative + ' / 기타 ' + r.other + ')</span></span>' +
        '</div>';
    }).join('');
    var legend = A.SENTIMENTS.map(function (s) {
      return '<span class="item"><span class="swatch ' + s + '"></span>' + A.SENTIMENT_LABEL[s] + '</span>';
    }).join('');
    return '<div class="legend" style="margin:0 0 8px">' + legend + '</div>' + body +
      '<p class="small muted" style="margin:8px 0 0">막대 길이는 의견 수(최대 ' + max + '건 기준), "전체의 %"는 전체 의견 ' + totalOpinions + '건 대비 비중입니다.</p>';
  }

  function sentimentChip(o) {
    var label = A.SENTIMENT_LABEL[o.sentiment] + (o.sentiment === 'other' && o.otherType ? '·' + A.OTHER_TYPE_LABEL[o.otherType] : '');
    return '<span class="chip ' + esc(o.sentiment) + '">' + esc(label) + '</span>';
  }

  function attachTooltip(container, tipEl) {
    function move(e) {
      var x = e.clientX + 14, y = e.clientY + 14;
      var w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
      tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
    }
    container.addEventListener('mouseover', function (e) {
      var t = e.target.closest('[data-tip]');
      if (!t) return;
      tipEl.textContent = t.getAttribute('data-tip');
      tipEl.style.display = 'block';
      move(e);
    });
    container.addEventListener('mousemove', function (e) {
      if (tipEl.style.display === 'block') move(e);
    });
    container.addEventListener('mouseout', function (e) {
      var t = e.target.closest('[data-tip]');
      if (t && !t.contains(e.relatedTarget)) tipEl.style.display = 'none';
    });
  }

  root.GVL.charts = {
    esc: esc, hbars: hbars, sentimentStack: sentimentStack, categoryStacks: categoryStacks,
    sentimentChip: sentimentChip, attachTooltip: attachTooltip,
  };
})(window);
