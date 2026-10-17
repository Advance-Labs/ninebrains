import { Button, DropdownMenu, Tooltip, toast } from '@emdash/ui/react/primitives';
import { Brain, ChevronDown, MessageSquarePlus, Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';

/**
 * The "+" rendered after the last tab in the tab strip (browser-tab idiom).
 * Opens the create-conversation modal into this pane, so in a split layout it
 * doubles as "create the conversation here".
 */
export const NewConversationTabButton = observer(function NewConversationTabButton() {
  const { projectId, taskId } = useTaskViewContext();
  const { pane } = usePaneContext();
  const taskView = useTaskComposition();
  const openCreateConversationModal = useOpenModal('createConversationModal');

  const handleCreateConversation = () => {
    void (async () => {
      const outcome = await openCreateConversationModal({ projectId, taskId });
      if (!outcome.success) return;
      const { conversationId, type } = outcome.data;
      if (type === 'acp') {
        pane.open('acp-chat', { conversationId, preview: false });
      } else {
        pane.open('conversation', { conversationId, preview: false });
      }
    })();
  };

  // Ninebrains: the Brain TUI opens as a tab in this pane, beside the conversations
  // (UPSTREAM-PATCHES 80).
  const handleOpenBrain = () => {
    void taskView
      .openBrainTerminal((terminalId) => pane.open('terminal', { terminalId }))
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : 'Could not open the Brain TUI');
      });
  };

  return (
    <div className="flex items-center">
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button
            size="sm"
            icon
            variant="ghost"
            className="rounded-r-none"
            onClick={handleCreateConversation}
            aria-label="New conversation"
          >
            <Plus className="size-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          New Conversation <BoundShortcut command="task.newConversation" variant="keycaps" />
        </Tooltip.Content>
      </Tooltip.Root>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <Button
              size="sm"
              icon
              variant="ghost"
              className="w-5 rounded-l-none px-0"
              aria-label="More new tab options"
            />
          }
        >
          <ChevronDown className="size-3" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" className="w-48">
          <DropdownMenu.Item onClick={handleCreateConversation}>
            <MessageSquarePlus />
            New conversation
          </DropdownMenu.Item>
          <DropdownMenu.Item
            disabled={!taskView.isLocalWorkspace}
            title={taskView.isLocalWorkspace ? undefined : 'The Brain TUI only runs in local tasks'}
            onClick={handleOpenBrain}
          >
            <Brain />
            Brain TUI
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  );
});
