import { toast } from '@emdash/ui/react/primitives';
import { getBrainClient } from '../api/browser/client';

/** The global STOP, shared by the `brain.stopAll` command and the lanes-view button. */
export async function stopAllAgentWork(): Promise<void> {
  try {
    const result = await (await getBrainClient()).stopAll();
    if (!result.success) {
      toast.error('STOP failed', { description: result.error.message });
      return;
    }
    const { killedRuns, stoppedLanes } = result.data;
    toast.success('Stopped all agent work', {
      description: `${killedRuns} run(s) killed, ${stoppedLanes} lane(s) stopped. Dispatch stays paused until you clear STOP.`,
    });
  } catch (error) {
    toast.error('STOP failed', { description: error instanceof Error ? error.message : String(error) });
  }
}
