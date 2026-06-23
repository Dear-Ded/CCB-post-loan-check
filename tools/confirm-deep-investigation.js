const { defaultConsentFile, writeConsent } = require("../packages/core-skill/scripts/framework/investigation_mode");

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

const args = parseArgs(process.argv.slice(2));
if (!args.accept) {
  console.error([
    "Deep investigation mode enables broader source coverage, optional low-risk image text recognition, session reuse, retries, and deeper graph expansion.",
    "Use it only when you have authorization and understand the source terms, access frequency, account, and compliance risks.",
    "Run again with --accept to store one-time local consent."
  ].join("\n"));
  process.exit(2);
}

const file = args.file || process.env.POST_LOAN_DEEP_CONSENT_FILE || defaultConsentFile();
const record = writeConsent(file, { acceptedBy: args.by || "local-user" });
console.log(JSON.stringify({ ok: true, file, acceptedAt: record.acceptedAt }, null, 2));
