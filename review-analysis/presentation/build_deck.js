// 플레이노트 발표 자료 생성 (pptxgenjs)
// 실행: NODE_PATH=<pptxgenjs가 설치된 node_modules> node presentation/build_deck.js
// 결과: presentation/플레이노트_발표.pptx
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");
const sharp = require("sharp");
const React = require("react");
const ReactDOMServer = require("react-dom/server");
const Fa = require("react-icons/fa");

const ROOT = path.resolve(__dirname, "..");
const ASSETS = path.join(__dirname, "assets");
const OUT = path.join(__dirname, "플레이노트_발표.pptx");
const APPLY_THEME = process.env.APPLY_THEME; // pptx 스킬의 scripts/apply_theme.js 경로

const analysis = JSON.parse(fs.readFileSync(path.join(ROOT, "work/analysis.json"), "utf8"));

// ---------- 테마 ----------
const HEX = {
  ink: "1A1D24", white: "FFFFFF", navy: "14213D", card: "F2F4F8",
  blue: "2B6CD4", red: "E5484D", amber: "C98A0A", gray: "8A8F98",
  sky: "DCE7FA", yellow: "F5C04A", navy2: "22335A", mute: "5B6270", line: "D9DDE5",
};
const FONT = "Malgun Gothic";
const THEME = {
  name: "PlayNote",
  headFontFace: FONT,
  bodyFontFace: FONT,
  colors: {
    dk1: HEX.ink, lt1: HEX.white, dk2: HEX.navy, lt2: HEX.card,
    accent1: HEX.blue, accent2: HEX.red, accent3: HEX.amber, accent4: HEX.gray,
    accent5: HEX.yellow, accent6: HEX.sky, hlink: HEX.blue, folHlink: "6B4FBB",
  },
};

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.theme = { headFontFace: FONT, bodyFontFace: FONT };
pres.title = "플레이노트 — 스토어 리뷰 분석";
pres.author = "7팀 카페인 중독";
const C = pres.SchemeColor;
// 스킴 색 이름
const S = {
  ink: C.text1, white: C.background1, navy: C.text2, card: C.background2,
  blue: C.accent1, red: C.accent2, amber: C.accent3, gray: C.accent4, yellow: C.accent5, sky: C.accent6,
  mute: HEX.mute,
};

const W = 13.333, MX = 0.6, CW = W - 2 * MX; // 콘텐츠 폭 12.133

// ---------- 레이아웃 ----------
const footer = (color) => ({ text: { text: "플레이노트 · 2026 NI2.0 AID 해커톤 7팀 카페인 중독", options: { x: MX, y: 7.02, w: 8, h: 0.3, fontSize: 10, color, margin: 0 } } });
pres.defineSlideMaster({
  title: "CONTENT",
  background: { color: HEX.white },
  objects: [
    footer(S.gray),
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.72, w: CW, h: 0.8, fontSize: 28, bold: true, color: S.ink, valign: "middle", align: "left", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 12.23, y: 7.02, w: 0.5, h: 0.3, fontSize: 10, color: S.gray, align: "right" },
});
pres.defineSlideMaster({
  title: "CONTENT_DARK",
  background: { color: HEX.navy },
  objects: [
    footer("9AA6C2"),
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.72, w: CW, h: 0.8, fontSize: 28, bold: true, color: S.white, valign: "middle", align: "left", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 12.23, y: 7.02, w: 0.5, h: 0.3, fontSize: 10, color: "9AA6C2", align: "right" },
});
pres.defineSlideMaster({
  title: "COVER",
  background: { color: HEX.navy },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 2.35, w: 5.6, h: 1.2, fontSize: 60, bold: true, color: S.white, valign: "middle", align: "left", margin: 0 }, text: "" } },
  ],
});

// ---------- 공통 도우미 ----------
const iconCache = {};
async function icon(name, color = "#FFFFFF") {
  const key = name + color;
  if (!iconCache[key]) {
    const svg = ReactDOMServer.renderToStaticMarkup(React.createElement(Fa[name], { color, size: 256 }));
    const buf = await sharp(Buffer.from(svg)).resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    iconCache[key] = "image/png;base64," + buf.toString("base64");
  }
  return iconCache[key];
}
const shadow = () => ({ type: "outer", color: "000000", opacity: 0.16, blur: 10, offset: 3, angle: 90 });

function kicker(slide, text, dark = false) {
  slide.addText(text, { x: MX, y: 0.38, w: 8, h: 0.32, fontSize: 13, bold: true, color: dark ? S.yellow : S.blue, margin: 0, isTextBox: true, objectName: "kicker" });
}
function box(slide, x, y, w, h, fill, opts = {}) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: opts.r ?? 0.12, fill: { color: fill }, line: opts.line ? { color: opts.line, width: 1 } : { type: "none" }, shadow: opts.shadow ? shadow() : undefined, objectName: opts.name });
}
async function badge(slide, x, y, s, iconName, fill) {
  box(slide, x, y, s, s, fill, { r: s * 0.22 });
  const p = s * 0.24;
  slide.addImage({ data: await icon(iconName), x: x + p, y: y + p, w: s - 2 * p, h: s - 2 * p, altText: "" });
}
function numBadge(slide, x, y, s, n, fill, color = S.white) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: s, h: s, fill: { color: fill }, line: { type: "none" } });
  slide.addText(String(n), { x, y, w: s, h: s, align: "center", valign: "middle", fontSize: s * 26, bold: true, color, margin: 0, isTextBox: true });
}
function chip(slide, x, y, w, text, opts = {}) {
  const h = opts.h ?? 0.4;
  box(slide, x, y, w, h, opts.fill ?? S.white, { r: h / 2, line: opts.line });
  slide.addText(text, { x, y, w, h, align: "center", valign: "middle", fontSize: opts.size ?? 12.5, bold: !!opts.bold, color: opts.color ?? S.ink, margin: 0, isTextBox: true });
}
async function framedImage(slide, file, x, y, w, alt) {
  const meta = await sharp(file).metadata();
  const h = w * meta.height / meta.width;
  const b = 0.06;
  box(slide, x - b, y - b, w + 2 * b, h + 2 * b, S.white, { r: 0.08, shadow: true, line: HEX.line });
  slide.addImage({ path: file, x, y, w, h, altText: alt });
  return h;
}
async function crop(src, dst, left, top, width, height) {
  await sharp(path.join(ASSETS, src)).extract({ left, top, width, height }).toFile(path.join(ASSETS, dst));
  return path.join(ASSETS, dst);
}
// 차트 공통 (모든 차트의 글자 모양을 같게)
const chartBase = () => ({
  catAxisLabelColor: HEX.mute, valAxisLabelColor: HEX.mute,
  catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt", dataLabelFontFace: "+mn-lt", legendFontFace: "+mn-lt", titleFontFace: "+mn-lt",
  catAxisLabelFontSize: 12, valAxisLabelFontSize: 11, dataLabelFontSize: 12, legendFontSize: 12, titleFontSize: 13,
  titleColor: HEX.ink, dataLabelColor: HEX.ink,
  valGridLine: { color: "E6E8EE", size: 0.75 }, catGridLine: { style: "none" },
  catAxisLineShow: false, valAxisLineShow: false,
});

