# Judging Kite — five minutes on a phone

Kite is an income-share settlement protocol: small merchants share a slice of
tomorrow's income with backers today, settled in AUSD on Monad. This feature
(F006) is the account layer — a judge goes from stranger to a working, seeded,
acting account without ever seeing crypto plumbing.

## Try the judge flow (a real phone)

1. Open the deployed app URL (the one pinned in the task notes; passkey
   ceremonies are permanently bound to that hostname).
2. Tap **Daftar** — approve the biometric prompt once. Your account exists.
   No seed phrase was shown, stored, or asked for. No extension. No custody
   signup. The key material never left your device.
3. Enter any local-format phone number (demo step — stored on your device only).
4. Verification (labeled **Demo Tool**): pick any KTP photo + selfie. They do
   not leave your device — a hash is computed locally and the relayer does the
   rest. Approval is automatic in this build.
5. Within a few seconds the home screen shows your balance in Rupiah, your
   reputation, and your active agreement.
6. Leave and come back: one biometric tap → same account, ~10 seconds.
7. **Keluar** (sign out) → **Masuk** (sign in): one ceremony, same account.

## Try it as Budi (the seeded merchant)

Budi's demo phone runs the same app: **Masuk** → one biometric ceremony → Home
shows reputation 58 and remaining 480000000 base units — the same numbers the
contract reports for `0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD`. Pak Haji's
device does the same for `0x127BD57eA26e6F5eee15efe8b5b495ae539d82Ea`
([contracts/script/DEMO-ACCOUNTS.md](contracts/script/DEMO-ACCOUNTS.md)).

On a desktop, the app is honest about being a companion: it renders the flow in
a phone-sized frame with a QR of the page address — scan it and continue on the
phone. No desktop path attempts the biometric ceremony.

## Disclosures (stated plainly; full table in [TRUST.md](TRUST.md))

- Demo personas are pre-seeded EOAs whose keys are passkey-wrapped on the demo
  devices; judge signup is pure Mera passkey → fresh address. Your own signup
  above is that fresh path — nothing about it is seeded or simulated.
- The session is bearer-like: the signed session header is valid ≤ 7 days and
  replayable within its window; nonce binding is on the roadmap. The API can
  neither custody funds nor move user funds beyond the functions in PLAN §6.2.
- Simulated parts are labeled **Demo Tool** in the UI (verification checker) or
  in code (`DEMO_MODE_NOTICE` in `apps/web/src/auth/demo-adapter.ts`, the
  one-time persona-key server `scripts/demo/prep-serve.ts`).
- Onchain state is the only authority for scores, limits, and deal state. The
  API and the app are projections you can re-derive from the contract addresses
  above.
- Labels are device-local: if you back someone (Dukung), the nickname and
  purpose you save live only in your device's storage — switch devices and the
  labels are gone, while the support itself, its balances, and its history stay
  on-chain and re-derive from the addresses above.
