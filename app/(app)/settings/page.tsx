import type { Metadata } from "next";
import { renderSVG } from "uqr";
import { getConnectionInfos } from "@/lib/connections";
import { getEnv, redirectUris } from "@/lib/env";
import { SettingsView } from "./settings-view";

export const metadata: Metadata = { title: "Paramètres" };
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const appUrl = getEnv().APP_URL;
  return (
    <SettingsView
      connections={getConnectionInfos()}
      redirectUris={redirectUris()}
      appUrl={appUrl}
      qrSvg={renderSVG(appUrl, { border: 2, whiteColor: "#ffffff", blackColor: "#0b0c10" })}
      version={process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
    />
  );
}
