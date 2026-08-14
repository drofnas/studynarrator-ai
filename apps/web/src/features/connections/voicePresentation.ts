import type { SpeechCatalogVoice, VoiceCatalogEntry } from "@studynarrator/shared-types";

export const UNAVAILABLE_VOICE_LOCALE = "Locale unavailable";

export interface PresentedVoice {
  voiceId: string;
  friendlyName: string;
  catalogLabel: string;
  enabled: boolean;
  favorite: boolean;
  language: string | null;
  locale: string | null;
  localeLabel: string;
  availableOnServer: boolean;
  catalogEntry: VoiceCatalogEntry;
}

export interface PresentedVoiceGroup {
  key: string;
  label: string;
  voices: PresentedVoice[];
}

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });
const PREFERRED_VOICE_LOCALE = "en-US";

function localeCode(value: string | null | undefined): string | null {
  if (!value || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(value)) return null;
  try { return Intl.getCanonicalLocales(value)[0] ?? null; }
  catch { return null; }
}

function localFriendlyName(entry: VoiceCatalogEntry | undefined): string | null {
  const firstSegment = entry?.label.split(/\s+—\s+/u)[0]?.trim();
  return firstSegment || null;
}

function serverFriendlyName(voice: SpeechCatalogVoice | undefined): string | null {
  if (!voice) return null;
  const name = voice.name?.trim();
  if (!name || collator.compare(name, voice.voiceId) === 0) return null;
  return name;
}

function compareVoices(left: PresentedVoice, right: PresentedVoice): number {
  return collator.compare(left.friendlyName, right.friendlyName) || collator.compare(left.voiceId, right.voiceId);
}

export function presentVoices(
  serverVoices: readonly SpeechCatalogVoice[],
  catalogEntries: readonly VoiceCatalogEntry[]
): PresentedVoice[] {
  const serverById = new Map(serverVoices.map((voice) => [voice.voiceId, voice]));
  const catalogById = new Map(catalogEntries.map((entry) => [entry.voiceId, entry]));
  const voiceIds = [...catalogEntries.map(({ voiceId }) => voiceId)];
  for (const { voiceId } of serverVoices) if (!catalogById.has(voiceId)) voiceIds.push(voiceId);

  return voiceIds.map((voiceId) => {
    const serverVoice = serverById.get(voiceId);
    const catalogEntry = catalogById.get(voiceId);
    const friendlyName = serverFriendlyName(serverVoice) || localFriendlyName(catalogEntry) || voiceId;
    const locale = catalogEntry?.locale ?? localeCode(serverVoice?.language) ?? null;
    const normalizedCatalogEntry: VoiceCatalogEntry = catalogEntry ?? {
      voiceId,
      label: friendlyName,
      enabled: true,
      favorite: false,
      language: serverVoice?.language ?? null,
      locale,
      accent: null,
      category: serverVoice?.gender ?? null,
      style: null,
      sampleText: null
    };
    return {
      voiceId,
      friendlyName,
      catalogLabel: catalogEntry?.label ?? friendlyName,
      enabled: normalizedCatalogEntry.enabled,
      favorite: normalizedCatalogEntry.favorite,
      language: catalogEntry?.language ?? serverVoice?.language ?? null,
      locale,
      localeLabel: locale ?? UNAVAILABLE_VOICE_LOCALE,
      availableOnServer: serverVoice !== undefined,
      catalogEntry: normalizedCatalogEntry
    };
  });
}

export function filterPresentedVoices(voices: readonly PresentedVoice[], query: string): PresentedVoice[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...voices];
  return voices.filter((voice) => [
    voice.friendlyName,
    voice.catalogLabel,
    voice.voiceId,
    voice.language ?? "",
    voice.locale ?? ""
  ].join(" ").toLocaleLowerCase().includes(normalizedQuery));
}

export function groupPresentedVoices(voices: readonly PresentedVoice[]): PresentedVoiceGroup[] {
  const favorites = voices.filter(({ favorite }) => favorite).sort(compareVoices);
  const localeGroups = new Map<string, PresentedVoice[]>();
  for (const voice of voices) {
    if (voice.favorite) continue;
    const group = localeGroups.get(voice.localeLabel) ?? [];
    group.push(voice);
    localeGroups.set(voice.localeLabel, group);
  }
  const localeLabels = [...localeGroups.keys()].sort((left, right) => {
    if (left === right) return 0;
    if (left === PREFERRED_VOICE_LOCALE) return -1;
    if (right === PREFERRED_VOICE_LOCALE) return 1;
    if (left === UNAVAILABLE_VOICE_LOCALE) return 1;
    if (right === UNAVAILABLE_VOICE_LOCALE) return -1;
    return collator.compare(left, right);
  });
  return [
    ...(favorites.length === 0 ? [] : [{ key: "favorites", label: "Favorites", voices: favorites }]),
    ...localeLabels.map((label) => ({ key: `locale:${label}`, label, voices: localeGroups.get(label)!.sort(compareVoices) }))
  ];
}

export function voiceOptionLabel(voice: PresentedVoice): string {
  return `${voice.friendlyName} (${voice.voiceId} | ${voice.localeLabel})`;
}
