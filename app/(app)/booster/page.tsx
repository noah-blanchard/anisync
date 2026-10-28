import type { Metadata } from "next";
import { BoosterView } from "./booster-view";

export const metadata: Metadata = { title: "Booster" };

export default function BoosterPage() {
  return <BoosterView />;
}
