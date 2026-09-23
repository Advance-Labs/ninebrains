import { MicroLabel } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';

export const UpdateSection = observer(function UpdateSection() {
  const update = getUpdateStore();

  return (
    <MicroLabel
      className="inline-flex h-6 items-center text-foreground-passive lowercase"
      title={update.currentVersion}
    >
      v{update.currentVersion}
    </MicroLabel>
  );
});
