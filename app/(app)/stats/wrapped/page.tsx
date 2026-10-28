import type { Metadata } from "next";
import { Suspense } from "react";
import { WrappedView } from "@/components/stats/wrapped-view";

export const metadata: Metadata = { title: "Wrapped" };

export default function WrappedPage() {
  return (
    <Suspense>
      <WrappedView />
    </Suspense>
  );
}
