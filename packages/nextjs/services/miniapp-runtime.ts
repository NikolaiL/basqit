// Resolve web immediately when the host has no Farcaster bridge; never block rendering.
export async function detectMiniapp<T>(
  host: { isInMiniApp: () => Promise<boolean>; context: Promise<T> },
  timeout = 1500,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      host.isInMiniApp().then(inMiniApp => (inMiniApp ? host.context : null)),
      new Promise<null>(resolve => {
        timer = setTimeout(() => resolve(null), timeout);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// One prompt per provider session, including when the user declines or the host rejects it.
export function scheduleAddMiniapp(
  context: { client: { added: boolean } } | null,
  prompted: { current: boolean },
  add: () => Promise<void>,
  onError: () => void,
) {
  if (!context || context.client.added || prompted.current) return;
  const timer = setTimeout(() => {
    prompted.current = true;
    void add().catch(error => {
      if (!(error instanceof Error) || error.name !== "RejectedByUser") onError();
    });
  }, 5000);
  return () => clearTimeout(timer);
}
