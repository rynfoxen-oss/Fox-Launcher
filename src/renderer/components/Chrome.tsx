import { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  Download,
  ExternalLink,
  Gauge,
  Home,
  Loader2,
  LogIn,
  Minus,
  Palette,
  RefreshCw,
  Search,
  Shirt,
  Sparkles,
  Square,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import { useApp, type Page } from '../store';
import { useT } from '../i18n';
import { displayVersion } from '../../shared/version';
import { AccountModal } from './AccountModal';

export function Titlebar() {
  const account = useApp((state) => state.currentAccount);
  const setPaletteOpen = useApp((state) => state.setPaletteOpen);
  const [accountModal, setAccountModal] = useState(false);
  const t = useT();

  return (
    <>
      <header className="titlebar">
        <div className="titlebar-brand">
          <div className="brand-mark">F</div>
          <span>Fox Launcher</span>
        </div>
        <div className="titlebar-spacer" />
        <button className="titlebar-command" onClick={() => setPaletteOpen(true)} title="Quick actions (Ctrl+K)">
          <Search size={14} />
          <span>Quick actions</span>
          <kbd>Ctrl K</kbd>
        </button>
        {account ? (
          <button className="titlebar-account" onClick={() => setAccountModal(true)} title={t('accounts')}>
            <span className="avatar-mini">{account.name.charAt(0).toUpperCase()}</span>
            <span className="ellipsis">{account.name}</span>
            <ChevronDown size={13} />
          </button>
        ) : (
          <button className="titlebar-account signin" onClick={() => setAccountModal(true)}>
            <LogIn size={14} />
            <span>{t('signIn')}</span>
          </button>
        )}
        <div className="window-controls">
          <button onClick={() => window.fox.app.minimize()} title="Minimize"><Minus size={15} /></button>
          <button onClick={() => window.fox.app.maximize()} title="Maximize"><Square size={13} /></button>
          <button className="close" onClick={() => window.fox.app.close()} title="Close"><X size={16} /></button>
        </div>
      </header>
      {accountModal && <AccountModal onClose={() => setAccountModal(false)} />}
    </>
  );
}

const NAV: Array<{ page: Page; key: string; icon: typeof Home }> = [
  { page: 'home', key: 'home', icon: Home },
  { page: 'instances', key: 'instances', icon: Boxes },
  { page: 'mods', key: 'mods', icon: Wrench },
  { page: 'skins', key: 'skins', icon: Shirt },
  { page: 'performance', key: 'performancePage', icon: Gauge },
  { page: 'settings', key: 'settings', icon: Palette },
];

export function Sidebar() {
  const page = useApp((state) => state.page);
  const navigate = useApp((state) => state.navigate);
  const t = useT();
  const [version, setVersion] = useState('');
  useEffect(() => {
    void window.fox.app.getVersion().then(setVersion).catch(() => undefined);
  }, []);
  return (
    <nav className="sidebar">
      <div className="nav-group">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = page === item.page || (item.page === 'instances' && page === 'instance');
          return (
            <button
              key={item.page}
              className={`nav-item ${active ? 'active' : ''}`}
              onClick={() => navigate(item.page)}
              title={t(item.key)}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{t(item.key)}</span>
              {active && <span className="nav-active-pill" />}
            </button>
          );
        })}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-shortcut"><kbd>Ctrl</kbd><kbd>K</kbd><span>Quick actions</span></div>
        <div className="sidebar-version">{version ? `v${displayVersion(version)}` : 'Fox Launcher'}</div>
      </div>
    </nav>
  );
}

function formatUpdateSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function UpdateBanner() {
  const update = useApp((state) => state.updateAvailable);
  const dismissed = useApp((state) => state.updateDismissed);
  const dismiss = useApp((state) => state.dismissUpdate);
  const install = useApp((state) => state.updateInstall);
  const installUpdate = useApp((state) => state.installUpdate);
  const dismissUpdateError = useApp((state) => state.dismissUpdateError);
  const [startError, setStartError] = useState<string | null>(null);
  const t = useT();
  const summary = useMemo(() => {
    if (!update?.notes) return '';
    return update.notes
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /^[-*]\s+/.test(line))
      ?.replace(/^[-*]\s+/, '')
      .replace(/\*\*/g, '')
      .slice(0, 130) ?? '';
  }, [update?.notes]);
  if (!update?.available || dismissed) return null;

  const stage = install?.stage ?? 'idle';
  const active = stage === 'downloading' || stage === 'verifying' || stage === 'extracting'
    || stage === 'installing' || stage === 'ready';
  const stageLabel = stage === 'downloading' ? t('updateDownloading')
    : stage === 'verifying' ? t('updateVerifying')
      : stage === 'extracting' ? t('updateExtracting')
        : stage === 'installing' ? t('updateInstalling')
          : stage === 'ready' ? t('updateRestarting')
            : stage === 'error' ? t('updateFailed') : '';
  const detail = startError ?? install?.error;
  const downloadUrl = update.downloadUrl ?? update.url;
  const size = formatUpdateSize(update.assetSize);

  async function handleInstall() {
    setStartError(null);
    try {
      await installUpdate();
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-icon"><Sparkles size={17} /></span>
      <div className="update-banner-copy">
        <strong><span className="update-new-badge">NEW</span>{t('updateAvailableTitle')} · v{displayVersion(update.version)}</strong>
        <span title={summary || undefined}>
          {summary || `${t('updateAvailableDescription')} v${displayVersion(update.current)}.`}
          {update.assetName && <em> · {update.assetName}{size ? ` · ${size}` : ''}</em>}
        </span>
        {(active || detail) && (
          <div className="update-banner-progress">
            {active && (
              <div className="update-banner-progress-track">
                <span style={{ width: `${Math.max(0, Math.min(100, install?.percent ?? 0))}%` }} />
              </div>
            )}
            <small title={detail ?? undefined}>
              {stageLabel}
              {active && install?.percent !== undefined ? ` · ${install.percent}%` : ''}
              {detail ? ` · ${detail}` : ''}
            </small>
          </div>
        )}
      </div>
      {update.url && (
        <button className="btn btn-ghost btn-sm" onClick={() => void window.fox.app.openExternal(update.url ?? '')}>
          <ExternalLink size={14} /> {t('releaseNotes')}
        </button>
      )}
      {downloadUrl && stage === 'error' && (
        <button className="btn btn-primary btn-sm" onClick={() => { dismissUpdateError(); void handleInstall(); }}>
          <RefreshCw size={14} /> {t('updateRetry')}
        </button>
      )}
      {downloadUrl && stage !== 'error' && (
        <button className="btn btn-primary btn-sm" disabled={active} onClick={() => void handleInstall()}>
          {active ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
          {active ? stageLabel : t('installUpdate')}
        </button>
      )}
      <button className="icon-btn" onClick={dismiss} disabled={active} title={t('later')}><X size={15} /></button>
    </div>
  );
}
