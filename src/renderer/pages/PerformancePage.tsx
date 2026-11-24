import { useEffect, useState, type CSSProperties } from 'react';
import {
  Activity,
  Boxes,
  Check,
  Cloud,
  Cpu,
  Download,
  Eye,
  Gauge,
  Layers,
  ListChecks,
  Monitor,
  Plus,
  Rocket,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Trash2,
  Wind,
  Zap,
} from 'lucide-react';
import type { InstalledMod, ModLoader, PerformancePreset, PerformanceSettings, SystemInfo } from '../../shared/types';
import {
  applyGcMode,
  clampPerformanceSettings,
  detectGcMode,
  FPS_MOD_CATALOG,
  GC_MODES,
  optimizationScore,
  PERFORMANCE_PRESETS,
  PRESET_ORDER,
  scoreLabel,
  UNLIMITED_FPS,
  type FpsModInfo,
  type GcModeId,
} from '../../shared/performance';
import { boostInstance } from '../boost';
import { useApp } from '../store';
import { Button, EmptyState, Field, Segmented, Spinner } from '../components/Common';

const PRESET_COPY: Record<Exclude<PerformancePreset, 'custom'>, { title: string; description: string; icon: typeof Gauge }> = {
  ultra: { title: 'Ultra FPS', description: 'Lowest visuals, maximum frames.', icon: Rocket },
  fps: { title: 'Max FPS', description: 'Lower visuals, higher frame rate.', icon: Zap },
  balanced: { title: 'Balanced', description: 'Clean visuals with steady FPS.', icon: Sparkles },
  low: { title: 'Low-end PC', description: 'Best for older or integrated graphics.', icon: ShieldCheck },
  potato: { title: 'Potato Mode', description: 'Absolute minimum for weak GPUs.', icon: Cpu },
  quality: { title: 'Quality', description: 'Higher detail with smart tuning.', icon: Gauge },
};

function fpsValue(value: number): string {
  return value >= UNLIMITED_FPS || value === 0 ? 'Unlimited' : String(value);
}

function fpsLabel(value: number): string {
  return fpsValue(value) === 'Unlimited' ? 'Unlimited' : `${value} FPS`;
}

interface QuickTweak {
  id: string;
  label: string;
  detail: string;
  icon: typeof Gauge;
  /** Applied when the tweak is turned on. */
  patch: Partial<PerformanceSettings>;
  /** Restored when the tweak is turned off. */
  off: Partial<PerformanceSettings>;
  active: (settings: PerformanceSettings) => boolean;
}

const QUICK_TWEAKS: QuickTweak[] = [
  {
    id: 'clouds', label: 'Clouds off', detail: 'Small but free FPS gain', icon: Cloud,
    patch: { clouds: false }, off: { clouds: true }, active: (s) => !s.clouds,
  },
  {
    id: 'vsync', label: 'V-Sync off', detail: 'Uncap your frame rate', icon: Monitor,
    patch: { vsync: false }, off: { vsync: true }, active: (s) => !s.vsync,
  },
  {
    id: 'shadows', label: 'Shadows off', detail: 'Mob/entity shadows disabled', icon: Eye,
    patch: { entityShadows: false }, off: { entityShadows: true }, active: (s) => !s.entityShadows,
  },
  {
    id: 'render', label: 'Render 8', detail: 'Shorter view distance', icon: Activity,
    patch: { renderDistance: 8 }, off: { renderDistance: PERFORMANCE_PRESETS.balanced.renderDistance }, active: (s) => s.renderDistance <= 8,
  },
  {
    id: 'fast', label: 'Fast graphics', detail: 'Simple lighting and blocks', icon: Zap,
    patch: { graphics: 0, smoothLighting: false },
    off: { graphics: PERFORMANCE_PRESETS.balanced.graphics, smoothLighting: PERFORMANCE_PRESETS.balanced.smoothLighting },
    active: (s) => s.graphics === 0 && !s.smoothLighting,
  },
  {
    id: 'unlimited', label: 'Unlimited FPS', detail: "Minecraft's maxFps:260 setting", icon: Timer,
    patch: { maxFps: UNLIMITED_FPS }, off: { maxFps: PERFORMANCE_PRESETS.balanced.maxFps }, active: (s) => s.maxFps >= UNLIMITED_FPS,
  },
  {
    id: 'cap', label: '144 FPS cap', detail: 'Stable high refresh rate', icon: Timer,
    patch: { maxFps: 144 }, off: { maxFps: PERFORMANCE_PRESETS.balanced.maxFps }, active: (s) => s.maxFps === 144,
  },
];

