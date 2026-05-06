// Builds the ECO Q&A discussion deck for the tomorrow meeting.
// Run: node scripts/build-eco-deck.js
const pptxgen = require("pptxgenjs");

// ---- Palette: "Midnight Executive" with a coral accent for emphasis ----
const NAVY = "1E2761";        // dominant
const NAVY_DARK = "151D49";   // subtle background variations
const ICE = "CADCFC";         // secondary
const WHITE = "FFFFFF";
const PAPER = "F7F8FB";       // page background
const INK = "1F2937";
const MUTED = "64748B";
const RULE = "E2E8F0";
const CORAL = "F96167";       // sharp accent
const SAGE = "84B59F";        // calmer accent for "good" / public
const AMBER = "F59E0B";       // hybrid
const PURPLE = "7C3AED";      // proxy
const ROSE = "EF4444";        // mock / risk
const EMERALD = "10B981";     // real

const HEADER_FONT = "Calibri";
const BODY_FONT = "Calibri";
const MONO_FONT = "Consolas";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";  // 13.33" × 7.5"
pres.author = "DT Team";
pres.title = "AML Risk Dashboard — ECO Q&A Discussion";

const W = 13.333;
const H = 7.5;
const MARGIN = 0.6;

// ---- Reusable bits ----------------------------------------------------------
function paperBackground(s) {
  s.background = { color: PAPER };
}

function pageHeader(s, kicker, title) {
  // Slim navy bar on the left edge of the title
  s.addShape(pres.shapes.RECTANGLE, {
    x: MARGIN, y: 0.45, w: 0.07, h: 0.95, fill: { color: CORAL }, line: { type: "none" },
  });
  s.addText(kicker, {
    x: MARGIN + 0.18, y: 0.4, w: W - 2 * MARGIN, h: 0.3,
    fontFace: HEADER_FONT, fontSize: 11, color: CORAL, bold: true, charSpacing: 6,
    margin: 0,
  });
  s.addText(title, {
    x: MARGIN + 0.18, y: 0.7, w: W - 2 * MARGIN, h: 0.7,
    fontFace: HEADER_FONT, fontSize: 26, color: NAVY, bold: true,
    margin: 0,
  });
}

function pageFooter(s, num, total) {
  s.addText("AML Risk Dashboard · ECO Q&A · Confidential", {
    x: MARGIN, y: H - 0.4, w: 6, h: 0.3,
    fontFace: BODY_FONT, fontSize: 9, color: MUTED, margin: 0,
  });
  s.addText(`${num} / ${total}`, {
    x: W - MARGIN - 1, y: H - 0.4, w: 1, h: 0.3,
    fontFace: BODY_FONT, fontSize: 9, color: MUTED, align: "right", margin: 0,
  });
}

function sectionDivider(num, total, sectionLabel, sectionTitle, sectionSub) {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // Big number on left
  s.addText(String(num).padStart(2, "0"), {
    x: MARGIN, y: 1.5, w: 4, h: 4,
    fontFace: HEADER_FONT, fontSize: 220, color: CORAL, bold: true,
    margin: 0,
  });

  // Right column
  s.addText(sectionLabel, {
    x: 5.4, y: 2.2, w: 7, h: 0.4,
    fontFace: HEADER_FONT, fontSize: 12, color: ICE, bold: true, charSpacing: 6, margin: 0,
  });
  s.addText(sectionTitle, {
    x: 5.4, y: 2.55, w: 7, h: 1.6,
    fontFace: HEADER_FONT, fontSize: 38, color: WHITE, bold: true, margin: 0,
  });
  s.addText(sectionSub, {
    x: 5.4, y: 4.3, w: 7, h: 1.5,
    fontFace: BODY_FONT, fontSize: 14, color: ICE, margin: 0,
  });

  // footer
  s.addText("AML Risk Dashboard · ECO Q&A · Confidential", {
    x: MARGIN, y: H - 0.4, w: 6, h: 0.3,
    fontFace: BODY_FONT, fontSize: 9, color: ICE, margin: 0,
  });
  s.addText(`${num} / ${total}`, {
    x: W - MARGIN - 1, y: H - 0.4, w: 1, h: 0.3,
    fontFace: BODY_FONT, fontSize: 9, color: ICE, align: "right", margin: 0,
  });
}

// ---- We'll build all slides into an array first so we know totals -----------
const slideBuilders = [];

// ---- Slide 1: title ---------------------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  // big chunky title
  s.addText("AML RISK DASHBOARD", {
    x: MARGIN, y: 2.6, w: 12, h: 0.5,
    fontFace: HEADER_FONT, fontSize: 14, color: CORAL, bold: true, charSpacing: 8, margin: 0,
  });
  s.addText("ECO Q&A Discussion", {
    x: MARGIN, y: 3.1, w: 12, h: 1.4,
    fontFace: HEADER_FONT, fontSize: 56, color: WHITE, bold: true, margin: 0,
  });
  s.addText("Pre-read for the dual-track data-source review meeting", {
    x: MARGIN, y: 4.5, w: 12, h: 0.5,
    fontFace: BODY_FONT, fontSize: 18, color: ICE, italic: true, margin: 0,
  });

  // bottom strip
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: CORAL }, line: { type: "none" },
  });
  s.addText("DT Team  ·  Prepared for Winnie / Deborah / Tanya  ·  Confidential", {
    x: MARGIN, y: H - 0.32, w: 12, h: 0.3,
    fontFace: BODY_FONT, fontSize: 10, color: WHITE, charSpacing: 4, margin: 0,
  });
});

