import { useEffect, useMemo, useState } from 'react';
import { Download, Plus, Search, Star } from 'lucide-react';
import { useApp } from '../store';
import { useT } from '../i18n';
import { InstanceCard } from '../components/InstanceCard';
import { CreateInstanceModal } from '../components/CreateInstanceModal';
import { Button, EmptyState, Segmented } from '../components/Common';

type SortMode = 'recent' | 'name' | 'playtime';

export function InstancesPage() {
  const { instances, refreshInstances, toast } = useApp();
  const focusTarget = useApp((state) => state.focusTarget);
  const t = useT();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (focusTarget === 'create') {
      setCreating(true);
      useApp.setState({ focusTarget: null });
    }
  }, [focusTarget]);

  const visible = useMemo(() => {
    const filtered = instances.filter((item) =>
      item.name.toLowerCase().includes(query.toLowerCase()) ||
      item.minecraftVersion.includes(query));
    return filtered.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'playtime') return b.playtimeMinutes - a.playtimeMinutes;
      return Number(b.favorite) - Number(a.favorite) || b.lastPlayed - a.lastPlayed;
    });
  }, [instances, query, sort]);

  async function importInstance() {
    try {
      const created = await window.fox.instances.importFromFile();
      if (created) {
        await refreshInstances();
        toast('success', `${created.name} imported`);
      }
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div><h1>{t('instances')}</h1><p>{t('instancesDescription')}</p></div>
        <div className="header-actions">
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => void importInstance()}>{t('import')}</Button>
          <Button icon={<Plus size={17} />} onClick={() => setCreating(true)}>{t('newInstance')}</Button>
        </div>
      </div>

      <div className="toolbar">
        <div className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('searchInstances')} /></div>
        <Segmented value={sort} onChange={setSort} options={[
          { value: 'recent', label: t('recent') },
          { value: 'name', label: t('name') },
          { value: 'playtime', label: t('playtime') },
        ]} />
        <span className="toolbar-count">{visible.length} instance{visible.length === 1 ? '' : 's'}</span>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<Star size={30} />} title={query ? t('noResults') : t('noInstancesYet')}
          description={query ? t('noResultsDescription') : t('noInstancesDescription')}
          action={!query && <Button icon={<Plus size={16} />} onClick={() => setCreating(true)}>{t('createInstance')}</Button>} />
      ) : (
        <div className="instance-grid stagger-in">
          {visible.map((instance) => <InstanceCard key={instance.id} instance={instance} onOpen={() => useApp.getState().navigate('instance', instance.id)} />)}
        </div>
      )}

      {creating && <CreateInstanceModal onClose={() => setCreating(false)} />}
    </div>
  );
}
