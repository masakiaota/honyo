import { ipcMain, type BrowserWindow } from 'electron';
import { z } from 'zod';
import {
  getConfig,
  getApiKeys,
  updateApiKeys,
  updateConfig,
  subscribeConfig,
} from '../config/index.ts';
import { getAvailableModels, refreshModels, subscribeModels } from '../models-remote.ts';
import {
  applyModelDraft,
  draftForModel,
  modelCapabilities,
  PROVIDERS,
  resolveDraft,
} from '../model-selection.ts';
import { getSelectedModelInfo } from '../reasoning-effort.ts';
import {
  getCodexConnectionState,
  subscribeCodexConnection,
  startCodexLogin,
  initializeCodex,
  logoutCodex,
} from '../codex/index.ts';
import { isLocalModel, LOCAL_MODELS, localDirection } from '../local/model.ts';
import {
  localSupported,
  localState,
  subscribeLocal,
  installLocal,
  deleteLocal,
  cancelLocalDownload,
  warmLocal,
  releaseLocal,
} from '../local/index.ts';
import { translateTextStreaming } from '../translation/index.ts';
import { isCurrentlyTranslating } from '../keyboard/handler.ts';
import { getTray } from './tray.ts';
import { createTrayMenu } from './menu.ts';

const draftSchema = z.object({
  provider: z.enum(['local', 'codex', 'openai', 'anthropic', 'google']),
  modelId: z.string().max(200),
  customModel: z.string().max(200),
  effort: z.string().max(30).nullable(),
  fast: z.boolean(),
});
const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('state') }),
  z.object({ action: z.literal('save'), draft: draftSchema }),
  z.object({
    action: z.literal('test'),
    draft: draftSchema,
    text: z.string().trim().min(1).max(2000),
  }),
  z.object({ action: z.enum(['install', 'delete']), id: z.string() }),
  z.object({ action: z.enum(['cancel', 'login', 'logout']) }),
  z.object({
    action: z.literal('refresh'),
    provider: z.enum(['local', 'codex', 'openai', 'anthropic', 'google']).optional(),
  }),
  z.object({
    action: z.literal('key'),
    provider: z.enum(['openai', 'anthropic', 'google']),
    key: z.string().trim().max(1000),
  }),
]);

