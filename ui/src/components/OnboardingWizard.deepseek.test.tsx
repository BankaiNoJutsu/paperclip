// @vitest-environment jsdom

/**
 * DeepSeek in onboarding.
 *
 * The wizard preselects the OpenCode model from the *discovered* catalog rather
 * than a hardcoded id, so these cases pin the two halves of that promise: the
 * DeepSeek preference applies when the catalog proves the provider is reachable,
 * and a manual DeepSeek entry survives when discovery returns nothing.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ONBOARDING_STORAGE_KEY = "paperclip-onboarding-state";

const mockDialog = vi.hoisted(() => ({
  onboardingOpen: true,
  onboardingOptions: {} as { initialStep?: number; companyId?: string },
  closeOnboarding: vi.fn(),
  onboardingRouteDismissed: false,
  setOnboardingRouteDismissed: vi.fn(),
}));

const mockCompany = vi.hoisted(() => ({
  companies: [] as Array<{ id: string; name: string; issuePrefix: string }>,
  setSelectedCompanyId: vi.fn(),
  loading: false,
  error: null as Error | null,
}));

const mockCompaniesApi = vi.hoisted(() => ({
  detachInflightList: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  list: vi.fn(),
}));

const mockAgentsApi = vi.hoisted(() => ({
  adapterModels: vi.fn(async () => [] as Array<{ id: string; label: string }>),
  testEnvironment: vi.fn(async () => ({
    adapterType: "opencode_local",
    status: "pass",
    checks: [],
    testedAt: new Date().toISOString(),
  })),
  hire: vi.fn(async () => ({ agent: { id: "agent-1" }, approval: null })),
  list: vi.fn(async () => [] as Array<{ id: string; name: string; adapterType: string }>),
  instructionsBundle: vi.fn(async () => ({ entryFile: "AGENTS.md" })),
  saveInstructionsFile: vi.fn(async () => ({})),
  getClaudeOAuthTokenStatus: vi.fn(),
  getAdapterAuthSignal: vi.fn(async () => ({ status: "present" })),
  getActiveAdapterAuthLoginSession: vi.fn(async () => {
    throw new Error("no active session");
  }),
  getActiveClaudeSetupTokenLoginSession: vi.fn(async () => {
    throw new Error("no active session");
  }),
}));

vi.mock("@/lib/router", () => ({
  useLocation: () => ({ pathname: "/", search: "", hash: "", state: null }),
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));
vi.mock("../context/DialogContext", () => ({ useDialog: () => mockDialog }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => mockCompany }));
vi.mock("../api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/auth", () => ({
  authApi: {
    getSession: vi.fn(async () => ({
      session: { id: "session-1", userId: "user-1" },
      user: { id: "user-1", name: "Example", email: "user-1@example.com", image: null },
    })),
  },
}));
vi.mock("../api/goals", () => ({ goalsApi: { create: vi.fn(), list: vi.fn(async () => []) } }));
vi.mock("../api/projects", () => ({
  projectsApi: { create: vi.fn(), list: vi.fn(async () => []) },
}));
vi.mock("../api/issues", () => ({ issuesApi: { create: vi.fn(), list: vi.fn(async () => []) } }));
vi.mock("../api/environments", () => ({
  environmentsApi: { list: vi.fn(async () => []) },
}));
vi.mock("../api/ai-connections", () => ({
  aiConnectionsApi: { list: vi.fn(async () => ({ connections: [], currentUserId: "user-1" })) },
}));

// OpenCode and Claude are the two the row offers here; only the first matters.
vi.mock("../adapters", () => ({
  getUIAdapter: () => ({ buildAdapterConfig: () => ({}) }),
  listUIAdapters: () => [{ type: "opencode_local" }, { type: "claude_local" }],
}));
vi.mock("../adapters/metadata", () => ({ isVisualAdapterChoice: () => true }));
vi.mock("../adapters/adapter-display-registry", async () => {
  // Read the real registry rather than asserting `recommended: true` here.
  // A blanket flag made this suite pass while the shipped row offered no
  // OpenCode tile at all, so the DeepSeek default was unreachable in the
  // product and green in the tests. Importing the real map keeps the two
  // honest about each other.
  const actual = await vi.importActual<typeof import("../adapters/adapter-display-registry")>(
    "../adapters/adapter-display-registry",
  );
  return {
    getAdapterDisplay: (type: string) => actual.getAdapterDisplay(type),
    getAdapterLabel: (type: string) => type,
    getAdapterLabels: () => ({}) as Record<string, string>,
    isKnownAdapterType: () => true,
  };
});
vi.mock("../adapters/use-disabled-adapters", () => ({
  useDisabledAdaptersSync: () => new Set<string>(),
  useAdapterRegistryLoaded: () => true,
}));
vi.mock("../adapters/use-adapter-capabilities", () => ({
  useAdapterCapabilities: () => () => ({
    supportsInstructionsBundle: false,
    supportsSkills: false,
    supportsLocalAgentJwt: false,
    requiresMaterializedRuntimeSkills: false,
  }),
}));
vi.mock("./AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));
vi.mock("./AgentCapsule", () => ({ AgentCapsule: () => null }));

import { OnboardingWizard } from "./OnboardingWizard";
import { TooltipProvider } from "./ui/tooltip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const DEEPSEEK_OPENROUTER_MODEL = "openrouter/deepseek/deepseek-v4-flash-0731";

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

/** Open the wizard on step 4 with an OpenCode draft already restored. */
async function openStep4() {
  mockCompany.companies = [{ id: "company-new", name: "Initech", issuePrefix: "INI" }];
  mockCompany.loading = false;
  mockCompaniesApi.list.mockResolvedValue(mockCompany.companies);
  window.localStorage.setItem(
    ONBOARDING_STORAGE_KEY,
    JSON.stringify({
      step: 4,
      companyName: "Initech",
      agentName: "Ada",
      createdCompanyId: "company-new",
      adapterType: "opencode_local",
    }),
  );

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        {/* The model picker renders a Tooltip, which requires its provider —
            the same wrapper the real app's root supplies. */}
        <TooltipProvider>
          <OnboardingWizard />
        </TooltipProvider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 6; i++) await flushReact();
  return { root };
}

