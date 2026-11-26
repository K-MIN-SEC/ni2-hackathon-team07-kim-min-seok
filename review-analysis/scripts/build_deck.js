const pptxgen = require("pptxgenjs");
const path = require("path");
const { applyTheme } = require(process.env.SKILL_DIR + "/scripts/apply_theme.js");

const OUT = process.argv[2];
const FONT = "Malgun Gothic";
const THEME = {
  name: "Moon Rabbit",
  headFontFace: FONT,
  bodyFontFace: FONT,
  colors: {
    dk1: "1B1F3B", lt1: "FFFFFF", dk2: "2E3560", lt2: "EEF0F7",
    accent1: "F2B84B", accent2: "E4572E", accent3: "2A9D8F", accent4: "F28CA0",
    accent5: "8A93B8", accent6: "6C5CE7", hlink: "2E3560", folHlink: "6C5CE7",
  },
};
const H = THEME.colors;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "달토끼 키우기 스토어 리뷰 분석";
pres.author = "NI2.0 AID 해커톤 7팀";
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
const C = pres.SchemeColor;

// ---------- layouts ----------
pres.defineSlideMaster({
  title: "TITLE_DARK",
  background: { color: C.text1 },
  objects: [
    { ellipse: { x: 9.3, y: -1.2, w: 5.2, h: 5.2, fill: { color: C.accent1, transparency: 10 }, line: { type: "none" } } },
    { ellipse: { x: 8.6, y: -1.6, w: 5.2, h: 5.2, fill: { color: C.text1 }, line: { type: "none" } } },
    { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.3, w: 9.5, h: 1.6, fontSize: 44, bold: true, color: C.background1, valign: "bottom", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 4.1, w: 9.5, h: 1.4, fontSize: 18, color: C.accent1, valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: C.background1 },
  margin: [0.5, 0.6, 0.6, 0.6],
  objects: [
    { ellipse: { x: 12.38, y: 0.5, w: 0.45, h: 0.45, fill: { color: C.accent1 }, line: { type: "none" } } },
    { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.35, w: 11.5, h: 0.8, fontSize: 32, bold: true, color: C.text1, valign: "middle", margin: 0 }, text: "" } },
    { text: { text: "달토끼 키우기 리뷰 분석 · NI2.0 AID 해커톤 7팀", options: { x: 0.6, y: 7.0, w: 8, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
  ],
  slideNumber: { x: 12.2, y: 7.0, w: 0.6, h: 0.3, fontSize: 10, color: H.accent5, align: "right" },
});

// ---------- helpers ----------
const shadow = () => ({ type: "outer", color: "1B1F3B", opacity: 0.12, blur: 8, offset: 2, angle: 90 });
function card(s, x, y, w, h, name, fill) {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.12, fill: { color: fill || C.background2 }, line: { type: "none" }, objectName: name });
}
function txt(s, text, o) {
  s.addText(text, Object.assign({ isTextBox: true, margin: 0, color: C.text1, fontSize: 14, valign: "top" }, o));
}
function dot(s, x, y, d, label, fill, color, name) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill || C.accent1 }, line: { type: "none" }, objectName: name });
  if (label !== undefined) txt(s, String(label), { x, y, w: d, h: d, align: "center", valign: "middle", bold: true, fontSize: d > 0.6 ? 18 : 14, color: color || C.text1 });
}
function stat(s, x, y, w, big, label, color, name) {
  card(s, x, y, w, 1.65, name);
  txt(s, big, { x: x + 0.3, y: y + 0.2, w: w - 0.6, h: 0.85, fontSize: 40, bold: true, color: color || C.text2, valign: "middle" });
  txt(s, label, { x: x + 0.3, y: y + 1.08, w: w - 0.6, h: 0.4, fontSize: 14, color: C.text2 });
}
const axis = {
  catAxisLabelColor: H.dk2, valAxisLabelColor: H.accent5,
  catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", dataLabelFontFace: "+mn-lt",
  titleFontFace: "+mn-lt", legendFontFace: "+mn-lt",
  catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, dataLabelFontSize: 12, dataLabelColor: H.dk1,
  valGridLine: { color: "E3E6F0", size: 0.75 }, catGridLine: { style: "none" },
  titleFontSize: 14, titleColor: H.dk1,
};
function content(title, section) {
  const s = pres.addSlide({ masterName: "CONTENT", sectionTitle: section });
  s.addText(title, { placeholder: "title" });
  return s;
}

