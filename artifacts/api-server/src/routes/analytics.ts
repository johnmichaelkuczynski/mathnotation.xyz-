import { Router, type IRouter } from "express";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  topicsTable,
  attemptsTable,
  practiceAttemptsTable,
  assignmentsTable,
  problemsTable,
} from "@workspace/db";
import {
  GetAnalyticsSummaryResponse,
  GetTopicAnalyticsResponse,
  GetRecentActivityResponse,
  GenerateReportResponse,
} from "@workspace/api-zod";
import { chatJson } from "../lib/ai";

const router: IRouter = Router();

type StrengthLabel = "strong" | "solid" | "developing" | "weak" | "untested";
function labelFor(accuracy: number, attempts: number): StrengthLabel {
  if (attempts === 0) return "untested";
  if (accuracy >= 0.9) return "strong";
  if (accuracy >= 0.75) return "solid";
  if (accuracy >= 0.5) return "developing";
  return "weak";
}

async function topicStats() {
  const topics = await db
    .select()
    .from(topicsTable)
    .orderBy(asc(topicsTable.position));
  const stats = await db.execute(sql`
    select topic_id, count(*)::int as n, avg(case when correct then 1.0 else 0.0 end) as acc
    from practice_attempts group by topic_id
  `);
  const byId = new Map<number, { n: number; acc: number }>();
  for (const r of stats.rows as Array<{ topic_id: number; n: number; acc: number }>) {
    byId.set(Number(r.topic_id), { n: Number(r.n), acc: Number(r.acc) });
  }
  return topics.map((t) => {
    const s = byId.get(t.id);
    const attempts = s?.n ?? 0;
    const accuracy = attempts === 0 ? 0 : s!.acc;
    return {
      topicId: t.id,
      topicTitle: t.title,
      weekNumber: t.weekNumber,
      attempts,
      accuracy: Number(accuracy.toFixed(3)),
      strengthLabel: labelFor(accuracy, attempts),
    };
  });
}

router.get("/analytics/summary", async (_req, res) => {
  const submitted = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.status, "submitted"));
  const officialAverage =
    submitted.length === 0
      ? 0
      : submitted.reduce((s, a) => s + (a.scorePercent ?? 0), 0) / submitted.length;

  const practice = await db.select().from(practiceAttemptsTable);
  const practiceCorrect = practice.filter((p) => p.correct).length;
  const practiceAccuracy =
    practice.length === 0 ? 0 : (practiceCorrect / practice.length) * 100;

  const days = new Set<string>();
  for (const p of practice) days.add(new Date(p.createdAt).toISOString().slice(0, 10));
  for (const a of submitted)
    if (a.submittedAt) days.add(new Date(a.submittedAt).toISOString().slice(0, 10));

  // streak: consecutive days ending today
  let streakDays = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) streakDays++;
    else if (i > 0) break;
  }

  const topics = await topicStats();
  const tested = topics.filter((t) => t.attempts > 0);
  tested.sort((a, b) => b.accuracy - a.accuracy);
  const strongest = tested[0]?.topicTitle ?? null;
  const weakest = tested[tested.length - 1]?.topicTitle ?? null;

  res.json(
    GetAnalyticsSummaryResponse.parse({
      officialAverage: Number(officialAverage.toFixed(2)),
      practiceAccuracy: Number(practiceAccuracy.toFixed(2)),
      attemptsCount: submitted.length,
      practiceCount: practice.length,
      streakDays,
      strongestTopic: strongest,
      weakestTopic: weakest,
    }),
  );
});

router.get("/analytics/topics", async (_req, res) => {
  const rows = await topicStats();
  res.json(GetTopicAnalyticsResponse.parse(rows));
});

