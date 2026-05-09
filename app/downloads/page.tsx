import fs from "node:fs";
import path from "node:path";
import { DownloadsContent } from "@/components/downloads-content";

// We want this page to re-render whenever the manifest changes (i.e. every
// daily refresh deploy). Keep static for fast TTFB.
export const dynamic = "force-static";

function readManifest() {
  const p = path.join(process.cwd(), "public/downloads/_manifest.json");
  if (!fs.existsSync(p)) {
    return {
      updatedAt: null,
      totalFetchers: 0,
      successCount: 0,
      failureCount: 0,
      sources: {},
    };
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export default function DownloadsPage() {
  const manifest = readManifest();
  return <DownloadsContent manifest={manifest} />;
}