function SliderField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  ticks,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  ticks?: string[];
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label} hint={formatValue ? formatValue(value) : `${value}${suffix ?? ''}`}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {ticks && <div className="slider-ticks">{ticks.map((tick) => <span key={tick}>{tick}</span>)}</div>}
    </Field>
  );
}

function loaderLabel(loader: ModLoader): string {
  return loader.charAt(0).toUpperCase() + loader.slice(1);
}

/** Conservative heap target: enough for modded Minecraft without starving the OS. */
function recommendedMemoryMb(totalMb: number): number {
  if (!Number.isFinite(totalMb) || totalMb <= 0) return 4096;
  const gb = totalMb / 1024;
  const target = gb <= 4 ? 1536 : gb <= 8 ? 3072 : gb <= 16 ? 5120 : gb <= 32 ? 8192 : 10240;
  const safeCap = Math.floor((totalMb * 0.6) / 512) * 512;
  return Math.max(512, Math.min(16384, Math.min(target, safeCap)));
}

export function PerformancePage() {
  const instances = useApp((state) => state.instances);
  const selectedInstanceId = useApp((state) => state.selectedInstanceId);
  const navigate = useApp((state) => state.navigate);
  const refreshInstances = useApp((state) => state.refreshInstances);
  const toast = useApp((state) => state.toast);
  const launchState = useApp((state) => state.launchState);
  const instance = instances.find((item) => item.id === selectedInstanceId) ?? instances[0];

  const [draft, setDraft] = useState<PerformanceSettings | null>(null);
  const [applied, setApplied] = useState<PerformanceSettings | null>(null);
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [installingMods, setInstallingMods] = useState(false);
  const [modBusy, setModBusy] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const gameRunning = launchState.status === 'preparing' || launchState.status === 'launching' || launchState.status === 'running';

  useEffect(() => {
    let active = true;
    window.fox.app.systemInfo()
      .then((info) => { if (active) setSystemInfo(info); })
      .catch(() => { if (active) setSystemInfo(null); });
    return () => { active = false; };
  }, []);

  async function refreshInstalledMods() {
    if (!instance) return;
    try {
      setInstalledMods(await window.fox.mods.list(instance.id));
    } catch {
      setInstalledMods([]);
    }
  }

  useEffect(() => {
    if (!instance) {
      setDraft(null);
      setApplied(null);
      setInstalledMods([]);
      return;
    }
    let active = true;
    setLoading(true);
    void window.fox.performance.get(instance.id)
      .then((settings) => {
        if (active) {
          setDraft(settings);
          setApplied(settings);
        }
      })
      .catch((error) => {
        if (active) toast('error', error instanceof Error ? error.message : String(error), 'errors');
      })
      .finally(() => { if (active) setLoading(false); });
    void window.fox.mods.list(instance.id)
      .then((mods) => { if (active) setInstalledMods(mods); })
      .catch(() => { if (active) setInstalledMods([]); });
    return () => { active = false; };
  }, [instance?.id, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  function update(patch: Partial<PerformanceSettings>) {
    setDraft((current) => {
      if (!current) return current;
      const merged = clampPerformanceSettings({ ...current, ...patch });
      return { ...merged, preset: patch.preset ?? 'custom' };
    });
  }

  function usePreset(preset: Exclude<PerformancePreset, 'custom'>) {
    setDraft({ ...PERFORMANCE_PRESETS[preset] });
  }

  async function persist(next: PerformanceSettings, message: string) {
    if (!instance || gameRunning) {
      if (gameRunning) toast('info', 'Stop the game before changing performance settings.', 'launch');
      return;
    }
    setSaving(true);
    try {
      await window.fox.performance.apply(instance.id, next);
      await refreshInstances();
      setDraft(next);
      setApplied(next);
      toast('success', message);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setSaving(false);
    }
  }

  function applyProfile() {
    if (!draft) return;
    void persist(clampPerformanceSettings(draft), `Performance profile applied to ${instance?.name ?? 'instance'}`);
  }

  async function oneClickBoost() {
    if (!instance || gameRunning) {
      if (gameRunning) toast('info', 'Stop the game before boosting performance.', 'launch');
      return;
    }
    setBoosting(true);
    try {
      const result = await boostInstance(instance);
      const boosted = { ...result.applied, preset: 'ultra' as const };
      await refreshInstances();
      await refreshInstalledMods();
      setDraft(boosted);
      setApplied(boosted);
      toast('success', result.note);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setBoosting(false);
    }
  }

  function applyTweak(tweak: QuickTweak) {
    if (!draft) return;
    const isActive = tweak.active(draft);
    const patch = isActive ? tweak.off : tweak.patch;
    void persist(
      clampPerformanceSettings({ ...draft, ...patch }),
      `${tweak.label} ${isActive ? 'turned off' : 'turned on'} for ${instance?.name ?? 'instance'}`,
    );
  }

  function changeGc(mode: GcModeId) {
    if (!draft) return;
    const meta = GC_MODES.find((item) => item.id === mode);
    void persist(
      { ...draft, jvmArgs: applyGcMode(draft.jvmArgs, mode) },
      `Java garbage collector set to ${meta?.label ?? mode}`,
    );
  }

  async function installAllFpsMods() {
    if (!instance || instance.loader === 'vanilla' || gameRunning) return;
    setInstallingMods(true);
    try {
      const result = await window.fox.performance.installFpsMods(instance.id);
      await refreshInstalledMods();
      const skipped = result.skipped.length
        ? ` Skipped: ${result.skipped.map((item) => item.title).join(', ')}.`
        : '';
      toast('success', `Installed ${result.installed.join(', ')}.${skipped}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setInstallingMods(false);
    }
  }

  function installedFor(mod: FpsModInfo): InstalledMod | undefined {
    return installedMods.find((item) =>
      item.projectId === mod.id || item.fileName.toLowerCase().includes(mod.title.toLowerCase()));
  }

  async function toggleFpsMod(mod: FpsModInfo) {
    if (!instance || gameRunning) return;
    const installed = installedFor(mod);
    setModBusy(mod.id);
    try {
      if (installed) {
        await window.fox.mods.remove(instance.id, installed.fileName, 'mod');
        toast('info', `${mod.title} removed from ${instance.name}`, 'downloads');
      } else {
        const result = await window.fox.mods.install(instance.id, mod.id, 'modrinth', mod.title, 'mod');
        toast('success', `${mod.title} installed${result.length ? ` (${result[0].fileName})` : ''}`, 'downloads');
      }
      await refreshInstalledMods();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setModBusy(null);
    }
  }

  if (!instance) {
    return (
      <div className="page">
        <EmptyState
          icon={<Gauge size={28} />}
          title="No instance selected"
          description="Create an instance first, then boost its FPS here."
          action={<Button onClick={() => navigate('instances')}>Go to instances</Button>}
        />
      </div>
    );
  }

  const score = draft ? optimizationScore(draft) : 0;
  const gcMode = draft ? detectGcMode(draft.jvmArgs) : 'g1';
  const gcHint = GC_MODES.find((item) => item.id === gcMode)?.hint ?? '';
  const compatibleMods = instance.loader === 'vanilla'
    ? []
    : FPS_MOD_CATALOG.filter((mod) => mod.loaders.includes(instance.loader as never));
  const installedCount = compatibleMods.filter((mod) => installedFor(mod)).length;
  const ultra = PERFORMANCE_PRESETS.ultra;
  const normalizedDraft = draft ? clampPerformanceSettings(draft) : null;
  const dirty = Boolean(normalizedDraft && applied && JSON.stringify(normalizedDraft) !== JSON.stringify(applied));
  const activeTweaks = draft ? QUICK_TWEAKS.filter((tweak) => tweak.active(draft)).length : 0;
  const currentGc = draft ? GC_MODES.find((mode) => mode.id === detectGcMode(draft.jvmArgs)) : undefined;

  return (
    <div className="page performance-page">
      <div className="page-header performance-header">
        <div>
          <div className="perf-eyebrow"><span className="pulse-dot" /> PERFORMANCE LAB</div>
          <h1>Performance</h1>
          <p>Fast, working FPS tools for <strong>{instance.name}</strong> · {instance.minecraftVersion} · {instance.loader}.</p>
        </div>
        <div className="header-actions">
          {dirty && <span className="unsaved-badge">Unsaved changes</span>}
          <select
            value={instance.id}
            onChange={(event) => navigate('performance', event.target.value)}
            aria-label="Select instance"
          >
            {instances.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            icon={<RotateCcw size={15} />}
            disabled={!dirty || gameRunning}
            onClick={() => {
              if (!applied) return;
              setDraft(applied);
              toast('info', 'Performance changes discarded');
            }}
          >
            Discard
          </Button>
          <Button
            variant="ghost"
            icon={<ShieldCheck size={15} />}
            disabled={!draft || gameRunning}
            title="Restore the balanced default profile"
            onClick={() => void persist({ ...PERFORMANCE_PRESETS.balanced }, `Balanced defaults restored for ${instance?.name ?? 'instance'}`)}
          >
            Reset
          </Button>
          <Button
            variant="secondary"
            icon={<Download size={15} />}
            loading={installingMods}
            disabled={compatibleMods.length === 0 || gameRunning}
            title={instance.loader === 'vanilla' ? 'FPS mods require a mod loader' : 'Install compatible FPS mods from Modrinth'}
            onClick={() => void installAllFpsMods()}
          >
            Install FPS mods
          </Button>
          <Button
            icon={<Rocket size={15} />}
            loading={boosting}
            disabled={!draft || loading || gameRunning}
            onClick={() => void oneClickBoost()}
            title="Apply Ultra FPS settings and install compatible optimizers"
          >
            One-click boost
          </Button>
          <Button
            variant="secondary"
            icon={<Save size={15} />}
            loading={saving}
            disabled={!draft || loading || !dirty || gameRunning}
            onClick={applyProfile}
          >
            Apply profile
          </Button>
        </div>
      </div>

      {loading || !draft ? (
        <div className="center-pad"><Spinner size={22} /><p className="muted small">Loading performance settings…</p></div>
      ) : (
        <div className="stagger-in">
          <section className="fps-overview">
            <div className="score-ring" style={{ '--score': `${score}%` } as CSSProperties}>
              <div><strong>{score}</strong><span>/100</span></div>
            </div>
            <div className="fps-overview-copy">
              <span className="eyebrow">OPTIMIZATION SCORE</span>
              <h2>{scoreLabel(score)} · {instance.name}</h2>
              <p>Estimated from the settings below. One-click boost applies the lowest-latency profile and installs compatible optimizers.</p>
              <div className="fps-overview-stats">
                <span><Activity size={12} /><strong>{draft.renderDistance}</strong> chunks</span>
                <span><Timer size={12} /><strong>{fpsValue(draft.maxFps)}</strong> FPS cap</span>
                <span><Cpu size={12} /><strong>{draft.memoryMb / 1024} GB</strong> RAM</span>
                <span><Monitor size={12} /><strong>{draft.vsync ? 'On' : 'Off'}</strong> V-Sync</span>
                <span><ShieldCheck size={12} /><strong>{activeTweaks}</strong> tweaks</span>
              </div>
            </div>
            <div className="fps-overview-glow" aria-hidden="true" />
          </section>

          <section className="panel config-panel">
            <div className="panel-header">
              <div>
                <h2>Current configuration</h2>
                <p>Exactly what this instance will use after you apply.</p>
              </div>
              <span className={`source-chip ${dirty ? 'dirty' : ''}`}>
                {dirty ? 'Draft · unsaved' : `Applied · ${draft.preset}`}
              </span>
            </div>
            <div className="config-grid">
              <div className="config-tile"><span className="config-tile-icon"><Activity size={15} /></span><div><small>Render</small><strong>{draft.renderDistance} chunks</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><Layers size={15} /></span><div><small>Simulation</small><strong>{draft.simulationDistance} chunks</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><Zap size={15} /></span><div><small>Graphics</small><strong>{draft.graphics === 0 ? 'Fast' : 'Fancy'}</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><Cloud size={15} /></span><div><small>Clouds</small><strong>{draft.clouds ? 'On' : 'Off'}</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><Eye size={15} /></span><div><small>Shadows</small><strong>{draft.entityShadows ? 'On' : 'Off'}</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><Timer size={15} /></span><div><small>FPS cap</small><strong>{fpsLabel(draft.maxFps)}</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><SlidersHorizontal size={15} /></span><div><small>RAM</small><strong>{draft.memoryMb / 1024} GB</strong></div></div>
              <div className="config-tile"><span className="config-tile-icon"><Cpu size={15} /></span><div><small>Java GC</small><strong>{currentGc?.label ?? 'G1GC'}</strong></div></div>
            </div>
          </section>

          <section className="preset-grid" aria-label="Performance presets">
            {PRESET_ORDER.map((preset, index) => {
              const meta = PRESET_COPY[preset];
              const Icon = meta.icon;
              const active = draft.preset === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  className={`preset-card ${active ? 'active' : ''}`}
                  aria-pressed={active}
                  onClick={() => usePreset(preset)}
                >
                  {active
                    ? <Check size={14} className="preset-check" />
                    : <span className="preset-rank">{String(index + 1).padStart(2, '0')}</span>}
                  <span className="preset-icon"><Icon size={18} /></span>
                  <strong>{meta.title}</strong>
                  <span>{meta.description}</span>
                </button>
              );
            })}
          </section>

          <section className="panel tweaks-panel">
            <div className="panel-header">
              <div><h2>Instant tweaks</h2><p>Click to turn a tweak on or off. Each change is written straight to this instance's options.txt.</p></div>
              <span className="source-chip">{QUICK_TWEAKS.filter((tweak) => tweak.active(draft)).length} active</span>
            </div>
            <div className="tweak-grid">
              {QUICK_TWEAKS.map((tweak) => {
                const Icon = tweak.icon;
                const active = tweak.active(draft);
                return (
                  <button
                    key={tweak.id}
                    className={`tweak-card ${active ? 'active' : ''}`}
                    aria-pressed={active}
                    disabled={gameRunning || saving}
                    onClick={() => applyTweak(tweak)}
                    title={active ? `Click to turn off: ${tweak.detail}` : `Click to turn on: ${tweak.detail}`}
                  >
                    <span className="tweak-icon"><Icon size={15} /></span>
                    <span><strong>{tweak.label}</strong><small>{tweak.detail}</small></span>
                    <b className={`tweak-state ${active ? 'on' : ''}`}>{active ? 'ON' : 'OFF'}</b>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="performance-layout">
            <section className="panel">
              <div className="panel-header">
                <div><h2>Boost blueprint</h2><p>Exactly what the one-click button applies.</p></div>
                <span className="source-chip">Ultra FPS</span>
              </div>
              <div className="blueprint-grid">
                <div className="blueprint-card">
                  <span className="blueprint-step">STEP 01</span>
                  <span className="blueprint-icon"><Activity size={16} /></span>
                  <strong>Game settings</strong>
                  <p>{ultra.renderDistance} chunk render · {ultra.simulationDistance} chunk simulation · fast graphics · clouds off · shadows off · {ultra.maxFps >= UNLIMITED_FPS ? 'unlimited frame rate' : `${ultra.maxFps} FPS cap`}.</p>
                </div>
                <div className="blueprint-card">
                  <span className="blueprint-step">STEP 02</span>
                  <span className="blueprint-icon"><Cpu size={16} /></span>
                  <strong>Java engine</strong>
                  <p>G1GC with parallel reference processing and a 200 ms pause target. Your current RAM allocation is kept.</p>
                </div>
                <div className="blueprint-card">
                  <span className="blueprint-step">STEP 03</span>
                  <span className="blueprint-icon"><Boxes size={16} /></span>
                  <strong>GPU add-ons</strong>
                  <p>{compatibleMods.length
                    ? `${compatibleMods.map((mod) => mod.title).join(' + ')} for ${loaderLabel(instance.loader)}. ${installedCount}/${compatibleMods.length} already installed.`
                    : 'Add a mod loader to install renderer and logic optimizers.'}</p>
                </div>
              </div>
              <div className="blueprint-action">
                <span>Runs settings + mod installation together. Safe to press again.</span>
                <Button icon={<Rocket size={15} />} loading={boosting} disabled={!draft || gameRunning} onClick={() => void oneClickBoost()}>
                  Run one-click boost
                </Button>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div><h2>Engine tuning</h2><p>Stored in this instance's launch profile.</p></div>
              </div>
              <div className="performance-controls">
                <SliderField
                  label="Max frame rate"
                  value={draft.maxFps}
                  min={10}
                  max={UNLIMITED_FPS}
                  step={10}
                  ticks={['10', '60', '120', 'Unlimited']}
                  formatValue={fpsLabel}
                  onChange={(value) => update({ maxFps: value })}
                />
                <SliderField
                  label="Allocated RAM"
                  value={draft.memoryMb}
                  min={512}
                  max={16384}
                  step={512}
                  suffix=" MB"
                  ticks={['512 MB', '4 GB', '8 GB', '16 GB']}
                  onChange={(value) => update({ memoryMb: value })}
                />
                {systemInfo && (
                  <div className="ram-recommendation">
                    <span>
                      Recommended for {Math.round(systemInfo.totalMemoryMb / 1024)} GB of RAM:
                      {' '}{recommendedMemoryMb(systemInfo.totalMemoryMb)} MB
                    </span>
                    <button
                      className="link-button"
                      disabled={gameRunning || !draft || draft.memoryMb === recommendedMemoryMb(systemInfo.totalMemoryMb)}
                      onClick={() => update({ memoryMb: recommendedMemoryMb(systemInfo.totalMemoryMb) })}
                    >
                      Use recommended
                    </button>
                  </div>
                )}
                <Field label="Java garbage collector" hint={gcHint}>
                  <Segmented
                    value={gcMode}
                    options={GC_MODES.map((mode) => ({ value: mode.id, label: mode.label }))}
                    onChange={(value) => changeGc(value as GcModeId)}
                  />
                </Field>
                <Field label="JVM arguments" hint="Used the next time this instance launches.">
                  <textarea rows={5} value={draft.jvmArgs} onChange={(event) => update({ jvmArgs: event.target.value })} />
                </Field>
                <div className="performance-note">
                  <ShieldCheck size={16} />
                  <span>4–6 GB is ideal for most modded setups. Too much RAM can cause stutter. Shenandoah and ZGC need Java 17 or newer.</span>
                </div>
                <Button icon={<Save size={15} />} loading={saving} disabled={gameRunning} onClick={applyProfile}>Save engine settings</Button>
              </div>
            </section>
          </div>

          <section className="panel addons-panel">
            <div className="panel-header">
              <div><h2>FPS add-ons</h2><p>Verified Modrinth optimizers for {loaderLabel(instance.loader)}.</p></div>
              <span className="source-chip">{installedCount}/{compatibleMods.length} installed</span>
            </div>
            {compatibleMods.length === 0 ? (
              <div className="addons-empty">
                <ListChecks size={22} />
                <div><strong>No mod loader detected</strong><span>Create a Fabric, Forge, Quilt, or NeoForge instance to use Sodium, Lithium, Embeddium, or Rubidium.</span></div>
              </div>
            ) : (
              <div className="addon-grid">
                {compatibleMods.map((mod) => {
                  const installed = installedFor(mod);
                  return (
                    <div key={mod.id} className={`addon-card ${installed ? 'installed' : ''}`}>
                      <div className="addon-top">
                        <span className="addon-icon"><Zap size={16} /></span>
                        <div className="addon-badges">
                          <span className="addon-kind">{mod.kind === 'renderer' ? 'Renderer' : 'Logic'}</span>
                          <span className={`addon-status ${installed ? 'on' : ''}`}>{installed ? 'Installed' : 'Ready'}</span>
                        </div>
                      </div>
                      <strong>{mod.title}</strong>
                      <p>{mod.description}</p>
                      <Button
                        size="sm"
                        variant={installed ? 'ghost' : 'secondary'}
                        icon={installed ? <Trash2 size={13} /> : <Plus size={13} />}
                        loading={modBusy === mod.id}
                        disabled={gameRunning || (installed === undefined && mod.kind === 'renderer' && compatibleMods.some((other) => other.kind === 'renderer' && installedFor(other)))}
                        title={installed
                          ? `Remove ${mod.title}`
                          : mod.kind === 'renderer' && compatibleMods.some((other) => other.kind === 'renderer' && installedFor(other))
                            ? 'Remove the current renderer optimizer first'
                            : `Install ${mod.title}`}
                        onClick={() => void toggleFpsMod(mod)}
                      >
                        {installed ? 'Remove' : 'Install'}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="performance-footer">
            <span>
              Profiles write to <code>options.txt</code>; RAM and JVM settings apply on next launch.
              {instance.loader !== 'vanilla' && ' FPS add-ons are downloaded from Modrinth with dependencies handled automatically.'}
            </span>
            <Button icon={<Wind size={15} />} loading={saving} disabled={gameRunning} onClick={applyProfile}>Apply profile</Button>
          </div>
        </div>
      )}
    </div>
  );
}
