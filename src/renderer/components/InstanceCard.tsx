import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Gauge, MoreVertical, Pencil, Play, Settings2, Trash2 } from 'lucide-react';
import type { Instance } from '../../shared/types';
import { useApp } from '../store';
import { ConfirmModal, IconButton, PromptModal } from './Common';

function relativeDate(timestamp: number): string {
  if (!timestamp) return 'Never played';
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes}m played`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m played`;
}

export async function launch(instance: Instance): Promise<void> {
  const { currentAccount, setBusy, toast, refreshInstances, navigate } = useApp.getState();
  if (!currentAccount) {
    toast('info', 'Sign in to an account before launching', 'launch');
    return;
  }
  setBusy(`Preparing ${instance.name}...`);
  try {
    await window.fox.launcher.launch(instance.id);
    navigate('home', instance.id);
    toast('success', `${instance.name} launched`, 'launch');
  } catch (error) {
    toast('error', error instanceof Error ? error.message : String(error), 'errors');
  } finally {
    setBusy(null);
    void refreshInstances();
  }
}

export function InstanceCard({ instance, onOpen }: { instance: Instance; onOpen: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [namePrompt, setNamePrompt] = useState<{ kind: 'rename' | 'clone'; value: string } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [keepFiles, setKeepFiles] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const refreshInstances = useApp((state) => state.refreshInstances);
  const toast = useApp((state) => state.toast);
  const navigate = useApp((state) => state.navigate);

  // Closing on mouseleave made Rename/Clone miss clicks whenever the card's
  // hover lift moved the menu out from under the pointer. Close on an actual
  // outside click instead.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  async function commitName(value: string) {
    const kind = namePrompt?.kind;
    if (!kind) return;
    setNamePrompt(null);
    setAction(kind);
    try {
      if (kind === 'clone') {
        await window.fox.instances.clone(instance.id, value);
        toast('success', `Cloned as ${value}`);
      } else {
        await window.fox.instances.update(instance.id, { name: value });
        toast('success', 'Instance renamed');
      }
      await refreshInstances();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setAction(null);
    }
  }

  async function confirmDelete() {
    setAction('delete');
    try {
      await window.fox.instances.remove(instance.id, keepFiles);
      toast('success', keepFiles ? 'Instance removed from the launcher; files kept' : 'Instance and files deleted');
      await refreshInstances();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setDeleteOpen(false);
      setKeepFiles(true);
      setAction(null);
    }
  }

  async function runAction(kind: 'clone' | 'rename' | 'export' | 'delete' | 'openFolder') {
    setMenuOpen(false);
    if (kind === 'clone') {
      setNamePrompt({ kind, value: `${instance.name} copy` });
      return;
    }
    if (kind === 'rename') {
      setNamePrompt({ kind, value: instance.name });
      return;
    }
    if (kind === 'delete') {
      setDeleteOpen(true);
      return;
    }
    try {
      setAction(kind);
      if (kind === 'export') {
        await window.fox.instances.exportToFile(instance.id);
        toast('success', 'Instance exported');
      } else {
        await window.fox.app.openFolder(instance.gameDir);
      }
      await refreshInstances();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setAction(null);
    }
  }

  return (
    <div className="instance-card" style={instance.background ? { backgroundImage: instance.background } : undefined}>
      <div className="instance-card-top">
        <button className="instance-icon" onClick={onOpen} style={!instance.icon ? undefined : { backgroundImage: `url(${instance.icon})` }}>
          {!instance.icon && <span>{instance.name.charAt(0).toUpperCase()}</span>}
        </button>
        <div className="instance-heading" onClick={onOpen}>
          <div className="instance-heading-line">
            <h3>{instance.name}</h3>
            <button
              type="button"
              className="inline-rename"
              title="Rename instance"
              aria-label="Rename instance"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                setNamePrompt({ kind: 'rename', value: instance.name });
              }}
            >
              <Pencil size={12} />
            </button>
          </div>
          <p>{instance.minecraftVersion} · {instance.loader}</p>
        </div>
        <div className="menu-anchor" ref={menuRef}>
          <IconButton
            type="button"
            aria-label="Instance actions"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            <MoreVertical size={18} />
          </IconButton>
          {menuOpen && (
            <div className="context-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void runAction('openFolder')}><Settings2 size={14} /> Open folder</button>
              <button type="button" role="menuitem" onClick={() => void runAction('rename')}><Pencil size={14} /> Rename</button>
              <button type="button" role="menuitem" onClick={() => void runAction('clone')}><Copy size={14} /> Clone</button>
              <button type="button" role="menuitem" onClick={() => void runAction('export')}><Download size={14} /> Export</button>
              <button type="button" role="menuitem" className="danger" onClick={() => void runAction('delete')}><Trash2 size={14} /> Delete</button>
            </div>
          )}
        </div>
      </div>
      <div className="instance-meta">
        <span>{formatPlaytime(instance.playtimeMinutes)}</span>
        <span>{relativeDate(instance.lastPlayed)}</span>
      </div>
      <div className="instance-card-actions">
        <button className="btn btn-primary btn-sm" onClick={() => void launch(instance)} disabled={!!action}>
          <Play size={14} fill="currentColor" /> Play
        </button>
        <button className="btn btn-subtle btn-sm" onClick={() => navigate('performance', instance.id)} title="Tune FPS and visuals">
          <Gauge size={14} /> Optimize
        </button>
        <button className="btn btn-subtle btn-sm" onClick={() => navigate('instance', instance.id)}>
          Manage
        </button>
      </div>

      {namePrompt && (
        <PromptModal
          title={namePrompt.kind === 'rename' ? 'Rename instance' : 'Clone instance'}
          subtitle={namePrompt.kind === 'rename'
            ? 'The name is used in the launcher and as the default folder name.'
            : 'A new instance is created with its own saves, mods and config.'}
          label={namePrompt.kind === 'rename' ? 'Instance name' : 'Name for the clone'}
          initialValue={namePrompt.value}
          confirmLabel={namePrompt.kind === 'rename' ? 'Rename' : 'Clone'}
          busy={!!action}
          onConfirm={(value) => void commitName(value)}
          onClose={() => setNamePrompt(null)}
        />
      )}
      {deleteOpen && (
        <ConfirmModal
          title="Delete instance"
          description={`Delete "${instance.name}" from Fox Launcher? This cannot be undone.`}
          confirmLabel="Delete instance"
          danger
          busy={action === 'delete'}
          onConfirm={() => void confirmDelete()}
          onClose={() => setDeleteOpen(false)}
        >
          <label className="confirm-checkbox">
            <input type="checkbox" checked={keepFiles} onChange={(event) => setKeepFiles(event.target.checked)} />
            Keep game files on disk (saves, mods, config)
          </label>
          <p className="confirm-note">Leave this checked to remove only the launcher entry.</p>
        </ConfirmModal>
      )}
    </div>
  );
}
