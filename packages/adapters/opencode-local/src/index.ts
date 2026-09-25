export const type = "opencode_local";
export const label = "OpenCode";

// Use OpenCode's official installer instead of `npm install -g opencode-ai`.
// The npm package reifies four large Linux x64 prebuilt-binary subpackages
// (linux-x64, linux-x64-musl, linux-x64-baseline, linux-x64-baseline-musl) in
// parallel even though only one matches the sandbox; on bandwidth-constrained
// sandboxes (e.g. Cloudflare) that exceeded the 240s install budget. The
// official installer fetches a single arch-specific binary into
// `$HOME/.opencode/bin` and tries to add it to PATH via `~/.bashrc`. That
// rc-file path is only sourced by interactive/login shells, so non-login
// `sh -c` probe invocations (used by the runtime PATH check) cannot find the
// binary. We fix that by symlinking the installed binary into a directory on
// the non-login `sh -c` PATH: prefer `/usr/local/bin` (universally on the
// default PATH on Linux distros) when root or passwordless sudo is available,
// otherwise fall back to `$HOME/.local/bin` (which is on the default PATH on
// the exe.dev sandbox image and most modern home-managed Linux images).
//
// Security tradeoff: this is `curl | bash` without a SHA-256 verification of
// the install script. We accept this because:
//   1. The install runs inside an isolated, ephemeral sandbox — blast radius
//      is bounded to that sandbox's secrets and disk.
//   2. The prior `npm install -g opencode-ai` is also unverified code
//      execution from a third-party registry; this is not strictly worse.
//   3. OpenCode does not publish per-release SHA-256 checksums in a stable
//      location, and pinning a version + hash here would require manual
//      version bumps on every OpenCode release.
// The `set -e` (implied by Bash's default with `-fsSL` upstream of a piped
// shell) and `curl -fsSL` give us fail-fast behavior on HTTP errors. If
// OpenCode starts publishing a stable checksum/signature, switch to fetching
// a versioned tarball + verifying the digest before exec.
export const SANDBOX_INSTALL_COMMAND =
  'curl -fsSL https://opencode.ai/install | bash && ' +
  'if [ -x "$HOME/.opencode/bin/opencode" ]; then ' +
  'if [ "$(id -u)" -eq 0 ]; then ' +
  'ln -sf "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode; ' +
  'elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then ' +
  'sudo ln -sf "$HOME/.opencode/bin/opencode" /usr/local/bin/opencode; ' +
  'else ' +
  'mkdir -p "$HOME/.local/bin" && ' +
  'ln -sf "$HOME/.opencode/bin/opencode" "$HOME/.local/bin/opencode"; ' +
  'fi; ' +
  'fi';

export const DEFAULT_OPENCODE_LOCAL_MODEL = "openai/gpt-5.2-codex";

/**
 * The model Paperclip prefers for a fresh OpenCode agent.
 *
 * Reached through OpenRouter, whose ids carry the `openrouter/` prefix that
 * OpenCode uses as the provider segment. This is the only DeepSeek route
 * Paperclip ships: there is no first-class DeepSeek provider, so a key is
 * always an OpenRouter key and billing always lands on the OpenRouter account.
 */
export const PREFERRED_OPENCODE_MODEL = "openrouter/deepseek/deepseek-v4.1-flash";

/**
 * OpenRouter's DeepSeek models, offered when discovery has not run.
 *
 * OpenCode resolves these from its own catalog, but a remote environment never
 * runs `opencode models`, so the static list is what those hosts see.
 */
export const DEEPSEEK_OPENROUTER_MODELS = [
  { id: PREFERRED_OPENCODE_MODEL, label: "DeepSeek V4.1 Flash" },
  { id: "openrouter/deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
] as const;

/**
 * Whether an OpenRouter model id belongs to the DeepSeek family.
 *
 * Scoped to OpenRouter deliberately. A bare `deepseek/<model>` id is a
 * different route that bills DeepSeek directly, which this build does not
 * support, so adopting one would put an agent on a provider no key is
 * configured for.
 */
export function isDeepSeekOpenRouterModelId(id: string): boolean {
  const segments = id.trim().toLowerCase().split("/");
  // `openrouter/deepseek/<model>`: a model segment has to be present, so a
  // bare `openrouter/deepseek` is not a model.
  if (segments.length < 3 || !segments[2]) return false;
  return segments[0] === "openrouter" && segments[1] === "deepseek";
}

/**
 * Rank the DeepSeek variants so the most useful one wins.
 *
 * A general flash/chat model is the right default for an agent doing a mix of
 * work: reasoning variants are slower and cost more per token, so they are
 * preferred only when nothing else is offered.
 */
function deepSeekVariantRank(id: string): number {
  const model = id.trim().toLowerCase();
  if (model.includes("chat")) return 0;
  if (model.includes("flash")) return 1;
  if (model.includes("reason")) return 3;
  return 2;
}

/**
 * Pick the model to preselect for a fresh OpenCode agent.
 *
 * DeepSeek-over-OpenRouter when the catalog actually offers it — a discovered
 * model is the only evidence the provider is authenticated on this host, so
 * naming a hardcoded id over the catalog would preselect a model that cannot
 * run.
 *
 * The preference is by family rather than one exact id, because OpenRouter's
 * catalogue gains and retires DeepSeek variants; matching the family keeps the
 * default working as it moves, while the exact id still wins when present.
 *
 * Falls back to {@link DEFAULT_OPENCODE_LOCAL_MODEL}, then to an empty string
 * when the catalog is empty — discovery having failed is not evidence the
 * default is available, and the picker accepts a typed id for that case.
 */
export function resolvePreferredOpenCodeModel(
  models: ReadonlyArray<{ id: string }>,
): string {
  if (models.some((model) => model.id === PREFERRED_OPENCODE_MODEL)) {
    return PREFERRED_OPENCODE_MODEL;
  }
  const deepSeek = models
    .map((model) => model.id)
    .filter(isDeepSeekOpenRouterModelId)
    .sort((a, b) => deepSeekVariantRank(a) - deepSeekVariantRank(b) || a.localeCompare(b));
  if (deepSeek.length > 0) return deepSeek[0];
  return models.some((model) => model.id === DEFAULT_OPENCODE_LOCAL_MODEL)
    ? DEFAULT_OPENCODE_LOCAL_MODEL
    : "";
}

export function isValidOpenCodeModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  return Boolean(trimmed) && slashIndex > 0 && slashIndex !== trimmed.length - 1;
}

