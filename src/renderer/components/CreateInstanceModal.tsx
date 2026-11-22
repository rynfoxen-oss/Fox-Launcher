import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Plus } from 'lucide-react';
import type {
  JavaInstallation,
  LoaderAvailabilityMap,
  ModLoader,
  VersionSummary,
} from '../../shared/types';
import { useApp } from '../store';
import { Button, Field, Modal, Spinner } from './Common';

const RELEASES_FIRST = (a: VersionSummary, b: VersionSummary) => {
  if (a.type === 'release' && b.type !== 'release') return -1;
  if (b.type === 'release' && a.type !== 'release') return 1;
  return b.releaseTime.localeCompare(a.releaseTime);
};

const LOADERS: Array<{ id: ModLoader; label: string }> = [
  { id: 'vanilla', label: 'Vanilla' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'quilt', label: 'Quilt' },
];

export function CreateInstanceModal({ onClose }: { onClose: () => void }) {
  const { instances, settings, refreshInstances, toast } = useApp();
  const [name, setName] = useState('New Instance');
  const [version, setVersion] = useState('');
  const [loader, setLoader] = useState<ModLoader>('fabric');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [memory, setMemory] = useState(settings.memoryMb ?? 4096);
  const [javaPath, setJavaPath] = useState(settings.javaPath ?? '');
  const [icon, setIcon] = useState<string | undefined>();
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [availability, setAvailability] = useState<LoaderAvailabilityMap | null>(null);
  const [compatibilityLoading, setCompatibilityLoading] = useState(true);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [javaInstallations, setJavaInstallations] = useState<JavaInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const availabilityRequest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.fox.instances.getVersions(),
      window.fox.java.detect(),
    ]).then(([versionList, javaList]) => {
      if (cancelled) return;
      const sorted = versionList.sort(RELEASES_FIRST);
      setVersions(sorted);
      setVersion(sorted.find((item) => item.type === 'release')?.id ?? sorted[0]?.id ?? '');
      setJavaInstallations(javaList);
    }).catch((error) => toast('error', String(error), 'errors')).finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [toast]);

  useEffect(() => {
    const requestId = ++availabilityRequest.current;
    setAvailability(null);
    setCompatibilityError(null);
    setCompatibilityLoading(Boolean(version));
    setLoaderVersion('');

    if (!version) {
      setCompatibilityLoading(false);
      return;
    }

    void window.fox.instances.getLoaderAvailability(version).then((map) => {
      if (requestId !== availabilityRequest.current) return;
      setAvailability(map);
      const failed = Object.values(map).filter((item) => item.status === 'error');
      if (failed.length > 0) {
        setCompatibilityError(`Could not verify ${failed.map((item) => item.loader).join(', ')}. Check your connection and retry.`);
      }
      setLoader((current) => {
        if (current === 'vanilla' || map[current].status === 'available') return current;
        return map[current].status === 'unsupported' ? 'vanilla' : current;
      });
    }).catch((error) => {
      if (requestId !== availabilityRequest.current) return;
      setCompatibilityError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      if (requestId === availabilityRequest.current) setCompatibilityLoading(false);
    });
  }, [version, retryKey]);

  const selected = loader === 'vanilla' ? null : availability?.[loader] ?? null;
  const loaderVersions = selected?.status === 'available' ? selected.versions : [];
  const loaderReady = loader === 'vanilla' || (
    !compatibilityLoading && selected?.status === 'available' && loaderVersions.includes(loaderVersion)
  );

  useEffect(() => {
    if (loader === 'vanilla') {
      setLoaderVersion('');
      return;
    }
    if (selected?.status !== 'available' || selected.versions.length === 0) {
      setLoaderVersion('');
      return;
    }
    setLoaderVersion((current) => current && selected.versions.includes(current)
      ? current
      : selected.versions[0]);
  }, [loader, selected]);

  async function create() {
    if (!name.trim() || !version) {
      toast('error', 'A name and Minecraft version are required', 'errors');
      return;
    }
    if (!loaderReady) {
      toast('error', 'The selected loader is not available for this Minecraft version', 'errors');
      return;
    }
    setSubmitting(true);
    try {
      const created = await window.fox.instances.create({
        name: name.trim(),
        minecraftVersion: version,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion,
        memoryMb: memory,
        javaPath: javaPath || undefined,
        icon,
      });
      await refreshInstances();
      toast('success', `${created.name} created`);
      onClose();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setSubmitting(false);
    }
  }

  function optionLabel(id: ModLoader, label: string): string {
    if (id === 'vanilla') return label;
    const item = availability?.[id];
    if (compatibilityLoading || !item) return `${label} — checking…`;
    if (item.status === 'unsupported') return `${label} — unavailable`;
    if (item.status === 'error') return `${label} — check failed`;
    return `${label} (${item.versions.length})`;
  }

  function optionDisabled(id: ModLoader): boolean {
    if (id === 'vanilla') return false;
    if (compatibilityLoading || !availability) return true;
    return availability[id].status !== 'available';
  }

  return (
    <Modal
      title="Create a new instance"
      subtitle="Each instance has its own mods, saves, settings and game directory."
      onClose={onClose}
      width={640}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button
          onClick={() => void create()}
          loading={submitting}
          disabled={loading || !loaderReady || !name.trim()}
          icon={<Plus size={16} />}
        >
          Create instance
        </Button>
      </>}
    >
      {loading ? (
        <div className="center-pad"><Spinner /></div>
      ) : (
        <div className="form-grid">
          <Field label="Instance name" hint="Type straight away — the default name is selected for you.">
            <input
              autoFocus
              value={name}
              maxLength={64}
              placeholder="My Adventure"
              onChange={(event) => setName(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>

          <div className="form-row">
            <Field label="Minecraft version">
              <select value={version} onChange={(event) => setVersion(event.target.value)}>
                {versions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} {item.type === 'release' ? '' : `(${item.type})`}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Mod loader"
              hint={compatibilityLoading
                ? 'Checking which loaders support this Minecraft version…'
                : compatibilityError
                  ? <span>{compatibilityError} <button className="link-button" onClick={() => setRetryKey((key) => key + 1)}>Retry</button></span>
                  : 'Only loaders with compatible builds for this version can be selected.'}
            >
              <select value={loader} onChange={(event) => setLoader(event.target.value as ModLoader)}>
                {LOADERS.map((item) => (
                  <option key={item.id} value={item.id} disabled={optionDisabled(item.id)}>
                    {optionLabel(item.id, item.label)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {loader !== 'vanilla' && (
            <Field
              label={`${loader} version`}
              hint={selected?.status === 'unsupported'
                ? `No compatible ${loader} build exists for Minecraft ${version}.`
                : selected?.status === 'error'
                  ? selected.message ?? 'Compatibility check failed.'
                  : 'The loader is installed automatically on first launch.'}
            >
              <select
                value={loaderVersion}
                disabled={compatibilityLoading || loaderVersions.length === 0}
                onChange={(event) => setLoaderVersion(event.target.value)}
              >
                {loaderVersions.length === 0 && (
                  <option value="">{compatibilityLoading ? 'Checking compatibility…' : 'No compatible version found'}</option>
                )}
                {loaderVersions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </Field>
          )}

          <div className="form-row">
            <Field label={`Memory allocation — ${memory} MB`}>
              <input type="range" min={1024} max={16384} step={512} value={memory}
                onChange={(event) => setMemory(Number(event.target.value))} />
            </Field>
            <Field label="Java executable">
              <select value={javaPath} onChange={(event) => setJavaPath(event.target.value)}>
                <option value="">Use launcher default</option>
                {javaInstallations.map((java) => (
                  <option key={java.path} value={java.path}>Java {java.major} — {java.path}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Instance icon (optional)">
            <div className="icon-picker">
              <button
                className="icon-picker-preview"
                onClick={async () => {
                  const data = await window.fox.app.selectImage();
                  if (data) setIcon(data);
                }}
              >
                {icon ? <img src={icon} alt="Instance icon" /> : <ImagePlus size={22} />}
              </button>
              <span>PNG or JPG, shown as the instance cover.</span>
              {icon && <button className="link-button" onClick={() => setIcon(undefined)}>Remove</button>}
            </div>
          </Field>
        </div>
      )}
    </Modal>
  );
}
