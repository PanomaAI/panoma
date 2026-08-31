import { createInterface } from "node:readline";
import pc from "picocolors";
import type { Flags } from "./args";
import { say, type MessageKey } from "./messages";
import {
  NoCredentialError,
  PROVIDERS,
  configPath,
  complete,
  detectCliAgents,
  findProvider,
  maskKey,
  providersByAuth,
  readConfig,
  resolveCredential,
  updateConfig,
  type AiConfig,
} from "@panoma/ai";

/**
 * `panoma ai` — connect a model, or see why there isn't one yet.
 *
 * The state is grouped by the way of connecting and not by manufacturer, which is the interface
 * decision of the Model page, and for the same reason: 'log in with what you already have' and
 * 'paste a key' are two different gestures, with two different audiences, and mixing them in a
 * single list of twenty names forces you to read them all to understand which one applies to you.
 */

/**
 * This command no longer parses anything: it receives what `parseArgs` understood.
 *
 * Here lived a `VALUE_FLAGS`, a `positionalsOf`, and a `readFlag` —a handmade pocket parser— and
 * its own comment warned that this filter "should never be written by hand," because it had
 * already made `panoma ai ask "hola" --provider local` literally ask "hello local."
 *
 * The notice fell short. Two parsers not only make different mistakes: one of the two runs first.
 * `parseArgs` did not recognize `--model` or `--provider`, so it rejected them with 'Unknown
 * option' and this file never got to read them. They were implemented and inaccessible. Now there
 * is a single parser, and as a bonus `--model=x` works the same as `--model x`, which is something
 * the pocket one didn't know how to do.
 */
export async function aiCommand(parsed: Flags): Promise<number> {
  const [, sub, ...rest] = parsed.positionals;

  switch (sub) {
    case undefined:
    case "status":
      return showStatus();
    case "use":
      return useProvider(rest[0], parsed.model);
    case "key":
      return storeKey(rest[0]);
    case "ask":
      return ask(rest.join(" "), parsed.provider);
    default:
      process.stderr.write(
        pc.red(`${say("ai.unknownSub", { sub })}\n`) + `${say("ai.unknownSubHint")}\n`,
      );
      return 1;
  }
}

async function showStatus(): Promise<number> {
  const config = await readConfig();
  const agents = await detectCliAgents(providersByAuth("cli"));

  const out = process.stdout;
  out.write(`\n${pc.bold(say("ai.activeProvider"))}\n`);

  if (!config.provider) {
    out.write(`  ${pc.yellow(say("ai.none"))}\n`);
  } else {
    try {
      const credential = await resolveCredential(config.provider, config);
      const source = say(`ai.source.${credential.source}` as MessageKey);
      const detail = credential.apiKey
        ? say("ai.keyDetail", { masked: maskKey(credential.apiKey), source })
        : source;
      out.write(
        `  ${pc.green("●")} ${credential.provider.name}  ${pc.dim(credential.model || say("ai.defaultModel"))}  ${pc.dim(detail)}\n`,
      );
    } catch (error) {
      const { detail, hint } = credentialProblem(error);
      out.write(`  ${pc.red("●")} ${config.provider} — ${detail}\n`);
      if (hint) out.write(`      ${pc.dim(hint)}\n`);
    }
  }

  out.write(
    `\n${pc.bold(say("ai.useSubscription"))}  ${pc.dim(say("ai.useSubscriptionNote"))}\n`,
  );
  for (const { provider, installed, version, broken } of agents) {
    /*
      "'Not installed' and 'it is on and does not start' are not the same."
      With Codex in PATH and its vendorized binary absent, Panoma said 'not installed' and its
      owner saw it with `which codex`. The correct word saves the half hour of looking for an
      installation that is already there.
     */
    const mark = installed ? pc.green("✓") : broken ? pc.yellow("!") : pc.dim("·");
    const state = installed
      ? pc.dim(version ?? say("ai.installed"))
      : broken
        ? pc.yellow(say("ai.agentBroken"))
        : pc.dim(say("ai.notInstalled"));
    out.write(`  ${mark} ${provider.id.padEnd(12)} ${provider.name.padEnd(16)} ${state}\n`);
  }

  out.write(`\n${pc.bold(say("ai.withKey"))}\n`);
  for (const provider of providersByAuth("api-key")) {
    const fromEnv = (provider.apiKeyEnvVars ?? []).find((name) => process.env[name]);
    const stored = config.keys?.[provider.id];
    const mark = fromEnv || stored ? pc.green("✓") : pc.dim("·");
    const state = fromEnv
      ? pc.dim(say("ai.fromEnv", { name: fromEnv }))
      : stored
        ? pc.dim(say("ai.storedKey", { masked: maskKey(stored) }))
        : pc.dim(provider.signupUrl ?? "");
    out.write(`  ${mark} ${provider.id.padEnd(12)} ${provider.name.padEnd(16)} ${state}\n`);
  }

  out.write(`\n${pc.dim(say("ai.configAt", { path: configPath() }))}\n`);
  out.write(
    `${pc.dim(say("ai.onDemand"))}\n\n`,
  );
  return 0;
}

