import type { Metadata } from "next";
import { RestoreView } from "@/components/restore-view";

export const metadata: Metadata = { title: "Restaurer ma liste" };
export const dynamic = "force-dynamic";

export default function RestorePage() {
  return <RestoreView />;
}
