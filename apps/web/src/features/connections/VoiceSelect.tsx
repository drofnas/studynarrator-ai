import {
  groupPresentedVoices,
  voiceOptionLabel,
  type PresentedVoice,
} from "./voicePresentation.js";

interface VoiceSelectProps {
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string | undefined;
  value: string;
  voices: readonly PresentedVoice[];
  disabled?: boolean;
  emptyOption?: string | undefined;
  /** Marks this voice with "*" as the script's default for the speaker. */
  scriptDefaultVoiceId?: string | undefined;
  onChange: (voiceId: string) => void;
}

export function VoiceSelect({
  id,
  value,
  voices,
  disabled = false,
  emptyOption,
  scriptDefaultVoiceId,
  onChange,
  ...accessible
}: VoiceSelectProps) {
  const groups = groupPresentedVoices(voices);
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      {...accessible}
    >
      {emptyOption === undefined ? null : (
        <option value="">{emptyOption}</option>
      )}
      {groups.map((group) => (
        <optgroup key={group.key} label={group.label}>
          {group.voices.map((voice) => (
            <option key={voice.voiceId} value={voice.voiceId}>
              {voice.voiceId === scriptDefaultVoiceId
                ? `* ${voiceOptionLabel(voice)} (script default)`
                : voiceOptionLabel(voice)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
