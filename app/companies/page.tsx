import { CompaniesList } from "@/components/companies-list";
import { companies, countries, countryMap } from "@/lib/data";
import { assessCompany } from "@/lib/scoring";

export default function CompaniesPage() {
  const rows = companies.map((c) => ({ company: c, assessment: assessCompany(c, countryMap) }));
  return <CompaniesList rows={rows} countries={countries} />;
}
