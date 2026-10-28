import type { Metadata } from "next";
import { getConnectionInfos } from "@/lib/connections";
import { redirectUris } from "@/lib/env";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Paramètres" };
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <SettingsView
      connections={getConnectionInfos()}
      redirectUris={redirectUris()}
      version={process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
    />
  );
}
