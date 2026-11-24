import { useEffect, useState, type CSSProperties } from 'react';
import {
  ArrowUpRight,
  Boxes,
  Clock3,
  Download,
  FolderOpen,
  Gauge,
  ImagePlus,
  LogIn,
  Newspaper,
  Play,
  Plus,
  Rocket,
  RotateCcw,
  Server,
  Shirt,
  Settings2,
  Square,
  UserRound,
  X,
} from 'lucide-react';
import type { LaunchSnapshot } from '../../shared/types';
import { selectedCapeUrl, useApp } from '../store';
import { boostInstance } from '../boost';
import { useT } from '../i18n';
import { launch } from '../components/InstanceCard';
import { SkinPreview } from '../components/SkinPreview';
import { AccountModal } from '../components/AccountModal';
import { CreateInstanceModal } from '../components/CreateInstanceModal';
import { customBackgroundImage, customBackgroundVars } from '../theme';
import { droppedFile, isFileDrag, readFileAsDataUrl } from '../fileDrop';
import { Button, EmptyState, Spinner } from '../components/Common';
import { downloadDetail, downloadPercent, formatBytes } from '../format';

export function HomePage() {
  const instances = useApp((state) => state.instances);
  const selectedInstanceId = useApp((state) => state.selectedInstanceId);
  const currentAccount = useApp((state) => state.currentAccount);
  const capes = useApp((state) => state.capes);
  const news = useApp((state) => state.news);
  const settings = useApp((state) => state.settings);
  const updateSettings = useApp((state) => state.updateSettings);
  const launchState = useApp((state) => state.launchState);
  const navigate = useApp((state) => state.navigate);
  const logsOpen = useApp((state) => state.logsOpen);
  const setLogsOpen = useApp((state) => state.setLogsOpen);
  const downloads = useApp((state) => state.downloads);
  const toast = useApp((state) => state.toast);
  const setBusy = useApp((state) => state.setBusy);
  const refreshInstances = useApp((state) => state.refreshInstances);
  const t = useT();
  const [accountModal, setAccountModal] = useState(false);
  const [createModal, setCreateModal] = useState(false);
  const [boosting, setBoosting] = useState(false);
  const [fixingSkins, setFixingSkins] = useState(false);
  const [backgroundDragOver, setBackgroundDragOver] = useState(false);
  const [backgroundDropStatus, setBackgroundDropStatus] = useState('');
  const showLogs = logsOpen;
  const setShowLogs = setLogsOpen;
  const logs = useApp((state) => state.logs);
  const [recovery, setRecovery] = useState<LaunchSnapshot | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState('');

  useEffect(() => {
    const instanceId = launchState.status === 'crashed' ? launchState.instanceId : undefined;
    if (!instanceId) {
      setRecovery(null);
      setRecoveryStatus('');
      return;
    }
    let active = true;
    window.fox.launcher.getSnapshot(instanceId)
      .then((snapshot) => { if (active) { setRecovery(snapshot); setRecoveryStatus(''); } })
      .catch(() => { if (active) setRecovery(null); });
    return () => { active = false; };
  }, [launchState.status, launchState.instanceId]);

  async function restoreRecovery() {
    if (!recovery) return;
    setRecoveryStatus('Restoring last working setup…');
    try {
      await window.fox.launcher.restoreSnapshot(recovery.instanceId);
      await refreshInstances();
      setRecoveryStatus('Last working graphics and Java settings restored.');
    } catch (error) {
      setRecoveryStatus(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const byteItems = downloads.filter((item) => (item.bytesTotal ?? 0) > 0);
  const aggregateBytes = byteItems.reduce((sum, item) => sum + (item.bytes ?? 0), 0);
  const aggregateTotal = byteItems.reduce((sum, item) => sum + (item.bytesTotal ?? 0), 0);
  const downloadPercentValue = aggregateTotal > 0
    ? Math.min(100, Math.round((aggregateBytes / aggregateTotal) * 100))
    : downloads.length > 0
      ? Math.round(downloads.reduce((sum, item) => sum + downloadPercent(item), 0) / downloads.length)
      : 0;
  const latestDownload = downloads[downloads.length - 1];

  const instance = instances.find((item) => item.id === selectedInstanceId) ?? instances[0];
  const gameBusy = launchState.status === 'preparing' || launchState.status === 'launching' || launchState.status === 'running';
  const totalPlaytime = instances.reduce((sum, item) => sum + item.playtimeMinutes, 0);
  const hours = Math.floor(totalPlaytime / 60);
  const appearance = settings.appearance;
  const isCustomBackground = Boolean(appearance?.backgroundImage);
  const backgroundStyle = isCustomBackground && appearance
    ? {
        '--custom-bg-image': customBackgroundImage(appearance.backgroundImage),
        ...customBackgroundVars(appearance),
      } as CSSProperties
    : undefined;

  const downloadBar = downloads.length > 0 && (
    <div className="home-download-bar" role="status" aria-live="polite">
      <span className="home-download-icon"><Download size={15} /></span>
      <div className="home-download-copy">
        <strong className="ellipsis">
          {downloads.length > 1 ? `Downloading ${downloads.length} files` : downloadDetail(latestDownload)}
        </strong>
        <span>
          {aggregateTotal > 0
            ? `${formatBytes(aggregateBytes)} / ${formatBytes(aggregateTotal)}`
            : 'Preparing game files…'}
        </span>
      </div>
      <div className="home-download-progress"><div style={{ width: `${downloadPercentValue}%` }} /></div>
      <b>{downloadPercentValue}%</b>
    </div>
  );

  async function applyDroppedBackground(file: File) {
    try {
      const image = await readFileAsDataUrl(file);
      await updateSettings({
        appearance: {
          ...appearance,
          background: 'custom',
          backgroundImage: image,
          backgroundPosition: { x: 50, y: 50 },
          backgroundFit: 'cover',
          backgroundZoom: 1,
        },
      });
      setBackgroundDropStatus(`Custom background set from ${file.name}.`);
    } catch (error) {
      setBackgroundDropStatus(`Could not set the dropped image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function quickBoost() {
    if (!instance || gameBusy) return;
    setBoosting(true);
    setBusy('Optimizing performance…');
    try {
      const result = await boostInstance(instance);
      await refreshInstances();
      toast('success', result.note);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setBoosting(false);
      setBusy(null);
    }
  }

  async function quickSkinFix() {
    if (!instance || instance.loader === 'vanilla') {
      toast('info', 'Skin fix mods need a mod loader instance.', 'downloads');
      return;
    }
    setFixingSkins(true);
    try {
      const result = await window.fox.mods.installSkinFix(instance.id);
      toast('success', result.installed.length
        ? `Skin fix ready: ${result.installed.join(', ')}`
        : 'Offline skin support is already installed.');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setFixingSkins(false);
    }
  }

  return (
    <div className="page home-page">
      {downloadBar}
      <section
        className={`hero ${isCustomBackground ? 'custom-bg' : `hero-${appearance?.background ?? 'aurora'}`} ${backgroundDragOver ? 'drop-active' : ''}`}
        style={backgroundStyle}
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
            setBackgroundDropStatus('Drop an image file to use it as the custom background.');
            return;
          }
          void applyDroppedBackground(file);
        }}
      >
        {isCustomBackground
          ? <div className="hero-custom-bg" aria-hidden="true" />
          : <span className="wallpaper-motion" aria-hidden="true" />}
        <div className="hero-content">
          <div className="hero-eyebrow"><span className="pulse-dot" /> {t('readyToPlay')}</div>
          <h1>{t('welcome')}{currentAccount ? `, ${currentAccount.name}` : ''}.</h1>
          <p>{t('oneClickAway')}</p>
          {instance ? (
            <div className="hero-actions">
              <Button size="lg" icon={<Play size={18} fill="currentColor" />}
                onClick={() => void launch(instance)}
                disabled={gameBusy}>
                {t('play')} {instance.name}
              </Button>
              <Button size="lg" variant="secondary" icon={<Settings2 size={17} />}
                onClick={() => navigate('instance', instance.id)}>
                {t('manage')}
              </Button>
              {!currentAccount && (
                <Button size="lg" variant="secondary" icon={<LogIn size={17} />}
                  onClick={() => setAccountModal(true)}>
                  {t('signIn')}
                </Button>
              )}
            </div>
          ) : (
            <div className="hero-actions">
              <Button size="lg" icon={<Plus size={18} />} onClick={() => setCreateModal(true)}>{t('firstInstance')}</Button>
              {!currentAccount && (
                <Button size="lg" variant="secondary" icon={<LogIn size={17} />}
                  onClick={() => setAccountModal(true)}>
                  {t('signIn')}
                </Button>
              )}
            </div>
          )}
          {instance && (
            <div className="hero-tags">
              <span>{instance.minecraftVersion}</span>
              <span>{instance.loader}</span>
              <span>{instance.memoryMb} MB RAM</span>
            </div>
          )}
          <p className="drop-hint hero-drop-hint"><ImagePlus size={13} /> Drop an image here to set a custom background.</p>
          {backgroundDropStatus && <p className="hero-drop-status">{backgroundDropStatus}</p>}
        </div>
        <div className="hero-player">
          <SkinPreview
            skinUrl={currentAccount?.skinTexture}
            capeUrl={selectedCapeUrl(currentAccount, capes)}
            model={currentAccount?.skinModel}
            width={220}
            height={320}
            initialZoom={0.82}
            className="home-player-preview"
          />
        </div>
      </section>

      <section className="quick-actions stagger-in" aria-label="Quick actions">
        <button className="quick-action featured" onClick={() => void quickBoost()} disabled={!instance || gameBusy || boosting}>
          <span className="quick-icon"><Rocket size={18} /></span>
          <span className="quick-copy"><strong>{boosting ? 'Optimizing…' : 'One-click FPS boost'}</strong><small>Apply Ultra FPS + install optimizers</small></span>
          <ArrowUpRight size={15} />
        </button>
        <button className="quick-action" onClick={() => navigate('performance', instance?.id)}>
          <span className="quick-icon"><Gauge size={18} /></span>
          <span className="quick-copy"><strong>Fine-tune FPS</strong><small>Presets, RAM and Java GC</small></span>
          <ArrowUpRight size={15} />
        </button>
        <button className="quick-action" onClick={() => instance && void window.fox.app.openFolder(instance.gameDir)} disabled={!instance}>
          <span className="quick-icon"><FolderOpen size={18} /></span>
          <span className="quick-copy"><strong>Open game folder</strong><small>Mods, saves and options.txt</small></span>
          <ArrowUpRight size={15} />
        </button>
        <button className="quick-action" onClick={() => void quickSkinFix()} disabled={!instance || fixingSkins || instance.loader === 'vanilla'}>
          <span className="quick-icon"><Shirt size={18} /></span>
          <span className="quick-copy"><strong>{fixingSkins ? 'Installing…' : 'Fix offline skins'}</strong><small>Skins on cracked servers</small></span>
          <ArrowUpRight size={15} />
        </button>
      </section>

      <section className="stats-grid stagger-in">
        <div className="stat-card"><div className="stat-icon orange"><Clock3 size={19} /></div><div><strong>{hours}h {totalPlaytime % 60}m</strong><span>{t('totalPlaytime')}</span></div></div>
        <div className="stat-card"><div className="stat-icon blue"><Boxes size={19} /></div><div><strong>{instances.length}</strong><span>{t('instances')}</span></div></div>
        <div className="stat-card"><div className="stat-icon purple"><Server size={19} /></div><div><strong>{instance?.minecraftVersion ?? '—'}</strong><span>{t('activeVersion')}</span></div></div>
        <div className="stat-card"><div className="stat-icon green"><UserRound size={19} /></div><div><strong>{currentAccount?.name ?? t('noAccount')}</strong><span>{t('activeProfile')}</span></div></div>
      </section>

      <div className="home-columns stagger-in">
        <section className="panel">
          <div className="panel-header">
            <div><h2>{t('recentInstances')}</h2><p>{t('jumpBack')}</p></div>
            <button className="link-button" onClick={() => navigate('instances')}>{t('viewAll')} <ArrowUpRight size={14} /></button>
          </div>
          {instances.length === 0 ? (
            <EmptyState icon={<Boxes size={26} />} title={t('noInstancesYet')}
              description={t('noInstancesDescription')}
              action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setCreateModal(true)}>{t('createInstance')}</Button>} />
          ) : (
            <div className="recent-list">
              {[...instances].sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 4).map((item) => (
                <button key={item.id} className="recent-row" onClick={() => void launch(item)} disabled={gameBusy}>
                  <div className="recent-icon">{item.icon ? <img src={item.icon} alt="" /> : item.name.charAt(0)}</div>
                  <div className="recent-copy"><strong>{item.name}</strong><span>{item.minecraftVersion} · {item.loader}</span></div>
                  <span className="recent-time">{item.lastPlayed ? new Date(item.lastPlayed).toLocaleDateString() : 'New'}</span>
                  <Play size={15} className="recent-play" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="panel news-panel">
          <div className="panel-header">
            <div><h2>{t('minecraftNews')}</h2><p>{t('latestMojang')}</p></div>
            <Newspaper size={18} className="muted" />
          </div>
          {news.length === 0 ? (
            <div className="center-pad"><Spinner size={20} /><p className="muted small">Loading news…</p></div>
          ) : (
            <div className="news-list">
              {news.slice(0, 5).map((item) => (
                <button key={item.id} className="news-item" onClick={() => void window.fox.app.openExternal(item.link)}>
                  {item.image && <img src={item.image} alt="" />}
                  <div><strong>{item.title}</strong><span>{item.date}</span></div>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {recovery && (
        <div className="recovery-banner" role="status" aria-live="polite">
          <span className="recovery-icon"><RotateCcw size={16} /></span>
          <div className="recovery-copy">
            <strong>Last working setup available</strong>
            <span>
              {instances.find((item) => item.id === recovery.instanceId)?.name ?? 'This instance'} crashed.
              Restore the graphics and Java settings saved after its last clean exit
              {' '}({new Date(recovery.savedAt).toLocaleString()}).
            </span>
            {recoveryStatus && <small>{recoveryStatus}</small>}
          </div>
          <div className="recovery-actions">
            <button className="btn btn-sm" disabled={recoveryStatus === 'Restoring last working setup…'} onClick={() => void restoreRecovery()}>
              Restore
            </button>
            <button className="icon-btn" title="Dismiss" aria-label="Dismiss recovery offer" onClick={() => { setRecovery(null); setRecoveryStatus(''); }}>
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      <section className="panel console-panel">
        <div className="panel-header">
          <div>
            <h2>{t('launchConsole')}</h2>
            <p>{launchState.status === 'running' ? 'Game is running'
              : launchState.status === 'preparing' ? 'Preparing game files…'
                : launchState.status === 'launching' ? 'Launching game…'
                  : `Status: ${launchState.status}`}</p>
          </div>
          <div className="console-actions">
            {(launchState.status === 'launching' || launchState.status === 'running') && (
              <button className="btn btn-danger btn-sm" onClick={() => void window.fox.launcher.stop()}>
                <Square size={12} /> Stop
              </button>
            )}
            <button className="link-button" onClick={() => setShowLogs(!showLogs)}>
              {showLogs ? t('hideLogs') : t('showLogs')}
            </button>
          </div>
        </div>
        {showLogs && (
          <pre className="console">
            {logs.length === 0 ? 'No output yet. Launch an instance to see logs here.' : logs.slice(-80).map((line, index) =>
              <div key={index} className={`log-${line.level}`}>{new Date(line.time).toLocaleTimeString()} {line.text}</div>)}
          </pre>
        )}
      </section>

      {accountModal && <AccountModal onClose={() => setAccountModal(false)} />}
      {createModal && <CreateInstanceModal onClose={() => setCreateModal(false)} />}
    </div>
  );
}
