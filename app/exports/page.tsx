import fs from "node:fs";
import path from "node:path";
import { ExportsContent } from "@/components/exports-content";

export const dynamic = "force-static";

function readJson(p: string) {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), p), "utf8"));
}

export default function ExportsPage() {
  const nvidiaMeta = readJson("data/nvidia-eccn-meta.json");
  const amdMeta = readJson("data/amd-eccn-meta.json");
  return <ExportsContent nvidiaMeta={nvidiaMeta} amdMeta={amdMeta} />;
}