// ---- Slide 2: agenda --------------------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "AGENDA", "What we'll cover");

  const items = [
    { num: "01", title: "Dual-track proposal", sub: "Why running public + Dow Jones in parallel is the right call" },
    { num: "02", title: "Contributing factors", sub: "How each of the 18 factors is defined and scored" },
    { num: "03", title: "Risk classification", sub: "Composite formula, weights, Low / Medium / High / Critical thresholds" },
    { num: "04", title: "Public-source constraints", sub: "Update cadence, coverage gaps, divergence handling" },
    { num: "05", title: "Third-party integration", sub: "How the architecture supports Dow Jones (and others)" },
    { num: "06", title: "Validation & governance", sub: "Audit logs, escalation, ECO sign-off path" },
    { num: "07", title: "Next steps & deliverables", sub: "What I'll bring back to ECO" },
  ];

  const colW = (W - 2 * MARGIN);
  let y = 1.7;
  items.forEach((it) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: MARGIN, y, w: 0.55, h: 0.6,
      fill: { color: NAVY }, line: { type: "none" },
    });
    s.addText(it.num, {
      x: MARGIN, y, w: 0.55, h: 0.6,
      fontFace: HEADER_FONT, fontSize: 16, color: WHITE, bold: true, align: "center", valign: "middle", margin: 0,
    });
    s.addText(it.title, {
      x: MARGIN + 0.75, y: y - 0.02, w: colW - 0.75, h: 0.32,
      fontFace: HEADER_FONT, fontSize: 16, color: NAVY, bold: true, margin: 0,
    });
    s.addText(it.sub, {
      x: MARGIN + 0.75, y: y + 0.3, w: colW - 0.75, h: 0.3,
      fontFace: BODY_FONT, fontSize: 11, color: MUTED, margin: 0,
    });
    y += 0.72;
  });

  pageFooter(s, num, total);
});

// ---- Slide 3: dual-track summary -------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "01 · DUAL-TRACK PROPOSAL", "Architecture is provider-agnostic by design");

  // Left side — diagram of two data sources flowing into one engine
  const leftX = MARGIN;
  const dgY = 1.8;

  // Public box
  s.addShape(pres.shapes.RECTANGLE, {
    x: leftX, y: dgY, w: 2.3, h: 1.0,
    fill: { color: SAGE }, line: { type: "none" },
  });
  s.addText([
    { text: "PUBLIC SOURCES\n", options: { fontSize: 10, color: WHITE, bold: true, charSpacing: 4 } },
    { text: "FATF · OFAC · UN · EU\nBasel · CPI · WGI · OpenSanctions", options: { fontSize: 11, color: WHITE } },
  ], {
    x: leftX, y: dgY, w: 2.3, h: 1.0,
    fontFace: BODY_FONT, align: "center", valign: "middle", margin: 0,
  });

  // DJ box
  s.addShape(pres.shapes.RECTANGLE, {
    x: leftX, y: dgY + 1.4, w: 2.3, h: 1.0,
    fill: { color: NAVY }, line: { type: "none" },
  });
  s.addText([
    { text: "DOW JONES\n", options: { fontSize: 10, color: WHITE, bold: true, charSpacing: 4 } },
    { text: "Risk & Compliance / Factiva\nPEP · Adverse Media · Enforcement", options: { fontSize: 11, color: WHITE } },
  ], {
    x: leftX, y: dgY + 1.4, w: 2.3, h: 1.0,
    fontFace: BODY_FONT, align: "center", valign: "middle", margin: 0,
  });

  // Arrow lines
  s.addShape(pres.shapes.LINE, {
    x: leftX + 2.3, y: dgY + 0.5, w: 1.4, h: 0,
    line: { color: NAVY, width: 2 },
  });
  s.addShape(pres.shapes.LINE, {
    x: leftX + 2.3, y: dgY + 1.9, w: 1.4, h: 0,
    line: { color: NAVY, width: 2 },
  });

  // Engine box
  s.addShape(pres.shapes.RECTANGLE, {
    x: leftX + 3.7, y: dgY + 0.55, w: 2.5, h: 1.3,
    fill: { color: WHITE }, line: { color: NAVY, width: 1.5 },
  });
  s.addText([
    { text: "Scoring Engine\n", options: { fontSize: 13, color: NAVY, bold: true } },
    { text: "lib/scoring/*.ts\n", options: { fontSize: 9, color: MUTED, fontFace: MONO_FONT } },
    { text: "18 pure functions, untouched", options: { fontSize: 10, color: INK } },
  ], {
    x: leftX + 3.7, y: dgY + 0.55, w: 2.5, h: 1.3,
    fontFace: BODY_FONT, align: "center", valign: "middle", margin: 0,
  });

  // Right side — three takeaways
  const rightX = 7.6;
  const rW = W - rightX - MARGIN;
  s.addText("Why this proposal works", {
    x: rightX, y: 1.7, w: rW, h: 0.4,
    fontFace: HEADER_FONT, fontSize: 14, color: NAVY, bold: true, margin: 0,
  });
  const points = [
    {
      title: "Zero re-write to switch",
      body: "Source of records is opaque to the scoring code. Swap from public to DJ — or run both — without changing any of the 18 scoring functions.",
    },
    {
      title: "Both = best validation",
      body: "Run public + DJ in parallel for ~4 weeks; surface diffs in a comparison view to identify exactly where they disagree before committing.",
    },
    {
      title: "DT touches only data layer",
      body: "Architecturally only lib/data.ts is affected. Existing UI, audit logging, and refresh button keep working unchanged.",
    },
  ];
  let y = 2.15;
  points.forEach((p) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: rightX, y, w: 0.06, h: 1.05,
      fill: { color: CORAL }, line: { type: "none" },
    });
    s.addText(p.title, {
      x: rightX + 0.18, y: y - 0.04, w: rW - 0.18, h: 0.32,
      fontFace: HEADER_FONT, fontSize: 13, color: NAVY, bold: true, margin: 0,
    });
    s.addText(p.body, {
      x: rightX + 0.18, y: y + 0.3, w: rW - 0.18, h: 0.75,
      fontFace: BODY_FONT, fontSize: 10.5, color: INK, margin: 0,
    });
    y += 1.25;
  });

  pageFooter(s, num, total);
});

// ---- Section divider 1: Winnie's questions ---------------------------------
slideBuilders.push((num, total) =>
  sectionDivider(
    num, total,
    "WINNIE'S QUESTIONS",
    "Definitions, logic, governance",
    "How factors are defined and scored, how risk levels are derived, and how the platform handles public-source limitations and audit needs."
  )
);

