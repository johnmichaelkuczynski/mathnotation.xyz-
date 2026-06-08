import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, lecturesTable } from "@workspace/db";
import { AskTutorBody, AskTutorResponse } from "@workspace/api-zod";
import { chatText, chatJson, chatMessages, FAST_MODEL, type ChatMessage } from "../lib/ai";

const router: IRouter = Router();

router.get("/tutor/suggestions/:lectureId", async (req, res): Promise<void> => {
  const lectureId = Number(req.params.lectureId);
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

  try {
    const out = await chatJson<{ questions: string[] }>(
      'You are an encouraging college quantitative-reasoning tutor. Reply as strict JSON of the form {"questions": string[]} with NO other keys.',
      `From the lecture below, generate 6 short, concrete starter questions a student might want to ask after reading it. Cover every major idea in the reading (not just the first one). Each question must be one sentence, under ~18 words, in the student's voice (e.g. "Why does ...?", "Can you show me ...?", "What's the difference between ...?").\n\nMATH NOTATION RULES (strict):\n- ANY math symbol, variable, formula, or expression — including simple ones like $E$, $mc^2$, $\\pi$, $x^2$, $\\Delta S \\ge 0$ — MUST be wrapped in $...$ (LaTeX inline math).\n- NEVER write raw exponents like mc^2, x^2, or H_2O. ALWAYS wrap: $mc^2$, $x^2$, $H_2O$.\n- Greek letters and special symbols (\\pi, \\sigma, \\Delta, \\equiv, \\approx, \\sum, \\int, \\to, \\forall, \\in, \\mathbb{R}, ...) MUST be inside $...$.\n- Plain English words ("identity", "limit", "set") stay outside the math delimiters.\n\nLECTURE TITLE: ${lecture.title}\n\nLECTURE BODY:\n"""\n${lecture.body}\n"""`,
      FAST_MODEL,
    );
    const questions = Array.isArray(out?.questions)
      ? out.questions.filter((q) => typeof q === "string" && q.trim().length > 0).slice(0, 8)
      : [];
    res.json({ questions });
  } catch {
    res.json({ questions: [] });
  }
});

router.post("/tutor/ask", async (req, res): Promise<void> => {
  const parsed = AskTutorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { message, selectedLectureText } = parsed.data;

  const sys =
    "You are an encouraging college quantitative-reasoning tutor. Explain step by step, prefer concrete numbers, and write inline math as $...$ (LaTeX). Keep replies short (3-6 sentences) unless the student asks for more detail. By default, guide rather than hand over the answer — BUT if the student explicitly asks you to 'just give the answer', 'show me the answer', 'tell me the answer', or otherwise asks for a direct answer, then give the complete, correct answer plainly without Socratic dodging.";
  const user = selectedLectureText
    ? `Context from the lecture the student is reading:\n"""\n${selectedLectureText}\n"""\n\nStudent question: ${message}`
    : message;

  let text = "";
  try {
    text = await chatText(sys, user);
  } catch {
    text =
      "I'm having trouble reaching the tutor service right now. Try again in a moment, and consider re-reading the relevant section of the lecture.";
  }
  res.json(AskTutorResponse.parse({ text, audioUrl: null }));
});

// Dialogue ABOUT a specific piece of feedback the student just received.
// Grounded in the exact problem, the correct answer, the student's answer, and
// the feedback already shown — so follow-ups stay on-topic and multi-turn.
router.post("/tutor/feedback", async (req, res): Promise<void> => {
  const body = req.body as {
    problemPrompt?: unknown;
    correctAnswer?: unknown;
    studentAnswer?: unknown;
    feedback?: unknown;
    history?: unknown;
    message?: unknown;
  };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

  const sys =
    "You are an encouraging college math-notation tutor in a back-and-forth conversation with a student about feedback they just received on a practice problem. " +
    "You already know the problem, the correct answer, the student's answer, and the feedback that was shown. Answer the student's follow-up questions directly and concretely. " +
    "Write all math as LaTeX inline `$...$` or display `$$...$$`. Keep replies focused (3-7 sentences) unless asked for more. If the student disagrees with the grading or feedback, engage honestly: explain your reasoning, and concede if they are right.";

  const context =
    "Here is the problem and feedback under discussion:\n" +
    `PROBLEM: ${str(body.problemPrompt)}\n` +
    `CORRECT ANSWER: ${str(body.correctAnswer)}\n` +
    `STUDENT'S ANSWER: ${str(body.studentAnswer)}\n` +
    `FEEDBACK ALREADY SHOWN: ${str(body.feedback)}`;

  const history: ChatMessage[] = Array.isArray(body.history)
    ? (body.history as Array<{ role?: unknown; content?: unknown }>)
        .filter(
          (m) =>
            (m?.role === "user" || m?.role === "assistant") &&
            typeof m?.content === "string" &&
            m.content.trim().length > 0,
        )
        .slice(-10)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }))
    : [];

  const messages: ChatMessage[] = [
    { role: "system", content: sys },
    { role: "user", content: context },
    { role: "assistant", content: "Got it — I have the problem and the feedback in front of me. What would you like to dig into?" },
    ...history,
    { role: "user", content: message },
  ];

  let text = "";
  try {
    text = await chatMessages(messages);
  } catch {
    text = "I'm having trouble reaching the tutor right now. Try again in a moment.";
  }
  res.json({ text });
});

export default router;
