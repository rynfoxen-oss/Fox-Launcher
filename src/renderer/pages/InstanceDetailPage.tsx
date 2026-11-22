import { useEffect, useState } from 'react';
import {
  Boxes,
  FolderOpen,
  ImagePlus,
  Play,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import type { JavaInstallation, ResourceItem } from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { launch } from '../components/InstanceCard';
import { Button, ConfirmModal, EmptyState, Field, Segmented, Spinner, Toggle } from '../components/Common';

type Tab = 'general' | 'content' | 'logs';

export function InstanceDetailPage() {
  const { instances, selectedInstanceId, refreshInstances, toast, navigate, logs } = useApp();
  const t = useT();
  const instance = instances.find((item) => item.id === selectedInstanceId);
  const [tab, setTab] = useState<Tab>('general');
  const [draft, setDraft] = useState(instance ? { ...instance } : null);
  const [java, setJava] = useState<JavaInstallation[]>([]);
  const [content, setContent] = useState<ResourceItem[]>([]);
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setDraft(instance ? { ...instance } : null);
  }, [instance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void window.fox.java.detect().then(setJava).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (tab !== 'content' || !instance) return;
    setLoadingContent(true);
    void window.fox.mods.getContent(instance.id).then(setContent)
      .catch((error) => toast('error', String(error), 'errors'))
      .finally(() => setLoadingContent(false));
  }, [tab, instance?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!instance || !draft) {
    return <EmptyState icon={<Boxes size={30} />} title="Instance not found" description="Choose an instance from the list." action={<Button onClick={() => navigate('instances')}>Back to instances</Button>} />;
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await window.fox.instances.update(instance!.id, {
        name: draft.name,
        memoryMb: draft.memoryMb,
        javaPath: draft.javaPath,
        jvmArgs: draft.jvmArgs,
        resolution: draft.resolution,
        fullscreen: draft.fullscreen,
        favorite: draft.favorite,
      });
      await refreshInstances();
      toast('success', 'Instance settings saved');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setSaving(false);
    }
  }

  async function deleteInstance() {
    if (!instance) return;
    setDeleting(true);
    try {
      await window.fox.instances.remove(instance.id, true);
      await refreshInstances();
      toast('success', `${instance.name} removed; game files kept`);
      setDeleteOpen(false);
      navigate('instances');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setDeleting(false);
    }
  }

  async function toggleContent(item: ResourceItem) {
    try {
      await window.fox.mods.toggleContent(instance!.id, item.fileName, item.type);
      setContent(await window.fox.mods.getContent(instance!.id));
      toast('success', `${item.enabled ? 'Disabled' : 'Enabled'} ${item.name}`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    }
  }

  async function pickIcon() {
    const dataUrl = await window.fox.app.selectImage();
    if (!dataUrl) return;
    await window.fox.instances.setIcon(instance!.id, dataUrl);
    await refreshInstances();
    toast('success', 'Instance icon updated');
  }

  return (
    <div className="page">
      <div className="page-header detail-header">
        <div className="detail-title">
          <button className="instance-icon large" onClick={() => void pickIcon()} title="Change icon">
            {draft.icon ? <img src={draft.icon} alt="" /> : instance.name.charAt(0).toUpperCase()}
            <span className="icon-edit"><ImagePlus size={14} /></span>
          </button>
          <div>
            <h1>{instance.name}</h1>
            <p>{instance.minecraftVersion} · {instance.loader}{instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}</p>
          </div>
        </div>
        <div className="header-actions">
          <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={() => void window.fox.app.openFolder(instance.gameDir)}>{t('openFolder')}</Button>
          <Button icon={<Play size={16} fill="currentColor" />} onClick={() => void launch(instance)}>Play</Button>
        </div>
      </div>

      <div className="tab-bar wide">
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>{t('general')}</button>
        <button className={tab === 'content' ? 'active' : ''} onClick={() => setTab('content')}>{t('content')}</button>
        <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>{t('logs')}</button>
      </div>

      {tab === 'general' && (
        <div className="panel form-panel">
          <div className="form-grid">
            <Field label={t('name')}>
              <input
                value={draft.name}
                maxLength={64}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                onFocus={(event) => event.currentTarget.select()}
              />
            </Field>
            <Field label={t('javaExecutable')}>
              <select value={draft.javaPath ?? ''} onChange={(event) => setDraft({ ...draft, javaPath: event.target.value || undefined })}>
                <option value="">{t('launcherDefault')}</option>
                {java.map((item) => <option key={item.path} value={item.path}>Java {item.major} — {item.path}</option>)}
              </select>
            </Field>
            <Field label={`${t('memoryLabel')} — ${draft.memoryMb} MB`}>
              <input type="range" min={1024} max={16384} step={512} value={draft.memoryMb}
                onChange={(event) => setDraft({ ...draft, memoryMb: Number(event.target.value) })} />
            </Field>
            <div className="form-row">
              <Field label={t('gameWidth')}>
                <input type="number" value={draft.resolution?.width ?? 1280}
                  onChange={(event) => setDraft({ ...draft, resolution: { width: Number(event.target.value), height: draft.resolution?.height ?? 720 } })} />
              </Field>
              <Field label={t('gameHeight')}>
                <input type="number" value={draft.resolution?.height ?? 720}
                  onChange={(event) => setDraft({ ...draft, resolution: { width: draft.resolution?.width ?? 1280, height: Number(event.target.value) } })} />
              </Field>
            </div>
            <Field label={t('jvmArgs')}>
              <textarea rows={3} value={draft.jvmArgs} onChange={(event) => setDraft({ ...draft, jvmArgs: event.target.value })} />
            </Field>
            <Toggle checked={!!draft.fullscreen} label={t('fullscreen')} description={t('fullscreen')}
              onChange={(value) => setDraft({ ...draft, fullscreen: value })} />
            <Toggle checked={draft.favorite} label={t('favorite')} description={t('favorite')}
              onChange={(value) => setDraft({ ...draft, favorite: value })} />
          </div>
          <div className="form-footer">
            <button className="link-button danger" onClick={() => setDeleteOpen(true)}><Trash2 size={14} /> {t('deleteInstance')}</button>
            <Button icon={<Save size={16} />} loading={saving} onClick={() => void save()}>{t('saveChanges')}</Button>
          </div>
        </div>
      )}

      {tab === 'content' && (
        <div className="panel">
          {loadingContent ? <div className="center-pad"><Spinner /></div> : content.length === 0 ? (
            <EmptyState icon={<Upload size={28} />} title={t('noContent')}
              description={t('noContentDescription')} />
          ) : (
            <div className="content-list">
              {content.map((item) => (
                <div key={`${item.type}-${item.fileName}`} className="content-row">
                  <span className={`content-type ${item.type}`}>{item.type}</span>
                  <div className="content-copy"><strong>{item.name}</strong><span>{(item.size / 1024 / 1024).toFixed(1)} MB</span></div>
                  <button className={`btn btn-sm ${item.enabled ? 'btn-subtle' : 'btn-secondary'}`} onClick={() => void toggleContent(item)}>
                    {item.enabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <button className="link-button" onClick={() => void window.fox.app.showItemInFolder(item.path)}>Show file</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="panel">
          <pre className="console tall">{logs.length === 0 ? 'No launch logs recorded yet.' : logs.map((line, index) =>
            <div key={index} className={`log-${line.level}`}>{new Date(line.time).toLocaleTimeString()} {line.text}</div>)}</pre>
        </div>
      )}

      {deleteOpen && (
        <ConfirmModal
          title="Delete instance"
          description={`Delete "${instance.name}" from Fox Launcher? Your saves, mods and config stay on disk.`}
          confirmLabel="Delete instance"
          danger
          busy={deleting}
          onConfirm={() => void deleteInstance()}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}
