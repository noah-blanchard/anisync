import type { Metadata } from "next";
import { Suspense } from "react";
import { WrappedView } from "@/components/stats/wrapped-view";

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  return { title: `Wrapped de ${decodeURIComponent(name)}` };
}

export default async function UserWrappedPage({ params }: Props) {
  const { name } = await params;
  return (
    <Suspense>
      <WrappedView user={decodeURIComponent(name)} />
    </Suspense>
  );
}
