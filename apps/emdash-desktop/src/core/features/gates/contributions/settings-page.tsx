import { ShieldCheck } from 'lucide-react';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { GatesSettingsView } from '../browser/gates-settings-view';

export const gatesSettingsPage = defineSettingsPageContribution({
  id: 'gates',
  label: 'Gates',
  icon: <ShieldCheck size={14} />,
  component: GatesSettingsView,
} satisfies SettingsPageContribution<SettingsPageTab>);
