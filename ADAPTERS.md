# Agent Adapter Matrix

## Codex

- Plugin directory: `codex-plugin/`
- Core skill: `codex-plugin/skills/post-loan-portal-check/`
- Display name: `CCB贷前贷后查询`

Codex should ask once at startup for any required login, page challenge confirmation, medical-source inclusion, and optional person execution checks. After that, the task should continue automatically and produce Word output.

## WorkBuddy

WorkBuddy targets non-technical users:

- Supported surface: WorkBuddy desktop on Windows only.
- Collect company names, optional unified social credit codes, medical-entity flag, and optional legal representative/controller person checks.
- Run preflight before the task.
- Open a visible browser only when a required source needs user confirmation.
- For batch work, collect final Word files in `reports` and keep evidence in `evidence`.
- Do not expose a WorkBuddy mobile/Linux entrypoint. Mobile Linux office tasks should use the Doubao App adapter.

## Doubao Office Task

Doubao can run the same contract through local browser automation, remote browser tasks, app office-task Linux runtime, or cloud/PC workers.

- Doubao App mobile office-task mode runs on Linux/Ubuntu and should call `packages/doubao/run_doubao_app.sh`.
- The execution side must return Word, a `reports` folder, or a download link.
- Evidence remains archived for audit.

## Boundary

- Login and page challenge confirmation are handled by user takeover or managed source policy.
- Result pages must be confirmed before screenshots.
- Judicial and execution sources are required for formal delivery.
- Never simulate, invent, or fill missing evidence with fabricated content.
