import { Cpu } from 'lucide-react';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { ModelsSettingsView } from '../browser/models-settings-view';

export const modelsSettingsPage = defineSettingsPageContribution({
  id: 'models',
  label: 'Models',
  icon: <Cpu size={14} />,
  component: ModelsSettingsView,
} satisfies SettingsPageContribution<SettingsPageTab>);
