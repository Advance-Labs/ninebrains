import { Badge, Button, Input, Select } from '@emdash/ui/react/primitives';
import { useState, type ReactNode } from 'react';
import { useOpenExternalLink } from '@core/primitives/external-links/browser';
import { cn } from '@core/primitives/styling/browser/cn';
import {
  DEFERRED_KINDS,
  modelProfileInputSchema,
  profileKeySchema,
  protocolOfKind,
  type ModelProfileInput,
  type ParsedProfileInput,
  type ProfileKind,
  type ProfileProtocol,
  type ProfileTier,
  type Vendor,
} from '../api';

export const KEY_NOTE =
  'Keys are stored in your OS keychain and are never shown again. Set a spend limit on each key at the vendor.';

export const TIER_LABELS: Record<ProfileTier, string> = {
  cheap: 'Cheap',
  standard: 'Standard',
  strong: 'Strong',
};
const TIERS: readonly ProfileTier[] = ['cheap', 'standard', 'strong'];
const PROTOCOL_LABELS: Record<ProfileProtocol, string> = {
  anthropic: 'Anthropic, for Claude Code',
  'openai-responses': 'Responses, for Codex',
};
const FIELD_NAMES: Record<string, string> = {
  label: 'Name',
  model: 'Model',
  'tierModels.opus': 'Opus model',
  'tierModels.sonnet': 'Sonnet model',
  'tierModels.haiku': 'Haiku model',
  'price.inPerMTok': 'Input price',
  'price.outPerMTok': 'Output price',
};

/** Saves the profile, then stores `key` when one was typed. True when both worked. */
export type SaveProfile = (input: ParsedProfileInput, key: string) => Promise<boolean>;

/** A write-only key field (SEC-40): never prefilled, never autocompleted. */
export function KeyInput(props: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      type="password"
      autoComplete="off"
      spellCheck={false}
      aria-label={props.label}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}

function Labeled({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', wide && 'sm:col-span-2')}>
      <span className="text-xs font-medium text-foreground-muted">{label}</span>
      {children}
    </div>
  );
}

