import { observable, runInAction } from 'mobx';

/** Whether the Brain drawer is open. Shared by the titlebar toggle, the main panel, and the intro. */
export const brainDrawer = observable({ open: false });

export const setDrawerOpen = (open: boolean) => runInAction(() => (brainDrawer.open = open));

/** Opens the Brain drawer from elsewhere in the lanes feature (e.g. the first-run intro). */
export const openBrainDrawer = () => setDrawerOpen(true);
