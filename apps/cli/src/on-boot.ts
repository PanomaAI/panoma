import { win32 } from "node:path";

/**
 * Leave the catalog open when logging in, on all three systems.
 *
 * What is installed does not start Next: it starts `panoma up`, which already knows if it is
 * necessary, where to write the registry, and which pid to keep. Duplicating that logic in an XML,
 * on a systemd unit, or in a `.cmd` — which no one is going to maintain and cannot be tested —
 * would be having three versions of the same decision, and all three would age on their own.
 *
 * This file only **contains the text and the command**, and does not execute anything. That
 * separation is what allows macOS to check that the systemd unit correctly escapes a `%` and that
 * the Windows task does not break with a space in the path. The alternative —finding out on
 * someone's machine, the day they log in and the catalog is not there— is what we had.
 */

export interface BootInput {
  platform: NodeJS.Platform;
  /** The Node binary that will run the program. */
  node: string;
  /** The `index.js` built from the CLI. Never the `.ts`: whoever starts this does not have tsx. */
  program: string;
  api: string;
  log: string;
  home: string;
  /** The `PATH` from now, which freezes: see the comment below. */
  path: string;
  /** The root of the monorepo, if it is being run inside one. */
  root?: string | undefined;
  /** The uid, which launchd needs to know which graphical session to attach it to. */
  uid?: number | undefined;
  /** `~/.panoma`, where the Windows wrapper lives. */
  panomaHome: string;
}

export interface Step {
  command: string;
  args: string[];
  /** What to try if this fails, before giving it up as lost. */
  fallback?: { command: string; args: string[] };
}

export interface BootPlan {
  /** The file that needs to be written, and what it contains. */
  file: string;
  content: string;
  /*
    The three activations are not alike, and that is why they are separated instead of in a list
    with hidden rules. `before` cleans whatever was there and it doesn’t matter if it fails —most
    of the time there was nothing—. `activate` has to go well, and one of its commands has a
    backup because in old macOS the modern one doesn’t exist.
   */
  before: Step[];
  activate: Step[];
  /** How to remove it, so I can tell the person who installs it. */
  remove: string;
  /** Where is the boot record, which is not in the same place in all three. */
  where: string;
}

const LAUNCHD_LABEL = "dev.panoma.web";
const SYSTEMD_UNIT = "panoma.service";
const TASK_NAME = "Panoma";

/**
 * What needs to be written and what needs to be executed, or `undefined` where it is not written.
 *
 * The `PATH` freezes in the text on all three systems, and it's not laziness: all three start the
 * services with a minimal environment where neither `pnpm` nor `node` from your version manager is
 * present. It's a snapshot of the day you installed it, so moving those tools around requires
 * running it again. The opposite — guessing the PATH at each startup — can't be done without
 * reading someone's shell configuration, which is a worse idea.
 */
export function bootPlan(input: BootInput): BootPlan | undefined {
  if (input.platform === "darwin") return macos(input);
  if (input.platform === "linux") return linux(input);
  if (input.platform === "win32") return windows(input);
  return undefined;
}

