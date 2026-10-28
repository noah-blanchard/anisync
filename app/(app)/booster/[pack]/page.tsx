import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBooster } from "@/lib/boosters";
import { BoosterView } from "./booster-view";

export async function generateMetadata({ params }: { params: Promise<{ pack: string }> }): Promise<Metadata> {
  const booster = getBooster((await params).pack);
  return { title: booster ? `Booster ${booster.name}` : "Booster" };
}

export default async function BoosterPage({ params }: { params: Promise<{ pack: string }> }) {
  const { pack } = await params;
  if (!getBooster(pack)) notFound();
  return <BoosterView packId={pack} />;
}