// ---- Slide: Q1 contributing factors — definitions ---------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "02 · CONTRIBUTING FACTORS", "Each factor is documented in /methodology");

  // Subtitle
  s.addText("Example — three factors of the Sanctions Screening dimension (25% weight)", {
    x: MARGIN, y: 1.5, w: W - 2 * MARGIN, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, color: MUTED, italic: true, margin: 0,
  });

  // Three cards horizontally
  const cards = [
    {
      title: "Direct Sanctions Hit", weight: "60%",
      what: "HQ jurisdiction listed on OFAC SDN / FATF blacklist / UN / EU consolidated list",
      rule: [
        ["Comprehensive", "100"],
        ["Sectoral", "75"],
        ["No hit", "0"],
      ],
    },
    {
      title: "UBO Sanctions Exposure", weight: "30%",
      what: "Number of Ultimate Beneficial Owners residing in a sanctioned jurisdiction",
      rule: [["Formula", "60 × n, capped 100"]],
    },
    {
      title: "Fuzzy Watchlist Match", weight: "10%",
      what: "Best name-similarity score against aggregated watchlists (Jaro-Winkler / Levenshtein)",
      rule: [["Formula", "similarity %"], ["Use", "investigative trigger only"]],
    },
  ];
  const cardW = 4.0;
  const cardH = 4.4;
  const cardY = 1.95;
  const gap = 0.18;
  const startX = MARGIN;
  cards.forEach((c, i) => {
    const x = startX + i * (cardW + gap);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
      shadow: { type: "outer", color: "000000", blur: 12, offset: 2, angle: 90, opacity: 0.06 },
    });
    // header strip
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: 0.06, fill: { color: CORAL }, line: { type: "none" },
    });
    // weight pill
    s.addShape(pres.shapes.RECTANGLE, {
      x: x + cardW - 0.85, y: cardY + 0.25, w: 0.7, h: 0.32,
      fill: { color: ICE }, line: { type: "none" },
    });
    s.addText(c.weight, {
      x: x + cardW - 0.85, y: cardY + 0.25, w: 0.7, h: 0.32,
      fontFace: HEADER_FONT, fontSize: 11, color: NAVY, bold: true, align: "center", valign: "middle", margin: 0,
    });
    s.addText(c.title, {
      x: x + 0.3, y: cardY + 0.25, w: cardW - 1.1, h: 0.5,
      fontFace: HEADER_FONT, fontSize: 15, color: NAVY, bold: true, margin: 0,
    });
    s.addText("WHAT IT CAPTURES", {
      x: x + 0.3, y: cardY + 0.85, w: cardW - 0.6, h: 0.25,
      fontFace: HEADER_FONT, fontSize: 9, color: MUTED, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(c.what, {
      x: x + 0.3, y: cardY + 1.1, w: cardW - 0.6, h: 1.4,
      fontFace: BODY_FONT, fontSize: 11, color: INK, margin: 0,
    });
    s.addText("SCORING RULE", {
      x: x + 0.3, y: cardY + 2.55, w: cardW - 0.6, h: 0.25,
      fontFace: HEADER_FONT, fontSize: 9, color: MUTED, bold: true, charSpacing: 3, margin: 0,
    });
    let ry = cardY + 2.85;
    c.rule.forEach(([k, v]) => {
      s.addText(k, {
        x: x + 0.3, y: ry, w: 1.7, h: 0.32,
        fontFace: BODY_FONT, fontSize: 10.5, color: MUTED, margin: 0,
      });
      s.addText(v, {
        x: x + 1.95, y: ry, w: cardW - 2.25, h: 0.32,
        fontFace: MONO_FONT, fontSize: 11, color: INK, bold: true, margin: 0,
      });
      ry += 0.36;
    });
  });

  s.addText("Full 18-factor catalog will be in the Scoring Policy Document (Word/PDF) for ECO sign-off.", {
    x: MARGIN, y: cardY + cardH + 0.25, w: W - 2 * MARGIN, h: 0.3,
    fontFace: BODY_FONT, fontSize: 10, color: MUTED, italic: true, margin: 0,
  });

  pageFooter(s, num, total);
});

// ---- Slide: data reality of factors ----------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "02 · CONTRIBUTING FACTORS", "Direct assertion vs. structured aggregation");

  s.addText("Each factor is tagged with one of four data-reality badges. Today: 5 real / 6 hybrid / 2 proxy / 5 mock.", {
    x: MARGIN, y: 1.5, w: W - 2 * MARGIN, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, color: MUTED, italic: true, margin: 0,
  });

  const badges = [
    {
      color: EMERALD, label: "REAL", count: "5 / 18",
      title: "Real snapshot",
      desc: "Single value read directly from one authoritative public source",
      ex: "HQ FATF Status · Basel AML Index · CPI · WGI",
    },
    {
      color: AMBER, label: "HYBRID", count: "6 / 18",
      title: "Hybrid",
      desc: "Real reference data combined with synthetic / aggregated entity data",
      ex: "UBO Sanctions Exposure · High-Risk Operating Footprint",
    },
    {
      color: PURPLE, label: "PROXY", count: "2 / 18",
      title: "Proxy approximation",
      desc: "Approximated from a related real dataset because the precise source is not bundled",
      ex: "Rule of Law (using WGI as proxy for WJP)",
    },
    {
      color: ROSE, label: "MOCK", count: "5 / 18",
      title: "Mock signal",
      desc: "Fully synthetic, demo-only — exactly the cells that benefit most from a Dow Jones swap",
      ex: "Adverse Media Count · UBO PEP · Regulatory Enforcement",
    },
  ];

  const colW = (W - 2 * MARGIN - 0.3 * 3) / 4;
  const cardH = 4.6;
  const startY = 1.95;
  badges.forEach((b, i) => {
    const x = MARGIN + i * (colW + 0.3);
    // Coloured accent strip on top
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: startY, w: colW, h: 0.45, fill: { color: b.color }, line: { type: "none" },
    });
    s.addText(b.label, {
      x: x + 0.2, y: startY, w: colW - 1.5, h: 0.45,
      fontFace: HEADER_FONT, fontSize: 12, color: WHITE, bold: true, charSpacing: 5, valign: "middle", margin: 0,
    });
    s.addText(b.count, {
      x: x + colW - 1.5, y: startY, w: 1.3, h: 0.45,
      fontFace: MONO_FONT, fontSize: 12, color: WHITE, bold: true, align: "right", valign: "middle", margin: 0,
    });
    // body card
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: startY + 0.45, w: colW, h: cardH - 0.45,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
    });
    s.addText(b.title, {
      x: x + 0.2, y: startY + 0.55, w: colW - 0.4, h: 0.4,
      fontFace: HEADER_FONT, fontSize: 14, color: NAVY, bold: true, margin: 0,
    });
    s.addText(b.desc, {
      x: x + 0.2, y: startY + 1.0, w: colW - 0.4, h: 1.6,
      fontFace: BODY_FONT, fontSize: 11, color: INK, margin: 0,
    });
    s.addText("EXAMPLES", {
      x: x + 0.2, y: startY + 2.85, w: colW - 0.4, h: 0.25,
      fontFace: HEADER_FONT, fontSize: 9, color: MUTED, bold: true, charSpacing: 3, margin: 0,
    });
    s.addText(b.ex, {
      x: x + 0.2, y: startY + 3.1, w: colW - 0.4, h: 1.3,
      fontFace: BODY_FONT, fontSize: 10.5, color: INK, italic: true, margin: 0,
    });
  });

  pageFooter(s, num, total);
});