// ================= 1. Title =================
pres.addSection({ title: "도입" });
let s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "도입" });
s.addText("달토끼 키우기\n스토어 리뷰 분석", { placeholder: "title" });
s.addText("리뷰 6,349건으로 찾은 '고칠 것'과 '지킬 것'\n2026 NI2.0 AID 해커톤 7팀 카페인 중독 · 배정 기업 ㈜에이블게임즈", { placeholder: "body" });
s.addNotes("2026 NI2.0 AID 해커톤 7팀입니다. 모바일 방치형 RPG '달토끼 키우기'의 스토어 리뷰 6,349건을 분석해, 개발사가 먼저 고쳐야 할 것과 지켜야 할 장점을 찾았습니다.");

// ================= 2. Problem =================
s = content("별점만으로는 무엇이 불만인지 알 수 없습니다", "도입");
card(s, 0.6, 1.5, 5.2, 5.1, "problem-card", C.text1);
txt(s, "“", { x: 0.95, y: 1.55, w: 1, h: 1.3, fontSize: 72, bold: true, color: C.accent1 });
txt(s, "게임 정말 재밌게 하고 있었습니다. 다만 오늘 패치 이후 … 여전히 플레이가 되지 않고 있습니다.", { x: 0.95, y: 2.6, w: 4.5, h: 1.9, fontSize: 18, color: C.background1 });
txt(s, "★★★★★ · 좋아요 65 · Google Play", { x: 0.95, y: 4.6, w: 4.5, h: 0.4, fontSize: 14, color: C.accent1 });
txt(s, "별점 5점이지만 내용은 버그 불만입니다.\n그래서 감성은 별점이 아니라 내용으로 판정했습니다.", { x: 0.95, y: 5.25, w: 4.5, h: 1.0, fontSize: 14, color: C.background2 });
const goals = [
  ["리뷰마다 판정", "감성(긍정·부정·중립·혼합), 주제(복수), 주제별 감성, 키워드"],
  ["우선순위 점수", "부정 건수 · 공감(좋아요) · 최근 추세로 '먼저 고칠 것' 계산"],
  ["오프라인 대시보드", "인터넷 없이 열리는 단일 HTML, 접근성 WCAG AA"],
  ["AI 없이 분류", "새 리뷰를 LLM 토큰 없이 분류하는 규칙 + ML 분류기"],
];
goals.forEach((g, i) => {
  const y = 1.55 + i * 1.27;
  dot(s, 6.4, y + 0.1, 0.7, i + 1, C.accent1, C.text1, "goal-dot-" + (i + 1));
  txt(s, g[0], { x: 7.35, y: y + 0.02, w: 5.3, h: 0.45, fontSize: 20, bold: true });
  txt(s, g[1], { x: 7.35, y: y + 0.5, w: 5.3, h: 0.6, fontSize: 14, color: C.text2 });
});
s.addNotes("리뷰는 많지만 별점만 보면 무엇이 왜 불만인지 알 수 없습니다. 실제로 별점 5점에 버그 불만만 적힌 리뷰가 좋아요 65개를 받았습니다. 그래서 네 가지를 목표로 했습니다.");

// ================= 3. Data =================
pres.addSection({ title: "데이터와 방법" });
s = content("글이 있는 한국어 리뷰를 전량 수집했습니다", "데이터와 방법");
stat(s, 0.6, 1.5, 3.0, "6,349", "리뷰 (GP 6,199 + iOS 150)", C.text1, "stat-reviews");
stat(s, 0.6, 3.35, 3.0, "4.39", "평균 별점", C.text1, "stat-rating");
stat(s, 0.6, 5.2, 3.0, "5.4년", "2021-06 ~ 2026-11", C.text1, "stat-period");
s.addChart(pres.charts.BAR, [{ name: "리뷰 수", labels: ["2021", "2022", "2023", "2024", "2025", "2026"], values: [1516, 3094, 851, 550, 236, 102] }], Object.assign({
  x: 4.0, y: 1.5, w: 8.7, h: 4.4, barDir: "col", objectName: "chart-yearly",
  chartColors: [H.dk2], showValue: true, dataLabelPosition: "outEnd", showLegend: false,
  showTitle: true, title: "연도별 리뷰 수", valAxisHidden: true, barGapWidthPct: 60,
}, axis));
txt(s, "스토어의 '리뷰 6.79만'은 글 없는 평점까지 센 수입니다. 별점별로 다시 받아 합계(6,199)가 같아 누락이 없음을 확인했습니다.", { x: 4.0, y: 6.1, w: 8.7, h: 0.7, fontSize: 14, color: C.text2 });
s.addNotes("Google Play 6,199건, App Store 150건, 총 6,349건입니다. 출시 직후인 2021~2022년에 리뷰가 몰려 있고 최근 6개월은 57건뿐이라 추세 수치는 조심해서 봐야 합니다.");

