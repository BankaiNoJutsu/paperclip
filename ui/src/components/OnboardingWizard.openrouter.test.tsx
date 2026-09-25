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
const mockAdapterBuild = { buildAdapterConfig: vi.fn(() => ({})) };
vi.mock("../adapters", () => ({
  getUIAdapter: () => ({ buildAdapterConfig: mockAdapterBuild.buildAdapterConfig }),
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
import { PREFERRED_OPENCODE_MODEL } from "@paperclipai/adapter-opencode-local";
import { TooltipProvider } from "./ui/tooltip";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The catalog is described by the adapter's own preference rather than a copy of
// its value, so changing the default does not leave these tests asserting
// against a model the product no longer prefers.
const DEEPSEEK_OPENROUTER_MODEL = PREFERRED_OPENCODE_MODEL;

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
 * It reads "Select model (required)" while empty and shows the chosen id once
 * one is seeded, so both are matched — the empty case is exactly what the
 * manual-entry test asserts about.
 */
function modelTrigger() {
  return [...document.body.querySelectorAll("button")].find((button) =>
    /Select model|deepseek|gpt-/i.test(button.textContent ?? ""),
  );
}

describe("OnboardingWizard OpenCode OpenRouter default", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockDialog.onboardingOpen = true;
    mockDialog.onboardingOptions = {};
    mockCompany.companies = [];
    mockAgentsApi.adapterModels.mockReset();
    mockAgentsApi.adapterModels.mockResolvedValue([]);
    mockAdapterBuild.buildAdapterConfig.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("offers OpenCode as a tile, which is the only route to the default", async () => {
    // Without this tile the whole default was green in tests and unreachable in
    // the product: the row is built from `recommended`, and OpenCode was not in
    // it, so a customer could never select the source this branch defaults.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: DEEPSEEK_OPENROUTER_MODEL, label: "DeepSeek V4.1 Flash" },
    ]);

    const { root } = await openStep4();

    const tiles = [...document.body.querySelectorAll('[role="radio"]')].map(
      (tile) => tile.textContent ?? "",
    );
    expect(
      tiles.some((text) => /OpenCode/i.test(text)),
      "onboarding must offer OpenCode, or the default has no path",
    ).toBe(true);

    await act(async () => root.unmount());
  });

  it("names the source for a customer rather than the adapter type", async () => {
    // The card read "Provide your opencode_local API key", naming an internal
    // type at a customer.
    mockAgentsApi.adapterModels.mockResolvedValue([]);

    const { root } = await openStep4();
    await pickOpenCode();

    expect(document.body.textContent).not.toContain("opencode_local");

    await act(async () => root.unmount());
  });

  it("opens the key card for OpenCode, which is the credential it needs", async () => {
    // OpenCode has no subscription sign-in, so the API-key card is the only
    // route and must be what the tile leads to.
    mockAgentsApi.adapterModels.mockResolvedValue([]);

    const { root } = await openStep4();
    await pickOpenCode();

    expect(document.body.textContent).toMatch(/API key/i);

    await act(async () => root.unmount());
  });

  it("shows the model picker, without which OpenCode cannot be connected", async () => {
    // OpenCode requires an explicit `model` in provider/model form and has no
    // single default, so the step cannot complete without a picker. Its absence
    // was only visible by running the flow: the typecheck and every other test
    // passed while the step was unusable.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: DEEPSEEK_OPENROUTER_MODEL, label: "DeepSeek V4.1 Flash" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    const trigger = modelTrigger();
    expect(
      trigger,
      "the connect step must offer a model control for OpenCode",
    ).toBeTruthy();

    await act(async () => root.unmount());
  });

  it("preselects the OpenRouter DeepSeek model when the catalog offers it", async () => {
    // The catalog is what makes the preference safe: an id it does not carry
    // would be preselected against a provider this host never authenticated.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "openai/gpt-5.2-codex", label: "GPT-5.2 Codex" },
      { id: DEEPSEEK_OPENROUTER_MODEL, label: "DeepSeek V4.1 Flash" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    expect(modelTrigger()!.textContent).toContain("DeepSeek V4.1 Flash");

    await act(async () => root.unmount());
  });

  it("adopts an OpenRouter DeepSeek variant it has not seen before", async () => {
    // Matching one exact id would let the default lapse the moment OpenRouter
    // moves the model, which is what the family match exists to prevent.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "openrouter/deepseek/deepseek-v5-flash", label: "DeepSeek V5 Flash" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    expect(modelTrigger()!.textContent).toContain("DeepSeek V5 Flash");

    await act(async () => root.unmount());
  });

  it("never preselects a directly billed deepseek model", async () => {
    // `deepseek/...` bills DeepSeek directly and this build configures no key
    // for that route, so adopting one would put the agent on a provider it
    // cannot run against.
    mockAgentsApi.adapterModels.mockResolvedValue([
      { id: "deepseek/deepseek-flash", label: "deepseek/deepseek-flash" },
    ]);

    const { root } = await openStep4();
    await pickOpenCode();

    expect(modelTrigger()?.textContent ?? "").not.toContain("deepseek/deepseek-flash");

    await act(async () => root.unmount());
  });

  it("offers manual entry when discovery returns nothing", async () => {
    // Discovery failing must still leave a way to name a model, since the field
    // is required and OpenCode has no default to fall back on.
    mockAgentsApi.adapterModels.mockResolvedValue([]);

    const { root } = await openStep4();
    await pickOpenCode();

    expect(
      modelTrigger(),
      "an empty catalog must still leave a way to name a model",
    ).toBeTruthy();

    await act(async () => root.unmount());
  });
});

