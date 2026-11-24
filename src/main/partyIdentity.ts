import type { PartyMember, PartyPresence, PartySkin, SkinModel } from '../shared/types';
import { friendShortCode } from './codes';
import { store } from './store';

const MAX_SKIN_DATA = 120_000;

function boundedDataUrl(value: unknown): string {
  return typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= MAX_SKIN_DATA
    ? value
    : '';
}

/** Builds the local player's party card from saved launcher data only. */
export function currentPartyMember(presence: PartyPresence = 'online'): PartyMember | null {
  const data = store.get();
  const account = store.currentAccount();
  if (!account) return null;

  const skinRecord = data.skins.find((item) => item.hash === account.skinHash);
  const skinData = boundedDataUrl(account.skinTexture) || boundedDataUrl(skinRecord?.dataUrl);
  const model: SkinModel = account.skinModel ?? skinRecord?.model ?? 'steve';

  const capeHash = account.cape?.type === 'custom' ? account.cape.hash : '';
  const capeDataUrl = capeHash
    ? boundedDataUrl(data.capes.find((item) => item.hash === capeHash)?.dataUrl)
    : '';

  const skin: PartySkin = {
    hash: account.skinHash ?? skinRecord?.hash,
    name: skinRecord?.name,
    model,
    dataUrl: skinData,
    capeDataUrl: capeDataUrl || undefined,
  };

  return {
    name: account.name,
    code: friendShortCode(account),
    email: account.email,
    accountType: account.type,
    joinedAt: Date.now(),
    status: 'ready',
    skin,
    presence,
  };
}

/** Removes local-only fields before a member crosses the network or enters an invite. */
export function publicPartyMember(member: PartyMember): PartyMember {
  return {
    name: member.name,
    code: member.code,
    accountType: member.accountType,
    joinedAt: member.joinedAt,
    status: member.status,
    skin: member.skin,
    presence: member.presence,
  };
}
