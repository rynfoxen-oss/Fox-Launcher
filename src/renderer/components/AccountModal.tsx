import { useState } from 'react';
import { Check, Plus, Trash2, UserPlus, UserRound, Users } from 'lucide-react';
import type { Account } from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Field, Modal } from './Common';

type Mode = 'offline' | 'accounts';

export function AccountModal({ onClose }: { onClose: () => void }) {
  const { accounts, currentAccount, refreshAccounts, toast } = useApp();
  const t = useT();
  const [mode, setMode] = useState<Mode>(accounts.length ? 'accounts' : 'offline');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function addOffline() {
    if (!username.trim()) {
      toast('error', t('enterUsername'), 'errors');
      return;
    }
    setSubmitting(true);
    try {
      await window.fox.accounts.addOffline(username.trim());
      await refreshAccounts();
      toast('success', t('offlineAdded'));
      onClose();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : String(error), 'errors');
    } finally {
      setSubmitting(false);
    }
  }

  async function selectAccount(account: Account) {
    await window.fox.accounts.select(account.id);
    await refreshAccounts();
    toast('info', `${t('switchedTo')} ${account.name}`);
  }

  async function removeAccount(account: Account) {
    if (!window.confirm(`${t('removeAccountConfirm')} ${account.name}?`)) return;
    await window.fox.accounts.remove(account.id);
    await refreshAccounts();
    if (currentAccount?.id === account.id) setMode('accounts');
  }

  const accountStatus = (account: Account) => {
    if (account.type === 'offline') return t('offlineProfile');
    return t('microsoftProfile');
  };

  return (
    <Modal title={t('signInTitle')} subtitle={t('signInSubtitle')} onClose={onClose} width={820} className="account-manager">
      <div className="account-manager-layout">
        <aside className="account-sidebar">
          <div className="account-sidebar-label">{t('savedAccounts')}</div>
          <div className="account-sidebar-list">
            {accounts.length === 0 && <p className="account-sidebar-empty">{t('noAccountsYet')}</p>}
            {accounts.map((account) => (
              <button
                key={account.id}
                className={`account-sidebar-row ${currentAccount?.id === account.id ? 'active' : ''}`}
                onClick={() => void selectAccount(account)}
              >
                <span className="avatar-small">{account.name.charAt(0).toUpperCase()}</span>
                <span className="account-sidebar-copy">
                  <strong className="ellipsis">{account.name}</strong>
                  <small>{accountStatus(account)}</small>
                </span>
                {currentAccount?.id === account.id && <Check size={14} />}
              </button>
            ))}
          </div>
          <button className="account-add-button" onClick={() => setMode('offline')}>
            <Plus size={15} /> {t('addAccount')}
          </button>
        </aside>

        <div className="account-main">
          <div className="account-tabs">
            <button className={mode === 'accounts' ? 'active' : ''} onClick={() => setMode('accounts')}>
              <Users size={15} /> {t('savedAccounts')}
            </button>
            <button className={mode === 'offline' ? 'active' : ''} onClick={() => setMode('offline')}>
              <UserRound size={15} /> {t('offlineAccount')}
            </button>
          </div>

          {mode === 'accounts' && (
            <div className="stack">
              {accounts.length === 0 ? (
                <div className="account-empty">
                  <div className="account-empty-icon"><UserRound size={28} /></div>
                  <h3>{t('noAccountsYet')}</h3>
                  <p>{t('noAccountsDescription')}</p>
                  <div className="account-empty-actions">
                    <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => setMode('offline')}>
                      {t('offlineAccount')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="account-detail-list">
                  {accounts.map((account) => (
                    <div key={account.id} className={`account-detail-card ${currentAccount?.id === account.id ? 'active' : ''}`}>
                      <span className="avatar-large">{account.name.charAt(0).toUpperCase()}</span>
                      <div className="account-detail-copy">
                        <strong>{account.name}</strong>
                        <span>{accountStatus(account)}</span>
                        <small>Local profile</small>
                      </div>
                      <div className="account-detail-actions">
                        {currentAccount?.id === account.id ? (
                          <span className="active-chip"><Check size={12} /> {t('active')}</span>
                        ) : (
                          <Button size="sm" variant="secondary" onClick={() => void selectAccount(account)}>{t('useAccount')}</Button>
                        )}
                        <button className="icon-btn danger" onClick={() => void removeAccount(account)} title={t('removeAccount')}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {mode === 'offline' && (
            <div className="stack account-form">
              <div className="account-form-heading">
                <div className="account-form-icon"><UserPlus size={20} /></div>
                <div>
                  <h3>{t('offlineAccount')}</h3>
                  <p>{t('offlineHint')}</p>
                </div>
              </div>
              <Field label={t('username')} hint={t('usernameHint')}>
                <input
                  value={username}
                  maxLength={16}
                  onChange={(event) => setUsername(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void addOffline()}
                  placeholder="Steve"
                  autoFocus
                />
              </Field>
              <Button onClick={() => void addOffline()} loading={submitting} icon={<UserPlus size={16} />}>
                {t('addOfflineAccount')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
