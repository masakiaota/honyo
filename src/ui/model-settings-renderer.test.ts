import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCAL_MODELS, LOCAL_MODEL_ID } from '../local/model.ts';
import { LOCAL_MLX_7B_MODEL_ID } from '../local/mlx-model.ts';

class Element {
  value = '';
  textContent = '';
  hidden = false;
  disabled = false;
  checked = false;
  children: Element[] = [];
  onchange?: () => void;
  onclick?: () => void;
  classList = { toggle: vi.fn() };
  setAttribute = vi.fn();
  toggleAttribute = vi.fn();
  constructor(text = '', value = '') {
    this.textContent = text;
    this.value = value;
  }
  replaceChildren(...children: Element[]): void {
    this.children = children;
  }
  append(...children: Element[]): void {
    this.children.push(...children);
  }
  add(child: Element): void {
    this.children.push(child);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function settings(
  currentId: string,
  downloaded = [currentId],
): Promise<{
  elements: Map<string, Element>;
  api: ReturnType<typeof vi.fn>;
  host: { modelSettings: { isDirty(): boolean; save(): Promise<boolean> } };
}> {
  // Use actual HTML IDs: a renderer reference to a missing element must fail.
  const html = readFileSync(new URL('../../settings.html', import.meta.url), 'utf8');
  const elements = new Map(
    [...html.matchAll(/\bid="([^"]+)"/g)].map(match => [String(match[1]), new Element()]),
  );
  const draft = {
    provider: 'local',
    modelId: currentId,
    customModel: '',
    effort: null,
    fast: false,
  };
  const state = {
    providers: [],
    models: Object.entries(LOCAL_MODELS).map(([id, spec]) => ({
      id,
      provider: 'local',
      name: spec.name,
      caps: { efforts: [] },
      saved: { ...draft, modelId: id },
    })),
    current: draft,
    currentId,
    currentLabel: 'Local',
    history: {},
    custom: null,
    local: Object.fromEntries(
      Object.entries(LOCAL_MODELS).map(([id, spec]) => [
        id,
        {
          id,
          name: spec.name,
          memory: spec.memory,
          supported: true,
          installed: downloaded.includes(id),
          phase: 'ready',
          bytes: 0,
          total: spec.bytes,
          error: '',
        },
      ]),
    ),
    busy: false,
    account: { status: 'disconnected' },
    languages: { primary: 'Japanese', secondary: 'English' },
  };
  const api = vi.fn().mockResolvedValue({ ok: true, state });
  const host = {
    honyoSettings: { model: api, on: vi.fn() },
    addEventListener: vi.fn(),
    modelSettings: undefined as unknown as { isDirty(): boolean; save(): Promise<boolean> },
  };
  vi.stubGlobal('window', host);
  vi.stubGlobal('document', {
    getElementById: (id: string) => elements.get(id),
    createElement: () => new Element(),
  });
  vi.stubGlobal('Option', Element);
  await import('./model-settings-renderer.ts');
  await vi.waitFor(() => expect(elements.get('model-choice')?.children).toHaveLength(3));
  return { elements, api, host };
}

it.each(Object.keys(LOCAL_MODELS))('shows the saved %s in a single model selector', async id => {
  const { elements, api, host } = await settings(id);
  expect(elements.get('model-choice')?.value).toBe(id);
  expect(elements.get('model-choice')?.children.map(item => item.value)).toEqual([
    '',
    LOCAL_MODEL_ID,
    LOCAL_MLX_7B_MODEL_ID,
  ]);
  expect(elements.has('local-runtime-choice')).toBe(false);
  expect(elements.has('local-runtime-options')).toBe(false);
  expect(elements.get('model-options')?.hidden).toBe(true);
  expect(elements.get('model-download-status')?.textContent).toBe('Downloaded · Ready');
  expect(elements.get('model-download')?.hidden).toBe(true);
  expect(host.modelSettings.isDirty()).toBe(false);
  expect(api.mock.calls).toEqual([[{ action: 'state' }]]);
});

it('selects 7B MLX directly and requires explicit download before save', async () => {
  const { elements, api, host } = await settings(LOCAL_MODEL_ID);
  const select = elements.get('model-choice');
  if (!select) throw new Error('Missing model select');
  select.value = LOCAL_MLX_7B_MODEL_ID;
  select.onchange?.();
  expect(select.value).toBe(LOCAL_MLX_7B_MODEL_ID);
  expect(host.modelSettings.isDirty()).toBe(true);
  expect(elements.get('model-download')?.hidden).toBe(false);
  expect(await host.modelSettings.save()).toBe(false);
  expect(api).toHaveBeenCalledOnce();
  elements.get('model-download')?.onclick?.();
  expect(api).toHaveBeenLastCalledWith({ action: 'install', id: LOCAL_MLX_7B_MODEL_ID });
});

it('saves downloaded 7B MLX without a runtime choice or another download', async () => {
  const { elements, api, host } = await settings(LOCAL_MODEL_ID, [
    LOCAL_MODEL_ID,
    LOCAL_MLX_7B_MODEL_ID,
  ]);
  const select = elements.get('model-choice');
  if (!select) throw new Error('Missing model select');
  select.value = LOCAL_MLX_7B_MODEL_ID;
  select.onchange?.();
  expect(await host.modelSettings.save()).toBe(true);
  expect(api).toHaveBeenLastCalledWith({
    action: 'save',
    draft: {
      provider: 'local',
      modelId: LOCAL_MLX_7B_MODEL_ID,
      customModel: '',
      effort: null,
      fast: false,
    },
  });
  expect(host.modelSettings.isDirty()).toBe(false);
  expect(api).toHaveBeenCalledTimes(2);
});

it('discards a model change without altering the saved selection or downloading', async () => {
  const { elements, api, host } = await settings(LOCAL_MLX_7B_MODEL_ID);
  const select = elements.get('model-choice');
  if (!select) throw new Error('Missing model select');
  select.value = LOCAL_MODEL_ID;
  select.onchange?.();
  expect(host.modelSettings.isDirty()).toBe(true);
  elements.get('model-discard')?.onclick?.();
  expect(select.value).toBe(LOCAL_MLX_7B_MODEL_ID);
  expect(host.modelSettings.isDirty()).toBe(false);
  expect(api.mock.calls).toEqual([[{ action: 'state' }]]);
});

it.each(['local-hy-mt2-7b-q4', 'local-hy-mt2-1.8b-mlx-4bit'])(
  'does not expose removed %s or silently choose another model',
  async id => {
    const { elements, api } = await settings(id);
    expect(elements.get('model-choice')?.children.map(item => item.value)).not.toContain(id);
    expect(elements.get('local-model-setup')?.hidden).toBe(true);
    expect(api.mock.calls).toEqual([[{ action: 'state' }]]);
  },
);
