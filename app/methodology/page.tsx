import { MethodologyContent } from "@/components/methodology-content";
import { sourceMap } from "@/lib/data";

export default function MethodologyPage() {
  return <MethodologyContent sources={sourceMap} />;
}
