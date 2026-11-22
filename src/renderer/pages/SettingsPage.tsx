import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertCircle, Check, Download, ExternalLink, FolderOpen, ImagePlus, Languages, Loader2, Move, Palette, RefreshCw, RotateCcw, Settings2, Shield, Shuffle, Sparkles, Trash2, Users, Wrench } from 'lucide-react';
import type { JavaInstallation, Settings } from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Field, Segmented, Toggle } from '../components/Common';
import { AccountModal } from '../components/AccountModal';
import { getTheme, lightenHex, THEME_MOTION, THEME_ORDER, THEMES } from '../../shared/themes';
import { displayVersion } from '../../shared/version';
import { applyAppearance, applyDraftBackground, clearDraftBackground, customBackgroundImage, customBackgroundVars } from '../theme';
import { droppedFile, isFileDrag, readFileAsDataUrl } from '../fileDrop';

type Tab = 'appearance' | 'general' | 'performance' | 'accounts' | 'about';

const ACCENTS = ['#ff6b35', '#8b5cf6', '#3b82f6', '#10b981', '#f43f5e', '#eab308', '#06b6d4', '#22d3ee', '#f472b6'];
const BACKGROUNDS = [
  { id: 'aurora', label: 'Aurora', className: 'hero-aurora' },
  { id: 'sunset', label: 'Sunset', className: 'hero-sunset' },
  { id: 'midnight', label: 'Midnight', className: 'hero-midnight' },
  { id: 'forest', label: 'Forest', className: 'hero-forest' },
  { id: 'ocean', label: 'Ocean', className: 'hero-ocean' },
  { id: 'neon', label: 'Neon', className: 'hero-neon' },
  { id: 'rose', label: 'Rose', className: 'hero-rose' },
  { id: 'void', label: 'Void', className: 'hero-void' },
  { id: 'galaxy', label: 'Galaxy', className: 'hero-galaxy' },
  { id: 'sakura', label: 'Sakura Sky', className: 'hero-sakura' },
  { id: 'cyber', label: 'Cyber Grid', className: 'hero-cyber' },
  { id: 'volcano', label: 'Volcano', className: 'hero-volcano' },
  { id: 'mint', label: 'Mint Wave', className: 'hero-mint' },
  { id: 'crystal', label: 'Crystal', className: 'hero-crystal' },
  { id: 'nebula', label: 'Nebula', className: 'hero-nebula' },
  { id: 'matrix', label: 'Matrix', className: 'hero-matrix' },
  { id: 'snow', label: 'Snowfall', className: 'hero-snow' },
  { id: 'ember', label: 'Ember Storm', className: 'hero-ember' },
  { id: 'prism', label: 'Prism', className: 'hero-prism' },
  { id: 'lunar', label: 'Lunar', className: 'hero-lunar' },
  { id: 'candy', label: 'Candy', className: 'hero-candy' },
  { id: 'lagoon', label: 'Lagoon', className: 'hero-lagoon' },
];

const CROP_ALIGNMENTS = [
  { label: 'Top left', x: 0, y: 0 }, { label: 'Top center', x: 50, y: 0 }, { label: 'Top right', x: 100, y: 0 },
  { label: 'Middle left', x: 0, y: 50 }, { label: 'Center', x: 50, y: 50 }, { label: 'Middle right', x: 100, y: 50 },
  { label: 'Bottom left', x: 0, y: 100 }, { label: 'Bottom center', x: 50, y: 100 }, { label: 'Bottom right', x: 100, y: 100 },
];

const EFFECT_COUNT = new Set(Object.values(THEME_MOTION).map((motion) => motion.effect)).size;

const TAB_DESCRIPTIONS: Record<Tab, string> = {
  appearance: `Themes recolor the whole window. Preview motion, colors and ${BACKGROUNDS.length} animated wallpapers — everything saves automatically.`,
  general: 'Language, startup behavior, Java defaults and update checks.',
  performance: 'Default memory, resolution, Java executable and download speed.',
  accounts: 'Offline profiles and the launcher update feed.',
  about: 'Version details, updates and local diagnostics.',
};

const TAB_HINTS: Record<Tab, string> = {
  appearance: 'Look & feel',
  general: 'Behavior',
  performance: 'Hardware',
  accounts: 'Profiles',
  about: 'Details',
};