async function useProvider(id: string | undefined, model?: string): Promise<number> {
  if (!id) {
    process.stderr.write(
      pc.red(`${say("ai.missingProvider")}\n`) +
        `${say("ai.available", { list: PROVIDERS.map((p) => p.id).join(", ") })}\n`,
    );
    return 1;
  }
  const provider = findProvider(id);
  if (!provider) {
    process.stderr.write(pc.red(`${say("ai.unknownProvider", { id })}\n`));
    return 1;
  }

  // `updateConfig` and not read-and-write by hand: between reading and writing there is another
  // `panoma ai key` keeping a key, and that key would disappear without a trace.
  const next = await updateConfig((config) => {
    const updated: AiConfig = { ...config, provider: provider.id };
    // Changing the provider invalidates the previous model: `gpt-5` does not exist in Anthropic.
    // Dragging it would give a 404 with a message that does not point to the real cause.
    if (model) updated.model = model;
    else if (config.provider !== provider.id) delete updated.model;
    return updated;
  });

  process.stdout.write(
    `${pc.green("✓")} ${say("ai.chosenProvider", { name: provider.name })}` +
      say("ai.chosenModel", {
        model: next.model ?? provider.defaultModel ?? say("ai.sessionModel"),
      }) +
      "\n",
  );

  // Saying now that the credential is missing is better than letting it fail at the first
  // consultation.
  try {
    await resolveCredential(provider.id, next);
  } catch (error) {
    process.stdout.write(`${pc.yellow("!")} ${(error as Error).message}\n`);
  }
  return 0;
}

async function storeKey(id: string | undefined): Promise<number> {
  const provider = id ? findProvider(id) : undefined;
  if (!provider || provider.auth !== "api-key") {
    process.stderr.write(
      pc.red(`${say("ai.keyUsage")}\n`) +
        `${say("ai.keyProviders", { list: providersByAuth("api-key").map((p) => p.id).join(", ") })}\n`,
    );
    return 1;
  }

  // The key is requested via stdin and never as an argument: in argv it ends up in the shell
  // history and in the process list, visible to any other user of the machine.
  process.stdout.write(
    `${say("ai.pasteKey", { name: provider.name })} ${pc.dim(say("ai.pasteKeyNote"))}\n> `,
  );

  const key = await readSecret();
  if (!key) {
    process.stderr.write(pc.red(`\n${say("ai.keyEmpty")}\n`));
    return 1;
  }

  const { saveKey } = await import("@panoma/ai");
  await saveKey(provider.id, key);
  process.stdout.write(
    `\n${pc.green("✓")} ${say("ai.saved", { masked: maskKey(key), name: provider.name, path: configPath() })}\n` +
      pc.dim(`  ${say("ai.notEncrypted")}\n`),
  );
  return 0;
}

/** Read a line from stdin without echoing what was typed. */
function readSecret(): Promise<string> {
  return new Promise((resolve) => {
    const input = process.stdin;
    const rl = createInterface({ input, output: process.stdout, terminal: true });
    const wasRaw = input.isTTY;
    if (wasRaw) {
      // `output.write` in a readline with terminal:true reprints what is written; silencing it here
      // is what prevents the key from staying on the screen and in the scrollback.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function ask(prompt: string, provider?: string): Promise<number> {
  if (!prompt) {
    process.stderr.write(pc.red(`${say("ai.askUsage")}\n`));
    return 1;
  }

  try {
    const started = Date.now();
    const result = await complete({ prompt, provider, maxTokens: 1024 });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    process.stdout.write(`\n${result.text}\n`);
    process.stdout.write(
      pc.dim(
        `\n— ${result.provider} · ${result.model} · ${seconds}s` +
          (result.usage ? ` · ${result.usage.input}→${result.usage.output} tokens` : "") +
          "\n",
      ),
    );
    return 0;
  } catch (error) {
    process.stderr.write(pc.red(`${(error as Error).message}\n`));
    return 1;
  }
}

/**
 * Why there is no credential, and what to do — in the terminal's language.
 *
 * It is the same distribution that `apps/web/lib/model-errors.ts` does, and for the same reason:
 * 'X's credential is missing' is not said by any provider, it is said by Panoma, and Panoma speaks
 * the language of whoever is in front of them. `NoCredentialError` travels typed from `@panoma/ai`
 * with the entire provider inside, so the remedy is written here without guessing anything about
 * the error text.
 *
 * What is not to be touched: any other error. A 429 from the provider or a downed network are
 * indeed someone else's words or technical detail, and rewriting them would be inventing what
 * someone else said.
 */
function credentialProblem(error: unknown): { detail: string; hint?: string } {
  if (error instanceof NoCredentialError) {
    const { provider } = error;
    const hint =
      provider.auth === "cli"
        ? say("ai.hintCli", { name: provider.name, command: provider.command ?? provider.id })
        : provider.auth === "oauth"
          ? say("ai.hintOauth", { name: provider.name, id: provider.id })
          : say("ai.hintKey", { id: provider.id, url: provider.signupUrl ?? "" });
    return { detail: say("ai.noCredential", { name: provider.name }), hint };
  }
  return { detail: (error as Error).message ?? String(error) };
}