export function setupModelSettingsIPC(window: () => BrowserWindow | null): void {
  let busy = false;
  const keyErrors = new Set<string>();
  const state = (): object => {
    const config = getConfig();
    const keys = getApiKeys();
    const account = getCodexConnectionState();
    const selected = getSelectedModelInfo(config);
    const catalog = getAvailableModels();
    const installed = Object.keys(LOCAL_MODELS).filter(id => localState(id).installed).length;
    return {
      providers: PROVIDERS.map(p => ({
        ...p,
        status:
          p.id === 'local'
            ? localSupported
              ? installed
                ? `Ready · ${installed} downloaded`
                : 'Download required'
              : 'Apple Silicon required'
            : p.id === 'codex'
              ? account.status === 'connected'
                ? 'Signed in'
                : account.status === 'connecting'
                  ? 'Signing in…'
                  : account.error
                    ? 'Connection error'
                    : 'Not signed in'
              : keyErrors.has(p.id)
                ? 'Authentication error'
                : keys[p.id]
                  ? 'API key saved'
                  : 'Not configured',
      })),
      models: Object.entries(catalog).map(([id, m]) => ({
        id,
        ...m,
        caps: modelCapabilities(m),
        saved: draftForModel(config, id, m),
      })),
      current: selected ? draftForModel(config, config.aiModel, selected) : null,
      currentId: config.aiModel,
      currentLabel: selected?.name ?? config.aiModel,
      history: config.modelHistory ?? {},
      custom: config.customModel ?? null,
      local: Object.fromEntries(
        Object.entries(LOCAL_MODELS).map(([id, m]) => [
          id,
          {
            ...localState(id),
            name: m.name,
            memory: m.memory,
            source: m.url.split('/resolve/')[0],
            license: m.url.replace('/resolve/', '/blob/').replace(m.file, 'LICENSE.txt'),
          },
        ]),
      ),
      busy: busy || Object.keys(LOCAL_MODELS).some(id => localState(id).busy),
      account: { status: account.status, error: account.error },
      languages: { primary: config.targetLanguage, secondary: config.secondaryLanguage },
    };
  };
  const publish = (): void => {
    const win = window();
    if (win && !win.isDestroyed()) win.webContents.send('model-settings-state', state());
  };
  subscribeLocal(publish);
  subscribeModels(publish);
  subscribeCodexConnection(publish);
  subscribeConfig(() => {
    publish();
    const tray = getTray();
    tray?.setContextMenu(createTrayMenu(tray, () => undefined));
  });
  ipcMain.handle('model-settings', async (event, raw: unknown) => {
    if (event.sender !== window()?.webContents) throw new Error('Invalid settings window');
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'Invalid model settings request.' };
    const request = parsed.data;
    if (request.action === 'state') return { ok: true, state: state() };
    if (request.action === 'cancel') {
      cancelLocalDownload();
      return { ok: true };
    }
    if (busy || Object.keys(LOCAL_MODELS).some(id => localState(id).busy))
      return { ok: false, error: 'Wait for the current operation to finish.' };
    busy = true;
    publish();
    let touchedLocal = false;
    let saved = false;
    try {
      if (request.action === 'key') {
        updateApiKeys({ [request.provider]: request.key });
        keyErrors.delete(request.provider);
        void refreshModels();
      } else if (request.action === 'login') await startCodexLogin();
      else if (request.action === 'logout') await logoutCodex();
      else if (request.action === 'refresh') {
        if (request.provider === 'codex') await initializeCodex();
        else await refreshModels(true);
      } else if (request.action === 'install' || request.action === 'delete') {
        if (!isLocalModel(request.id)) throw new Error('Unknown offline model.');
        if (request.action === 'delete' && getConfig().aiModel === request.id)
          throw new Error('Select and save another model before deleting the active model.');
        await (request.action === 'install' ? installLocal(request.id) : deleteLocal(request.id));
      } else if (request.action === 'save' || request.action === 'test') {
        if (isCurrentlyTranslating())
          throw new Error('Wait for the current translation to finish.');
        const draft = request.draft;
        const model = resolveDraft(draft, getAvailableModels());
        let next = applyModelDraft(getConfig(), draft, getAvailableModels());
        if (draft.provider === 'local') {
          if (!localSupported)
            throw new Error('Offline translation requires an Apple Silicon Mac.');
          localDirection('Hello', next.targetLanguage, next.secondaryLanguage);
          if (!localState(draft.modelId).installed)
            throw new Error('Download this model before saving or testing it.');
          touchedLocal = true;
          await warmLocal(draft.modelId);
          if (localState(draft.modelId).error) throw new Error(localState(draft.modelId).error);
        } else if (draft.provider === 'codex') {
          if (getCodexConnectionState().status !== 'connected')
            throw new Error('Sign in with ChatGPT first.');
        } else if (!getApiKeys()[draft.provider])
          throw new Error('Save an API key for this provider first.');
        if (request.action === 'save') {
          next = applyModelDraft(getConfig(), draft, getAvailableModels());
          if (draft.provider === 'local')
            localDirection('Hello', next.targetLanguage, next.secondaryLanguage);
          updateConfig(next, { localModelPrepared: draft.provider === 'local' });
          saved = true;
        } else {
          const start = Date.now();
          const translation = await translateTextStreaming(
            request.text,
            next.targetLanguage,
            next.secondaryLanguage,
            chunk => {
              if (!event.sender.isDestroyed()) event.sender.send('model-settings-chunk', chunk);
            },
            AbortSignal.timeout(90000),
            undefined,
            next,
          );
          return { ok: true, translation, seconds: (Date.now() - start) / 1000, model: model.name };
        }
      }
      return { ok: true };
    } catch (error) {
      if (
        request.action === 'test' &&
        error &&
        typeof error === 'object' &&
        'statusCode' in error &&
        [401, 403].includes(Number(error.statusCode))
      )
        keyErrors.add(request.draft.provider);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (touchedLocal && !saved) {
        releaseLocal();
        if (isLocalModel(getConfig().aiModel)) await warmLocal(getConfig().aiModel);
      }
      busy = false;
      publish();
    }
  });
}
