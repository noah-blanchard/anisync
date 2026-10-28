import type { Metadata } from "next";
import { Suspense } from "react";
import { ListSkeleton } from "@/components/list-states";
import { LibraryView } from "./library-view";

export const metadata: Metadata = { title: "Bibliothèque" };

export default function LibraryPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <LibraryView />
    </Suspense>
  );
}
