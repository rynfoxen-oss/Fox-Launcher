import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Check,
  Copy,
  Crown,
  Gamepad2,
  Globe2,
  KeyRound,
  LogOut,
  Mail,
  MessageCircle,
  Play,
  Power,
  Send,
  Server,
  UserPlus,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type {
  Party,
  PartyChatState,
  PartyChatUpdate,
  PartyJoinResult,
  PartyMember,
  PartyMessage,
} from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { AccountModal } from '../components/AccountModal';
import { SkinPreview } from '../components/SkinPreview';
import { Button, Field } from '../components/Common';

const OFFLINE_CHAT: PartyChatState = { status: 'offline', message: 'Join a party to open chat.' };

export function PartyPage() {
  const currentAccount = useApp((state) => state.currentAccount);
  const instances = useApp((state) => state.instances);
  const selectedInstanceId = useApp((state) => state.selectedInstanceId);
  const launchState = useApp((state) => state.launchState);
  const navigate = useApp((state) => state.navigate);
  const refreshInstances = useApp((state) => state.refreshInstances);
  const t = useT();

  const [party, setParty] = useState<Party | null>(null);
  const [result, setResult] = useState<PartyJoinResult | null>(null);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedRemote, setCopiedRemote] = useState(false);

  const [partyName, setPartyName] = useState('');
  const [serverHost, setServerHost] = useState('');
  const [serverPort, setServerPort] = useState('');
  const [createInstanceId, setCreateInstanceId] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinInstanceId, setJoinInstanceId] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [remoteAddressInput, setRemoteAddressInput] = useState('');

  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [stoppingServer, setStoppingServer] = useState(false);
  const [autoServer, setAutoServer] = useState(true);

  const [chat, setChat] = useState<PartyChatState>(OFFLINE_CHAT);
  const [messages, setMessages] = useState<PartyMessage[]>([]);
  const [chatMembers, setChatMembers] = useState<PartyMember[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);

  const hasAccess = currentAccount?.type === 'microsoft' || Boolean(currentAccount?.email);
  const gameBusy = launchState.status === 'preparing' || launchState.status === 'launching' || launchState.status === 'running';
  const serverAddress = party ? `${party.serverHost}${party.serverPort ? `:${party.serverPort}` : ''}` : '';
  const isHost = Boolean(party && currentAccount && (
    party.hostEmail === currentAccount.email || (!party.hostEmail && party.hostName === currentAccount.name)
  ));
  const partyReady = Boolean(party?.inviteCode);
  const serverBusy = party?.server && ['preparing', 'installing', 'starting'].includes(party.server.status);
  const members = chatMembers.length ? chatMembers : party?.members ?? [];
  const featuredMembers = members.slice(0, 4);
  const benchMembers = members.slice(4);
  const inviteSkinCount = members.filter((member) => member.skin?.dataUrl).length;
  const shortInvite = party?.shortCode ?? '';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const current = await window.fox.party.current();
        if (cancelled) return;
        setParty(current);
        if (current?.instanceId && (currentAccount?.type === 'microsoft' || currentAccount?.email)) {
          const compatibility = await window.fox.party.selectInstance(current.instanceId);
          if (!cancelled) setResult(compatibility);
        }
      } catch (error) {
        if (!cancelled) report(error, t('party'));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!party?.id || !serverBusy) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const snapshot = await window.fox.party.serverStatus();
          if (cancelled) return;
          if (snapshot.party?.id === party.id) {
            setParty(snapshot.party);
            setResult((previous) => previous ? { ...previous, party: snapshot.party!, join: snapshot.party!.join } : previous);
          }
          if (snapshot.server.status !== 'running' && snapshot.server.status !== 'error' && snapshot.server.status !== 'offline') {
            setStatus(snapshot.server.message);
            setStatusError(false);
          }
        } catch (error) {
          if (!cancelled) report(error, t('partyServer'));
        }
      })();
    }, 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [party?.id, serverBusy]);

  useEffect(() => {
    if (!createInstanceId && selectedInstanceId) setCreateInstanceId(selectedInstanceId);
    if (!joinInstanceId && selectedInstanceId) setJoinInstanceId(selectedInstanceId);
  }, [selectedInstanceId, createInstanceId, joinInstanceId]);

  useEffect(() => {
    setRemoteAddressInput(party?.remoteAddress ?? '');
  }, [party?.remoteAddress]);

  useEffect(() => {
    return window.fox.party.onChat((update: PartyChatUpdate) => {
      setChat(update.state);
      setMessages(update.messages);
      setChatMembers(update.members);
      setParty((previous) => previous ? { ...previous, chat: update.state, members: update.members } : previous);
    });
  }, []);

  useEffect(() => {
    if (!party?.id) {
      setChat(OFFLINE_CHAT);
      setMessages([]);
      setChatMembers([]);
      return;
    }
    void window.fox.party.chatStatus().then((snapshot) => {
      setChat(snapshot.state);
      setMessages(snapshot.messages);
      setChatMembers(snapshot.members);
    }).catch(() => undefined);
  }, [party?.id]);

  useEffect(() => {
    if (!party?.id || !chatMembers.length) return;
    const presence = launchState.status === 'running' ? 'in-game' : 'online';
    void window.fox.party.chatPresence(presence).catch(() => undefined);
  }, [party?.id, launchState.status, chatMembers.length]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function report(error: unknown, prefix: string) {
    setStatusError(true);
    setStatus(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }

  function instanceOptions(): ReactNode {
    if (!instances.length) return <option value="">No instances yet</option>;
    return instances.map((instance) => (
      <option key={instance.id} value={instance.id}>
        {instance.name} · {instance.minecraftVersion} {instance.loader}
      </option>
    ));
  }

  async function create() {
    setCreating(true);
    setStatusError(false);
    try {
      const created = await window.fox.party.create({
        name: partyName.trim() || `${currentAccount?.name ?? 'Fox'}'s party`,
        serverHost: autoServer ? 'pending' : serverHost.trim(),
        serverPort: autoServer ? undefined : serverPort.trim() ? Number(serverPort) : undefined,
        instanceId: createInstanceId,
        autoServer,
      });
      setParty(created);
      setResult({
        party: created,
        instanceId: created.instanceId ?? '',
        join: created.join,
        compatible: true,
        modMatch: true,
        missingMods: [],
        notice: t('partyInstanceMatch'),
      });
      setStatus(autoServer ? t('partyServerPreparing') : t('partyCreated'));
      await refreshInstances();
    } catch (error) {
      report(error, t('createParty'));
    } finally {
      setCreating(false);
    }
  }

  async function join() {
    setJoining(true);
    setStatusError(false);
    try {
      const joined = await window.fox.party.join(joinCode.trim(), joinInstanceId || undefined);
      setParty(joined.party);
      setResult(joined);
      setStatus(`${t('partyJoined')} ${joined.notice}`);
      await refreshInstances();
    } catch (error) {
      report(error, t('joinParty'));
    } finally {
      setJoining(false);
    }
  }

  async function joinByAddress() {
    const address = manualAddress.trim();
    if (!address || joining) return;
    setJoining(true);
    setStatusError(false);
    try {
      const joined = await window.fox.party.joinByAddress(
        address,
        joinInstanceId || selectedInstanceId || undefined,
      );
      setParty(joined.party);
      setResult(joined);
      setStatus(`${t('partyJoined')} ${joined.notice}`);
      await refreshInstances();
    } catch (error) {
      report(error, t('joinByAddress'));
    } finally {
      setJoining(false);
    }
  }

  async function saveRemoteAddress() {
    const address = remoteAddressInput.trim();
    if (!address || !isHost) return;
    setStatusError(false);
    try {
      const updated = await window.fox.party.setRemoteAddress(address, party?.chatPort);
      setParty(updated);
      note(t('remoteAddressSaved'));
    } catch (error) {
      report(error, t('remoteHostTitle'));
    }
  }

  function note(message: string) {
    setStatusError(false);
    setStatus(message);
  }

  async function chooseInstance(instanceId: string) {
    if (!instanceId) return;
    setStatusError(false);
    try {
      const updated = await window.fox.party.selectInstance(instanceId);
      setParty(updated.party);
      setResult(updated);
      setStatus(updated.notice);
    } catch (error) {
      report(error, t('gameInstance'));
    }
  }

  async function copyText(value: string): Promise<boolean> {
    try {
      await window.fox.app.copyText(value);
      return true;
    } catch {
      report(new Error('Clipboard unavailable — select the code manually'), t('copyInvite'));
      return false;
    }
  }

  async function copyInvite() {
    if (!shortInvite) return;
    if (await copyText(shortInvite)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  async function copyRemoteInvite() {
    if (!party?.inviteCode) return;
    if (await copyText(party.inviteCode)) {
      setCopiedRemote(true);
      window.setTimeout(() => setCopiedRemote(false), 1800);
    }
  }

  async function addFriend(member: PartyMember) {
    setStatusError(false);
    try {
      await window.fox.friends.addPartyMember(member);
      setStatus(`${member.name}: ${t('friendAdded')}`);
    } catch (error) {
      report(error, t('addFriendToRoster'));
    }
  }

  function isSelf(member: PartyMember): boolean {
    return Boolean(currentAccount && currentAccount.name === member.name && currentAccount.type === member.accountType);
  }

  async function leave() {
    setStatusError(false);
    try {
      await window.fox.party.leave();
      setParty(null);
      setResult(null);
      setChat(OFFLINE_CHAT);
      setMessages([]);
      setChatMembers([]);
      setStatus(t('partyLeft'));
    } catch (error) {
      report(error, t('leaveParty'));
    }
  }

  async function stopServer() {
    setStoppingServer(true);
    setStatusError(false);
    try {
      setParty(await window.fox.party.serverStop());
      setStatus(t('serverStopped'));
    } catch (error) {
      report(error, t('stopServer'));
    } finally {
      setStoppingServer(false);
    }
  }

  async function launchIntoParty() {
    if (!party?.instanceId || gameBusy) return;
    setLaunching(true);
    setStatusError(false);
    try {
      await window.fox.launcher.launch(party.instanceId, party.join);
      setStatus(`${t('launchIntoParty')}: ${serverAddress}`);
    } catch (error) {
      report(error, t('launchIntoParty'));
    } finally {
      setLaunching(false);
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await window.fox.party.chatSend(text);
      setDraft('');
    } catch (error) {
      report(error, t('partyChat'));
    } finally {
      setSending(false);
    }
  }

  function presenceLabel(member: PartyMember): string {
    if (member.status === 'host') return t('host');
    if (member.presence === 'in-game') return t('inGame');
    if (member.presence === 'offline') return t('offline');
    return t('online');
  }

  function playerCard(member: PartyMember, index: number) {
    const online = member.presence !== 'offline' || index === 0;
    return (
      <div key={`${member.accountType}-${member.name}-${index}`} className={`party-player-card ${online ? 'online' : 'offline'}`}>
        <div className="party-player-glow" />
        {member.status === 'host' && <span className="party-host-crown" title={t('host')}><Crown size={14} /></span>}
        <div className="party-skin-stage">
          <SkinPreview
            skinUrl={member.skin?.dataUrl || ''}
            capeUrl={member.skin?.capeDataUrl}
            model={member.skin?.model ?? 'steve'}
            width={128}
            height={168}
            animate={false}
            showControls={false}
            initialZoom={0.9}
            className="party-skin-view"
          />
        </div>
        <div className="party-player-card-meta">
          <strong className="ellipsis">{member.name}</strong>
          <span className={`party-presence ${online ? 'online' : ''}`}>
            {online ? <Wifi size={11} /> : <WifiOff size={11} />}
            {presenceLabel(member)}
          </span>
        </div>
        {!isSelf(member) && (
          <button
            className="party-player-add"
            title={t('addFriendToRoster')}
            aria-label={t('addFriendToRoster')}
            onClick={() => void addFriend(member)}
          >
            <UserPlus size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="page party-page">
      <div className="page-header">
        <div>
          <h1>{t('party')}</h1>
          <p>{t('partyDescription')}</p>
        </div>
        {party && (
          <Button variant="secondary" icon={<LogOut size={15} />} onClick={() => void leave()}>
            {t('leaveParty')}
          </Button>
        )}
      </div>

      <p className="status-description">{t('partyLocalOnly')}</p>
      <p className="status-description">{t('routerSafety')}</p>
      <div className="panel party-remote-guide">
        <div className="panel-header">
          <div>
            <h3>{t('remotePlayTitle')}</h3>
            <p>{t('remotePlayBody')}</p>
          </div>
          <Globe2 size={18} />
        </div>
        <ol className="remote-guide-steps">
          <li>{t('remoteHostHint')}</li>
          <li>{t('remoteJoinHint')}</li>
          <li>{t('manualJoinNotice')}</li>
        </ol>
      </div>
      {status && <p className={`status-description ${statusError ? 'error' : ''}`}>{status}</p>}

      {!hasAccess && (
        <div className="panel party-gate">
          <div className="account-form-icon"><Mail size={20} /></div>
          <div>
            <h3>{t('partyAccessTitle')}</h3>
            <p>{t('partyAccessBody')}</p>
          </div>
          <Button icon={<KeyRound size={16} />} onClick={() => setAccountModal(true)}>{t('createFoxId')}</Button>
        </div>
      )}

      <div className="party-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>{t('createParty')}</h3>
              <p>{t('partyDescription')}</p>
            </div>
            <Users size={18} />
          </div>
          <div className="form-grid">
            <Field label={t('partyName')}>
              <input
                value={partyName}
                maxLength={40}
                onChange={(event) => setPartyName(event.target.value)}
                placeholder={`${currentAccount?.name ?? 'Fox'}'s party`}
                disabled={!hasAccess}
              />
            </Field>
            <label className="party-check">
              <input
                type="checkbox"
                checked={autoServer}
                onChange={(event) => setAutoServer(event.target.checked)}
                disabled={!hasAccess}
              />
              <span>{t('autoPartyServer')}</span>
            </label>
            <p className="party-field-hint">{t(autoServer ? 'autoPartyServerHint' : 'manualPartyServerHint')}</p>
            {!autoServer && (
              <div className="party-form-row">
                <Field label={t('serverAddress')}>
                  <input
                    value={serverHost}
                    onChange={(event) => setServerHost(event.target.value)}
                    placeholder="play.example.com"
                    disabled={!hasAccess}
                  />
                </Field>
                <Field label={t('serverPort')}>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={serverPort}
                    onChange={(event) => setServerPort(event.target.value)}
                    placeholder="25565"
                    disabled={!hasAccess}
                  />
                </Field>
              </div>
            )}
            <Field label={t('gameInstance')}>
              <select value={createInstanceId} onChange={(event) => setCreateInstanceId(event.target.value)} disabled={!hasAccess}>
                {instanceOptions()}
              </select>
            </Field>
            <Button icon={<Users size={16} />} loading={creating} disabled={!hasAccess} onClick={() => void create()}>
              {t('createParty')}
            </Button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>{t('joinParty')}</h3>
              <p>{t('inviteHint')}</p>
            </div>
            <Server size={18} />
          </div>
          <div className="form-grid">
            <Field label={t('inviteCode')}>
              <textarea
                className="party-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder="FOXP-XXXXXX"
                disabled={!hasAccess}
              />
            </Field>
            <Field label={t('remoteJoinTitle')} hint={t('remoteJoinHint')}>
              <input
                value={manualAddress}
                onChange={(event) => setManualAddress(event.target.value)}
                placeholder="vpn-host.example:25565"
                disabled={!hasAccess}
              />
            </Field>
            <Field label={t('gameInstance')} hint={t('partyInstanceMatch')}>
              <select value={joinInstanceId} onChange={(event) => setJoinInstanceId(event.target.value)} disabled={!hasAccess}>
                <option value="">Auto-match / create</option>
                {instanceOptions()}
              </select>
            </Field>
            <Button variant="secondary" icon={<KeyRound size={16} />} loading={joining} disabled={!hasAccess || !joinCode.trim()} onClick={() => void join()}>
              {t('joinParty')}
            </Button>
            <Button variant="subtle" icon={<Globe2 size={16} />} loading={joining} disabled={!hasAccess || !manualAddress.trim()} onClick={() => void joinByAddress()}>
              {t('joinByAddress')}
            </Button>
          </div>
        </div>
      </div>

      {party?.server && party.server.status !== 'offline' && (
        <div className="panel party-server-panel">
          <div className="panel-header">
            <div>
              <h3>{t('partyServer')}</h3>
              <p>{serverAddress}</p>
            </div>
            {party.server.mode === 'lan' && <span className="party-chip active">{t('lanOnly')}</span>}
          </div>
          <p className={`status-description ${party.server.status === 'error' ? 'error' : ''}`}>
            {party.server.message}
          </p>
          <p className="status-description">{t('routerSafety')}</p>
          {party.server.networkMessage && (
            <p className="status-description">{party.server.networkMessage}</p>
          )}
          {party.server.publicAddress && (
            <p className="status-description">{t('publicServerReady')}: {party.server.publicAddress}</p>
          )}
          {party.server.chatAddress && (
            <p className="status-description">{t('chatAddress')}: {party.server.chatAddress}</p>
          )}
          {isHost && (
            <Button variant="subtle" icon={<Power size={15} />} loading={stoppingServer} onClick={() => void stopServer()}>
              {t('stopServer')}
            </Button>
          )}
          {party.server.log?.length ? (
            <pre className="party-server-log">{party.server.log.slice(-10).join('\n')}</pre>
          ) : null}
        </div>
      )}

      {party && (
        <>
          <div className="party-arena">
            <div className="panel party-squad-panel">
              <div className="panel-header">
                <div>
                  <h3>{t('partySquad')}</h3>
                  <p>{party.name} · {party.minecraftVersion} {party.loader}</p>
                </div>
                <span className="party-chip active">
                  {chat.onlineCount ?? members.filter((member) => member.presence !== 'offline').length}/{members.length} {t('online')}
                </span>
              </div>
              <div className="party-squad-grid">
                {featuredMembers.map(playerCard)}
                {Array.from({ length: Math.max(0, 4 - featuredMembers.length) }, (_, index) => (
                  <div key={`empty-${index}`} className="party-player-card empty">
                    <div className="party-empty-slot"><Users size={26} /></div>
                    <div className="party-player-card-meta"><strong>{t('waitingForPlayer')}</strong></div>
                  </div>
                ))}
              </div>
              {benchMembers.length > 0 && (
                <div className="party-bench">
                  {benchMembers.map((member, index) => (
                    <span key={`${member.accountType}-${member.name}-${index}`} className="party-bench-chip">
                      <span className={`party-presence-dot ${member.presence === 'offline' ? '' : 'online'}`} />
                      {member.name}
                      {!isSelf(member) && (
                        <button
                          className="party-bench-add"
                          title={t('addFriendToRoster')}
                          aria-label={t('addFriendToRoster')}
                          onClick={() => void addFriend(member)}
                        >
                          <UserPlus size={12} />
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="panel party-chat-panel">
              <div className="panel-header">
                <div>
                  <h3>{t('partyChat')}</h3>
                  <p>{chat.address || t('chatLocalHosted')}</p>
                </div>
                <MessageCircle size={18} />
              </div>
              <div className="party-chat-messages" ref={messageListRef}>
                {messages.length === 0 ? (
                  <p className="party-chat-empty">{t('chatEmpty')}</p>
                ) : messages.map((message) => (
                  <div key={message.id} className={`party-chat-line ${message.kind === 'system' ? 'system' : ''}`}>
                    {message.kind === 'chat' && (
                      <span className="party-chat-avatar">{message.author.charAt(0).toUpperCase()}</span>
                    )}
                    <div className="party-chat-copy">
                      <span className="party-chat-author">{message.kind === 'system' ? 'Fox' : message.author}</span>
                      <span className="party-chat-text">{message.text}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className={`party-chat-status ${chat.status === 'error' ? 'error' : ''}`}>{chat.message}</p>
              <form className="party-chat-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
                <input
                  value={draft}
                  maxLength={500}
                  placeholder={t('chatPlaceholder')}
                  disabled={!party || chat.status !== 'connected'}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <Button type="submit" icon={<Send size={15} />} loading={sending} disabled={!party || chat.status !== 'connected' || !draft.trim()}>
                  {t('sendMessage')}
                </Button>
              </form>
            </div>
          </div>

          <div className="panel party-current">
            <div className="panel-header">
              <div>
                <h3>{party.name}</h3>
                <p>{serverAddress} · {party.minecraftVersion} {party.loader}{party.loaderVersion ? ` ${party.loaderVersion}` : ''}</p>
              </div>
              <span className="party-chip active">{t('partyReady')}</span>
            </div>
            <div className="form-grid">
              <Field
                label={t('inviteCode')}
                hint={`${t('inviteHint')} ${t('inviteReady')} · ${t('lanOnly')} · ${inviteSkinCount} ${t('playerSkins')}`}
              >
                <input className="friend-code-input" value={shortInvite} readOnly />
              </Field>
              <div className="party-action-row">
                <Button variant="secondary" icon={copied ? <Check size={15} /> : <Copy size={15} />} disabled={!partyReady} onClick={() => void copyInvite()}>
                  {copied ? t('copied') : t('copyInvite')}
                </Button>
                <Button icon={<Play size={15} />} loading={launching} disabled={gameBusy || !partyReady || !party.instanceId} onClick={() => void launchIntoParty()}>
                  {t('launchIntoParty')}
                </Button>
              </div>
              <div className="party-action-row">
                <span className="party-chip"><Gamepad2 size={12} /> {t('members')}: {members.length}</span>
                <span className="party-chip"><Wifi size={12} /> {t('online')}: {chat.onlineCount ?? 0}</span>
                <span className="party-chip"><UserPlus size={12} /> {t('addFriendToRoster')}</span>
              </div>
            </div>
          </div>

          {isHost && (
            <div className="panel party-remote-share">
              <div className="panel-header">
                <div>
                  <h3>{t('remoteHostTitle')}</h3>
                  <p>{t('remoteHostHint')}</p>
                </div>
                <Globe2 size={18} />
              </div>
              <div className="form-grid">
                <Field label={t('remoteAddressInput')}>
                  <input
                    value={remoteAddressInput}
                    onChange={(event) => setRemoteAddressInput(event.target.value)}
                    placeholder="vpn-host.example:25565"
                  />
                </Field>
                <Button variant="secondary" icon={<Globe2 size={15} />} disabled={!remoteAddressInput.trim()} onClick={() => void saveRemoteAddress()}>
                  {t('save')}
                </Button>
                <Field label={t('remoteInvite')} hint={t('manualJoinNotice')}>
                  <textarea className="party-code party-code-ready" value={party.inviteCode} readOnly />
                </Field>
                <Button variant="subtle" icon={copiedRemote ? <Check size={15} /> : <Copy size={15} />} disabled={!party.inviteCode} onClick={() => void copyRemoteInvite()}>
                  {copiedRemote ? t('copied') : t('copyRemoteInvite')}
                </Button>
              </div>
            </div>
          )}

          {result && (
            <div className="panel party-compat-panel">
              <div className={`party-compat ${result.compatible ? 'ok' : 'warn'}`}>
                <strong>{result.compatible ? t('partyInstanceMatch') : t('gameInstance')}</strong>
                <p>{result.notice}</p>
                <Field label={t('gameInstance')}>
                  <select
                    value={party.instanceId ?? result.instanceId}
                    onChange={(event) => void chooseInstance(event.target.value)}
                  >
                    {instanceOptions()}
                  </select>
                </Field>
                {result.missingMods.length ? (
                  <>
                    <strong>{t('missingMods')}</strong>
                    <ul className="party-missing-mods">
                      {result.missingMods.slice(0, 12).map((mod) => <li key={mod}>{mod}</li>)}
                    </ul>
                    <Button size="sm" variant="subtle" onClick={() => navigate('mods', result.instanceId)}>{t('openMods')}</Button>
                  </>
                ) : (
                  <p>{t('noMissingMods')}</p>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {accountModal && <AccountModal onClose={() => setAccountModal(false)} />}
    </div>
  );
}
