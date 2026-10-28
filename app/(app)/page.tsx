import type { Metadata } from "next";
import { HomeView } from "./home-view";

export const metadata: Metadata = { title: "En cours" };

export default function HomePage() {
  return <HomeView />;
}
