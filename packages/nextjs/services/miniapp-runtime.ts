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
