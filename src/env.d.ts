/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

interface ImportMetaEnv {
  readonly VITE_TURN_URLS?: string;
  readonly VITE_TURN_USERNAME?: string;
  readonly VITE_TURN_CREDENTIAL?: string;
  readonly VITE_TURN_API?: string;
}

/** Content hashes of the files of public/ the app loads (tools/versioning.ts); empty in development. */
declare module 'virtual:sonora-assets' {
  const versions: { piano: string; emoji: Record<string, string> };
  export default versions;
}

/** Signalsmith Stretch (no types of its own): see src/media/stretch.ts for the part used. */
declare module 'signalsmith-stretch' {
  const SignalsmithStretch: unknown;
  export default SignalsmithStretch;
}