router.get("/analytics/activity", async (_req, res) => {
  const recentPractice = await db
    .select({
      id: practiceAttemptsTable.id,
      createdAt: practiceAttemptsTable.createdAt,
      correct: practiceAttemptsTable.correct,
      topicId: practiceAttemptsTable.topicId,
    })
    .from(practiceAttemptsTable)
    .orderBy(desc(practiceAttemptsTable.id))
    .limit(20);
  const topics = await db.select().from(topicsTable);
  const topicById = new Map(topics.map((t) => [t.id, t.title]));

  const recentAttempts = await db
    .select({
      id: attemptsTable.id,
      submittedAt: attemptsTable.submittedAt,
      scorePercent: attemptsTable.scorePercent,
      assignmentId: attemptsTable.assignmentId,
    })
    .from(attemptsTable)
    .where(eq(attemptsTable.status, "submitted"))
    .orderBy(desc(attemptsTable.id))
    .limit(20);
  const assignments = await db.select().from(assignmentsTable);
  const aById = new Map(assignments.map((a) => [a.id, a.title]));

  const items = [
    ...recentPractice.map((p) => ({
      id: p.id,
      kind: "practice" as const,
      title: `Practice — ${topicById.get(p.topicId) ?? "Topic"}`,
      at: p.createdAt.toISOString(),
      score: p.correct ? 100 : 0,
      topicTitle: topicById.get(p.topicId) ?? null,
    })),
    ...recentAttempts.map((a) => ({
      id: a.id + 1_000_000,
      kind: "assignment" as const,
      title: aById.get(a.assignmentId) ?? "Assignment",
      at: (a.submittedAt ?? new Date()).toISOString(),
      score: a.scorePercent ?? null,
      topicTitle: null,
    })),
  ].sort((x, y) => y.at.localeCompare(x.at));

  res.json(GetRecentActivityResponse.parse(items.slice(0, 30)));
});

router.post("/analytics/report", async (_req, res) => {
  const topics = await topicStats();
  const submitted = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.status, "submitted"));
  const officialAverage =
    submitted.length === 0
      ? 0
      : submitted.reduce((s, a) => s + (a.scorePercent ?? 0), 0) / submitted.length;

  const tested = topics.filter((t) => t.attempts > 0);
  tested.sort((a, b) => a.accuracy - b.accuracy);
  const weakest = tested.slice(0, 3).map((t) => t.topicTitle);
  const strongest = tested.slice(-3).reverse().map((t) => t.topicTitle);

  let narrative = "";
  let recommendations: string[] = [];
  try {
    const out = await chatJson<{ narrative: string; recommendations: string[] }>(
      "You are an academic advisor for a college quantitative-reasoning course. Write a 2-paragraph, encouraging but honest narrative summary, then list 3 concrete next-step recommendations. Strict JSON: {\"narrative\": string, \"recommendations\": string[]}.",
      JSON.stringify({
        officialAverage,
        attempts: submitted.length,
        weakestTopics: weakest,
        strongestTopics: strongest,
        perTopic: topics,
      }),
    );
    narrative = out.narrative;
    recommendations = out.recommendations ?? [];
  } catch {
    narrative =
      tested.length === 0
        ? "You haven't accumulated enough graded work yet to draw conclusions. Try a practice session or finish a homework, then regenerate this report."
        : `You're averaging ${officialAverage.toFixed(
            1,
          )}% on official assignments. Your strongest area so far is ${
            strongest[0] ?? "n/a"
          }; your weakest is ${weakest[0] ?? "n/a"}.`;
    recommendations =
      weakest.length > 0
        ? weakest.map((w) => `Run a focused practice session on ${w}.`)
        : ["Open a homework and start with a small set of problems."];
  }

  res.json(
    GenerateReportResponse.parse({
      generatedAt: new Date().toISOString(),
      narrative,
      strengths: strongest,
      weaknesses: weakest,
      recommendations,
    }),
  );
});

