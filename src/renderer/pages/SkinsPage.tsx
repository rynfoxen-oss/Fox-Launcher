import { useEffect, useState } from 'react';
import { Check, Eye, Plus, RefreshCw, Search, Shirt, Trash2, Upload, Users, X } from 'lucide-react';
import type { SkinEntry, SkinModel } from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { droppedFile, isFileDrag, readFileAsDataUrl } from '../fileDrop';
import { SkinPreview } from '../components/SkinPreview';
import { AccountModal } from '../components/AccountModal';
import { Button, EmptyState, Segmented } from '../components/Common';

export function SkinsPage() {
  const { currentAccount, skins, offlineSkins, refreshSkins, refreshOfflineSkins, refreshAccounts } = useApp();
  const t = useT();
  const [accountModal, setAccountModal] = useState(false);
  const [model, setModel] = useState<SkinModel>(currentAccount?.skinModel ?? 'steve');
  const [preview, setPreview] = useState<SkinEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [skinSearch, setSkinSearch] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<{ kind: 'skin' | 'offline'; name: string; hash?: string } | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [offlineBusy, setOfflineBusy] = useState(false);

  useEffect(() => {
    setModel(preview ? preview.model : currentAccount?.skinModel ?? 'steve');
  }, [currentAccount?.id, currentAccount?.skinModel, preview?.hash, preview?.model]);

  function reportError(error: unknown, prefix: string) {
    setStatus(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }

  async function finishImport(skin: SkinEntry | null) {
    if (!skin) {
      setStatus('Skin import canceled.');
      return;
    }
    await refreshSkins();
    setPreview(null);
    if (!currentAccount) {
      setStatus(`${skin.name} added (${skin.model} model). Choose a profile to apply it.`);
      setAccountModal(true);
      return;
    }
    // Always use the detected model from the imported texture. Passing the old
    // profile model here is what turned slim/Alex skins into classic/Steve.
    try {
      const result = await window.fox.skins.select(skin.hash, currentAccount.id, skin.model);
      await Promise.all([refreshAccounts(), refreshOfflineSkins()]);
      setModel(result.account.skinModel ?? skin.model);
      setStatus(`${skin.name} added and applied (${skin.model} model). ${result.message}`);
    } catch (error) {
      reportError(error, `${skin.name} added, but could not be applied`);
    }
  }

  async function importSkin() {
    setBusy(true);
    try {
      await finishImport(await window.fox.skins.import());
    } catch (error) {
      reportError(error, 'Skin import failed');
    } finally {
      setBusy(false);
    }
  }

  async function importDroppedSkin(file: File) {
    setBusy(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await finishImport(await window.fox.skins.importData(file.name, dataUrl));
    } catch (error) {
      reportError(error, 'Dropped skin import failed');
    } finally {
      setBusy(false);
    }
  }

  async function applySkin(hash: string, selectedModel?: SkinModel) {
    if (!currentAccount) {
      setAccountModal(true);
      return;
    }
    setBusy(true);
    try {
      const skin = skins.find((item) => item.hash === hash);
      const targetModel = selectedModel ?? skin?.model ?? model;
      const result = await window.fox.skins.select(hash, currentAccount.id, targetModel);
      await Promise.all([refreshAccounts(), refreshSkins()]);
      setPreview(null);
      setModel(result.account.skinModel ?? targetModel);
      setStatus(result.message);
    } catch (error) {
      reportError(error, 'Could not apply skin');
    } finally {
      setBusy(false);
    }
  }

  async function uploadForAccount() {
    if (!currentAccount) {
      setAccountModal(true);
      return;
    }
    setBusy(true);
    try {
      // Use the previewed library skin when there is one; otherwise pick a file.
      const result = preview
        ? await window.fox.skins.select(preview.hash, currentAccount.id, model)
        : await window.fox.accounts.uploadSkin(currentAccount.id);
      await Promise.all([refreshAccounts(), refreshSkins()]);
      setModel(result.account.skinModel ?? model);
      setStatus(result.message);
      if (preview) setPreview(null);
    } catch (error) {
      reportError(error, 'Could not upload skin');
    } finally {
      setBusy(false);
    }
  }

  function requestSkinRemoval(skin: SkinEntry) {
    setConfirmRemove({ kind: 'skin', name: skin.name, hash: skin.hash });
    setStatus(`Remove “${skin.name}” from the library? Confirm below.`);
  }

  async function confirmSkinRemoval(hash: string) {
    setBusy(true);
    try {
      await window.fox.skins.remove(hash);
      if (preview?.hash === hash) setPreview(null);
      await Promise.all([refreshSkins(), refreshAccounts(), refreshOfflineSkins()]);
      setConfirmRemove(null);
      setStatus('Skin removed, including any offline mappings that used it.');
    } catch (error) {
      reportError(error, 'Could not remove skin');
    } finally {
      setBusy(false);
    }
  }

  async function addOfflinePlayer() {
    const name = playerName.trim();
    if (!name) {
      setStatus('Enter a player name first.');
      return;
    }
    setOfflineBusy(true);
    try {
      const entry = await window.fox.skins.addOfflinePlayer(name, manualHash || undefined);
      await Promise.all([refreshOfflineSkins(), refreshSkins()]);
      setPlayerName('');
      setManualHash('');
      setStatus(`${entry.name} skin is ready on offline servers.`);
    } catch (error) {
      reportError(error, 'Could not add offline skin');
    } finally {
      setOfflineBusy(false);
    }
  }

  async function refreshOfflinePlayer(name: string, hash?: string) {
    setOfflineBusy(true);
    try {
      const entry = await window.fox.skins.addOfflinePlayer(name, hash || undefined);
      await Promise.all([refreshOfflineSkins(), refreshSkins()]);
      setStatus(`${entry.name} skin refreshed.`);
    } catch (error) {
      reportError(error, 'Could not refresh offline skin');
    } finally {
      setOfflineBusy(false);
    }
  }

  function requestOfflineRemoval(name: string) {
    setConfirmRemove({ kind: 'offline', name });
    setStatus(`Remove ${name} from offline server skins? Confirm below.`);
  }

  async function confirmOfflineRemoval(name: string) {
    setOfflineBusy(true);
    try {
      await window.fox.skins.removeOfflinePlayer(name);
      await refreshOfflineSkins();
      setConfirmRemove(null);
      setStatus(`${name} removed from offline server skins.`);
    } catch (error) {
      reportError(error, 'Could not remove offline skin');
    } finally {
      setOfflineBusy(false);
    }
  }

  const previewModel = model;
  const previewName = preview?.name ?? currentAccount?.name ?? 'No active profile';
  const skinQuery = skinSearch.trim().toLowerCase();
  const filteredSkins = skins
    .filter((skin) => !skinQuery || skin.name.toLowerCase().includes(skinQuery))
    .sort((a, b) => b.createdAt - a.createdAt);

  function showProfile() {
    setPreview(null);
    setModel(currentAccount?.skinModel ?? 'steve');
    setStatus('');
  }

  return (
    <div
      className={`page skins-page ${dragOver ? 'drop-active' : ''}`}
      onDragEnter={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (isFileDrag(event)) event.preventDefault();
      }}
      onDragLeave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const file = droppedFile(event, 'png');
        if (!file) {
          setStatus('Drop a PNG skin file to import it.');
          return;
        }
        void importDroppedSkin(file);
      }}
    >
      {dragOver && (
        <div className="page-drop-overlay">
          <Upload size={30} />
          <strong>Drop PNG skin to import & apply</strong>
          <span>The newest import becomes your active skin automatically.</span>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1>{t('skinProfile')}</h1>
          <p>{t('skinProfileDescription')}</p>
          <p className="drop-hint"><Upload size={13} /> Drop a PNG skin anywhere here to import and apply it instantly.</p>
          {status && <p className="status-description">{status}</p>}
        </div>
        <div className="header-actions">
          <Button variant="secondary" icon={<Plus size={16} />} loading={busy} onClick={() => void importSkin()}>{t('importSkin')}</Button>
          <Button icon={<Upload size={16} />} loading={busy} onClick={() => void uploadForAccount()}>
            {preview ? 'Use preview on profile' : t('uploadProfile')}
          </Button>
        </div>
      </div>

      <div className="skins-layout">
        <section className="panel skin-stage-panel">
          <div className="stage-head">
            <div>
              <h2 className="ellipsis">{preview ? `${t('previewing')} ${previewName}` : previewName}</h2>
              <p>
                {t('offlineProfile')}
                {' · '}{preview ? t('librarySource') : t('profileSource')}
              </p>
            </div>
            {preview ? (
              <button className="link-button" onClick={showProfile}>{t('backToProfile')}</button>
            ) : (
              <button className="link-button" onClick={() => setAccountModal(true)}>{t('switchProfile')}</button>
            )}
          </div>

          <div className={`skin-stage ${preview ? 'previewing-library' : ''}`}>
            <SkinPreview
              skinUrl={preview?.dataUrl ?? currentAccount?.skinTexture}
              capeUrl={preview ? undefined : currentAccount?.capeTexture}
              model={previewModel}
              width={320}
              height={430}
              showControls
            />
          </div>

          <div className="stage-controls">
            <Segmented value={model} onChange={setModel} options={[
              { value: 'steve', label: t('classic') },
              { value: 'alex', label: t('slim') },
            ]} />
            <span className="muted small">{t('skinStageHint')}</span>
          </div>

          <div className="skin-details">
            <div><span>{t('skinDetails')}</span><strong>{previewName}</strong></div>
            <div><span>{t('version')}</span><strong>{previewModel === 'alex' ? t('slim') : t('classic')}</strong></div>
            <div><span>{t('source')}</span><strong>{preview ? t('librarySource') : t('profileSource')}</strong></div>
            <div><span>Cape</span><strong className={currentAccount?.capeTexture && !preview ? 'positive' : 'muted'}>{currentAccount?.capeTexture && !preview ? t('capeVisible') : t('capeHidden')}</strong></div>
          </div>
        </section>

        <section className="panel skin-library">
          <div className="panel-header">
            <div><h2>{t('skinLibrary')}</h2><p>{filteredSkins.length} of {skins.length} {t('skinsCount')}</p></div>
            {skins.length > 0 && (
              <div className="search-box skin-search">
                <Search size={14} />
                <input value={skinSearch} onChange={(event) => setSkinSearch(event.target.value)} placeholder="Search skins…" aria-label="Search skins" />
                {skinSearch && <button className="icon-btn" onClick={() => setSkinSearch('')} aria-label="Clear search"><X size={13} /></button>}
              </div>
            )}
          </div>
          {skins.length === 0 ? (
            <EmptyState icon={<Shirt size={28} />} title={t('noSavedSkins')}
              description={t('noSavedSkinsDescription')}
              action={<Button size="sm" icon={<Plus size={14} />} onClick={() => void importSkin()}>{t('importSkin')}</Button>} />
          ) : filteredSkins.length === 0 ? (
            <p className="muted small">No skins match “{skinSearch}”.</p>
          ) : (
            <div className="skin-grid">
              {filteredSkins.map((skin) => {
                const isConfirming = confirmRemove?.kind === 'skin' && confirmRemove.hash === skin.hash;
                const isApplied = currentAccount?.skinHash === skin.hash;
                return (
                  <div key={skin.hash} className={`skin-card ${isApplied ? 'applied' : ''} ${preview?.hash === skin.hash ? 'previewing' : ''}`}>
                    <button className="skin-thumb" onClick={() => { setPreview(skin); setModel(skin.model); }} title={t('previewSkin')}>
                      <img src={skin.dataUrl} alt={skin.name} />
                      <span className="skin-model-badge">{skin.model === 'alex' ? 'SLIM' : 'CLASSIC'}</span>
                      <span className="skin-thumb-overlay"><Eye size={16} /> {t('previewSkin')}</span>
                    </button>
                    <div className="skin-card-info"><strong className="ellipsis">{skin.name}</strong><span>{new Date(skin.createdAt).toLocaleDateString()}</span></div>
                    <div className="skin-card-actions">
                      <button className="btn btn-subtle btn-sm" disabled={busy || isApplied} onClick={() => void applySkin(skin.hash, skin.model)}>
                        {isApplied ? <><Check size={13} /> {t('applied')}</> : t('apply')}
                      </button>
                      <button className="icon-btn danger" disabled={busy} onClick={() => requestSkinRemoval(skin)} title="Remove skin"><Trash2 size={14} /></button>
                    </div>
                    {isConfirming && (
                      <div className="inline-confirm">
                        <span>Remove this skin?</span>
                        <button disabled={busy} onClick={() => void confirmSkinRemoval(skin.hash)}>Remove</button>
                        <button onClick={() => { setConfirmRemove(null); setStatus(''); }}>Cancel</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="panel offline-skins-panel">
        <div className="panel-header">
          <div>
            <h2>Offline server skins</h2>
            <p>Make skins visible on offline-mode / cracked servers without a server plugin</p>
          </div>
          <span className="deps-chip" title="Resolved locally by Fox Launcher">CLIENT SIDE</span>
        </div>
        <p className="offline-skins-note">
          Offline servers identify players by a UUID generated from the name. Add a player once and Fox Launcher
          caches their skin locally. Explicit mappings win over same-named library skins, and players work even
          when the active profile has no skin.
        </p>
        <div className="offline-skin-form">
          <input
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void addOfflinePlayer(); }}
            placeholder="Player name"
            maxLength={16}
            aria-label="Player name"
          />
          <select value={manualHash} onChange={(event) => setManualHash(event.target.value)} aria-label="Skin source">
            <option value="">Fetch skin from Mojang</option>
            {skins.map((skin) => (
              <option key={skin.hash} value={skin.hash}>Use library: {skin.name}</option>
            ))}
          </select>
          <Button size="sm" icon={<Users size={14} />} loading={offlineBusy} onClick={() => void addOfflinePlayer()}>
            Add / refresh
          </Button>
        </div>
        {offlineSkins.length === 0 ? (
          <p className="muted offline-skins-empty">No offline players added yet. Add a name to serve its skin on offline-mode servers.</p>
        ) : (
          <div className="offline-skin-list">
            {offlineSkins.map((entry) => {
              const skin = skins.find((item) => item.hash === entry.hash);
              const isConfirming = confirmRemove?.kind === 'offline' && confirmRemove.name === entry.name;
              return (
                <div key={entry.name.toLowerCase()} className="offline-skin-row">
                  {skin ? <img src={skin.dataUrl} alt="" /> : <div className="offline-skin-avatar" />}
                  <div className="offline-skin-meta">
                    <strong>{entry.name}</strong>
                    <span>
                      {entry.source === 'mojang' ? 'Mojang profile' : 'Custom skin'} · {entry.model} · {entry.uuid.slice(0, 8)}
                    </span>
                  </div>
                  <button
                    className="icon-btn"
                    disabled={offlineBusy}
                    title={entry.source === 'manual' ? `Reapply selected skin for ${entry.name}` : `Refresh ${entry.name} skin`}
                    onClick={() => void refreshOfflinePlayer(entry.name, entry.hash)}
                  >
                    <RefreshCw size={14} />
                  </button>
                  <button className="icon-btn danger" disabled={offlineBusy} title={`Remove ${entry.name}`} onClick={() => requestOfflineRemoval(entry.name)}>
                    <Trash2 size={14} />
                  </button>
                  {isConfirming && (
                    <div className="inline-confirm">
                      <span>Remove {entry.name}?</span>
                      <button disabled={offlineBusy} onClick={() => void confirmOfflineRemoval(entry.name)}>Remove</button>
                      <button onClick={() => { setConfirmRemove(null); setStatus(''); }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {accountModal && <AccountModal onClose={() => setAccountModal(false)} />}
    </div>
  );
}
