import { z } from 'zod';
import { vendorSchema, type ModelProfile, type Vendor } from '../api/profile';
import bundled from './vendors.json';

/**
 * SEC-44: the bundled, reviewed vendor allowlist. A remote profile names a vendor, its kind and
 * protocol must be ones the vendor offers, and its base URL host must be one of the vendor's
 * hosts. `local` profiles need no vendor (loopback only, `baseUrlProblem`); a local vendor entry
 * is just a preset.
 */
const fileSchema = z.object({ comment: z.string().optional(), vendors: z.array(vendorSchema) });

export const VENDORS: readonly Vendor[] = fileSchema.parse(bundled).vendors;

export function findVendor(id: string | null | undefined): Vendor | undefined {
  return id ? VENDORS.find((vendor) => vendor.id === id) : undefined;
}

/** Why a profile is not allowed by the vendor list, or null. */
export function vendorProblem(
  profile: Pick<ModelProfile, 'kind' | 'vendorId' | 'protocol' | 'baseUrl'>,
  vendors: readonly Vendor[] = VENDORS
): string | null {
  if (profile.kind === 'local') {
    if (!profile.vendorId) return null;
    const preset = vendors.find((vendor) => vendor.id === profile.vendorId);
    return preset?.kinds.includes('local') ? null : 'names a vendor that is not a local preset';
  }
  const vendor = vendors.find((candidate) => candidate.id === profile.vendorId);
  if (!vendor) return 'names no reviewed vendor';
  if (!vendor.kinds.includes(profile.kind)) return `is not a ${profile.kind} vendor`;
  if (!vendor.protocols.includes(profile.protocol)) {
    return `${vendor.label} does not offer the ${profile.protocol} protocol here`;
  }
  let host: string;
  try {
    host = new URL(profile.baseUrl).hostname.toLowerCase();
  } catch {
    return 'has an invalid base URL';
  }
  return vendor.hosts.includes(host) ? null : `must use ${vendor.hosts.join(' or ')}`;
}
