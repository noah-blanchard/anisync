import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { isAuthenticated } from "@/lib/auth";
import { getConnectionInfos } from "@/lib/connections";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthenticated())) redirect("/login");
  return <AppShell connections={getConnectionInfos()}>{children}</AppShell>;
}
