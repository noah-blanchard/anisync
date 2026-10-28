import type { Metadata } from "next";
import { Suspense } from "react";
import { StatsSkeleton, StatsView } from "./stats-view";

export const metadata: Metadata = { title: "Stats" };

export default function StatsPage() {
  return (
    <Suspense fallback={<StatsSkeleton />}>
      <StatsView />
    </Suspense>
  );
}
