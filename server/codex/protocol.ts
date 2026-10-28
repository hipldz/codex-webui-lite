export type JsonRpcId = number | string;
export type JsonRpcMessage = {
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, any>;
  result?: any;
  error?: { code: number; message: string; data?: any };
};
export type ApprovalDecision = string | Record<string, unknown>;

export type Question = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: Array<{ label: string; description: string }> | null;
};
export type QuestionAnswers = Record<string, { answers: string[] }>;
export type CollaborationMode = "default" | "plan";
type TimedItem = { timestamp?: number; turnId?: string; delta?: boolean };
export type UiItem = TimedItem &
  (
    | {
        type: "user_message";
        id: string;
        text: string;
        attachments?: Array<{
          id?: string;
          name: string;
          mime?: string;
          kind: "image" | "audio" | "text" | "file";
          data?: string;
          size?: number;
        }>;
        attachmentThreadId?: string;
      }
    | {
        type: "assistant_message";
        id: string;
        text: string;
        streaming: boolean;
        phase?: "commentary" | "final_answer";
      }
    | { type: "generated_image"; id: string; src: string; alt: string }
    | { type: "thinking"; id: string; text: string; status: "running" | "done" }
    | {
        type: "command";
        id: string;
        command: string;
        output: string;
        status: "running" | "done" | "error";
      }
    | { type: "file_read"; id: string; path: string }
    | { type: "file_change"; id: string; path: string; diff?: string; status?: string }
    | {
        type: "status";
        id: string;
        title: string;
        detail?: string;
        tone?: "info" | "success" | "warning";
      }
    | {
        type: "approval";
        id: string;
        requestId: JsonRpcId;
        description: string;
        status: "pending" | "approved" | "denied" | "expired";
        decisions: ApprovalDecision[];
        approvalKind: "command" | "file";
      }
    | {
        type: "question";
        id: string;
        requestId?: number | string;
        source: "request" | "message";
        blocking: boolean;
        questions: Question[];
        status: "pending" | "answered" | "dismissed" | "expired";
        answers?: QuestionAnswers;
      }
    | { type: "plan"; id: string; text: string; streaming: boolean; ready?: boolean }
    | { type: "error"; id: string; message: string }
  );
