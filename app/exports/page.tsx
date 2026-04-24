import fs from "node:fs";
import path from "node:path";
import { ExportsContent } from "@/components/exports-content";

export const dynamic = "force-static";

export default function ExportsPage() {
  const root = process.cwd();
  const parts = JSON.parse(
    fs.readFileSync(path.join(root, "data/nvidia-eccn.json"), "utf8"),
  );
  const meta = JSON.parse(
    fs.readFileSync(path.join(root, "data/nvidia-eccn-meta.json"), "utf8"),
  );
  return <ExportsContent parts={parts} meta={meta} />;
}
