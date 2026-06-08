import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  assignmentsTable,
  problemsTable,
  attemptsTable,
  answersTable,
  topicsTable,
  practiceSessionsTable,
  practiceProblemsTable,
  skillEventsTable,
} from "@workspace/db";
import {
  GetAssignmentResponse,
  ListAssignmentsResponse,
  SaveAnswerBody,
  StartAssignmentAttemptResponse,
  GetAttemptResponse,
  SubmitAttemptResponse,
} from "@workspace/api-zod";
import { gradeAnswer } from "../lib/grading";
import { detect } from "../lib/detection";
import { chatJson } from "../lib/ai";
import { getUserId } from "../lib/auth";

const router: IRouter = Router();

function parseIdParam(raw: unknown): number {
  const s = Array.isArray(raw) ? raw[0] : (raw as string);
  return parseInt(s ?? "", 10);
}

router.get("/assignments", async (_req, res) => {
  const rows = await db
    .select()
    .from(assignmentsTable)
    .orderBy(asc(assignmentsTable.weekNumber), asc(assignmentsTable.position));
  const result = await Promise.all(
    rows.map(async (a) => {
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
        (b, x) => (x.scorePercent != null && x.scorePercent > b ? x.scorePercent : b),
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
  res.json(ListAssignmentsResponse.parse(result));
});

router.get("/assignments/:assignmentId", async (req, res): Promise<void> => {
  const id = parseIdParam(req.params.assignmentId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [a] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, id));
  if (!a) {
    res.status(404).json({ error: "not found" });
    return;
  }
  const problems = await db
    .select({
      id: problemsTable.id,
      position: problemsTable.position,
      prompt: problemsTable.prompt,
      topicId: problemsTable.topicId,
      topicTitle: topicsTable.title,
      hint: problemsTable.hint,
    })
    .from(problemsTable)
    .leftJoin(topicsTable, eq(problemsTable.topicId, topicsTable.id))
    .where(eq(problemsTable.assignmentId, id))
    .orderBy(asc(problemsTable.position));
  res.json(
    GetAssignmentResponse.parse({
      id: a.id,
      kind: a.kind as "homework" | "test" | "midterm" | "final",
      title: a.title,
      weekNumber: a.weekNumber,
      isTimed: a.isTimed,
      timeLimitMinutes: a.timeLimitMinutes,
      instructions: a.instructions,
      problems,
    }),
  );
});

async function loadAttempt(attemptId: number) {
  const [attempt] = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.id, attemptId));
  if (!attempt) return null;
  const answers = await db
    .select()
    .from(answersTable)
    .where(eq(answersTable.attemptId, attemptId));
  return {
    id: attempt.id,
    assignmentId: attempt.assignmentId,
    status: attempt.status as "in_progress" | "submitted",
    startedAt: attempt.startedAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    deadlineAt: attempt.deadlineAt?.toISOString() ?? null,
    answers: answers.map((x) => ({
      problemId: x.problemId,
      answer: x.answer,
      keystrokeCount: x.keystrokeCount,
      eraseCount: x.eraseCount,
    })),
  };
}

router.post("/assignments/:assignmentId/start", async (req, res): Promise<void> => {
  const id = parseIdParam(req.params.assignmentId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [a] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, id));
  if (!a) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }

  // Resume any in-progress attempt
  const [existing] = await db
    .select()
    .from(attemptsTable)
    .where(and(eq(attemptsTable.assignmentId, id), eq(attemptsTable.status, "in_progress")));
  if (existing) {
    const state = await loadAttempt(existing.id);
    res.json(StartAssignmentAttemptResponse.parse(state));
    return;
  }

  const deadlineAt =
    a.isTimed && a.timeLimitMinutes
      ? new Date(Date.now() + a.timeLimitMinutes * 60_000)
      : null;
  const [created] = await db
    .insert(attemptsTable)
    .values({ assignmentId: id, status: "in_progress", deadlineAt })
    .returning();
  if (!created) {
    res.status(500).json({ error: "failed to create" });
    return;
  }
  const state = await loadAttempt(created.id);
  res.json(StartAssignmentAttemptResponse.parse(state));
});

