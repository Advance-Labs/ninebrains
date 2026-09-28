import { createScope } from '@emdash/shared/concurrency';
import { when } from 'mobx';
import { useEffect } from 'react';
import {
  conversationTabKindForTask,
  getConversationsForTask,
} from '@core/features/conversations/api/browser/conversation-selectors';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { registerNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';

export function useRegisterNotificationOpenHandlers(): void {
  const { navigate } = useNavigate();

  useEffect(() => {
    // Disposal registry, not event dispatch: `when` disposers accumulate per
    // handled notification and are only torn down together on unmount.
    const scope = createScope({ label: 'notification-open-handlers' });
    scope.add(
      registerNotificationOpenHandler('task', (target) => {
        navigate(taskViewDef({ projectId: target.projectId, taskId: target.taskId }));
        const { conversationId } = target;
        if (!conversationId) return;

        const dispose = when(
          // Wait for the conversation to load too, so its type resolves and we open the
          // matching tab kind. Panes key by (kind, conversationId): opening 'conversation'
          // for an ACP chat misses the existing 'acp-chat' tab and spawns a new one.
          () =>
            !!getTaskComposition(target.projectId, target.taskId) &&
            !!getConversationsForTask(target.taskId)?.conversations.get(conversationId),
          () => {
            getTaskComposition(target.projectId, target.taskId)?.paneLayout.open(
              conversationTabKindForTask(target.taskId, conversationId),
              { conversationId },
              { preview: false }
            );
          },
          { timeout: 10_000 }
        );
        scope.add(dispose);
      })
    );

    scope.add(
      registerNotificationOpenHandler('update', () => {
        void getUpdateStore().install();
      })
    );
    scope.add(registerNotificationOpenHandler('none', () => {}));

    return () => {
      void scope.dispose();
    };
  }, [navigate]);
}
