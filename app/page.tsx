import fs from "node:fs";
import path from "node:path";
import { HomeContent } from "@/components/home-content";
import { allAssessments, companies, countries, sources, summaryStats, topRisky } from "@/lib/data";

function readNvidiaExportTotal(): number | undefined {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), "data/nvidia-eccn-meta.json"),
      "utf8",
    );
    return JSON.parse(raw).total as number;
  } catch {
    return undefined;
  }
}

export default function HomePage() {
  const top10 = topRisky(10);
  const stats = summaryStats();
  return (
    <HomeContent
      companies={companies}
      countries={countries}
      sources={sources}
      top10={top10}
      allAssessments={allAssessments()}
      stats={stats}
      nvidiaExportTotal={readNvidiaExportTotal()}
    />
  );
}
