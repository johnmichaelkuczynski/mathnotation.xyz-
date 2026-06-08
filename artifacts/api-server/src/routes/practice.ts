import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  topicsTable,
  practiceSessionsTable,
  practiceProblemsTable,
  practiceAttemptsTable,
  skillEventsTable,
} from "@workspace/db";
import {
  StartPracticeSessionBody,
  StartPracticeSessionResponse,
  NextPracticeProblemBody,
  NextPracticeProblemResponse,
  GradePracticeAnswerBody,
  GradePracticeAnswerResponse,
} from "@workspace/api-zod";
import { chatJson } from "../lib/ai";
import { gradeAnswer, richFeedback } from "../lib/grading";
import { getUserId } from "../lib/auth";

const router: IRouter = Router();

function parseIdParam(raw: unknown): number {
  const s = Array.isArray(raw) ? raw[0] : (raw as string);
  return parseInt(s ?? "", 10);
}

async function pickTopicId(
  weekNumber: number | null | undefined,
  preferred: number | null | undefined,
  focusOnWeaknesses: boolean,
): Promise<{ id: number; title: string; weekNumber: number }> {
  if (preferred != null) {
    const [t] = await db.select().from(topicsTable).where(eq(topicsTable.id, preferred));
    if (t) return { id: t.id, title: t.title, weekNumber: t.weekNumber };
  }
  const candidates = weekNumber
    ? await db.select().from(topicsTable).where(eq(topicsTable.weekNumber, weekNumber))
    : await db.select().from(topicsTable);

  if (focusOnWeaknesses) {
    const stats = await db.execute(sql`
      select topic_id, count(*)::int as n, avg(case when correct then 1.0 else 0.0 end) as acc
      from practice_attempts group by topic_id
    `);
    const byId = new Map<number, { n: number; acc: number }>();
    for (const r of stats.rows as Array<{ topic_id: number; n: number; acc: number }>) {
      byId.set(Number(r.topic_id), { n: Number(r.n), acc: Number(r.acc) });
    }
    // weight = (1 - accuracy) + small bonus for low-attempted topics
    const scored = candidates.map((t) => {
      const s = byId.get(t.id);
      const acc = s?.acc ?? 0.5;
      const n = s?.n ?? 0;
      const weight = (1 - acc) * 2 + (n < 3 ? 1 : 0) + Math.random() * 0.3;
      return { t, weight };
    });
    scored.sort((a, b) => b.weight - a.weight);
    const choice = scored[0]?.t ?? candidates[Math.floor(Math.random() * candidates.length)]!;
    return { id: choice.id, title: choice.title, weekNumber: choice.weekNumber };
  }
  const choice = candidates[Math.floor(Math.random() * candidates.length)]!;
  return { id: choice.id, title: choice.title, weekNumber: choice.weekNumber };
}

router.post("/practice/sessions", async (req, res): Promise<void> => {
  const parsed = StartPracticeSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { weekNumber, topicId, tutorEnabled, focusOnWeaknesses, initialDifficulty } =
    parsed.data;
  const startDifficulty =
    typeof initialDifficulty === "number" && !Number.isNaN(initialDifficulty)
      ? Math.max(1, Math.min(5, initialDifficulty))
      : 2.0;
  const [created] = await db
    .insert(practiceSessionsTable)
    .values({
      weekNumber: weekNumber ?? null,
      topicId: topicId ?? null,
      tutorEnabled,
      focusOnWeaknesses: focusOnWeaknesses ?? true,
      difficulty: startDifficulty,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "failed" });
    return;
  }
  res.json(
    StartPracticeSessionResponse.parse({
      id: created.id,
      tutorEnabled: created.tutorEnabled,
      difficulty: created.difficulty,
      weekNumber: created.weekNumber,
      topicId: created.topicId,
      focusOnWeaknesses: created.focusOnWeaknesses,
    }),
  );
});

