import { useEffect, useRef, useState } from "react";
import { useAskTutor } from "@workspace/api-client-react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { MessageSquare, Send } from "lucide-react";

type ChatMsg = { role: "user" | "tutor"; text: string };

/**
 * Reusable live-tutor chat panel shown on PRACTICE surfaces only (never during a
 * graded attempt). Optionally grounds replies in a lecture and/or extra context
 * (e.g. the practice problem currently on screen).
 */
export function TutorPanel({
  lectureId,
  groundingContext,
  title = "Live tutor",
  subtitle = "The tutor stays with you the whole time you practice. Ask anything.",
}: {
  lectureId?: number | null;
  groundingContext?: string;
  title?: string;
  subtitle?: string;
}) {
  const [history, setHistory] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const ask = useAskTutor();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 1e9, behavior: "smooth" });
  }, [history.length, ask.isPending]);

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setHistory((h) => [...h, { role: "user", text }]);
    ask.mutate(
      {
        data: {
          message: text,
          lectureId: lectureId ?? undefined,
          selectedLectureText: groundingContext || undefined,
        },
      },
      {
        onSuccess: (res) => setHistory((h) => [...h, { role: "tutor", text: res.text }]),
        onError: (e) =>
          setHistory((h) => [
            ...h,
            { role: "tutor", text: `Tutor error: ${(e as Error).message}` },
          ]),
      },
    );
  }

  return (
    <div className="flex flex-col min-h-0 h-full border border-border rounded-lg bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-secondary/40">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <MessageSquare className="w-4 h-4 text-primary" />
          {title}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-[160px]">
        {history.length === 0 && (
          <div className="m-auto text-center text-sm text-muted-foreground italic max-w-xs">
            Stuck on a problem? Ask for a hint, a worked example, or an explanation of the
            symbol — without giving away the answer if you'd rather work it out.
          </div>
        )}
        {history.map((m, i) => (
          <div key={i} className={`max-w-[92%] ${m.role === "user" ? "self-end" : "self-start"}`}>
            <div
              className={`px-3 py-2 rounded-lg text-sm ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background border border-border"
              }`}
            >
              <MarkdownRenderer content={m.text} inverted={m.role === "user"} />
            </div>
          </div>
        ))}
        {ask.isPending && (
          <div className="self-start px-3 py-2 rounded-lg bg-background border border-border text-sm animate-pulse text-muted-foreground">
            Thinking…
          </div>
        )}
      </div>

      <div className="border-t border-border bg-background p-2 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask the tutor… (Shift+Enter for newline)"
          rows={2}
          className="flex-1 bg-secondary border-none rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-y min-h-[52px] max-h-[200px]"
          data-testid="input-tutor-panel"
        />
        <Button onClick={send} disabled={!input.trim() || ask.isPending} data-testid="button-tutor-panel-send">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
