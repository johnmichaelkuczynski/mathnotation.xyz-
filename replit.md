# 🔣 Teach Yourself Mathematical Notation

**A Four-Week Course on the Symbols of Mathematics, Science, and Engineering — Built to Beta-Test the Math-Notation Stack of QuantReason and Its Clones**

---

## 🧩 Overview

Teach Yourself Mathematical Notation is a self-paced, single-user web course whose subject *is* the symbols themselves: $=, \neq, \approx, \equiv, \pm, \propto, \sum, \prod, \Delta, \partial, \int, \mu, \sigma, P(A \mid B), \forall, \exists, \in, \subseteq, \mathbb{N}, \mathbb{R}, \mathbb{C},$ and the rest.

It is a content reskin of the **QuantReason** Quantitative Reasoning app. The full QuantReason runtime — lectures with short / medium / long depth, section-scoped AI tutor, adaptive practice, AI-graded homework / tests / midterm / final, two-layer AI-authorship detection, and one-click diagnostics — is preserved unchanged. The **purpose** of this build is to put the on-screen math keyboard through its paces: every micro-lecture targets one symbol or symbol-subset and every assignment problem requires the student to type that symbol into their answer.

If a symbol on the keyboard cannot be inserted, rendered, graded, or detected cleanly, this course will surface it.

---

## 🧠 What It Does

- **Four-Week Curriculum of 28 Micro-Lectures** — One symbol family per lecture, organized by week:
  - **Week 1 — Foundations**: equality family (=, ≠, ≈, ≡); inequalities (<, >, ≤, ≥); ± and ∝; exponents ($x^n$); roots (√, ³√); |x| and n!; subscripts ($x_0, x_t, v_y$).
  - **Week 2 — Calculus and change**: Σ; Π; Δ and δ; lim, →, ∞; d/dx and ∂/∂x; ∫, ∬, ∮; $e$, ln, log.
  - **Week 3 — Probability and statistics**: μ, σ, σ²; x̄, p̂, s; P(A), P(A∣B); E(X), Var(X); $X \sim N(\mu, \sigma^2)$; z, t, χ²; α, β.
  - **Week 4 — Logic, sets, and foundations**: ∈, ∉; ⊂, ⊆; ∪, ∩, ∅, Aᶜ; ∀, ∃, ∄; ∧, ∨, ¬; →, ↔; ℕ, ℤ, ℚ, ℝ, ℂ.
- **One Real Science Example per Lecture** — Every micro-lecture grounds its symbol in an actual use from physics, chemistry, biology, statistics, computing, or epidemiology — e.g. $\Delta S \ge 0$ for the second law, $N(t) = N_0 e^{-\lambda t}$ for radioactive decay, $\chi^2$ for Mendelian goodness-of-fit, $\hat p$ for clinical-trial efficacy, $\psi : \mathbb{R}^4 \to \mathbb{C}$ for the quantum wavefunction.
- **One Symbol-Use Question per Lecture** — Every homework / test / midterm / final problem demands the student *write the symbol* in their answer, not just describe it in English. The math keyboard is the only practical way to do this.
- **Three-Depth Lectures, Section-Scoped Tutor, Adaptive Practice, AI Grading, Two-Layer Detection, One-Click Diagnostics** — All inherited unchanged from the QuantReason runtime.
- **Built-In Product Demo Video** — The companion `qr-course-demo` artifact still ships as a 62-second screencast of the live UI.

---

## ⚙️ Technical Features

- **Math Keyboard Beta Harness** — Every problem prompt is structured so that the *only* way to type the model answer is with the keys on the floating math keyboard (`MathKeyboard.tsx`). This makes the course a stress test of: tab discoverability, symbol insertion at the cursor, keystroke / paste detection on submitted answers, LaTeX-aware grading, and the renderer (KaTeX) for both the lecture and the student's answer.
- **Two-Layer AI-Authorship Detection** —
  - **Static (GPTZero):** Every submitted answer is sent to GPTZero's `predict/text` endpoint; the per-document AI probability is blended `0.85 × GPTZero + 0.15 × structural-heuristic` for the final score. If GPTZero is unavailable the system silently falls back to an LLM scorer plus heuristic.
  - **Diachronic (Keystroke Pattern):** The student textarea captures keystroke count, erase count, bulk-insert events, longest bulk insert, rewrite segments, and total duration. A scorer penalizes paste-then-reword behavior, low keystroke-to-output ratios, and impossibly sustained typing speeds.
- **Two Diagnostic Self-Tests** —
  - **System Diagnostic** (`/diagnostics/system`): environment, database round-trip, course-seed integrity, OpenAI chat completion, OpenAI JSON mode, detection pipeline, AI-positive control sample, and GPTZero connectivity.
  - **Synthetic-Student Diagnostic** (`/diagnostics/synthetic-run`): end-to-end stack proof — fake student takes a practice session, takes a full assignment attempt, submits, and verifies grading + detection + analytics all reflect the run.
- **Auto-Reseed on Curriculum Change** — `seedIfEmpty` compares the set of topic slugs in the database to the expected curriculum. If they differ, it wipes and re-seeds in dependency order. This is what lets a single content swap propagate cleanly when the seed file changes.
- **Contract-First API** — Single OpenAPI document; React Query hooks for the UI and Zod validators for the server are generated from it.
- **Streaming AI Tutor** — Token-by-token Server-Sent-Event streaming with a section-scoped system prompt grounded in the active lecture.
- **Adaptive Practice Engine** — Per-session difficulty (1–4) adjusts after each attempt; problems are generated on demand.
- **Operator Console** — Dedicated Diagnostics page surfaces both self-tests with one-click execution and raw error output.

---

## 🔐 Required Secrets

- `OPENAI_API_KEY` — required at boot. Powers the tutor, practice generator, AI graders, and lecture-expansion job.
- `GPTZERO_API_KEY` — required for the GPTZero leg of the static-AI-detection layer. If absent, the system falls back to the LLM scorer + heuristic, but you lose the primary detection signal.

Both are requested via the secrets panel; neither is hard-coded.

---

## 🎓 Designed For

- **The Maintainer of QuantReason and Its Clones:** A pure stress test of the math-notation stack — keyboard, LaTeX rendering, grading, and AI detection — without the noise of a different curriculum to debug at the same time.
- **Anyone Who Has Ever Squinted at a Math Paper:** A short, focused course that explains *what the symbols mean*, with one science example for each.

---

## 💡 Core Idea

A formula is the most compressed piece of writing a scientist ever produces. Every symbol does work — and the cost of *misreading* one is that the whole sentence flips its meaning.

This course teaches notation by *using* notation: read the symbol, see it in a real scientific equation, then type it back in an answer of your own. The math keyboard is the gym; the symbols are the weights; the science examples are the reason any of it matters.

**Teach Yourself Mathematical Notation — read the symbol, type the symbol, mean the symbol.**

---

## User preferences

_(none recorded yet)_
