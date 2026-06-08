import { Router, type IRouter } from "express";
import { eq, asc, sql } from "drizzle-orm";
import {
  db,
  topicsTable,
  lecturesTable,
  assignmentsTable,
  attemptsTable,
} from "@workspace/db";
import {
  GetCourseOverviewResponse,
  GetWeekResponse,
  GetLectureResponse,
  ListTopicsResponse,
} from "@workspace/api-zod";
import { chatText } from "../lib/ai";

const router: IRouter = Router();

function expandSystemPrompt(level: "medium" | "long"): string {
  const ratio =
    level === "long"
      ? "roughly 2x to 3x the length of the SHORT version"
      : "roughly 1.5x to 2x the length of the SHORT version";
  const moreExamples =
    level === "long"
      ? "At least TWO additional fully worked examples for every concept beyond what the short version has — pick contrasting cases (edge cases, common mistakes, larger numbers, real-world framings)."
      : "At least ONE additional fully worked example for every concept beyond what the short version has.";
  const moreExplanation =
    level === "long"
      ? "Considerably more explanation: motivate every rule, explain WHY it works, name common pitfalls, and add brief 'sanity check' notes after computations."
      : "Noticeably more explanation: clarify each definition, motivate each rule, and add a short 'why this works' note where useful.";
  return (
    `You are a college quantitative-reasoning lecturer producing the ${level.toUpperCase()} version of a lecture. ` +
    "You are given the SHORT version of the lecture. Rewrite it as a longer teaching version. RULES, no exceptions:\n" +
    "1. KEEP every heading and every concept from the SHORT version, in the same order, with the same names. You may add new sub-sections only when needed to introduce additional examples — but no new top-level topics.\n" +
    `2. ${moreExplanation}\n` +
    `3. ${moreExamples} Use \`## Example\` / \`### Example 1\`, \`### Example 2\` headings, with numbered steps. Inline math \`$...$\`, display math \`$$...$$\` (escape backslashes in LaTeX commands).\n` +
    `4. Length target: ${ratio}.\n` +
    "5. Friendly, plain English. No filler, no hedging, no 'in conclusion'. Examples carry the load.\n" +
    "6. Return ONLY the rewritten Markdown lecture body. No preface, no commentary, no code fences around the whole thing."
  );
}

const WEEK_TITLES: Record<number, { title: string; summary: string }> = {
  1: {
    title: "Week 1 — Foundations",
    summary:
      "Number sense, fractions and percents, ratios, units, expressions, and linear equations.",
  },
  2: {
    title: "Week 2 — Functions and models",
    summary:
      "Lines, systems, quadratics, exponentials, logs, modeling, inequalities.",
  },
  3: {
    title: "Week 3 — Statistics and probability",
    summary:
      "Summarizing data, distributions, probability, inference, regression.",
  },
  4: {
    title: "Week 4 — Reasoning and capstone",
    summary:
      "Sets, logic, combinatorics, geometry, rates, finance, and the capstone.",
  },
};

async function buildWeek(weekNumber: number) {
  const lectures = await db
    .select({
      id: lecturesTable.id,
      title: lecturesTable.title,
      topicId: lecturesTable.topicId,
    })
    .from(lecturesTable)
    .where(eq(lecturesTable.weekNumber, weekNumber))
    .orderBy(asc(lecturesTable.id));

  const assignments = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.weekNumber, weekNumber))
    .orderBy(asc(assignmentsTable.position));

  const assignmentSummaries = await Promise.all(
    assignments.map(async (a) => {
      const counts = await db.execute(
        sql`select count(*)::int as n from problems where assignment_id = ${a.id}`,
      );
      const n = (counts.rows[0] as { n?: number } | undefined)?.n ?? 0;
      const attempts = await db
        .select()
        .from(attemptsTable)
        .where(eq(attemptsTable.assignmentId, a.id))
        .orderBy(asc(attemptsTable.id));
      const submitted = attempts.filter((x) => x.status === "submitted");
      const inProgress = attempts.find((x) => x.status === "in_progress");
      const best = submitted.reduce(
        (best, x) =>
          x.scorePercent != null && x.scorePercent > best ? x.scorePercent : best,
        -1,
      );
      const status: "not_started" | "in_progress" | "submitted" = inProgress
        ? "in_progress"
        : submitted.length > 0
        ? "submitted"
        : "not_started";
      const last = attempts[attempts.length - 1];
      return {
        id: a.id,
        kind: a.kind as "homework" | "test" | "midterm" | "final",
        title: a.title,
        weekNumber: a.weekNumber,
        problemCount: n,
        isTimed: a.isTimed,
        timeLimitMinutes: a.timeLimitMinutes,
        status,
        bestScore: best < 0 ? null : best,
        lastAttemptId: last?.id ?? null,
      };
    }),
  );

  const meta = WEEK_TITLES[weekNumber] ?? {
    title: `Week ${weekNumber}`,
    summary: "",
  };

  return {
    weekNumber,
    title: meta.title,
    summary: meta.summary,
    lectures,
    assignments: assignmentSummaries,
  };
}

