// The account-wide cap on programs running at once (ported from backend/server.js, behaviour unchanged).
// Step 1b moves it into the global Limiter Durable Object and adds expiring leases.
//
// The account runs at most 4 programs at once (docs/limits); more and a sync request gets 429. So Flux keeps its own
// requests within 4 sandbox slots and queues the rest briefly. A batch takes whatever is free (1 up to what it wants):
// the API then runs its tests in more rounds, and nothing waits behind a big request while a slot sits free.

export class BusyError extends Error {
  constructor() { super("The run queue is busy."); this.name = "BusyError"; }
}

type Waiter = { want: number; resolve: (got: number) => void; timer: ReturnType<typeof setTimeout> | null };

export class SlotPool {
  private free: number;
  private readonly waiting: Waiter[] = [];

  constructor(
    readonly maxSlots = 4,
    private readonly queueWaitMs = 10_000,
    private readonly maxQueue = 16,
  ) {
    this.free = maxSlots;
  }

  get freeSlots() { return this.free; }
  get queued() { return this.waiting.length; }

  private take(want: number) {
    const got = Math.min(want, this.free);
    this.free -= got;
    return got;
  }

  private grantWaiting() {
    while (this.waiting.length && this.free >= 1) {
      const next = this.waiting.shift()!;
      if (next.timer) clearTimeout(next.timer);
      next.resolve(this.take(next.want));
    }
  }

  // Resolves with how many slots it got (1 up to `want`) as soon as one is free. Rejects with BusyError after
  // queueWaitMs, or at once if the queue is full.
  acquire(want: number): Promise<number> {
    return new Promise((resolve, reject) => {
      if (this.waiting.length === 0 && this.free >= 1) return resolve(this.take(want));
      if (this.waiting.length >= this.maxQueue) return reject(new BusyError());
      const entry: Waiter = { want, resolve, timer: null };
      entry.timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(entry), 1);
        reject(new BusyError());
      }, this.queueWaitMs);
      this.waiting.push(entry);
    });
  }

  release(got: number) {
    this.free += got;
    this.grantWaiting();
  }
}
