// Generic application event dispatcher.
// Safe no-op in dev and forks. When an analytics deployment injects an event bridge,
// 'app:event' events are captured and forwarded to the configured analytics provider.

export function trackEvent(
  name: string,
  props?: Record<string, string | number | boolean | null | undefined>,
  value?: number,
): void {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('app:event', {
        detail: { name, props, value },
      }),
    );
  } catch {
    // Event dispatch should never throw or interrupt app flow
  }
}
