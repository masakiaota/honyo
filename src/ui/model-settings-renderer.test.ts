import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCAL_MODELS, LOCAL_MODEL_ID, LOCAL_7B_MODEL_ID } from '../local/model.ts';
import { LOCAL_MLX_7B_MODEL_ID } from '../local/mlx-model.ts';
import { LOCAL_MLX_18_MODEL_ID } from '../local/mlx-model-18.ts';
import { localRuntime } from '../local/catalog.ts';

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

async function settings(currentId: string): Promise<{
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
          installed: id === currentId,
          phase: 'ready',
          bytes: 0,
          total: spec.bytes,
          error: '',
          ...localRuntime(id),
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

it.each(Object.keys(LOCAL_MODELS))(
  'preserves saved %s without download or silent backend migration',
  async id => {
    const { elements, api, host } = await settings(id);
    expect(elements.get('model-choice')?.value).toBe(localRuntime(id).family);
    expect(elements.get('local-runtime-choice')?.value).toBe(id);
    expect(elements.get('local-runtime-choice')?.children).toHaveLength(2);
    expect(host.modelSettings.isDirty()).toBe(false);
    expect(api.mock.calls).toEqual([[{ action: 'state' }]]);
  },
);

it('separates family choice from advanced runtime and requires explicit download before save', async () => {
  const { elements, api, host } = await settings(LOCAL_MODEL_ID);
  const family = elements.get('model-choice');
  if (!family) throw new Error('Missing family select');
  family.value = 'hy7';
  family.onchange?.();
  expect(elements.get('local-runtime-choice')?.value).toBe(LOCAL_MLX_7B_MODEL_ID);
  expect(host.modelSettings.isDirty()).toBe(true);
  const runtime = elements.get('local-runtime-choice');
  if (!runtime) throw new Error('Missing runtime select');
  runtime.value = LOCAL_7B_MODEL_ID;
  runtime.onchange?.();
  expect(family.value).toBe('hy7');
  expect(await host.modelSettings.save()).toBe(false);
  expect(api).toHaveBeenCalledOnce();
  elements.get('model-download')?.onclick?.();
  expect(api).toHaveBeenLastCalledWith({ action: 'install', id: LOCAL_7B_MODEL_ID });
});

it('discloses experimental LF-only 1.8B MLX and leaves lightweight recommendation on GGUF', async () => {
  const { elements } = await settings(LOCAL_MLX_18_MODEL_ID);
  expect(elements.get('local-runtime-summary')?.textContent).toContain('Experimental, LF-only');
  const family = elements.get('model-choice');
  if (!family) throw new Error('Missing family select');
  family.value = 'hy7';
  family.onchange?.();
  family.value = 'hy18';
  family.onchange?.();
  expect(elements.get('local-runtime-choice')?.value).toBe(LOCAL_MODEL_ID);
});
