"use client";

import Link from "next/link";
import { ChevronLeft, Info } from "lucide-react";
import type { Company, Country, DataSource, RiskAssessment } from "@/lib/types";
import { useI18n } from "@/lib/i18n/context";
import { Badge, Card, CardBody, CardHeader, CardTitle, RiskBadge } from "./ui";
import { CountryFlag } from "./country-flag";
import { RiskGauge } from "./risk-gauge";
import { DimensionCard } from "./dimension-card";

type Props = {
  company: Company;
  assessment: RiskAssessment;
  countries: Record<string, Country>;
  sources: Record<string, DataSource>;
};

export function CompanyDetail({ company, assessment, countries, sources }: Props) {
  const { t, tl, locale } = useI18n();
  const hq = countries[company.hqCountry];
  const hqName = hq ? tl(hq.name) : company.hqCountry;
  const displayName = locale === "zh" && company.nameZh ? company.nameZh : company.name;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("common.backToDashboard")}
      </Link>

      {/* Header */}
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{displayName}</h1>
            <Badge variant="outline" className="font-mono">
              {company.id}
            </Badge>
            <Badge>
              {company.relationship === "customer" ? t("company.customer") : t("company.supplier")}
            </Badge>
            <Badge variant="outline">{t(`company.${company.tier}`)}</Badge>
            <RiskBadge level={assessment.riskLevel} label={t(`risk.${assessment.riskLevel}`)} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[hsl(var(--muted-foreground))]">
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag code={company.hqCountry} className="text-base" />
              {t("company.hq")}: {hqName}
            </span>
            <span>{t("company.industry")}: {company.industry}</span>
            <span>{t("company.founded")}: {company.yearEstablished}</span>
            <span>
              {t("company.annualVolume")}: {formatUsd(company.annualVolumeUsd)}
            </span>
          </div>
          {company.isReal && (
            <div className="mt-3 inline-flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("company.illustrative")}</span>
            </div>
          )}
        </div>
        <Card className="w-full max-w-xs">
          <CardBody className="flex flex-col items-center gap-2 !py-6">
            <RiskGauge score={assessment.overallScore} level={assessment.riskLevel} size={170} />
            <div className="text-sm font-medium">{t("company.overall")}</div>
            <RiskBadge level={assessment.riskLevel} label={t(`risk.${assessment.riskLevel}`)} />
          </CardBody>
        </Card>
      </div>

      {/* Dimensions */}
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t("company.dimensionsTitle")}</h2>
        <div className="space-y-3">
          {assessment.dimensions.map((d, i) => (
            <DimensionCard key={d.id} dimension={d} sources={sources} defaultOpen={i === 0} />
          ))}
        </div>
      </section>

      {/* Operations + Entities */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("company.operations")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {company.operatingCountries.map((code) => (
                <li key={code} className="flex items-center gap-2">
                  <CountryFlag code={code} className="text-base" />
                  <span className="truncate">
                    {countries[code] ? tl(countries[code].name) : code}
                  </span>
                  {countries[code]?.fatfStatus === "blacklist" && (
                    <Badge className="ml-auto bg-rose-500/15 text-rose-700 dark:text-rose-300">
                      FATF
                    </Badge>
                  )}
                  {countries[code]?.ofacComprehensive && (
                    <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">OFAC</Badge>
                  )}
                  {countries[code]?.fatfStatus === "greylist" && (
                    <Badge className="ml-auto bg-amber-500/15 text-amber-700 dark:text-amber-300">
                      Grey
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("company.subsidiaries")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {company.subsidiaries.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CountryFlag code={s.country} className="text-base" />
                  <span className="truncate">{s.name}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t("company.ubos")}</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1.5 text-sm">
              {company.ubos.map((u, i) => (
                <li key={i} className="flex items-center gap-2">
                  <CountryFlag code={u.country} className="text-base" />
                  <span className="truncate">{u.name}</span>
                  {u.pep && (
                    <Badge className="ml-auto bg-rose-500/15 text-rose-700 dark:text-rose-300">
                      {t("company.pep")}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}

function formatUsd(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}
