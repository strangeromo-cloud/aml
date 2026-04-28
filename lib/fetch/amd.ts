import ExcelJS from "exceljs";
import type { AmdMeta, AmdPart, FetchResult } from "./types";

// Load pdfjs-dist via dynamic import inside the function so Next.js doesn't
// try to bundle its huge worker code through Webpack at compile time.

const PDF_URL =
  "https://www.amd.com/content/dam/amd/en/documents/legal/product-master.pdf";
const SOURCE_URL = "https://www.amd.com/en/legal/compliance/trade-compliance.html";

const FETCH_HEADERS: HeadersInit = {
  Accept: "application/pdf,*/*",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: SOURCE_URL,
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
};

const HEADER_RE = /^\s*Product\s+Number\s+US\s+ECCN\s+US\s+HS\s+CCATS\s+Meets/i;
const ROW_RE =
  /^([A-Za-z0-9][A-Za-z0-9\-./]+)\s+([A-Za-z0-9][A-Za-z0-9.\-]*)\s+(\d{8,12})\s+(.+?)\s+([YN])\s*$/;
const CLASS_DATE_RE = /Classification Data as of\s+(.+)$/i;

async function downloadPdf(): Promise<Uint8Array> {
  const r = await fetch(PDF_URL, { headers: FETCH_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`AMD PDF ${r.status} ${r.statusText}`);
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

async function pdfLines(data: Uint8Array): Promise<{ lines: string[][]; classificationDate: string | null }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
  } as any).promise;
  const allLines: string[][] = [];
  let classificationDate: string | null = null;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const it of content.items as any[]) {
      const t = it.transform;
      if (!t) continue;
      const y = Math.round(t[5]);
      const x = t[4];
      const str = (it as any).str ?? "";
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str });
    }
    const ys = [...byY.keys()].sort((a, b) => b - a);
    const pageLines = ys.map((y) =>
      byY
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((t) => t.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    allLines.push(pageLines);
    if (!classificationDate) {
      for (const l of pageLines) {
        const m = CLASS_DATE_RE.exec(l);
        if (m) {
          classificationDate = m[1].trim().replace(/\.$/, "");
          break;
        }
      }
    }
  }
  return { lines: allLines, classificationDate };
}

function parseRows(allLines: string[][]): AmdPart[] {
  const seen = new Set<string>();
  const rows: AmdPart[] = [];
  for (const pageLines of allLines) {
    for (const line of pageLines) {
      if (!line) continue;
      if (HEADER_RE.test(line)) continue;
      const m = ROW_RE.exec(line);
      if (!m) continue;
      const [, part, eccn, hs, ccats, meets] = m;
      if (seen.has(part)) continue;
      seen.add(part);
      rows.push({
        part_number: part,
        us_eccn: eccn,
        us_hs: hs,
        ccats: ccats.trim(),
        meets_3A090_a_1: meets,
      });
    }
  }
  return rows;
}

function buildMeta(rows: AmdPart[], classificationDate: string | null): AmdMeta {
  const eccnCounts = new Map<string, number>();
  const hsCounts = new Map<string, number>();
  const ccatsCounts = new Map<string, number>();
  const meetsCounts = new Map<string, number>();
  for (const r of rows) {
    eccnCounts.set(r.us_eccn, (eccnCounts.get(r.us_eccn) ?? 0) + 1);
    hsCounts.set(r.us_hs, (hsCounts.get(r.us_hs) ?? 0) + 1);
    ccatsCounts.set(r.ccats, (ccatsCounts.get(r.ccats) ?? 0) + 1);
    meetsCounts.set(r.meets_3A090_a_1, (meetsCounts.get(r.meets_3A090_a_1) ?? 0) + 1);
  }
  const sortDesc = <T>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: rows.length,
    fetchedAt: new Date().toISOString(),
    classificationDate,
    sourcePage: SOURCE_URL,
    pdfUrl: PDF_URL,
    distinctEccn: eccnCounts.size,
    distinctHs: hsCounts.size,
    distinctCcats: ccatsCounts.size,
    topEccn: sortDesc(eccnCounts).slice(0, 10).map(([k, v]) => ({ eccn: k, count: v })),
    topHs: sortDesc(hsCounts).slice(0, 10).map(([k, v]) => ({ hs: k, count: v })),
    meets3A090: sortDesc(meetsCounts).map(([k, v]) => ({ meets: k, count: v })),
  };
}

