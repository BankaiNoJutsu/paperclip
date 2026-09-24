// @vitest-environment jsdom

/**
 * Switching an *existing* agent to DeepSeek.
 *
 * Onboarding is only half the promise; the other half is an agent that already
 * exists. The form picks the model catalog from the AI connection bound to the
 * agent, because both DeepSeek routes reach OpenCode through different accounts:
 * an OpenRouter connection lists OpenRouter's ids, a DeepSeek connection lists
 * DeepSeek's own. A DeepSeek binding that silently fell back to the generic
 * `opencode models` catalog would offer models the customer's key cannot run.
 */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Environment } from "@paperclipai/shared";
import { getEnvironmentCapabilities } from "@paperclipai/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ToastProvider } from "../context/ToastContext";
import { AgentConfigForm } from "./AgentConfigForm";
import { ApiError } from "../api/client";

const mockAgentsApi = vi.hoisted(() => ({
  adapterModels: vi.fn(),
  detectModel: vi.fn(),
  list: vi.fn(),
  testEnvironment: vi.fn(),
  startAdapterAuthLogin: vi.fn(),
  getAdapterAuthLoginStatus: vi.fn(),
  getActiveAdapterAuthLoginSession: vi.fn(),
  cancelAdapterAuthLogin: vi.fn(),
  startClaudeSetupTokenLogin: vi.fn(),
  getClaudeSetupTokenLoginStatus: vi.fn(),
  getActiveClaudeSetupTokenLoginSession: vi.fn(),
  getClaudeSetupTokenLoginPrompt: vi.fn(),
  submitClaudeSetupTokenBrowserCode: vi.fn(),
  completeClaudeSetupTokenLogin: vi.fn(),
  cancelClaudeSetupTokenLogin: vi.fn(),
  getClaudeOAuthTokenStatus: vi.fn(),
}));

const mockEnvironmentsApi = vi.hoisted(() => ({ list: vi.fn(), capabilities: vi.fn() }));
const mockInstanceSettingsApi = vi.hoisted(() => ({
  get: vi.fn(),
  getExperimental: vi.fn(),
  getGeneral: vi.fn(),
}));
const mockSecretsApi = vi.hoisted(() => ({
  list: vi.fn(),
  listProposals: vi.fn(),
  listUserSecretDefinitions: vi.fn(async () => [] as unknown[]),
}));

vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/environments", () => ({ environmentsApi: mockEnvironmentsApi }));
vi.mock("../api/instanceSettings", () => ({ instanceSettingsApi: mockInstanceSettingsApi }));
vi.mock("../api/secrets", () => ({ secretsApi: mockSecretsApi }));
vi.mock("../lib/clipboard", () => ({ copyTextToClipboard: vi.fn() }));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: "company-1", name: "Paperclip" }],
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Paperclip" },
    selectionSource: "bootstrap",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));
vi.mock("../adapters", () => ({
  getUIAdapter: (type: string) => ({
    type,
    label: type === "opencode_local" ? "OpenCode" : "Agent",
    ConfigFields: () => <div data-testid="adapter-config-fields" />,
    buildAdapterConfig: (values: { model?: string }) => ({ model: values.model }),
    adapterConfigSchema: undefined,
  }),
  listUIAdapters: () => [],
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  });
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Cody",
    role: "Engineer",
    title: null,
    icon: null,
    status: "idle",
    reportsTo: null,
    capabilities: null,
    adapterType: "opencode_local",
    adapterConfig: {},
    runtimeConfig: {},
    defaultEnvironmentId: null,
    contextMode: "thin",
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    permissions: {},
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  } as Agent;
}

async function renderForm(agentOverrides: Partial<Agent>) {
  mockEnvironmentsApi.list.mockResolvedValue([
    {
      id: "local-1",
      name: "Local",
      description: null,
      driver: "local",
      status: "active",
      config: {},
      envVars: {},
      metadata: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    } as Environment,
  ]);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TooltipProvider>
            <AgentConfigForm
              mode="edit"
              agent={makeAgent(agentOverrides)}
              onSave={vi.fn()}
              hidePromptTemplate
              showAdapterTypeField={false}
              showAdapterTestEnvironmentButton={false}
            />
          </TooltipProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
  });
  await flushReact();
  return { container, root };
}

