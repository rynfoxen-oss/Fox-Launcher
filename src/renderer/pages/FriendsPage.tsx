import { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Globe2,
  KeyRound,
  MessageCircle,
  Mic,
  MicOff,
  Pencil,
  Phone,
  PhoneOff,
  Send,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import type {
  Friend,
  FriendCallEvent,
  FriendMessage,
  FriendsUpdate,
  PartyMember,
  RemoteFriendRequest,
} from '../../shared/types';
import { useApp } from '../store';
import { useT } from '../i18n';
import { AccountModal } from '../components/AccountModal';
import { SkinPreview } from '../components/SkinPreview';
import { Button, Field } from '../components/Common';

interface ActiveCall {
  friendCode: string;
  callId: string;
  state: 'ringing' | 'connected';
  incoming: boolean;
}

interface MicSession {
  stream: MediaStream;
  context: AudioContext;
  processor: ScriptProcessorNode;
  source: MediaStreamAudioSourceNode;
}

function base64ToPcm(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcmToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const scaled = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, scaled < 0 ? scaled * 0x8000 : scaled * 0x7fff, true);
  }
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

export function FriendsPage() {
  const currentAccount = useApp((state) => state.currentAccount);
  const t = useT();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [myCode, setMyCode] = useState('');
  const [partyMembers, setPartyMembers] = useState<PartyMember[]>([]);
  const [codeInput, setCodeInput] = useState('');
  const [remoteCodeInput, setRemoteCodeInput] = useState('');
  const [remoteAddressInput, setRemoteAddressInput] = useState('');
  const [publicAddressInput, setPublicAddressInput] = useState('');
  const [remoteRequests, setRemoteRequests] = useState<RemoteFriendRequest[]>([]);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [accountModal, setAccountModal] = useState(false);
  const [selectedCode, setSelectedCode] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [messages, setMessages] = useState<FriendMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [muted, setMuted] = useState(false);

  const micRef = useRef<MicSession | null>(null);
  const playContextRef = useRef<AudioContext | null>(null);
  const selectedRef = useRef('');
  const mutedRef = useRef(false);
  const messageListRef = useRef<HTMLDivElement>(null);

  async function load() {
    setStatusError(false);
    try {
      const [savedFriends, party, requests, publicAddress] = await Promise.all([
        window.fox.friends.list(),
        window.fox.party.current(),
        window.fox.friends.remoteRequests(),
        window.fox.friends.publicAddress(),
      ]);
      setFriends(savedFriends);
      setRemoteRequests(requests);
      setPublicAddressInput(publicAddress);
      setPartyMembers(party?.members ?? []);
      setSelectedCode((previous) => {
        const next = previous && savedFriends.some((friend) => friend.code === previous)
          ? previous
          : savedFriends[0]?.code ?? '';
        selectedRef.current = next;
        return next;
      });

      try {
        const chat = await window.fox.party.chatStatus();
        if (chat.members.length) setPartyMembers(chat.members);
      } catch {
        // A stopped chat relay simply leaves the party roster in place.
      }

      if (currentAccount) {
        try {
          setMyCode(await window.fox.friends.myCode());
        } catch (error) {
          setStatusError(true);
          setStatus(error instanceof Error ? error.message : String(error));
        }
      } else {
        setMyCode('');
      }
    } catch (error) {
      setStatusError(true);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadMessages(code: string) {
    if (!code) {
      setMessages([]);
      return;
    }
    try {
      setMessages(await window.fox.friends.messages(code));
    } catch {
      setMessages([]);
    }
  }

  useEffect(() => {
    void load();
    // The account is read once on page load; switching accounts reopens this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    selectedRef.current = selectedCode;
    void loadMessages(selectedCode);
  }, [selectedCode]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function report(error: unknown, prefix: string) {
    setStatusError(true);
    setStatus(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  }

  function note(message: string) {
    setStatusError(false);
    setStatus(message);
  }

  async function copyText(value: string): Promise<boolean> {
    try {
      await window.fox.app.copyText(value);
      return true;
    } catch {
      report(new Error('Clipboard unavailable — select the code manually'), t('copyFriendCode'));
      return false;
    }
  }

  async function copyMyCode() {
    if (!myCode) return;
    if (await copyText(myCode)) {
      setCopied(true);
      note(t('friendCodeCopied'));
      window.setTimeout(() => setCopied(false), 1800);
    }
  }

  async function addByCode() {
    const code = codeInput.trim();
    if (!code || busy) return;
    setBusy(true);
    setStatusError(false);
    try {
      const updated = await window.fox.friends.addCode(code);
      setFriends(updated);
      setCodeInput('');
      note(t('friendAdded'));
      await load();
    } catch (error) {
      report(error, t('addFriend'));
    } finally {
      setBusy(false);
    }
  }

  async function addRemoteFriend() {
    const code = remoteCodeInput.trim();
    const address = remoteAddressInput.trim();
    if ((!code || !address) || busy) return;
    setBusy(true);
    setStatusError(false);
    try {
      const result = await window.fox.friends.addRemoteCode(code, address);
      setFriends(result.friends);
      setRemoteCodeInput('');
      note(result.status === 'linked' ? t('remoteFriendLinked') : t('remoteFriendPending'));
      await load();
    } catch (error) {
      report(error, t('remoteFriendTitle'));
    } finally {
      setBusy(false);
    }
  }

  async function respondToRequest(code: string, accept: boolean) {
    setStatusError(false);
    try {
      const updated = accept
        ? await window.fox.friends.acceptRemoteRequest(code)
        : await window.fox.friends.rejectRemoteRequest(code);
      setFriends(updated);
      setRemoteRequests((previous) => previous.filter((request) => request.code !== code));
      note(accept ? t('remoteFriendLinked') : t('rejectRemoteRequest'));
      await load();
    } catch (error) {
      report(error, accept ? t('acceptRemoteRequest') : t('rejectRemoteRequest'));
    }
  }

  async function savePublicAddress() {
    const address = publicAddressInput.trim();
    if (!address) return;
    setStatusError(false);
    try {
      const saved = await window.fox.friends.setPublicAddress(address);
      setPublicAddressInput(saved);
      note(t('publicFriendSaved'));
    } catch (error) {
      report(error, t('publicFriendAddress'));
    }
  }

  async function addFromParty(member: PartyMember) {
    setStatusError(false);
    try {
      setFriends(await window.fox.friends.addPartyMember(member));
      note(`${member.name}: ${t('friendAdded')}`);
    } catch (error) {
      report(error, t('addFriendToRoster'));
    }
  }

  async function remove(id: string) {
    setStatusError(false);
    try {
      const updated = await window.fox.friends.remove(id);
      setFriends(updated);
      if (selectedRef.current === id) {
        selectedRef.current = updated[0]?.code ?? '';
        setSelectedCode(selectedRef.current);
      }
      note(t('removeFriend'));
    } catch (error) {
      report(error, t('removeFriend'));
    }
  }

  function beginRename(friend: Friend) {
    setSelectedCode(friend.code);
    setNameDraft(friend.name);
    setEditingName(true);
  }

  async function saveName() {
    const friend = friends.find((item) => item.code === selectedCode);
    const name = nameDraft.trim();
    if (!friend || !name || busy) return;
    setBusy(true);
    try {
      setFriends(await window.fox.friends.rename(friend.id, name));
      setEditingName(false);
      note(t('nameSaved'));
    } catch (error) {
      report(error, t('renameFriend'));
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || !selectedCode) return;
    setDraft('');
    try {
      setMessages(await window.fox.friends.sendMessage(selectedCode, text));
    } catch (error) {
      report(error, t('directMessages'));
    }
  }

  function stopAudio() {
    const session = micRef.current;
    micRef.current = null;
    if (session) {
      try { session.processor.disconnect(); } catch { /* already disconnected */ }
      try { session.source.disconnect(); } catch { /* already disconnected */ }
      for (const track of session.stream.getTracks()) track.stop();
      void session.context.close().catch(() => undefined);
    }
  }

  async function startMic(friendCode: string, callId: string) {
    stopAudio();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const context = new AudioContext();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = (event) => {
      if (mutedRef.current) return;
      const pcm = pcmToBase64(event.inputBuffer.getChannelData(0));
      void window.fox.friends.voiceSend(friendCode, pcm, callId).catch(() => undefined);
    };
    source.connect(processor);
    processor.connect(context.destination);
    micRef.current = { stream, context, processor, source };
  }

  async function playPcm(value: string) {
    try {
      if (!playContextRef.current) playContextRef.current = new AudioContext();
      const context = playContextRef.current;
      await context.resume();
      const bytes = base64ToPcm(value);
      const frames = Math.floor(bytes.length / 2);
      if (!frames) return;
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const channel = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let index = 0; index < frames; index += 1) {
        channel[index] = view.getInt16(index * 2, true) / 0x8000;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start();
    } catch {
      // Late or damaged voice packets are simply dropped.
    }
  }

  async function startCall(friend: Friend) {
    try {
      const event = await window.fox.friends.callStart(friend.code);
      setCall({ friendCode: friend.code, callId: event.callId, state: 'ringing', incoming: false });
      note(t('callRinging'));
      try {
        await startMic(friend.code, event.callId);
      } catch {
        await window.fox.friends.callEnd(friend.code);
        setCall(null);
        report(new Error(t('micDenied')), t('startVoiceCall'));
      }
    } catch (error) {
      report(error, t('startVoiceCall'));
    }
  }

  async function acceptCall() {
    if (!call) return;
    try {
      await window.fox.friends.callAccept(call.friendCode, call.callId);
      setCall({ ...call, state: 'connected', incoming: false });
      note(t('callConnected'));
      try {
        await startMic(call.friendCode, call.callId);
      } catch {
        report(new Error(t('micDenied')), t('startVoiceCall'));
      }
    } catch (error) {
      report(error, t('acceptCall'));
    }
  }

  async function rejectCall() {
    if (!call) return;
    try {
      await window.fox.friends.callReject(call.friendCode, call.callId);
    } finally {
      stopAudio();
      setCall(null);
    }
  }

  async function endCall() {
    if (!call) return;
    try {
      await window.fox.friends.callEnd(call.friendCode);
    } finally {
      stopAudio();
      setCall(null);
    }
  }

  function toggleMute() {
    const next = !muted;
    mutedRef.current = next;
    setMuted(next);
  }

  useEffect(() => {
    return window.fox.friends.onUpdate((update: FriendsUpdate) => {
      if (update.event === 'peers' || update.event === 'identity') void load();
      if (update.event === 'request') {
        setRemoteRequests(update.requests ?? []);
        void load();
      }
      if (update.event === 'message') void loadMessages(selectedRef.current);
      const event = update.call as FriendCallEvent | undefined;
      if (event) {
        if (event.action === 'start' && event.friendCode !== 'you') {
          setCall({ friendCode: event.friendCode, callId: event.callId, state: 'ringing', incoming: true });
          note(t('incomingCall'));
        } else if (event.action === 'accept' && call?.callId === event.callId) {
          setCall({ ...call, state: 'connected', incoming: false });
          if (!micRef.current) void startMic(call.friendCode, call.callId).catch(() => undefined);
          note(t('callConnected'));
        } else if ((event.action === 'reject' || event.action === 'end') && call?.callId === event.callId) {
          stopAudio();
          setCall(null);
          note(event.action === 'reject' ? t('callBusy') : t('leaveParty'));
        }
      }
      const pcm = update.signal?.data?.pcm;
      if (typeof pcm === 'string') void playPcm(pcm);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.callId]);

  useEffect(() => () => {
    stopAudio();
    if (playContextRef.current) void playContextRef.current.close().catch(() => undefined);
  }, []);

  function isSelf(member: PartyMember): boolean {
    return Boolean(currentAccount && currentAccount.name === member.name && currentAccount.type === member.accountType);
  }

  function presenceLabel(presence: Friend['presence']): string {
    if (presence === 'in-game') return t('inGame');
    if (presence === 'offline') return t('offline');
    return t('online');
  }

  function sourceLabel(friend: Friend): string {
    if (friend.source === 'remote') return t('sourceRemote');
    return friend.source === 'party' ? t('sourceParty') : t('sourceCode');
  }

  const addableMembers = partyMembers.filter((member) => !isSelf(member));
  const selectedFriend = friends.find((friend) => friend.code === selectedCode);
  const onlineCount = friends.filter((friend) => friend.presence !== 'offline').length;

  return (
    <div className="page friends-page">
      <div className="page-header">
        <div>
          <h1>{t('friends')}</h1>
          <p>{t('friendsDescription')}</p>
        </div>
        <span className="party-chip active"><MessageCircle size={12} /> {onlineCount}/{friends.length} {t('friendsOnline')}</span>
      </div>

      <p className="status-description">{t('friendsLocalOnly')}</p>
      <p className="status-description">{t('friendSafety')}</p>
      {status && <p className={`status-description ${statusError ? 'error' : ''}`}>{status}</p>}

      {call?.state === 'ringing' && call.incoming && (
        <div className="panel friends-call-banner">
          <div>
            <strong>{t('incomingCall')}</strong>
            <span>{friends.find((friend) => friend.code === call.friendCode)?.name ?? call.friendCode}</span>
          </div>
          <div className="party-action-row">
            <Button size="sm" icon={<Phone size={14} />} onClick={() => void acceptCall()}>{t('acceptCall')}</Button>
            <Button size="sm" variant="ghost" icon={<PhoneOff size={14} />} onClick={() => void rejectCall()}>{t('rejectCall')}</Button>
          </div>
        </div>
      )}

      {!currentAccount && (
        <div className="panel party-gate">
          <div className="account-form-icon"><KeyRound size={20} /></div>
          <div>
            <h3>{t('partyAccessTitle')}</h3>
            <p>{t('partyAccessBody')}</p>
          </div>
          <Button icon={<KeyRound size={16} />} onClick={() => setAccountModal(true)}>{t('createFoxId')}</Button>
        </div>
      )}

      <div className="friends-layout">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>{t('yourFriendCode')}</h3>
              <p>{t('friendCodeHint')}</p>
            </div>
            <ShieldCheck size={18} />
          </div>
          <div className="form-grid">
            <Field label={t('friendCodeInput')}>
              <input className="friend-code-input" value={myCode} readOnly placeholder={currentAccount ? 'FOX-XXXXXX' : t('partyAccessTitle')} />
            </Field>
            <div className="party-action-row">
              <Button variant="secondary" icon={<Copy size={15} />} disabled={!myCode} onClick={() => void copyMyCode()}>
                {copied ? t('copied') : t('copyFriendCode')}
              </Button>
              <Button variant="ghost" icon={<UserPlus size={15} />} disabled={!currentAccount} onClick={() => void load()}>
                {t('refreshCode')}
              </Button>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>{t('addFriend')}</h3>
              <p>{t('addFriendHint')}</p>
              <p>{t('friendNameHint')}</p>
              <p>{t('friendNoPublicHint')}</p>
            </div>
            <UserPlus size={18} />
          </div>
          <div className="form-grid">
            <Field label={t('friendCodeInput')}>
              <input
                className="friend-code-input"
                value={codeInput}
                maxLength={16}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                placeholder="FOX-XXXXXX"
              />
            </Field>
            <Button icon={<UserPlus size={16} />} loading={busy} disabled={!codeInput.trim()} onClick={() => void addByCode()}>
              {t('addFriend')}
            </Button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h3>{t('remoteFriendTitle')}</h3>
              <p>{t('remoteFriendHint')}</p>
            </div>
            <Globe2 size={18} />
          </div>
          <div className="form-grid">
            <Field label={t('friendCodeInput')}>
              <input
                className="friend-code-input"
                value={remoteCodeInput}
                maxLength={16}
                onChange={(event) => setRemoteCodeInput(event.target.value.toUpperCase())}
                placeholder="FOX-XXXXXX"
              />
            </Field>
            <Field label={t('remoteFriendAddress')}>
              <input
                value={remoteAddressInput}
                onChange={(event) => setRemoteAddressInput(event.target.value)}
                placeholder="play.example.com:37822"
              />
            </Field>
            <Button variant="secondary" icon={<Globe2 size={16} />} loading={busy} disabled={!remoteCodeInput.trim() || !remoteAddressInput.trim()} onClick={() => void addRemoteFriend()}>
              {t('remoteFriendTitle')}
            </Button>
            <Field label={t('publicFriendAddress')} hint={t('publicFriendAddressHint')}>
              <input
                value={publicAddressInput}
                onChange={(event) => setPublicAddressInput(event.target.value)}
                placeholder="play.example.com:37822"
              />
            </Field>
            <Button variant="subtle" icon={<Check size={15} />} disabled={!publicAddressInput.trim()} onClick={() => void savePublicAddress()}>
              {t('save')}
            </Button>
          </div>
        </div>
      </div>

      <div className="panel friends-roster-panel">
        <div className="panel-header">
          <div>
            <h3>{t('partyRoster')}</h3>
            <p>{t('addFriendHint')}</p>
          </div>
          <Users size={18} />
        </div>
        {addableMembers.length ? (
          <div className="friends-roster-list">
            {addableMembers.map((member, index) => (
              <div key={`${member.code ?? member.accountType}-${member.name}-${index}`} className="friend-roster-row">
                <span className={`party-presence-dot ${member.presence === 'offline' ? '' : 'online'}`} />
                <div className="friend-roster-copy">
                  <strong className="ellipsis">{member.name}</strong>
                  <span>{member.accountType === 'microsoft' ? 'Microsoft' : t('foxId')} · {presenceLabel(member.presence ?? 'online')}</span>
                </div>
                <Button size="sm" variant="secondary" icon={<UserPlus size={14} />} onClick={() => void addFromParty(member)}>
                  {t('addFriend')}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="status-description">{t('noPartyMembers')}</p>
        )}
      </div>

      <div className="panel friends-roster-panel">
        <div className="panel-header">
          <div>
            <h3>{t('remoteRequestsTitle')}</h3>
            <p>{t('remoteRequestHint')}</p>
          </div>
          <ShieldCheck size={18} />
        </div>
        {remoteRequests.length ? (
          <div className="friends-roster-list">
            {remoteRequests.map((request) => (
              <div key={request.code} className="friend-roster-row">
                <span className="party-presence-dot online" />
                <div className="friend-roster-copy">
                  <strong className="ellipsis">{request.name}</strong>
                  <span>{request.code} · {request.address}</span>
                </div>
                <div className="party-action-row">
                  <Button size="sm" icon={<Check size={14} />} onClick={() => void respondToRequest(request.code, true)}>
                    {t('acceptRemoteRequest')}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => void respondToRequest(request.code, false)}>
                    {t('rejectRemoteRequest')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="status-description">{t('noRemoteRequests')}</p>
        )}
      </div>

      <div className="friends-grid-wrap">
        <h3>{t('friends')}</h3>
        {friends.length ? (
          <div className="friends-grid">
            {friends.map((friend) => (
              <div
                key={friend.id}
                className={`friend-card ${friend.presence === 'offline' ? 'offline' : ''} ${selectedCode === friend.code ? 'selected' : ''}`}
                onClick={() => setSelectedCode(friend.code)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === 'Enter') setSelectedCode(friend.code); }}
              >
                <div className="friend-skin-stage">
                  <SkinPreview
                    skinUrl={friend.skin?.dataUrl || ''}
                    capeUrl={friend.skin?.capeDataUrl}
                    model={friend.skin?.model ?? 'steve'}
                    width={112}
                    height={148}
                    animate={false}
                    showControls={false}
                    initialZoom={0.9}
                    className="friend-skin-view"
                  />
                  <span className={`friend-presence-dot ${friend.presence === 'offline' ? '' : 'online'}`} />
                </div>
                <div className="friend-card-copy">
                  <strong className="ellipsis">{friend.name}</strong>
                  <span>{friend.code}</span>
                  <span>{sourceLabel(friend)} · {presenceLabel(friend.presence)}</span>
                </div>
                <div className="friend-card-actions">
                  <button className="friend-action" title={t('directMessages')} aria-label={t('directMessages')} onClick={(event) => { event.stopPropagation(); setSelectedCode(friend.code); }}>
                    <MessageCircle size={14} />
                  </button>
                  <button className="friend-action" title={t('renameFriend')} aria-label={t('renameFriend')} onClick={(event) => { event.stopPropagation(); beginRename(friend); }}>
                    <Pencil size={14} />
                  </button>
                  <button className="friend-action" title={t('startVoiceCall')} aria-label={t('startVoiceCall')} onClick={(event) => { event.stopPropagation(); void startCall(friend); }}>
                    <Phone size={14} />
                  </button>
                  <button className="friend-remove" title={t('removeFriend')} aria-label={t('removeFriend')} onClick={(event) => { event.stopPropagation(); void remove(friend.id); }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="panel friends-empty">
            <Users size={26} />
            <p>{t('noFriends')}</p>
          </div>
        )}
      </div>

      {selectedFriend && (
        <div className="panel friend-chat-panel">
          <div className="panel-header">
            <div>
              {editingName ? (
                <div className="friend-name-edit">
                  <input
                    value={nameDraft}
                    maxLength={16}
                    autoFocus
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void saveName();
                      if (event.key === 'Escape') setEditingName(false);
                    }}
                  />
                  <Button size="sm" icon={<Check size={14} />} loading={busy} disabled={!nameDraft.trim()} onClick={() => void saveName()}>
                    {t('save')}
                  </Button>
                </div>
              ) : (
                <h3>
                  {t('directMessages')} · {selectedFriend.name}
                  <button className="friend-name-pencil" title={t('renameFriend')} aria-label={t('renameFriend')} onClick={() => beginRename(selectedFriend)}>
                    <Pencil size={12} />
                  </button>
                </h3>
              )}
              <p>{selectedFriend.code} · {t('routerSafety')}</p>
            </div>
            <div className="party-action-row">
              {call?.friendCode === selectedFriend.code && call.state === 'connected' && (
                <Button size="sm" variant="secondary" icon={muted ? <MicOff size={14} /> : <Mic size={14} />} onClick={toggleMute}>
                  {muted ? t('unmute') : t('mute')}
                </Button>
              )}
              {call?.friendCode === selectedFriend.code ? (
                <Button size="sm" variant="ghost" icon={<PhoneOff size={14} />} onClick={() => void endCall()}>{t('endCall')}</Button>
              ) : (
                <Button size="sm" variant="secondary" icon={<Phone size={14} />} onClick={() => void startCall(selectedFriend)}>{t('startVoiceCall')}</Button>
              )}
            </div>
          </div>
          <div className="party-chat-messages friend-chat-messages" ref={messageListRef}>
            {messages.length === 0 ? (
              <p className="party-chat-empty">{t('noMessages')}</p>
            ) : messages.map((message) => (
              <div key={message.id} className={`party-chat-line ${message.outgoing ? 'outgoing' : ''}`}>
                {!message.outgoing && <span className="party-chat-avatar">{message.author.charAt(0).toUpperCase()}</span>}
                <div className="party-chat-copy">
                  <span className="party-chat-author">{message.outgoing ? currentAccount?.name ?? 'You' : message.author}</span>
                  <span className="party-chat-text">{message.text}</span>
                </div>
              </div>
            ))}
          </div>
          <form className="party-chat-compose" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <input
              value={draft}
              maxLength={500}
              placeholder={t('messagePlaceholder')}
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" icon={<Send size={15} />} disabled={!draft.trim()}>{t('sendMessage')}</Button>
          </form>
        </div>
      )}

      {accountModal && <AccountModal onClose={() => setAccountModal(false)} />}
    </div>
  );
}
