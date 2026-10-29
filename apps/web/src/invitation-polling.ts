/** Serial timer ownership with stale-response protection; failures stop automatic retries. */
export function createInvitationPolling(
  task: () => Promise<boolean>,
  enabled: () => boolean,
  interval = 60000,
  clock = {
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  },
) {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function pause() {
    generation++;
    if (timer !== undefined) clock.clearTimeout(timer);
    timer = undefined;
  }
  async function refresh() {
    pause();
    const request = generation;
    if (!enabled()) return;
    let success = false;
    try {
      success = await task();
    } catch {
      /* The caller owns the visible error state. */
    }
    if (request === generation && success && enabled())
      timer = clock.setTimeout(() => {
        void refresh();
      }, interval);
  }
  return { pause, refresh };
}