// ---- Slide: Risk classification --------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "03 · RISK CLASSIFICATION", "Composite formula and risk-level cut-points");

  // Formula
  s.addShape(pres.shapes.RECTANGLE, {
    x: MARGIN, y: 1.55, w: W - 2 * MARGIN, h: 0.7,
    fill: { color: NAVY }, line: { type: "none" },
  });
  s.addText([
    { text: "COMPOSITE  =  ", options: { fontSize: 14, color: ICE, bold: true, charSpacing: 4 } },
    { text: "Σ (dimension_score × dimension_weight) ÷ Σ weights", options: { fontSize: 16, color: WHITE, fontFace: MONO_FONT } },
  ], {
    x: MARGIN + 0.4, y: 1.55, w: W - 2 * MARGIN - 0.8, h: 0.7,
    fontFace: BODY_FONT, valign: "middle", margin: 0,
  });

  // Left — dimension weights
  s.addText("DIMENSION WEIGHTS", {
    x: MARGIN, y: 2.5, w: 6, h: 0.3,
    fontFace: HEADER_FONT, fontSize: 11, color: MUTED, bold: true, charSpacing: 4, margin: 0,
  });
  const weights = [
    { name: "Sanctions Screening", w: 25, color: CORAL },
    { name: "Country Risk Scoring", w: 20, color: NAVY },
    { name: "High-Risk Jurisdiction Monitoring", w: 15, color: AMBER },
    { name: "Sanctions Circumvention", w: 15, color: PURPLE },
    { name: "PEP & Adverse Media", w: 15, color: SAGE },
    { name: "Country Context Enrichment", w: 10, color: ICE },
  ];
  let wy = 2.85;
  weights.forEach((d) => {
    s.addText(d.name, {
      x: MARGIN, y: wy, w: 3.2, h: 0.3,
      fontFace: BODY_FONT, fontSize: 11, color: INK, margin: 0,
    });
    // bar
    s.addShape(pres.shapes.RECTANGLE, {
      x: MARGIN + 3.3, y: wy + 0.05, w: 0.06 * 25, h: 0.2,
      fill: { color: RULE }, line: { type: "none" },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: MARGIN + 3.3, y: wy + 0.05, w: 0.06 * d.w, h: 0.2,
      fill: { color: d.color }, line: { type: "none" },
    });
    s.addText(`${d.w}%`, {
      x: MARGIN + 3.3 + 0.06 * 25 + 0.1, y: wy, w: 0.7, h: 0.3,
      fontFace: MONO_FONT, fontSize: 11, color: NAVY, bold: true, margin: 0,
    });
    wy += 0.42;
  });

  // Right — risk levels
  const rX = 7.4;
  s.addText("RISK-LEVEL THRESHOLDS  ·  Placeholder, ECO to sign off", {
    x: rX, y: 2.5, w: W - rX - MARGIN, h: 0.3,
    fontFace: HEADER_FONT, fontSize: 11, color: MUTED, bold: true, charSpacing: 4, margin: 0,
  });
  const levels = [
    { label: "LOW", range: "0 – 24", color: EMERALD, action: "Standard CDD; no immediate review" },
    { label: "MEDIUM", range: "25 – 49", color: AMBER, action: "Standard CDD + periodic refresh" },
    { label: "HIGH", range: "50 – 69", color: "F97316", action: "Escalate to EDD; compliance review required" },
    { label: "CRITICAL", range: "≥ 70", color: ROSE, action: "Block onboarding pending review; SAR consideration" },
  ];
  const rH = 0.85;
  let ry = 2.85;
  levels.forEach((l) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: rX, y: ry, w: W - rX - MARGIN, h: rH,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: rX, y: ry, w: 0.08, h: rH, fill: { color: l.color }, line: { type: "none" },
    });
    s.addText(l.label, {
      x: rX + 0.25, y: ry + 0.05, w: 1.5, h: 0.4,
      fontFace: HEADER_FONT, fontSize: 13, color: l.color, bold: true, charSpacing: 4, margin: 0,
    });
    s.addText(l.range, {
      x: rX + 0.25, y: ry + 0.42, w: 1.5, h: 0.35,
      fontFace: MONO_FONT, fontSize: 12, color: INK, margin: 0,
    });
    s.addText(l.action, {
      x: rX + 1.85, y: ry + 0.05, w: W - rX - MARGIN - 2.0, h: rH - 0.1,
      fontFace: BODY_FONT, fontSize: 11, color: INK, valign: "middle", margin: 0,
    });
    ry += rH + 0.08;
  });

  s.addText("Current synthetic distribution: 150 Low / 39 Medium / 8 High / 3 Critical (out of 200).  ECO must approve final cut-points — they directly drive what triggers EDD vs SAR.", {
    x: MARGIN, y: H - 0.85, w: W - 2 * MARGIN, h: 0.4,
    fontFace: BODY_FONT, fontSize: 10, color: MUTED, italic: true, margin: 0,
  });

  pageFooter(s, num, total);
});

