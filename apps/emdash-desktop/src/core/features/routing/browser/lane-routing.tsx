import { Badge, Button, Popover, Select, toast, Tooltip } from '@emdash/ui/react/primitives';
import { Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LaneProvider } from '@core/features/lanes/api';
import { getLanesClient } from '@core/features/lanes/api/browser/client';
import {
  SUBAGENT_TIERS,
  subagentModelLabel,
  type ModelProfileView,
  type ProfileProtocol,
  type ProfilesListing,
} from '../api';
import { getRoutingClient } from '../api/browser/client';

/** The auth select's value for "your own subscription login". */
const OWN_LOGIN = '';
/** The add-lane tier select's value for "not chosen": the role's tier, or inherit. */
const NOT_CHOSEN = '';

const PROVIDER_PROTOCOL: Record<LaneProvider, ProfileProtocol> = {
  claude: 'anthropic',
  codex: 'openai-responses',
};

const CODEX_NOTE = 'Codex has no subagent model setting.';
const APPLIES_NOTE = 'Applies when the lane next starts.';

/** Profiles a lane of this agent can run on: the protocol matches, and the profile is on. */
export function profilesForProvider(
  profiles: readonly ModelProfileView[],
  provider: LaneProvider
): ModelProfileView[] {
  return profiles.filter(
    (profile) => profile.enabled && profile.protocol === PROVIDER_PROTOCOL[provider]
  );
}

export function laneAuthLabel(
  authProfileId: string | undefined,
  profiles: readonly ModelProfileView[]
): string {
  if (!authProfileId) return 'Your login';
  const profile = profiles.find((candidate) => candidate.id === authProfileId);
  return profile ? `Key: ${profile.label}` : 'Key: removed profile';
}

/** The tier choices, plus the current value when it's a full model id. */
function tierOptions(current: string | undefined): string[] {
  const tiers: string[] = [...SUBAGENT_TIERS];
  return current && !tiers.includes(current) ? [...tiers, current] : tiers;
}

/** Loads the profile listing on mount and again whenever `refreshKey` changes. */
export function useRoutingProfiles(refreshKey?: unknown): ProfilesListing | null {
  const [listing, setListing] = useState<ProfilesListing | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getRoutingClient()
      .then((client) => client.listProfiles({}))
      .then((next) => !cancelled && setListing(next))
      .catch(() => !cancelled && setListing(null));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);
  return listing;
}

async function saveLaneRouting(input: {
  laneId: string;
  subagentModel: string | null;
  authProfileId: string | null;
}): Promise<boolean> {
  const title = "Could not change this lane's models";
  try {
    const result = await (await getLanesClient()).setLaneRouting(input);
    if (result.success) return true;
    toast.error(title, { description: result.error.message });
  } catch (error) {
    toast.error(title, { description: error instanceof Error ? error.message : String(error) });
  }
  return false;
}

