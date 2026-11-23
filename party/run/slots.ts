// The account-wide cap on programs running at once, used by the Limiter Durable Object.
//
// The account runs at most 4 programs at once (docs/limits); more and a sync request gets 429. So Flux keeps its own
// requests within 4 sandbox slots and queues the rest briefly. A batch takes whatever is free (1 up to what it wants):
// the API then runs its tests in more rounds, and nothing waits behind a big request while a slot sits free.
//
// Slots are leased: a room that crashes mid-run never releases, so a lease ends on its own after leaseMs.

export class BusyError extends Error {
  constructor() { super("The run queue is busy."); this.name = "BusyError"; }
}

export type Lease = { id: string; slots: number };

type Waiter = { want: number; resolve: (lease: Lease) => void; timer: ReturnType<typeof setTimeout> | null };

export class SlotPool {
  private free: number;
  private readonly leases = new Map<string, { slots: number; expiresAt: number }>();
  private readonly waiting: Waiter[] = [];
  private nextId = 0;

  constructor(
    readonly maxSlots = 4,
    private readonly queueWaitMs = 10_000,
    private readonly maxQueue = 16,
    private readonly leaseMs = 90_000,   // longer than any single upstream call (70 s for a test batch)
    private readonly now: () => number = Date.now,
  ) {
    this.free = maxSlots;
  }

  get freeSlots() { this.expireLeases(); return this.free; }
  get queued() { return this.waiting.length; }

  private take(want: number): Lease {
    const slots = Math.min(want, this.free);
    this.free -= slots;
    const id = `l${++this.nextId}`;
    this.leases.set(id, { slots, expiresAt: this.now() + this.leaseMs });
    return { id, slots };
  }

  private expireLeases() {
    const now = this.now();
    for (const [id, lease] of this.leases) {
      if (lease.expiresAt <= now) { this.leases.delete(id); this.free += lease.slots; }
    }
  }

  private grantWaiting() {
    while (this.waiting.length && this.free >= 1) {
      const next = this.waiting.shift()!;
      if (next.timer) clearTimeout(next.timer);
      next.resolve(this.take(next.want));
    }
  }

  // Resolves with a lease of 1 up to `want` slots as soon as one is free. Rejects with BusyError after queueWaitMs,
  // or at once if the queue is full.
  acquire(want: number): Promise<Lease> {
    this.expireLeases();
    return new Promise((resolve, reject) => {
      if (this.waiting.length === 0 && this.free >= 1) return resolve(this.take(want));
      if (this.waiting.length >= this.maxQueue) return reject(new BusyError());
      const entry: Waiter = { want, resolve, timer: null };
      entry.timer = setTimeout(() => {
        // A lease may have run out while we waited, with nothing else to notice: look once more before giving up.
        this.expireLeases();
        this.grantWaiting();
        const i = this.waiting.indexOf(entry);
        if (i >= 0) { this.waiting.splice(i, 1); reject(new BusyError()); }
      }, this.queueWaitMs);
      this.waiting.push(entry);
    });
  }

  // Ends a lease. Unknown or already-expired ids are ignored, so a late release can't free slots twice.
  release(leaseId: string) {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.delete(leaseId);
    this.free += lease.slots;
    this.grantWaiting();
  }
}
