import type { Metadata } from "next";
import { PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { CHANGELOG } from "@/lib/changelog";
import { formatDate } from "@/lib/labels";

export const metadata: Metadata = { title: "Nouveautés" };

export default function ChangelogPage() {
  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeader title="Nouveautés" subtitle="L'évolution d'AniSync, version par version." />

      <ol className="flex flex-col gap-8 border-l border-border pl-5">
        {CHANGELOG.map((release, i) => (
          <li key={release.version} className="relative flex flex-col gap-2">
            <span
              aria-hidden
              className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-background ${i === 0 ? "bg-primary" : "bg-muted-foreground/50"}`}
            />
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{release.title}</h2>
              <Badge variant={i === 0 ? "default" : "secondary"} className="tabular-nums">
                v{release.version}
              </Badge>
            </div>
            <time dateTime={release.date} className="text-sm text-muted-foreground">
              {formatDate(Date.parse(release.date))}
            </time>
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-4 text-sm marker:text-muted-foreground">
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