// ================= 4. Pipeline =================
s = content("확신하면 규칙으로, 애매하면 AI로 판정", "데이터와 방법");
const steps = [
  ["수집", "Google Play 스크래퍼\nApple RSS"],
  ["규칙 분류", "커뮤니티 표현 포함\n키워드 정규식 8주제"],
  ["애매 판정", "애매한 2,030건은\n판정 기준서로 AI 판정"],
  ["병합·검수", "최종 라벨 6,349건\n무작위 50건 검수"],
  ["분석", "우선순위 점수\n버전·월별 추이"],
  ["대시보드", "오프라인 단일 HTML\n차트 15개"],
];
const sw = 1.85, gap = 0.18;
steps.forEach((st, i) => {
  const x = 0.6 + i * (sw + gap);
  card(s, x, 1.55, sw, 2.35, "step-" + (i + 1));
  dot(s, x + 0.2, 1.75, 0.55, i + 1, C.accent1, C.text1, "step-dot-" + (i + 1));
  txt(s, st[0], { x: x + 0.2, y: 2.42, w: sw - 0.4, h: 0.45, fontSize: 18, bold: true });
  txt(s, st[1], { x: x + 0.2, y: 2.9, w: sw - 0.3, h: 0.9, fontSize: 12, color: C.text2 });
});
txt(s, "라벨 출처 (6,349건)", { x: 0.6, y: 4.3, w: 6, h: 0.4, fontSize: 16, bold: true });
const totalW = 12.1, ruleW = totalW * 4319 / 6349;
s.addShape(pres.shapes.RECTANGLE, { x: 0.6, y: 4.8, w: ruleW, h: 0.9, fill: { color: C.text2 }, line: { type: "none" }, objectName: "bar-rule" });
s.addShape(pres.shapes.RECTANGLE, { x: 0.6 + ruleW, y: 4.8, w: totalW - ruleW, h: 0.9, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "bar-ai" });
txt(s, "규칙 판정 4,319건 (68%)", { x: 0.85, y: 4.8, w: ruleW - 0.4, h: 0.9, fontSize: 18, bold: true, color: C.background1, valign: "middle" });
txt(s, "AI 판정 2,030건 (32%)", { x: 0.85 + ruleW, y: 4.8, w: totalW - ruleW - 0.4, h: 0.9, fontSize: 18, bold: true, valign: "middle" });
txt(s, "짧고 애매 플래그가 없는 리뷰", { x: 0.6, y: 5.85, w: ruleW, h: 0.4, fontSize: 14, color: C.text2 });
txt(s, "장문·감성신호 없음·별점과 반대 등 → 별점은 숨기고 판정", { x: 0.6 + ruleW, y: 5.85, w: totalW - ruleW, h: 0.7, fontSize: 14, color: C.text2 });
s.addNotes("파이프라인은 6단계입니다. 규칙이 확신하는 4,319건은 규칙 판정을 그대로 쓰고, 장문이나 감성어가 없는 애매한 2,030건은 판정 기준서에 따라 AI가 판정했습니다. 이때 별점은 일부러 보여주지 않았습니다.");

// ================= 5. Sentiment & topics =================
pres.addSection({ title: "분석 결과" });
s = content("버그는 95% 부정, 캐릭터/아트는 96% 긍정입니다", "분석 결과");
s.addChart(pres.charts.DOUGHNUT, [{ name: "감성", labels: ["긍정", "부정", "중립", "혼합"], values: [4384, 943, 599, 423] }], Object.assign({
  x: 0.6, y: 1.4, w: 4.4, h: 5.3, objectName: "chart-sentiment", holeSize: 55,
  chartColors: [H.accent3, H.accent2, H.accent5, H.accent1],
  showPercent: true, showValue: false, showLegend: true, legendPos: "b", legendFontSize: 12,
  showTitle: true, title: "전체 감성 (내용 기준)", dataLabelColor: H.lt1, dataLabelFontSize: 12,
}, { titleFontFace: "+mn-lt", legendFontFace: "+mn-lt", dataLabelFontFace: "+mn-lt", titleFontSize: 14, titleColor: H.dk1 }));
const topics = ["UI/편의성", "운영", "콘텐츠", "과금", "밸런스/성장", "캐릭터/아트", "버그"];
const pos = [77, 61, 232, 234, 279, 569, 23];
const neg = [109, 221, 114, 143, 185, 22, 636];
const tot = [193, 305, 386, 413, 500, 618, 669];
const oth = tot.map((t, i) => t - pos[i] - neg[i]);
s.addChart(pres.charts.BAR, [
  { name: "긍정", labels: topics, values: pos },
  { name: "중립·혼합", labels: topics, values: oth },
  { name: "부정", labels: topics, values: neg },
], Object.assign({
  x: 5.3, y: 1.4, w: 7.4, h: 5.3, barDir: "bar", barGrouping: "percentStacked", objectName: "chart-topic-sentiment",
  chartColors: [H.accent3, "C9CDE0", H.accent2], showLegend: true, legendPos: "b", legendFontSize: 12,
  showTitle: true, title: "주제별 감성 비율 (주제 언급 기준)", showValue: false, barGapWidthPct: 45,
  valAxisLabelFormatCode: "0%",
}, axis));
s.addNotes("전체로는 긍정이 69%로 평이 좋은 게임입니다. 하지만 주제별로 보면 버그는 669건 중 636건, 95%가 부정이고 운영도 72%가 부정입니다. 반대로 캐릭터/아트는 96%가 긍정입니다.");

