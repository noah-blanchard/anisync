import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/list-states";
import { HomeView } from "./home-view";

export const metadata: Metadata = { title: "En cours" };

export default function HomePage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <HomeView />
    </Suspense>
  );
}
