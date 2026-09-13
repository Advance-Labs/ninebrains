import type { Result } from '@emdash/shared';
import { ConfirmationDialog } from '@emdash/ui/react/components';
import { PageLayout, SettingsSection } from '@emdash/ui/react/patterns';
import { Alert, Badge, Button, Tooltip, toast } from '@emdash/ui/react/primitives';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import type {
  ConnectionTest,
  ModelProfileView,
  ProfileKind,
  ProfilesListing,
  RoutingError,
  Vendor,
} from '../api';
import { getRoutingClient, type RoutingClient } from '../api/browser/client';
import {
  AddProfileForm,
  KEY_NOTE,
  KeyInput,
  TIER_LABELS,
  type SaveProfile,
} from './add-profile-form';

const KIND_LABELS: Record<ProfileKind, string> = {
  'anthropic-api': 'Anthropic API',
  'openai-api': 'OpenAI API',
  'anthropic-compatible': 'Anthropic-compatible',
  'openai-responses-compatible': 'Responses-compatible',
  bedrock: 'Bedrock',
  vertex: 'Vertex',
  foundry: 'Foundry',
  local: 'Local',
};
const TEST_LABELS: Record<ConnectionTest['status'], string> = {
  ok: 'Connected',
  'auth-failed': 'Key refused',
  'not-found': 'Not found',
  'rate-limited': 'Rate limited',
  unreachable: 'Unreachable',
  error: 'Error',
};

export type ProfileTestState = ConnectionTest | 'testing';

export type ModelsSettingsPanelProps = {
  /** Null while loading. */
  listing: ProfilesListing | null;
  tests?: Readonly<Record<string, ProfileTestState>>;
  onSaveProfile: SaveProfile;
  onTest: (profileId: string) => void;
  onSetKey: (profileId: string, key: string) => Promise<boolean>;
  onClearKey: (profileId: string) => void;
  onDelete: (profileId: string) => Promise<void>;
};

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function HintBadge({
  tone,
  label,
  hint,
}: {
  tone: 'warning' | 'neutral';
  label: string;
  hint: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={<span className="inline-flex" />}>
        <Badge tone={tone}>{label}</Badge>
      </Tooltip.Trigger>
      <Tooltip.Content className="max-w-72">{hint}</Tooltip.Content>
    </Tooltip.Root>
  );
}

function TestResult({ state }: { state: ProfileTestState | undefined }) {
  if (!state) return null;
  if (state === 'testing') {
    return (
      <p role="status" className="text-xs text-foreground-muted">
        Testing…
      </p>
    );
  }
  return (
    <p
      role="status"
      data-status={state.status}
      className={cn(
        'text-xs',
        state.status === 'ok' ? 'text-foreground-success' : 'text-foreground-warning'
      )}
    >
      {TEST_LABELS[state.status]}: {state.message}
    </p>
  );
}

