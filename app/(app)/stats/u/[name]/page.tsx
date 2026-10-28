import type { Metadata } from "next";
import { Suspense } from "react";
import { StatsSkeleton, StatsView } from "../../stats-view";

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  return { title: `Stats de ${decodeURIComponent(name)}` };
}

/** The stats page for a public AniList profile. */
export default async function UserStatsPage({ params }: Props) {
  const { name } = await params;
  return (
    <Suspense fallback={<StatsSkeleton />}>
      <StatsView user={decodeURIComponent(name)} />
    </Suspense>
  );
}
