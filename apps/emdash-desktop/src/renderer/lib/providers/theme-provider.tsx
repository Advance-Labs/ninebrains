import { useCallback, type ReactNode } from 'react';
import { useAppSettingsKey } from '@core/features/settings/api/browser/use-app-settings-key';
import { applyThemeToAll } from '@core/features/terminals/api/browser/pty/pty';
import { ThemeProvider as CoreThemeProvider } from '@core/primitives/theme/browser';

export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  const { value, isLoading, update } = useAppSettingsKey('theme');
  const { value: systemSlots } = useAppSettingsKey('systemThemeSlots');
  const handleThemeApplied = useCallback(() => applyThemeToAll(), []);

  return (
    <CoreThemeProvider
      theme={value ?? null}
      systemSlots={systemSlots}
      isLoading={isLoading}
      onThemeChange={update}
      onThemeApplied={handleThemeApplied}
    >
      {children}
    </CoreThemeProvider>
  );
}