// ---- Slide: public-source constraints — update cadence ---------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "04 · PUBLIC-SOURCE CONSTRAINTS", "Update cadence by source");

  s.addText("Public sanctions feeds match Dow Jones cadence; PEP and adverse media are where DJ earns its price.", {
    x: MARGIN, y: 1.5, w: W - 2 * MARGIN, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, color: MUTED, italic: true, margin: 0,
  });

  // Two-column table
  const tbl = [
    [{ text: "Source", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
     { text: "Cadence", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
     { text: "Match DJ?", options: { bold: true, color: WHITE, fill: { color: NAVY } } }],

    ["FATF High-Risk & Monitored Jurisdictions", "3× per year", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["OFAC SDN List", "Multiple times per week", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["UN Consolidated List", "Monthly", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["EU Consolidated List", "Monthly", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["Basel AML Index", "Annual", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["Transparency Intl. CPI", "Annual", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["World Bank WGI", "Annual", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["OpenSanctions (aggregator)", "Daily", { text: "Same source", options: { color: EMERALD, bold: true } }],
    ["GDELT (public adverse media)", "15-min ingest, no compliance tagging", { text: "DJ better — 24-72h faster + analyst tagging", options: { color: ROSE, bold: true } }],
    ["Public PEP coverage (OpenSanctions)", "Weekly-ish, ~250k entries", { text: "DJ better — daily, ~3M including local", options: { color: ROSE, bold: true } }],
  ];

  s.addTable(tbl, {
    x: MARGIN, y: 1.95, w: W - 2 * MARGIN,
    colW: [4.2, 3.6, 4.4],
    rowH: 0.36,
    fontFace: BODY_FONT, fontSize: 11, color: INK,
    border: { type: "solid", pt: 0.5, color: RULE },
    valign: "middle",
  });

  pageFooter(s, num, total);
});

// ---- Slide: public-source constraints — divergence & versioning ------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "04 · PUBLIC-SOURCE CONSTRAINTS", "Divergence, retroactive corrections, source versioning");

  // Three columns
  const cols = [
    {
      icon: "⚖", title: "Source divergence",
      body: "Most-conservative-wins rule. If OFAC asserts comprehensive but FATF says compliant, the higher score prevails. Documented per dimension; no silent tie-breaks.",
    },
    {
      icon: "↺", title: "Retroactive revisions",
      body: "Every score persists (companyId, scoreVersion, sourceSnapshotDate, sourceHash). Never silently overwrites — historical scores kept for audit; re-runs produce new versioned scores.",
    },
    {
      icon: "▦", title: "Source versioning",
      body: "Every factor in the UI shows a snapshotDate badge. Production audit table will hold full hash fingerprint per source so any past score is reproducible.",
    },
  ];
  const cardW = (W - 2 * MARGIN - 0.4 * 2) / 3;
  const cardH = 4.0;
  const cardY = 1.85;
  cols.forEach((c, i) => {
    const x = MARGIN + i * (cardW + 0.4);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: cardY, w: cardW, h: cardH,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
      shadow: { type: "outer", color: "000000", blur: 12, offset: 2, angle: 90, opacity: 0.06 },
    });
    // big symbol
    s.addText(c.icon, {
      x, y: cardY + 0.4, w: cardW, h: 1.2,
      fontFace: HEADER_FONT, fontSize: 56, color: NAVY, bold: true, align: "center", margin: 0,
    });
    s.addText(c.title, {
      x: x + 0.3, y: cardY + 1.7, w: cardW - 0.6, h: 0.5,
      fontFace: HEADER_FONT, fontSize: 16, color: NAVY, bold: true, align: "center", margin: 0,
    });
    s.addText(c.body, {
      x: x + 0.3, y: cardY + 2.25, w: cardW - 0.6, h: 1.6,
      fontFace: BODY_FONT, fontSize: 11.5, color: INK, align: "left", margin: 0,
    });
  });

  pageFooter(s, num, total);
});

// ---- Slide: third-party integration ----------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "05 · THIRD-PARTY INTEGRATION", "Yes — already designed for it");

  s.addText("Three-step plan to layer Dow Jones (or any other vendor) on top of the existing engine.", {
    x: MARGIN, y: 1.5, w: W - 2 * MARGIN, h: 0.3,
    fontFace: BODY_FONT, fontSize: 11, color: MUTED, italic: true, margin: 0,
  });

  const steps = [
    {
      n: "1", title: "Implement DowJonesProvider",
      body: "Map DJ's entity model to our typed shapes (Company, UBO, Subsidiary). One adapter class.",
    },
    {
      n: "2", title: "Add environment toggle",
      body: "DATA_PROVIDER = public | dow_jones | both. Selects which provider feeds the scoring engine.",
    },
    {
      n: "3", title: "Both-mode = comparison view",
      body: "Run two parallel scoring passes; surface diffs (\"public 32 vs DJ 71 — these factors disagree\"). The dual-track validation dashboard.",
    },
  ];
  const stepW = (W - 2 * MARGIN - 0.3 * 2) / 3;
  const stepY = 1.95;
  steps.forEach((st, i) => {
    const x = MARGIN + i * (stepW + 0.3);
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: stepY, w: stepW, h: 3.0,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
    });
    s.addShape(pres.shapes.OVAL, {
      x: x + 0.4, y: stepY + 0.4, w: 0.85, h: 0.85,
      fill: { color: NAVY }, line: { type: "none" },
    });
    s.addText(st.n, {
      x: x + 0.4, y: stepY + 0.4, w: 0.85, h: 0.85,
      fontFace: HEADER_FONT, fontSize: 30, color: WHITE, bold: true, align: "center", valign: "middle", margin: 0,
    });
    s.addText(st.title, {
      x: x + 0.4, y: stepY + 1.4, w: stepW - 0.8, h: 0.5,
      fontFace: HEADER_FONT, fontSize: 14, color: NAVY, bold: true, margin: 0,
    });
    s.addText(st.body, {
      x: x + 0.4, y: stepY + 1.95, w: stepW - 0.8, h: 1.0,
      fontFace: BODY_FONT, fontSize: 11.5, color: INK, margin: 0,
    });
  });

  // takeaway strip
  s.addShape(pres.shapes.RECTANGLE, {
    x: MARGIN, y: 5.4, w: W - 2 * MARGIN, h: 0.7,
    fill: { color: NAVY }, line: { type: "none" },
  });
  s.addText([
    { text: "ARCHITECTURALLY  ", options: { color: CORAL, bold: true, charSpacing: 4, fontSize: 11 } },
    { text: "only ", options: { color: ICE, fontSize: 13 } },
    { text: "lib/data.ts", options: { color: WHITE, fontFace: MONO_FONT, fontSize: 13 } },
    { text: " is touched. The 18 scoring functions stay untouched.", options: { color: ICE, fontSize: 13 } },
  ], {
    x: MARGIN + 0.4, y: 5.4, w: W - 2 * MARGIN - 0.8, h: 0.7,
    fontFace: BODY_FONT, valign: "middle", margin: 0,
  });

  pageFooter(s, num, total);
});

