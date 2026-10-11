// T023 — the persona manifest (US3): the demo personas' PUBLIC identities,
// published in contracts/script/DEMO-ACCOUNTS.md. The manifest — never a
// server table — is where persona and displayName come from; the wrapped
// keys are device-local (demo vaults), their plaintext env-only (T024).

export type PersonaId = "budi" | "pakhaji";

export interface PersonaManifest {
  persona: PersonaId;
  displayName: string;
  /** The seeded account — 004's published address, asserted at unwrapping. */
  address: `0x${string}`;
}

export const PERSONAS: Record<PersonaId, PersonaManifest> = {
  budi: {
    persona: "budi",
    displayName: "Budi · Ngawi",
    address: "0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD",
  },
  pakhaji: {
    persona: "pakhaji",
    displayName: "Pak Haji",
    address: "0x127BD57eA26e6F5eee15efe8b5b495ae539d82Ea",
  },
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isPersonaId(value: unknown): value is PersonaId {
  return value === "budi" || value === "pakhaji";
}

/** Integrity check for the manifest itself — cheap and constant under test. */
export function manifestIsSane(manifest: PersonaManifest): boolean {
  return (
    isPersonaId(manifest.persona) &&
    manifest.displayName.length > 0 &&
    ADDRESS_RE.test(manifest.address)
  );
}