/**
 * Press the OpenCode tile, which is what opens the model card.
 *
 * Matched on the display label, not the adapter type: the row renders what the
 * registry supplies, so an earlier type-based match passed only while this file
 * was mocking the registry with a stand-in that echoed the type back.
 */
async function pickOpenCode() {
  const tile = [...document.body.querySelectorAll('[role="radio"]')].find((entry) =>
    /OpenCode/i.test(entry.textContent ?? ""),
  );
  expect(tile, "the row should offer OpenCode").toBeTruthy();
  await act(async () => {
    tile!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  for (let i = 0; i < 10; i++) await flushReact();
}

/**
 * The model picker's trigger.
 *
 * It is labelled "Select model (required)" while empty and shows the chosen id
 * once one is seeded, so both are matched — the empty case is exactly what the
 * manual-entry test is asserting about.
 */
/**
 * The model picker's trigger.
 *
 * Excludes the provider radio group: it also renders "DeepSeek", so a match on
 * that word alone finds the provider button instead of the model control.
 */
function modelTrigger() {
  return [...document.body.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("role") !== "radio" &&
      /Select model|deepseek|gpt-/i.test(button.textContent ?? ""),
  );
}

describe("OnboardingWizard DeepSeek default", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockDialog.onboardingOpen = true;
    mockDialog.onboardingOptions = {};
    mockCompany.companies = [];
    mockAgentsApi.adapterModels.mockReset();
    mockAgentsApi.adapterModels.mockResolvedValue([]);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("preselects the OpenRouter DeepSeek model when the catalog offers it", async () => {
    // The catalog is what makes the preference safe: an id it does not carry
    // would be preselected against a provider this host never authenticated.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex" },
      { id: DEEPSEEK_OPENROUTER_MODEL, label: "DeepSeek V4 Flash" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    const trigger = modelTrigger();
    expect(trigger, "OpenCode onboarding should ask for a model").toBeTruthy();
    expect(trigger!.textContent).toContain("DeepSeek V4 Flash");

    await act(async () => root.unmount());
  });

  it("asks which account pays, and offers DeepSeek as an answer", async () => {
    // The regression that blocked a real customer: OpenCode always validated
    // against OpenRouter, so a DeepSeek key was rejected as invalid. The card
    // has to let the customer name the account rather than assume one.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "deepseek/deepseek-flash", label: "deepseek/deepseek-flash" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    const providerRadios = [...document.body.querySelectorAll('[role="radio"]')]
      .map((node) => node.textContent ?? "")
      .filter((text) => /DeepSeek|OpenRouter/i.test(text));
    expect(
      providerRadios.some((text) => /DeepSeek/.test(text)),
      "DeepSeek must be offered, or its key cannot be validated correctly",
    ).toBe(true);
    expect(
      providerRadios.some((text) => /OpenRouter/.test(text)),
      "OpenRouter must stay offered for customers paying that way",
    ).toBe(true);

    await act(async () => root.unmount());
  });

  it("falls back to the OpenAI default when DeepSeek is not offered", async () => {
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    const trigger = modelTrigger();
    expect(trigger, "OpenCode onboarding should ask for a model").toBeTruthy();
    expect(trigger!.textContent).toContain("GPT-5.2 Codex");
    expect(trigger!.textContent).not.toContain("DeepSeek");

    await act(async () => root.unmount());
  });

  it("offers OpenCode as a tile so DeepSeek is reachable at all", async () => {
    // The regression this file was blind to: the model seeding was correct but
    // the source row was built from `recommended`, and OpenCode was not in it,
    // so a customer could never reach the DeepSeek default from onboarding.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: DEEPSEEK_OPENROUTER_MODEL, label: "DeepSeek V4 Flash" },
    ]);

    const { root } = await openStep4();

    const tiles = [...document.body.querySelectorAll('[role="radio"]')].map(
      (tile) => tile.textContent ?? "",
    );
    expect(
      tiles.some((text) => /OpenCode/i.test(text)),
      "onboarding must offer OpenCode, or DeepSeek has no path from this step",
    ).toBe(true);

    await act(async () => root.unmount());
  });

  it("preselects DeepSeek from a catalog that names it directly", async () => {
    // Reproduces a real host, where OpenCode exposed `deepseek/...` ids and
    // never the OpenRouter one. An exact-id preference preselected the OpenAI
    // default there — and that catalog carried no `openai/...` entry either, so
    // the required field was filled with a model that could not run.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "deepseek/deepseek-flash", label: "deepseek/deepseek-flash" },
      { id: "deepseek/deepseek-v4-pro", label: "deepseek/deepseek-v4-pro" },
      { id: "opencode/big-pickle", label: "opencode/big-pickle" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    const trigger = modelTrigger();
    expect(trigger, "OpenCode onboarding should ask for a model").toBeTruthy();
    expect(trigger!.textContent).toContain("deepseek/deepseek-flash");

    await act(async () => root.unmount());
  });

  it("offers manual entry when discovery returns nothing", async () => {
    // A DeepSeek-only key that `opencode models` does not enumerate is a real
    // deployment. The step must still let the customer name the model.
    mockAgentsApi.adapterModels.mockResolvedValue([]);

    const { root } = await openStep4();
    await pickOpenCode();

    const trigger = modelTrigger();
    expect(trigger, "an empty catalog must not remove the picker").toBeTruthy();

    await act(async () => trigger!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    for (let i = 0; i < 4; i++) await flushReact();

    // `creatable` is what makes the manual path reachable; without it an empty
    // catalog is a dead end with no way to name a DeepSeek model.
    const search = document.body.querySelector("input[placeholder*='Search models']");
    expect(search, "the picker should accept a typed model id").toBeTruthy();

    await act(async () => root.unmount());
  });
});