// ---- Slide: validation & governance ----------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "06 · VALIDATION & GOVERNANCE", "Audit logs, regression, escalation");

  // Three sections
  const cols = [
    {
      label: "VALIDATION", title: "Data-accuracy controls",
      items: [
        "SHA-256 hash on every raw payload at refresh",
        "Golden-set of ~30 known entities; auto-regression on each refresh",
        "Weekly reconciliation report: public vs Dow Jones (during dual-track)",
      ],
    },
    {
      label: "AUDIT LOG", title: "What gets recorded",
      items: [
        "Data refresh log per source: who, when, hash, # records, # changed",
        "Scoring-logic change log: weight or formula changes tracked in git, regression on golden set",
        "Material source updates: e.g. FATF moves a country → auto-email to ECO with affected entities",
      ],
    },
    {
      label: "ESCALATION", title: "How issues reach ECO",
      items: [
        "Sev 1 — primary feed unreachable >24h or engine crash → immediate Slack + email duty roster",
        "Sev 2 — >20% of entities change band in one refresh → hold publish, ECO-on-call review",
        "Sev 3 — cosmetic/minor → weekly digest",
      ],
    },
  ];
  const colW = (W - 2 * MARGIN - 0.3 * 2) / 3;
  const colY = 1.7;
  cols.forEach((c, i) => {
    const x = MARGIN + i * (colW + 0.3);
    // navy header
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: colY, w: colW, h: 0.75, fill: { color: NAVY }, line: { type: "none" },
    });
    s.addText(c.label, {
      x: x + 0.3, y: colY + 0.05, w: colW - 0.4, h: 0.3,
      fontFace: HEADER_FONT, fontSize: 10, color: CORAL, bold: true, charSpacing: 4, margin: 0,
    });
    s.addText(c.title, {
      x: x + 0.3, y: colY + 0.32, w: colW - 0.4, h: 0.4,
      fontFace: HEADER_FONT, fontSize: 14, color: WHITE, bold: true, margin: 0,
    });
    // body
    s.addShape(pres.shapes.RECTANGLE, {
      x, y: colY + 0.75, w: colW, h: 4.5,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
    });
    let by = colY + 0.95;
    c.items.forEach((item) => {
      s.addShape(pres.shapes.OVAL, {
        x: x + 0.3, y: by + 0.18, w: 0.12, h: 0.12,
        fill: { color: CORAL }, line: { type: "none" },
      });
      s.addText(item, {
        x: x + 0.5, y: by, w: colW - 0.7, h: 1.3,
        fontFace: BODY_FONT, fontSize: 11, color: INK, margin: 0,
      });
      by += 1.4;
    });
  });

  pageFooter(s, num, total);
});

// ---- Section divider 2: Deborah's questions --------------------------------
slideBuilders.push((num, total) =>
  sectionDivider(
    num, total,
    "DEBORAH'S QUESTIONS",
    "Cadence, regions, alternatives, auto-scoring",
    "Where Dow Jones genuinely outperforms public sources, what other vendors are worth comparing, and how auto-routing on customer entry works."
  )
);

// ---- Slide: where DJ outperforms -------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "07 · WHERE DJ OUTPERFORMS", "Honest assessment of DJ's edges over public sources");

  // Two columns: DJ wins vs No DJ advantage
  const winsX = MARGIN;
  const tieX = (W / 2) + 0.1;
  const colW = (W / 2) - MARGIN - 0.1;

  // Column 1 — DJ wins
  s.addShape(pres.shapes.RECTANGLE, {
    x: winsX, y: 1.6, w: colW, h: 0.65,
    fill: { color: ROSE }, line: { type: "none" },
  });
  s.addText("DJ ADVANTAGE — keep paying for DJ in these areas", {
    x: winsX + 0.25, y: 1.6, w: colW - 0.5, h: 0.65,
    fontFace: HEADER_FONT, fontSize: 13, color: WHITE, bold: true, charSpacing: 3, valign: "middle", margin: 0,
  });

  const wins = [
    { t: "China local PEP coverage", b: "DJ captures tier-3+ city officials that public lists rarely include." },
    { t: "Russian / Iranian shell-company networks", b: "DJ traces ownership chains; OpenSanctions only flags direct entities." },
    { t: "Latin American adverse media", b: "DJ has built-in Spanish/Portuguese analyst tagging." },
    { t: "Adverse media — global cadence", b: "DJ is 24-72h ahead of public news feeds, with compliance taxonomy." },
  ];
  let wy = 2.45;
  wins.forEach((w) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: winsX, y: wy, w: colW, h: 1.0,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: winsX, y: wy, w: 0.06, h: 1.0, fill: { color: ROSE }, line: { type: "none" },
    });
    s.addText(w.t, {
      x: winsX + 0.2, y: wy + 0.1, w: colW - 0.3, h: 0.3,
      fontFace: HEADER_FONT, fontSize: 12, color: NAVY, bold: true, margin: 0,
    });
    s.addText(w.b, {
      x: winsX + 0.2, y: wy + 0.4, w: colW - 0.3, h: 0.55,
      fontFace: BODY_FONT, fontSize: 10.5, color: INK, margin: 0,
    });
    wy += 1.07;
  });

  // Column 2 — Tie
  s.addShape(pres.shapes.RECTANGLE, {
    x: tieX, y: 1.6, w: colW, h: 0.65,
    fill: { color: EMERALD }, line: { type: "none" },
  });
  s.addText("NO DJ ADVANTAGE — public is fine for these", {
    x: tieX + 0.25, y: 1.6, w: colW - 0.5, h: 0.65,
    fontFace: HEADER_FONT, fontSize: 13, color: WHITE, bold: true, charSpacing: 3, valign: "middle", margin: 0,
  });

  const ties = [
    { t: "OFAC / UN / EU sanctions screening", b: "Both consume the same primary publications. No quality difference." },
    { t: "Country-level reference data", b: "FATF, Basel AML Index, CPI, WGI are the same numbers, free at the source." },
    { t: "Sanctions-list hourly refresh", b: "OpenSanctions API supports hourly polling. DJ runs the same cadence." },
    { t: "Direct-hit determinations", b: "Binary fact: a name is on the SDN or it isn't. Public source is authoritative." },
  ];
  wy = 2.45;
  ties.forEach((w) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: tieX, y: wy, w: colW, h: 1.0,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: tieX, y: wy, w: 0.06, h: 1.0, fill: { color: EMERALD }, line: { type: "none" },
    });
    s.addText(w.t, {
      x: tieX + 0.2, y: wy + 0.1, w: colW - 0.3, h: 0.3,
      fontFace: HEADER_FONT, fontSize: 12, color: NAVY, bold: true, margin: 0,
    });
    s.addText(w.b, {
      x: tieX + 0.2, y: wy + 0.4, w: colW - 0.3, h: 0.55,
      fontFace: BODY_FONT, fontSize: 10.5, color: INK, margin: 0,
    });
    wy += 1.07;
  });

  pageFooter(s, num, total);
});