async function buildXlsx(rows: AmdPart[], meta: AmdMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } } as const;
  const headerFont = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

  const info = wb.addWorksheet("About");
  info.getCell("A1").value = "AMD Product HTS/ECCN List";
  info.getCell("A1").font = { name: "Arial", bold: true, size: 16 };
  info.mergeCells("A1:C1");
  info.getCell("A3").value = "Source page";
  info.getCell("B3").value = { text: meta.sourcePage, hyperlink: meta.sourcePage } as any;
  info.getCell("A4").value = "Upstream PDF";
  info.getCell("B4").value = { text: meta.pdfUrl, hyperlink: meta.pdfUrl } as any;
  info.getCell("A5").value = "Snapshot fetched (UTC)";
  info.getCell("B5").value = meta.fetchedAt;
  info.getCell("A6").value = "Classification as of";
  info.getCell("B6").value = meta.classificationDate ?? "—";
  info.getCell("A7").value = "Records";
  info.getCell("B7").value = meta.total;
  info.getCell("A9").value = "Field glossary";
  info.getCell("A9").font = { name: "Arial", bold: true, size: 12 };
  const glossary: [string, string][] = [
    ["part_number", "AMD product number"],
    ["us_eccn", "U.S. Export Control Classification Number (EAR)"],
    ["us_hs", "U.S. Harmonized System code used for customs"],
    ["ccats", "Commodity Classification Automated Tracking System reference (BIS)"],
    [
      "meets_3A090_a_1",
      "Whether the part meets ECCN 3A090.a.1 AI-chip performance threshold (Y/N)",
    ],
  ];
  glossary.forEach(([k, v], i) => {
    info.getCell(`A${11 + i}`).value = k;
    info.getCell(`A${11 + i}`).font = { name: "Courier New", size: 10 };
    info.getCell(`B${11 + i}`).value = v;
  });
  info.getColumn(1).width = 24;
  info.getColumn(2).width = 70;

  const ws = wb.addWorksheet("All Parts");
  const cols = [
    { header: "Part Number", key: "part_number", width: 26 },
    { header: "US ECCN", key: "us_eccn", width: 14 },
    { header: "US HS", key: "us_hs", width: 14 },
    { header: "CCATS", key: "ccats", width: 14 },
    { header: "Meets 3A090.a.1", key: "meets_3A090_a_1", width: 16 },
  ];
  ws.columns = cols;
  ws.getRow(1).fill = headerFill;
  ws.getRow(1).font = headerFont;
  for (const r of rows) ws.addRow(r);
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };

  const dist = wb.addWorksheet("ECCN Distribution");
  dist.addRow(["ECCN", "Count", "% of total"]);
  dist.getRow(1).fill = headerFill;
  dist.getRow(1).font = headerFont;
  const eccnCounts = new Map<string, number>();
  for (const r of rows) eccnCounts.set(r.us_eccn, (eccnCounts.get(r.us_eccn) ?? 0) + 1);
  const sorted = [...eccnCounts.entries()].sort((a, b) => b[1] - a[1]);
  sorted.forEach(([eccn, n], i) => {
    dist.addRow([eccn, n, `=B${i + 2}/B$${sorted.length + 2}`]);
    dist.getCell(`C${i + 2}`).numFmt = "0.0%";
  });
  dist.addRow(["Total", { formula: `SUM(B2:B${sorted.length + 1})` } as any, ""]);
  dist.getColumn(1).width = 18;
  dist.getColumn(2).width = 12;
  dist.getColumn(3).width = 14;
  dist.views = [{ state: "frozen", ySplit: 1 }];

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

export async function fetchAmd(): Promise<FetchResult<AmdMeta>> {
  const data = await downloadPdf();
  const { lines, classificationDate } = await pdfLines(data);
  const rows = parseRows(lines);
  if (rows.length === 0) throw new Error("AMD PDF parsed 0 rows — format may have changed");
  const meta = buildMeta(rows, classificationDate);
  const xlsxBuffer = await buildXlsx(rows, meta);
  return { meta, xlsxBuffer };
}