router.get("/assignments/attempts/:attemptId", async (req, res): Promise<void> => {
  const id = parseIdParam(req.params.attemptId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const state = await loadAttempt(id);
  if (!state) {
    res.status(404).json({ error: "attempt not found" });
    return;
  }
  res.json(GetAttemptResponse.parse(state));
});

router.put("/assignments/attempts/:attemptId/answer", async (req, res): Promise<void> => {
  const id = parseIdParam(req.params.attemptId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const parsed = SaveAnswerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { problemId, answer, trace } = parsed.data;

  const [attempt] = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.id, id));
  if (!attempt) {
    res.status(404).json({ error: "attempt not found" });
    return;
  }
  if (attempt.status !== "in_progress") {
    res.status(400).json({ error: "attempt already submitted" });
    return;
  }
  if (attempt.deadlineAt && new Date() > attempt.deadlineAt) {
    res.status(403).json({ error: "time limit exceeded" });
    return;
  }

  const [existing] = await db
    .select()
    .from(answersTable)
    .where(and(eq(answersTable.attemptId, id), eq(answersTable.problemId, problemId)));

  const values = {
    attemptId: id,
    problemId,
    answer,
    keystrokeCount: trace.keystrokeCount,
    eraseCount: trace.eraseCount,
    bulkInsertCount: trace.bulkInsertCount ?? 0,
    longestBulkInsertChars: trace.longestBulkInsertChars ?? 0,
    rewriteSegments: trace.rewriteSegments ?? 0,
    durationMs: trace.durationMs,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(answersTable).set(values).where(eq(answersTable.id, existing.id));
  } else {
    await db.insert(answersTable).values(values);
  }
  res.json({ ok: true });
});

