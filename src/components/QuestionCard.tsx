import { Check, ChevronLeft, ChevronRight, CircleHelp, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { QuestionAnswers, UiItem } from "../types";

type Item = Extract<UiItem, { type: "question" }>;
type Draft = Record<string, { choice: string; text: string }>;
const OTHER = "__custom__";

export function QuestionCard({
  item,
  threadId,
  disabled,
  respond,
}: {
  item: Item;
  threadId: string;
  disabled: boolean;
  respond: (answers: QuestionAnswers, dismiss?: boolean) => Promise<void>;
}) {
  const key = `codex-question:${threadId}:${item.id}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || "{}");
      return Object.fromEntries(
        item.questions
          .filter(
            (question) =>
              !question.isSecret &&
              typeof stored?.[question.id]?.text === "string" &&
              typeof stored?.[question.id]?.choice === "string",
          )
          .map((question) => [question.id, stored[question.id]]),
      );
    } catch {
      return {};
    }
  });
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const question = item.questions[index];
  const pending = item.status === "pending";
  const answerFor = (id: string) => {
    const value = draft[id];
    const question = item.questions.find((question) => question.id === id);
    if (!value || !question) return "";
    if (value.choice === OTHER) return question.isSecret ? value.text : value.text.trim();
    return question.options?.some((option) => option.label === value.choice) ? value.choice : "";
  };
  const answered = item.questions.filter((question) => answerFor(question.id)).length;
  const update = (value: { choice: string; text: string }) => {
    if (question) setDraft((old) => ({ ...old, [question.id]: value }));
    setError("");
  };

  useEffect(() => {
    try {
      if (!pending) {
        sessionStorage.removeItem(key);
        if (Object.keys(draft).length) setDraft({});
        return;
      }
      const safe = Object.fromEntries(
        item.questions
          .filter((question) => !question.isSecret && draft[question.id])
          .map((question) => [question.id, draft[question.id]]),
      );
      sessionStorage.setItem(key, JSON.stringify(safe));
    } catch {
      /* Drafts still work when browser storage is unavailable. */
    }
  }, [key, draft, pending, item.questions]);

  const submit = async (dismiss = false) => {
    if (submitting.current || disabled || !pending) return;
    if (!dismiss) {
      const missing = item.questions.findIndex((question) => !answerFor(question.id));
      if (missing >= 0) {
        setIndex(missing);
        setError("Please choose an option or enter your answer.");
        return;
      }
    }
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await respond(
        Object.fromEntries(
          item.questions.map((question) => [question.id, { answers: [answerFor(question.id)] }]),
        ),
        dismiss,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not submit. Your answers are preserved.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <section
      id={`interaction-${item.id}`}
      className={`question-card ${pending ? "pending" : "settled"}`}
      aria-label="Codex questions"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === "Enter" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <header>
        <span className="interaction-icon">
          {item.status === "answered" ? <Check /> : <CircleHelp />}
        </span>
        <div>
          <b>
            {pending
              ? item.blocking
                ? "Your input is needed"
                : "A question from Codex"
              : item.status === "answered"
                ? "Answer submitted"
                : item.status === "dismissed"
                  ? "Question dismissed"
                  : "Question closed"}
          </b>
          <small>
            {pending
              ? item.blocking
                ? "Answer to continue this task"
                : "Codex can keep working while you decide"
              : item.status === "expired"
                ? "This question is no longer awaiting an answer"
                : "Saved in this conversation"}
          </small>
        </div>
        {pending && item.questions.length > 1 && (
          <span className="question-progress">
            {answered}/{item.questions.length}
          </span>
        )}
      </header>
      {pending && question ? (
        <>
          {item.questions.length > 1 && (
            <nav className="question-tabs" aria-label="Questions">
              {item.questions.map((entry, position) => (
                <button
                  type="button"
                  key={entry.id}
                  className={position === index ? "selected" : ""}
                  aria-current={position === index ? "step" : undefined}
                  onClick={() => setIndex(position)}
                >
                  {answerFor(entry.id) && <Check />}
                  <span>{entry.header || `Question ${position + 1}`}</span>
                </button>
              ))}
            </nav>
          )}
          <fieldset disabled={disabled || busy}>
            <legend>{question.question}</legend>
            <div className="question-options">
              {question.options?.map((option, position) => (
                <label
                  className={`question-option ${draft[question.id]?.choice === option.label ? "selected" : ""}`}
                  key={`${position}-${option.label}`}
                >
                  <input
                    type="radio"
                    name={`${key}:${question.id}`}
                    checked={draft[question.id]?.choice === option.label}
                    onChange={() =>
                      update({ choice: option.label, text: draft[question.id]?.text || "" })
                    }
                  />
                  <span>
                    <b>{option.label}</b>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </label>
              ))}
            </div>
            {(!question.options?.length || question.isOther) && (
              <div className="question-custom">
                {Boolean(question.options?.length) && (
                  <label>
                    <input
                      type="radio"
                      name={`${key}:${question.id}`}
                      checked={draft[question.id]?.choice === OTHER}
                      onChange={() =>
                        update({ choice: OTHER, text: draft[question.id]?.text || "" })
                      }
                    />
                    <span>Write your own answer</span>
                  </label>
                )}
                {question.isSecret ? (
                  <input
                    aria-label="Your answer"
                    type="password"
                    autoComplete="off"
                    maxLength={16000}
                    value={draft[question.id]?.text || ""}
                    onChange={(event) => update({ choice: OTHER, text: event.target.value })}
                  />
                ) : (
                  <textarea
                    aria-label="Your answer"
                    rows={3}
                    maxLength={16000}
                    placeholder="Add your answer or a different preference…"
                    value={draft[question.id]?.text || ""}
                    onFocus={() => {
                      if (draft[question.id]?.choice !== OTHER)
                        update({ choice: OTHER, text: draft[question.id]?.text || "" });
                    }}
                    onChange={(event) => update({ choice: OTHER, text: event.target.value })}
                  />
                )}
              </div>
            )}
          </fieldset>
          {error && (
            <p className="interaction-error" role="alert">
              {error}
            </p>
          )}
          <footer>
            <div>
              {!item.blocking && (
                <button
                  type="button"
                  className="interaction-quiet"
                  disabled={disabled || busy}
                  onClick={() => void submit(true)}
                >
                  Dismiss
                </button>
              )}
              <span className="question-shortcut">Ctrl / ⌘ Enter to submit</span>
            </div>
            <div>
              {index > 0 && (
                <button
                  type="button"
                  className="interaction-secondary"
                  disabled={busy}
                  onClick={() => setIndex(index - 1)}
                >
                  <ChevronLeft />
                  Back
                </button>
              )}
              {index < item.questions.length - 1 ? (
                <button
                  type="button"
                  className="interaction-primary"
                  disabled={disabled || busy || !answerFor(question.id)}
                  onClick={() => setIndex(index + 1)}
                >
                  Next
                  <ChevronRight />
                </button>
              ) : (
                <button
                  type="button"
                  className="interaction-primary"
                  disabled={disabled || busy || answered !== item.questions.length}
                  onClick={() => void submit()}
                >
                  {busy && <LoaderCircle />}
                  {busy ? "Submitting…" : item.blocking ? "Submit & continue" : "Submit answer"}
                </button>
              )}
            </div>
          </footer>
        </>
      ) : (
        <div className="question-receipt">
          {item.questions.map((question) => (
            <div key={question.id}>
              <b>{question.question}</b>
              {item.answers?.[question.id] && (
                <p>{question.isSecret ? "••••••" : item.answers[question.id].answers.join("; ")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