export const models: Array<{ id: string; label: string }> = [
  // Ahead of the OpenAI ids: this is the default the picker preselects, so it
  // belongs where a reader looks first.
  ...DEEPSEEK_OPENROUTER_MODELS,
  { id: DEFAULT_OPENCODE_LOCAL_MODEL, label: DEFAULT_OPENCODE_LOCAL_MODEL },
  { id: "openai/gpt-6-astra", label: "openai/gpt-6-astra" },
  { id: "openai/gpt-6-sol", label: "openai/gpt-6-sol" },
  { id: "openai/gpt-6-luna", label: "openai/gpt-6-luna" },
  { id: "openai/gpt-5.6-sol", label: "openai/gpt-5.6-sol" },
  { id: "openai/gpt-5.6-terra", label: "openai/gpt-5.6-terra" },
  { id: "openai/gpt-5.6-luna", label: "openai/gpt-5.6-luna" },
  { id: "anthropic/claude-opus-5-5", label: "anthropic/claude-opus-5-5" },
  { id: "anthropic/claude-opus-5", label: "anthropic/claude-opus-5" },
  { id: "anthropic/claude-fable-5-1", label: "anthropic/claude-fable-5-1" },
  { id: "anthropic/claude-sonnet-5", label: "anthropic/claude-sonnet-5" },
  { id: "google/gemini-3.8-flash", label: "google/gemini-3.8-flash" },
  { id: "xai/grok-4.7", label: "xai/grok-4.7" },
  { id: "openai/gpt-5.5", label: "openai/gpt-5.5" },
  { id: "openai/gpt-5.4", label: "openai/gpt-5.4" },
  { id: "openai/gpt-5.4-mini", label: "openai/gpt-5.4-mini" },
  { id: "openai/gpt-5.2", label: "openai/gpt-5.2" },
  { id: "openai/gpt-5.1-codex-max", label: "openai/gpt-5.1-codex-max" },
  { id: "openai/gpt-5.1-codex-mini", label: "openai/gpt-5.1-codex-mini" },
];

export const agentConfigurationDoc = `# opencode_local agent configuration

Adapter: opencode_local

Use when:
- You want Paperclip to run OpenCode locally as the agent runtime
- You want provider/model routing in OpenCode format (provider/model)
- You want OpenCode session resume across heartbeats via --session

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- OpenCode CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- model (string, required): OpenCode model id in provider/model format (for example anthropic/claude-sonnet-4-5)
- variant (string, optional): provider-specific reasoning/profile variant passed as --variant (for example minimal|low|medium|high|xhigh|max)
- dangerouslySkipPermissions (boolean, optional): inject a runtime OpenCode config with \`permission=allow\` for all tools and connections; defaults to true for unattended Paperclip runs
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "opencode"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- OpenCode supports multiple providers and models. Use \
  \`opencode models\` to list available options in provider/model format.
- Paperclip requires an explicit \`model\` value for \`opencode_local\` agents.
- Runs are executed with: opencode run --format json ...
- Sessions are resumed with --session when stored session cwd matches current cwd.
- The adapter sets OPENCODE_DISABLE_PROJECT_CONFIG=true to prevent OpenCode from \
  writing an opencode.json config file into the project working directory. Model \
  selection is passed via the --model CLI flag instead.
- When \`dangerouslySkipPermissions\` is enabled, Paperclip injects a temporary \
  runtime config with \`permission=allow\` so headless runs do \
  not stall on approval prompts.
- Paperclip defaults new agents to an OpenRouter-sponsored DeepSeek model \
  (\`openrouter/deepseek/...\`). That route bills the OpenRouter account, so the \
  credential to configure is an OpenRouter API key. A bare \`deepseek/...\` id \
  is a different route that bills DeepSeek directly and is not configured here.
`;