function TierSelect(props: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const shown = props.options.find((option) => option.value === props.value);
  return (
    <Select.Root value={props.value} onValueChange={(next) => props.onChange(next as string)}>
      <Select.Trigger aria-label="Subagent model" className="w-full">
        <Select.Value>{shown?.label ?? props.value}</Select.Value>
      </Select.Trigger>
      <Select.Content>
        {props.options.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function AuthSelect(props: {
  value: string;
  profiles: readonly ModelProfileView[];
  onChange: (value: string) => void;
}) {
  const shown = props.profiles.find((profile) => profile.id === props.value);
  return (
    <Select.Root value={props.value} onValueChange={(next) => props.onChange(next as string)}>
      <Select.Trigger aria-label="Runs on" className="w-full">
        <Select.Value>{shown ? `Key: ${shown.label}` : 'Your subscription'}</Select.Value>
      </Select.Trigger>
      <Select.Content>
        <Select.Item value={OWN_LOGIN}>Your subscription</Select.Item>
        {props.profiles.map((profile) => (
          <Select.Item key={profile.id} value={profile.id}>
            Key: {profile.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-xs font-medium text-foreground-muted">{children}</span>;
}

/**
 * The lane header's routing badge: the subagent tier (Lever A) and what the lane runs on
 * (Lever B). Clicking opens a popover to change either. Changes apply from the next launch.
 */
export function LaneRoutingControl({
  laneId,
  provider,
  subagentModel,
  authProfileId,
}: {
  laneId: string;
  provider: LaneProvider;
  subagentModel?: string | undefined;
  authProfileId?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const listing = useRoutingProfiles(open);
  const [tier, setTier] = useState(subagentModel ?? 'inherit');
  const [auth, setAuth] = useState(authProfileId ?? OWN_LOGIN);
  const [busy, setBusy] = useState(false);
  const isCodex = provider === 'codex';
  const showAuth = listing?.enabled === true;
  const profiles = showAuth ? profilesForProvider(listing.profiles, provider) : [];
  const authText = laneAuthLabel(authProfileId, listing?.profiles ?? []);
  const tierText = subagentModelLabel(subagentModel);

  const openChange = (next: boolean) => {
    if (next) {
      setTier(subagentModel ?? 'inherit');
      setAuth(authProfileId ?? OWN_LOGIN);
    }
    setOpen(next);
  };

  const save = async () => {
    setBusy(true);
    const saved = await saveLaneRouting({
      laneId,
      subagentModel: isCodex ? (subagentModel ?? null) : tier === 'inherit' ? null : tier,
      authProfileId: showAuth ? auth || null : (authProfileId ?? null),
    });
    setBusy(false);
    if (saved) setOpen(false);
  };

  return (
    <Popover.Root open={open} onOpenChange={openChange}>
      <Tooltip.Root>
        <Tooltip.Trigger
          render={
            <Popover.Trigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 max-w-[16rem] shrink-0 px-1"
                  aria-label={`Lane models: ${isCodex ? '' : `subagents ${tierText}, `}${authText}`}
                  data-testid="lane-routing"
                />
              }
            >
              <Badge
                variant="outline"
                tone={authProfileId ? 'info' : 'neutral'}
                className="max-w-full min-w-0"
              >
                <Cpu className="hidden h-3 w-3 shrink-0 @[36rem]:inline" />
                {isCodex ? (
                  <span className="truncate">{authText}</span>
                ) : (
                  <span className="truncate">
                    {tierText}
                    <span className="hidden @[36rem]:inline">&nbsp;·&nbsp;{authText}</span>
                  </span>
                )}
              </Badge>
            </Popover.Trigger>
          }
        />
        <Tooltip.Content>
          Models for this lane: the agent's subagent tier and which key it runs on.
        </Tooltip.Content>
      </Tooltip.Root>
      <Popover.Content align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <div className="flex flex-col gap-3 p-1" data-testid="lane-routing-popover">
          <div className="text-sm font-medium text-foreground">Models for this lane</div>
          {isCodex ? (
            <p className="text-xs text-foreground-muted">{CODEX_NOTE}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <FieldLabel>Subagent model</FieldLabel>
              <TierSelect
                value={tier}
                options={tierOptions(subagentModel).map((value) => ({
                  value,
                  label: subagentModelLabel(value),
                }))}
                onChange={setTier}
              />
            </div>
          )}
          {showAuth && (
            <div className="flex flex-col gap-1">
              <FieldLabel>Runs on</FieldLabel>
              <AuthSelect value={auth} profiles={profiles} onChange={setAuth} />
            </div>
          )}
          <p className="text-xs text-foreground-muted">{APPLIES_NOTE}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}

export type LaneRoutingValue = {
  subagentModel?: string | undefined;
  authProfileId?: string | undefined;
};

/**
 * The add-lane form's routing controls. The tier select starts unchosen, which means the
 * role's tier when the role has one, and inherit otherwise.
 */
export function LaneRoutingFields({
  provider,
  value,
  onChange,
  roleSubagentModel,
}: {
  provider: LaneProvider;
  value: LaneRoutingValue;
  onChange: (next: LaneRoutingValue) => void;
  roleSubagentModel?: string | undefined;
}) {
  const listing = useRoutingProfiles();
  const showAuth = listing?.enabled === true;
  const profiles = showAuth ? profilesForProvider(listing.profiles, provider) : [];
  const staleAuth =
    value.authProfileId !== undefined &&
    listing !== null &&
    !profiles.some((profile) => profile.id === value.authProfileId);

  // A profile of the other protocol (or one that's gone) can't carry over to this agent.
  useEffect(() => {
    if (staleAuth) onChange({ ...value, authProfileId: undefined });
  }, [staleAuth, value, onChange]);

  const unchosenLabel = roleSubagentModel
    ? `Role default: ${subagentModelLabel(roleSubagentModel)}`
    : 'Subagents: Inherit';
  const options = [
    { value: NOT_CHOSEN, label: unchosenLabel },
    ...tierOptions(value.subagentModel).map((tier) => ({
      value: tier,
      label: `Subagents: ${subagentModelLabel(tier)}`,
    })),
  ];

  return (
    <>
      {provider === 'claude' && (
        <TierSelect
          value={value.subagentModel ?? NOT_CHOSEN}
          options={options}
          onChange={(next) => onChange({ ...value, subagentModel: next || undefined })}
        />
      )}
      {showAuth && (
        <AuthSelect
          value={value.authProfileId ?? OWN_LOGIN}
          profiles={profiles}
          onChange={(next) => onChange({ ...value, authProfileId: next || undefined })}
        />
      )}
    </>
  );
}