function macos(input: BootInput): BootPlan {
  const plist = `${input.home}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist`;
  const argv = [input.node, input.program, "up", "--api", input.api];
  const target = `gui/${input.uid ?? 501}`;

  const content = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key><string>${xml(LAUNCHD_LABEL)}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...argv.map((arg) => `    <string>${xml(arg)}</string>`),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>PATH</key><string>${xml(input.path)}</string>`,
    `  </dict>`,
    input.root ? `  <key>WorkingDirectory</key><string>${xml(input.root)}</string>` : "",
    `  <key>RunAtLoad</key><true/>`,
    `  <key>StandardOutPath</key><string>${xml(input.log)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(input.log)}</string>`,
    `</dict>`,
    `</plist>`,
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return {
    file: plist,
    content,
      before: [{ command: "launchctl", args: ["bootout", `${target}/${LAUNCHD_LABEL}`] }],
    activate: [
      {
        command: "launchctl",
        args: ["bootstrap", target, plist],
        // `bootstrap` is what's modern; `load -w` is what works on old macOS.
        fallback: { command: "launchctl", args: ["load", "-w", plist] },
      },
    ],
    remove: `launchctl bootout ${target}/${LAUNCHD_LABEL} && rm ${plist}`,
    where: input.log,
  };
}

function linux(input: BootInput): BootPlan {
  const unit = `${input.home}/.config/systemd/user/${SYSTEMD_UNIT}`;

  /*
    The log goes to the journal and not to a file. `StandardOutput=append:` has existed since
    systemd 240, and in an older one the unit **does not start**: a hard failure for convenience.
    And what really matters — what the server says — is already written by `panoma up` in its own
    log; this only collects what the boot says.
   */
  const content = [
    `[Unit]`,
    `Description=Panoma — the local catalog of your projects`,
    `After=default.target`,
    ``,
    `[Service]`,
    `Type=simple`,
    `ExecStart=${unitValue(input.node)} ${unitValue(input.program)} up --api ${unitValue(input.api)}`,
    `Environment=${unitValue(`PATH=${input.path}`)}`,
    input.root ? `WorkingDirectory=${unitPath(input.root)}` : "",
    `StandardOutput=journal`,
    `StandardError=journal`,
    ``,
    `[Install]`,
    `WantedBy=default.target`,
    ``,
  ]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");

  return {
    file: unit,
    content,
    before: [],
    activate: [
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", SYSTEMD_UNIT] },
    ],
    remove: `systemctl --user disable --now ${SYSTEMD_UNIT} && rm ${unit}`,
    where: `journalctl --user -u ${SYSTEMD_UNIT}`,
  };
}

function windows(input: BootInput): BootPlan {
  /*
    A `.cmd` wrapper and not the order placed inside `/TR`.
    `schtasks` puts whatever you give it into an attribute of the task's XML, with its own
    quotation rules and a length limit; a path with a space —"C:\Program Files\nodejs", which is
    the normal one— and the task is created split and fails when starting the session, without
    saying anything. With a one-line file, `schtasks` only needs to know a path, and the inner
    quotes are put in by this file, which can indeed be read and tested.
   */
  const wrapper = win32.join(input.panomaHome, "on-boot.cmd");
  const content = [
    `@echo off`,
    `rem Written by "panoma up --on-boot". Remove it with "schtasks /Delete /TN ${TASK_NAME} /F".`,
    `set "PATH=${cmdValue(input.path)}"`,
    input.root ? `cd /d "${cmdValue(input.root)}"` : "",
    `"${cmdValue(input.node)}" "${cmdValue(input.program)}" up --api "${cmdValue(input.api)}" >> "${cmdValue(input.log)}" 2>&1`,
    ``,
  ]
    .filter((line) => line !== "")
    .join("\r\n");

  return {
    file: wrapper,
    content,
    before: [],
    // `/F` so that reinstalling replaces instead of failing with 'task already exists'.
    activate: [
      {
        command: "schtasks",
        args: ["/Create", "/TN", TASK_NAME, "/TR", wrapper, "/SC", "ONLOGON", "/F"],
      },
    ],
    remove: `schtasks /Delete /TN ${TASK_NAME} /F`,
    where: input.log,
  };
}

/** A route with a `&` inside breaks the entire plist, and there are some. */
function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A value within a systemd unit.
 *
 * Three things that bite, and all three happen in real paths: `%` opens a specifier —`%h` is your
 * personal folder— so a folder called '100% finished' turns into another path without warning; the
 * backslash is the escape of the format itself; and the space separates arguments, which is
 * exactly what a path with spaces does not want.
 */
function unitValue(text: string): string {
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%");
  return `"${escaped}"`;
}

/**
 * A loose route within a unit, **without quotes**.
 *
 * `WorkingDirectory=` does not want them: yes, they are accepted `ExecStart=`, where arguments are
 * separated, and `Environment=`, where a value is wrapped with spaces — but in an option that
 * takes a path and nothing else, the quote counts as the first character of the path and systemd
 * responds «path is not absolute» and refuses to start the entire unit. `systemd-analyze verify`
 * said it about the three example units; without that check it would have been discovered on
 * someone else's machine, when logging in and with no one present.
 *
 * It is not necessary to put quotes around the spaces: in these options the value is the rest of
 * the line. The `%` does need to be doubled, that does not change.
 */
function unitPath(text: string): string {
  return text.replace(/%/g, "%%");
}

/** Inside a `.cmd`, the `%` opens an environment variable. It folds to become a `%`. */
function cmdValue(text: string): string {
  return text.replace(/%/g, "%%");
}
