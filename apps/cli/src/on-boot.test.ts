import { describe, expect, it } from "vitest";
import { bootPlan, type BootInput } from "./on-boot";

/**
 * The three systems are checked from any of the three.
 *
 * A startup service fails in the worst possible place: on someone else's machine, when logging in,
 * with no one around and without saying anything — you find out because the catalog is missing.
 * And it can only be tested manually once per system. So what is being recorded here is the exact
 * text that is typed and the exact command that is executed, which is where this kind of failure
 * lives: a quote, a space, a percent sign.
 */

const BASE: BootInput = {
  platform: "linux",
  node: "/usr/bin/node",
  program: "/opt/panoma/dist/index.js",
  api: "http://localhost:4173",
  log: "/home/jesus/.panoma/logs/web.log",
  home: "/home/jesus",
  path: "/usr/local/bin:/usr/bin",
  panomaHome: "/home/jesus/.panoma",
};

describe("donde no está escrito, no se inventa", () => {
  it("devuelve nada en un sistema que no conoce", () => {
    // The fact that there is no plan is what allows one to say 'it's not ready for FreeBSD yet'
    // instead of installing a service that would never start.
    expect(bootPlan({ ...BASE, platform: "freebsd" })).toBeUndefined();
  });
});

describe("macOS: un LaunchAgent", () => {
  const plan = bootPlan({
    ...BASE,
    platform: "darwin",
    node: "/usr/local/bin/node",
    home: "/Users/jesus",
    uid: 501,
  })!;

  it("va donde launchd lo busca", () => {
    expect(plan.file).toBe("/Users/jesus/Library/LaunchAgents/dev.panoma.web.plist");
  });

  it("arranca «panoma up» y no Next", () => {
    expect(plan.content).toContain("<string>up</string>");
    expect(plan.content).toContain("<string>/opt/panoma/dist/index.js</string>");
    expect(plan.content).toContain("<key>RunAtLoad</key><true/>");
  });

  it("descarga antes de cargar, para poder reinstalar", () => {
    // The `bootout` goes in `before` because it almost always fails —nothing was loaded— and that
    // is not an error: putting it in `activate` would make reinstalling seem to break.
    expect(plan.before.map((paso) => paso.args[0])).toEqual(["bootout"]);
    expect(plan.activate.map((paso) => paso.args[0])).toEqual(["bootstrap"]);
    expect(plan.activate[0]?.fallback?.args).toEqual(["load", "-w", plan.file]);
  });

  it("escapa lo que rompería el XML entero", () => {
    const raro = bootPlan({ ...BASE, platform: "darwin", root: "/Users/jesus/a & b" })!;
    expect(raro.content).toContain("<string>/Users/jesus/a &amp; b</string>");
    expect(raro.content).not.toContain("a & b<");
  });
});

describe("Linux: una unidad de systemd de usuario", () => {
  const plan = bootPlan(BASE)!;

  it("va donde systemctl --user la busca", () => {
    expect(plan.file).toBe("/home/jesus/.config/systemd/user/panoma.service");
  });

  it("se engancha al arranque de la sesión", () => {
    expect(plan.content).toContain("WantedBy=default.target");
    expect(plan.before).toEqual([]);
    expect(plan.activate).toEqual([
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", "panoma.service"] },
    ]);
  });

  it("entrecomilla cada argumento, que es lo que salva las rutas con espacios", () => {
    const conEspacios = bootPlan({ ...BASE, program: "/home/jesus/mis cosas/index.js" })!;
    expect(conEspacios.content).toContain('ExecStart="/usr/bin/node" "/home/jesus/mis cosas/index.js" up --api "http://localhost:4173"');
  });

  it("dobla el porcentaje, que en systemd abre un especificador", () => {
    // `%h` is the personal folder. Without folding, a '100% finished' folder turns into a different
    // path without any warning.
    const conPorciento = bootPlan({ ...BASE, root: "/home/jesus/100% terminado" })!;
    expect(conPorciento.content).toContain("WorkingDirectory=/home/jesus/100%% terminado");
  });

  it("no entrecomilla WorkingDirectory, que es donde la comilla rompe la unidad entera", () => {
    /*
      `systemd-analyze verify` said it, not a reading of the documentation: with quotes, systemd
      responds «path is not absolute», marks the unit with «fatal error» and does not start it.
      And a path with spaces does not need them: in the options that take a path and nothing else,
      the value is the rest of the line.
     */
    const conEspacios = bootPlan({ ...BASE, root: "/home/jesus/mis cosas/panoma" })!;
    expect(conEspacios.content).toContain("WorkingDirectory=/home/jesus/mis cosas/panoma");
    expect(conEspacios.content).not.toContain('WorkingDirectory="');
  });

  it("no manda el registro a un fichero, que pediría systemd 240", () => {
    // `append:` does not exist in the old systemd and the unit would not start: a hard failure for
    // convenience. What the server says already goes to the log written by `panoma up`.
    expect(plan.content).toContain("StandardOutput=journal");
    expect(plan.content).not.toContain("append:");
  });
});

describe("Windows: una tarea al iniciar sesión", () => {
  const plan = bootPlan({
    ...BASE,
    platform: "win32",
    node: "C:\\Program Files\\nodejs\\node.exe",
    program: "C:\\Users\\jesus\\AppData\\Roaming\\npm\\panoma\\dist\\index.js",
    home: "C:\\Users\\jesus",
    panomaHome: "C:\\Users\\jesus\\.panoma",
    log: "C:\\Users\\jesus\\.panoma\\logs\\web.log",
    path: "C:\\Program Files\\nodejs;C:\\Windows\\system32",
  })!;

  it("escribe un envoltorio y le pasa a schtasks una sola ruta", () => {
    // `schtasks` puts whatever you give it in an XML with its own quotation rules and a length
    // limit: with «C:\Program Files» inside, the task is created split and fails to log in without
    // saying anything.
    expect(plan.file).toBe("C:\\Users\\jesus\\.panoma\\on-boot.cmd");
    expect(plan.activate).toEqual([
      {
        command: "schtasks",
        args: [
          "/Create",
          "/TN",
          "Panoma",
          "/TR",
          "C:\\Users\\jesus\\.panoma\\on-boot.cmd",
          "/SC",
          "ONLOGON",
          "/F",
        ],
      },
    ]);
  });

  it("entrecomilla las rutas dentro del envoltorio", () => {
    expect(plan.content).toContain('"C:\\Program Files\\nodejs\\node.exe"');
    expect(plan.content).toContain('up --api "http://localhost:4173"');
  });

  it("es un fichero de Windows: saltos CRLF", () => {
    // A `.cmd` with Unix line breaks almost always works and fails exactly where it can't be seen.
    expect(plan.content).toContain("\r\n");
    expect(plan.content.split("\r\n")[0]).toBe("@echo off");
  });

  it("dobla el porcentaje, que en un .cmd abre una variable", () => {
    const conPorciento = bootPlan({
      ...BASE,
      platform: "win32",
      panomaHome: "C:\\Users\\jesus\\.panoma",
      root: "C:\\Users\\jesus\\100% terminado",
    })!;
    expect(conPorciento.content).toContain('cd /d "C:\\Users\\jesus\\100%% terminado"');
  });
});
