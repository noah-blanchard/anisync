import type { Metadata } from "next";
import { AddView } from "./add-view";

export const metadata: Metadata = { title: "Ajouter" };

export default function AddPage() {
  return <AddView />;
}