router.post("/practice/sessions/:sessionId/next", async (req, res): Promise<void> => {
  const sessionId = parseIdParam(req.params.sessionId);
  const parsed = NextPracticeProblemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [session] = await db
    .select()
    .from(practiceSessionsTable)
    .where(eq(practiceSessionsTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }

  const topic = await pickTopicId(
    session.weekNumber,
    parsed.data.topicId ?? session.topicId,
    session.focusOnWeaknesses,
  );

  const lastProblems = await db
    .select({ prompt: practiceProblemsTable.prompt })
    .from(practiceProblemsTable)
    .where(
      and(
        eq(practiceProblemsTable.sessionId, sessionId),
        eq(practiceProblemsTable.topicId, topic.id),
      ),
    )
    .orderBy(desc(practiceProblemsTable.id))
    .limit(3);

  const difficulty = Math.max(1, Math.min(5, session.difficulty));
  const difficultyLabel =
    difficulty <= 1.7
      ? "very easy"
      : difficulty <= 2.5
      ? "easy"
      : difficulty <= 3.3
      ? "medium"
      : difficulty <= 4.1
      ? "hard"
      : "challenging";

  const userRequest = parsed.data.request?.trim() || "";
  let generated: { prompt: string; correctAnswer: string; explanation: string };
  try {
    generated = await chatJson<{
      prompt: string;
      correctAnswer: string;
      explanation: string;
    }>(
      `You generate a single quantitative-reasoning practice problem for a college freshman. The problem MUST be on the topic "${topic.title}" and at difficulty "${difficultyLabel}" (${difficulty.toFixed(
        1,
      )}/5). Use $...$ for inline LaTeX where helpful. The answer must be a short string (a number, fraction, expression, or short word) — never multi-paragraph. Respond as strict JSON: {"prompt": string, "correctAnswer": string, "explanation": string}. Avoid these recent prompts: ${JSON.stringify(
        lastProblems.map((p) => p.prompt),
      )}.`,
      userRequest || `Generate a new ${difficultyLabel} problem on ${topic.title}.`,
    );
  } catch {
    generated = {
      prompt: `Practice (${topic.title}): If $x + ${Math.round(
        difficulty * 3,
      )} = ${Math.round(difficulty * 7)}$, what is $x$?`,
      correctAnswer: String(Math.round(difficulty * 7) - Math.round(difficulty * 3)),
      explanation: "Subtract from both sides.",
    };
  }

  const [stored] = await db
    .insert(practiceProblemsTable)
    .values({
      sessionId,
      topicId: topic.id,
      prompt: generated.prompt,
      correctAnswer: generated.correctAnswer,
      explanation: generated.explanation,
      difficulty,
    })
    .returning();
  if (!stored) {
    res.status(500).json({ error: "failed" });
    return;
  }

  res.json(
    NextPracticeProblemResponse.parse({
      id: stored.id,
      prompt: stored.prompt,
      topicId: topic.id,
      topicTitle: topic.title,
      difficulty,
    }),
  );
});

router.post("/practice/sessions/:sessionId/grade", async (req, res): Promise<void> => {
  const sessionId = parseIdParam(req.params.sessionId);
  const parsed = GradePracticeAnswerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { problemId, answer, trace } = parsed.data;
  const [session] = await db
    .select()
    .from(practiceSessionsTable)
    .where(eq(practiceSessionsTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  const [problem] = await db
    .select()
    .from(practiceProblemsTable)
    .where(
      and(
        eq(practiceProblemsTable.id, problemId),
        eq(practiceProblemsTable.sessionId, sessionId),
      ),
    );
  if (!problem) {
    res.status(404).json({ error: "problem not found in this session" });
    return;
  }

  const graded = await gradeAnswer({
    prompt: problem.prompt,
    correctAnswer: problem.correctAnswer,
    userAnswer: answer,
  });

  await db.insert(practiceAttemptsTable).values({
    sessionId,
    problemId,
    topicId: problem.topicId,
    answer,
    correct: graded.correct,
    difficulty: problem.difficulty,
    trace,
  });

  await db.insert(skillEventsTable).values({
    userId: getUserId(req),
    topicId: problem.topicId,
    source: "practice",
    correct: graded.correct,
    difficulty: problem.difficulty,
    prompt: problem.prompt,
    studentAnswer: answer,
  });

  const delta = graded.correct ? 0.4 : -0.5;
  const newDifficulty = Math.max(1, Math.min(5, session.difficulty + delta));
  await db
    .update(practiceSessionsTable)
    .set({ difficulty: newDifficulty })
    .where(eq(practiceSessionsTable.id, sessionId));

  let tutorTip: string | null = null;
  if (session.tutorEnabled && !graded.correct) {
    try {
      tutorTip = (
        await chatJson<{ tip: string }>(
          "You are a kind, concise math tutor. Given a problem, the correct answer, and the student's wrong attempt, give ONE focused next-step tip (2 sentences max). Respond as strict JSON: {\"tip\": string}.",
          JSON.stringify({
            prompt: problem.prompt,
            correctAnswer: problem.correctAnswer,
            studentAnswer: answer,
          }),
        )
      ).tip;
    } catch {
      tutorTip = null;
    }
  }

  res.json(
    GradePracticeAnswerResponse.parse({
      problemId,
      correct: graded.correct,
      correctAnswer: problem.correctAnswer,
      explanation: graded.explanation || problem.explanation,
      newDifficulty,
      tutorTip,
    }),
  );
});

// Submit a full practice-assignment run: grade every problem, attach HEAVY
// per-question feedback, log everything to the evolving profile, and return a
// coach summary with surgical next steps drawn from this run.
router.post("/practice/assignment/:sessionId/submit", async (req, res): Promise<void> => {
  const sessionId = parseIdParam(req.params.sessionId);
  const body = req.body as {
    answers?: Array<{ problemId?: unknown; answer?: unknown; trace?: unknown }>;
  };
  const submitted = Array.isArray(body.answers) ? body.answers : [];
  const answerByProblem = new Map<number, { answer: string; trace: unknown }>();
  for (const a of submitted) {
    const pid = Number(a?.problemId);
    if (Number.isFinite(pid)) {
      answerByProblem.set(pid, {
        answer: typeof a?.answer === "string" ? a.answer : "",
        trace: a?.trace ?? null,
      });
    }
  }

  const [session] = await db
    .select()
    .from(practiceSessionsTable)
    .where(eq(practiceSessionsTable.id, sessionId));
  if (!session) {
    res.status(404).json({ error: "session not found" });
    return;
  }
  if (session.mode !== "assignment") {
    res.status(400).json({ error: "not an assignment practice session" });
    return;
  }
  if (session.submittedAt) {
    res.status(409).json({ error: "this practice attempt was already submitted" });
    return;
  }

  const problems = await db
    .select()
    .from(practiceProblemsTable)
    .where(eq(practiceProblemsTable.sessionId, sessionId))
    .orderBy(asc(practiceProblemsTable.id));
  if (problems.length === 0) {
    res.status(400).json({ error: "no problems in this session" });
    return;
  }

  const topics = await db.select().from(topicsTable);
  const topicTitleById = new Map(topics.map((t) => [t.id, t.title]));
  const userId = getUserId(req);

  // Grade + generate rich feedback with limited concurrency.
  const results: Array<{
    problemId: number;
    prompt: string;
    topicId: number;
    topicTitle: string | null;
    userAnswer: string;
    correct: boolean;
    correctAnswer: string;
    feedback: Awaited<ReturnType<typeof richFeedback>>;
  }> = [];
  const concurrency = 3;
  for (let i = 0; i < problems.length; i += concurrency) {
    const batch = problems.slice(i, i + concurrency);
    const graded = await Promise.all(
      batch.map(async (p) => {
        const sub = answerByProblem.get(p.id);
        const userAnswer = sub?.answer ?? "";
        const topicTitle = topicTitleById.get(p.topicId) ?? null;
        const g = await gradeAnswer({
          prompt: p.prompt,
          correctAnswer: p.correctAnswer,
          userAnswer,
        });
        const fb = await richFeedback({
          prompt: p.prompt,
          correctAnswer: p.correctAnswer,
          userAnswer,
          correct: g.correct,
          topicTitle: topicTitle ?? undefined,
          explanation: g.explanation || p.explanation,
        });
        return {
          problem: p,
          userAnswer,
          topicTitle,
          correct: g.correct,
          feedback: fb,
          trace: sub?.trace ?? null,
        };
      }),
    );
    for (const r of graded) {
      await db.insert(practiceAttemptsTable).values({
        sessionId,
        problemId: r.problem.id,
        topicId: r.problem.topicId,
        answer: r.userAnswer,
        correct: r.correct,
        difficulty: r.problem.difficulty,
        feedback: r.feedback,
        trace: r.trace,
      });
      await db.insert(skillEventsTable).values({
        userId,
        topicId: r.problem.topicId,
        source: "practice_assignment",
        assignmentId: session.assignmentId ?? null,
        correct: r.correct,
        difficulty: r.problem.difficulty,
        prompt: r.problem.prompt,
        studentAnswer: r.userAnswer,
      });
      results.push({
        problemId: r.problem.id,
        prompt: r.problem.prompt,
        topicId: r.problem.topicId,
        topicTitle: r.topicTitle,
        userAnswer: r.userAnswer,
        correct: r.correct,
        correctAnswer: r.problem.correctAnswer,
        feedback: r.feedback,
      });
    }
  }

  const score = results.filter((r) => r.correct).length;
  const total = results.length;
  const percent = total === 0 ? 0 : (score / total) * 100;

  await db
    .update(practiceSessionsTable)
    .set({ submittedAt: new Date(), scorePercent: percent })
    .where(eq(practiceSessionsTable.id, sessionId));

  // Coach summary grounded in THIS run's wrong answers.
  const wrong = results.filter((r) => !r.correct);
  let coachSummary = "";
  let nextSteps: string[] = [];
  try {
    const out = await chatJson<{ summary: string; nextSteps: string[] }>(
      "You are a math-notation coach. The student just finished a PRACTICE assignment. Given their per-problem results, write a short, direct, encouraging summary (3-5 sentences) that names their specific weak spots by topic and what pattern of mistakes you see, then list concrete next steps. Use $...$ for any math. Strict JSON: {\"summary\": string, \"nextSteps\": string[]}.",
      JSON.stringify({
        score,
        total,
        percent: Number(percent.toFixed(1)),
        wrongTopics: Array.from(new Set(wrong.map((w) => w.topicTitle).filter(Boolean))),
        wrong: wrong.map((w) => ({
          topic: w.topicTitle,
          prompt: w.prompt,
          yourAnswer: w.userAnswer,
          correctAnswer: w.correctAnswer,
        })),
      }),
    );
    coachSummary = out.summary ?? "";
    nextSteps = Array.isArray(out.nextSteps) ? out.nextSteps.slice(0, 6) : [];
  } catch {
    coachSummary =
      total === score
        ? "Clean sweep — every answer correct. You're ready to take this one for real."
        : `You got ${score}/${total}. Focus your review on the topics you missed before attempting the graded version.`;
    nextSteps = Array.from(new Set(wrong.map((w) => w.topicTitle).filter(Boolean))).map(
      (t) => `Run more practice on ${t}.`,
    );
  }

  res.json({
    sessionId,
    assignmentId: session.assignmentId ?? null,
    score,
    total,
    percent,
    coachSummary,
    nextSteps,
    perProblem: results,
  });
});

export default router;
