import { HomeContent } from "@/components/home-content";
import { allAssessments, companies, countries, sources, summaryStats, topRisky } from "@/lib/data";

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
    />
  );
}