// ================= 6. Priority =================
s = content("1순위로 고칠 것은 버그, 그중에서도 업데이트 불가입니다", "분석 결과");
const prLabels = ["버그 / 튕김", "운영 / 계정", "밸런스 / 보상·재화", "버그 / 발열", "버그 / 접속 불가", "밸런스 / 난이도", "버그 / 업데이트 불가"];
const prVals = [62.6, 63.0, 69.7, 71.3, 73.0, 74.2, 88.0];
s.addChart(pres.charts.BAR, [{ name: "우선순위 점수", labels: prLabels, values: prVals }], Object.assign({
  x: 0.6, y: 1.4, w: 7.6, h: 5.4, barDir: "bar", objectName: "chart-priority",
  chartColors: [H.accent2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0",
  showLegend: false, showTitle: true, title: "키워드별 우선순위 점수 Top 7", valAxisHidden: true, valAxisMaxVal: 100, barGapWidthPct: 45,
}, axis));
card(s, 8.6, 1.5, 4.1, 2.45, "topic-score-card", C.text1);
txt(s, "주제 단위 점수", { x: 8.9, y: 1.7, w: 3.5, h: 0.4, fontSize: 14, color: C.accent1, bold: true });
txt(s, "버그 90.4", { x: 8.9, y: 2.1, w: 3.5, h: 0.8, fontSize: 36, bold: true, color: C.background1 });
txt(s, "운영 42.2 · 밸런스 41.0 · 과금 36.6", { x: 8.9, y: 3.0, w: 3.6, h: 0.7, fontSize: 14, color: C.background2 });
card(s, 8.6, 4.2, 4.1, 2.6, "formula-card");
txt(s, "점수 = 100 × (", { x: 8.9, y: 4.4, w: 3.6, h: 0.4, fontSize: 14, bold: true });
txt(s, [
  { text: "0.5 · 부정·혼합 언급 수", options: { bullet: true, breakLine: true } },
  { text: "0.3 · 공감 (좋아요 log 가중)", options: { bullet: true, breakLine: true } },
  { text: "0.2 · 최근 6개월 추세 )", options: { bullet: true } },
], { x: 8.9, y: 4.85, w: 3.6, h: 1.2, fontSize: 14, paraSpaceAfter: 4 });
txt(s, "각 항목은 최댓값으로 나눠 0~1로 맞춤", { x: 8.9, y: 6.15, w: 3.6, h: 0.4, fontSize: 12, color: C.text2 });
s.addNotes("우선순위 점수는 부정 언급 수, 좋아요로 본 공감, 최근 추세를 합친 값입니다. 주제로는 버그가 90.4로 압도적이고, 키워드로는 업데이트 불가 88점, 난이도 74점, 접속 불가 73점 순입니다.");

// ================= 7. Strength & version =================
s = content("귀여움은 지키고, 1.120 이후 불만은 살피기", "분석 결과");
card(s, 0.6, 1.5, 5.6, 5.2, "strength-card");
txt(s, "지켜야 할 장점 · 캐릭터/아트", { x: 0.9, y: 1.75, w: 5.0, h: 0.4, fontSize: 16, bold: true, color: C.text2 });
txt(s, "96%", { x: 0.9, y: 2.2, w: 5.0, h: 1.3, fontSize: 72, bold: true, color: C.accent3 });
txt(s, "618건 중 569건 긍정", { x: 0.9, y: 3.5, w: 5.0, h: 0.4, fontSize: 16 });
const kws = [["귀여움", 383], ["캐릭터", 233], ["그래픽", 89], ["사운드", 43]];
kws.forEach((k, i) => {
  const y = 4.15 + i * 0.6, bw = 3.2 * k[1] / 383;
  txt(s, k[0], { x: 0.9, y, w: 1.1, h: 0.45, fontSize: 14, valign: "middle" });
  s.addShape(pres.shapes.RECTANGLE, { x: 2.0, y: y + 0.08, w: bw, h: 0.3, fill: { color: C.accent4 }, line: { type: "none" }, objectName: "kw-bar-" + i });
  txt(s, String(k[1]), { x: 2.1 + bw, y, w: 0.8, h: 0.45, fontSize: 14, bold: true, valign: "middle" });
});
s.addChart(pres.charts.BAR, [{ name: "부정·혼합 비중", labels: ["v1.99", "v1.120 (2025-05~)"], values: [0.167, 0.392] }], Object.assign({
  x: 6.6, y: 1.4, w: 6.1, h: 3.9, barDir: "col", objectName: "chart-version",
  chartColors: [H.accent5, H.accent2], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0%",
  showLegend: false, showTitle: true, title: "버전별 부정·혼합 비중", valAxisHidden: true, valAxisMaxVal: 0.5, barGapWidthPct: 70,
}, axis));
txt(s, [
  { text: "가장 크게 뛴 버전 변화 (+22.6%p)", options: { bold: true, breakLine: true } },
  { text: "늘어난 부정은 버그 +13.1%p, 운영 +6.8%p", options: { breakLine: true } },
  { text: "예: 결제 후 아이템 미지급 오류", options: { color: C.text2 } },
], { x: 6.8, y: 5.45, w: 5.9, h: 1.2, fontSize: 14, paraSpaceAfter: 4 });
s.addNotes("지켜야 할 장점은 캐릭터와 아트입니다. 96%가 긍정이고, 대표 키워드는 '귀여움' 383건입니다. 한편 1.99에서 1.120으로 넘어갈 때 부정 비중이 16.7%에서 39.2%로 가장 크게 뛰었고, 주로 버그와 운영 불만이 늘었습니다.");

// ================= 8. Label quality =================
pres.addSection({ title: "분류기와 검증" });
s = content("라벨은 직접 검수, 서비스에는 LLM 없음", "분류기와 검증");
txt(s, "무작위 50건 검수 (규칙 34 · AI 16)", { x: 0.6, y: 1.45, w: 6, h: 0.4, fontSize: 16, bold: true });
s.addTable([
  [{ text: "항목", options: { bold: true, color: H.lt1, fill: { color: H.dk2 } } }, { text: "처음", options: { bold: true, color: H.lt1, fill: { color: H.dk2 }, align: "center" } }, { text: "사전 보강 후", options: { bold: true, color: H.lt1, fill: { color: H.dk2 }, align: "center" } }],
  ["전체 감성", { text: "48/50", options: { align: "center" } }, { text: "50/50", options: { align: "center", bold: true, color: H.accent3 } }],
  ["주제 집합", { text: "49/50", options: { align: "center" } }, { text: "49/50", options: { align: "center" } }],
  ["주제별 감성", { text: "47/50", options: { align: "center" } }, { text: "49/50", options: { align: "center", bold: true, color: H.accent3 } }],
], { x: 0.6, y: 1.95, w: 6.0, colW: [2.4, 1.6, 2.0], rowH: 0.55, fontSize: 16, color: H.dk1, border: { type: "solid", color: "D5D9E8", pt: 0.75 }, fill: { color: H.lt1 }, valign: "middle", objectName: "table-audit" });
card(s, 0.6, 4.4, 6.0, 2.3, "audit-note");
txt(s, [
  { text: "AI 판정분은 16/16 모두 일치", options: { bold: true, breakLine: true } },
  { text: "오판 3건은 모두 규칙 쪽 오타·은어였습니다", options: { breakLine: true } },
  { text: "“주아”(=좋아), “현질게임”, “벌런스” → 오타·은어 사전 약 100개 보강", options: { color: C.text2 } },
], { x: 0.9, y: 4.65, w: 5.4, h: 1.8, fontSize: 14, paraSpaceAfter: 6 });
const resp = [
  ["학습 라벨", "LLM 사용함", "애매한 2,030건만, 판정 기준서(RUBRIC)로", C.accent1],
  ["서비스 분류", "LLM 사용 안 함", "새 리뷰는 로컬 모델로 분류, 토큰 비용 0", C.accent3],
  ["공정성", "별점 숨김", "감성은 리뷰 내용만 보고 판정", C.text2],
];
resp.forEach((r, i) => {
  const y = 1.5 + i * 1.75;
  card(s, 7.1, y, 5.6, 1.5, "resp-" + i);
  dot(s, 7.35, y + 0.4, 0.7, "", r[3], null, "resp-dot-" + i);
  txt(s, r[0], { x: 8.3, y: y + 0.2, w: 4.2, h: 0.35, fontSize: 12, color: C.text2 });
  txt(s, r[1], { x: 8.3, y: y + 0.52, w: 4.2, h: 0.45, fontSize: 20, bold: true });
  txt(s, r[2], { x: 8.3, y: y + 1.0, w: 4.2, h: 0.4, fontSize: 14, color: C.text2 });
});
s.addNotes("정답 라벨은 무작위 50건을 직접 검수했습니다. 처음에 감성 48건이 맞았고, 틀린 건은 모두 규칙의 오타·은어 문제여서 사전을 보강해 50건 모두 맞췄습니다. AI는 학습 라벨을 만들 때 한 번만 썼고, 실제 분류에는 쓰지 않습니다.");

// ================= 9. ML performance =================
s = content("어려운 리뷰 감성 정확도 62.2% → 89.7%", "분류기와 검증");
s.addChart(pres.charts.BAR, [{ name: "감성 정확도", labels: ["규칙 단독", "ML 1차\nTF-IDF", "ML 개선\nKiwi·가중치", "+ 문장\n임베딩", "+ 미세조정\n+ 오타 사전"], values: [0.622, 0.801, 0.819, 0.840, 0.897] }], Object.assign({
  x: 0.6, y: 1.4, w: 7.8, h: 5.4, barDir: "col", objectName: "chart-accuracy",
  chartColors: ["C9CDE0", "A9B0CF", "8A93B8", "2E3560", "F2B84B"], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0%",
  showLegend: false, showTitle: true, title: "어려운 리뷰 2,030건 감성 정확도 (5-겹 교차검증)", valAxisHidden: true, valAxisMinVal: 0.5, valAxisMaxVal: 1, barGapWidthPct: 40,
}, axis));
card(s, 8.8, 1.5, 3.9, 2.55, "hybrid-card");
txt(s, "하이브리드 구조", { x: 9.05, y: 1.7, w: 3.4, h: 0.4, fontSize: 16, bold: true });
txt(s, [
  { text: "규칙이 확신 → 규칙 판정", options: { bullet: true, breakLine: true } },
  { text: "애매 → 로지스틱 회귀 0.4 + 미세조정 임베딩 0.6", options: { bullet: true } },
], { x: 9.05, y: 2.15, w: 3.45, h: 1.7, fontSize: 14, paraSpaceAfter: 6 });
card(s, 8.8, 4.3, 3.9, 2.5, "f1-card", C.text1);
txt(s, "전체 6,349건 감성", { x: 9.05, y: 4.5, w: 3.4, h: 0.4, fontSize: 14, color: C.accent1, bold: true });
txt(s, "96.7%", { x: 9.05, y: 4.9, w: 3.4, h: 0.85, fontSize: 40, bold: true, color: C.background1 });
txt(s, "F1 긍정 0.93 · 부정 0.92\n혼합 0.87 · 중립 0.60", { x: 9.05, y: 5.8, w: 3.4, h: 0.8, fontSize: 14, color: C.background2 });
s.addNotes("규칙만 쓰면 어려운 리뷰의 38%를 틀려서 ML 분류기를 붙여 81.9%까지 올렸습니다. 오답을 보니 '환불 잘해줌'을 부정으로 읽는 것처럼 단어만 보고 있어서 한국어 문장 임베딩을 추가해 84.0%가 됐습니다. 이어서 임베딩 모델 자체를 우리 리뷰로 미세조정하고 오타·은어를 사전에 넣어 89.7%가 됐습니다.");

// ================= 10. Fixed cases =================
s = content("단어가 아니라 문장의 뜻을 읽게 되었습니다", "분류기와 검증");
const hdr = (t, al) => ({ text: t, options: { bold: true, color: H.lt1, fill: { color: H.dk2 }, align: al || "left" } });
const ok = (t) => ({ text: t + " ○", options: { color: H.accent3, bold: true, align: "center" } });
const ng = (t) => ({ text: t + " ×", options: { color: H.accent2, align: "center" } });
const ctr = (t) => ({ text: t, options: { align: "center" } });
s.addTable([
  [hdr("리뷰"), hdr("정답", "center"), hdr("이전 모델", "center"), hdr("개선 모델", "center")],
  ["결제후 환불잘해줌", ctr("긍정"), ng("부정"), ok("긍정")],
  ["와진짜 스트레스 가 팍 풀리네", ctr("긍정"), ng("부정"), ok("긍정")],
  ["즐겁게 게임 하고있습니다. 다만 아이폰에서는 쿠폰입력 기능이 아직 없다는 점입니다.", ctr("혼합"), ng("부정"), ok("혼합")],
  ["장착중인 스킬표시좀 해주세요 … 착용중인지 몰라 불편해요", ctr("부정"), ng("혼합"), ok("부정")],
  ["괜판네요 좀더해봐야 겠어요", ctr("긍정"), ng("중립"), ok("긍정")],
], { x: 0.6, y: 1.45, w: 12.1, colW: [7.3, 1.5, 1.65, 1.65], rowH: 0.62, fontSize: 14, color: H.dk1, border: { type: "solid", color: "D5D9E8", pt: 0.75 }, fill: { color: H.lt1 }, valign: "middle", objectName: "table-cases" });
stat(s, 0.6, 5.3, 3.8, "+167", "새로 맞힌 리뷰 (2차 개선)", C.accent3, "stat-fixed");
stat(s, 4.75, 5.3, 3.8, "-53", "새로 틀린 리뷰 (숨기지 않음)", C.accent2, "stat-broken");
card(s, 8.9, 5.3, 3.8, 1.65, "net-card", C.text1);
txt(s, "순증 +114건", { x: 9.2, y: 5.5, w: 3.3, h: 0.85, fontSize: 32, bold: true, color: C.accent1, valign: "middle" });
txt(s, "같은 정답·같은 분할로 비교", { x: 9.2, y: 6.38, w: 3.3, h: 0.4, fontSize: 14, color: C.background2 });
s.addNotes("실제 사례입니다. '환불 잘해줌', '스트레스가 풀리네'처럼 부정 단어가 들어간 긍정 문장, '다만 아쉬운 점은' 같은 혼합 리뷰, '괜판' 같은 오타를 이제 맞힙니다. 새로 틀린 53건도 숨기지 않고 비교했고, 순증 114건이라 채택했습니다.");

// ================= 11. Robustness & server =================
s = content("고유 단어에 기대지 않고, 서버도 안정적", "분류기와 검증");
card(s, 0.6, 1.5, 5.9, 5.2, "ablation-card");
txt(s, "편향 점검 · 고유 단어를 지우면?", { x: 0.9, y: 1.75, w: 5.3, h: 0.4, fontSize: 16, bold: true, color: C.text2 });
txt(s, "달토끼, 니아, 루비, 이터널리턴 … 게임명·캐릭터·재화·콜라보 단어를 지우고 같은 조건으로 재학습", { x: 0.9, y: 2.2, w: 5.3, h: 0.8, fontSize: 14, color: C.text2 });
txt(s, "84.8% → 84.8%", { x: 0.9, y: 3.15, w: 5.3, h: 0.9, fontSize: 40, bold: true, color: C.text1 });
txt(s, "어려운 리뷰 감성 정확도 (제거 전 → 후)", { x: 0.9, y: 4.05, w: 5.3, h: 0.4, fontSize: 14, color: C.text2 });
txt(s, [
  { text: "고유 단어가 든 193건: 판정 변화 0건", options: { bullet: true, breakLine: true } },
  { text: "고유 단어 특징 비중: 전체 가중치의 0.47%", options: { bullet: true, breakLine: true } },
  { text: "우선순위 결론 그대로 (버그 부정 626 → 627)", options: { bullet: true } },
], { x: 0.9, y: 4.65, w: 5.3, h: 1.7, fontSize: 14, paraSpaceAfter: 6 });
txt(s, "로컬 분류 API 서버", { x: 6.9, y: 1.5, w: 5.8, h: 0.4, fontSize: 16, bold: true, color: C.text2 });
s.addChart(pres.charts.BAR, [{ name: "메모리 (GB)", labels: ["요청 스레드마다 실행", "판정 전용 스레드 1개"], values: [5.1, 2.62] }], Object.assign({
  x: 6.9, y: 1.95, w: 5.8, h: 2.6, barDir: "bar", objectName: "chart-memory",
  chartColors: [H.accent2, H.accent3], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0\"GB\"",
  showLegend: false, showTitle: false, valAxisHidden: true, valAxisMaxVal: 6.5, barGapWidthPct: 50,
}, axis));
const perf = [["7ms", "규칙 판정 1건"], ["190ms", "ML 판정 1건"], ["11~12건/초", "실제 리뷰 처리량"]];
perf.forEach((p, i) => {
  const x = 6.9 + i * 1.98;
  card(s, x, 4.8, 1.82, 1.9, "perf-" + i);
  txt(s, p[0], { x: x + 0.15, y: 5.0, w: 1.55, h: 0.8, fontSize: 20, bold: true, color: C.text1, valign: "middle" });
  txt(s, p[1], { x: x + 0.15, y: 5.85, w: 1.55, h: 0.6, fontSize: 12, color: C.text2 });
});
s.addNotes("학습 데이터가 모두 이 게임 리뷰라 고유 단어를 외운 건 아닌지 점검했습니다. 고유 단어를 지우고 다시 학습해도 정확도가 84.8%로 같았고, 해당 리뷰 193건의 판정이 하나도 바뀌지 않았습니다. 분류기는 로컬 API 서버로도 제공하며, 메모리가 계속 늘던 문제를 판정 전용 스레드로 해결했습니다.");

// ================= 12. Lessons =================
pres.addSection({ title: "마무리" });
s = content("개발하며 배운 점", "마무리");
const lessons = [
  ["숫자 하나로는 부족했다", "전체 94%는 쉬운 리뷰가 만든 착시였습니다. 어려운 리뷰만 따로 채점하고 오답을 유형별로 나누니 진짜 약점(문맥)이 보였습니다."],
  ["정확도만 보면 우선순위가 왜곡된다", "클래스 가중치 balanced는 콘텐츠 부정을 129 → 332건으로 부풀렸습니다. 주제별 부정 건수도 정답과 비교하는 기준을 세웠습니다."],
  ["모델의 한계는 라벨의 한계였다", "오타 사전을 보강하자 규칙이 만든 정답 96건이 바로잡혔습니다. 모델보다 판정 기준을 먼저 정리해야 했습니다."],
  ["좋은 개선이 다른 개선을 지운다", "판정 기준 조정은 단독으로 +0.7%p였지만 미세조정과 합치면 -0.9%p였습니다. 최종 조합에서 다시 확인했습니다."],
];
lessons.forEach((l, i) => {
  const x = 0.6 + (i % 2) * 6.15, y = 1.5 + Math.floor(i / 2) * 2.7;
  card(s, x, y, 5.95, 2.45, "lesson-" + i);
  dot(s, x + 0.3, y + 0.3, 0.6, i + 1, C.accent1, C.text1, "lesson-dot-" + i);
  txt(s, l[0], { x: x + 1.1, y: y + 0.3, w: 4.6, h: 0.6, fontSize: 18, bold: true, valign: "middle" });
  txt(s, l[1], { x: x + 0.3, y: y + 1.05, w: 5.35, h: 1.25, fontSize: 14, color: C.text2 });
});
s.addNotes("개발하며 배운 점 네 가지입니다. 특히 정확도만 보지 않고 운영자가 보는 우선순위가 왜곡되지 않는지 주제별 부정 건수도 함께 확인했습니다.");

// ================= 13. Limits & next =================
s = pres.addSlide({ masterName: "TITLE_DARK", sectionTitle: "마무리" });
s.addText("한계와 다음 단계", { placeholder: "title" });
s.addText("남은 오답 약 10%는 반어 · ‘(수정)’ 리뷰 · 걱정·응원처럼 문맥을 읽어야 하는 리뷰입니다", { placeholder: "body" });
s.addNotes("아직 반어나 '(수정) 복구받았습니다' 같은 리뷰는 놓칩니다. 다음 단계는 절 단위 판정과 판정 기준 통일입니다. 감사합니다.");
// two columns of short items under the subtitle area — placed lower to avoid the placeholders
const lim = ["App Store 150건 → 사실상 Google Play 기준", "최근 6개월 57건 → 추세 수치 불안정", "정답 1/3이 AI 판정 → 'AI 정답과의 일치도'", "다른 게임에서의 정확도는 미측정"];
const nxt = ["“다만·근데” 기준 절 단위 감성 판정", "“(수정)” 뒤 내용을 최종 상태로 반영", "요청·걱정·응원 판정 기준 통일 후 재라벨링", "확신도 낮은 리뷰는 “검토 필요” 표시"];
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 0.8, y: 5.2, w: 5.8, h: 1.95, rectRadius: 0.12, fill: { color: C.text2 }, line: { type: "none" }, objectName: "limits-card" });
s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 6.85, y: 5.2, w: 5.8, h: 1.95, rectRadius: 0.12, fill: { color: C.text2 }, line: { type: "none" }, objectName: "next-card" });
txt(s, "한계", { x: 1.05, y: 5.35, w: 5.4, h: 0.35, fontSize: 14, bold: true, color: C.accent1 });
txt(s, "다음 단계", { x: 7.1, y: 5.35, w: 5.4, h: 0.35, fontSize: 14, bold: true, color: C.accent1 });
txt(s, lim.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < lim.length - 1 } })), { x: 1.05, y: 5.75, w: 5.4, h: 1.3, fontSize: 14, color: C.background2, paraSpaceAfter: 2, valign: "top" });
txt(s, nxt.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < nxt.length - 1 } })), { x: 7.1, y: 5.75, w: 5.4, h: 1.3, fontSize: 14, color: C.background1, paraSpaceAfter: 2, valign: "top" });

(async () => {
  await pres.writeFile({ fileName: OUT });
  await applyTheme(OUT, THEME);
  console.log("wrote", OUT);
})();