function PickSelect<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const shown = props.options.find((option) => option.value === props.value);
  return (
    <Select.Root value={props.value} onValueChange={(next) => props.onChange(next as T)}>
      <Select.Trigger aria-label={props.label} className="w-full">
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

function firstKind(vendor: Vendor): ProfileKind {
  return vendor.kinds.find((kind) => !DEFERRED_KINDS.includes(kind)) ?? vendor.kinds[0]!;
}

const priceOf = (raw: string) => (raw.trim() === '' ? null : Number(raw));

/**
 * Adds a profile for a reviewed vendor (SEC-44). Remote vendors fix the base URL; a local
 * vendor is a preset whose URL stays editable. The key field is cleared on every submit.
 */
export function AddProfileForm({
  vendors,
  onSave,
}: {
  vendors: readonly Vendor[];
  onSave: SaveProfile;
}) {
  const usable = vendors.filter((vendor) => vendor.kinds.some((k) => !DEFERRED_KINDS.includes(k)));
  const openExternal = useOpenExternalLink();
  const [vendorId, setVendorId] = useState(usable[0]?.id ?? '');
  const vendor = usable.find((candidate) => candidate.id === vendorId) ?? usable[0];
  const [protocolPick, setProtocolPick] = useState<ProfileProtocol | null>(null);
  const [urlDraft, setUrlDraft] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [model, setModel] = useState('');
  const [tierModels, setTierModels] = useState({ opus: '', sonnet: '', haiku: '' });
  const [tier, setTier] = useState<ProfileTier>('standard');
  const [prices, setPrices] = useState({ in: '', out: '' });
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!vendor) return null;
  const kind = firstKind(vendor);
  const isLocal = kind === 'local';
  const protocol = protocolOfKind(kind) ?? protocolPick ?? vendor.protocols[0]!;
  const presetUrl = vendor.baseUrls[protocol] ?? '';
  const baseUrl = isLocal ? (urlDraft ?? presetUrl) : presetUrl;

  const pickVendor = (id: string) => {
    setVendorId(id);
    setProtocolPick(null);
    setUrlDraft(null);
  };
  const pickProtocol = (next: ProfileProtocol) => {
    setProtocolPick(next);
    setUrlDraft(null);
  };

  const submit = async () => {
    // SEC-40: the key leaves the field on every submit, whatever happens next.
    const typedKey = key.trim();
    setKey('');
    setError(null);
    const tiers = Object.fromEntries(
      Object.entries(tierModels).flatMap(([alias, id]) => (id.trim() ? [[alias, id.trim()]] : []))
    );
    const input: ModelProfileInput = {
      label: label.trim() || vendor.label,
      kind,
      vendorId: vendor.id,
      ...(isLocal ? { protocol } : {}),
      baseUrl,
      ...(model.trim() ? { model: model.trim() } : {}),
      ...(Object.keys(tiers).length > 0 ? { tierModels: tiers } : {}),
      tier,
      ...(prices.in.trim() || prices.out.trim()
        ? {
            price: {
              inPerMTok: priceOf(prices.in),
              outPerMTok: priceOf(prices.out),
              cacheReadPerMTok: null,
              cacheWritePerMTok: null,
            },
          }
        : {}),
    };
    const parsed = modelProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => {
            const name = FIELD_NAMES[issue.path.join('.')];
            return name ? `${name}: ${issue.message}` : issue.message;
          })
          .join(' ')
      );
      return;
    }
    if (typedKey) {
      const keyCheck = profileKeySchema.safeParse(typedKey);
      if (!keyCheck.success) {
        setError(`The API key ${keyCheck.error.issues[0]?.message ?? 'is not valid'}.`);
        return;
      }
    }
    setBusy(true);
    const saved = await onSave(parsed.data, typedKey);
    setBusy(false);
    if (saved) {
      setLabel('');
      setModel('');
      setTierModels({ opus: '', sonnet: '', haiku: '' });
      setPrices({ in: '', out: '' });
    }
  };

  return (
    <form
      aria-label="Add profile"
      className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Labeled label="Vendor">
        <PickSelect
          label="Vendor"
          value={vendor.id}
          options={usable.map((v) => ({ value: v.id, label: v.label }))}
          onChange={pickVendor}
        />
      </Labeled>
      <Labeled label="Name">
        <Input
          aria-label="Name"
          placeholder={vendor.label}
          value={label}
          maxLength={80}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Labeled>
      <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-muted sm:col-span-2">
        {vendor.note && <span className="basis-full">{vendor.note}</span>}
        <a
          href={vendor.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline"
          onClick={(event) => {
            if (!openExternal) return;
            event.preventDefault();
            openExternal(vendor.docsUrl);
          }}
        >
          Docs
        </a>
        {vendor.termsUrl === null && <Badge variant="outline">Terms not reviewed</Badge>}
      </div>
      {isLocal && (
        <Labeled label="Protocol">
          <PickSelect
            label="Protocol"
            value={protocol}
            options={vendor.protocols.map((p) => ({ value: p, label: PROTOCOL_LABELS[p] }))}
            onChange={pickProtocol}
          />
        </Labeled>
      )}
      <Labeled label="Base URL" wide={!isLocal}>
        <Input
          aria-label="Base URL"
          value={baseUrl}
          readOnly={!isLocal}
          spellCheck={false}
          onChange={(event) => setUrlDraft(event.target.value)}
        />
      </Labeled>
      <Labeled label="Model">
        <Input
          aria-label="Model"
          placeholder="Optional, for example claude-sonnet-5"
          value={model}
          spellCheck={false}
          onChange={(event) => setModel(event.target.value)}
        />
      </Labeled>
      <Labeled label="Tier">
        <PickSelect
          label="Tier"
          value={tier}
          options={TIERS.map((t) => ({ value: t, label: TIER_LABELS[t] }))}
          onChange={setTier}
        />
      </Labeled>
      {protocol === 'anthropic' && (
        <Labeled label="Tier models (optional)" wide>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(['opus', 'sonnet', 'haiku'] as const).map((alias) => (
              <Input
                key={alias}
                aria-label={`${alias} model`}
                placeholder={`${alias[0]!.toUpperCase()}${alias.slice(1)} model id`}
                value={tierModels[alias]}
                spellCheck={false}
                onChange={(event) =>
                  setTierModels((current) => ({ ...current, [alias]: event.target.value }))
                }
              />
            ))}
          </div>
        </Labeled>
      )}
      <Labeled label="Price in, USD per million tokens">
        <Input
          aria-label="Input price"
          inputMode="decimal"
          placeholder="Optional"
          value={prices.in}
          onChange={(event) => setPrices((current) => ({ ...current, in: event.target.value }))}
        />
      </Labeled>
      <Labeled label="Price out, USD per million tokens">
        <Input
          aria-label="Output price"
          inputMode="decimal"
          placeholder="Optional"
          value={prices.out}
          onChange={(event) => setPrices((current) => ({ ...current, out: event.target.value }))}
        />
      </Labeled>
      <Labeled label={isLocal ? 'API key (optional)' : 'API key'} wide>
        <KeyInput label="API key" placeholder="Paste the key" value={key} onChange={setKey} />
        <span className="text-xs text-foreground-muted">{KEY_NOTE}</span>
      </Labeled>
      {error && (
        <p role="alert" className="text-xs text-foreground-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Add profile'}
        </Button>
      </div>
    </form>
  );
}
