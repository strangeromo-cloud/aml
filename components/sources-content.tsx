"use client";

import { ExternalLink } from "lucide-react";
import type { DataSource } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Card, CardBody } from "./ui";

export function SourcesContent({ sources }: { sources: DataSource[] }) {
  const { t, tl } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("sources.title")}</h1>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{t("sources.sub")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {sources.map((s) => (
          <Card key={s.id}>
            <CardBody className="space-y-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
                    {s.authority}
                  </div>
                  <div className="mt-1 font-semibold">{tl(s.name)}</div>
                </div>
                <div className="text-xs text-[hsl(var(--muted-foreground))]">
                  {t("sources.snapshot")}: {s.snapshotDate}
                </div>
              </div>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{tl(s.description)}</p>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
              >
                {t("sources.visit")}
                <ExternalLink className="h-3 w-3" />
              </a>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