const SETTING_LABELS: Record<string, string> = {
  language: 'Language',
  closeBehavior: 'Close behavior',
  checkUpdates: 'Startup updates',
  autoInstallJava: 'Java auto-install',
  telemetry: 'Local diagnostics',
  javaPath: 'Java executable',
  gameResolution: 'Game resolution',
  fullscreen: 'Fullscreen',
  memoryMb: 'Default memory',
  downloadThreads: 'Download threads',
  jvmArgs: 'JVM arguments',
  updateFeedUrl: 'Update feed',
  lastInstanceId: 'Last instance',
};

function effectLabel(effect: string): string {
  if (!effect || effect === 'none') return 'Static';
  return effect.charAt(0).toUpperCase() + effect.slice(1);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function changedPatch<T extends object>(original: T, draft: T): Partial<T> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(draft) as Array<keyof T>) {
    if (JSON.stringify(draft[key]) !== JSON.stringify(original[key])) patch[key as string] = draft[key];
  }
  return patch as Partial<T>;
}

export function SettingsPage() {
  const { settings, updateSettings, resetSettings, checkForUpdate, updateAvailable } = useApp();
  const t = useT();
  const [draft, setDraft] = useState<Settings>(settings);
  // Kept in sync synchronously so rapid clicks in one tick never overwrite each other.
  const draftRef = useRef(settings);
  const [dirty, setDirty] = useState(false);
  const settingsRef = useRef(settings);
  const [tab, setTab] = useState<Tab>('appearance');
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([]);
  const [version, setVersion] = useState('');
  const [dataPath, setDataPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [diagnostics, setDiagnostics] = useState<Record<string, number>>({});
  const [accountModal, setAccountModal] = useState(false);
  const [lastChange, setLastChange] = useState('');
  const [statusDescription, setStatusDescription] = useState('');
  const [draggingCrop, setDraggingCrop] = useState(false);
  const [backgroundDragOver, setBackgroundDragOver] = useState(false);
  const dragRef = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const saveTimer = useRef<number | null>(null);
  const savingRef = useRef(false);
  const queuedSave = useRef(false);
  const persistRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    const changed = JSON.stringify(settingsRef.current) !== JSON.stringify(settings);
    settingsRef.current = settings;
    // External writes (for example launching an instance) must not discard a
    // draft that is still waiting for its debounced autosave.
    if (changed && !dirty && !savingRef.current) {
      draftRef.current = settings;
      setDraft(settings);
      setDirty(false);
    }
  }, [settings, dirty]);

  useEffect(() => {
    const root = document.documentElement;
    applyAppearance(root, draft.appearance);
    applyDraftBackground(root, draft.appearance);
  }, [draft.appearance]);

  useEffect(() => () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    const root = document.documentElement;
    // Leaving the page flushes the final edit instead of silently dropping it.
    void persistRef.current().finally(() => applyAppearance(root, settingsRef.current.appearance));
    clearDraftBackground(root);
  }, []);

  useEffect(() => {
    void window.fox.java.detect().then(setJavaInstallations).catch(() => undefined);
    void window.fox.app.getVersion().then(setVersion);
    void window.fox.app.getPath('userData').then(setDataPath);
    void window.fox.app.getDiagnostics().then((stats) => setDiagnostics(stats.events)).catch(() => undefined);
  }, []);

  function describeChange(value: Partial<Settings>, current: Settings): string {
    if (value.appearance) {
      const appearance = value.appearance;
      if (appearance.theme && appearance.theme !== current.appearance.theme) return `Theme · ${getTheme(appearance.theme).label}`;
      if (appearance.background && appearance.background !== current.appearance.background) {
        return `Background · ${BACKGROUNDS.find((item) => item.id === appearance.background)?.label ?? appearance.background}`;
      }
      if (appearance.accent && appearance.accent !== current.appearance.accent) return `Accent · ${appearance.accent.toUpperCase()}`;
      if (appearance.themeMotion && appearance.themeMotion !== current.appearance.themeMotion) return `Motion · ${appearance.themeMotion}`;
      if (appearance.density && appearance.density !== current.appearance.density) return `Density · ${appearance.density}`;
      if (appearance.animations !== current.appearance.animations) return `Animations ${appearance.animations ? 'on' : 'off'}`;
      if (appearance.blur !== current.appearance.blur) return `Blur ${appearance.blur ? 'on' : 'off'}`;
      if (appearance.backgroundImage !== current.appearance.backgroundImage) return appearance.backgroundImage ? 'Custom background set' : 'Custom background removed';
      if (appearance.backgroundFit && appearance.backgroundFit !== current.appearance.backgroundFit) return `Background fit · ${appearance.backgroundFit}`;
      if (appearance.backgroundZoom !== undefined && Math.abs(appearance.backgroundZoom - (current.appearance.backgroundZoom ?? 1)) > .001) {
        return `Background zoom · ${Math.round(appearance.backgroundZoom * 100)}%`;
      }
      if (appearance.backgroundPosition && JSON.stringify(appearance.backgroundPosition) !== JSON.stringify(current.appearance.backgroundPosition ?? { x: 50, y: 50 })) {
        return `Background focus · ${Math.round(appearance.backgroundPosition.x)}%, ${Math.round(appearance.backgroundPosition.y)}%`;
      }
    }
    const key = (Object.keys(value) as Array<keyof Settings>).find((name) => JSON.stringify(value[name]) !== JSON.stringify(current[name]));
    if (!key) return '';
    return `${SETTING_LABELS[key as string] ?? String(key).replace(/([A-Z])/g, ' $1')} updated`;
  }

  function queueSave(delay = 350) {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void persistRef.current();
    }, delay);
  }

  async function persistDraft() {
    if (savingRef.current) {
      queuedSave.current = true;
      return;
    }
    const patch = changedPatch(settingsRef.current, draftRef.current);
    if (Object.keys(patch).length === 0) {
      setDirty(false);
      setSaving(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      const next = await updateSettings(patch);
      settingsRef.current = next;
      // Edits made while the IPC round trip was in flight get one more pass.
      if (Object.keys(changedPatch(next, draftRef.current)).length > 0) queuedSave.current = true;
      else {
        setDirty(false);
        setLastChange('');
        setStatusDescription('Settings saved automatically. Changes are active now.');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSaveError(message);
      setStatusDescription(`Could not save settings: ${message}. Your changes are still here — retry below.`);
    } finally {
      savingRef.current = false;
      setSaving(false);
      if (queuedSave.current) {
        queuedSave.current = false;
        queueSave(0);
      }
    }
  }

  persistRef.current = persistDraft;

  function patch(value: Partial<Settings>) {
    const current = draftRef.current;
    const message = describeChange(value, current);
    if (!message) return;
    const next = { ...current, ...value };
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
    setLastChange(message);
    setSaveError('');
    setStatusDescription(`${message}. Saving automatically…`);
    queueSave();
  }

  function patchAppearance(value: Partial<Settings['appearance']>) {
    patch({ appearance: { ...draftRef.current.appearance, ...value } });
  }

  function currentCropPoint() {
    return draftRef.current.appearance.backgroundPosition ?? { x: 50, y: 50 };
  }

  function startCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const point = currentCropPoint();
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, x: point.x, y: point.y };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingCrop(true);
  }

  function moveCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const zoom = Math.max(1, draftRef.current.appearance.backgroundZoom ?? 1);
    const x = drag.x - ((event.clientX - drag.pointerX) / Math.max(1, rect.width)) * 100 / zoom;
    const y = drag.y - ((event.clientY - drag.pointerY) / Math.max(1, rect.height)) * 100 / zoom;
    patchAppearance({
      backgroundPosition: {
        x: Math.round(Math.min(100, Math.max(0, x))),
        y: Math.round(Math.min(100, Math.max(0, y))),
      },
    });
  }

  function endCropDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDraggingCrop(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function resetCrop() {
    patchAppearance({ backgroundPosition: { x: 50, y: 50 }, backgroundFit: 'cover', backgroundZoom: 1 });
  }

  async function applyDroppedBackground(file: File) {
    try {
      const image = await readFileAsDataUrl(file);
      patchAppearance({
        background: 'custom',
        backgroundImage: image,
        backgroundPosition: { x: 50, y: 50 },
        backgroundFit: 'cover',
        backgroundZoom: 1,
      });
      setStatusDescription(`Custom background set from ${file.name}. Saving automatically…`);
    } catch (error) {
      setStatusDescription(`Could not read the dropped image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function surpriseMe() {
    const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
    const choices = THEME_ORDER.filter((id) => id !== draftRef.current.appearance.theme);
    const themeId = pick(choices);
    const theme = THEMES[themeId];
    const backdrops = BACKGROUNDS.filter((item) => item.id !== theme.background && item.id !== 'custom');
    const background = Math.random() > .45 ? theme.background : pick(backdrops).id;
    const motions: NonNullable<Settings['appearance']['themeMotion']>[] = ['calm', 'normal', 'vivid'];
    patchAppearance({
      theme: themeId,
      accent: theme.accent,
      background,
      backgroundImage: '',
      backgroundPosition: { x: 50, y: 50 },
      backgroundFit: 'cover',
      backgroundZoom: 1,
      themeMotion: pick(motions),
    });
  }

  async function checkNow() {
    setCheckingUpdate(true);
    try {
      const result = await checkForUpdate();
      if (!result.configured) setStatusDescription('Set a launcher update feed in Accounts first.');
      else if (result.available) setStatusDescription(`Fox Launcher ${result.version} is available. Open the update link below to download it.`);
      else setStatusDescription(`Fox Launcher ${result.current} is up to date.`);
    } catch (error) {
      setStatusDescription(`Update check failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function clearLocalDiagnostics() {
    await window.fox.app.clearDiagnostics();
    setDiagnostics({});
    setStatusDescription('Local diagnostics cleared. Counters will start fresh.');
  }

  return (
    <div className="page settings-page">
      <div className="page-header">
        <div>
          <h1>{t('settings')}</h1>
          <p>{t('settingsDescription')}</p>
          {statusDescription && <p className="status-description">{statusDescription}</p>}
        </div>
        <div className="header-actions">
          <span
            className={saveError ? 'change-pill save-error-pill' : saving || dirty ? 'change-pill' : 'saved-pill'}
            title={saveError || lastChange || undefined}
          >
            {saveError ? <AlertCircle size={13} /> : saving || dirty ? <Loader2 size={13} className="autosave-spinner" /> : <Check size={13} />}
            {saveError ? t('saveFailed') : saving || dirty ? t('saving') : t('savedAutomatically')}
          </span>
          {saveError && <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void persistDraft()}>{t('retry')}</Button>}
        </div>
      </div>

      <div className="settings-layout">
        <div className="settings-nav">
          <div className="settings-nav-caption">PREFERENCES</div>
          {([
            { id: 'appearance', label: t('appearance'), icon: Palette },
            { id: 'general', label: t('general'), icon: Settings2 },
            { id: 'performance', label: t('performance'), icon: Wrench },
            { id: 'accounts', label: t('accounts'), icon: Shield },
            { id: 'about', label: t('about'), icon: Languages },
          ] as const).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
                <span className="settings-nav-icon"><Icon size={16} /></span>
                <span className="settings-nav-copy"><strong>{item.label}</strong><small>{TAB_HINTS[item.id]}</small></span>
                <span className="settings-nav-arrow">›</span>
              </button>
            );
          })}
          <div className="settings-nav-foot"><Sparkles size={13} /> Live preview · auto-save</div>
        </div>

        <div className="panel settings-content" key={tab}>
          <div className="settings-content-head">
            <span className="settings-content-icon"><Sparkles size={18} /></span>
            <div><h2>{t(tab)}</h2><p>{TAB_DESCRIPTIONS[tab]}</p></div>
            {tab === 'appearance' && <span className="live-badge">LIVE</span>}
          </div>
          {tab === 'appearance' && (
            <div
              className={`settings-section appearance-section ${backgroundDragOver ? 'drop-active' : ''}`}
              onDragEnter={(event) => {
                if (!isFileDrag(event)) return;
                event.preventDefault();
                setBackgroundDragOver(true);
              }}
              onDragOver={(event) => {
                if (isFileDrag(event)) event.preventDefault();
              }}
              onDragLeave={(event) => {
                const next = event.relatedTarget as Node | null;
                if (!next || !event.currentTarget.contains(next)) setBackgroundDragOver(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setBackgroundDragOver(false);
                const file = droppedFile(event, 'image');
                if (!file) {
                  setStatusDescription('Drop an image file to use it as the custom background.');
                  return;
                }
                void applyDroppedBackground(file);
              }}
            >
              <div className="settings-title-row">
                <h2>{t('theme')}</h2>
                <div className="title-row-actions">
                  <span className="source-chip">{THEME_ORDER.length} animated themes</span>
                  <Button variant="ghost" icon={<Shuffle size={14} />} onClick={surpriseMe}>Surprise me</Button>
                </div>
              </div>
              <p className="muted">Every card is a live miniature with its own aurora, beams, grid and signature scene effect. Hit Surprise me for a fresh animated combination.</p>
              <div className="theme-grid">
                {THEME_ORDER.map((id) => {
                  const theme = THEMES[id];
                  const motion = THEME_MOTION[id] ?? THEME_MOTION.fox;
                  const selected = getTheme(draft.appearance.theme).id === id;
                  return (
                    <button
                      key={id}
                      className={`theme-card ${selected ? 'active' : ''}`}
                      data-effect={motion.effect}
                      data-motion={motion.direction === 1 ? 'forward' : 'reverse'}
                      style={{
                        '--theme-accent': theme.accent,
                        '--theme-accent-2': lightenHex(theme.accent),
                        '--theme-bg': theme.bg,
                        '--theme-panel': theme.panel,
                        '--theme-panel-2': theme.panel2,
                        '--theme-orb-1': theme.orb1,
                        '--theme-orb-2': theme.orb2,
                        '--theme-orb-3': theme.orb3,
                        '--theme-ribbon-1': motion.ribbon1,
                        '--theme-ribbon-2': motion.ribbon2,
                        '--theme-grid-color': motion.grid,
                        '--theme-effect-1': motion.effectColor,
                        '--theme-effect-2': motion.effectColor2,
                        '--theme-speed': `${(3.4 / motion.speed).toFixed(2)}s`,
                      } as CSSProperties}
                      onClick={() => patchAppearance({ theme: id, accent: theme.accent, background: theme.background, backgroundImage: '' })}
                    >
                      <span className="theme-preview">
                        <span className="preview-aurora preview-aurora-a" />
                        <span className="preview-aurora preview-aurora-b" />
                        <span className="preview-grid" />
                        <span className="preview-titlebar"><i /><i /><i /></span>
                        <span className="preview-body">
                          <span className="preview-sidebar">
                            <i className="preview-logo" />
                            <i className="preview-nav active" />
                            <i className="preview-nav" />
                            <i className="preview-nav" />
                          </span>
                          <span className="preview-main">
                            <span className="preview-hero"><b /><b /><b /></span>
                            <span className="preview-cards"><i /><i /><i /></span>
                          </span>
                        </span>
                        <span className="preview-particles"><i /><i /><i /></span>
                      </span>
                      <span className="theme-card-copy"><strong>{theme.label}</strong><small>{effectLabel(motion.effect)}</small></span>
                      {selected && <Check size={14} />}
                    </button>
                  );
                })}
              </div>

              <div className="section-spaced">
                <div className="settings-title-row">
                  <h2>Animated theme</h2>
                  <span className="source-chip">Aurora + beams + particles</span>
                </div>
                <p className="muted">Each theme has its own moving colors, light beams, orbiting particles and rhythm. Turn animations off below for a still interface.</p>
                <Segmented
                  value={draft.appearance.themeMotion ?? 'vivid'}
                  options={[
                    { value: 'calm', label: 'Calm' },
                    { value: 'normal', label: 'Normal' },
                    { value: 'vivid', label: 'Vivid' },
                  ]}
                  onChange={(value) => patchAppearance({ themeMotion: value as Settings['appearance']['themeMotion'] })}
                />
              </div>

              <h2 className="section-spaced">{t('accent')}</h2>
              <p className="muted">A custom accent works with every theme.</p>
              <div className="accent-grid">
                {ACCENTS.map((color) => (
                  <button key={color} className={`accent-swatch ${draft.appearance.accent === color ? 'active' : ''}`}
                    style={{ background: color }} onClick={() => patchAppearance({ accent: color })}>
                    {draft.appearance.accent === color && <Check size={16} />}
                  </button>
                ))}
                <label className="accent-custom" title="Custom color">
                  <input type="color" value={draft.appearance.accent} onChange={(event) => patchAppearance({ accent: event.target.value })} />
                  +
                </label>
              </div>

              <div className="settings-title-row section-spaced">
                <h2>{t('background')}</h2>
                <span className="source-chip">{BACKGROUNDS.length} animated wallpapers</span>
              </div>
              <p className="muted">Flowing gradients plus animated patterns — stars, grids, ripples, embers and drifting light. Speed follows the theme animation setting.</p>
              <div className="background-grid">
                {BACKGROUNDS.map((item) => (
                  <button key={item.id} className={`background-option ${item.className} ${draft.appearance.background === item.id ? 'active' : ''}`}
                    title={`${item.label} wallpaper`}
                    onClick={() => patchAppearance({ background: item.id, backgroundImage: '' })}>
                    <span className="background-option-glow" />
                    <span className="background-option-motion" />
                    <span className="background-option-label">{item.label}</span>
                    {draft.appearance.background === item.id && <Check size={15} />}
                  </button>
                ))}
              </div>
              <p className="drop-hint"><ImagePlus size={13} /> Drop any image onto this page to use it as the custom background.</p>
              <div className="form-row spaced">
                <Button variant="secondary" onClick={() => void window.fox.app.selectImage().then((image) => {
                  if (image) patchAppearance({
                    background: 'custom',
                    backgroundImage: image,
                    backgroundPosition: { x: 50, y: 50 },
                    backgroundFit: 'cover',
                    backgroundZoom: 1,
                  });
                })}>Choose custom image</Button>
                {draft.appearance.backgroundImage && <Button variant="ghost" onClick={() => patchAppearance({
                  background: 'aurora',
                  backgroundImage: '',
                  backgroundPosition: { x: 50, y: 50 },
                  backgroundFit: 'cover',
                  backgroundZoom: 1,
                })}>Remove image</Button>}
              </div>
              {draft.appearance.background === 'custom' && draft.appearance.backgroundImage && (
                <div className="custom-background-editor">
                  <div
                    className={`custom-background-preview ${draggingCrop ? 'dragging' : ''}`}
                    style={{
                      '--custom-bg-image': customBackgroundImage(draft.appearance.backgroundImage),
                      ...customBackgroundVars(draft.appearance),
                    } as CSSProperties}
                    onPointerDown={startCropDrag}
                    onPointerMove={moveCropDrag}
                    onPointerUp={endCropDrag}
                    onPointerCancel={endCropDrag}
                  >
                    <div className="custom-background-layer" aria-hidden="true" />
                    <span><Move size={12} /> Drag to choose the visible area</span>
                  </div>
                  <div className="crop-controls">
                    <Field label={`Zoom · ${Math.round((draft.appearance.backgroundZoom ?? 1) * 100)}%`}>
                      <input
                        type="range" min={1} max={3} step={0.05}
                        value={draft.appearance.backgroundZoom ?? 1}
                        onChange={(event) => patchAppearance({ backgroundZoom: Number(event.target.value) })}
                      />
                    </Field>
                    <div className="field">
                      <span className="field-label">Fit</span>
                      <Segmented
                        value={draft.appearance.backgroundFit ?? 'cover'}
                        options={[
                          { value: 'cover', label: 'Fill' },
                          { value: 'contain', label: 'Fit' },
                          { value: 'stretch', label: 'Stretch' },
                          { value: 'auto', label: 'Original' },
                        ]}
                        onChange={(backgroundFit) => patchAppearance({ backgroundFit })}
                      />
                    </div>
                    <div className="crop-alignment">
                      <span className="field-label">Quick focus</span>
                      <div className="crop-align-grid">
                        {CROP_ALIGNMENTS.map((alignment) => {
                          const point = currentCropPoint();
                          const active = point.x === alignment.x && point.y === alignment.y;
                          return (
                            <button
                              key={alignment.label}
                              type="button"
                              className={active ? 'active' : ''}
                              title={alignment.label}
                              aria-label={alignment.label}
                              onClick={() => patchAppearance({ backgroundPosition: { x: alignment.x, y: alignment.y } })}
                            />
                          );
                        })}
                      </div>
                      <Button variant="ghost" size="sm" icon={<RotateCcw size={14} />} onClick={resetCrop}>Reset crop</Button>
                    </div>
                  </div>
                </div>
              )}

              <Segmented value={draft.appearance.density} onChange={(density) => patchAppearance({ density })}
                options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
              <div className="toggle-group">
                <Toggle checked={draft.appearance.animations} label={t('animations')} description={t('animations')}
                  onChange={(animations) => patchAppearance({ animations })} />
                <Toggle checked={draft.appearance.blur} label={t('blur')} description={t('blur')}
                  onChange={(blur) => patchAppearance({ blur })} />
              </div>
              <div className="shortcut-hint">
                <span><kbd>Ctrl</kbd> + <kbd>K</kbd> Quick actions</span>
                <span><kbd>Ctrl</kbd> + <kbd>1–6</kbd> Switch pages</span>
              </div>
            </div>
          )}

          {tab === 'general' && (
            <div className="settings-section">
              <h2>{t('language')} & {t('behavior')}</h2>
              <Field label={t('language')}>
                <select value={draft.language} onChange={(event) => patch({ language: event.target.value as Settings['language'] })}>
                  <option value="en">English</option>
                  <option value="vi">Tiếng Việt</option>
                </select>
              </Field>
              <Field label="When closing the launcher">
                <select value={draft.closeBehavior === 'minimize' ? 'minimize' : 'quit'} onChange={(event) => patch({ closeBehavior: event.target.value as Settings['closeBehavior'] })}>
                  <option value="quit">Quit immediately</option>
                  <option value="minimize">Minimize to tray</option>
                </select>
              </Field>
              <div className="toggle-group">
                <Toggle checked={draft.checkUpdates} label="Check for updates on startup" description="Checks GitHub releases when the launcher opens. Results stay on this page."
                  onChange={(checkUpdates) => patch({ checkUpdates })} />
                <Toggle checked={draft.autoInstallJava} label={t('autoInstallJava')} description={t('autoInstallJavaHint')}
                  onChange={(autoInstallJava) => patch({ autoInstallJava })} />
                <Toggle checked={draft.telemetry} label="Anonymous local diagnostics" description="Stores local counters only. Nothing personal is collected or sent online."
                  onChange={(telemetry) => patch({ telemetry })} />
              </div>
            </div>
          )}

          {tab === 'performance' && (
            <div className="settings-section">
              <h2>{t('java')}</h2>
              <Field label={t('javaExecutable')} hint={t('javaAutoHint')}>
                <select value={draft.javaPath} onChange={(event) => patch({ javaPath: event.target.value })}>
                  <option value="">{t('launcherDefault')}</option>
                  {javaInstallations.map((java) => <option key={java.path} value={java.path}>Java {java.major} — {java.path}</option>)}
                </select>
              </Field>
              <div className="form-row spaced">
                <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void (async () => {
                  const path = await window.fox.app.selectFile([{ name: 'Java executable', extensions: ['exe'] }]);
                  if (!path) return;
                  try {
                    const java = await window.fox.java.validate(path);
                    if (!java.valid) throw new Error('That file is not a working Java executable');
                    patch({ javaPath: path });
                    setStatusDescription(`Java ${java.major} selected. Saving automatically…`);
                  } catch (error) {
                    setStatusDescription(`Java selection failed: ${error instanceof Error ? error.message : String(error)}`);
                  }
                })()}>{t('browseJava')}</Button>
                <Button variant="ghost" icon={<Shield size={15} />} onClick={() => void window.fox.app.openExternal('https://adoptium.net/temurin/releases/')}>{t('downloadJava')}</Button>
              </div>
              <Field label="Game resolution">
                <div className="form-row inline">
                  <input type="number" min={640} max={3840} value={draft.gameResolution.width} onChange={(event) => patch({ gameResolution: { ...draft.gameResolution, width: clampNumber(Number(event.target.value), 640, 3840) } })} />
                  <span>×</span>
                  <input type="number" min={480} max={2160} value={draft.gameResolution.height} onChange={(event) => patch({ gameResolution: { ...draft.gameResolution, height: clampNumber(Number(event.target.value), 480, 2160) } })} />
                </div>
              </Field>
              <div className="toggle-group"><Toggle checked={draft.fullscreen} label="Launch in fullscreen by default" onChange={(fullscreen) => patch({ fullscreen })} /></div>

              <div className="info-banner"><Wrench size={17} /><span>Resolution, memory and JVM arguments are defaults for new instances. You can override them per instance.</span></div>
              <h2 className="section-spaced">{t('memory')}</h2>
              <Field label={`Default memory allocation — ${draft.memoryMb} MB`}>
                <input type="range" min={1024} max={16384} step={512} value={draft.memoryMb}
                  onChange={(event) => patch({ memoryMb: Number(event.target.value) })} />
              </Field>
              <Field label="Download threads" hint="Higher values speed up downloads on fast connections.">
                <input type="range" min={2} max={16} step={1} value={draft.downloadThreads}
                  onChange={(event) => patch({ downloadThreads: Number(event.target.value) })} />
              </Field>
              <Field label="Default JVM arguments">
                <textarea rows={3} value={draft.jvmArgs} onChange={(event) => patch({ jvmArgs: event.target.value })} />
              </Field>
            </div>
          )}

          {tab === 'accounts' && (
            <div className="settings-section">
              <h2>Local profiles</h2>
              <p className="muted">Create and switch offline profiles. No Microsoft account or API key is required.</p>
              <div className="form-row spaced">
                <Button variant="secondary" icon={<Users size={16} />} onClick={() => setAccountModal(true)}>Manage profiles</Button>
              </div>
              <h2 className="section-spaced">Updates</h2>
              <Field label={t('updateFeed')} hint="Uses the official Fox Launcher repository by default. Startup checks are controlled in General.">
                <input value={draft.updateFeedUrl ?? ''} onChange={(event) => patch({ updateFeedUrl: event.target.value })} placeholder="https://github.com/rynfoxen-oss/Fox-Launcher" />
              </Field>
              <div className="info-banner"><Download size={17} /><span>Required dependencies install automatically. If an older copy is already installed, it is removed before the new version is installed.</span></div>
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-section about-section">
              <div className="about-logo">F</div>
              <h2>Fox Launcher v{displayVersion(version)}</h2>
              <p className="muted">{t('aboutText')}</p>
              <div className="alpha-card">
                <div className="alpha-card-head"><span className="alpha-badge">LATEST</span><strong>1.2.2 build highlights</strong></div>
                <ul>
                  <li>{THEME_ORDER.length} full color themes recolor the entire window — sidebar, cards, buttons, inputs and dialogs.</li>
                  <li>{EFFECT_COUNT} signature scene effects, live mini-launcher previews and {BACKGROUNDS.length} animated wallpapers.</li>
                  <li>Settings describe every change inline — no pop-ups.</li>
                  <li>Instant tweaks are real on/off switches; Unlimited FPS uses <code>maxFps:260</code>.</li>
                  <li>Per-instance performance profiles survive Minecraft option-key changes.</li>
                </ul>
              </div>
              {updateAvailable?.available && (
                <div className="update-card">
                  <div><strong>{t('updateAvailableTitle')}: v{displayVersion(updateAvailable.version)}</strong><span>{updateAvailable.assetName ?? t('downloadUpdate')} · v{displayVersion(updateAvailable.current)} → v{displayVersion(updateAvailable.version)}</span></div>
                  <div className="about-actions">
                    {updateAvailable.url && <Button variant="secondary" size="sm" icon={<ExternalLink size={14} />} onClick={() => void window.fox.app.openExternal(updateAvailable.url ?? '')}>{t('releaseNotes')}</Button>}
                    {(updateAvailable.downloadUrl ?? updateAvailable.url) && <Button size="sm" icon={<Download size={14} />} onClick={() => void window.fox.app.openExternal(updateAvailable.downloadUrl ?? updateAvailable.url ?? '')}>{t('downloadUpdate')}</Button>}
                  </div>
                </div>
              )}
              <div className="about-actions">
                <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={() => void window.fox.app.openFolder(dataPath)}>{t('openDataFolder')}</Button>
                <Button variant="secondary" icon={<RefreshCw size={16} />} loading={checkingUpdate} onClick={() => void checkNow()}>{t('checkForUpdates')}</Button>
                <Button variant="danger" icon={<RotateCcw size={16} />} disabled={saving} onClick={() => {
                  if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
                  void resetSettings().then((result) => {
                    settingsRef.current = result;
                    draftRef.current = result;
                    setDraft(result);
                    setDirty(false);
                    setLastChange('');
                    setSaveError('');
                    setStatusDescription('Defaults restored and applied.');
                  }).catch((error) => setStatusDescription(`Could not restore defaults: ${String(error)}`));
                }}>{t('resetSettings')}</Button>
              </div>
              {draft.telemetry && (
                <div className="diagnostics-block">
                  <div>
                    <h3>{t('localDiagnostics')}</h3>
                    <p className="muted small">Anonymous counters kept on this device only.</p>
                  </div>
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={() => void clearLocalDiagnostics()}>Clear</Button>
                  <div className="diagnostic-grid">
                    {Object.entries(diagnostics).length === 0
                      ? <span className="muted small">No events recorded.</span>
                      : Object.entries(diagnostics).map(([key, value]) => (
                        <div key={key}><strong>{value}</strong><span>{key.replace(/_/g, ' ')}</span></div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {accountModal && <AccountModal onClose={() => setAccountModal(false)} />}
    </div>
  );
}
