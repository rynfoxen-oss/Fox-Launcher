import { useEffect, useRef, useState } from 'react';
import { Check, Eye, Plus, RefreshCw, Search, Shirt, Trash2, Upload, Users, X } from 'lucide-react';
import type { CapeEntry, OfficialCape, SkinEntry, SkinModel } from '../../shared/types';
import { selectedCape, selectedCapeUrl, useApp } from '../store';
import { useT } from '../i18n';
import { droppedFile, isFileDrag, readFileAsDataUrl } from '../fileDrop';
import { SkinPreview } from '../components/SkinPreview';
import { CapeThumb } from '../components/CapeThumb';
import { AccountModal } from '../components/AccountModal';
import { Button, EmptyState, Segmented } from '../components/Common';

export function SkinsPage() {
  const currentAccount = useApp((state) => state.currentAccount);
  const skins = useApp((state) => state.skins);
  const capes = useApp((state) => state.capes);
  const offlineSkins = useApp((state) => state.offlineSkins);
  const refreshSkins = useApp((state) => state.refreshSkins);
  const refreshCapes = useApp((state) => state.refreshCapes);
  const refreshOfflineSkins = useApp((state) => state.refreshOfflineSkins);
  const refreshAccounts = useApp((state) => state.refreshAccounts);
  const launchState = useApp((state) => state.launchState);
  const settings = useApp((state) => state.settings);
  const selectedInstanceId = useApp((state) => state.selectedInstanceId);
  const t = useT();
  const [accountModal, setAccountModal] = useState(false);
  const [model, setModel] = useState<SkinModel>(currentAccount?.skinModel ?? 'steve');
  const [modelTouched, setModelTouched] = useState(false);
  const [preview, setPreview] = useState<SkinEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [skinSearch, setSkinSearch] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<{ kind: 'skin' | 'offline'; name: string; hash?: string } | null>(null);
  const [playerName, setPlayerName] = useState('');
  const [manualHash, setManualHash] = useState('');
  const [offlineModel, setOfflineModel] = useState<SkinModel | ''>('');
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [restartHint, setRestartHint] = useState(false);
  const [capeBusy, setCapeBusy] = useState(false);
  const [capeStatus, setCapeStatus] = useState('');
  const [capePreview, setCapePreview] = useState<{ key: string; url: string; name: string } | null>(null);
  const [capeConfirm, setCapeConfirm] = useState<string | null>(null);

  const gameRunning = launchState.status === 'preparing' || launchState.status === 'launching' || launchState.status === 'running';

  useEffect(() => {
    if (!gameRunning) setRestartHint(false);
  }, [gameRunning]);

  // A preview owns its model choice; switching away from it returns to the
  // active profile's saved model.
  useEffect(() => {
    if (preview) {
      setModel(preview.model);
      setModelTouched(false);
    }
  }, [preview?.hash]);

  useEffect(() => {
    if (!preview) {
      setModel(currentAccount?.skinModel ?? 'steve');
      setModelTouched(false);
    }
  }, [currentAccount?.id, currentAccount?.skinModel, preview]);

  function reportError(error: unknown, prefix: string) {
    setStatus(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }

  function modelLabel(value: SkinModel): string {
    return t(value === 'alex' ? 'slim' : 'classic');
  }

  function markRestartNeeded(): void {
    if (gameRunning) setRestartHint(true);
  }

  async function restartGame() {
    const instanceId = launchState.instanceId ?? settings.lastInstanceId ?? selectedInstanceId;
    if (!instanceId) {
      setStatus('No recent instance to restart. Stop the game and press Play instead.');
      return;
    }
    setBusy(true);
    try {
      await window.fox.launcher.stop();
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const state = await window.fox.launcher.state();
        if (!['preparing', 'launching', 'running'].includes(state.status)) break;
      }
      await window.fox.launcher.launch(instanceId);
      setRestartHint(false);
      setStatus('Restarting the game with the saved skin model.');
    } catch (error) {
      reportError(error, 'Could not restart the game');
    } finally {
      setBusy(false);
    }
  }

  /** Saves an explicit model for a skin; applies it immediately if it is active. */
  async function changeSkinModel(skin: SkinEntry, next: SkinModel) {
    setModelTouched(true);
    setBusy(true);
    try {
      if (currentAccount?.skinHash === skin.hash) {
        const result = await window.fox.skins.select(skin.hash, currentAccount.id, next);
        await Promise.all([refreshAccounts(), refreshSkins(), refreshOfflineSkins()]);
        setModel(result.account.skinModel ?? next);
        setStatus(`${skin.name}: ${modelLabel(next)} model applied to ${result.account.name}.`);
      } else {
        await window.fox.skins.setModel(skin.hash, next);
        await Promise.all([refreshSkins(), refreshOfflineSkins()]);
        setStatus(`${skin.name}: ${modelLabel(next)} model saved. Apply it whenever you are ready.`);
      }
      markRestartNeeded();
      setPreview((current) => current?.hash === skin.hash ? { ...current, model: next } : current);
    } catch (error) {
      reportError(error, 'Could not change skin model');
    } finally {
      setBusy(false);
    }
  }

  async function changeModel(next: SkinModel) {
    if (next === model) return;
    setModelTouched(true);
    if (preview) {
      await changeSkinModel(preview, next);
      return;
    }
    const activeSkin = skins.find((skin) => skin.hash === currentAccount?.skinHash);
    if (currentAccount && activeSkin) {
      await changeSkinModel(activeSkin, next);
      return;
    }
    setModel(next);
    setStatus(`${modelLabel(next)} model selected. Import or choose a skin to apply it.`);
  }

  async function finishImport(skin: SkinEntry | null) {
    if (!skin) {
      setStatus('Skin import canceled.');
      return;
    }
    await refreshSkins();
    setPreview(null);
    if (!currentAccount) {
      setStatus(`${skin.name} added (${modelLabel(skin.model)}). Choose a profile to apply it.`);
      setAccountModal(true);
      return;
    }
    // Use the player's explicit choice when they made one; otherwise keep the
    // detected model so slim/Alex textures are not forced back to classic.
    const targetModel = modelTouched ? model : skin.model;
    try {
      const result = await window.fox.skins.select(skin.hash, currentAccount.id, targetModel);
      await Promise.all([refreshAccounts(), refreshSkins(), refreshOfflineSkins()]);
      setModel(result.account.skinModel ?? targetModel);
      setStatus(`${skin.name} added and applied (${modelLabel(targetModel)}). ${result.message}`);
      markRestartNeeded();
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
      const targetModel = selectedModel ?? (preview?.hash === hash ? model : skin?.model) ?? model;
      const result = await window.fox.skins.select(hash, currentAccount.id, targetModel);
      await Promise.all([refreshAccounts(), refreshSkins(), refreshOfflineSkins()]);
      setPreview(null);
      setModel(result.account.skinModel ?? targetModel);
      setStatus(result.message);
      markRestartNeeded();
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
        : await window.fox.accounts.uploadSkin(currentAccount.id, modelTouched ? model : undefined);
      await Promise.all([refreshAccounts(), refreshSkins(), refreshOfflineSkins()]);
      setModel(result.account.skinModel ?? model);
      setStatus(result.message);
      markRestartNeeded();
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
      const entry = await window.fox.skins.addOfflinePlayer(
        name,
        manualHash || undefined,
        offlineModel || undefined,
      );
      await Promise.all([refreshOfflineSkins(), refreshSkins()]);
      setPlayerName('');
      setManualHash('');
      setOfflineModel('');
      setStatus(`${entry.name} skin is ready on offline servers (${modelLabel(entry.model)}).`);
    } catch (error) {
      reportError(error, 'Could not add offline skin');
    } finally {
      setOfflineBusy(false);
    }
  }

  async function refreshOfflinePlayer(name: string, hash?: string, model?: SkinModel) {
    setOfflineBusy(true);
    try {
      const entry = await window.fox.skins.addOfflinePlayer(name, hash || undefined, model);
      await Promise.all([refreshOfflineSkins(), refreshSkins()]);
      setStatus(`${entry.name} skin refreshed (${modelLabel(entry.model)}).`);
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

  const activeCape = selectedCape(currentAccount, capes);
  const equippedCapeUrl = selectedCapeUrl(currentAccount, capes);
  const officialCapes: OfficialCape[] = currentAccount?.type === 'microsoft'
    ? currentAccount.capes ?? []
    : [];

  function capeKey(kind: 'official' | 'custom', id: string): string {
    return `${kind}:${id}`;
  }

  function isCapeEquipped(kind: 'official' | 'custom', id: string): boolean {
    return kind === 'official'
      ? activeCape?.type === 'official' && activeCape.id === id
      : activeCape?.type === 'custom' && activeCape.hash === id;
  }

  function previewCape(key: string, url: string, name: string) {
    setCapePreview((current) => current?.key === key ? null : { key, url, name });
  }

  function showProfile() {
    setPreview(null);
    setCapePreview(null);
    setModel(currentAccount?.skinModel ?? 'steve');
    setModelTouched(false);
    setStatus('');
  }

  async function withCapeBusy(label: string, action: () => Promise<void>) {
    setCapeBusy(true);
    try {
      await action();
    } catch (error) {
      setCapeStatus(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCapeBusy(false);
    }
  }

  async function refreshOfficial() {
    if (currentAccount?.type !== 'microsoft') {
      setCapeStatus('Sign in with Microsoft to detect official capes.');
      return;
    }
    await withCapeBusy('Could not refresh official capes', async () => {
      const updated = await window.fox.capes.refreshOfficial(currentAccount.id);
      await refreshAccounts();
      const count = updated.capes?.length ?? 0;
      setCapeStatus(`${count} official cape${count === 1 ? '' : 's'} detected for ${updated.name}.`);
    });
  }

  async function importCape() {
    await withCapeBusy('Cape import failed', async () => {
      const entry = await window.fox.capes.import();
      if (!entry) {
        setCapeStatus('Cape import canceled.');
        return;
      }
      await refreshCapes();
      setCapeStatus(`${entry.name} added to the cape wardrobe. Apply it to an account to use it.`);
    });
  }

  async function equipOfficial(cape: OfficialCape) {
    if (!currentAccount) return;
    await withCapeBusy('Could not equip cape', async () => {
      await window.fox.capes.applyOfficial(currentAccount.id, cape.id);
      await refreshAccounts();
      setCapePreview(null);
      setCapeStatus(`${cape.alias || cape.id} equipped on your Microsoft profile.`);
      markRestartNeeded();
    });
  }

  async function applyCustomCape(entry: CapeEntry) {
    if (!currentAccount) return;
    await withCapeBusy('Could not apply cape', async () => {
      const result = await window.fox.capes.applyCustom(currentAccount.id, entry.hash);
      await Promise.all([refreshAccounts(), refreshCapes()]);
      setCapePreview(null);
      setCapeStatus(result.message);
      markRestartNeeded();
    });
  }

  async function clearCape() {
    if (!currentAccount) return;
    await withCapeBusy('Could not clear cape', async () => {
      await window.fox.capes.clear(currentAccount.id);
      await Promise.all([refreshAccounts(), refreshCapes()]);
      setCapePreview(null);
      setCapeStatus('Cape cleared. Your active official cape is restored when available.');
      markRestartNeeded();
    });
  }

  async function removeCape(entry: CapeEntry) {
    const key = capeKey('custom', entry.hash);
    await withCapeBusy('Could not remove cape', async () => {
      await window.fox.capes.remove(entry.hash);
      await Promise.all([refreshCapes(), refreshAccounts()]);
      setCapeConfirm(null);
      if (capePreview?.key === key) setCapePreview(null);
      setCapeStatus(`${entry.name} removed from the local cape library.`);
    });
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
          {gameRunning && restartHint && (
            <div className="restart-notice" role="status" aria-live="polite">
              <span>Skin changes apply the next time the game starts.</span>
              <button className="btn btn-sm" disabled={busy} onClick={() => void restartGame()}>
                <RefreshCw size={12} /> Restart game
              </button>
              <button className="link-button" onClick={() => window.fox.launcher.stop()}>Stop only</button>
            </div>
          )}
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
              capeUrl={capePreview?.url ?? equippedCapeUrl}
              model={previewModel}
              width={320}
              height={430}
              showControls
            />
          </div>

          <div className="stage-controls">
            <div className="stage-model-row">
              <span>{t('skinModel')}</span>
              <Segmented value={model} onChange={(next) => void changeModel(next)} options={[
                { value: 'steve', label: t('classic') },
                { value: 'alex', label: t('slim') },
              ]} />
            </div>
            <span className="muted small">{t('skinModelHint')}</span>
            <span className="muted small">{t('skinStageHint')}</span>
          </div>

          <div className="skin-details">
            <div><span>{t('skinDetails')}</span><strong>{previewName}</strong></div>
            <div><span>{t('skinModel')}</span><strong>{modelLabel(previewModel)}</strong></div>
            <div><span>{t('source')}</span><strong>{preview ? t('librarySource') : t('profileSource')}</strong></div>
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
                    <button className="skin-thumb" onClick={() => { setPreview(skin); setModel(skin.model); setModelTouched(false); }} title={t('previewSkin')}>
                      <img src={skin.dataUrl} alt={skin.name} />
                      <span className="skin-thumb-overlay"><Eye size={16} /> {t('previewSkin')}</span>
                    </button>
                    <button
                      className="skin-model-badge"
                      disabled={busy}
                      title={`${t('skinModel')}: ${modelLabel(skin.model)} — switch to ${modelLabel(skin.model === 'alex' ? 'steve' : 'alex')}`}
                      onClick={() => void changeSkinModel(skin, skin.model === 'alex' ? 'steve' : 'alex')}
                    >
                      {skin.model === 'alex' ? 'SLIM' : 'CLASSIC'}
                    </button>
                    <div className="skin-card-info"><strong className="ellipsis">{skin.name}</strong><span>{new Date(skin.createdAt).toLocaleDateString()}</span></div>
                    <div className="skin-card-actions">
                      <button className="btn btn-subtle btn-sm" disabled={busy || isApplied} onClick={() => void applySkin(skin.hash)}>
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

      <section className="panel cape-section">
        <div className="cape-section-header">
          <div>
            <h2>{t('capeWardrobe')}</h2>
            <p className="cape-section-note">{t('capeDescription')}</p>
          </div>
          <div className="header-actions">
            {currentAccount?.type === 'microsoft' && (
              <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} loading={capeBusy} onClick={() => void refreshOfficial()}>
                {t('refreshOfficial')}
              </Button>
            )}
            <Button size="sm" icon={<Upload size={14} />} loading={capeBusy} onClick={() => void importCape()}>
              {t('importCape')}
            </Button>
            {activeCape && (
              <Button variant="secondary" size="sm" disabled={capeBusy} onClick={() => void clearCape()}>
                {t('clearCape')}
              </Button>
            )}
          </div>
        </div>
        {capePreview && (
          <div className="cape-preview-bar">
            <span>{t('previewing')} {capePreview.name}</span>
            <button className="link-button" onClick={() => setCapePreview(null)}>{t('backToProfile')}</button>
          </div>
        )}
        {capeStatus && <p className="status-description">{capeStatus}</p>}
        <p className="cape-section-note">{t('capeLocalOnlyHint')}</p>
        {currentAccount?.type === 'offline' && (
          <p className="status-description">
            Ice Fox Cape is granted automatically to cracked/offline accounts. Modded instances install CustomSkinLoader
            on launch; vanilla uses Fox Launcher's built-in skin agent instead.
          </p>
        )}

        <div className="cape-subhead">
          <strong>{t('officialCapes')}</strong>
          {currentAccount?.type !== 'microsoft' && <span className="muted small">{t('microsoftHint')}</span>}
        </div>
        {currentAccount?.type !== 'microsoft' ? (
          <p className="cape-empty">{t('signInWithMicrosoft')}</p>
        ) : officialCapes.length === 0 ? (
          <p className="cape-empty">{t('noOfficialCapes')}</p>
        ) : (
          <div className="cape-grid">
            {officialCapes.map((cape) => {
              const key = capeKey('official', cape.id);
              const equipped = isCapeEquipped('official', cape.id);
              return (
                <div key={cape.id} className={`cape-card ${equipped ? 'active' : ''} ${capePreview?.key === key ? 'previewing' : ''}`}>
                  <button className="cape-thumb" onClick={() => previewCape(key, cape.url, cape.alias || cape.id)} title={t('previewCape')}>
                    <CapeThumb src={cape.url} alt={cape.alias || cape.id} />
                  </button>
                  <div className="cape-card-info"><strong className="ellipsis">{cape.alias || cape.id}</strong><span>{cape.state}</span></div>
                  <div className="cape-card-actions">
                    <button className="btn btn-subtle btn-sm" disabled={capeBusy || equipped} onClick={() => void equipOfficial(cape)}>
                      {equipped ? <><Check size={13} /> {t('capeEquipped')}</> : t('equipCape')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="cape-subhead">
          <strong>{t('customCapes')}</strong>
          <span className="muted small">{capes.length} {t('capes')}</span>
        </div>
        {capes.length === 0 ? (
          <p className="cape-empty">{t('noCustomCapes')}</p>
        ) : (
          <div className="cape-grid">
            {capes.map((entry) => {
              const key = capeKey('custom', entry.hash);
              const applied = isCapeEquipped('custom', entry.hash);
              const confirming = capeConfirm === entry.hash;
              return (
                <div key={entry.hash} className={`cape-card ${applied ? 'active' : ''} ${capePreview?.key === key ? 'previewing' : ''}`}>
                  <button className="cape-thumb" onClick={() => previewCape(key, entry.dataUrl, entry.name)} title={t('previewCape')}>
                    <CapeThumb src={entry.dataUrl} alt={entry.name} />
                  </button>
                  <div className="cape-card-info">
                    <strong className="ellipsis">{entry.name}</strong>
                    <span>{entry.builtin ? 'FREE · Included with Fox Launcher' : new Date(entry.createdAt).toLocaleDateString()}</span>
                  </div>
                  <div className="cape-card-actions">
                    <button className="btn btn-subtle btn-sm" disabled={capeBusy || !currentAccount || applied} onClick={() => void applyCustomCape(entry)}>
                      {applied ? <><Check size={13} /> {t('capeApplied')}</> : t('apply')}
                    </button>
                    {!entry.builtin && (
                      <button className="icon-btn danger" disabled={capeBusy} onClick={() => { setCapeConfirm(entry.hash); setCapeStatus(`Remove “${entry.name}” from the local library? Confirm below.`); }} title="Remove cape">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  {confirming && !entry.builtin && (
                    <div className="inline-confirm">
                      <span>Remove this cape?</span>
                      <button disabled={capeBusy} onClick={() => void removeCape(entry)}>Remove</button>
                      <button onClick={() => { setCapeConfirm(null); setCapeStatus(''); }}>Cancel</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

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
          <select
            value={manualHash}
            onChange={(event) => {
              setManualHash(event.target.value);
              setOfflineModel('');
            }}
            aria-label="Skin source"
          >
            <option value="">Fetch skin from Mojang</option>
            {skins.map((skin) => (
              <option key={skin.hash} value={skin.hash}>Use library: {skin.name}</option>
            ))}
          </select>
          <select
            className="offline-model-select"
            value={offlineModel}
            onChange={(event) => setOfflineModel(event.target.value as SkinModel | '')}
            aria-label={t('skinModel')}
          >
            <option value="">{t('modelAuto')}</option>
            <option value="steve">{t('classic')}</option>
            <option value="alex">{t('slim')}</option>
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
                      {entry.source === 'mojang' ? 'Mojang profile' : 'Custom skin'} · {modelLabel(entry.model)} · {entry.uuid.slice(0, 8)}
                    </span>
                  </div>
                  <button
                    className="icon-btn"
                    disabled={offlineBusy}
                    title={entry.source === 'manual' ? `Reapply selected skin for ${entry.name}` : `Refresh ${entry.name} skin`}
                    onClick={() => void refreshOfflinePlayer(entry.name, entry.hash, entry.model)}
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
