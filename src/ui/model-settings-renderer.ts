import { CUSTOM_MODEL_ID } from '../models.ts';
import type { ModelDraft } from '../model-selection.ts';
import type {
  AIModelInfo,
  AIProvider,
  ModelServiceTier,
  ReasoningEffortOption,
} from '../models.ts';
import type { LocalState } from '../local/index.ts';

((): void => {
  interface Model extends AIModelInfo {
    id: string;
    caps: { efforts: ReasoningEffortOption[]; fast?: ModelServiceTier };
    saved: ModelDraft;
  }
  interface State {
    providers: Array<{ id: AIProvider; name: string; status: string }>;
    models: Model[];
    current: ModelDraft | null;
    currentId: string;
    currentLabel: string;
    history: Partial<Record<AIProvider, { modelId: string; customModel: string }>>;
    custom: { provider: AIProvider; model: string } | null;
    local: Record<
      string,
      LocalState & { name: string; memory: string; source: string; license: string }
    >;
    busy: boolean;
    account: { status: string; error?: string };
    languages: { primary: string; secondary: string };
  }
  interface Reply {
    ok: boolean;
    error?: string;
    state?: State;
    translation?: string;
    seconds?: number;
  }
  const host = window as unknown as {
    honyoSettings: {
      model: (request: unknown) => Promise<Reply>;
      on: (channel: string, fn: (_event: unknown, payload: unknown) => void) => void;
    };
    modelSettings: { isDirty: () => boolean; save: () => Promise<boolean> };
  };
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    return element as T;
  };
  let state: State | undefined;
  let draft: ModelDraft | undefined;
  let baseline = '';
  let pending = false;
  const drafts = new Map<string, ModelDraft>();
  const last = new Map<AIProvider, string>();
  const dirty = (): boolean => !!draft && JSON.stringify(draft) !== baseline;
  const message = (text: string, error = false): void => {
    $('model-status').textContent = text;
    $('model-status').classList.toggle('error', error);
  };
  const chosen = (): Model | undefined =>
    state?.models.find(
      m =>
        m.provider === draft?.provider &&
        (m.id === draft.modelId ||
          (draft.modelId === CUSTOM_MODEL_ID && m.model === draft.customModel.trim())),
    );
  const cache = (): void => {
    if (draft) {
      drafts.set(`${draft.provider}:${draft.modelId}`, { ...draft });
      last.set(draft.provider, draft.modelId);
    }
  };
  const active = (): ModelDraft =>
    state?.current
      ? { ...state.current }
      : {
          provider: 'local',
          modelId: state?.currentId ?? '',
          customModel: '',
          effort: null,
          fast: false,
        };
  function reset(): void {
    draft = active();
    baseline = JSON.stringify(draft);
    drafts.clear();
    last.clear();
    message('');
    render();
  }
  function selectModel(id: string): void {
    if (!state || !draft) return;
    cache();
    const provider = draft.provider;
    const model = state.models.find(m => m.id === id && m.provider === provider);
    draft = {
      ...(drafts.get(`${provider}:${id}`) ??
        model?.saved ?? {
          provider,
          modelId: id,
          customModel:
            state.history[provider]?.customModel ??
            (state.custom?.provider === provider ? state.custom.model : ''),
          effort: null,
          fast: false,
        }),
    };
    $('model-test-output').textContent = '';
    $('model-test-meta').textContent = '';
    message('');
    render();
  }
  function selectProvider(provider: AIProvider): void {
    if (!state || !draft) return;
    cache();
    draft = { provider, modelId: '', customModel: '', effort: null, fast: false };
    $('provider-api-key').setAttribute('value', '');
    $<HTMLInputElement>('provider-api-key').value = '';
    $<HTMLDetailsElement>('api-connection').open = false;
    const remembered = last.get(provider) ?? state.history[provider]?.modelId;
    const id =
      remembered &&
      (remembered === CUSTOM_MODEL_ID ||
        state.models.some(m => m.provider === provider && m.id === remembered))
        ? remembered
        : (state.models.find(m => m.provider === provider)?.id ?? '');
    selectModel(id);
  }
  function invalid(): string {
    if (!state || !draft) return 'Loading model settings…';
    const p = state.providers.find(p => p.id === draft?.provider);
    if (draft.modelId !== CUSTOM_MODEL_ID && !chosen()) return 'Choose an available model.';
    if (draft.modelId === CUSTOM_MODEL_ID && !draft.customModel.trim()) return 'Enter a model ID.';
    if (draft.provider === 'local') {
      const local = state.local[draft.modelId];
      if (!local?.supported) return 'Offline translation requires an Apple Silicon Mac.';
      if (!local.installed) return 'Download this model before saving or testing.';
      if (
        !['English', 'Japanese'].includes(state.languages.primary) ||
        !['English', 'Japanese'].includes(state.languages.secondary) ||
        state.languages.primary === state.languages.secondary
      )
        return 'Local models support English ↔ Japanese. Choose these two languages in the menu before saving.';
      if (local.error) return local.error;
    } else if (draft.provider === 'codex' && state.account.status !== 'connected')
      return 'Sign in with ChatGPT to use this provider.';
    else if (
      ['openai', 'anthropic', 'google'].includes(draft.provider) &&
      p?.status !== 'API key saved'
    )
      return p?.status === 'Authentication error'
        ? 'Update the API key after the authentication error.'
        : 'Save an API key for this provider first.';
    return '';
  }
  function render(): void {
    if (!state || !draft) return;
    const locked = pending || state.busy;
    const selected = chosen();
    const caps = selected?.caps;
    if (draft.effort && !caps?.efforts.some(x => x.reasoningEffort === draft?.effort))
      draft.effort = null;
    if (!caps?.fast) draft.fast = false;
    $('model-current').textContent = state.currentLabel;
    $('generate-prompt-btn').toggleAttribute('disabled', state.current?.provider === 'local');
    for (const provider of state.providers) {
      let button = document.getElementById(`provider-${provider.id}`) as HTMLButtonElement | null;
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.id = `provider-${provider.id}`;
        button.className = 'provider-choice';
        const name = document.createElement('strong');
        name.textContent = provider.name;
        button.append(name, document.createElement('span'));
        button.onclick = (): void => selectProvider(provider.id);
        $('provider-list').append(button);
      }
      const status = button.querySelector('span');
      if (status) status.textContent = provider.status;
      button.setAttribute('aria-pressed', String(provider.id === draft.provider));
      button.disabled = locked;
      button.classList.toggle(
        'connected',
        /^(Ready|Signed in|API key saved)/.test(provider.status),
      );
    }
    const api = ['openai', 'anthropic', 'google'].includes(draft.provider);
    $('chatgpt-connection').hidden = draft.provider !== 'codex';
    $('api-connection').hidden = !api;
    $('connection-summary').textContent =
      draft.provider === 'local'
        ? 'Runs on this Mac. No account or API key needed.'
        : (state.providers.find(p => p.id === draft?.provider)?.status ?? '');
    $<HTMLButtonElement>('model-login').disabled = locked || state.account.status === 'connecting';
    $('model-login').textContent =
      state.account.status === 'connected' ? 'Reconnect ChatGPT' : 'Sign in with ChatGPT';
    $<HTMLButtonElement>('model-logout').disabled = locked || state.account.status !== 'connected';
    for (const id of ['model-key-save', 'model-key-remove', 'provider-api-key'])
      $<HTMLButtonElement>(id).disabled = locked;
    const select = $<HTMLSelectElement>('model-choice');
    select.replaceChildren(new Option('Choose a model…', ''));
    for (const model of state.models.filter(m => m.provider === draft?.provider))
      select.add(new Option(model.name, model.id));
    if (api) select.add(new Option('Enter a model ID…', CUSTOM_MODEL_ID));
    select.value = draft.modelId;
    select.disabled = locked;
    $('custom-model-field').hidden = draft.modelId !== CUSTOM_MODEL_ID;
    $<HTMLInputElement>('manual-model-id').value = draft.customModel;
    $<HTMLInputElement>('manual-model-id').disabled = locked;
    $('model-refresh').hidden = draft.provider === 'local';
    $<HTMLButtonElement>('model-refresh').disabled = locked;
    $('local-model-setup').hidden = draft.provider !== 'local' || !state.local[draft.modelId];
    $('model-description').textContent =
      draft.provider === 'local'
        ? (state.local[draft.modelId]?.memory ?? '')
        : 'Only models from this provider are shown.';
    const local = state.local[draft.modelId];
    if (draft.provider === 'local' && local) {
      const downloading = ['downloading', 'verifying'].includes(local.phase);
      const percent = Math.min(100, Math.round((local.bytes / local.total) * 100));
      $('model-download-status').textContent = downloading
        ? local.phase === 'verifying'
          ? 'Verifying model…'
          : `Downloading ${percent}%`
        : local.phase === 'loading'
          ? 'Loading into memory…'
          : local.installed
            ? 'Downloaded · Ready'
            : `One-time download · ${(local.total / 1e9).toFixed(2)} GB · 4-bit`;
      const progress = $<HTMLProgressElement>('model-download-progress');
      progress.hidden = !downloading;
      progress.value = percent;
      $('model-download').hidden = local.installed || downloading;
      $('model-download').textContent = `Download (${(local.total / 1e9).toFixed(2)} GB)`;
      $<HTMLButtonElement>('model-download').disabled = locked || !local.supported;
      $('model-download-cancel').hidden = !downloading;
      $<HTMLAnchorElement>('model-source').href = local.source;
      $<HTMLAnchorElement>('model-license').href = local.license;
      $('model-downloads').replaceChildren();
      for (const entry of Object.values(state.local).filter(x => x.installed)) {
        const row = document.createElement('div');
        row.className = 'downloaded-row';
        const name = document.createElement('span');
        name.textContent = entry.name;
        const remove = document.createElement('button');
        remove.className = 'text-button';
        remove.textContent = state.current?.modelId === entry.id ? 'In use' : 'Delete';
        remove.disabled = locked || state.current?.modelId === entry.id;
        remove.onclick = (): void => {
          if (confirm(`Delete ${entry.name}? It will need to be downloaded again.`))
            void action({ action: 'delete', id: entry.id });
        };
        row.append(name, remove);
        $('model-downloads').append(row);
      }
    }
    const efforts = caps?.efforts ?? [];
    const effort = $<HTMLSelectElement>('model-effort');
    effort.replaceChildren(new Option('Model default', ''));
    for (const option of efforts)
      effort.add(
        new Option(
          option.reasoningEffort + (option.description ? ` — ${option.description}` : ''),
          option.reasoningEffort,
        ),
      );
    effort.value = draft.effort ?? '';
    effort.disabled = locked;
    $('effort-field').hidden = !efforts.length;
    $('fast-field').hidden = !caps?.fast;
    $('model-no-options').hidden = !!efforts.length || !!caps?.fast;
    const fast = $<HTMLInputElement>('model-fast');
    fast.checked = draft.fast;
    fast.disabled = locked;
    $('model-fast-help').textContent =
      caps?.fast?.description ??
      'Uses the faster service tier. Usage limits or pricing may differ.';
    $('model-options').hidden = !selected && draft.modelId !== CUSTOM_MODEL_ID;
    $('model-unsaved').hidden = !dirty();
    $('model-discard').hidden = !dirty();
    $<HTMLButtonElement>('model-discard').disabled = locked;
    $('model-save-note').textContent =
      invalid() ||
      'Changes apply when you save. Your translation languages and display stay unchanged.';
    $<HTMLButtonElement>('model-test-button').disabled = locked || !!invalid();
    $<HTMLButtonElement>('save-all-btn').disabled = locked || (dirty() && !!invalid());
  }
  async function action(request: unknown): Promise<Reply> {
    pending = true;
    message('');
    render();
    try {
      const response = await host.honyoSettings.model(request);
      if (!response.ok) message(response.error ?? 'The operation failed.', true);
      return response;
    } catch (error) {
      const response = {
        ok: false,
        error: error instanceof Error ? error.message : 'The operation failed.',
      };
      message(response.error, true);
      return response;
    } finally {
      pending = false;
      render();
    }
  }
  host.modelSettings = {
    isDirty: dirty,
    save: async (): Promise<boolean> => {
      if (!dirty()) return true;
      if (invalid()) {
        message(invalid(), true);
        return false;
      }
      const response = await action({ action: 'save', draft });
      if (response.ok) {
        baseline = JSON.stringify(draft);
        message('Model settings saved.');
        render();
      }
      return response.ok;
    },
  };
  $('model-choice').onchange = (): void => selectModel($<HTMLSelectElement>('model-choice').value);
  $('manual-model-id').oninput = (): void => {
    if (draft) draft.customModel = $<HTMLInputElement>('manual-model-id').value;
    render();
  };
  $('model-effort').onchange = (): void => {
    if (draft) draft.effort = $<HTMLSelectElement>('model-effort').value || null;
    render();
  };
  $('model-fast').onchange = (): void => {
    if (draft) draft.fast = $<HTMLInputElement>('model-fast').checked;
    render();
  };
  $('model-discard').onclick = reset;
  $('model-download').onclick = (): void => {
    if (draft) void action({ action: 'install', id: draft.modelId });
  };
  $('model-download-cancel').onclick = (): void => {
    void host.honyoSettings.model({ action: 'cancel' });
  };
  $('model-login').onclick = (): void => {
    void action({ action: 'login' });
  };
  $('model-logout').onclick = (): void => {
    void action({ action: 'logout' });
  };
  $('model-refresh').onclick = (): void => {
    void action({ action: 'refresh', provider: draft?.provider });
  };
  $('model-key-save').onclick = (): void => {
    const key = $<HTMLInputElement>('provider-api-key').value.trim();
    if (!key) {
      message('Enter an API key.', true);
      return;
    }
    void action({ action: 'key', provider: draft?.provider, key }).then(r => {
      if (r.ok) {
        $<HTMLInputElement>('provider-api-key').value = '';
        message('API key saved.');
      }
    });
  };
  $('model-key-remove').onclick = (): void => {
    if (confirm('Remove the saved API key for this provider?'))
      void action({ action: 'key', provider: draft?.provider, key: '' });
  };
  $('model-test-button').onclick = (): void => {
    $('model-test-output').textContent = '';
    $('model-test-meta').textContent = 'Translating…';
    void action({
      action: 'test',
      draft,
      text: $<HTMLTextAreaElement>('model-test-input').value,
    }).then(r => {
      $('model-test-meta').textContent = r.ok ? ` ${r.seconds?.toFixed(1)} s` : 'Test failed';
      if (r.ok) $('model-test-output').textContent = r.translation ?? '';
    });
  };
  function update(value: State): void {
    const changed = dirty();
    state = value;
    if (!draft || !changed) {
      draft = active();
      baseline = JSON.stringify(draft);
    }
    render();
  }
  host.honyoSettings.on('model-settings-state', (_event, payload) => update(payload as State));
  host.honyoSettings.on('model-settings-chunk', (_event, payload) => {
    $('model-test-output').textContent = String(payload);
  });
  void host.honyoSettings
    .model({ action: 'state' })
    .then(r => {
      if (r.state) update(r.state);
      else message(r.error ?? 'Unable to load model settings.', true);
    })
    .catch(() => message('Unable to load model settings.', true));
  window.addEventListener('beforeunload', event => {
    if (dirty() && !confirm('Discard unsaved model changes?')) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
})();