// ---- Slide: alternative vendors --------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "07 · ALTERNATIVE VENDORS", "Beyond Dow Jones — six options to evaluate");

  s.addText("If ECO wants a non-DJ comparison vendor for the dual-track, my picks: ComplyAdvantage (modern API, cost-friendly) or Sayari (best at sanctions-evasion tracing).", {
    x: MARGIN, y: 1.5, w: W - 2 * MARGIN, h: 0.4,
    fontFace: BODY_FONT, fontSize: 11, color: MUTED, italic: true, margin: 0,
  });

  const tbl = [
    [
      { text: "Vendor", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: "Strength", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: "Pricing", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
      { text: "Recommended use", options: { bold: true, color: WHITE, fill: { color: NAVY } } },
    ],
    ["Refinitiv (LSEG) World-Check", "Most-cited compliance dataset; tight entity resolution", "Mid-high", "DJ alternative; same tier"],
    ["Moody's Orbis + GRID", "Best company data + adverse media combo", "High", "If we need deep corporate data"],
    ["LexisNexis WorldCompliance", "Strong legal / litigation coverage", "Mid-high", "Adds legal-record dimension"],
    [{ text: "ComplyAdvantage", options: { bold: true, color: CORAL } }, "AI-driven, modern API, cost-friendly mid-market", "Mid", { text: "★ Recommended for dual-track", options: { bold: true, color: CORAL } }],
    [{ text: "Sayari", options: { bold: true, color: CORAL } }, "Network-graph approach; excellent for evasion tracing", "Mid", { text: "★ Recommended for circumvention", options: { bold: true, color: CORAL } }],
    ["Dun & Bradstreet", "Strong company data, weaker on adverse media", "Mid", "China/ROW split is awkward for API integration"],
  ];

  s.addTable(tbl, {
    x: MARGIN, y: 2.05, w: W - 2 * MARGIN,
    colW: [3.3, 4.5, 1.4, 3.0],
    rowH: 0.5,
    fontFace: BODY_FONT, fontSize: 11, color: INK,
    border: { type: "solid", pt: 0.5, color: RULE },
    valign: "middle",
  });

  pageFooter(s, num, total);
});

// ---- Slide: auto-scoring on customer entry ---------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "08 · AUTO-SCORING ON CUSTOMER ENTRY", "Yes — fully supported once ECO signs off");

  // Three flows on the page: Onboarding / Continuous / Auto-escalation
  const cards = [
    {
      label: "AT ONBOARDING", title: "Synchronous score (sub-second)",
      flow: [
        { color: EMERALD, label: "Low",      action: "No review queue" },
        { color: AMBER,   label: "Medium",   action: "Standard CDD queue" },
        { color: "F97316", label: "High",    action: "EDD queue, auto-routed" },
        { color: ROSE,    label: "Critical", action: "EDD queue + immediate review" },
      ],
    },
    {
      label: "CONTINUOUS MONITORING", title: "Nightly re-score, all active counterparties",
      bullets: [
        "All active relationships re-scored each night",
        "Band changes (e.g. Low → Medium) trigger notification",
        "ECO sees a daily diff report of who moved bands",
        "Quarterly periodic-review prioritization auto-generated",
      ],
    },
    {
      label: "AUTO-ESCALATION OVERRIDE", title: "Single-factor red flags bypass the composite",
      bullets: [
        "Any factor scoring ≥ 80 triggers immediate alert",
        "Catches SDN hits even on otherwise-Low companies",
        "Routed to ECO duty roster regardless of band",
        "Examples: comprehensive sanctions HQ, multiple PEP UBOs",
      ],
    },
  ];

  // First card — special layout (the band → action flow)
  const c1 = cards[0];
  const x1 = MARGIN, y1 = 1.7, w1 = (W - 2 * MARGIN - 0.3 * 2) / 3, h1 = 4.3;
  s.addShape(pres.shapes.RECTANGLE, { x: x1, y: y1, w: w1, h: 0.7, fill: { color: NAVY }, line: { type: "none" } });
  s.addText(c1.label, {
    x: x1 + 0.25, y: y1, w: w1 - 0.5, h: 0.3,
    fontFace: HEADER_FONT, fontSize: 9.5, color: CORAL, bold: true, charSpacing: 4, valign: "bottom", margin: 0,
  });
  s.addText(c1.title, {
    x: x1 + 0.25, y: y1 + 0.3, w: w1 - 0.5, h: 0.4,
    fontFace: HEADER_FONT, fontSize: 13, color: WHITE, bold: true, valign: "top", margin: 0,
  });
  s.addShape(pres.shapes.RECTANGLE, { x: x1, y: y1 + 0.7, w: w1, h: h1 - 0.7, fill: { color: WHITE }, line: { color: RULE, width: 0.75 } });
  let fy = y1 + 0.9;
  c1.flow.forEach((f) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: x1 + 0.25, y: fy, w: 1.0, h: 0.6,
      fill: { color: f.color }, line: { type: "none" },
    });
    s.addText(f.label, {
      x: x1 + 0.25, y: fy, w: 1.0, h: 0.6,
      fontFace: HEADER_FONT, fontSize: 12, color: WHITE, bold: true, align: "center", valign: "middle", charSpacing: 3, margin: 0,
    });
    s.addText("→", {
      x: x1 + 1.3, y: fy, w: 0.3, h: 0.6,
      fontFace: BODY_FONT, fontSize: 18, color: MUTED, align: "center", valign: "middle", margin: 0,
    });
    s.addText(f.action, {
      x: x1 + 1.65, y: fy, w: w1 - 1.9, h: 0.6,
      fontFace: BODY_FONT, fontSize: 11, color: INK, valign: "middle", margin: 0,
    });
    fy += 0.78;
  });

  // Cards 2 and 3 — bullets
  for (let i = 1; i < 3; i++) {
    const cc = cards[i];
    const x = MARGIN + i * (w1 + 0.3), y = y1, w = w1, h = h1;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h: 0.7, fill: { color: NAVY }, line: { type: "none" } });
    s.addText(cc.label, {
      x: x + 0.25, y, w: w - 0.5, h: 0.3,
      fontFace: HEADER_FONT, fontSize: 9.5, color: CORAL, bold: true, charSpacing: 4, valign: "bottom", margin: 0,
    });
    s.addText(cc.title, {
      x: x + 0.25, y: y + 0.3, w: w - 0.5, h: 0.4,
      fontFace: HEADER_FONT, fontSize: 13, color: WHITE, bold: true, valign: "top", margin: 0,
    });
    s.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.7, w, h: h - 0.7, fill: { color: WHITE }, line: { color: RULE, width: 0.75 } });
    let by = y + 0.95;
    cc.bullets.forEach((b) => {
      s.addShape(pres.shapes.OVAL, {
        x: x + 0.3, y: by + 0.13, w: 0.1, h: 0.1, fill: { color: CORAL }, line: { type: "none" },
      });
      s.addText(b, {
        x: x + 0.5, y: by, w: w - 0.7, h: 0.7,
        fontFace: BODY_FONT, fontSize: 11, color: INK, margin: 0,
      });
      by += 0.78;
    });
  }

  pageFooter(s, num, total);
});

