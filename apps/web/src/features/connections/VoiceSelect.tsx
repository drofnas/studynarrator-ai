import { groupPresentedVoices, voiceOptionLabel, type PresentedVoice } from "./voicePresentation.js";

export interface VoiceSelectProps {
  id?: string;
  "aria-label"?: string;
  value: string;
  voices: readonly PresentedVoice[];
  disabled?: boolean;
  emptyOption?: string | undefined;
  onChange: (voiceId: string) => void;
}

export function VoiceSelect({ id, value, voices, disabled = false, emptyOption, onChange, ...accessible }: VoiceSelectProps) {
  const groups = groupPresentedVoices(voices);
  return <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} {...accessible}>
    {emptyOption === undefined ? null : <option value="">{emptyOption}</option>}
    {groups.map((group) => <optgroup key={group.key} label={group.label}>
      {group.voices.map((voice) => <option key={voice.voiceId} value={voice.voiceId}>{voiceOptionLabel(voice)}</option>)}
    </optgroup>)}
  </select>;
}
