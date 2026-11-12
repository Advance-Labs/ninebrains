import { SelectableCard } from '@emdash/ui/react/primitives';
import { Monitor, Moon, Sun, Zap, type LucideIcon } from 'lucide-react';
import React from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import type { Theme } from '@core/primitives/app-settings/api';
import { captureTelemetry } from '@core/primitives/telemetry/browser/telemetry-client';
import { SYSTEM_SLOT_OPTIONS, useTheme } from '@core/primitives/theme/browser';

const themeOptions: Array<{
  value: Theme;
  label: string;
  ariaLabel: string;
  icon: LucideIcon;
}> = [
  { value: null, label: 'System', ariaLabel: 'Set theme to system preference', icon: Monitor },
  {
    value: 'emlight',
    label: 'Ninebrains Light',
    ariaLabel: 'Set theme to Ninebrains Light',
    icon: Sun,
  },
  {
    value: 'emdark',
    label: 'Ninebrains Dark',
    ariaLabel: 'Set theme to Ninebrains Dark',
    icon: Moon,
  },
  {
    value: 'emhardstyle',
    label: 'Hardstyle',
    ariaLabel: 'Set theme to Hardstyle',
    icon: Zap,
  },
];

const ThemeCard: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const { value: slots, update: updateSlots } = useAppSettingsKey('systemThemeSlots');

  const handleSetTheme = (next: Theme) => {
    if (theme !== next) {
      captureTelemetry('setting_changed', { setting: 'theme' });
    }
    setTheme(next);
  };

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6.5rem,1fr))] gap-2 text-sm">
      {themeOptions.map(({ value, label, ariaLabel, icon: Icon }) => (
        <SelectableCard
          key={label}
          selected={theme === value}
          onClick={() => handleSetTheme(value)}
          aria-label={ariaLabel}
          aria-pressed={theme === value}
          className="min-h-24"
        >
          <span className="flex flex-col items-center justify-center gap-2 px-2 py-2.5 text-sm font-medium sm:px-3">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="text-center">{label}</span>
          </span>
        </SelectableCard>
      ))}
      {theme === null &&
        slots &&
        (['light', 'dark'] as const).map((polarity) => {
          const options = SYSTEM_SLOT_OPTIONS[polarity];
          // A slot with a single candidate has nothing to choose.
          if (options.length < 2) return null;
          return (
            <label
              key={polarity}
              className="col-span-full flex items-center justify-between gap-3 text-sm"
            >
              <span>When the system is {polarity}</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1"
                value={slots[polarity]}
                onChange={(e) =>
                  updateSlots({ ...slots, [polarity]: e.target.value as typeof slots.dark })
                }
              >
                {options.map((id) => (
                  <option key={id} value={id}>
                    {themeOptions.find((o) => o.value === id)?.label ?? id}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
    </div>
  );
};

export default ThemeCard;