(async () => {
  // 화면 캡처 자르기
  const dlgImg = await crop("03_mergeDlg.png", "c_mergeDlg.png", 822, 502, 914, 594);
  const addImg = await crop("04_afterAdd.png", "c_afterAdd.png", 110, 40, 2340, 850);
  const mapleImg = await crop("12_maple_top.png", "c_maple.png", 110, 40, 2340, 1170);
  const fullImg = path.join(ASSETS, "05_full_top.png");

  // ================= 1. 표지 =================
  {
    const s = pres.addSlide({ masterName: "COVER" });
    s.addText("2026 NI2.0 AID 해커톤 · 7팀 카페인 중독", { x: MX, y: 1.75, w: 5.6, h: 0.4, fontSize: 15, bold: true, color: S.yellow, margin: 0, isTextBox: true });
    s.addText("플레이노트", { placeholder: "title" });
    s.addText("스토어 리뷰를 ‘고칠 것’과 ‘지킬 것’으로\n정리해 주는 리뷰 분석 도구", { x: MX, y: 3.7, w: 5.6, h: 1.0, fontSize: 20, color: "DCE3F2", margin: 0, isTextBox: true, paraSpaceAfter: 2 });
    s.addText("배정 기업 ㈜에이블게임즈 · 분석 대상 ‘달토끼 키우기’", { x: MX, y: 5.0, w: 5.6, h: 0.35, fontSize: 13, color: "9AA6C2", margin: 0, isTextBox: true });
    await framedImage(s, fullImg, 6.75, 1.65, 6.0, "플레이노트 대시보드 첫 화면: 리뷰 6,349건, 내용상 긍정 69%, 불만 22%");
    s.addNotes("안녕하세요, 7팀 카페인 중독입니다. 저희는 스토어 리뷰를 '고칠 것'과 '지킬 것'으로 정리해 주는 리뷰 분석 도구, 플레이노트를 만들었습니다. 배정 기업 에이블게임즈의 '달토끼 키우기' 리뷰로 만들고 검증했습니다. (약 15초)");
  }

  // ================= 2. 문제 제기 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "문제 제기");
    s.addText("리뷰는 많은데, 무엇을 고쳐야 할지는 보이지 않습니다", { placeholder: "title" });
    const cw = 3.85, gap = (CW - 3 * cw) / 2, y = 1.85, h = 4.85;
    const cards = [
      { icon: "FaStar", fill: S.amber, head: "별점으로는 불만을 모른다", stat: "590건", color: S.amber, desc: "별점 4~5점인데 내용은 불만이거나 장단점이 섞인 리뷰 (전체의 9.3%)" },
      { icon: "FaLayerGroup", fill: S.blue, head: "흩어진 리뷰, 모아 보기 어렵다", stat: "6,349건", color: S.blue, desc: "스토어 2곳, 5년 넘게 쌓인 리뷰를 사람이 일일이 읽고 정리해야 함" },
      { icon: "FaCommentSlash", fill: S.gray, head: "의미 없는 리뷰가 대부분", stat: "63%", color: S.mute, desc: "‘굿’, ‘재밌어요’처럼 무엇이 좋은지·나쁜지 알 수 없는 리뷰 (4,015건)" },
    ];
    for (let i = 0; i < 3; i++) {
      const c = cards[i], x = MX + i * (cw + gap);
      box(s, x, y, cw, h, S.card, { name: `problem-card-${i + 1}` });
      await badge(s, x + 0.3, y + 0.3, 0.62, c.icon, c.fill);
      s.addText(c.head, { x: x + 0.3, y: y + 1.07, w: cw - 0.6, h: 0.42, fontSize: 16.5, bold: true, color: S.ink, margin: 0, isTextBox: true });
      s.addText(c.stat, { x: x + 0.3, y: y + 1.55, w: cw - 0.6, h: 0.8, fontSize: 40, bold: true, color: c.color, margin: 0, isTextBox: true });
      s.addText(c.desc, { x: x + 0.3, y: y + 2.4, w: cw - 0.6, h: 0.8, fontSize: 14, color: S.ink, margin: 0, isTextBox: true, valign: "top" });
    }
    // 카드별 예시
    let x = MX;
    box(s, x + 0.3, y + 3.35, cw - 0.6, 1.2, S.white);
    s.addText([
      { text: "★★★★★ · 좋아요 65", options: { fontSize: 11, bold: true, color: S.amber, breakLine: true } },
      { text: "“게임 정말 재밌게 하고 있었습니다. 다만 오늘 패치 이후 … 여전히 플레이가 되지 않고 있습니다.”", options: { fontSize: 12, color: S.ink } },
    ], { x: x + 0.45, y: y + 3.42, w: cw - 0.9, h: 1.06, margin: 0, valign: "middle", isTextBox: true });
    x = MX + cw + gap;
    chip(s, x + 0.3, y + 3.45, 1.55, "Google Play", { line: HEX.line, bold: true });
    s.addText("6,199건", { x: x + 1.95, y: y + 3.45, w: 1.3, h: 0.4, fontSize: 14, color: S.ink, margin: 0, valign: "middle", isTextBox: true });
    chip(s, x + 0.3, y + 4.0, 1.55, "App Store", { line: HEX.line, bold: true });
    s.addText("150건", { x: x + 1.95, y: y + 4.0, w: 1.3, h: 0.4, fontSize: 14, color: S.ink, margin: 0, valign: "middle", isTextBox: true });
    x = MX + 2 * (cw + gap);
    chip(s, x + 0.3, y + 3.45, 1.45, "굿 443건", { line: HEX.line });
    chip(s, x + 1.85, y + 3.45, 1.4, "굳 85건", { line: HEX.line });
    chip(s, x + 0.3, y + 4.0, 2.0, "재밌어요 91건", { line: HEX.line });
    s.addNotes("먼저 문제입니다. 첫째, 별점만 봐서는 무엇이 불만인지 모릅니다. 별점 5점인데 내용은 '패치 이후 플레이가 안 된다'는 버그 불만인 리뷰가 좋아요 65개를 받았습니다. 이런 리뷰가 590건입니다. 둘째, 리뷰가 두 스토어에 5년 넘게 6천 건 넘게 쌓여 있어 사람이 다 읽고 정리하기 어렵습니다. 셋째, 리뷰의 63%는 '굿', '재밌어요'처럼 구체적인 내용이 없습니다. (약 30초)");
  }

  // ================= 3. 제품 공개 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "제품 공개");
    s.addText("그래서 만들었습니다: 리뷰 분석 대시보드 ‘플레이노트’", { placeholder: "title" });
    await framedImage(s, fullImg, MX + 0.06, 1.85, 6.9, "플레이노트 대시보드: 요약 수치, 요약 문장, 주제별 긍정·부정 비율 차트");
    const rx = 8.05, rw = W - MX - rx;
    s.addText("누구를 위한 도구인가", { x: rx, y: 1.8, w: rw, h: 0.32, fontSize: 13, bold: true, color: S.gray, margin: 0, isTextBox: true });
    chip(s, rx, 2.17, 1.65, "게임 개발사", { fill: S.navy, color: S.white, bold: true, h: 0.45, size: 14 });
    chip(s, rx + 1.8, 2.17, 2.25, "배급사(퍼블리셔)", { fill: S.navy, color: S.white, bold: true, h: 0.45, size: 14 });
    const feats = [
      ["FaSmile", S.blue, "감성 판정", "별점이 아니라 내용으로 긍정·부정·중립·혼합"],
      ["FaTags", S.amber, "주제·키워드", "버그·과금·운영 등 8개 주제와 키워드로 분류"],
      ["FaListOl", S.red, "개선 우선순위", "먼저 고칠 것을 점수 순으로 정렬"],
      ["FaChartLine", S.gray, "장점·버전별 추이", "지켜야 할 장점과 업데이트 뒤 변화"],
    ];
    for (let i = 0; i < feats.length; i++) {
      const [ic, col, t, d] = feats[i], y = 2.95 + i * 0.8;
      await badge(s, rx, y, 0.55, ic, col);
      s.addText([
        { text: t, options: { fontSize: 15, bold: true, color: S.ink, breakLine: true } },
        { text: d, options: { fontSize: 12.5, color: S.mute } },
      ], { x: rx + 0.72, y: y - 0.05, w: rw - 0.72, h: 0.7, margin: 0, valign: "middle", isTextBox: true });
    }
    box(s, MX, 6.3, CW, 0.52, S.sky, { r: 0.1 });
    s.addText("CSV를 넣으면 바로 집계  ·  설치 없이 브라우저에서 열림  ·  파일은 외부로 전송되지 않음", { x: MX, y: 6.3, w: CW, h: 0.52, align: "center", valign: "middle", fontSize: 14, bold: true, color: S.navy, margin: 0, isTextBox: true });
    s.addNotes("그래서 이 문제들을 한 번에 해결하는 리뷰 분석 대시보드, 플레이노트를 만들었습니다. 대상은 게임 개발사와 배급사입니다. 리뷰 내용으로 감성을 판정하고, 8개 주제와 키워드로 나누고, 먼저 고칠 것을 점수로 정렬하고, 지켜야 할 장점과 버전별 변화까지 보여줍니다. CSV 파일만 넣으면 브라우저에서 바로 집계되고, 파일은 밖으로 나가지 않습니다. (약 25초)");
  }

  // ================= 4. 구조 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "구조");
    s.addText("수집부터 대시보드까지, 4단계로 동작합니다", { placeholder: "title" });
    const steps = [
      ["수집", "Google Play 스크래퍼 · Apple 공개 RSS\n글이 있는 한국어 리뷰 전량"],
      ["판정", "규칙(키워드 사전) + 분류 모델\n감성 4종 · 주제 8개 · 주제별 감성"],
      ["분석", "개선 우선순위 점수 · 지킬 장점\n버전별·월별 추이"],
      ["대시보드", "HTML 파일 하나 · 오프라인 동작\nGitHub Pages로 배포"],
    ];
    const sw = 2.73, sg = (CW - 4 * sw) / 3, sy = 1.8, sh = 2.3;
    for (let i = 0; i < 4; i++) {
      const x = MX + i * (sw + sg);
      box(s, x, sy, sw, sh, S.card, { name: `step-${i + 1}` });
      numBadge(s, x + 0.28, sy + 0.28, 0.55, i + 1, S.blue);
      s.addText(steps[i][0], { x: x + 0.95, y: sy + 0.28, w: sw - 1.1, h: 0.55, fontSize: 18, bold: true, color: S.ink, valign: "middle", margin: 0, isTextBox: true });
      s.addText(steps[i][1], { x: x + 0.28, y: sy + 1.0, w: sw - 0.5, h: 1.1, fontSize: 13, color: S.mute, valign: "top", margin: 0, isTextBox: true, paraSpaceAfter: 4 });
      if (i < 3) s.addImage({ data: await icon("FaArrowRight", "#8A8F98"), x: x + sw + (sg - 0.24) / 2, y: sy + sh / 2 - 0.12, w: 0.24, h: 0.24, altText: "" });
    }
    // 기획 요소 3칸
    const bw = 3.85, bg = (CW - 3 * bw) / 2, by = 4.4, bh = 2.35;
    const heads = ["주제 체계 (8개)", "개선 우선순위 점수 (100점 만점)", "사용 기술"];
    for (let i = 0; i < 3; i++) {
      const x = MX + i * (bw + bg);
      box(s, x, by, bw, bh, S.white, { line: HEX.line, name: `plan-${i + 1}` });
      s.addText(heads[i], { x: x + 0.28, y: by + 0.22, w: bw - 0.56, h: 0.36, fontSize: 15, bold: true, color: S.ink, margin: 0, isTextBox: true });
    }
    // 주제 칩
    const topics = ["과금", "버그", "콘텐츠", "운영", "밸런스/성장", "UI/편의성", "캐릭터/아트", "광고"];
    for (let i = 0; i < 8; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      chip(s, MX + 0.28 + col * 1.67, by + 0.75 + row * 0.38, 1.57, topics[i], { fill: S.card, h: 0.32, size: 12 });
    }
    // 우선순위 점수 막대 + 범례
    let x = MX + bw + bg + 0.28;
    const segW = bw - 0.56, parts = [["불만 리뷰 수 (부정·혼합)", 0.5, S.red], ["공감 (좋아요 수)", 0.3, S.amber], ["최근 6개월 추세", 0.2, S.blue]];
    let px = x;
    parts.forEach(([t, r, col], i) => {
      s.addShape(pres.shapes.RECTANGLE, { x: px, y: by + 0.75, w: segW * r - 0.04, h: 0.42, fill: { color: col }, line: { type: "none" } });
      s.addText(`${Math.round(r * 100)}%`, { x: px, y: by + 0.75, w: segW * r - 0.04, h: 0.42, align: "center", valign: "middle", fontSize: 13, bold: true, color: S.white, margin: 0, isTextBox: true });
      px += segW * r;
      s.addShape(pres.shapes.RECTANGLE, { x, y: by + 1.36 + i * 0.3 + 0.07, w: 0.16, h: 0.16, fill: { color: col }, line: { type: "none" } });
      s.addText(t, { x: x + 0.26, y: by + 1.36 + i * 0.3, w: segW - 0.26, h: 0.3, fontSize: 12, color: S.ink, valign: "middle", margin: 0, isTextBox: true });
    });
    // 기술 칩
    x = MX + 2 * (bw + bg) + 0.28;
    const tech = [["Python", 1.05], ["Kiwi 형태소 분석", 1.85], ["scikit-learn", 1.4], ["HTML·JS", 1.1], ["sentence-transformers", 2.35]];
    let tx = x, ty = by + 0.75;
    for (const [t, w] of tech) {
      if (tx + w > x + bw - 0.5) { tx = x; ty += 0.48; }
      chip(s, tx, ty, w, t, { fill: S.card, h: 0.36, size: 12 });
      tx += w + 0.12;
    }
    s.addNotes("구조는 네 단계입니다. 구글 플레이와 앱스토어에서 글이 있는 리뷰를 모두 모으고, 규칙과 분류 모델로 감성과 주제를 판정하고, 우선순위 점수와 버전별 추이를 계산해서, 파일 하나짜리 대시보드로 보여줍니다. 기획 면에서는 게임 리뷰에 맞는 8개 주제를 정했고, 우선순위 점수는 불만 리뷰 수 50%, 좋아요로 본 공감 30%, 최근 추세 20%를 합쳐 계산합니다. (약 25초)");
  }

  // ================= 5. 두 번째 문제: AI 토큰 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT_DARK" });
    kicker(s, "두 번째 문제", true);
    s.addText("애매한 리뷰를 매번 AI에 맡기면, 토큰 비용이 쌓입니다", { placeholder: "title" });
    s.addText("62.2%", { x: MX, y: 1.85, w: 4.6, h: 1.0, fontSize: 60, bold: true, color: S.yellow, margin: 0, isTextBox: true });
    s.addText("규칙(키워드)만으로 판정한\n어려운 리뷰의 감성 정확도", { x: MX, y: 2.9, w: 4.6, h: 0.7, fontSize: 14, color: "DCE3F2", margin: 0, isTextBox: true });
    s.addText("2,030건", { x: MX, y: 3.85, w: 4.6, h: 0.85, fontSize: 48, bold: true, color: S.white, margin: 0, isTextBox: true });
    s.addText("규칙이 확신하지 못해 AI(LLM) 판정이\n필요했던 리뷰 (전체의 32%)", { x: MX, y: 4.72, w: 4.6, h: 0.7, fontSize: 14, color: "DCE3F2", margin: 0, isTextBox: true });
    const rows = [
      ["FaCoins", "비용", "판정할 때마다 기준서(약 4,400자)와 리뷰를 함께 보내야 함 → 리뷰가 쌓일수록 토큰 비용도 계속 늘어남"],
      ["FaPlug", "운영", "새 리뷰가 올라올 때마다 외부 AI 서비스와 인터넷 연결에 의존"],
      ["FaShieldAlt", "보안", "회사의 리뷰 데이터를 외부 서비스로 보내야 함"],
    ];
    const rx = 5.75, rw = W - MX - rx;
    for (let i = 0; i < rows.length; i++) {
      const y = 1.9 + i * 1.1;
      await badge(s, rx, y, 0.6, rows[i][0], S.red);
      s.addText([
        { text: rows[i][1], options: { fontSize: 17, bold: true, color: S.white, breakLine: true } },
        { text: rows[i][2], options: { fontSize: 13.5, color: "C9D2E6" } },
      ], { x: rx + 0.8, y: y - 0.08, w: rw - 0.8, h: 0.95, margin: 0, valign: "top", isTextBox: true });
    }
    box(s, MX, 5.75, CW, 0.95, HEX.navy2, { r: 0.12 });
    s.addText([
      { text: "목표  ", options: { bold: true, color: S.yellow } },
      { text: "AI는 학습용 정답을 만들 때 한 번만 쓰고, 실제 판정은 우리 컴퓨터의 모델로 → ", options: { color: S.white } },
      { text: "토큰 0", options: { bold: true, color: S.yellow } },
    ], { x: MX + 0.35, y: 5.75, w: CW - 0.7, h: 0.95, fontSize: 18, valign: "middle", margin: 0, isTextBox: true });
    s.addNotes("그런데 두 번째 문제가 있었습니다. 키워드 규칙만으로는 어려운 리뷰의 감성을 62%밖에 맞히지 못했고, 전체의 32%인 2,030건은 결국 AI에게 판정을 맡겨야 했습니다. 이걸 서비스에서 매번 AI로 하면, 판정 기준서와 리뷰를 계속 보내야 해서 리뷰가 쌓일수록 토큰 비용이 쌓이고, 외부 서비스에 의존하고, 데이터도 밖으로 나갑니다. 그래서 AI는 학습용 정답을 만들 때 한 번만 쓰고, 실제 판정은 우리 컴퓨터의 모델로 하기로 했습니다. (약 30초)");
  }

  // ================= 6. 모델 학습 방법 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "모델 학습");
    s.addText("AI 없이 판정하도록, 우리 리뷰로 모델을 학습시켰습니다", { placeholder: "title" });
    // 흐름도
    const fy = 1.8, fh = 1.2;
    const flow = [
      { x: MX, w: 1.55, t: "새 리뷰", d: "", fill: S.card, tc: S.ink },
      { x: 2.6, w: 3.0, t: "규칙 사전", d: "확신하면 바로 판정 · 7ms", fill: S.card, tc: S.ink },
      { x: 6.45, w: 4.0, t: "ML 판정 (두 모델 확률 평균)", d: "단어 모델 0.4 + 미세조정 임베딩 0.6", fill: S.blue, tc: S.white },
      { x: 10.85, w: W - MX - 10.85, t: "감성·주제", d: "리뷰 1건 0.19초", fill: S.navy, tc: S.white },
    ];
    for (const f of flow) {
      box(s, f.x, fy, f.w, fh, f.fill);
      s.addText(f.d ? [
        { text: f.t, options: { fontSize: 15, bold: true, color: f.tc, breakLine: true } },
        { text: f.d, options: { fontSize: 12, color: f.tc } },
      ] : f.t, { x: f.x + 0.1, y: fy, w: f.w - 0.2, h: fh, align: "center", valign: "middle", fontSize: 15, bold: true, color: f.tc, margin: 0, isTextBox: true });
    }
    const arrow = async (x) => s.addImage({ data: await icon("FaArrowRight", "#8A8F98"), x, y: fy + fh / 2 - 0.12, w: 0.24, h: 0.24, altText: "" });
    await arrow(2.255); await arrow(10.53);
    await arrow(5.9);
    s.addText("애매하거나 ‘중립’이면 ML로", { x: 4.9, y: fy + fh + 0.06, w: 2.1, h: 0.32, fontSize: 11, color: S.mute, align: "center", margin: 0, isTextBox: true });
    // 기법 5개
    const tech = [
      ["FaBalanceScale", "단어 가중치", "TF-IDF로 자주 쓰이는 단어·글자 조각에 가중치, 적은 감성에는 클래스 가중치"],
      ["FaCut", "형태소 분석", "Kiwi로 한국어 조사·어미를 떼어 같은 단어를 하나로 인식"],
      ["FaBrain", "문장 임베딩", "ko-sroberta로 단어가 아니라 문장 전체의 뜻을 숫자로 표현"],
      ["FaCogs", "미세조정", "임베딩 모델을 우리 리뷰 정답으로 다시 학습 (감성·주제 동시)"],
      ["FaSpellCheck", "오타·은어 사전", "약 100개 보강: ‘괜판’, ‘커여워’, ‘현질게임’"],
    ];
    const tw = 2.23, tg = (CW - 5 * tw) / 4, ty = 3.55, th = 2.95;
    for (let i = 0; i < 5; i++) {
      const x = MX + i * (tw + tg);
      box(s, x, ty, tw, th, S.card, { name: `tech-${i + 1}` });
      await badge(s, x + 0.25, ty + 0.25, 0.55, tech[i][0], i < 2 ? S.gray : S.blue);
      s.addText(`${i + 1}`, { x: x + tw - 0.6, y: ty + 0.25, w: 0.35, h: 0.55, fontSize: 22, bold: true, color: "B8BEC8", align: "right", valign: "middle", margin: 0, isTextBox: true });
      s.addText(tech[i][1], { x: x + 0.25, y: ty + 0.95, w: tw - 0.5, h: 0.4, fontSize: 16, bold: true, color: S.ink, margin: 0, isTextBox: true });
      s.addText(tech[i][2], { x: x + 0.25, y: ty + 1.42, w: tw - 0.5, h: 1.4, fontSize: 13, color: S.mute, margin: 0, valign: "top", isTextBox: true });
    }
    s.addNotes("해결 방법입니다. 새 리뷰가 들어오면 먼저 규칙 사전이 판정하고, 확신하지 못하면 머신러닝 모델이 판정합니다. 정확도를 올리려고 다섯 가지를 쌓았습니다. 단어와 글자 조각에 가중치를 주고, Kiwi 형태소 분석으로 조사와 어미를 떼고, 한국어 문장 임베딩으로 단어가 아닌 문장의 뜻을 읽게 했습니다. 그다음 임베딩 모델 자체를 우리 리뷰 정답으로 미세조정하고, 오타와 은어 사전을 보강했습니다. 마지막에 두 모델의 확률을 평균해 판정합니다. (약 35초)");
  }

  // ================= 7. 정확도 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "모델 학습 결과");
    s.addText("어려운 리뷰 정확도 62.2% → 89.7%, AI 없이", { placeholder: "title" });
    s.addChart(pres.charts.BAR, [{ name: "감성 정확도", labels: ["규칙만", "단어 가중치", "+ 형태소", "+ 문장 임베딩", "+ 미세조정·사전"], values: [0.622, 0.801, 0.819, 0.84, 0.897] }], {
      x: MX, y: 1.75, w: 7.2, h: 4.75, barDir: "col", barGapWidthPct: 55,
      ...chartBase(),
      chartColors: ["B8BEC8", "9DB8E8", "7CA2E3", "5A8BDC", HEX.blue],
      showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0%", dataLabelFontBold: true,
      valAxisMinVal: 0, valAxisMaxVal: 1, valAxisLabelFormatCode: "0%", valAxisMajorUnit: 0.2,
      showTitle: true, title: "어려운 리뷰 2,030건 감성 정확도 (5-겹 교차검증)", showLegend: false,
    });
    const rx = 8.2, rw = W - MX - rx;
    s.addText("단어가 아니라 문장의 뜻을 읽게 되었습니다", { x: rx, y: 1.8, w: rw, h: 0.35, fontSize: 14, bold: true, color: S.ink, margin: 0, isTextBox: true });
    const ex = [["결제후 환불잘해줌", "부정", "긍정"], ["와진짜 스트레스 가 팍 풀리네", "부정", "긍정"], ["괜판네요 좀더해봐야 겠어요", "중립", "긍정"]];
    for (let i = 0; i < ex.length; i++) {
      const y = 2.28 + i * 0.95;
      box(s, rx, y, rw, 0.82, S.card, { r: 0.1 });
      s.addText([
        { text: `“${ex[i][0]}”`, options: { fontSize: 13, bold: true, color: S.ink, breakLine: true } },
        { text: `이전 ${ex[i][1]} ✕`, options: { fontSize: 12, color: S.red } },
        { text: "  →  ", options: { fontSize: 12, color: S.gray } },
        { text: `지금 ${ex[i][2]} ✓`, options: { fontSize: 12, bold: true, color: S.blue } },
      ], { x: rx + 0.2, y, w: rw - 0.4, h: 0.82, valign: "middle", margin: 0, isTextBox: true });
    }
    const tiles = [["96.7%", "전체 6,349건 정확도"], ["0.19초", "리뷰 1건 판정 시간"]];
    for (let i = 0; i < 2; i++) {
      const x = rx + i * (rw / 2 + 0.08), w = rw / 2 - 0.08;
      box(s, x, 5.2, w, 1.3, S.navy, { r: 0.12 });
      s.addText(tiles[i][0], { x, y: 5.3, w, h: 0.65, align: "center", fontSize: 28, bold: true, color: S.yellow, margin: 0, isTextBox: true });
      s.addText(tiles[i][1], { x, y: 5.95, w, h: 0.4, align: "center", fontSize: 12, color: S.white, margin: 0, isTextBox: true });
    }
    s.addText("교차검증: 학습에 쓰지 않은 리뷰로만 채점 · 게임 고유 단어를 지우고 다시 학습해도 정확도 그대로", { x: MX, y: 6.6, w: CW, h: 0.3, fontSize: 11, color: S.gray, margin: 0, isTextBox: true });
    s.addNotes("결과입니다. 규칙만 쓰면 62.2%였던 어려운 리뷰 정확도가, 단계마다 올라 최종 89.7%가 됐습니다. 모두 학습에 쓰지 않은 리뷰로 채점한 수치입니다. '환불 잘해줌', '스트레스가 풀리네'처럼 부정 단어가 들어간 긍정 문장이나 '괜판' 같은 오타도 이제 맞힙니다. 전체 리뷰 기준으로는 96.7%이고, 한 건 판정에 0.19초, AI 토큰은 들지 않습니다. (약 25초)");
  }

  // ================= 8. 결과: 달토끼 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "결과");
    s.addText("달토끼 키우기 6,349건: 고칠 것은 버그, 지킬 것은 캐릭터", { placeholder: "title" });
    const ct = analysis.crosstab.filter((c) => !["일반", "기타"].includes(c.topic)).sort((a, b) => b.n - a.n);
    const pct = (c, k) => c[k] / c.n;
    s.addChart(pres.charts.BAR, ["긍정", "혼합", "중립", "부정"].map((k) => ({ name: k, labels: ct.map((c) => c.topic), values: ct.map((c) => +pct(c, k).toFixed(4)) })), {
      x: MX, y: 1.7, w: 6.3, h: 4.0, barDir: "bar", barGrouping: "percentStacked", barGapWidthPct: 45,
      ...chartBase(),
      chartColors: [HEX.blue, HEX.amber, "B8BEC8", HEX.red],
      catAxisOrientation: "maxMin", valAxisLabelFormatCode: "0%", valAxisMajorUnit: 0.25,
      showLegend: true, legendPos: "t", showTitle: true, title: "주제별 감성 비율 (주제 언급 기준)",
    });
    const pr = analysis.priority.slice(0, 5);
    s.addChart(pres.charts.BAR, [{ name: "우선순위 점수", labels: pr.map((p) => `${p.topic.replace("밸런스/성장", "밸런스")} · ${p.kw.replace("업데이트불가", "업데이트 불가").replace("접속불가", "접속 불가")}`), values: pr.map((p) => p.score) }], {
      x: 7.1, y: 1.7, w: W - MX - 7.1, h: 4.0, barDir: "bar", barGapWidthPct: 45,
      ...chartBase(),
      chartColors: [HEX.red], catAxisOrientation: "maxMin",
      showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0", dataLabelFontBold: true,
      valAxisMinVal: 0, valAxisMaxVal: 100, valAxisMajorUnit: 25, valAxisHidden: true, valGridLine: { style: "none" },
      showLegend: false, showTitle: true, title: "먼저 고칠 것 Top 5 (우선순위 점수)",
    });
    const tiles = [
      ["69%", "내용상 긍정", "전체 평가는 좋은 게임", S.blue],
      ["95%", "버그 언급 중 부정", "1순위 ‘업데이트 불가’ 88점", S.red],
      ["96%", "캐릭터/아트 언급 중 긍정", "대표 키워드 ‘귀여움’ 383건", S.blue],
    ];
    const tw = 3.85, tg = (CW - 3 * tw) / 2;
    for (let i = 0; i < 3; i++) {
      const x = MX + i * (tw + tg);
      box(s, x, 5.92, tw, 0.95, S.card, { r: 0.1 });
      s.addText(tiles[i][0], { x: x + 0.2, y: 5.92, w: 1.25, h: 0.95, fontSize: 28, bold: true, color: tiles[i][3], valign: "middle", margin: 0, isTextBox: true });
      s.addText([
        { text: tiles[i][1], options: { fontSize: 13, bold: true, color: S.ink, breakLine: true } },
        { text: tiles[i][2], options: { fontSize: 11.5, color: S.mute } },
      ], { x: x + 1.5, y: 5.92, w: tw - 1.65, h: 0.95, valign: "middle", margin: 0, isTextBox: true });
    }
    s.addNotes("실제 달토끼 키우기 리뷰 6,349건에 적용한 결과입니다. 전체로는 69%가 긍정인 평이 좋은 게임이지만, 주제별로 보면 버그 언급의 95%가 부정입니다. 먼저 고칠 것 1순위는 '업데이트 불가'로 88점, 그다음이 난이도와 접속 불가입니다. 반대로 캐릭터와 아트는 96%가 긍정이라 꼭 지켜야 할 장점입니다. (약 25초)");
  }

  // ================= 9. 다른 게임 적용 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "다른 게임 적용 테스트");
    s.addText("다시 학습하지 않고 ‘메이플 키우기’에서도 91%", { placeholder: "title" });
    s.addChart(pres.charts.BAR, [{ name: "감성 정확도", labels: ["규칙만", "별점만", "플레이노트"], values: [0.75, 0.783, 0.91] }], {
      x: MX, y: 1.7, w: 5.7, h: 2.9, barDir: "bar", barGapWidthPct: 45,
      ...chartBase(),
      chartColors: ["B8BEC8", "B8BEC8", HEX.blue], catAxisOrientation: "maxMin",
      showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.0%", dataLabelFontBold: true,
      valAxisMinVal: 0, valAxisMaxVal: 1, valAxisLabelFormatCode: "0%", valAxisMajorUnit: 0.25,
      showLegend: false, showTitle: true, title: "메이플 키우기 무작위 300건 감성 정확도",
    });
    box(s, MX, 4.8, 2.75, 1.25, S.navy, { r: 0.12 });
    s.addText("90.6%", { x: MX, y: 4.88, w: 2.75, h: 0.6, align: "center", fontSize: 26, bold: true, color: S.yellow, margin: 0, isTextBox: true });
    s.addText("어려운 리뷰 (달토끼 89.7%)", { x: MX, y: 5.5, w: 2.75, h: 0.4, align: "center", fontSize: 11.5, color: S.white, margin: 0, isTextBox: true });
    box(s, MX + 2.95, 4.8, 2.75, 1.25, S.card, { r: 0.12 });
    s.addText([
      { text: "정답 만드는 법", options: { fontSize: 12, bold: true, color: S.ink, breakLine: true } },
      { text: "별점을 가리고 내용만 보고 판정, 모델을 돌리기 전에 확정", options: { fontSize: 11, color: S.mute } },
    ], { x: MX + 3.1, y: 4.8, w: 2.45, h: 1.25, valign: "middle", margin: 0, isTextBox: true });
    await badge(s, MX, 6.3, 0.4, "FaExclamationTriangle", S.amber);
    s.addText("주제 판정은 운영·콘텐츠가 약함 (F1 0.50 · 0.41) → 게임별 단어 보강 필요", { x: MX + 0.52, y: 6.3, w: 5.3, h: 0.4, fontSize: 11.5, color: S.mute, valign: "middle", margin: 0, isTextBox: true });
    const ix = 6.75, iw = W - MX - ix - 0.06;
    const ih = await framedImage(s, mapleImg, ix + 0.06, 1.8, iw, "메이플 키우기 8,054건을 플레이노트에 넣은 화면: 내용상 긍정 41%, 불만 54%, 불만 최다 과금");
    s.addText([
      { text: "리뷰 8,054건 전체를 판정해 바로 대시보드로", options: { fontSize: 14, bold: true, color: S.ink, breakLine: true } },
      { text: "불만 54% · 불만 최다 ‘과금’ · 1순위 ‘결제/환불’", options: { fontSize: 12.5, color: S.mute } },
    ], { x: ix, y: 1.8 + ih + 0.25, w: iw + 0.12, h: 0.75, margin: 0, isTextBox: true });
    s.addNotes("달토끼 리뷰로만 학습한 모델이 다른 게임에서도 통하는지, 메이플 키우기로 시험했습니다. 다시 학습하지 않고 무작위 300건을 판정했더니 91.0%로, 별점만 보는 것보다 13%p, 규칙만 쓰는 것보다 16%p 높았습니다. 어려운 리뷰만 보면 90.6%로 달토끼와 같은 수준입니다. 8,054건 전체를 넣으면 달토끼와 달리 불만이 54%이고 과금이 가장 큰 불만이라는 게 바로 보입니다. 다만 주제 중 운영과 콘텐츠는 게임마다 쓰는 단어가 달라 보강이 필요합니다. (약 30초)");
  }

  // ================= 10. 편의성: CSV 누적·교체 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "편의성");
    s.addText("CSV만 넣으면 됩니다: 누적과 교체도 한 번에", { placeholder: "title" });
    const lw = 7.1;
    await framedImage(s, addImg, MX + 0.06, 1.85, lw, "두 번째 파일을 누적한 화면: +3,094건으로 총 4,610건, 긍정 4.4%p 증가, 불만 5.2%p 감소");
    await framedImage(s, dlgImg, MX + 0.06, 4.75, 2.85, "새 파일 반영 창: 누적하면 4,610건, 교체하면 3,094건");
    const steps = ["CSV 파일 넣기 (여러 개 한 번에)", "누적 또는 교체 선택", "늘어난 건수와 비율 변화(%p) 확인"];
    for (let i = 0; i < 3; i++) {
      const y = 4.85 + i * 0.62;
      numBadge(s, 3.85, y, 0.42, i + 1, S.blue);
      s.addText(steps[i], { x: 4.4, y, w: 3.4, h: 0.42, fontSize: 13.5, color: S.ink, valign: "middle", margin: 0, isTextBox: true });
    }
    const rx = 8.25, rw = W - MX - rx;
    const feats = [
      ["FaFileCsv", "여러 파일 · 끌어다 놓기", "이름 순으로 합쳐서 한 번에 반영"],
      ["FaClone", "중복 리뷰는 한 번만", "같은 스토어·리뷰 ID는 한 번만 셈"],
      ["FaFilter", "잘못된 행만 제외", "형식이 틀린 행·파일만 빼고 이유 안내"],
      ["FaDesktop", "설치·인터넷 불필요", "파일은 브라우저 밖으로 나가지 않음"],
      ["FaUniversalAccess", "누구나 읽기 쉽게", "차트마다 ‘표로 보기’, 키보드·다크 모드"],
    ];
    for (let i = 0; i < feats.length; i++) {
      const y = 1.85 + i * 0.97;
      await badge(s, rx, y + 0.05, 0.55, feats[i][0], S.blue);
      s.addText([
        { text: feats[i][1], options: { fontSize: 15, bold: true, color: S.ink, breakLine: true } },
        { text: feats[i][2], options: { fontSize: 12.5, color: S.mute } },
      ], { x: rx + 0.72, y, w: rw - 0.72, h: 0.7, margin: 0, valign: "middle", isTextBox: true });
    }
    s.addNotes("편의성입니다. CSV 파일만 넣으면 되고, 여러 파일을 한 번에 넣을 수도 있습니다. 두 번째 파일부터는 기존 자료에 누적할지 교체할지 묻고, 누적하면 늘어난 건수와 긍정·불만 비율이 몇 %p 바뀌었는지 바로 보여줍니다. 같은 리뷰는 한 번만 세고, 형식이 틀린 행만 빼고 이유를 알려줍니다. 설치도 인터넷도 필요 없고, 파일은 밖으로 나가지 않습니다. (시연한다면 여기서 대시보드로 전환) (약 25초)");
  }

  // ================= 11. 총정리 =================
  {
    const s = pres.addSlide({ masterName: "CONTENT" });
    kicker(s, "정리");
    s.addText("리뷰를 읽는 시간을, 고칠 것을 정하는 시간으로", { placeholder: "title" });
    const tiles = [
      ["6,349건", "달토끼 키우기 리뷰 분석", "고칠 것 버그 · 지킬 것 캐릭터"],
      ["89.7%", "어려운 리뷰 감성 정확도", "규칙만 쓸 때 62.2%"],
      ["91.0%", "다른 게임 감성 정확도", "다시 학습하지 않고 메이플 키우기"],
      ["0", "판정에 드는 AI 토큰", "우리 컴퓨터의 모델로 0.19초"],
    ];
    const tw = 2.85, tg = (CW - 4 * tw) / 3;
    for (let i = 0; i < 4; i++) {
      const x = MX + i * (tw + tg);
      box(s, x, 1.85, tw, 2.3, i === 3 ? S.navy : S.card, { name: `summary-${i + 1}` });
      const dark = i === 3;
      s.addText(tiles[i][0], { x: x + 0.25, y: 2.0, w: tw - 0.5, h: 0.95, fontSize: 40, bold: true, color: dark ? S.yellow : S.blue, margin: 0, isTextBox: true });
      s.addText([
        { text: tiles[i][1], options: { fontSize: 14, bold: true, color: dark ? S.white : S.ink, breakLine: true } },
        { text: tiles[i][2], options: { fontSize: 12, color: dark ? "C9D2E6" : S.mute } },
      ], { x: x + 0.25, y: 3.0, w: tw - 0.5, h: 0.95, valign: "top", margin: 0, isTextBox: true });
    }
    box(s, MX, 4.45, CW, 1.15, S.sky, { r: 0.12 });
    s.addText([
      { text: "플레이노트는 ", options: { color: S.navy } },
      { text: "별점 대신 내용", options: { bold: true, color: S.navy } },
      { text: "으로 리뷰를 읽고, ", options: { color: S.navy } },
      { text: "먼저 고칠 것과 지킬 것", options: { bold: true, color: S.navy } },
      { text: "을 AI 비용 없이 알려 줍니다.", options: { color: S.navy } },
    ], { x: MX + 0.35, y: 4.45, w: CW - 0.7, h: 1.15, fontSize: 19, valign: "middle", margin: 0, isTextBox: true });
    s.addText("다음 단계", { x: MX, y: 5.95, w: 1.4, h: 0.45, fontSize: 14, bold: true, color: S.ink, valign: "middle", margin: 0, isTextBox: true });
    const next = [["게임별 주제 사전 보강", 2.75], ["‘다만·근데’ 기준 절 단위 판정", 3.25], ["확신 낮은 리뷰 ‘검토 필요’ 표시", 3.35]];
    let nx = MX + 1.45;
    for (const [t, w] of next) { chip(s, nx, 5.97, w, t, { fill: S.card, h: 0.42, size: 12.5 }); nx += w + 0.15; }
    s.addNotes("정리하겠습니다. 달토끼 키우기 리뷰 6,349건에서 고칠 것은 버그, 지킬 것은 캐릭터라는 결론을 냈고, AI 없이 어려운 리뷰도 89.7% 맞히며, 다른 게임에서도 다시 학습 없이 91%가 나왔습니다. 판정에 드는 AI 토큰은 0입니다. 플레이노트는 별점 대신 내용으로 리뷰를 읽고, 먼저 고칠 것과 지킬 것을 AI 비용 없이 알려 줍니다. 다음 단계로는 게임별 주제 사전 보강과 문장을 절 단위로 나눠 판정하는 기능을 생각하고 있습니다. (약 25초)");
  }

  // ================= 12. 마무리 =================
  {
    const s = pres.addSlide({ masterName: "COVER" });
    s.addText("감사합니다", { placeholder: "title" });
    s.addText("질문을 받겠습니다", { x: MX, y: 3.65, w: 6, h: 0.5, fontSize: 22, color: "DCE3F2", margin: 0, isTextBox: true });
    s.addText("7팀 카페인 중독 · 플레이노트", { x: MX, y: 1.75, w: 6, h: 0.4, fontSize: 15, bold: true, color: S.yellow, margin: 0, isTextBox: true });
    box(s, MX, 5.2, 8.6, 0.9, HEX.navy2, { r: 0.12 });
    s.addText([
      { text: "직접 써 보기  ", options: { bold: true, color: S.yellow } },
      { text: "k-min-sec.github.io/ni2-hackathon-team07-kim-min-seok", options: { color: S.white } },
    ], { x: MX + 0.3, y: 5.2, w: 8.2, h: 0.9, fontSize: 16, valign: "middle", margin: 0, isTextBox: true });
    s.addNotes("들어 주셔서 감사합니다. 화면의 주소에서 플레이노트를 직접 써 보실 수 있습니다. 질문 받겠습니다.");
  }

  await pres.writeFile({ fileName: OUT });
  if (APPLY_THEME) {
    const { applyTheme } = require(APPLY_THEME);
    await applyTheme(OUT, THEME);
  }
  // 테마 글꼴의 동아시아(한글) 글꼴도 맑은 고딕으로
  const JSZip = require(require.resolve("jszip", { paths: [require.resolve("pptxgenjs")] }));
  const zip = await JSZip.loadAsync(fs.readFileSync(OUT));
  const part = "ppt/theme/theme1.xml";
  let xml = await zip.file(part).async("string");
  xml = xml.replace(/<a:ea typeface="[^"]*"\s*\/>/g, `<a:ea typeface="${FONT}"/>`);
  zip.file(part, xml);
  // 한글이 단어 중간에서 줄바꿈되지 않게 (eaLnBrk="0")
  let patched = 0;
  for (const name of Object.keys(zip.files)) {
    if (!/^ppt\/(slides|slideLayouts|slideMasters)\/[^/]+\.xml$|^ppt\/presentation\.xml$/.test(name)) continue;
    let x = await zip.file(name).async("string");
    x = x.replace(/<a:p>(?!<a:pPr)/g, '<a:p><a:pPr eaLnBrk="0"/>');
    x = x.replace(/eaLnBrk="1"/g, 'eaLnBrk="0"');
    // 글자 언어를 한국어로 표시해야 PowerPoint가 단어 단위로 줄바꿈함
    x = x.replace(/lang="en-US"(?! altLang)/g, 'lang="ko-KR" altLang="en-US"');
    x = x.replace(/<a:(pPr|lvl[1-9]pPr)(?![^>]*eaLnBrk)/g, '<a:$1 eaLnBrk="0"');
    patched += (x.match(/eaLnBrk="0"/g) || []).length;
    zip.file(name, x);
  }
  for (const name of Object.keys(zip.files)) if (zip.files[name].dir) delete zip.files[name];
  fs.writeFileSync(OUT, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log("written", OUT, "eaLnBrk=0:", patched);
})().catch((e) => { console.error(e); process.exit(1); });