router.get("/course/overview", async (_req, res) => {
  const weeks = await Promise.all([1, 2, 3, 4].map(buildWeek));
  const assignmentsTotal = weeks.reduce((s, w) => s + w.assignments.length, 0);
  const assignmentsCompleted = weeks.reduce(
    (s, w) => s + w.assignments.filter((a) => a.status === "submitted").length,
    0,
  );
  const practiceCountRow = await db.execute(
    sql`select count(*)::int as n from practice_attempts`,
  );
  const practiceCount =
    (practiceCountRow.rows[0] as { n?: number } | undefined)?.n ?? 0;

  res.json(
    GetCourseOverviewResponse.parse({
      title: "Teach Yourself Mathematical Notation",
      weeks,
      totals: { assignmentsCompleted, assignmentsTotal, practiceCount },
    }),
  );
});

router.get("/course/weeks/:weekNumber", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.weekNumber)
    ? req.params.weekNumber[0]
    : req.params.weekNumber;
  const weekNumber = parseInt(raw ?? "", 10);
  if (!Number.isFinite(weekNumber) || weekNumber < 1 || weekNumber > 4) {
    res.status(400).json({ error: "invalid weekNumber" });
    return;
  }
  const week = await buildWeek(weekNumber);
  res.json(GetWeekResponse.parse(week));
});

router.get("/course/lectures/:lectureId", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lectureId)
    ? req.params.lectureId[0]
    : req.params.lectureId;
  const lectureId = parseInt(raw ?? "", 10);
  if (!Number.isFinite(lectureId)) {
    res.status(400).json({ error: "invalid lectureId" });
    return;
  }
  const [lecture] = await db
    .select()
    .from(lecturesTable)
    .where(eq(lecturesTable.id, lectureId));
  if (!lecture) {
    res.status(404).json({ error: "lecture not found" });
    return;
  }
  res.json(GetLectureResponse.parse(lecture));
});

// On-the-spot single-lecture depth generation. Returns the cached medium/long
// body if it already exists, otherwise generates JUST this lecture immediately
// and persists it. No batch jobs, no waiting on the other 27 lectures.
router.post("/course/lectures/:lectureId/expand", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.lectureId)
    ? req.params.lectureId[0]
    : req.params.lectureId;
  const lectureId = parseInt(raw ?? "", 10);
  if (!Number.isFinite(lectureId)) {
    res.status(400).json({ error: "invalid lectureId" });
    return;
  }
  const rawLevel = String(req.query.level ?? "");
  if (rawLevel !== "medium" && rawLevel !== "long") {
    res.status(400).json({ error: "level must be 'medium' or 'long'" });
    return;
  }
  const level: "medium" | "long" = rawLevel;

  const [lecture] = await db
    .select()
    .from(lecturesTable)
    .where(eq(lecturesTable.id, lectureId));
  if (!lecture) {
    res.status(404).json({ error: "lecture not found" });
    return;
  }

  const existing = level === "long" ? lecture.bodyLong : lecture.bodyMedium;
  if (existing && existing.trim().length > 0) {
    res.json({ level, body: existing, cached: true });
    return;
  }

  try {
    const user = `LECTURE TITLE: ${lecture.title}\n\nSHORT VERSION:\n"""\n${lecture.body}\n"""`;
    const expanded = await chatText(expandSystemPrompt(level), user);
    if (!expanded || expanded.trim().length < lecture.body.length * 0.85) {
      res.status(502).json({ error: "expansion failed", level });
      return;
    }
    const body = expanded.trim();
    const patch = level === "long" ? { bodyLong: body } : { bodyMedium: body };
    await db.update(lecturesTable).set(patch).where(eq(lecturesTable.id, lectureId));
    res.json({ level, body, cached: false });
  } catch {
    res.status(502).json({ error: "expansion failed", level });
  }
});

router.get("/course/topics", async (_req, res) => {
  const rows = await db
    .select()
    .from(topicsTable)
    .orderBy(asc(topicsTable.position));
  res.json(ListTopicsResponse.parse(rows));
});

export default router;
