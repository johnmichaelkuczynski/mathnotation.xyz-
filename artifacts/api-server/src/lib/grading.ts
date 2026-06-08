import { chatJson } from "./ai";

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u2212\u2010-\u2015]/g, "-")
    .replace(/[$,]/g, "")
    .replace(/[)(\[\]{}]/g, "")
    .replace(/\s*=\s*/g, "=");
}

function asNumber(s: string): number | null {
  const cleaned = s.replace(/[$,%\s]/g, "").replace(/[\u2212]/g, "-");
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return parseFloat(cleaned);
  const frac = cleaned.match(/^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (frac) {
    const n = parseFloat(frac[1]!);
    const d = parseFloat(frac[2]!);
    if (d !== 0) return n / d;
  }
  return null;
}

export async function gradeAnswer(opts: {
  prompt: string;
  correctAnswer: string;
  userAnswer: string;
}): Promise<{ correct: boolean; explanation: string }> {
  const user = opts.userAnswer ?? "";
  const correct = opts.correctAnswer ?? "";

  if (normalize(user) === normalize(correct)) {
    return {
      correct: true,
      explanation: `Correct. ${correct}`,
    };
  }

  const u = asNumber(user);
  const c = asNumber(correct);
  if (u != null && c != null) {
    const tol = Math.max(0.01, Math.abs(c) * 0.01);
    if (Math.abs(u - c) <= tol) {
      return { correct: true, explanation: `Correct. The expected answer is ${correct}.` };
    }
  }

  try {
    const out = await chatJson<{ correct: boolean; explanation: string }>(
      "You grade short quantitative-reasoning answers. Decide if the student's answer is mathematically equivalent to the correct answer (accept equivalent forms like 1/2 and 0.5, simplified fractions, equivalent algebraic expressions, units treated reasonably). Output strict JSON {\"correct\": boolean, \"explanation\": string} where explanation is 1-3 short sentences and includes the correct answer.",
      JSON.stringify({
        prompt: opts.prompt,
        correct_answer: correct,
        student_answer: user,
      }),
    );
    return {
      correct: !!out.correct,
      explanation: out.explanation || `The correct answer is ${correct}.`,
    };
  } catch {
    return {
      correct: false,
      explanation: `The correct answer is ${correct}.`,
    };
  }
}

export type RichFeedback = {
  verdict: string;
  whatYouDid: string;
  whyRightWrong: string;
  theConcept: string;
  symbolNote: string;
  commonMistakes: string[];
  workedSolution: string;
  studyNext: string[];
};

// Heavy, structured per-question feedback used on practice work. Always returns
// something usable even if the model call fails.
export async function richFeedback(opts: {
  prompt: string;
  correctAnswer: string;
  userAnswer: string;
  correct: boolean;
  topicTitle?: string;
  explanation?: string;
}): Promise<RichFeedback> {
  const fallback: RichFeedback = {
    verdict: opts.correct ? "Correct." : "Not quite.",
    whatYouDid: opts.userAnswer.trim()
      ? `You answered: ${opts.userAnswer}`
      : "You left this blank.",
    whyRightWrong: opts.correct
      ? "Your answer matches the expected result."
      : `The expected answer is ${opts.correctAnswer}.`,
    theConcept: opts.explanation || "",
    symbolNote: "",
    commonMistakes: [],
    workedSolution: opts.explanation || `The correct answer is ${opts.correctAnswer}.`,
    studyNext: opts.correct ? [] : [opts.topicTitle ? `Review ${opts.topicTitle}.` : "Review this topic."],
  };

  try {
    const out = await chatJson<RichFeedback>(
      "You are a demanding but encouraging college math-notation tutor giving DETAILED feedback on ONE practice problem. " +
        "The student is practicing typing mathematical symbols correctly. Be specific and generous with detail — this is practice, so teach hard. " +
        "Write ALL math as LaTeX inline `$...$` or display `$$...$$`. Pay special attention to NOTATION: whether the student used the right symbol, subscripts/superscripts, Greek letters, set/logic symbols, etc. " +
        'Respond as strict JSON with EXACTLY these keys: {"verdict": string (one punchy line), "whatYouDid": string (restate their attempt), "whyRightWrong": string (2-4 sentences on exactly why it is right or where it broke), "theConcept": string (the underlying idea, 2-4 sentences), "symbolNote": string (1-3 sentences specifically about the notation/symbol involved and how to type it), "commonMistakes": string[] (2-4 short bullets), "workedSolution": string (full step-by-step solution), "studyNext": string[] (2-4 concrete, specific things to practice next)}.',
      JSON.stringify({
        topic: opts.topicTitle ?? null,
        prompt: opts.prompt,
        correct_answer: opts.correctAnswer,
        student_answer: opts.userAnswer,
        graded_correct: opts.correct,
      }),
    );
    return {
      verdict: out.verdict || fallback.verdict,
      whatYouDid: out.whatYouDid || fallback.whatYouDid,
      whyRightWrong: out.whyRightWrong || fallback.whyRightWrong,
      theConcept: out.theConcept || fallback.theConcept,
      symbolNote: out.symbolNote || fallback.symbolNote,
      commonMistakes: Array.isArray(out.commonMistakes) ? out.commonMistakes.slice(0, 6) : [],
      workedSolution: out.workedSolution || fallback.workedSolution,
      studyNext: Array.isArray(out.studyNext) ? out.studyNext.slice(0, 6) : fallback.studyNext,
    };
  } catch {
    return fallback;
  }
}