// Surgically precise, numbers-grounded focus pointers built from the evolving
// profile (skill_events). Optionally scoped to a specific assignment's topics so
// the student knows exactly what to drill BEFORE attempting the graded version.
router.get("/analytics/focus", async (req, res): Promise<void> => {
  const rawA = req.query.assignmentId;
  const assignmentId =
    rawA !== undefined && rawA !== "" && Number.isFinite(Number(rawA))
      ? Number(rawA)
      : null;

  let scopeTopicIds: number[] | null = null;
  let assignmentTitle: string | null = null;
  if (assignmentId !== null) {
    const [a] = await db
      .select()
      .from(assignmentsTable)
      .where(eq(assignmentsTable.id, assignmentId));
    assignmentTitle = a?.title ?? null;
    const ps = await db
      .select({ topicId: problemsTable.topicId })
      .from(problemsTable)
      .where(eq(problemsTable.assignmentId, assignmentId));
    scopeTopicIds = Array.from(new Set(ps.map((p) => p.topicId)));
  }

  // Per-topic profile straight from the evolving skill_events stream.
  const rows = (
    await db.execute(sql`
      select topic_id,
             count(*)::int as n,
             sum(case when correct then 1 else 0 end)::int as correct_n,
             sum(case when flagged then 1 else 0 end)::int as flagged_n,
             avg(difficulty) as avg_difficulty,
             max(created_at) as last_at
      from skill_events
      group by topic_id
    `)
  ).rows as Array<{
    topic_id: number;
    n: number;
    correct_n: number;
    flagged_n: number;
    avg_difficulty: number | null;
    last_at: string | null;
  }>;
  const byTopic = new Map(rows.map((r) => [Number(r.topic_id), r]));

  const topics = await db.select().from(topicsTable).orderBy(asc(topicsTable.position));
  const inScope = topics.filter(
    (t) => scopeTopicIds === null || scopeTopicIds.includes(t.id),
  );

  const profile = inScope.map((t) => {
    const r = byTopic.get(t.id);
    const attempts = r?.n ?? 0;
    const accuracy = attempts === 0 ? 0 : (r!.correct_n ?? 0) / attempts;
    return {
      topicId: t.id,
      topicTitle: t.title,
      weekNumber: t.weekNumber,
      attempts,
      accuracy: Number(accuracy.toFixed(3)),
      flagged: r?.flagged_n ?? 0,
      avgDifficulty: r?.avg_difficulty != null ? Number(Number(r.avg_difficulty).toFixed(1)) : null,
      strengthLabel: labelFor(accuracy, attempts),
    };
  });

  // Readiness: weighted toward in-scope topics; untested topics count as risk.
  const tested = profile.filter((p) => p.attempts > 0);
  const avgAcc =
    tested.length === 0 ? 0 : tested.reduce((s, p) => s + p.accuracy, 0) / tested.length;
  const coverage = profile.length === 0 ? 0 : tested.length / profile.length;
  const readiness = Math.round(avgAcc * 70 + coverage * 30);

  const weakest = [...profile]
    .sort((a, b) => {
      if (a.attempts === 0 && b.attempts > 0) return -1;
      if (b.attempts === 0 && a.attempts > 0) return 1;
      return a.accuracy - b.accuracy;
    })
    .slice(0, 5);

  let pointers: string[] = [];
  let headline = "";
  try {
    const out = await chatJson<{ headline: string; pointers: string[] }>(
      "You are a math-notation study coach. Using the student's REAL per-topic stats, write surgically precise, specific pointers on exactly what to focus on. " +
        "Reference the actual numbers (accuracy %, attempt counts, untested topics, flagged answers). Be concrete: name the topic and the symbol family. No vague encouragement. Use $...$ for math. " +
        'Strict JSON: {"headline": string (one direct sentence on overall readiness), "pointers": string[] (3-6 specific, numbers-grounded action items, most important first)}.',
      JSON.stringify({
        assignment: assignmentTitle,
        readiness,
        perTopic: profile,
        weakestTopics: weakest,
      }),
    );
    headline = out.headline ?? "";
    pointers = Array.isArray(out.pointers) ? out.pointers.slice(0, 8) : [];
  } catch {
    headline =
      tested.length === 0
        ? "You have no practice history yet — run a practice version first so I can tell you exactly what to drill."
        : `Overall readiness ${readiness}/100. Your weakest areas are ${weakest
            .slice(0, 3)
            .map((w) => w.topicTitle)
            .join(", ")}.`;
    pointers = weakest.map((w) =>
      w.attempts === 0
        ? `You haven't practiced ${w.topicTitle} at all — start there.`
        : `${w.topicTitle}: ${Math.round(w.accuracy * 100)}% over ${w.attempts} attempts. Drill this.`,
    );
  }

  res.json({
    assignmentId,
    assignmentTitle,
    readiness,
    headline,
    pointers,
    profile,
    focusTopics: weakest.map((w) => w.topicTitle),
  });
});

export default router;
