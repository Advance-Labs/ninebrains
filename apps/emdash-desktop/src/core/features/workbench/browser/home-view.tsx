import { menuItemBase } from '@emdash/ui/styles/recipes/menu-item';
import { FolderOpen, Github, Network, Plus, Server, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';
import { Fragment } from 'react';
import { plannerViewDef } from '@core/features/planner/contributions/views';
import { getProjectManagerStore } from '@core/features/projects/api/browser/stores/project-selectors';
import { homeViewDef } from '@core/features/workbench/contributions/views';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { EmdashShimmerLogo } from '@core/primitives/app-identity/browser/emdash-shimmer-logo';
import { Shortcut } from '@core/primitives/keybindings/browser/shortcut';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { useArrowKeyNavigation } from '@core/primitives/react-hooks/browser/use-arrow-key-navigation';
import { cn } from '@core/primitives/styling/browser/cn';
import { useTheme } from '@core/primitives/theme/browser';
import { defineViewRuntime } from '@core/primitives/views/react';

const PROJECT_ACTIONS = [
  {
    label: 'Open project',
    description: 'Create a project from an existing local directory',
    icon: FolderOpen,
    modalArgs: { strategy: 'local', mode: 'pick' },
  },
  {
    label: 'Create repository',
    description: 'Create a project and repository on GitHub',
    icon: Plus,
    modalArgs: { strategy: 'local', mode: 'create' },
  },
  {
    label: 'Clone from GitHub',
    description: 'Clone a GitHub repository to work on locally',
    icon: Github,
    modalArgs: { strategy: 'local', mode: 'clone' },
  },
  {
    label: 'Add remote project',
    description: 'Create a project on a remote SSH server',
    icon: Server,
    modalArgs: { strategy: 'ssh', mode: 'pick' },
  },
] as const;

const HOME_ACTIONS = [
  ...PROJECT_ACTIONS.map((action) => ({ ...action, kind: 'project' as const })),
  {
    kind: 'planner' as const,
    label: 'Open Planner',
    description: 'Draw a job plan, then run it across the lanes',
    icon: Network,
  },
];

export const HomeMainPanel = observer(function HomeMainPanel() {
  const openAddProjectModal = useOpenModal('addProjectModal');
  const { navigate } = useNavigate();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'emdark';
  const projects = getProjectManagerStore().projects;
  const plannerDisabled = projects.size === 0;
  const firstProjectId = projects.keys().next().value;

  const run = (action: (typeof HOME_ACTIONS)[number]) => {
    if (action.kind === 'project') {
      void openAddProjectModal(action.modalArgs);
    } else if (firstProjectId) {
      navigate(plannerViewDef({ projectId: firstProjectId }));
    }
  };

  const { selectedIndex, setSelectedIndex } = useArrowKeyNavigation(HOME_ACTIONS.length, (index) =>
    run(HOME_ACTIONS[index])
  );

  return (
    <motion.div
      className="flex h-full flex-col overflow-y-auto bg-background text-foreground"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div className="container mx-auto flex min-h-full max-w-6xl flex-1 flex-col justify-center px-8 py-8">
        <div className="mb-3 text-center">
          <div className="mb-3 flex items-center justify-center">
            <EmdashShimmerLogo
              height={32}
              color={isDark ? 'var(--color-background-2)' : 'var(--color-foreground)'}
              shimmerColor={isDark ? 'white' : 'var(--color-foreground-passive)'}
            />
          </div>
        </div>
        <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-1">
          {HOME_ACTIONS.map((action, i) => (
            <Fragment key={action.label}>
              {i === PROJECT_ACTIONS.length && (
                <div role="separator" className="my-1 border-t border-border" />
              )}
              <HomeActionTile
                label={action.label}
                description={
                  action.kind === 'planner' && plannerDisabled
                    ? 'Add a project first'
                    : action.description
                }
                icon={action.icon}
                isSelected={i === selectedIndex}
                disabled={action.kind === 'planner' && plannerDisabled}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => run(action)}
              />
            </Fragment>
          ))}
        </div>
        {plannerDisabled && (
          <p
            data-testid="home-first-run-hint"
            className="mx-auto mt-6 max-w-md text-center text-xs text-foreground-passive"
          >
            New here? Add a project, then open the Planner to start your first agent.
          </p>
        )}
      </div>
    </motion.div>
  );
});

function HomeActionTile({
  label,
  description,
  icon: Icon,
  isSelected,
  disabled = false,
  onMouseEnter,
  onClick,
}: {
  label: string;
  description: string;
  icon: LucideIcon;
  isSelected: boolean;
  disabled?: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        menuItemBase({ fullWidth: true }),
        'justify-between hover:bg-background-1',
        isSelected && 'bg-background-1',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-inherit'
      )}
    >
      <div className="flex items-center gap-3">
        <Icon className="size-7 shrink-0 text-foreground-passive" strokeWidth={1} />
        <div className="flex flex-col gap-1 text-left">
          <span
            className={cn(
              'text-sm whitespace-nowrap text-foreground-muted transition-colors',
              isSelected && !disabled && 'text-foreground'
            )}
          >
            {label}
          </span>
          <span className="text-xs text-foreground-passive">{description}</span>
        </div>
      </div>
      {isSelected && !disabled && <Shortcut hotkey="Enter" variant="keycaps" />}
    </button>
  );
}

export const homeViewRuntime = defineViewRuntime(homeViewDef, {
  slots: {
    wrap: Fragment,
    main: HomeMainPanel,
  },
});
