import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, MessageSquare, Send, ChevronDown, ChevronRight } from "lucide-react";

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

type DialogueMsg = { role: "user" | "assistant"; content: string };

/**
 * Heavy per-question feedback with an inline dialogue thread so the student can
 * argue with, question, or dig deeper into the feedback they just received.
 */
export function RichFeedbackCard({
  index,
  prompt,
  correct,
  userAnswer,
  correctAnswer,
  feedback,
}: {
  index: number;
  prompt: string;
  correct: boolean;
  userAnswer: string;
  correctAnswer: string;
  feedback: RichFeedback;
}) {
  const [open, setOpen] = useState(!correct);
  const [thread, setThread] = useState<DialogueMsg[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [thread.length, pending]);

  async function send() {
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    const nextThread = [...thread, { role: "user" as const, content: message }];
    setThread(nextThread);
    setPending(true);
    try {
      const res = await fetch("/api/tutor/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          problemPrompt: prompt,
          correctAnswer,
          studentAnswer: userAnswer,
          feedback: JSON.stringify(feedback),
          history: thread,
          message,
        }),
      });
      const data = (await res.json()) as { text?: string };
      setThread((t) => [...t, { role: "assistant", content: data.text ?? "(no reply)" }]);
    } catch (e) {
      setThread((t) => [
        ...t,
        { role: "assistant", content: `Tutor error: ${(e as Error).message}` },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      className={`rounded-lg border ${
        correct ? "border-chart-2/40 bg-chart-2/5" : "border-destructive/40 bg-destructive/5"
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left"
        data-testid={`button-feedback-toggle-${index}`}
      >
        <div className="flex items-center gap-2 font-semibold">
          {correct ? (
            <CheckCircle2 className="w-5 h-5 text-chart-2" />
          ) : (
            <XCircle className="w-5 h-5 text-destructive" />
          )}
          Problem {index + 1}
          <span className="text-sm font-normal text-muted-foreground">— {feedback.verdict}</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-4">
          <div className="text-sm bg-background/60 border border-border rounded-md p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              The problem
            </div>
            <MarkdownRenderer content={prompt} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Your answer
              </span>
              <div className="font-mono mt-1 break-words">{userAnswer || "No answer"}</div>
            </div>
            {!correct && (
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Correct answer
                </span>
                <div className="font-mono mt-1 break-words text-primary">{correctAnswer}</div>
              </div>
            )}
          </div>

          <FeedbackSection title="What you did">{feedback.whatYouDid}</FeedbackSection>
          <FeedbackSection title="Why it's right / where it broke">
            {feedback.whyRightWrong}
          </FeedbackSection>
          <FeedbackSection title="The concept">{feedback.theConcept}</FeedbackSection>
          {feedback.symbolNote && (
            <FeedbackSection title="Notation note">{feedback.symbolNote}</FeedbackSection>
          )}
          {feedback.commonMistakes.length > 0 && (
            <div>
              <SectionLabel>Common mistakes</SectionLabel>
              <ul className="list-disc pl-5 space-y-1 text-sm mt-1">
                {feedback.commonMistakes.map((m, i) => (
                  <li key={i}>
                    <MarkdownRenderer content={m} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <FeedbackSection title="Worked solution">{feedback.workedSolution}</FeedbackSection>
          {feedback.studyNext.length > 0 && (
            <div>
              <SectionLabel>What to practice next</SectionLabel>
              <ul className="list-disc pl-5 space-y-1 text-sm mt-1">
                {feedback.studyNext.map((m, i) => (
                  <li key={i}>
                    <MarkdownRenderer content={m} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Dialogue thread about THIS feedback */}
          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              <MessageSquare className="w-3.5 h-3.5" />
              Disagree or want to dig in? Talk it through
            </div>
            {thread.length > 0 && (
              <div
                ref={scrollRef}
                className="flex flex-col gap-2 max-h-64 overflow-y-auto mb-2 pr-1"
              >
                {thread.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[92%] ${m.role === "user" ? "self-end" : "self-start"}`}
                  >
                    <div
                      className={`px-3 py-2 rounded-lg text-sm ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background border border-border"
                      }`}
                    >
                      <MarkdownRenderer content={m.content} inverted={m.role === "user"} />
                    </div>
                  </div>
                ))}
                {pending && (
                  <div className="self-start px-3 py-2 rounded-lg bg-background border border-border text-sm animate-pulse text-muted-foreground">
                    Thinking…
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="e.g. Why is my answer wrong — isn't ≥ the same here?"
                rows={2}
                className="flex-1 bg-secondary border-none rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[48px] max-h-[160px]"
                data-testid={`input-feedback-dialogue-${index}`}
              />
              <Button
                onClick={send}
                disabled={!input.trim() || pending}
                data-testid={`button-feedback-dialogue-send-${index}`}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function FeedbackSection({ title, children }: { title: string; children: string }) {
  if (!children) return null;
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <div className="text-sm mt-1 prose prose-sm max-w-none">
        <MarkdownRenderer content={children} />
      </div>
    </div>
  );
}
