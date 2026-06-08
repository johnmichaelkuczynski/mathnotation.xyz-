import { useEffect, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, AlertTriangle } from "lucide-react";

type FocusProfileRow = {
  topicId: number;
  topicTitle: string;
  weekNumber: number;
  attempts: number;
  accuracy: number;
  flagged: number;
  avgDifficulty: number | null;
  strengthLabel: string;
};

type FocusResponse = {
  assignmentId: number | null;
  assignmentTitle: string | null;
  readiness: number;
  headline: string;
  pointers: string[];
  profile: FocusProfileRow[];
  focusTopics: string[];
};

/**
 * Surgically precise, numbers-grounded pointers built from the evolving learner
 * profile. Optionally scoped to one assignment so the student knows exactly what
 * to drill BEFORE attempting the graded version.
 */
export function FocusPointers({
  assignmentId,
  compact = false,
}: {
  assignmentId?: number;
  compact?: boolean;
}) {
  const [data, setData] = useState<FocusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    const qs =
      assignmentId !== undefined && Number.isFinite(assignmentId)
        ? `?assignmentId=${assignmentId}`
        : "";
    fetch(`/api/analytics/focus${qs}`, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load focus (${r.status})`);
        return r.json();
      })
      .then((d: FocusResponse) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assignmentId]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  const readinessColor =
    data.readiness >= 75
      ? "text-chart-2"
      : data.readiness >= 45
        ? "text-chart-4"
        : "text-destructive";

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 font-semibold">
          <Target className="w-4 h-4 text-primary" />
          {data.assignmentTitle
            ? `Before you take "${data.assignmentTitle}" for a grade`
            : "Where to focus next"}
        </div>
        <div className="text-sm">
          Readiness:{" "}
          <span className={`font-mono font-bold ${readinessColor}`}>{data.readiness}/100</span>
        </div>
      </div>

      {data.headline && (
        <div className="text-sm prose prose-sm max-w-none">
          <MarkdownRenderer content={data.headline} />
        </div>
      )}

      {data.pointers.length > 0 && (
        <ul className="list-none flex flex-col gap-1.5 text-sm">
          {data.pointers.map((p, i) => (
            <li key={i} className="flex gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-chart-4" />
              <span className="flex-1">
                <MarkdownRenderer content={p} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {!compact && data.profile.length > 0 && (
        <div className="overflow-x-auto mt-1">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="py-1 pr-3 font-medium">Topic</th>
                <th className="py-1 px-2 font-medium text-right">Attempts</th>
                <th className="py-1 px-2 font-medium text-right">Accuracy</th>
                <th className="py-1 pl-2 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.profile.map((row) => (
                <tr key={row.topicId} className="border-t border-border/50">
                  <td className="py-1 pr-3">{row.topicTitle}</td>
                  <td className="py-1 px-2 text-right">{row.attempts}</td>
                  <td className="py-1 px-2 text-right font-mono">
                    {Math.round(row.accuracy * 100)}%
                  </td>
                  <td className="py-1 pl-2 text-center">
                    <span className="uppercase tracking-wider font-semibold text-muted-foreground">
                      {row.strengthLabel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
