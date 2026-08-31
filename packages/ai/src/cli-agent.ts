import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Provider } from "./providers";
import { redact } from "./safety";
import { resolveExecutable } from "@panoma/core";
import { AiError, failureMessage } from "./failures";

const run = promisify(execFile);

/**
 * Delegate to an already installed agent: the 'subscription' route without storing credentials.
 *
 * It is the external process as a full-fledged type of authentication, and the most sensible piece
 * of all those studied for what Panoma needs. The reasoning: if the user already pays for Claude
 * Pro and already has `claude` with an active session, the correct way to take advantage of that
 * subscription is not to replicate the login with another product's client_id — it is to ask their
 * own tool to do the work.
 *
 * Consequences, all good: Panoma never sees a token, there is nothing that can be leaked from our
 * disk, we do not depend on someone else's OAuth identifier that can expire, and it works today
 * with what the user already has installed.
 *
 * The real cost: starting a process takes seconds, not milliseconds, and the output is loose text
 * without token usage or stop reason. It is useful for specific tasks, not for a tight loop.
 */

export interface AgentAvailability {
  provider: Provider;
  installed: boolean;
  /**
   * The executable that really responds: the one from PATH, or the one that lives inside an app.
   *
   * Whoever is going to launch the agent has to use **this** and not `provider.command`, because
   * they are not always the same. See `bundles` in `providers.ts`.
   */
  command?: string;
  /** First line of `--version`, when it responds. */
  version?: string;
  /**
   * It is in the PATH but `--version` does not respond.
   *
   * It's not the same as not having it, and confusing them leaves the user searching for what they
   * already installed. It happened with Codex on its author's machine: `/usr/local/bin/codex`
   * exists and its vendored binary does not, so Panoma was marked as missing and the user saw it in
   * PATH. Here, what was said when it failed is saved, which is the only thing that allows fixing
   * it.
   */
  broken?: string;
}

/** What the binary said when responding, or why it does not respond. */
type Probe =
  | { ok: true; version: string }
  | { ok: false; missing: true }
  | { ok: false; missing: false; said: string };

async function probe(command: string): Promise<Probe> {
  try {
    // `--version` instead of `which`: checking that the binary responds rules out broken links and
    // half-installed setups, which is the case that is most misleading.
    /*
      In Windows `claude` is `claude.cmd`, and `execFile` does not launch scripts: without this,
      `probe` would receive ENOENT and Panoma would say 'not installed' of the three agents that
      the user had installed. The real ENOENT — that of an agent that is not there — still comes
      in the same way, because what is not found is returned as is.
     */
    const launch = resolveExecutable(command, ["--version"]);
    const { stdout } = await run(launch.file, launch.args, { timeout: 15_000 });
    return { ok: true, version: stdout.trim().split("\n")[0] ?? "" };
  } catch (error) {
    const failure = error as Error & { code?: string | number; stderr?: string };
    if (failure.code === "ENOENT") return { ok: false, missing: true };
    const said = (failure.stderr || failure.message || "").trim().split("\n")[0] ?? "";
    return { ok: false, missing: false, said: said.slice(0, 160) || "no responde" };
  }
}

export async function detectCliAgents(providers: Provider[]): Promise<AgentAvailability[]> {
  return Promise.all(
    providers.map(async (provider) => {
      if (!provider.command) return { provider, installed: false };

      const first = await probe(provider.command);
      if (first.ok) {
        return { provider, installed: true, command: provider.command, version: first.version };
      }

      /*
        If the PATH one doesn't respond, it is searched within the apps that have it.
        The case that brought it: `/usr/local/bin/codex` existed, it was a link to the npm
        wrapper, and the native binary that this wrapper launches was not there — half-installed.
        Meanwhile, the ChatGPT app had a `codex` of 200 MB that worked perfectly. Panoma said 'not
        installed' for something that the user had twice.
        An agent inside a `.app` is not in the PATH and never will be: whoever installs the
        desktop application does not expect to have to export anything. Looking for it there is
        the difference between the button existing or not.
       */
      for (const bundled of provider.bundles ?? []) {
        const next = await probe(bundled);
        if (next.ok) {
          return { provider, installed: true, command: bundled, version: next.version };
        }
      }

      // Neither in the PATH nor in the apps. One distinguishes 'not there' from 'it's there but
      // doesn't start': the first is fixed by installing it, and the second, not.
      if (first.missing) return { provider, installed: false };
      return { provider, installed: false, broken: first.said };
    }),
  );
}

export interface CliRunOptions {
  /**
   * The executable to launch, when it is not that of PATH.
   *
   * It comes out of `detectCliAgents`, which has already checked which one responds. Without this,
   * an agent that only exists within a `.app` is detected fine and then fails when used — the most
   * unpleasant failure of all, because the button says it is there.
   */
  command?: string;
  timeoutMs?: number;
  cwd?: string;
}

/** Maximum we accept from an agent. More than this is a session, not a reply. */
const MAX_OUTPUT = 200_000;

export async function completeWithCliAgent(
  provider: Provider,
  prompt: string,
  options: CliRunOptions = {},
): Promise<string> {
  const command = options.command ?? provider.command;
  if (!command) throw new AiError({ code: "noCommand", provider: provider.name });

  return new Promise((resolve, reject) => {
    const launch = resolveExecutable(command, provider.args ?? []);
    const child = spawn(launch.file, launch.args, {
      cwd: options.cwd,
      // Without shell: the prompt is user text and can contain anything.
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_000) stderr += chunk.toString();
    });

    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 180_000);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new AiError({ code: "launchFailed", command, reason: error.message }));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout.trim());
      // An agent without a session started fails here, and its own message explains why much better
      // than anything we could come up with. The error output of an external process can bring
      // anything inside, including the credentials with which that agent authenticates. It is
      // crossed out before being shown.
      reject(
        new Error(
          redact(
            failureMessage({
              code: "exited",
              provider: provider.name,
              status: code ?? -1,
              output: stderr.trim().slice(0, 600),
            }),
          ),
        ),
      );
    });

    // The prompt goes through stdin and not through argv: it avoids the command line length limit
    // and a long prompt appearing entirely in `ps`.
    child.stdin.end(prompt);
  });
}
