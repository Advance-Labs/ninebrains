import { type ReactNode } from 'react';
import { arenaViewDef } from '@core/features/arena/contributions/views';
import { Titlebar } from '@core/features/workbench/contributions/browser/Titlebar';
import { defineViewRuntime } from '@core/primitives/views/react';
import { ArenaDashboard } from './arena-dashboard';

export function ArenaViewWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function ArenaTitlebar() {
  return <Titlebar leftSlot={<span className="text-sm font-medium">Arena</span>} />;
}

export function ArenaMainPanel() {
  return <ArenaDashboard />;
}

export const arenaViewRuntime = defineViewRuntime(arenaViewDef, {
  slots: {
    wrap: ArenaViewWrapper,
    titlebar: ArenaTitlebar,
    main: ArenaMainPanel,
  },
});
