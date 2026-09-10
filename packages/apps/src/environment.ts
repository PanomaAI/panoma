import { layoutFor } from "./layout";
import { AppFault } from "./faults";

/*
 * The names an app inherits, and nothing else. The list is an allowlist rather than a denylist
 * because a credential nobody thought of is the failure that matters, and it is why
 * `scrubEnvironment` is not reused here.
 *
 * The Windows half is not decoration. Without `SystemRoot` and `windir` Node cannot initialize
 * there, without `TEMP`/`TMP` Chromium has nowhere to write —`TMPDIR` is the POSIX name and does
 * not exist on Windows—, without `ComSpec` and `PATHEXT` the `cmd.exe` wrapper that
 * `resolveExecutable` builds for `npm.cmd` cannot be found, and without the two app-data
 * directories a browser profile cannot be created. On macOS and Linux none of them exist in the
 * parent environment, so this half copies nothing there.
 */
export const APP_ENV_NAMES = [
  "PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SHELL", "USER", "CI",
  "SystemRoot", "windir", "SystemDrive", "ComSpec", "PATHEXT", "TEMP", "TMP",
  "APPDATA", "LOCALAPPDATA", "USERPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
] as const;
export const SECRET_PATTERN = /TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE/i;
const PROVIDER_KEYS = new Set(["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY", "ELEVENLABS_API_KEY"]);

export interface AppEnvironmentOptions {
  source?: NodeJS.ProcessEnv;
  jobId?: string;
  brain?: string;
  maxBrainCalls?: number;
  /** The host resolves and explicitly authorizes these keys for this job only. */
  providerEnv?: Record<string, string>;
}

/** A launch profile, not a filesystem sandbox. No parent credentials are inherited. */
export function buildAppEnvironment(id: string, options: AppEnvironmentOptions = {}): Record<string, string> {
  const source = options.source ?? process.env;
  const env: Record<string, string> = {};
  // The allowlist above is checked against the secret pattern too: a future name that looks like
  // a credential must not travel just because someone added it to a list of paths.
  for (const key of APP_ENV_NAMES) {
    if (source[key] !== undefined && !SECRET_PATTERN.test(key)) env[key] = source[key]!;
  }
  const layout = layoutFor(id);
  env.PANOMA_VIDEO_HOME = layout.data;
  env.PLAYWRIGHT_BROWSERS_PATH = layout.browsers;
  env.PANOMA_VIDEO_BRAIN = options.brain ?? "none";
  if (options.maxBrainCalls !== undefined) {
    if (!Number.isInteger(options.maxBrainCalls) || options.maxBrainCalls < 0 || options.maxBrainCalls > 1_000) throw new AppFault("invalid-brain-budget");
    // One name. The app used to read either, which is two contracts for one number.
    env.PANOMA_VIDEO_MAX_BRAIN_CALLS = String(options.maxBrainCalls);
  }
  if (options.jobId) env.PANOMA_APP_JOB = options.jobId;
  for (const [key, value] of Object.entries(options.providerEnv ?? {})) {
    if (!PROVIDER_KEYS.has(key)) throw new AppFault("provider-key-not-allowed");
    if (value) env[key] = value;
  }
  return env;
}

export const appEnvironment = buildAppEnvironment;

/*
  The handshake asks the app what it can do, and on a cold machine that answer is not instant:
  a first browser launch behind an antivirus can take most of a minute, and refusing at twenty
  seconds turned a slow machine into a failed installation reported as `does-not-start`.
 */
export const GUIDE_TIMEOUT_MS = 60_000;
/** A browser download is watched for silence, with a distant absolute ceiling behind it. */
export const BROWSER_IDLE_MS = 5 * 60_000;
export const BROWSER_TOTAL_MS = 2 * 60 * 60_000;

export const TOOL_TIMEOUT_MS: Readonly<Record<string, number>> = {
  panoma_video_auto: 30 * 60_000,
  panoma_video_render: 30 * 60_000,
  panoma_video_revise: 5 * 60_000,
  panoma_video_review: 5 * 60_000,
  panoma_video_scout: 2 * 60_000,
  panoma_video_story: 5 * 60_000,
  panoma_video_guide: GUIDE_TIMEOUT_MS,
};