function ProfileRow({
  profile,
  vendor,
  test,
  onTest,
  onSetKey,
  onClearKey,
  onDelete,
}: {
  profile: ModelProfileView;
  vendor: Vendor | undefined;
  test: ProfileTestState | undefined;
  onTest: () => void;
  onSetKey: (key: string) => Promise<boolean>;
  onClearKey: () => void;
  onDelete: () => Promise<void>;
}) {
  const [replacing, setReplacing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);
  const saveKey = async () => {
    const key = draft;
    setDraft('');
    if (await onSetKey(key)) setReplacing(false);
  };
  const meta = [
    KIND_LABELS[profile.kind],
    vendor?.label ?? (profile.kind === 'local' ? 'This machine' : 'Unknown vendor'),
    hostOf(profile.baseUrl),
    profile.model ?? 'no model set',
    `${TIER_LABELS[profile.tier]} tier`,
  ].join(' · ');

  return (
    <div className="flex flex-col gap-2 px-3 py-3" data-testid="model-profile">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{profile.label}</span>
        <Badge tone={profile.hasKey ? 'success' : 'neutral'}>
          {profile.hasKey ? 'Key set' : 'No key'}
        </Badge>
        {profile.unsupported && (
          <HintBadge
            tone="warning"
            label="Not supported by Anthropic"
            hint="Anthropic does not support Claude Code on non-Claude models. Some features may not work."
          />
        )}
        {!profile.priced && (
          <HintBadge
            tone="neutral"
            label="Unpriced"
            hint="No prices set, so this profile can't run unattended."
          />
        )}
        {!profile.enabled && <Badge variant="outline">Off</Badge>}
      </div>
      <div className="text-xs break-words text-foreground-muted">{meta}</div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={test === 'testing'} onClick={onTest}>
          Test connection
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setReplacing((open) => !open)}>
          {profile.hasKey ? 'Replace key' : 'Add key'}
        </Button>
        {profile.hasKey && (
          <Button size="sm" variant="ghost" onClick={onClearKey}>
            Remove key
          </Button>
        )}
        <Button size="sm" variant="destructive" onClick={() => setConfirming(true)}>
          Delete profile
        </Button>
      </div>
      <TestResult state={test} />
      {replacing && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void saveKey();
          }}
        >
          <div className="min-w-0 flex-1 basis-48">
            <KeyInput
              label={`New API key for ${profile.label}`}
              placeholder="Paste the new key"
              value={draft}
              onChange={setDraft}
            />
          </div>
          <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()}>
            Save key
          </Button>
        </form>
      )}
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${profile.label}?`}
        description="This deletes the profile and its key. Lanes that use it won't start until you switch them to another profile or to your login."
        confirmLabel="Delete profile"
        tone="destructive"
        onConfirm={async () => {
          await onDelete();
          setConfirming(false);
        }}
      />
    </div>
  );
}

function ProfilesSection(props: ModelsSettingsPanelProps & { listing: ProfilesListing }) {
  const { listing } = props;
  if (!listing.enabled) {
    return (
      <Alert.Root status="info">
        <Alert.Description>
          Model profiles are off in this build. Lanes run on your own subscription login.
        </Alert.Description>
      </Alert.Root>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-foreground-muted">
        Use your own API keys, or a model server on this machine. {KEY_NOTE}
      </p>
      {listing.profiles.length === 0 ? (
        <p className="text-sm text-foreground-muted">No profiles yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {listing.profiles.map((profile) => (
            <ProfileRow
              key={profile.id}
              profile={profile}
              vendor={listing.vendors.find((vendor) => vendor.id === profile.vendorId)}
              test={props.tests?.[profile.id]}
              onTest={() => props.onTest(profile.id)}
              onSetKey={(key) => props.onSetKey(profile.id, key)}
              onClearKey={() => props.onClearKey(profile.id)}
              onDelete={() => props.onDelete(profile.id)}
            />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Add profile</span>
        <AddProfileForm vendors={listing.vendors} onSave={props.onSaveProfile} />
      </div>
    </div>
  );
}

/** Settings → Models, fed plain data and callbacks so tests and screenshots need no wire. */
export function ModelsSettingsPanel(props: ModelsSettingsPanelProps) {
  return (
    <PageLayout>
      <PageLayout.Content>
        <PageLayout.Header
          title="Models"
          description="Choose which models your lanes use. Your own subscription login stays the default."
        />
        <div className="flex flex-col gap-6">
          <SettingsSection title="Subagent model (Lever A)" bare>
            <p className="rounded-lg border border-border px-3 py-3 text-sm text-foreground-muted">
              Each lane picks the Claude model its subagents use. Set it in the lane header, or when
              you add a lane. It's always on, uses your own Claude login and adds no API key.
              Subscription lanes accept Claude models only.
            </p>
          </SettingsSection>
          <SettingsSection title="Model profiles (your own API keys)" bare>
            {props.listing ? (
              <ProfilesSection {...props} listing={props.listing} />
            ) : (
              <p className="text-sm text-foreground-muted">Loading…</p>
            )}
          </SettingsSection>
        </div>
      </PageLayout.Content>
    </PageLayout>
  );
}

/** Keeps a typed key out of any message shown to the user (SEC-40). */
function redact(message: string, secret: string | undefined): string {
  return secret ? message.split(secret).join('[key]') : message;
}

async function run<T>(
  title: string,
  action: (client: RoutingClient) => Promise<Result<T, RoutingError>>,
  secret?: string
): Promise<{ data: T } | undefined> {
  try {
    const result = await action(await getRoutingClient());
    if (result.success) return { data: result.data };
    toast.error(title, { description: redact(result.error.message, secret) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast.error(title, { description: redact(message, secret) });
  }
  return undefined;
}

export function ModelsSettingsView() {
  const [listing, setListing] = useState<ProfilesListing | null>(null);
  const [tests, setTests] = useState<Record<string, ProfileTestState>>({});
  const refresh = useCallback(async () => {
    try {
      setListing(await (await getRoutingClient()).listProfiles({}));
    } catch (error) {
      toast.error('Could not load model profiles', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <ModelsSettingsPanel
      listing={listing}
      tests={tests}
      onSaveProfile={async (input, key) => {
        const saved = await run('Could not save the profile', (c) => c.saveProfile(input));
        if (!saved) return false;
        const stored = key
          ? await run(
              'The profile was saved, but the key was not stored',
              (c) => c.setProfileKey({ profileId: saved.data.profileId, key }),
              key
            )
          : { data: undefined };
        await refresh();
        return Boolean(stored);
      }}
      onTest={(profileId) => {
        setTests((current) => ({ ...current, [profileId]: 'testing' }));
        void run('Could not test the connection', (c) => c.testConnection({ profileId })).then(
          (result) =>
            setTests((current) => {
              const next = { ...current };
              if (result) next[profileId] = result.data;
              else delete next[profileId];
              return next;
            })
        );
      }}
      onSetKey={async (profileId, key) => {
        const stored = await run(
          'Could not store the key',
          (c) => c.setProfileKey({ profileId, key }),
          key
        );
        await refresh();
        return Boolean(stored);
      }}
      onClearKey={(profileId) =>
        void run('Could not remove the key', (c) => c.clearProfileKey({ profileId })).then(refresh)
      }
      onDelete={async (profileId) => {
        await run('Could not delete the profile', (c) => c.deleteProfile({ profileId }));
        await refresh();
      }}
    />
  );
}
