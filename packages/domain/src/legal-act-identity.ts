export interface LegalActIdentityInput {
  celexId?: string;
  cellarId?: string;
  officialUri?: string;
}

export type LegalActIdentity =
  | { kind: "CELEX"; value: string }
  | { kind: "CELLAR"; value: string }
  | { kind: "OFFICIAL_URI"; value: string };

export interface NormalizedLegalActIdentityInput {
  celexId?: string;
  cellarId?: string;
  officialUri?: string;
}

export function normalizeLegalActIdentityInput(
  input: LegalActIdentityInput
): NormalizedLegalActIdentityInput {
  const celexId = normalizeCelexId(input.celexId);
  const cellarId = normalizeCellarId(input.cellarId);
  const officialUri = normalizeOfficialUri(input.officialUri);

  return {
    ...(celexId ? { celexId } : {}),
    ...(cellarId ? { cellarId } : {}),
    ...(officialUri ? { officialUri } : {})
  };
}

export function resolveLegalActIdentity(input: LegalActIdentityInput): LegalActIdentity {
  const normalized = normalizeLegalActIdentityInput(input);

  if (normalized.celexId) {
    return { kind: "CELEX", value: normalized.celexId };
  }

  if (normalized.cellarId) {
    return { kind: "CELLAR", value: normalized.cellarId };
  }

  if (normalized.officialUri) {
    return { kind: "OFFICIAL_URI", value: normalized.officialUri };
  }

  throw new Error("Candidate legal act requires CELEX ID, CELLAR ID, or official URI");
}

export function legalActIdentityKey(identity: LegalActIdentity): string {
  return `${identity.kind}:${identity.value}`;
}

function normalizeCelexId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function normalizeCellarId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function normalizeOfficialUri(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return trimmed;
  }
}
