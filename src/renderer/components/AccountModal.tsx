import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, LogIn, Mail, Plus, RefreshCw, Trash2, UserPlus, UserRound, Users } from 'lucide-react';
import type { Account } from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { Button, Field, Modal } from './Common';

type Mode = 'offline' | 'accounts' | 'microsoft' | 'email';
type EmailAction = 'signup' | 'login';

interface DeviceLogin {
  verificationUri: string;
  userCode: string;
  sessionId: string;
}

export function AccountModal({ onClose }: { onClose: () => void }) {
  const accounts = useApp((state) => state.accounts);
  const currentAccount = useApp((state) => state.currentAccount);
  const refreshAccounts = useApp((state) => state.refreshAccounts);
  const toast = useApp((state) => state.toast);
  const t = useT();
  const [mode, setMode] = useState<Mode>(accounts.length ? 'accounts' : 'offline');
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deviceLogin, setDeviceLogin] = useState<DeviceLogin | null>(null);
  const [deviceStatus, setDeviceStatus] = useState('');
  const [deviceError, setDeviceError] = useState('');
  const [copied, setCopied] = useState(false);
  const [emailAction, setEmailAction] = useState<EmailAction>('signup');
  const [emailName, setEmailName] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailStatus, setEmailStatus] = useState('');

  async function submitEmail() {
    if (!emailAddress.trim() || emailPassword.length < 8 || (emailAction === 'signup' && !emailName.trim())) {
      setEmailStatus(t('foxIdFieldsRequired'));
      return;
    }
    setSubmitting(true);
    setEmailStatus('');
    try {
      const account = emailAction === 'signup'
        ? await window.fox.accounts.signupEmail(emailName.trim(), emailAddress.trim(), emailPassword)
        : await window.fox.accounts.loginEmail(emailAddress.trim(), emailPassword);
      await refreshAccounts();
      setEmailStatus(emailAction === 'signup' ? t('foxIdCreated') : `${t('foxIdLoggedIn')} ${account.name}`);
      setEmailPassword('');
      setMode('accounts');
    } catch (error) {
      setEmailStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

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

  async function startMicrosoftLogin() {
    setSubmitting(true);
    setDeviceError('');
    setDeviceStatus('');
    setCopied(false);
    try {
      const login = await window.fox.accounts.loginMicrosoft();
      setDeviceLogin(login);
      setDeviceStatus(t('waitingForSignIn'));
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (!deviceLogin) return;
    let cancelled = false;
    let timer: number | undefined;
    let inFlight = false;

    const poll = async (): Promise<void> => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const result = await window.fox.accounts.pollMicrosoft(deviceLogin.sessionId);
        if (cancelled) return;
        if ('pending' in result) {
          timer = window.setTimeout(() => void poll(), 1200);
          return;
        }
        await refreshAccounts();
        setDeviceStatus(`${t('switchedTo')} ${result.name}`);
        setDeviceLogin(null);
        setMode('accounts');
      } catch (error) {
        if (cancelled) return;
        setDeviceError(error instanceof Error ? error.message : String(error));
        setDeviceLogin(null);
      } finally {
        inFlight = false;
      }
    };

    timer = window.setTimeout(() => void poll(), 1200);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // `t` changes on language switch only; the session ID is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceLogin?.sessionId, refreshAccounts]);

  async function copyDeviceCode() {
    if (!deviceLogin) return;
    try {
      await window.fox.app.copyText(deviceLogin.userCode);
      setCopied(true);
    } catch {
      setDeviceError(t('copyFailed'));
    }
  }

  const accountStatus = (account: Account) => {
    if (account.type === 'microsoft') return `${t('microsoftProfile')}${account.email ? ` · ${account.email}` : ''}`;
    if (account.email) return `${t('foxId')} · ${account.email}`;
    return `${t('offlineProfile')} · ${t('partyLocked')}`;
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
            <button className={mode === 'microsoft' ? 'active' : ''} onClick={() => setMode('microsoft')}>
              <LogIn size={15} /> {t('microsoft')}
            </button>
            <button className={mode === 'email' ? 'active' : ''} onClick={() => setMode('email')}>
              <Mail size={15} /> {t('foxId')}
            </button>
          </div>

          {mode === 'accounts' && (
            <div className="stack">
              {emailStatus && <p className="status-description">{emailStatus}</p>}
              {accounts.length === 0 ? (
                <div className="account-empty">
                  <div className="account-empty-icon"><UserRound size={28} /></div>
                  <h3>{t('noAccountsYet')}</h3>
                  <p>{t('noAccountsDescription')}</p>
                  <div className="account-empty-actions">
                    <Button variant="secondary" icon={<LogIn size={16} />} onClick={() => setMode('microsoft')}>
                      {t('signInWithMicrosoft')}
                    </Button>
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
                        <small>{account.type === 'microsoft' || account.email ? t('partyReady') : t('partyLocked')}</small>
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

          {mode === 'email' && (
            <div className="stack account-form">
              <div className="account-form-heading">
                <div className="account-form-icon"><Mail size={20} /></div>
                <div>
                  <h3>{t('foxId')}</h3>
                  <p>{t('foxIdHint')}</p>
                </div>
              </div>
              <div className="party-action-row">
                <button className={`chip-button ${emailAction === 'signup' ? 'active' : ''}`} onClick={() => { setEmailAction('signup'); setEmailStatus(''); }}>
                  <UserPlus size={14} /> {t('signUp')}
                </button>
                <button className={`chip-button ${emailAction === 'login' ? 'active' : ''}`} onClick={() => { setEmailAction('login'); setEmailStatus(''); }}>
                  <KeyRound size={14} /> {t('logIn')}
                </button>
              </div>
              {emailAction === 'signup' && (
                <Field label={t('username')} hint={t('usernameHint')}>
                  <input
                    value={emailName}
                    maxLength={16}
                    onChange={(event) => setEmailName(event.target.value)}
                    placeholder="IceFox"
                    autoFocus
                  />
                </Field>
              )}
              <Field label={t('email')}>
                <input
                  type="email"
                  value={emailAddress}
                  onChange={(event) => setEmailAddress(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void submitEmail()}
                  placeholder="player@example.com"
                  autoFocus={emailAction === 'login'}
                />
              </Field>
              <Field label={t('password')}>
                <input
                  type="password"
                  value={emailPassword}
                  onChange={(event) => setEmailPassword(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void submitEmail()}
                  placeholder="At least 8 characters"
                />
              </Field>
              {emailStatus && <p className="status-description">{emailStatus}</p>}
              <Button onClick={() => void submitEmail()} loading={submitting} icon={<Mail size={16} />}>
                {emailAction === 'signup' ? t('signUp') : t('logIn')}
              </Button>
            </div>
          )}

          {mode === 'microsoft' && (
            <div className="stack account-form">
              <div className="account-form-heading">
                <div className="account-form-icon microsoft"><LogIn size={20} /></div>
                <div>
                  <h3>{t('microsoftSignIn')}</h3>
                  <p>{t('microsoftHint')}</p>
                </div>
              </div>
              {!deviceLogin ? (
                <>
                  <div className="signin-steps">
                    <div><span>1</span><p>{t('deviceStepOne')}</p></div>
                    <div><span>2</span><p>{t('deviceStepTwo')}</p></div>
                    <div><span>3</span><p>{t('deviceStepThree')}</p></div>
                  </div>
                  <Button loading={submitting} icon={<LogIn size={16} />} onClick={() => void startMicrosoftLogin()}>
                    {t('signInWithMicrosoft')}
                  </Button>
                </>
              ) : (
                <div className="device-code">
                  <div className="device-step-pill"><span>2</span>{t('deviceStepTwo')}</div>
                  <button className="code-box" title={t('copyCode')} onClick={() => void copyDeviceCode()}>
                    {deviceLogin.userCode}
                  </button>
                  <div className="device-code-actions">
                    <Button size="sm" variant="secondary" icon={<ExternalLink size={14} />} onClick={() => void window.fox.app.openExternal(deviceLogin.verificationUri)}>
                      {t('openVerificationPage')}
                    </Button>
                    <Button size="sm" variant="subtle" icon={<Copy size={14} />} onClick={() => void copyDeviceCode()}>
                      {copied ? t('copied') : t('copyCode')}
                    </Button>
                    <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} loading={submitting} onClick={() => void startMicrosoftLogin()}>
                      {t('restartSignIn')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setDeviceLogin(null); setDeviceError(''); }}>
                      {t('cancelSignIn')}
                    </Button>
                  </div>
                  <div className="device-waiting"><span className="spinner" style={{ width: 12, height: 12 }} /> {t('waitingForSignIn')}</div>
                </div>
              )}
              {deviceStatus && <p className="status-description" role="status">{deviceStatus}</p>}
              {deviceError && <p className="status-description error" role="alert">{deviceError}</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
