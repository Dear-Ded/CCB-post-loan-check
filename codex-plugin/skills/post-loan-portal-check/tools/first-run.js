const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");

function requireInvestigationMode() {
  const candidates = [
    "../packages/core-skill/scripts/framework/investigation_mode",
    "./framework/investigation_mode",
    "../scripts/framework/investigation_mode"
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error("Could not load investigation_mode module.");
}

const { InvestigationMode } = requireInvestigationMode();

const MODES = [
  {
    value: InvestigationMode.STANDARD,
    label: "Standard",
    description: "Stable baseline mode for routine checks."
  },
  {
    value: InvestigationMode.ENHANCED,
    label: "Enhanced",
    description: "Recommended default. Balances success rate, performance, and guardrails."
  },
  {
    value: InvestigationMode.DEEP,
    label: "Deep",
    description: "Broader source coverage, session reuse, stronger retries, and deeper related-subject checks."
  },
  {
    value: InvestigationMode.EXPERT,
    label: "Expert",
    description: "Most aggressive auditable success-first profile for advanced users. Requires risk confirmation."
  }
];

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function commandStatus(command, args) {
  if (!command) return false;
  const result = spawnSync(command, args, { stdio: "ignore" });
  return result.status === 0;
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function bundledRuntimeRoot() {
  return path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies");
}

function resolvePythonExe() {
  const runtimeRoot = bundledRuntimeRoot();
  const candidates = [
    process.env.POST_LOAN_PYTHON_EXE,
    path.join(runtimeRoot, "python", "python.exe"),
    path.join(runtimeRoot, "python", "bin", "python3"),
    "/usr/bin/python3",
    "/usr/bin/python"
  ].filter(Boolean);
  const existing = firstExisting(candidates);
  if (existing) return existing;
  for (const command of ["python3", "python", "py"]) {
    if (commandStatus(command, ["--version"])) return command;
  }
  return "";
}

function resolvePowerShellExe() {
  if (commandStatus("powershell.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"])) return "powershell.exe";
  if (commandStatus("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"])) return "pwsh";
  return "";
}

function defaultStateDir() {
  return path.join(os.homedir(), ".ccb-post-loan");
}

function stateFile(stateDir) {
  return path.join(stateDir, "first-run-state.json");
}

function isInteractive(args) {
  if (args.nonInteractive || args.yes) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return MODES.some((item) => item.value === mode) ? mode : "";
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function chooseMode(args) {
  const requested = normalizeMode(args.mode || process.env.POST_LOAN_INVESTIGATION_MODE);
  if (requested) return requested;
  if (!isInteractive(args)) return InvestigationMode.ENHANCED;

  console.log("Welcome to CCB Post-loan Query.");
  console.log("Choose a startup mode:");
  MODES.forEach((item, index) => {
    const suffix = item.value === InvestigationMode.ENHANCED ? " (default)" : "";
    console.log(`${index + 1}. ${item.label}${suffix}: ${item.description}`);
  });
  const answer = String(await ask("Enter a number, or press Enter for Enhanced: ")).trim();
  const index = Number(answer || "2") - 1;
  return MODES[index]?.value || InvestigationMode.ENHANCED;
}

async function confirmPrivilegedMode(mode, args) {
  if (mode !== InvestigationMode.DEEP && mode !== InvestigationMode.EXPERT) return true;
  if (args.accept || args.yes) return true;
  if (!isInteractive(args)) return false;

  const label = mode === InvestigationMode.EXPERT ? "Expert" : "Deep";
  console.log("");
  console.log(`${label} mode enables broader source coverage, stronger retries, session reuse, related-subject expansion, and authorized low-risk image text recognition.`);
  console.log("The system still keeps source admission, evidence validation, and audit logs enabled. It never creates demo reports, synthetic screenshots, or invented data.");
  console.log("Confirm that you understand source terms, access frequency, account state, and compliance responsibility.");
  const answer = String(await ask("Type YES to enable it. Any other input falls back to Enhanced: ")).trim();
  return answer === "YES";
}

function initializeFirstRun(mode, acceptedPrivileged) {
  const stateDir = defaultStateDir();
  const outputRoot = path.join(stateDir, "first-run");
  const profileRoot = process.env.POST_LOAN_PROFILE_ROOT || path.join(outputRoot, ".post-loan-profiles");
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(profileRoot, { recursive: true });

  const providerFile = process.env.POST_LOAN_JUDICIAL_PROVIDER_FILE || "";
  const providerReady = Boolean(providerFile && fs.existsSync(providerFile));
  const pythonExe = resolvePythonExe();
  const powershellExe = resolvePowerShellExe();
  const initState = {
    initializedAt: new Date().toISOString(),
    outputRoot,
    profileRoot,
    providerReady,
    providerFile: providerReady ? providerFile : "",
    mode,
    privilegedModeConfirmed: acceptedPrivileged,
    runtime: {
      node: process.execPath,
      python: pythonExe,
      powershell: powershellExe
    },
    checks: {
      node: commandStatus(process.execPath, ["--version"]),
      powershell: commandStatus(powershellExe, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]),
      python: commandStatus(pythonExe, ["--version"])
    },
    note: "First run performs real environment initialization only. It never creates sample or synthetic reports."
  };

  fs.writeFileSync(stateFile(stateDir), JSON.stringify(initState, null, 2), "utf8");
  return initState;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let mode = await chooseMode(args);
  let acceptedPrivileged = false;
  if (mode === InvestigationMode.DEEP || mode === InvestigationMode.EXPERT) {
    acceptedPrivileged = await confirmPrivilegedMode(mode, args);
    if (!acceptedPrivileged) mode = InvestigationMode.ENHANCED;
  }

  const state = initializeFirstRun(mode, acceptedPrivileged);
  const setModeScript = fs.existsSync(path.join(process.cwd(), "tools", "set-investigation-mode.js"))
    ? path.join("tools", "set-investigation-mode.js")
    : path.join(__dirname, "set-investigation-mode.js");
  const setArgs = [setModeScript, "--mode", mode];
  if (acceptedPrivileged) setArgs.push("--accept");
  const result = spawnSync(process.execPath, setArgs, { stdio: "inherit" });

  console.log("First-run initialization completed.");
  console.log(`Mode: ${mode}`);
  console.log(`Output directory: ${state.outputRoot}`);
  console.log(`Browser session directory: ${state.profileRoot}`);
  console.log(`Authorized judicial provider: ${state.providerReady ? "configured" : "not configured"}`);
  console.log(`Python runtime: ${state.runtime.python || "not found"}`);
  console.log("Formal outputs must come from real portal screenshots or configured authorized data sources. No samples, placeholders, or invented data.");
  process.exit(result.status || 0);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
