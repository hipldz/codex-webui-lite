import { useCallback, useEffect, useRef, useState } from "react";
// Notification image requests may omit HTTP Basic credentials; keep the icon self-contained.
import notificationIcon from "../assets/codex-favicon.svg?inline";

export type BrowserNotificationStatus = NotificationPermission | "unsupported" | "insecure";
export type BrowserNotificationControls = {
  status: BrowserNotificationStatus;
  requesting: boolean;
  error: string;
  requestPermission: () => Promise<void>;
  sendTest: () => void;
  clearError: () => void;
};

const browserStatus = (): BrowserNotificationStatus => {
  if (!window.isSecureContext) return "insecure";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
};

export function useTaskNotifications(disabled = false) {
  const [status, setStatus] = useState(browserStatus);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const errorKind = useRef<"permission" | "delivery" | "">("");
  const requestInFlight = useRef(false);
  const notified = useRef(new Set<string>());

  const requestPermission = useCallback(async () => {
    const current = browserStatus();
    setStatus(current);
    if (current !== "default" || requestInFlight.current) return;
    requestInFlight.current = true;
    setRequesting(true);
    errorKind.current = "";
    setError("");
    try {
      const result = await Notification.requestPermission();
      const next = browserStatus();
      setStatus(next);
      if (result !== "granted" && next === "default") {
        errorKind.current = "permission";
        setError("Permission was not granted. Check your browser's site settings and try again.");
      }
    } catch {
      setStatus(browserStatus());
      errorKind.current = "permission";
      setError("Could not request permission. Check your browser's site settings and try again.");
    } finally {
      requestInFlight.current = false;
      setRequesting(false);
    }
  }, []);

  useEffect(() => {
    if (disabled) return;
    const syncPermission = () => {
      const current = browserStatus();
      setStatus(current);
      if (current === "granted" && errorKind.current === "permission") {
        errorKind.current = "";
        setError("");
      }
    };
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, [disabled]);

  const showNotification = useCallback(
    (key: string, title: string, body: string, threadId = "", interactionId = "") => {
      if (disabled || browserStatus() !== "granted") return;
      if (notified.current.has(key)) return;
      notified.current.add(key);
      while (notified.current.size > 256)
        notified.current.delete(notified.current.values().next().value!);
      try {
        const notification = new Notification(title, {
          body,
          icon: notificationIcon,
          tag: `codex:${location.pathname}:${key}`,
        });
        notification.onshow = () => {
          errorKind.current = "";
          setError("");
        };
        notification.onerror = () => {
          notified.current.delete(key);
          errorKind.current = "delivery";
          setError(
            "The browser could not display a notification. Check browser and system notification settings.",
          );
        };
        notification.onclick = () => {
          notification.close();
          window.focus();
          if (!threadId) return;
          window.dispatchEvent(
            new CustomEvent("codex:open-thread", { detail: { threadId, interactionId } }),
          );
        };
      } catch {
        notified.current.delete(key);
        setStatus(browserStatus());
        errorKind.current = "delivery";
        setError("The browser could not display a notification. Check its notification settings.");
      }
    },
    [disabled],
  );

  const notifyTaskComplete = useCallback(
    (threadId: string, turnId: string, threadName: string) =>
      showNotification(
        JSON.stringify(["turn", threadId, turnId]),
        "Codex · Task complete",
        threadName.slice(0, 160) || "Your task is complete. Click to open the conversation.",
        threadId,
      ),
    [showNotification],
  );
  const notifyInteraction = useCallback(
    (threadId: string, itemId: string, type: "question" | "approval", threadName: string) =>
      showNotification(
        JSON.stringify([type, threadId, itemId]),
        type === "approval" ? "Codex · Approval needed" : "Codex · A question from Codex",
        threadName.slice(0, 160) || "Click to open the conversation.",
        threadId,
        itemId,
      ),
    [showNotification],
  );
  const sendTest = useCallback(
    () =>
      showNotification(
        `test:${Date.now()}`,
        "Codex · Test notification",
        "Notifications are working.",
      ),
    [showNotification],
  );

  return {
    status,
    requesting,
    error,
    requestPermission,
    sendTest,
    clearError: () => {
      errorKind.current = "";
      setError("");
    },
    notifyTaskComplete,
    notifyInteraction,
  };
}
