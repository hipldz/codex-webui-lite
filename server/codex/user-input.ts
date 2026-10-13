import type { JsonRpcMessage, Question, QuestionAnswers, UiItem } from "./protocol.js";

export type QuestionItem = Extract<UiItem, { type: "question" }>;

export function userInputRequest(message: JsonRpcMessage): QuestionItem | null {
  if (message.method !== "item/tool/requestUserInput" || message.id === undefined) return null;
  const p = message.params || {};
  return {
    type: "question",
    id: `question-request-${p.itemId || message.id}`,
    requestId: message.id,
    source: "request",
    turnId: p.turnId,
    timestamp: Date.now(),
    blocking: p.isBlocking !== false,
    questions: p.questions || [],
    status: "pending",
  };
}

export function messageQuestions(item: any, turnId?: string): QuestionItem | null {
  if (item.delivery !== "async" || !Array.isArray(item.questions) || !item.questions.length)
    return null;
  const questions: Question[] = item.questions.map((question: any, index: number) => ({
    id: `q${index + 1}`,
    header: `Question ${index + 1}`,
    question: question.title,
    isOther: true,
    isSecret: false,
    options: question.options?.map((label: string) => ({ label, description: "" })) || null,
  }));
  return {
    type: "question",
    id: `question-message-${item.id}`,
    source: "message",
    turnId,
    blocking: false,
    questions,
    status: "pending",
  };
}

/** Validate before replying to Codex; never silently submit a partial questionnaire. */
export function validateAnswers(questions: Question[], value: unknown): QuestionAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid answers");
  const input = value as Record<string, any>;
  const result: QuestionAnswers = Object.create(null);
  if (Object.keys(input).some((id) => !questions.some((question) => question.id === id)))
    throw new Error("Unknown question");
  for (const question of questions) {
    const answers = input[question.id]?.answers;
    if (
      !Array.isArray(answers) ||
      answers.length !== 1 ||
      typeof answers[0] !== "string" ||
      !answers[0].trim() ||
      answers[0].length > 16_000
    )
      throw new Error(`Please answer ${question.header || question.id}`);
    const answer = question.isSecret ? answers[0] : answers[0].trim();
    if (
      question.options?.length &&
      !question.isOther &&
      !question.options.some((option) => option.label === answer)
    )
      throw new Error("Choose one of the available options");
    result[question.id] = { answers: [answer] };
  }
  return result;
}

export function displayAnswers(questions: Question[], answers: QuestionAnswers): QuestionAnswers {
  return Object.fromEntries(
    questions.map((question) => [
      question.id,
      { answers: question.isSecret ? ["••••••"] : answers[question.id].answers },
    ]),
  );
}
