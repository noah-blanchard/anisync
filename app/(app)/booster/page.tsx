import type { Metadata } from "next";
import { CatalogView } from "./catalog-view";

export const metadata: Metadata = { title: "Boosters" };

export default function BoostersPage() {
  return <CatalogView />;
}