router.post("/assignments/attempts/:attemptId/submit", async (req, res): Promise<void> => {
  const id = parseIdParam(req.params.attemptId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [attempt] = await db
    .select()
    .from(attemptsTable)
    .where(eq(attemptsTable.id, id));
  if (!attempt) {
    res.status(404).json({ error: "attempt not found" });
    return;
  }
  const problems = await db
    .select()
    .from(problemsTable)
    .where(eq(problemsTable.assignmentId, attempt.assignmentId))
    .orderBy(asc(problemsTable.position));
  const answers = await db
    .select()
    .from(answersTable)
    .where(eq(answersTable.attemptId, id));
  const byProblem = new Map(answers.map((a) => [a.problemId, a]));

  const perProblem = [];
  const detection = [];
  let score = 0;
  for (const p of problems) {
    const a = byProblem.get(p.id);
    const userAnswer = a?.answer ?? "";
    const graded = await gradeAnswer({
      prompt: p.prompt,
      correctAnswer: p.correctAnswer,
      userAnswer,
    });
    if (graded.correct) score += 1;
    perProblem.push({
      problemId: p.id,
      correct: graded.correct,
      userAnswer,
      correctAnswer: p.correctAnswer,
      explanation: graded.explanation || p.explanation,
    });

    let flagged = false;
    if (a && userAnswer.trim().length > 0) {
      const det = await detect(userAnswer, {
        keystrokeCount: a.keystrokeCount,
        eraseCount: a.eraseCount,
        bulkInsertCount: a.bulkInsertCount,
        longestBulkInsertChars: a.longestBulkInsertChars,
        rewriteSegments: a.rewriteSegments,
        durationMs: a.durationMs,
      });
      flagged = Boolean(det.aiFlagged || det.diachronicFlagged);
      detection.push({ problemId: p.id, ...det });
      await db
        .update(answersTable)
        .set({
          correct: graded.correct,
          aiScore: det.aiScore,
          aiFlagged: det.aiFlagged,
          diachronicScore: det.diachronicScore,
          diachronicFlagged: det.diachronicFlagged,
          detectionRationale: det.rationale,
        })
        .where(eq(answersTable.id, a.id));
    } else if (a) {
      await db
        .update(answersTable)
        .set({ correct: graded.correct })
        .where(eq(answersTable.id, a.id));
    }

    await db.insert(skillEventsTable).values({
      userId: getUserId(req),
      topicId: p.topicId,
      source: "graded",
      assignmentId: attempt.assignmentId,
      correct: graded.correct,
      flagged,
      prompt: p.prompt,
      studentAnswer: userAnswer,
    });
  }

  const total = problems.length;
  const percent = total === 0 ? 0 : (score / total) * 100;
  await db
    .update(attemptsTable)
    .set({
      status: "submitted",
      submittedAt: new Date(),
      scorePercent: percent,
    })
    .where(eq(attemptsTable.id, id));

  res.json(
    SubmitAttemptResponse.parse({
      attemptId: id,
      score,
      total,
      percent,
      perProblem,
      detection,
    }),
  );
});

// Generate a fresh, infinite practice TWIN of a graded assignment: a new
// problem set covering the same topics and difficulty as the real one, but with
// brand-new problems each call. The tutor stays enabled for practice runs.
router.post("/assignments/:assignmentId/practice", async (req, res): Promise<void> => {
  const id = parseIdParam(req.params.assignmentId);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  const [a] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, id));
  if (!a) {
    res.status(404).json({ error: "assignment not found" });
    return;
  }
  const blueprint = await db
    .select({
      id: problemsTable.id,
      position: problemsTable.position,
      prompt: problemsTable.prompt,
      correctAnswer: problemsTable.correctAnswer,
      topicId: problemsTable.topicId,
      topicTitle: topicsTable.title,
    })
    .from(problemsTable)
    .leftJoin(topicsTable, eq(problemsTable.topicId, topicsTable.id))
    .where(eq(problemsTable.assignmentId, id))
    .orderBy(asc(problemsTable.position));
  if (blueprint.length === 0) {
    res.status(400).json({ error: "assignment has no problems" });
    return;
  }

  const [session] = await db
    .insert(practiceSessionsTable)
    .values({
      mode: "assignment",
      assignmentId: id,
      weekNumber: a.weekNumber,
      tutorEnabled: true,
      focusOnWeaknesses: false,
      difficulty: 3.0,
    })
    .returning();
  if (!session) {
    res.status(500).json({ error: "failed to create practice session" });
    return;
  }

  const sys =
    "You write a single FRESH practice problem that mirrors a reference problem from a math-notation course. " +
    "It must test the SAME concept and notation/symbol and be of similar difficulty, but use different numbers/wording — never copy the reference. " +
    "The student must have to TYPE the relevant mathematical symbol(s) in their answer. Use $...$ for inline LaTeX. " +
    'The answer must be a short string (number, fraction, expression, or short symbolic answer) — never multi-paragraph. Strict JSON: {"prompt": string, "correctAnswer": string, "explanation": string}.';

  const concurrency = 3;
  const generated: Array<{
    topicId: number;
    prompt: string;
    correctAnswer: string;
    explanation: string;
    position: number;
  }> = [];
  for (let i = 0; i < blueprint.length; i += concurrency) {
    const batch = blueprint.slice(i, i + concurrency);
    const out = await Promise.all(
      batch.map(async (p) => {
        try {
          const g = await chatJson<{
            prompt: string;
            correctAnswer: string;
            explanation: string;
          }>(
            sys,
            JSON.stringify({
              topic: p.topicTitle,
              referenceProblem: p.prompt,
              referenceAnswer: p.correctAnswer,
            }),
          );
          return {
            topicId: p.topicId,
            prompt: g.prompt,
            correctAnswer: g.correctAnswer,
            explanation: g.explanation,
            position: p.position,
          };
        } catch {
          return {
            topicId: p.topicId,
            prompt: p.prompt,
            correctAnswer: p.correctAnswer,
            explanation: "Practice variant.",
            position: p.position,
          };
        }
      }),
    );
    generated.push(...out);
  }
  generated.sort((x, y) => x.position - y.position);

  const stored = await db
    .insert(practiceProblemsTable)
    .values(
      generated.map((g) => ({
        sessionId: session.id,
        topicId: g.topicId,
        prompt: g.prompt,
        correctAnswer: g.correctAnswer,
        explanation: g.explanation,
        difficulty: 3.0,
      })),
    )
    .returning();

  const topicTitleById = new Map(blueprint.map((b) => [b.topicId, b.topicTitle]));
  res.json({
    sessionId: session.id,
    assignmentId: id,
    title: a.title,
    kind: a.kind,
    weekNumber: a.weekNumber,
    instructions: a.instructions,
    problems: stored.map((p, idx) => ({
      id: p.id,
      position: idx + 1,
      prompt: p.prompt,
      topicId: p.topicId,
      topicTitle: topicTitleById.get(p.topicId) ?? null,
    })),
  });
});

export default router;
