import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import type { KeystrokeTrace } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AnswerInput } from "@/components/AnswerInput";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { TutorPanel } from "@/components/TutorPanel";
import { RichFeedbackCard, type RichFeedback } from "@/components/RichFeedbackCard";
import { ArrowLeft, RefreshCw, Infinity as InfinityIcon } from "lucide-react";

type PracticeProblem = {
  id: number;
  position: number;
  prompt: string;
  topicId: number;
  topicTitle: string | null;
};

type PracticeTwin = {
  sessionId: number;
  assignmentId: number;
  title: string;
  kind: string;
  weekNumber: number;
  instructions: string | null;
  problems: PracticeProblem[];
};

type PerProblemResult = {
  problemId: number;
  prompt: string;
  topicId: number;
  topicTitle: string | null;
  userAnswer: string;
  correct: boolean;
  correctAnswer: string;
  feedback: RichFeedback;
};

type SubmitResult = {
  sessionId: number;
  assignmentId: number | null;
  score: number;
  total: number;
  percent: number;
  coachSummary: string;
  nextSteps: string[];
  perProblem: PerProblemResult[];
};

export default function PracticeAssignmentRunner() {
  const params = useParams();
  const assignmentId = Number(params.assignmentId);

  const [twin, setTwin] = useState<PracticeTwin | null>(null);
  const [loadingTwin, setLoadingTwin] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, { answer: string; trace: KeystrokeTrace }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const generatedFor = useRef<number | null>(null);

  async function generateTwin() {
    setLoadingTwin(true);
    setGenError(null);
    setResult(null);
    setAnswers({});
    setTwin(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/practice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      if (!res.ok) throw new Error(`Failed to generate practice (${res.status})`);
      const data = (await res.json()) as PracticeTwin;
      setTwin(data);
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setLoadingTwin(false);
    }
  }

  useEffect(() => {
    if (!Number.isFinite(assignmentId)) return;
    if (generatedFor.current === assignmentId) return;
    generatedFor.current = assignmentId;
    void generateTwin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  async function submit() {
    if (!twin) return;
    setSubmitting(true);
    try {
      const payload = {
        answers: twin.problems.map((p) => ({
          problemId: p.id,
          answer: answers[p.id]?.answer ?? "",
          trace: answers[p.id]?.trace ?? null,
        })),
      };
      const res = await fetch(`/api/practice/assignment/${twin.sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Submit failed (${res.status})`);
      const data = (await res.json()) as SubmitResult;
      setResult(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setGenError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!Number.isFinite(assignmentId)) {
    return (
      <Layout>
        <div className="p-8 max-w-3xl mx-auto">
          <div className="text-destructive">Invalid assignment.</div>
          <Link href="/assignments" className="text-primary underline">
            Back to assignments
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="p-6 md:p-8 max-w-6xl mx-auto w-full flex flex-col gap-6 pb-24">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Link
            href="/assignments"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to assignments
          </Link>
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">
            <InfinityIcon className="w-4 h-4" />
            Infinite practice — not graded
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Practice version{twin ? ` · ${twin.kind}` : ""}
          </div>
          <h1 className="font-serif text-3xl text-primary">
            {twin?.title ?? (loadingTwin ? "Generating practice…" : `Assignment ${assignmentId}`)}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            This is a brand-new practice twin of the real assignment — same concepts and symbols,
            different problems. Take it as many times as you want; nothing here counts against your
            grade. The tutor stays with you the whole time.
          </p>
        </div>

        {genError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {genError}
          </div>
        )}

        {/* RESULT VIEW */}
        {result ? (
          <div className="flex flex-col gap-6">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Practice score (not recorded as a grade)
                  </div>
                  <div className="text-3xl font-serif font-bold text-primary">
                    {Math.round(result.percent)}%{" "}
                    <span className="text-base font-normal text-muted-foreground">
                      ({result.score}/{result.total})
                    </span>
                  </div>
                </div>
                <Button onClick={generateTwin} disabled={loadingTwin}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  New practice version
                </Button>
              </div>
              {result.coachSummary && (
                <div className="text-sm prose prose-sm max-w-none">
                  <MarkdownRenderer content={result.coachSummary} />
                </div>
              )}
              {result.nextSteps.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Do this next
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-sm">
                    {result.nextSteps.map((s, i) => (
                      <li key={i}>
                        <MarkdownRenderer content={s} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex flex-wrap gap-3 pt-1">
                <Link href={`/assignments/${assignmentId}`}>
                  <Button variant="outline">I'm ready — take the graded version</Button>
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 flex flex-col gap-4">
                <h2 className="font-serif text-xl">Per-question feedback</h2>
                {result.perProblem.map((pr, idx) => (
                  <RichFeedbackCard
                    key={pr.problemId}
                    index={idx}
                    prompt={pr.prompt}
                    correct={pr.correct}
                    userAnswer={pr.userAnswer}
                    correctAnswer={pr.correctAnswer}
                    feedback={pr.feedback}
                  />
                ))}
              </div>
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-6 h-[600px]">
                  <TutorPanel
                    lectureId={null}
                    title="Live tutor"
                    subtitle="Review with the tutor. Ask why an answer was marked the way it was."
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* WORKING VIEW */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 flex flex-col gap-6">
              {loadingTwin || !twin ? (
                <div className="flex flex-col gap-4">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-40 w-full" />
                  <Skeleton className="h-40 w-full" />
                </div>
              ) : (
                <>
                  {twin.instructions && (
                    <div className="text-sm bg-secondary/50 border rounded-md p-3">
                      <MarkdownRenderer content={twin.instructions} />
                    </div>
                  )}
                  {twin.problems.map((p, idx) => (
                    <div key={p.id} className="bg-card border rounded-lg p-5 flex flex-col gap-4">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Problem {idx + 1} of {twin.problems.length}
                          {p.topicTitle ? ` · ${p.topicTitle}` : ""}
                        </div>
                      </div>
                      <div className="text-lg leading-relaxed">
                        <MarkdownRenderer content={p.prompt} />
                      </div>
                      <AnswerInput
                        value={answers[p.id]?.answer ?? ""}
                        onChange={(val, trace) =>
                          setAnswers((prev) => ({ ...prev, [p.id]: { answer: val, trace } }))
                        }
                        promptSource={p.prompt}
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between gap-3">
                    <Button variant="ghost" onClick={generateTwin} disabled={loadingTwin}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Regenerate problems
                    </Button>
                    <Button onClick={submit} disabled={submitting} data-testid="button-submit-practice-assignment">
                      {submitting ? "Grading & writing feedback…" : "Submit for detailed feedback"}
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-6 h-[600px]">
                <TutorPanel lectureId={null} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
