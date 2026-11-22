import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  Boxes,
  CornerDownLeft,
  FolderOpen,
  Gauge,
  Home,
  Play,
  Plus,
  Rocket,
  Search,
  Settings2,
  Shirt,
  Wrench,
  X,
} from 'lucide-react';
import { useApp, type Page } from '../store';
import { boostInstance } from '../boost';
import { launch } from './InstanceCard';

interface Command {
  id: string;
  label: string;
  detail: string;
  keywords: string;
  icon: ReactNode;
  run: () => void | Promise<void>;
}

const PAGES: Array<{ page: Page; label: string; detail: string; icon: ReactNode }> = [
  { page: 'home', label: 'Home', detail: 'Your launcher dashboard', icon: <Home size={16} /> },
  { page: 'instances', label: 'Instances', detail: 'Manage Minecraft profiles', icon: <Boxes size={16} /> },
  { page: 'mods', label: 'Mods', detail: 'Discover Modrinth content', icon: <Wrench size={16} /> },
  { page: 'skins', label: 'Skins', detail: 'Skins and offline profiles', icon: <Shirt size={16} /> },
  { page: 'performance', label: 'Performance', detail: 'FPS presets and Java tuning', icon: <Gauge size={16} /> },
  { page: 'settings', label: 'Settings', detail: 'Themes, language and behavior', icon: <Settings2 size={16} /> },
];

export function CommandPalette() {
  const open = useApp((state) => state.paletteOpen);
  const setOpen = useApp((state) => state.setPaletteOpen);
  const instances = useApp((state) => state.instances);
  const navigate = useApp((state) => state.navigate);
  const toast = useApp((state) => state.toast);
  const refreshInstances = useApp((state) => state.refreshInstances);
  const launchState = useApp((state) => state.launchState);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const gameBusy = launchState.status === 'preparing' || launchState.status === 'launching' || launchState.status === 'running';

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = PAGES.map((item) => ({
      id: `page-${item.page}`,
      label: `Go to ${item.label}`,
      detail: item.detail,
      keywords: `${item.label} page navigate ${item.detail}`,
      icon: item.icon,
      run: () => navigate(item.page),
    }));

    list.push({
      id: 'create-instance',
      label: 'Create a new instance',
      detail: 'Start a fresh Minecraft profile',
      keywords: 'create new instance add profile minecraft',
      icon: <Plus size={16} />,
      run: () => navigate('instances', undefined, { focus: 'create' }),
    });

    for (const instance of instances) {
      list.push({
        id: `launch-${instance.id}`,
        label: `Launch ${instance.name}`,
        detail: `${instance.minecraftVersion} · ${instance.loader}`,
        keywords: `play launch ${instance.name} ${instance.minecraftVersion} ${instance.loader}`,
        icon: <Play size={16} />,
        run: () => { if (!gameBusy) void launch(instance); },
      });
      list.push({
        id: `boost-${instance.id}`,
        label: `One-click FPS boost · ${instance.name}`,
        detail: 'Apply Ultra FPS and install optimizers',
        keywords: `boost fps optimize performance ${instance.name}`,
        icon: <Rocket size={16} />,
        run: async () => {
          if (gameBusy) return;
          const result = await boostInstance(instance);
          await refreshInstances();
          toast('success', result.note);
        },
      });
      list.push({
        id: `folder-${instance.id}`,
        label: `Open game folder · ${instance.name}`,
        detail: instance.gameDir,
        keywords: `open folder files mods saves ${instance.name}`,
        icon: <FolderOpen size={16} />,
        run: () => void window.fox.app.openFolder(instance.gameDir),
      });
      list.push({
        id: `tune-${instance.id}`,
        label: `Tune ${instance.name}`,
        detail: 'Open graphics and Java settings',
        keywords: `settings performance graphics ${instance.name}`,
        icon: <Gauge size={16} />,
        run: () => navigate('performance', instance.id),
      });
    }
    return list;
  }, [instances, navigate, refreshInstances, toast, gameBusy]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands.slice(0, 12);
    return commands
      .filter((command) => `${command.label} ${command.detail} ${command.keywords}`.toLowerCase().includes(term))
      .slice(0, 12);
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  async function runCommand(command: Command | undefined) {
    if (!command) return;
    setOpen(false);
    try {
      await command.run();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % Math.max(1, filtered.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      void runCommand(filtered[active]);
    }
  }

  return createPortal(
    <div className="modal-backdrop command-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setOpen(false);
    }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Quick actions">
        <div className="command-input-row">
          <Search size={19} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search pages, instances, or type a command…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <button className="icon-btn" onClick={() => setOpen(false)} title="Close"><X size={16} /></button>
        </div>
        <div className="command-results">
          {filtered.length === 0 && <div className="command-empty">No matching actions. Try “launch”, “boost”, or an instance name.</div>}
          {filtered.map((command, index) => (
            <button
              key={command.id}
              className={`command-row ${index === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => void runCommand(command)}
            >
              <span className="command-icon">{command.icon}</span>
              <span className="command-copy">
                <strong>{command.label}</strong>
                <span>{command.detail}</span>
              </span>
              {index === active && <CornerDownLeft size={14} className="command-enter" />}
            </button>
          ))}
        </div>
        <div className="command-footer">
          <span><ArrowUp size={12} /><ArrowDown size={12} /> navigate</span>
          <span><CornerDownLeft size={12} /> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
