import ExcelJS from "exceljs";
import type { FetchResult, NvidiaMeta, NvidiaPart } from "./types";

const API_URL = "https://api-prod.nvidia.com/services/eccn/v1/getECCN";
const SOURCE_URL =
  "https://www.nvidia.com/en-us/about-nvidia/company-policies/export-regulations/";

const FETCH_HEADERS: HeadersInit = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.nvidia.com",
  Referer: "https://www.nvidia.com/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
};

function topN<T extends string>(rows: NvidiaPart[], pick: (p: NvidiaPart) => T | null, n = 10) {
  const c = new Map<string, number>();
  for (const p of rows) {
    const v = (pick(p) ?? "N/A") || "N/A";
    c.set(v, (c.get(v) ?? 0) + 1);
  }
  return [...c.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => ({ key: k, count: v }));
}

function buildMeta(rows: NvidiaPart[]): NvidiaMeta {
  const eccnCounts = new Map<string, number>();
  const htsCounts = new Map<string, number>();
  const stateCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  for (const r of rows) {
    const e = r.nveccn ?? "N/A";
    const h = r.nv_hts ?? "N/A";
    const s = r.state ?? "N/A";
    const t = r.part_type ?? "N/A";
    eccnCounts.set(e, (eccnCounts.get(e) ?? 0) + 1);
    htsCounts.set(h, (htsCounts.get(h) ?? 0) + 1);
    stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1);
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const sortDesc = <T>(m: Map<T, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    total: rows.length,
    fetchedAt: new Date().toISOString(),
    sourcePage: SOURCE_URL,
    apiUrl: API_URL,
    distinctEccn: eccnCounts.size,
    distinctHts: htsCounts.size,
    topEccn: sortDesc(eccnCounts).slice(0, 10).map(([k, v]) => ({ eccn: k, count: v })),
    topHts: sortDesc(htsCounts).slice(0, 10).map(([k, v]) => ({ hts: k, count: v })),
    states: sortDesc(stateCounts).map(([k, v]) => ({ state: k, count: v })),
    partTypes: sortDesc(typeCounts).slice(0, 10).map(([k, v]) => ({ type: k, count: v })),
  };
}

async function buildXlsx(rows: NvidiaPart[], meta: NvidiaMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } } as const;
  const headerFont = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

  const info = wb.addWorksheet("About");
  info.getCell("A1").value = "NVIDIA Export Regulation Compliance — Parts Classification";
  info.getCell("A1").font = { name: "Arial", bold: true, size: 16 };
  info.mergeCells("A1:C1");
  info.getCell("A3").value = "Source page";
  info.getCell("B3").value = { text: meta.sourcePage, hyperlink: meta.sourcePage } as any;
  info.getCell("A4").value = "Upstream API";
  info.getCell("B4").value = { text: meta.apiUrl, hyperlink: meta.apiUrl } as any;
  info.getCell("A5").value = "Snapshot time (UTC)";
  info.getCell("B5").value = meta.fetchedAt;
  info.getCell("A6").value = "Records";
  info.getCell("B6").value = meta.total;
  info.getCell("A8").value = "Field glossary";
  info.getCell("A8").font = { name: "Arial", bold: true, size: 12 };
  const glossary: [string, string][] = [
    ["part_number", "NVIDIA part number"],
    ["part_description", "Human-readable description of the part"],
    ["part_type", "Internal NVIDIA part type"],
    ["tpp", "Total Processing Power (relevant for AI accelerator export rules)"],
    ["nv_hts", "Harmonized Tariff Schedule (HTS) classification used for customs"],
    ["nveccn", "Export Control Classification Number (US EAR)"],
    ["state", "Lifecycle state (PRODUCTION / EOL / …)"],
    ["mx_legacy_Material", "Legacy material code (optional)"],
  ];
  glossary.forEach(([k, v], i) => {
    info.getCell(`A${10 + i}`).value = k;
    info.getCell(`A${10 + i}`).font = { name: "Courier New", size: 10 };
    info.getCell(`B${10 + i}`).value = v;
  });
  info.getColumn(1).width = 26;
  info.getColumn(2).width = 70;

  const ws = wb.addWorksheet("All Parts");
  const cols = [
    { header: "ID", key: "id", width: 8 },
    { header: "Part Number", key: "part_number", width: 22 },
    { header: "Description", key: "part_description", width: 45 },
    { header: "Type", key: "part_type", width: 14 },
    { header: "TPP", key: "tpp", width: 10 },
    { header: "HTS Code", key: "nv_hts", width: 12 },
    { header: "ECCN", key: "nveccn", width: 14 },
    { header: "State", key: "state", width: 14 },
    { header: "Legacy Material", key: "mx_legacy_Material", width: 16 },
  ];
  ws.columns = cols;
  ws.getRow(1).fill = headerFill;
  ws.getRow(1).font = headerFont;
  ws.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
  for (const r of rows) {
    ws.addRow({
      id: r.id,
      part_number: r.part_number,
      part_description: r.part_description,
      part_type: r.part_type === "NULL" ? "" : r.part_type ?? "",
      tpp: r.tpp === "NULL" ? "" : r.tpp ?? "",
      nv_hts: r.nv_hts ?? "",
      nveccn: r.nveccn ?? "",
      state: r.state === "NULL" ? "" : r.state ?? "",
      mx_legacy_Material: r.mx_legacy_Material ?? "",
    });
  }
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: cols.length } };

  const dist = wb.addWorksheet("ECCN Distribution");
  dist.addRow(["ECCN", "Count", "% of total"]);
  dist.getRow(1).fill = headerFill;
  dist.getRow(1).font = headerFont;
  const eccnCounts = new Map<string, number>();
  for (const r of rows) {
    const e = r.nveccn ?? "N/A";
    eccnCounts.set(e, (eccnCounts.get(e) ?? 0) + 1);
  }
  const sorted = [...eccnCounts.entries()].sort((a, b) => b[1] - a[1]);
  sorted.forEach(([eccn, n], i) => {
    dist.addRow([eccn, n, `=B${i + 2}/B$${sorted.length + 2}`]);
    dist.getCell(`C${i + 2}`).numFmt = "0.0%";
  });
  dist.addRow(["Total", { formula: `SUM(B2:B${sorted.length + 1})` } as any, ""]);
  dist.getColumn(1).width = 18;
  dist.getColumn(2).width = 10;
  dist.getColumn(3).width = 12;
  dist.views = [{ state: "frozen", ySplit: 1 }];

  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr);
}

export async function fetchNvidia(): Promise<FetchResult<NvidiaMeta>> {
  const r = await fetch(API_URL, { headers: FETCH_HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`NVIDIA API ${r.status} ${r.statusText}`);
  const rows: NvidiaPart[] = await r.json();
  if (!Array.isArray(rows)) throw new Error("Unexpected NVIDIA payload");
  const meta = buildMeta(rows);
  const xlsxBuffer = await buildXlsx(rows, meta);
  return { meta, xlsxBuffer };
}
