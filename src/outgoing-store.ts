import type { ComposerAttachment } from "./components/Composer";
import type { CollaborationMode } from "./types";

export type OutgoingSubmission = {
  id: string;
  threadId: string;
  text: string;
  attachments: ComposerAttachment[];
  mode: CollaborationMode;
  timestamp: number;
  state: "sending" | "unknown" | "queued" | "failed";
};

let database: Promise<IDBDatabase> | undefined;
function open() {
  return (database ||= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`codex-outgoing:${location.pathname}`, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("messages", { keyPath: "id" });
      store.createIndex("timestamp", "timestamp");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Recovery storage is busy in another tab"));
  }));
}

export async function readOutgoing(): Promise<OutgoingSubmission[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("messages").objectStore("messages").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function writeOutgoing(message: OutgoingSubmission | string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("messages", "readwrite");
    const store = transaction.objectStore("messages");
    if (typeof message === "string") store.delete(message);
    else {
      store.put(message);
      // Keep recovery storage bounded, including attachment data.
      const request = store.count();
      request.onsuccess = () => {
        let excess = request.result - 12;
        if (excess <= 0) return;
        const cursor = store.index("timestamp").openKeyCursor();
        cursor.onsuccess = () => {
          if (!cursor.result || excess-- <= 0) return;
          store.delete(cursor.result.primaryKey);
          cursor.result.continue();
        };
      };
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