// ---- Slide: deliverables ----------------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  paperBackground(s);
  pageHeader(s, "09 · DELIVERABLES", "What I'll bring back to ECO");

  const items = [
    {
      n: "01", title: "Scoring Policy Document",
      sub: "Formal Word/PDF",
      body: "All 18 factors with definitions, formulas, weights, and risk-level cut-points. Formatted for ECO sign-off.",
    },
    {
      n: "02", title: "Source-versioning + audit-log design",
      sub: "One-page architecture sketch",
      body: "Schema for the audit table, hash-fingerprint approach, retention policy, and ECO-facing notification rules.",
    },
    {
      n: "03", title: "Dual-track validation plan",
      sub: "4-week parallel run",
      body: "Concrete plan for running public + DJ side-by-side, with diff dashboard and reconciliation report template.",
    },
  ];

  let y = 1.7;
  items.forEach((it) => {
    s.addShape(pres.shapes.RECTANGLE, {
      x: MARGIN, y, w: W - 2 * MARGIN, h: 1.45,
      fill: { color: WHITE }, line: { color: RULE, width: 0.75 },
      shadow: { type: "outer", color: "000000", blur: 10, offset: 2, angle: 90, opacity: 0.06 },
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: MARGIN, y, w: 1.4, h: 1.45, fill: { color: NAVY }, line: { type: "none" },
    });
    s.addText(it.n, {
      x: MARGIN, y, w: 1.4, h: 1.45,
      fontFace: HEADER_FONT, fontSize: 36, color: CORAL, bold: true, align: "center", valign: "middle", margin: 0,
    });
    s.addText(it.title, {
      x: MARGIN + 1.6, y: y + 0.18, w: 6, h: 0.45,
      fontFace: HEADER_FONT, fontSize: 18, color: NAVY, bold: true, margin: 0,
    });
    s.addText(it.sub, {
      x: MARGIN + 1.6, y: y + 0.62, w: 6, h: 0.3,
      fontFace: BODY_FONT, fontSize: 11, color: CORAL, italic: true, charSpacing: 2, margin: 0,
    });
    s.addText(it.body, {
      x: MARGIN + 1.6, y: y + 0.92, w: W - 2 * MARGIN - 1.8, h: 0.5,
      fontFace: BODY_FONT, fontSize: 11, color: INK, margin: 0,
    });
    y += 1.65;
  });

  pageFooter(s, num, total);
});

// ---- Slide: closing / discussion -------------------------------------------
slideBuilders.push((num, total) => {
  const s = pres.addSlide();
  s.background = { color: NAVY };

  s.addText("DISCUSSION", {
    x: MARGIN, y: 2.6, w: 12, h: 0.5,
    fontFace: HEADER_FONT, fontSize: 14, color: CORAL, bold: true, charSpacing: 8, margin: 0,
  });
  s.addText("Open floor", {
    x: MARGIN, y: 3.1, w: 12, h: 1.4,
    fontFace: HEADER_FONT, fontSize: 56, color: WHITE, bold: true, margin: 0,
  });
  s.addText("Let's go through these together — happy to deep-dive on any item, or pivot to the live demo.", {
    x: MARGIN, y: 4.5, w: 12, h: 0.5,
    fontFace: BODY_FONT, fontSize: 18, color: ICE, italic: true, margin: 0,
  });

  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: CORAL }, line: { type: "none" },
  });
});

// ---- Build it ---------------------------------------------------------------
const total = slideBuilders.length;
slideBuilders.forEach((build, i) => build(i + 1, total));

const outPath = `${process.cwd()}/AML_ECO_QA_Discussion.pptx`;
pres.writeFile({ fileName: outPath }).then((path) => {
  console.log("Wrote:", path);
});
