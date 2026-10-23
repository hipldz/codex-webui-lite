import { useCallback, useEffect, useRef, useState } from "react";
// Notification image requests may omit HTTP Basic credentials; keep the icon self-contained.
import notificationIcon from "../assets/codex-favicon.svg?inline";

export type BrowserNotificationStatus = NotificationPermission | "unsupported" | "insecure";
export type BrowserNotificationControls = {
  status: BrowserNotificationStatus;
  requesting: boolean;
  error: string;
  requestPermission: () => Promise<void>;
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
  const requestInFlight = useRef(false);
  const automaticallyRequested = useRef(false);
  const notified = useRef(new Set<string>());

  const requestPermission = useCallback(async () => {
    const current = browserStatus();
    setStatus(current);
    if (current !== "default" || requestInFlight.current) return;
    requestInFlight.current = true;
    setRequesting(true);
    setError("");
    try {
      await Notification.requestPermission();
      // A blocked automatic request can return "denied" without changing site permission.
      setStatus(browserStatus());
    } catch {
      setStatus(browserStatus());
      setError("Click Enable notifications to request permission from your browser.");
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
      if (current === "granted") setError("");
    };
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);
    // Some browsers require a click; the page and Settings also offer an explicit button.
    if (!automaticallyRequested.current && browserStatus() === "default") {
      automaticallyRequested.current = true;
      void requestPermission();
    }
    return () => {
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
    };
  }, [disabled, requestPermission]);

  const notifyTaskComplete = useCallback(
    (threadId: string, turnId: string, threadName: string) => {
      if (disabled || browserStatus() !== "granted") return;
      const key = JSON.stringify([threadId, turnId]);
      if (notified.current.has(key)) return;
      notified.current.add(key);
      while (notified.current.size > 256)
        notified.current.delete(notified.current.values().next().value!);
      try {
        const notification = new Notification("Codex · Task complete", {
          body:
            threadName.slice(0, 160) || "Your task is complete. Click to open the conversation.",
          icon: notificationIcon,
          tag: `codex-task:${location.pathname}:${key}`,
        });
        notification.onclick = () => {
          notification.close();
          window.focus();
          const url = new URL(location.href);
          if (url.searchParams.get("session") === threadId) return;
          url.searchParams.set("session", threadId);
          url.searchParams.delete("file");
          url.searchParams.delete("scope");
          location.assign(url.href);
        };
      } catch {
        setStatus(browserStatus());
        setError("The browser could not display a notification. Check its notification settings.");
      }
    },
    [disabled],
  );

  return { status, requesting, error, requestPermission, notifyTaskComplete };
}
