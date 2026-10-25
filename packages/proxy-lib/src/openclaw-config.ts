import { getAvailableModels } from "@m365-copilot/core";
import { modelCapabilities } from "./http-policy.js";
// --- OpenClaw config generation ---

export interface OpenClawModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
}

export interface OpenClawProviderConfig {
  baseUrl: string;
  apiKey: string;
  api: string;
  models: OpenClawModelConfig[];
}

export interface OpenClawConfig {
  models: {
    mode: "merge";
    providers: {
      m365: OpenClawProviderConfig;
    };
  };
  agents: {
    defaults: {
      models: Record<string, { alias: string }>;
    };
  };
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "gpt-6-think-deeper": "GPT-6 Think Deeper",
  "gpt-6-sol": "GPT-6.0 Sol",
  "gpt-6.1-sol": "GPT-6.1 Sol",
  "gpt-5.6-think-deeper": "GPT-5.6 Think Deeper",
  "gpt-5.6": "GPT-5.6 Quick",
  "gpt-5.6-quick": "GPT-5.6 Quick",
  "m365-copilot": "M365 Copilot (Auto)",
  "auto": "M365 Auto",
  "quick": "GPT Quick",
  "think-deeper": "GPT Think Deeper",
  "gpt-5.4": "GPT-5.4 Think Deeper",
  "gpt-5.4-quick": "GPT-5.4 Quick",
  "gpt-5.4-think-deeper": "GPT-5.4 Think Deeper",
  "gpt-5.3": "GPT-5.3 Quick",
  "gpt-5.3-quick": "GPT-5.3 Quick",
  "gpt-5.3-think-deeper": "GPT-5.3 Think Deeper",
  "gpt-5.2": "GPT-5.2 Quick",
  "gpt-5.2-quick": "GPT-5.2 Quick",
  "gpt-5.2-think-deeper": "GPT-5.2 Think Deeper",
  // Two models behind one tone: the scenario picks them (copilot.ts).
  "claude-opus": "Claude Opus 5.5",
  "claude-opus-5.5": "Claude Opus 5.5",
  "claude-opus-5": "Claude Opus 5.5",
  "claude-opus-4.8": "Claude Opus 4.8 (premium, unmetered)",
  "claude-opus-4.5": "Claude Opus 4.8 (premium, unmetered)",
};

export function generateOpenClawConfig(proxyPort: number = 4141): OpenClawConfig {
  const models = getAvailableModels();

  const modelConfigs: OpenClawModelConfig[] = models.map((id) => ({
    id,
    name: MODEL_DISPLAY_NAMES[id] || id,
    reasoning: modelCapabilities(id).reasoning,
    input: modelCapabilities(id).input,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: modelCapabilities(id).contextWindow,
    maxTokens: modelCapabilities(id).maxTokens,
  }));

  const modelAllowlist: Record<string, { alias: string }> = {};
  for (const id of models) {
    modelAllowlist[`m365/${id}`] = { alias: id };
  }

  return {
    models: {
      mode: "merge",
      providers: {
        m365: {
          baseUrl: `http://localhost:${proxyPort}/v1`,
          apiKey: "not-needed",
          api: "openai-completions",
          models: modelConfigs,
        },
      },
    },
    agents: {
      defaults: {
        models: modelAllowlist,
      },
    },
  };
}

