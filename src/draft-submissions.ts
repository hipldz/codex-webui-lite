/** Correlate receipts with the exact draft revision that was submitted. */
export class DraftSubmissions {
  private revisions = new Map<string, number>();
  private pending = new Map<string, { key: string; revision: number }>();
  constructor(private createId: () => string = () => crypto.randomUUID()) {}

  edit(key: string) {
    this.revisions.set(key, (this.revisions.get(key) || 0) + 1);
  }
  begin(key: string) {
    const revision = this.revisions.get(key) || 0;
    for (const [id, entry] of this.pending)
      if (entry.key === key && entry.revision === revision) return id;
    const id = this.createId();
    this.pending.set(id, { key, revision });
    while (this.pending.size > 128) this.pending.delete(this.pending.keys().next().value!);
    return id;
  }
  restore(key: string, id: string) {
    this.pending.set(id, { key, revision: this.revisions.get(key) || 0 });
  }
  transfer(from: string, to: string) {
    this.edit(to);
    for (const entry of this.pending.values())
      if (entry.key === from && entry.revision === (this.revisions.get(from) || 0)) {
        entry.key = to;
        entry.revision = this.revisions.get(to)!;
      }
  }
  settle(id: string, accepted: boolean): string | undefined {
    const entry = this.pending.get(id);
    this.pending.delete(id);
    if (accepted && entry && entry.revision === (this.revisions.get(entry.key) || 0))
      return entry.key;
  }
}
