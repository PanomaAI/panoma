import js from "@eslint/js";
import ts from "typescript-eslint";
import next from "eslint-config-next";
import globals from "globals";

/*
  Where there is React, which is no longer just a place.
  The rules of Next and React were pointed at `apps/web` by writing the glob three times. When
  `apps/site` was born — the public site, which came from inside the web — all three fell short at
  the same time, and the failure would have been silent: a `useEffect` without dependencies on the
  landing page does not break the typecheck or any test; it manifests as a screen that does not
  update. With the list in one place, the incoming application enters through a single line.
 */
const CON_REACT = ["apps/web/**/*.{ts,tsx}", "apps/site/**/*.{ts,tsx}"];

/*
  The linter, and what is asked of it.
  This project lived without any [linter] until the eve of opening, and adding it late has a known
  trap: either it spits out a thousand style warnings and no one looks at them, or it loosens so
  much that it says nothing. Here, the first thing that a linter does well and a typecheck cannot
  do is needed: excess code, captures that lose their cause, and the two rules of React hooks,
  which are the only ones in the whole set that catch runtime errors.
  What is NOT requested is formatting. There is no Prettier and there will not be one for now: the
  comments in this code are manually broken around 96 columns and that way is part of how it is
  read. A formatter redoes it and the diff becomes unreadable. The agreement is written in
  `CONTRIBUTING.md` and in `.editorconfig`.
 */
export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-*/**",
      // The packaged catalog: 79 MB of build output with node_modules inside.
      "apps/cli/app/**",
      "**/*.d.ts",
      ".artifacts/**",
      "private/**",
      "apps/web/qa/**",
    ],
  },

  js.configs.recommended,
  ...ts.configs.recommended,

  /*
    Next and React rules, only where there is React.
    Of everything it brings, what really matters are `react-hooks/rules-of-hooks` and
    `react-hooks/exhaustive-deps`: an effect that is missing a dependency does not fail the
    typecheck, it does not break any test, and it shows up as a screen that does not update. And
    it brings `@next/next/no-img-element`, which this code already silences in eight places with a
    written reason — until today those silences pointed to a rule that did not exist.
   */
  ...next.map((config) => ({ ...config, files: CON_REACT })),
  {
    /*
      `eslint-plugin-react` 7.37 does not start with ESLint 10: its rules call
      `context.getFilename()`, which was removed. Its own are turned off and the two families that
      matter remain and do work — `react-hooks/*` and `@next/next/*`.
      It is not a discount: of the rules of `react/*` that the set brings, none catch an execution
      flaw. The ones that do are the hooks, and those remain.
     */
    files: CON_REACT,
    rules: Object.fromEntries(
      ["display-name", "jsx-key", "no-children-prop", "no-danger-with-children",
       "no-deprecated", "no-direct-mutation-state", "no-find-dom-node", "no-is-mounted",
       "no-render-return-value", "no-string-refs", "no-unescaped-entities",
       "no-unknown-property", "prop-types", "require-render-return", "jsx-no-target-blank",
       "jsx-no-comment-textnodes", "jsx-no-duplicate-props", "jsx-no-undef", "jsx-uses-react",
       "jsx-uses-vars", "react-in-jsx-scope"].map((r) => [`react/${r}`, "off"]),
    ),
  },

  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      /*
        What is captured and rethrown has to say where it came from. Without `cause`, a network
        failure when reading a key reaches the top as 'could not read the key' and the original
        trace is lost along the way.
       */
      "preserve-caught-error": "error",

      /*
        The underscore in front is how you say 'I know, I don't use it' in TypeScript, and
        `ignoreRestSiblings` covers the language of taking keys out of an object to leave them OUT
        of the rest: `const { extensions, roots, ...rest } = source` is not carelessness, it is
        exactly the opposite.
       */
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],

      /*
        `do { … } while (true)` with its `break` inside is a loop written on purpose, not a
        careless constant condition. Loop checking is turned off and the one that really catches
        something remains: a `if (true)` that someone left on while debugging.
       */
      "no-constant-condition": ["error", { checkLoops: "none" }],

      /*
        Turned off, and with reason: it hunts the defensive initializer.
        `let salida = 0` in the packaging script, `let image = ""` in the twin path: the analyzer
        shows that all branches reassign before reading, so the initial value 'is not used.' True
        today. But that value is what holds the next branch that someone adds, and removing it
        changes a zero to a `undefined` that no one sees until `process.exit(undefined)`
        successfully exits a failure. The four cases in the repository are like that.
       */
      "no-useless-assignment": "off",
    },
  },

  {
    /*
      The rules of the React compiler: turned off, and this is a decision, not an oversight.
      `eslint-plugin-react-hooks` v6 brings the family that the React compiler needs
      —`set-state-in-effect`, `purity`, `immutability`— and they are much stricter than the two
      classic ones. Today they would point out twenty-two sites: fifteen for putting state inside
      an effect
      (which is how this app reads `localStorage` without breaking hydration, and it is deliberately
      written that way), four for calling `Date.now()` during rendering and three for reassigning an
      accumulator variable within a `.map()`.
      This application does not use the React compiler. Turning it on would mean rewriting those
      twenty-two sites to comply with a contract that gains nothing yet — and leaving them on
      'warning' would be worse: twenty-two warnings that no one looks at teach not to look at any.
      What IS on is what catches execution errors today: `rules-of-hooks`, `exhaustive-deps`, and
      `refs`. All three are green, and the last one really found a reference that was written
      during the render.
     */
    files: CON_REACT,
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      /* There is no `pages/` directory: this is the entire App Router. */
      "@next/next/no-html-link-for-pages": "off",
    },
  },

  {
    /*
      Those who speak with a terminal handle control characters on purpose: removing the color
      codes from someone else's output IS the job of these files. The rule exists to catch a
      `\x1b` written by mistake, and here everyone is on purpose.
     */
    files: ["apps/cli/src/safe-output.ts", "packages/enrich/src/http.ts"],
    rules: { "no-control-regex": "off" },
  },
];
