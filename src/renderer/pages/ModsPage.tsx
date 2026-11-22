import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Boxes,
  Check,
  Download,
  ExternalLink,
  FolderOpen,
  History,
  Package,
  Palette,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { InstalledMod, ModSearchResult, ModVersion, VersionSummary } from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, EmptyState, Modal, Spinner } from '../components/Common';

const CATEGORIES = [
  { value: 'mod', key: 'mods', icon: <Package size={14} /> },
  { value: 'resourcepack', key: 'resourcePacks', icon: <Palette size={14} /> },
  { value: 'shader', key: 'shaders', icon: <Sparkles size={14} /> },
  { value: 'modpack', key: 'modpacks', icon: <Boxes size={14} /> },
] as const;

type SortMode = 'relevance' | 'downloads' | 'name';

function formatDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return String(value);
}

function contentTypeLabel(type?: InstalledMod['type']): string {
  if (type === 'resourcepack') return 'Pack';
  if (type === 'shader') return 'Shader';
  return 'Mod';
}

function contentTypeClass(type?: InstalledMod['type']): string {
  if (type === 'resourcepack') return 'resourcepack';
  if (type === 'shader') return 'shader';
  return '';
}

export function ModsPage() {
  const { instances, selectedInstanceId, toast, navigate } = useApp();
  const t = useT();
  const instance = instances.find((item) => item.id === selectedInstanceId) ?? instances[0];
  const [category, setCategory] = useState<string>('mod');
  const [query, setQuery] = useState('');
  const [mcVersion, setMcVersion] = useState(instance?.minecraftVersion ?? '');
  const [versionOptions, setVersionOptions] = useState<VersionSummary[]>([]);
  const [results, setResults] = useState<ModSearchResult[]>([]);
  const [installed, setInstalled] = useState<InstalledMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installingSkinFix, setInstallingSkinFix] = useState(false);
  const [installingFpsPack, setInstallingFpsPack] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [sort, setSort] = useState<SortMode>('relevance');
  const [installedOnly, setInstalledOnly] = useState(false);
  const [installedQuery, setInstalledQuery] = useState('');
  const [versionModal, setVersionModal] = useState<ModSearchResult | null>(null);
  const [modVersions, setModVersions] = useState<ModVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<ModVersion | null>(null);
  const searchSequence = useRef(0);

  async function refreshInstalled() {
    if (!instance) return;
    try {
      setInstalled(await window.fox.mods.list(instance.id));
    } catch {
      setInstalled([]);
    }
  }

  const runSearch = useCallback(async () => {
    if (!instance) return;
    const request = ++searchSequence.current;
    setLoading(true);
    setSearched(true);
    try {
      const data = await window.fox.mods.search(query, instance.loader, mcVersion, category, 'modrinth');
      if (request === searchSequence.current) setResults(data);
    } catch (error) {
      if (request === searchSequence.current) {
        toast('error', error instanceof Error ? error.message : String(error), 'errors');
        setResults([]);
      }
    } finally {
      if (request === searchSequence.current) setLoading(false);
    }
  }, [instance?.id, instance?.loader, query, mcVersion, category, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void window.fox.instances.getVersions()
      .then(setVersionOptions)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (instance) setMcVersion(instance.minecraftVersion);
  }, [instance?.id, instance?.minecraftVersion]);

  useEffect(() => {
    if (!instance) return;
    void refreshInstalled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id]);

  useEffect(() => {
    if (!instance) return;
    if (category === 'modpack') {
      searchSequence.current += 1;
      setResults([]);
      setSearched(false);
      setLoading(false);
      return;
    }
    const timer = window.setTimeout(() => void runSearch(), 220);
    return () => window.clearTimeout(timer);
  }, [instance?.id, category, mcVersion, query, runSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  function isInstalled(mod: ModSearchResult): boolean {
    return installed.some((item) =>
      item.projectId === mod.projectId || item.name.toLowerCase() === mod.title.toLowerCase());
  }

  const visibleResults = useMemo(() => {
    let list = results;
    if (installedOnly) list = list.filter((mod) => isInstalled(mod));
    if (sort === 'downloads') list = [...list].sort((a, b) => b.downloads - a.downloads);
    if (sort === 'name') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, installed, installedOnly, sort]);

  const visibleInstalled = useMemo(() => {
    const term = installedQuery.trim().toLowerCase();
    if (!term) return installed;
    return installed.filter((mod) => `${mod.name} ${mod.fileName}`.toLowerCase().includes(term));
  }, [installed, installedQuery]);

  const updateCount = installed.filter((mod) => mod.updateAvailable).length;

  async function installMod(mod: ModSearchResult) {
    if (!instance) return;
    setInstalling(mod.projectId);
    try {
      await window.fox.mods.install(instance.id, mod.projectId, mod.source, mod.title, mod.projectType);
      await refreshInstalled();
      toast('success', `${mod.title} installed with dependencies`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setInstalling(null);
    }
  }

  async function installSkinFix() {
    if (!instance) return;
    setInstallingSkinFix(true);
    try {
      const result = await window.fox.mods.installSkinFix(instance.id);
      await refreshInstalled();
      if (result.installed.length) {
        toast('success', `Installed skin fix: ${result.installed.join(', ')}`);
      }
      if (result.skipped.length) {
        const summary = result.skipped
          .map((item) => `${item.title} (${item.reason})`)
          .join(', ');
        toast('info', `Skipped: ${summary}`, 'downloads');
      }
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setInstallingSkinFix(false);
    }
  }

  async function installFpsPack() {
    if (!instance) return;
    setInstallingFpsPack(true);
    try {
      const result = await window.fox.performance.installFpsMods(instance.id);
      await refreshInstalled();
      const skipped = result.skipped.length
        ? ` Skipped ${result.skipped.map((item) => item.title).join(', ')}.`
        : '';
      toast('success', `FPS pack ready: ${result.installed.join(' + ')}.${skipped}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setInstallingFpsPack(false);
    }
  }

  async function openVersions(mod: ModSearchResult) {
    setVersionModal(mod);
    setModVersions([]);
    setSelectedVersion(null);
    setVersionsLoading(true);
    try {
      setModVersions(await window.fox.mods.versions(mod.projectId, mod.source, mod.projectType, mcVersion));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
      setVersionModal(null);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function installSelectedVersion() {
    if (!instance || !versionModal || !selectedVersion) return;
    setInstalling(selectedVersion.id);
    try {
      await window.fox.mods.installVersion(
        instance.id,
        versionModal.projectId,
        versionModal.source,
        versionModal.title,
        versionModal.projectType,
        selectedVersion.id,
      );
      await refreshInstalled();
      toast('success', `${versionModal.title} ${selectedVersion.version} installed with dependencies`);
      setVersionModal(null);
      setSelectedVersion(null);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setInstalling(null);
    }
  }

  async function checkUpdates() {
    if (!instance) return;
    setChecking(true);
    try {
      const updated = await window.fox.mods.checkUpdates(instance.id);
      setInstalled(updated);
      const count = updated.filter((item) => item.updateAvailable).length;
      toast('info', count ? `${count} update${count === 1 ? '' : 's'} available` : 'All mods are up to date');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setChecking(false);
    }
  }

  async function updateInstalled(mod: InstalledMod) {
    if (!instance || !mod.projectId) return;
    setUpdating(mod.fileName);
    try {
      setInstalled(await window.fox.mods.update(instance.id, mod.projectId, mod.fileName));
      toast('success', `${mod.name} updated`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setUpdating(null);
    }
  }

  async function toggleInstalled(mod: InstalledMod) {
    if (!instance) return;
    try {
      setInstalled(await window.fox.mods.toggle(instance.id, mod.fileName, mod.type));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    }
  }

  async function removeInstalled(mod: InstalledMod) {
    if (!instance) return;
    try {
      setInstalled(await window.fox.mods.remove(instance.id, mod.fileName, mod.type));
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    }
  }

  if (!instance) {
    return <EmptyState icon={<Boxes size={30} />} title="No instance selected"
      description="Create an instance first, then you can install mods for it."
      action={<Button onClick={() => navigate('instances')}>Go to instances</Button>} />;
  }

  const expectedLoader = instance.loader === 'vanilla' ? 'fabric' : instance.loader;
  const selectedGameMatch = selectedVersion
    ? selectedVersion.gameVersions.length === 0 || selectedVersion.gameVersions.includes(mcVersion)
    : true;
  const selectedLoaderMatch = selectedVersion
    ? selectedVersion.loaders.length === 0
      || selectedVersion.loaders.some((loader) => loader.toLowerCase() === expectedLoader)
    : true;
  const versionMismatch = [
    !selectedGameMatch && `Minecraft ${mcVersion}`,
    !selectedLoaderMatch && instance.loader,
  ].filter(Boolean).join(' and ');

  return (
    <div className="page mods-page stagger-in">
      <div className="page-header">
        <div>
          <div className="mods-eyebrow"><span className="pulse-dot" /> MODRINTH LIBRARY</div>
          <h1>{t('modsContent')}</h1>
          <p>Discover, install and manage content for <strong>{instance.name}</strong> · {instance.minecraftVersion} · {instance.loader}.</p>
        </div>
        <div className="header-actions">
          <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void window.fox.app.openFolder(`${instance.gameDir}/mods`)}>
            Open mods folder
          </Button>
          <Button
            variant="secondary"
            icon={<Zap size={15} />}
            loading={installingFpsPack}
            disabled={instance.loader === 'vanilla'}
            title={instance.loader === 'vanilla' ? 'FPS mods require a mod loader' : 'Install Sodium/Lithium or Embeddium/Rubidium'}
            onClick={() => void installFpsPack()}
          >
            Install FPS pack
          </Button>
          <Button variant="secondary" icon={<RefreshCw size={15} />} loading={checking} onClick={() => void checkUpdates()}>
            {t('checkUpdates')}
          </Button>
        </div>
      </div>

      <section className="mods-overview">
        <div className="mods-overview-glow" aria-hidden="true" />
        <div className="mods-overview-stat">
          <span className="mods-overview-icon"><Package size={18} /></span>
          <div><strong>{installed.length}</strong><small>installed files</small></div>
        </div>
        <div className="mods-overview-stat">
          <span className="mods-overview-icon update"><RefreshCw size={18} /></span>
          <div><strong>{updateCount}</strong><small>updates ready</small></div>
        </div>
        <div className="mods-overview-stat">
          <span className="mods-overview-icon loader"><Boxes size={18} /></span>
          <div><strong>{instance.loader}</strong><small>active loader</small></div>
        </div>
        <div className="mods-overview-skin">
          <div>
            <strong>Skins on offline servers</strong>
            <span>Install the client-side fix once for this instance.</span>
          </div>
          <Button
            size="sm"
            icon={<Sparkles size={14} />}
            loading={installingSkinFix}
            disabled={instance.loader === 'vanilla'}
            title={instance.loader === 'vanilla' ? 'Skin fix mods require a mod loader' : 'Install CustomSkinLoader and 3D Skin Layers'}
            onClick={() => void installSkinFix()}
          >
            Install skin fix
          </Button>
        </div>
      </section>

      <section className="mods-command-bar">
        <div className="search-box mods-search">
          <Search size={16} />
          <input
            value={query}
            placeholder={t('searchPlaceholder')}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void runSearch()}
          />
          {query && <button className="search-clear" title="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
          <kbd>Enter</kbd>
        </div>
        <label className="version-picker" title="Search mods for a Minecraft version">
          <span>MC</span>
          <select value={mcVersion} onChange={(event) => setMcVersion(event.target.value)} aria-label="Minecraft version">
            {mcVersion && !versionOptions.some((item) => item.id === mcVersion) && (
              <option value={mcVersion}>{mcVersion}</option>
            )}
            {versionOptions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}{item.type === 'release' ? '' : ` · ${item.type.replace('_', ' ')}`}
              </option>
            ))}
          </select>
        </label>
        <select className="mods-sort" value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="Sort results">
          <option value="relevance">Sort: Relevant</option>
          <option value="downloads">Sort: Popular</option>
          <option value="name">Sort: A–Z</option>
        </select>
        <button className={`filter-toggle ${installedOnly ? 'active' : ''}`} onClick={() => setInstalledOnly(!installedOnly)} title="Show only installed projects">
          <Check size={14} /> Installed only
        </button>
        <span className="deps-chip" title="Required dependencies are installed automatically">DEPS AUTO</span>
      </section>

      <div className="category-strip mods-categories">
        {CATEGORIES.map((item) => (
          <button key={item.value} className={category === item.value ? 'active' : ''} onClick={() => setCategory(item.value)}>
            {item.icon}{t(item.key)}
          </button>
        ))}
      </div>

      <div className="mods-workspace">
        <section className="panel mods-results-panel">
          <div className="panel-header">
            <div>
              <h2>{t('discover')}</h2>
              <p>Modrinth · {mcVersion} · {visibleResults.length} result{visibleResults.length === 1 ? '' : 's'}</p>
            </div>
            {loading && <Spinner size={16} />}
          </div>

          {loading && results.length === 0 ? (
            <div className="center-pad"><Spinner /><p className="muted small">Searching Modrinth…</p></div>
          ) : visibleResults.length === 0 ? (
            <EmptyState
              icon={<Download size={26} />}
              title={category === 'modpack' ? 'Modpacks have a dedicated flow' : searched ? t('nothingFound') : t('startSearching')}
              description={category === 'modpack'
                ? 'Import a modpack from Instances to install all of its files at once.'
                : searched ? t('noResultsDescription') : t('noContentDescription')}
              action={category === 'modpack' ? <Button variant="secondary" onClick={() => navigate('instances', instance.id, { focus: 'import' })}>Import modpack</Button> : undefined}
            />
          ) : (
            <div className="mod-card-grid">
              {visibleResults.map((mod) => {
                const installedHere = isInstalled(mod);
                return (
                  <article className={`mod-card ${installedHere ? 'installed' : ''}`} key={`${mod.source}-${mod.projectId}`}>
                    <div className="mod-card-top">
                      {mod.iconUrl
                        ? <img className="mod-icon" src={mod.iconUrl} alt="" loading="lazy" />
                        : <div className="mod-icon placeholder"><Package size={20} /></div>}
                      <div className="mod-card-badges">
                        {installedHere && <span className="installed-chip"><Check size={11} /> Installed</span>}
                        <span className="mod-source-chip">Modrinth</span>
                      </div>
                    </div>
                    <strong className="mod-card-title">{mod.title}</strong>
                    <p className="mod-card-description">{mod.description}</p>
                    <div className="mod-tags">
                      {mod.categories.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                    <div className="mod-card-meta">
                      <span><Download size={12} /> {formatCount(mod.downloads)} downloads</span>
                      {mod.latestVersion && <span>Build {mod.latestVersion}</span>}
                    </div>
                    <div className="mod-card-actions">
                      <Button
                        size="sm"
                        variant={installedHere ? 'secondary' : 'primary'}
                        icon={installedHere ? <ArrowDownToLine size={14} /> : <Download size={14} />}
                        loading={installing === mod.projectId}
                        onClick={() => void installMod(mod)}
                      >
                        {installedHere ? 'Reinstall' : t('install')}
                      </Button>
                      <Button size="sm" variant="secondary" icon={<History size={14} />} onClick={() => void openVersions(mod)}>
                        Versions
                      </Button>
                      <button
                        className="icon-btn"
                        title="Open project page"
                        onClick={() => {
                          const modrinthPath: Record<string, string> = {
                            mod: 'mod', resourcepack: 'resource-pack', shader: 'shader', modpack: 'modpack',
                          };
                          void window.fox.app.openExternal(`https://modrinth.com/${modrinthPath[mod.projectType] ?? 'mod'}/${mod.slug}`);
                        }}
                      >
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="panel mods-installed-panel">
          <div className="panel-header">
            <div>
              <h2>{t('installed')}</h2>
              <p>{installed.length} content file{installed.length === 1 ? '' : 's'} · click the dot to enable/disable</p>
            </div>
            {updateCount > 0 && <span className="update-badge">{updateCount} update{updateCount === 1 ? '' : 's'}</span>}
          </div>
          <div className="search-box installed-search">
            <Search size={14} />
            <input value={installedQuery} onChange={(event) => setInstalledQuery(event.target.value)} placeholder="Filter installed files…" />
            {installedQuery && <button className="search-clear" title="Clear filter" onClick={() => setInstalledQuery('')}><X size={13} /></button>}
          </div>
          {visibleInstalled.length === 0 ? (
            <EmptyState icon={<Package size={26} />} title={installedQuery ? 'No matches' : t('noModsInstalled')} description={installedQuery ? 'Try a different file name.' : t('noModsDescription')} />
          ) : (
            <div className="installed-list">
              {visibleInstalled.map((mod) => (
                <div className={`installed-row ${mod.enabled ? '' : 'disabled'}`} key={`${mod.type ?? 'mod'}-${mod.fileName}`}>
                  <span className={`content-type ${contentTypeClass(mod.type)}`}>{contentTypeLabel(mod.type)}</span>
                  <div className="installed-copy">
                    <strong>{mod.name}</strong>
                    <span>{mod.version ?? 'unknown version'} · {(mod.size / 1024 / 1024).toFixed(1)} MB</span>
                    {mod.compatible === false && <span className="warning-badge">Possible incompatibility</span>}
                    {mod.updateAvailable && <span className="update-badge">Update: {mod.updateAvailable}</span>}
                  </div>
                  <button
                    className={`status-dot ${mod.enabled ? 'on' : ''}`}
                    title={mod.enabled ? 'Disable' : 'Enable'}
                    onClick={() => void toggleInstalled(mod)}
                  />
                  {mod.updateAvailable && mod.projectId && (
                    <button
                      className="icon-btn"
                      title={`Install ${mod.updateAvailable}`}
                      disabled={updating === mod.fileName}
                      onClick={() => void updateInstalled(mod)}
                    >
                      {updating === mod.fileName ? <Spinner size={14} /> : <RefreshCw size={15} />}
                    </button>
                  )}
                  <button className="icon-btn danger" title="Remove" onClick={() => void removeInstalled(mod)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="installed-footer">
            <span>Changes apply the next time this instance launches.</span>
            <button className="link-button" onClick={() => void window.fox.app.openFolder(`${instance.gameDir}/mods`)}>
              <FolderOpen size={13} /> Open folder
            </button>
          </div>
        </aside>
      </div>

      {versionModal && (
        <Modal
          title={`Versions · ${versionModal.title}`}
          subtitle="Pick the exact release file — required dependencies install automatically"
          width={720}
          onClose={() => setVersionModal(null)}
          footer={
            <>
              {selectedVersion && versionMismatch && (
                <span className="version-warning">This release may not match {versionMismatch}.</span>
              )}
              <Button variant="secondary" onClick={() => setVersionModal(null)}>Cancel</Button>
              <Button icon={<Download size={15} />} loading={Boolean(installing && selectedVersion && installing === selectedVersion.id)}
                disabled={!selectedVersion} onClick={() => void installSelectedVersion()}>
                Install selected version
              </Button>
            </>
          }
        >
          {versionsLoading ? (
            <div className="center-pad"><Spinner /></div>
          ) : modVersions.length === 0 ? (
            <EmptyState icon={<History size={26} />} title="No versions found" description="This project has no downloadable releases." />
          ) : (
            <div className="version-list">
              {modVersions.map((version) => {
                const gameMatch = version.gameVersions.length === 0 || version.gameVersions.includes(mcVersion);
                const loaderMatch = version.loaders.length === 0
                  || version.loaders.some((loader) => loader.toLowerCase() === expectedLoader);
                return (
                  <button
                    type="button"
                    key={version.id}
                    className={`version-row ${selectedVersion?.id === version.id ? 'selected' : ''}`}
                    onClick={() => setSelectedVersion(version)}
                  >
                    <span className="version-row-main">
                      <strong>{version.name || version.version}</strong>
                      <span>
                        {version.versionType ?? 'release'} ·{' '}
                        {version.gameVersions.slice(0, 6).join(', ') || 'any Minecraft version'}
                      </span>
                      <small>{version.fileName}</small>
                    </span>
                    <span className="version-row-meta">
                      {version.loaders.slice(0, 3).map((loader) => (
                        <span className="version-tag" key={loader}>{loader}</span>
                      ))}
                      {formatDate(version.date) && <small>{formatDate(version.date)}</small>}
                      {typeof version.downloads === 'number' && <small>{formatCount(version.downloads)}</small>}
                    </span>
                    {!gameMatch && <span className="warning-badge">Different Minecraft version</span>}
                    {versionModal.projectType === 'mod' && !loaderMatch && <span className="warning-badge">Different loader</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
