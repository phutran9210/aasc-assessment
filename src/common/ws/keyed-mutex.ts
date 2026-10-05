/**
 * Runs async jobs that share a key one after another (jobs with different keys run freely).
 * Used to make "load state → apply move → save" atomic per player.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, job: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    // Start after the previous job settles, whether it succeeded or failed.
    const current = previous.then(job, job);
    this.tails.set(key, current);

    try {
      return await current;
    } finally {
      if (this.tails.get(key) === current) this.tails.delete(key);
    }
  }
}