/** The provider query argument the form passed on its most recent fetch. */
function requestedProviders() {
  return mockAgentsApi.adapterModels.mock.calls.map(
    (call) => (call[2] as { provider?: string } | undefined)?.provider,
  );
}

describe("AgentConfigForm DeepSeek model switching", () => {
  let roots: Root[] = [];

  beforeEach(() => {
    mockAgentsApi.adapterModels.mockReset();
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAgentsApi.detectModel.mockReset();
    mockAgentsApi.detectModel.mockResolvedValue(null);
    mockAgentsApi.list.mockReset();
    mockAgentsApi.list.mockResolvedValue([]);
    mockInstanceSettingsApi.get.mockResolvedValue({ defaultEnvironmentId: null });
    mockInstanceSettingsApi.getExperimental.mockResolvedValue({ enableEnvironments: true });
    mockInstanceSettingsApi.getGeneral.mockResolvedValue({ executionMode: "any" });
    mockEnvironmentsApi.capabilities.mockResolvedValue(
      getEnvironmentCapabilities(["opencode_local"], { sandboxProviders: {} }),
    );
    mockSecretsApi.list.mockResolvedValue([]);
    mockSecretsApi.listProposals.mockResolvedValue([]);
    // No active adapter login session, which is the ordinary case here.
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockReset();
    mockAgentsApi.getActiveAdapterAuthLoginSession.mockRejectedValue(
      new ApiError("Adapter login session not found", 404, { error: "not found" }),
    );
    mockAgentsApi.getClaudeOAuthTokenStatus.mockReset();
    mockAgentsApi.getClaudeOAuthTokenStatus.mockRejectedValue(
      new ApiError("Claude OAuth token not found", 404, { error: "not found" }),
    );
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockReset();
    mockAgentsApi.getActiveClaudeSetupTokenLoginSession.mockRejectedValue(
      new ApiError("Adapter login session not found", 404, { error: "not found" }),
    );
  });

  afterEach(() => {
    for (const root of roots) {
      act(() => root.unmount());
    }
    roots = [];
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("asks the server for DeepSeek's own catalog when a DeepSeek connection is bound", async () => {
    const result = await renderForm({
      runtimeConfig: { aiConnection: { provider: "deepseek", method: "api_key", mode: "responsible_user" } },
    });
    roots.push(result.root);

    expect(
      requestedProviders(),
      "a bound DeepSeek connection must select the DeepSeek catalog",
    ).toContain("deepseek");
  });

  it("still selects OpenRouter's catalog for an OpenRouter connection", async () => {
    // The two routes share the OpenCode adapter, so the binding is the only
    // thing that distinguishes them — a regression here would cross the billing
    // accounts.
    const result = await renderForm({
      runtimeConfig: { aiConnection: { provider: "openrouter", method: "api_key", mode: "responsible_user" } },
    });
    roots.push(result.root);

    expect(requestedProviders()).toContain("openrouter");
    expect(requestedProviders()).not.toContain("deepseek");
  });

  it("does not request a provider catalog when no connection is bound", async () => {
    const result = await renderForm({ adapterConfig: { model: "openai/gpt-5.2-codex" } });
    roots.push(result.root);

    expect(requestedProviders()).not.toContain("deepseek");
    expect(requestedProviders()).not.toContain("openrouter");
  });

  it("shows the DeepSeek model a bound agent is already running", async () => {
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "deepseek/deepseek-chat", label: "DeepSeek Chat" },
      { id: "deepseek/deepseek-reasoner", label: "DeepSeek Reasoner" },
    ]);

    const result = await renderForm({
      adapterConfig: { model: "deepseek/deepseek-chat" },
      runtimeConfig: { aiConnection: { provider: "deepseek", method: "api_key", mode: "responsible_user" } },
    });
    roots.push(result.root);

    expect(result.container.textContent).toContain("DeepSeek Chat");
  });
});
