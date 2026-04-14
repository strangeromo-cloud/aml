import { notFound } from "next/navigation";
import { CompanyDetail } from "@/components/company-detail";
import { assessmentFor, companies, countryMap, sourceMap } from "@/lib/data";

export function generateStaticParams() {
  return companies.map((c) => ({ id: c.id }));
}

export default function CompanyPage({ params }: { params: { id: string } }) {
  const result = assessmentFor(params.id);
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
