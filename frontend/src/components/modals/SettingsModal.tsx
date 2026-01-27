/**
 * SettingsModal Component
 * Modal for configuring API keys and app settings
 */

import { useState, useEffect } from 'react';
import { llmClient } from '../../llm/client';
import { LLMProviderType } from '../../llm/types';
import * as tauriDb from '../../services/tauriDatabase';

interface SettingsModalProps {
  onClose: () => void;
}

type ProviderKey = 'openai' | 'anthropic' | 'deepseek' | 'gemini' | 'cohere' | 'mistral' | 'ollama' | 'grok';

type ApiKeyState = Record<ProviderKey, string>;

type SettingsSection = 'llm-providers';

const PROVIDERS: ProviderKey[] = ['openai', 'anthropic', 'deepseek', 'gemini', 'cohere', 'mistral', 'ollama', 'grok'];

const PROVIDER_DISPLAY_NAMES: Record<ProviderKey, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
  cohere: 'Cohere',
  mistral: 'Mistral AI',
  ollama: 'Ollama',
  grok: 'xAI (Grok)',
};

const PROVIDER_LOGOS: Record<ProviderKey, string> = {
  openai: '/logos/providers/openai-icon.png',
  anthropic: '/logos/providers/anthropic-icon.png',
  deepseek: '/logos/providers/deepseek-icon.png',
  gemini: '/logos/providers/google-gemini-icon.png',
  cohere: '/logos/providers/cohere-icon.png',
  mistral: '/logos/providers/mistral-icon.png',
  ollama: '/logos/providers/ollama-icon.png',
  grok: '/logos/providers/xai-icon.png',
};

const STORAGE_KEYS: Record<ProviderKey, string> = {
  openai: 'api-key:openai',
  anthropic: 'api-key:anthropic',
  deepseek: 'api-key:deepseek',
  gemini: 'api-key:gemini',
  cohere: 'api-key:cohere',
  mistral: 'api-key:mistral',
  ollama: 'api-key:ollama',
  grok: 'api-key:grok',
};

const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: 'llm-providers', label: 'LLM Providers' },
];

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>('llm-providers');
  const [apiKeys, setApiKeys] = useState<ApiKeyState>(() => {
    const initial: Partial<ApiKeyState> = {};
    PROVIDERS.forEach(provider => {
      initial[provider] = '';
    });
    return initial as ApiKeyState;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load existing API keys (masked) - reload from storage to ensure fresh data
  useEffect(() => {
    async function loadKeys() {
      // Ensure keys are loaded from storage (handles hot reload case)
      await llmClient.loadApiKeysFromStorage();

      // Now load the masked keys into the form
      const loadedKeys: Partial<ApiKeyState> = {};
      PROVIDERS.forEach(provider => {
        loadedKeys[provider] = llmClient.getApiKey(provider) ? '********' : '';
      });
      setApiKeys(loadedKeys as ApiKeyState);
    }

    loadKeys();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      let hasChanges = false;

      for (const provider of PROVIDERS) {
        const key = apiKeys[provider];
        const storageKey = STORAGE_KEYS[provider];

        // Only update keys that have been changed (not masked)
        if (key && !key.includes('*')) {
          await tauriDb.setSetting(storageKey, key);
          llmClient.setApiKey(provider as LLMProviderType, key);
          console.log(`[Settings] Saved API key for ${provider}`);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        setSaveMessage('API keys saved successfully');
      } else {
        setSaveMessage('No changes to save');
      }
    } catch (error) {
      console.error('[Settings] Failed to save API keys:', error);
      setSaveMessage('Failed to save API keys');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyChange = (provider: keyof ApiKeyState, value: string) => {
    setApiKeys(prev => ({ ...prev, [provider]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal - wider to accommodate sidebar */}
      <div className="relative bg-bg-secondary border border-border rounded-lg shadow-xl flex flex-col" style={{ width: '900px', maxWidth: 'calc(100% - 2rem)', height: '580px' }}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border flex-shrink-0">
          <h2 className="text-text-primary font-medium">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content - Split layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar - Navigation */}
          <div className="w-48 border-r border-border bg-bg-primary/30">
            <nav className="p-2">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    activeSection === section.id
                      ? 'bg-accent-primary/20 text-accent-primary border border-accent-primary/30'
                      : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary'
                  }`}
                >
                  {section.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Right content - Settings for active section */}
          <div className="flex-1 flex flex-col min-h-0">
            {activeSection === 'llm-providers' && (
              <div className="p-6 flex flex-col h-full">
                <div className="flex-shrink-0 mb-4">
                  <h3 className="text-text-primary text-lg font-medium mb-1">LLM Provider API Keys</h3>
                  <p className="text-text-secondary text-sm">
                    Configure API keys for the LLM providers you want to use. Keys are stored securely and never leave your device.
                  </p>
                </div>

                {/* API Key inputs - 2 column grid */}
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 flex-shrink-0">
                  {PROVIDERS.map((provider) => (
                    <div key={provider}>
                      <label className="text-text-muted text-xs block mb-1.5 font-medium flex items-center gap-2">
                        <img
                          src={PROVIDER_LOGOS[provider]}
                          alt={PROVIDER_DISPLAY_NAMES[provider]}
                          className="w-4 h-4 object-contain"
                        />
                        {PROVIDER_DISPLAY_NAMES[provider]}
                      </label>
                      <input
                        type="password"
                        value={apiKeys[provider]}
                        onChange={(e) => handleKeyChange(provider, e.target.value)}
                        placeholder={`Enter API key`}
                        className="input w-full"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border flex-shrink-0">
          {/* Save message on the left */}
          <div className="flex-1">
            {saveMessage && (
              <div className={`text-sm inline-flex items-center px-3 py-1.5 rounded-md ${
                saveMessage.includes('success')
                  ? 'bg-accent-success/10 text-accent-success'
                  : 'bg-accent-warning/10 text-accent-warning'
              }`}>
                {saveMessage}
              </div>
            )}
          </div>

          {/* Buttons on the right */}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn btn-primary disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;

