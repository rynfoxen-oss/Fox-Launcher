import { useEffect } from 'react';
import { useApp, type Page } from './store';
import { Sidebar, Titlebar, UpdateBanner } from './components/Chrome';
import { CommandPalette } from './components/CommandPalette';
import { HomePage } from './pages/HomePage';
import { InstancesPage } from './pages/InstancesPage';
import { InstanceDetailPage } from './pages/InstanceDetailPage';
import { ModsPage } from './pages/ModsPage';
import { PartyPage } from './pages/PartyPage';
import { FriendsPage } from './pages/FriendsPage';
import { SkinsPage } from './pages/SkinsPage';
import { PerformancePage } from './pages/PerformancePage';
import { SettingsPage } from './pages/SettingsPage';
import { applyAppearance, IS_MAC } from './theme';

const SHORTCUT_PAGES: Page[] = ['home', 'instances', 'mods', 'party', 'friends', 'skins', 'performance', 'settings'];

// macOS keeps the same scenes but with fewer simultaneously animated nodes.
const COMET_COUNT = IS_MAC ? 3 : 6;
const STAR_COUNT = IS_MAC ? 6 : 12;
const EFFECT_PARTICLE_COUNT = IS_MAC ? 8 : 14;

function useTheme() {
  // Subscribe to appearance only so unrelated setting changes never restyle
  // the whole window (and repaint every animated layer).
  const appearance = useApp((state) => state.settings.appearance);
  useEffect(() => {
    applyAppearance(document.documentElement, appearance);
  }, [appearance]);
}

function useShortcuts() {
  const setPaletteOpen = useApp((state) => state.setPaletteOpen);
  const navigate = useApp((state) => state.navigate);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!useApp.getState().paletteOpen);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const index = Number(event.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < SHORTCUT_PAGES.length) {
          event.preventDefault();
          navigate(SHORTCUT_PAGES[index]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, setPaletteOpen]);
}

export default function App() {
  const ready = useApp((state) => state.ready);
  const page = useApp((state) => state.page);
  const init = useApp((state) => state.init);
  useTheme();
  useShortcuts();

  useEffect(() => {
    void init();
  }, [init]);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-mark">F</div>
        <h1>Fox Launcher</h1>
        <div className="splash-bar"><span /></div>
        <p>Loading your launcher…</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="ambient-orbs" aria-hidden="true">
        <span className="orb orb-one" />
        <span className="orb orb-two" />
        <span className="orb orb-three" />
        <span className="aurora-ribbon ribbon-one" />
        <span className="aurora-ribbon ribbon-two" />
        <span className="aurora-beam beam-one" />
        <span className="aurora-beam beam-two" />
        <span className="ambient-pulse pulse-one" />
        <span className="ambient-pulse pulse-two" />
        <span className="ambient-comets">
          {Array.from({ length: COMET_COUNT }, (_, index) => (
            <i key={index} className={`comet comet-${index + 1}`} />
          ))}
        </span>
        <span className="ambient-scan" />
        <span className="theme-grid" />
        <span className="ambient-starfield">
          {Array.from({ length: STAR_COUNT }, (_, index) => (
            <i key={index} className={`ambient-star star-${index + 1}`} />
          ))}
        </span>
        <span className="ambient-vignette" />
        <div className="theme-effect" aria-hidden="true">
          {Array.from({ length: EFFECT_PARTICLE_COUNT }, (_, index) => (
            <span key={index} className={`effect-particle effect-${index + 1}`} />
          ))}
        </div>
      </div>
      <Titlebar />
      <UpdateBanner />
      <div className="app-body">
        <Sidebar />
        <main className="main-content">
          {page === 'home' && <HomePage />}
          {page === 'instances' && <InstancesPage />}
          {page === 'instance' && <InstanceDetailPage />}
          {page === 'mods' && <ModsPage />}
          {page === 'party' && <PartyPage />}
          {page === 'friends' && <FriendsPage />}
          {page === 'skins' && <SkinsPage />}
          {page === 'performance' && <PerformancePage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
