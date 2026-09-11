import { Package } from 'lucide-react';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { PacksView } from '../browser/packs-view';

export const packsSettingsPage = defineSettingsPageContribution({
  id: 'packs',
  label: 'Packs',
  icon: <Package size={14} />,
  component: PacksView,
} satisfies SettingsPageContribution<SettingsPageTab>);
