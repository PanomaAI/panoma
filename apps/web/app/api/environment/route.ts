import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sameOrigin } from "@/lib/guard";
import { resolveExecutable } from "@panoma/core";

const run = promisify(execFile);

/**
 * What runtimes are installed on this machine.
 *
 * A project from two years ago declares `sdk: >=2.17.0 <3.0.0` and today you have Dart 3.10: it
 * doesn't start, and the error it gives doesn't mention any version. Panoma already knows what the
 * project requires; this is the other half of the comparison.
 *
 * It is a property of the machine and not of each project, so it is checked once and works for all
 * eighty. It is cached for a minute because installing a runtime in the middle of a session is
 * unusual, but not impossible.
 *
 * The list of tools is fixed and does not take a single byte from the person asking —that’s why it
 * remains exempt from `localOperatorOnly`: it is to detect, not to obey—, but even so it carries
 * `sameOrigin`. There are eight processes per request with an eight-second cap each, and without
 * the safeguard any page open in another tab could request them in a loop. “Does not obey” is not
 * the same as “costs nothing”.
 */

const TOOLS: { id: string; name: string; command: string; args: string[] }[] = [
  { id: "node", name: "Node.js", command: "node", args: ["--version"] },
  { id: "flutter", name: "Flutter", command: "flutter", args: ["--version"] },
  { id: "dart", name: "Dart SDK", command: "dart", args: ["--version"] },
  { id: "python", name: "Python", command: "python3", args: ["--version"] },
  { id: "ruby", name: "Ruby", command: "ruby", args: ["--version"] },
  { id: "go", name: "Go", command: "go", args: ["version"] },
  { id: "rust", name: "Rust", command: "rustc", args: ["--version"] },
  { id: "php", name: "PHP", command: "php", args: ["--version"] },
];

export async function GET(request: Request) {
  const blocked = sameOrigin(request);
  if (blocked) return blocked;

  const entries = await Promise.all(
    TOOLS.map(async (tool) => {
      try {
        /*
          By `resolveExecutable`, which is what is missing in Windows and was missing here.
          There `flutter` and `dart` are installed as `flutter.bat` and `dart.bat`, and `execFile`
          does not find them by their plain name: `PATHEXT` does not apply and it does not know
          that a `.bat` has to read `cmd.exe`. So on Windows this panel marked both as "not
          installed" **always**, with Flutter in front on the disk. It is the only path in the
          repository that launched a binary without going through here, and there is CI on all
          three systems: Windows is a declared system, not a courtesy.
         */
        const launch = resolveExecutable(tool.command, tool.args);
        const { stdout, stderr } = await run(launch.file, launch.args, { timeout: 8_000 });
        // `dart --version` writes to stderr in some versions, and `flutter --version` outputs five
        // lines: the version is the first number with dots that appears.
        const version = /(\d+\.\d+(?:\.\d+)?)/.exec(`${stdout}\n${stderr}`)?.[1];
        return [tool.id, { name: tool.name, version: version ?? null }] as const;
      } catch {
        // Not installed, or not on the server's PATH. It is reported as absent, which is what the
        // user needs to know; distinguishing between both cases would not change what to do.
        return [tool.id, { name: tool.name, version: null }] as const;
      }
    }),
  );

  return Response.json(
    { tools: Object.fromEntries(entries) },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
