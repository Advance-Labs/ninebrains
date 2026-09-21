import type { TuiUsageLimit } from '@emdash/core/runtimes/tui-agents/api';
import type { AgentProviderId } from '@emdash/plugins/agents/types';
import { Alert, Button, toast } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { hostRefFromConnectionId } from '@core/features/agents/api/browser/client';
import { useAgentInstallationStatuses } from '@core/features/agents/api/browser/use-agent-installation-statuses';
import type {
  ConversationManagerStore,
  ConversationStore,
} from '@core/features/conversations/api/browser/conversation-manager';
import { nextDefaultConversationTitle } from '@core/features/conversations/api/browser/conversation-title-utils';
import {
  getTaskStore,
  taskDisplayName,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { copyTextToClipboard } from '@core/primitives/desktop-host/browser/host-client';
import { log } from '@core/primitives/logging/browser/logger';

const FALLBACK_PROVIDER: AgentProviderId = 'freebuff';

/**
 * Freebuff takes no prompt argument, so the handoff travels by clipboard: the
 * note tells the new agent where the old one stopped and to read the worktree.
 */
export function buildFreebuffHandoff({
  taskName,
  fromProvider,
  notice,
}: {
  taskName: string | undefined;
  fromProvider: string;
  notice: string;
}): string {
  return [
    `I'm continuing a task that ${fromProvider} was working on in this worktree until it hit its usage limit ("${notice}").`,
    taskName ? `The task: ${taskName}.` : null,
    'Start by reading `git status` and `git diff` to see what has been done so far, then carry on from there. Ask me if the goal is unclear.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n\n');
}

export const UsageLimitBanner = observer(function UsageLimitBanner({
  projectId,
  taskId,
  conversation,
  manager,
  usageLimit,
  connectionId,
}: {
  projectId: string;
  taskId: string;
  conversation: ConversationStore;
  manager: ConversationManagerStore;
  usageLimit: TuiUsageLimit;
  connectionId: string | undefined;
}) {
  const taskView = useTaskComposition();
  const {
    data: statuses,
    install,
    isInstalling,
  } = useAgentInstallationStatuses(hostRefFromConnectionId(connectionId));
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [isContinuing, setIsContinuing] = useState(false);

  if (dismissedAt === usageLimit.detectedAt) return null;

  const fallbackInstalled =
    statuses?.find((status) => status.id === FALLBACK_PROVIDER)?.status === 'available';

  const continueInFallback = async () => {
    setIsContinuing(true);
    try {
      const handoff = buildFreebuffHandoff({
        taskName: taskDisplayName(getTaskStore(projectId, taskId)),
        fromProvider: conversation.data.providerId,
        notice: usageLimit.message,
      });
      await copyTextToClipboard(handoff);
      const id = crypto.randomUUID();
      await manager.createConversation({
        id,
        projectId,
        taskId,
        provider: FALLBACK_PROVIDER,
        title: nextDefaultConversationTitle(
          FALLBACK_PROVIDER,
          Array.from(manager.conversations.values(), (store) => store.data)
        ),
        type: 'pty',
      });
      taskView.paneLayout.open('conversation', { conversationId: id }, { preview: false });
      taskView.setFocusedRegion('main');
      setDismissedAt(usageLimit.detectedAt);
      toast('Handoff note copied. Paste it into Freebuff to pick up where you left off.');
    } catch (error) {
      log.warn('UsageLimitBanner: failed to continue in Freebuff', { error });
      toast('Could not start Freebuff. Try creating the conversation from the + menu.');
    } finally {
      setIsContinuing(false);
    }
  };

  return (
    <Alert.Root
      status="warning"
      className="absolute inset-x-2 top-2 z-20 shadow-sm"
      onDismiss={() => setDismissedAt(usageLimit.detectedAt)}
    >
      <Alert.Title>Usage limit reached</Alert.Title>
      <Alert.Description>
        {usageLimit.message} Keep going for free in Freebuff, in this same worktree.
      </Alert.Description>
      <Alert.Action>
        {fallbackInstalled ? (
          <Button
            variant="primary"
            size="sm"
            disabled={isContinuing}
            onClick={() => void continueInFallback()}
          >
            Continue in Freebuff
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={isInstalling || statuses === undefined}
            onClick={() => install({ id: FALLBACK_PROVIDER })}
          >
            {isInstalling ? 'Installing Freebuff…' : 'Install Freebuff'}
          </Button>
        )}
      </Alert.Action>
    </Alert.Root>
  );
});
