import pc from "picocolors";

/**
 * The main help of the CLI: the first thing seen by someone who has just installed it.
 *
 * In a separate file for the same reason as `args.ts`: to be able to test it without running the
 * entire CLI.
 *
 * Command names are not translated and never were: a subcommand is the interface, just like a
 * flag, and it is typed the same everywhere. What did change on August 25, 2026, is that there are
 * no longer two helps: the CLI speaks English and only English. The reason is in the header of
 * `messages.ts`.
 */

const HELP = `
${pc.bold(pc.cyan("panoma"))} ${pc.dim("— the local catalog of your projects")}

${pc.bold("YOUR DAY")}
  panoma                       the day's report: what moved since you last looked
  panoma today                 the same thing, when you'd rather type it out
  panoma next                  what to do in each project, and the fact that picked it
                               (panoma next <project> <assignment> opens your agent on it)
  panoma north                 what “finished” means in each project, and how many don’t say
  panoma north <project> "…"   write it, or replace the one there after showing it to you
  panoma open <project>        open it in your editor (--folder · --terminal)
  panoma scan [path]           analyze one project, or every project under the path

${pc.bold("RITUALS")}
  panoma up                    start the catalog (--on-boot, so it starts itself)
  panoma up <folder>           start it and fill it from that folder, in one go
  panoma up --network          and open it to your local network, with a key
  panoma down                  stop it
  panoma enrich                fetch latest versions and vulnerabilities for the catalog
  panoma run <project> <package>  propose a dependency upgrade: installs it, runs the
                               tests, and leaves a branch with the patch for you to review
  panoma check <project>       does it still build? — installs and builds in isolation,
                               in a separate worktree, and the page remembers the verdict
  panoma agent-key <name>      create an agent key (--install writes it to .mcp.json)
  panoma hooks --install       record what agents do here without them having to report it
  panoma md check              what your CLAUDE.md claims that is no longer true
  panoma md fix                repair what repairs itself: the lies that left a trail
  panoma md init               adds a self-maintaining context block to AGENTS.md
                               (needs the catalog up, like md sync)
  panoma md sync               regenerate that block (needs the catalog up)

${pc.bold("DIAGNOSTICS")} ${pc.dim("(first-day questions)")}
  panoma disk                  how much disk the catalog takes and how much regenerates itself
  panoma search <text>         search the code of every project at once
  panoma secrets               credentials committed to your repositories
  panoma review [path]         what is wrong and provable without opening it: images that
                               do not say what they show, broken links, stray colours and
                               corners. No model, nothing spent
  panoma describe <project>    ask the model to explain what a project is about
  panoma md review             the model's opinion on your CLAUDE.md (paid)
  panoma ai                    which model Panoma uses and how to connect one
  panoma ai use <provider>     pick a provider (--model <name> to pin which one)
  panoma ai key <provider>     store an API key (read from stdin, never from an argument)
  panoma ai ask <question>     check that the connection works (--provider <which>)

${pc.bold("YOUR TWIN")} ${pc.dim("(what your agents already know about you)")}
  panoma twin sources          which agent histories are on this disk, how big they are
                               and which ones are permitted to be read
  panoma twin allow <source>   permit reading one: without it, not a file gets opened
  panoma twin revoke <source>  take it back
  panoma twin forget <source>  delete what was already stored from that source
  panoma twin mine             what reading the permitted ones yields: funnel and samples
                               (--source just one · --save stores them in the catalog)
  panoma twin verdicts         what got stored, by project: when, and what you said
  panoma twin distill          read those verdicts and pull out observations about your taste
                               (--dry-run shows what it would cost, without spending it)
  panoma twin synthesize       turn those observations into your portrait, without asking
  panoma twin taste            the portrait that came out, and how much budget is left
  panoma twin score            how often you correct it: the only mark Twin gives itself
  panoma twin design           what yours looks like: the palette, typefaces and corners
                               that repeat across your projects, with no model involved
  panoma twin look <project>   show it a screen and it names the rule of yours it breaks,
                               with the assignment already written (with no file, it takes
                               the latest from the .panoma/shots inbox your agents fill)

${pc.bold("OPTIONS")}
  --json                       print the raw analysis as JSON
  --out <file>                 write the JSON to a file
  --verbose, -v                show dependencies and the health breakdown
  --duplicates, -d             only the families of copies of the same project
  --save                       send the result to the catalog (needs the web app running)
  --api <url>                  catalog address (default http://localhost:4173)
  --folder                     with open, reveal the folder in the file browser
  --terminal                   with open, open a terminal already in the project
  --install                    with agent-key, write this folder's .mcp.json;
                               with hooks, set up the passive capture
  --remove                     with hooks, undo what --install left behind
  --on-boot                    with up, start it at login
  --force                      with enrich, skip the 24 h cache; with run, retry a
                               proposal that already failed; with north, replace blind the
                               north this terminal cannot read
  --security                   with run, upgrade to the version that fixes the most
                               severe vulnerability instead of the latest release
  --isolation <level>          local · hardened · container. Defaults to the strongest
                               one on this machine: a container when Docker or Podman is
                               available; otherwise hardened, which on macOS seals off
                               your home folder with sandbox-exec but leaves the network open
  --limit <n>                  with twin mine, how many are shown (--save stores them
                               all); with twin verdicts and twin distill, how many are read
  --project <path>             with twin mine, only the sessions under that path
  --source <source>            with twin mine, a single history instead of every permitted
                               one: claude-code, codex…; with twin verdicts, only the
                               verdicts that came out of it
  --dry-run                    with twin distill, stop at the estimate instead of spending
  --depth <n>                  how deep to look for projects (default 3)
  --no-git                     skip reading git (faster)
  --help, -h                   this help

${pc.bold("EXAMPLES")}
  panoma                       the first thing in the morning
  panoma next                  and the second: what to do, with the fact behind it
  panoma open cabeman          open cabeman in your editor
  panoma up --on-boot          keep the catalog alive without thinking about it
  panoma scan                  analyze the current directory
  panoma scan ~/Desktop        find and analyze every project underneath
  panoma scan . -v             full report with dependencies
  panoma scan ~/Desktop -d     find copies of the same project and tell which one is alive
  panoma scan ~/Desktop --save fill the catalog the web app reads
  panoma scan ~/dev --json --out portfolio.json
  panoma enrich                refresh versions and security advisories
  panoma enrich --force        also re-check what was checked less than 24 h ago
  panoma agent-key "Claude Code" --install   connect an agent to the catalog
  panoma run panoma typescript propose upgrading typescript in the panoma project
`;

export function helpText(): string {
  return HELP;
}
