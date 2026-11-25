import { notFound } from "next/navigation";
import { CompanyDetail } from "@/components/company-detail";
import { assessmentFor, companies, countryMap, sourceMap } from "@/lib/data";

export function generateStaticParams() {
  return companies.map((c) => ({ id: c.id }));
}

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const result = assessmentFor((await params).id);
  if (!result) notFound();
  return (
    <CompanyDetail
      company={result.company}
      assessment={result.assessment}
      countries={countryMap}
      sources={sourceMap}
    />
  );
}
