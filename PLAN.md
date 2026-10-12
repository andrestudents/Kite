# Kite — PLAN

> **Fund a person, not a loan. The money splits at the exact moment income arrives — and every financing ends.**
> A backer funds working capital today. A share of each harvest is diverted automatically at settlement. Cap reached → done, forever.

Built for **Monad Metropolis**, Track 02: Consumer Products & Payments.
Everything in this repo is built during the hackathon window (see §14). Code is agent-generated; every "Done when" below is a **human-run check**.

---

## 1. Hackathon context

| | |
|---|---|
| Event | [Monad Metropolis](https://monad.xyz/developers/hackathons/metropolis) |
| Registration closes | **6 October 2026** |
| Submission deadline | **14 October 2026, 10:59 WIB** (shown as 13 Oct in US time zones) |
| Judging / winners | 14–27 Oct / 3 Nov |
| Track | **02 Consumer Products & Payments**. Core question: *"What does a financial product look like when onchain rails are leveraged as an advantage to design?"* Design is judged on an invisible blockchain: "judge harshly on any point of friction that reveals this is crypto" |
| Rubric | Founder & Market **25** · Technical 20 · Design 20 · Traction 20 · Originality 15. 45% is segment + real usage, so user testing is part of the build (§2.1, §12) |
| Deliverables | Logo · public repo shared with `metropolis@hackathon.monad.xyz` · demo video ≤ 3 min of the live product · pitch video ≤ 2 min · live link on Monad testnet with judge instructions |
| Rules | One primary track only. Existing projects allowed as long as **the submitted work is new** |
| Track prize | $30k split across 3 teams ($10k each) |
| Grand Champion | $25k, chosen across all tracks |

**Target bounties** (stack on top of the track prize)

| Bounty | Value | Hard requirement | How we meet it |
|---|---|---|---|
| Agora: Best Cross-Border Payments App on Monad | $10k | Track 02 only. Mobile app, **Mera passkey onboarding**, AUSD balance, a completed send/receive settled instantly | Passkey signup (D3), AUSD everywhere (D1), the funding leg is MY→ID: Pak Haji (KL) funds → Budi (Ngawi) receives in under a second (§3 step 3–4), and anyone sends AUSD from their balance with a gasless ERC-3009 transfer (D12, §3 step 8). The demo must show an AUSD balance on screen |
| Chainlink CRE: Best workflow with CRE | $3k | Build/**simulate**/deploy a CRE Workflow as orchestration layer | Three workflows (§7.5): WF-1 Ingest (mill payment → `receiveIncome`), WF-2 Sentinel (`completeAtTerm`), WF-3 Reconcile. Primary mode: `cre simulate` from a laptop → real testnet txs via Alchemy RPC — the bounty text explicitly allows simulate |
| Mera: Best Mera-Powered UX | $2.5k | Mera is the whole account layer, stateless test | Passkey signup, signing sessions, no seed phrase, no extension, no custody backend (D3) |
| Mera: One Passkey, Many Keys (PRF) | $2.5k | Creative **non-wallet** use of PRF-derived key material | Per-ISA deal key derived from the passkey PRF signs the seeker's ISA acceptance and the channel's season attestation — a key per deal, revocable per deal, wallet key never leaves the device (Q5: verify PRF support first; if absent → roadmap, keep the other Mera bounty) |
| Envio: Best Use of Envio | $1k | Indexer drives a real feature; derived entities score higher | Activity feeds, `/p/:id` history, reconciliation totals; `ISA`/`IncomeEvent`/`ScoreChange` derived entities |
| Alchemy: Best use of Alchemy | $1k | Meaningful integration of ≥1 service on Monad | Alchemy Monad RPC = chain access for the relayer + CRE's EVM capability |
| Monad Foundation: Best Community Team Project | $5k | Team members pick an onboarded community on their profile | DevWeb3Jogja (Indonesian community, Indonesian product). Pick it on day 1 |

**Dropped:** Aurora Intents ($5k) — the funding leg is demonstrated with testnet AUSD directly; any-chain deposits are scope risk for zero rubric points. Privy/Dynamic ($5k) — one account layer, and it's Mera (attached to three bounties). Kimi/Qwen/Hunyuan — no honest place where AI powers this product; bolted-on AI reads as decoration, and Hunyuan is Social-track-paired anyway.

---

## 2. Problem and persona

**Budi, 41**, a rice farmer in Ngawi, East Java. One hectare, two harvests a year (~Mar, ~Sep), selling to the local mill.
- Income arrives in **two lumps a year** (~Rp 24jt per harvest). Inputs — seed, fertilizer, labor — are due **before planting**, when his balance is zero.
- Banks won't lend: no payslip, no formal land title, no credit history. Fixed monthly installments are mathematically impossible in a zero-income month.
- His actual lender is the **tengkulak**: "$600 now, you sell me your harvest at my price" — ~20% under market, and the debt rolls into next season's inputs. **It is designed to never end.**
- Has a smartphone running GoPay/OVO/Dana. No crypto wallet, and does not care about crypto.

**Backer:** **Pak Haji, 52**, Budi's uncle, Javanese diaspora in Kuala Lumpur. Has remitted money home for years as *help* that never returns. Here it becomes an investment that recycles — and he never has to ask for it back.

**Why onchain?** A bank restructuring repayment per-sale at a $600 ticket size is uneconomical — the field officer costs more than the interest. Kite puts the repayment **inside the settlement**: the split executes in the same transaction the harvest payment arrives, enforced by contract state nobody can bend, and the finished record is public and portable — it follows Budi to the next mill, the next village, the next backer. The blockchain is used as an enforcement point and a portable record, not a trading venue. Settlement is instant, so the split lands on both phones while the mill clerk is still looking at the screen.

### 2.1 Segment, testing and distribution (Founder & Market 25%, Traction 20%)
- **First segment:** smallholder rice farmers in the Ngawi/Madiun corridor (East Java) financed by family diaspora in Malaysia. Named, reachable, and a behavior that already exists (*bagi hasil* — we formalize it, we don't invent it).
- **Testing before submission:** at least 5 people from the segment (or their families/diaspora relatives) run the §3 flow on their own phones, unaided. Record: time to first action, where they got stuck, what they said. Put the numbers in the write-up.
- **Next 100 users:** 1 rice mill + 2 koperasi pilot (the koperasi officer onboards farmers from a tablet — the onchain version of the field officer), plus diaspora WhatsApp communities for backers. Every completed ISA produces a public profile page, and every profile page is a referral asset.
- **Next step after the hackathon:** licensed fiat rails, OJK Regulatory Sandbox (POJK 3/2024), Sharia advisory board, then the same settlement engine for salaries → freelance payouts → SME invoices (one engine, every income stream).

---

## 3. Product: user journey (demo script, video ≤ 3 minutes)

Amounts assume **1 USD = 16,000 IDR**, fixed for the demo (§7.4). Demo ISA is hand-checkable (§6.3). Concept-board numbers were rounded; the PLAN uses **600 AUSD** so every number on screen is checkable.

```
1. Budi signs up with Face ID / fingerprint          (Mera passkey, account derived silently)
2. Verify identity: KTP photo + selfie               (demo auto-approve; operator binds identityHash)
   → the relayer tops the account up with a little MON for fees, invisibly
3. Pak Haji (second device, KL, his own passkey) opens kite.id/p/budi
   → sees ⭐ reputation, 2 bagi hasil selesai, tx proofs — no personal data
   → taps "Dukung": Rp 9.600.000 (600 AUSD) for seed, fertilizer, labor
   → the agreement is one paragraph: 20% of every harvest · max total 780 AUSD ·
     harvest fails = 0 taken · ends forever when the max is reached
   → Face ID → Active. Budi's phone: "Dukungan diterima · Rp 9,6jt" instantly
4. Budi's home: Bagi hasil card — 600 AUSD in, 0 / 780 repaid, 0%
5. Harvest day — Mitra console (mill, desktop demo tool):
   "Budi · 1 ha gabah · Rp 24jt" → [ Bayar ]
   → CRE WF-1 → receiveIncome() settles in under a second:
     → Budi +1,200 AUSD (≈ Rp 19,2jt) · Pak Haji +300 AUSD (≈ Rp 4,8jt) — same transaction
   → both phones update while the clerk watches; progress 0% → 38.5%
6. (live) "3 panen kemudian": panen 3 diverts the last 180 AUSD
   → 🎉 SELESAI screen: 3 panen · ~1.5 years · reputation 58 → 91
   → "Next season: bigger max support — and a smaller share."
7. (prepared state) failed harvest: gross 0 → nothing is diverted.
   The detail screen says it plainly: "Panen gagal? 0 rupiah diambil. Tenang."
   (overlay in the video: a fixed installment would still be due this month)
8. Budi sends AUSD to his wife's Kite account         (gasless ERC-3009, her phone shows it instantly)
9. kite.id/p/budi: 3 bagi hasil selesai, per-harvest history, tx links. No name, no documents.
   "The record follows Budi — not the mill, not the village."
```

Optional if time allows: a "what the tengkulak takes" comparison card on the education screen (20% discount per season, forever, vs 20% share with a hard cap and an end).

### Copywriting rules
- Words banned from user-facing screens: wallet, gas, chain, token, onchain transaction, seed, pending, AUSD (except in detail/breakdown rows).
- The Agora bounty needs **an AUSD balance on screen**: headline amounts in rupiah with "≈", the balance detail row shows AUSD (e.g. `Saldo Rp 19.200.000 · 1.200,00 AUSD`).
- Say **Bagi Hasil**, **Dukung**, **Partner**, **Lunas**, **Selesai**. Never say loan, debt, interest, installment. The product is profit-sharing — the words must not borrow from lending.
- Always show **why** the offer is what it is (reputation, completed deals, history) — no unexplained numbers.
- Always show the cap and the "harvest fails → 0 taken" line on the deal card. The fairness is the product; never hide it.

---

## 4. Design decisions (and why)

| # | Decision | Why |
|---|---|---|
| D1 | **AUSD is the onchain unit of account.** Principal, diversion, cap, and score are all AUSD | One currency for the whole mechanism: no oracle in the split, caps are exact. Required by the Agora bounty |
| D2 | **FX lives offchain only**, locked per quote (60-second TTL), display-only | The contract never sees IDR. The cap is locked in AUSD at signing, so Budi carries no FX risk on the deal itself |
| D3 | **Invisible account.** Mera passkey derives a plain EOA; a signing session makes in-app actions prompt-free; the relayer drips MON for fees after verification | No seed phrase, no extension, no MON to buy. Required by the Agora bounty. Gas is ~$0.0005/tx on Monad, so a drip is cheaper than a paymaster and needs no extra infra |
| D4 | **One identity, one account.** Verification binds `identityHash → wallet` in the contract | Without this, a bad actor finishes, wipes, and restarts with a fresh wallet — the reputation would mean nothing |
| D5 | **The split is atomic with income receipt.** `receiveIncome` pays backer and seeker in the same transaction | There is no state where income sits unsplit. Nothing to dodge, nothing to chase, no collector. This is the product |
| D6 | **Fairness is physics, not policy.** Terms outside bounds revert at creation: share ≤ 20%, cap ≥ 1.2×, floor honored, term ≤ 24 months | A predatory deal is not forbidden — it is *unwritable*. No competitor can outbid this, because it isn't a pricing decision |
| D7 | **Channel signatures are verified onchain.** The mill signs the purchase event; the contract checks the signature before splitting; a hash registry (`channel, ref, gross, salt`) blocks replay | The orchestration layer only transports facts — forgery reverts even if every offchain component is compromised. The registry is also the seed of the invoice-uniqueness primitive (roadmap) |
| D8 | **No default state in the harvest stream.** Failed harvest diverts zero; at `termEnd` the remainder is forgiven (`completeAtTerm`, permissionless) | There is no collateral to seize, so default machinery would be theater. Humane by design, and honest: the backer's accepted risk is that income stays low. Covenants/default belong to the salary stream (roadmap) |
| D9 | **Score = pure integer library, changes only on completion.** Anti-farming via *qualifying events*: channel-signed, ≥ 60 days apart, ≥ 10% of principal | Hand-checkable (§6.3), unfarmable by event spam, and the reputation is portable — the score is the retention loop |
| D10 | **One UUPS proxy built from ERC-7201 modules** (`KiteCore`) | Governed, Identity, ISA, Stream, Completion, Score compose one implementation; one address for the app, the indexer and `/p/:id`. A module can change without shifting another's storage |
| D11 | **All transfers are gasless ERC-3009 / permit.** Funding uses `activateWithPermit` (permit + pull principal + activate in one relayer tx); plain sends use `transferWithAuthorization` | Sender never needs MON or an approve popup. MockAUSD mirrors real AUSD's ERC-3009 + permit so app code is identical on both |
| D12 | **CRE is orchestration only — facts move, the contract decides** | WF-1 Ingest, WF-2 Sentinel, WF-3 Reconcile (§7.5). No business logic offchain; judges can verify every rule in the contract |
| D13 | **Daily offchain ↔ onchain reconciliation**, mismatch → `flagMismatch()` onchain + job exits non-zero | Fiat/purchase records live offchain; the sums must match the contract's events. Never silently repair |

---

## 5. Architecture

```
┌──────────── Budi / Pak Haji (mobile PWA · Mera passkey + signing session) ────────────┐
└──────────────┬──────────────────────────────────────┬─────────────────────────────────┘
               │ HTTPS                                │ tx (activate, completeAtTerm, send)
┌──────────────▼───── Backend (Vercel · Neon Postgres) ─────────────────────────────────┐
│ api      : one response per screen (/me, /quote, /p/:id) + public profile              │
│ channels : purchase registry (demo tool state): pending → paid → settled               │
│ relayer  : tx queue — activateWithPermit, ERC-3009 sends, bindIdentity, drip           │
│ recon    : daily cron, ledger vs chain, exit non-zero on mismatch                      │
└───────┬────────────────────────────────────────┬───────────────────────────────────────┘
        │ tx                                     │ GraphQL
┌───────▼───────── Monad testnet (10143) ────────┐   ┌───────────────────────────────────┐
│ KiteCore (UUPS: Identity·ISA·Stream·Score)     │──▶│ Envio indexer                     │
│ AUSD (Agora testnet) / MockAUSD (ERC-3009)     │   │ feeds, /p/:id history, recon sums │
└───────────────────▲────────────────────────────┘   └───────────────────────────────────┘
                    │ receiveIncome · completeAtTerm · flagMismatch
┌───────────────────┴──── CRE orchestration (cre simulate → Alchemy RPC) ───────────────┐
│ WF-1 Ingest   : HTTP ← Mitra console {purchaseRef, gross, channelSig} → receiveIncome │
│ WF-2 Sentinel : cron → completeAtTerm for ISAs past termEnd → notify                  │
│ WF-3 Reconcile: cron → ledger totals vs Envio/Alchemy chain totals → flagMismatch     │
└───────────────────▲────────────────────────────────────────────────────────────────────┘
                    │ POST purchase + mill signature
              Mitra console (/mitra — desktop, labeled "Demo Tool")
```

---

## 6. Smart contracts

Foundry, default EVM version (Monad runs Fusaka). Measure gas on Monad itself: opcodes are repriced and gas is charged on the **limit**, not gas used.

### 6.1 Contracts
| Contract | Contents |
|---|---|
| `KiteCore` | UUPS implementation behind an ERC1967 proxy, composed of the modules below |
| `modules/Governed` | Roles (ADMIN, RELAYER_ROLE, ORCHESTRATOR_ROLE, PAUSER), asymmetric pause, parameters, UUPS upgrade authorisation |
| `modules/Identity` | One identity hash per wallet, both ways; channel registry (id → name, pubkey, active) |
| `modules/ISA` | Draft, bounds check vs `offerOf`, `activateWithPermit` (escrow in → principal out to seeker → Active), cancel-before-activation |
| `modules/Stream` | `receiveIncome`: onchain channel-signature check → replay registry → atomic split → auto-complete on cap |
| `modules/Completion` | `completeAtTerm` (permissionless after termEnd, idempotent), terminal-state enforcement |
| `KiteScoring` (library) | Score + offer, pure and hand-checkable (§6.3) |
| `MockAUSD` (testnet) | ERC-20, 6 dp, **ERC-3009** + ERC-2612 permit — replaced by Agora's AUSD when the faucet is confirmed (Q1/Q2) |

### 6.2 `KiteCore` state and functions
```solidity
struct Terms   { uint256 principal; uint16 shareBps; uint16 capMult; uint64 termEnd; uint64 channelId; }
struct ISA     { Terms terms; address seeker; address backer;
                 uint256 remaining;        // AUSD left of cap (cap = principal × capMult / 100)
                 uint64 activatedAt; uint64 lastEventAt;
                 uint64 eventCount;        // qualifying events
                 uint8  status; }          // Drafted Active CompletedCapped CompletedAtTerm Cancelled
struct Profile { uint64 totalISAs; uint64 completed; uint64 qualEvents;
                 uint64 distinctBackers; } // incremented on first completed ISA per backer
mapping(uint256 => ISA) isas;
mapping(address => Profile) profiles;
mapping(address => uint256) activeISA;     // one active ISA per seeker in MVP
mapping(bytes32 => bool) eventHashes;      // keccak(channelId, purchaseRef, gross, salt)
mapping(address => bytes32) identityOf;
mapping(bytes32 => address) walletOfIdentity;
mapping(uint64 => Channel) channels;
```

| Function | Who | Notes |
|---|---|---|
| `bindIdentity(identityHash)` | RELAYER_ROLE | Reverts if the hash is bound to another wallet (D4) |
| `registerChannel(id, name, pubkey)` | ADMIN (demo: relayer) | The mill's signing key |
| `createISADraft(terms)` | seeker (verified) | Reverts unless: `shareBps ∈ [1000,2000]`, `capMult ∈ [120,150]`, `termEnd ≤ now+24mo`, `principal ≤ offerOf.maxP`, channel exists, seeker has no active ISA (D6) |
| `activateWithPermit(isaId, deadline, v,r,s)` | backer (verified) | One tx: permit → pull `principal` AUSD → transfer to seeker → `Active`. Emits `ISAActivated` |
| `cancelDraft(isaId)` | either party | Only while `Drafted` |
| `receiveIncome(channelSig, isaId, purchaseRef, gross, salt)` | ORCHESTRATOR_ROLE | Verify channel pubkey over the payload **onchain**; `eventHashes` replay guard; ISA must be `Active` and match the channel; `divert = min(gross×shareBps/10000, remaining)`; pay backer + seeker **in this tx**; qualifying-event bookkeeping (§6.3); `remaining == 0` → `CompletedCapped` |
| `completeAtTerm(isaId)` | anyone, after `termEnd` | Remainder forgiven. Terminal. **Not pausable** |
| `flagMismatch(day, expected, actual)` | ORCHESTRATOR_ROLE | Emits `MismatchFlagged`; no state change |
| `offerOf / scoreOf / profileOf / isaOf` | view | Used by the app, Mitra console and `/p/:id` |
| `pause()` | PAUSER | **Asymmetric**: blocks `createISADraft` / `activateWithPermit` — never blocks `receiveIncome` or `completeAtTerm`. New risk stops; income and forgiveness never do |

**Parameters (testnet):** `MIN_SHARE 1000` · `MAX_SHARE 2000` · `MIN_CAP_MULT 120` · `MAX_CAP_MULT 150` · `MAX_TERM 24 months` · `BASE_MAX_P 600 AUSD` · `MIN_EVENT_GAP 60 days` · `MIN_EVENT_BPS 1000` (≥10% of principal).

> **Clarifications (2026-10-10, approved at Feature 003 merge — specs/003 research.md D4/D7; not silent deviations):**
> 1. **Drafts are directed offers.** `createISADraft(Terms terms, address backer)` names its intended backer (must be identity-bound); `cancelDraft` = seeker or named backer while Drafted; `activateWithPermit` requires the permit owner == the named backer. `bindIdentity(address wallet, bytes32 identityHash)` is two-arg — the one-arg form cannot say whose identity the RELAYER attests.
> 2. **Post-`termEnd` income is a hard stop.** `receiveIncome` requires `block.timestamp <= termEnd` (equality allowed): between `termEnd` and `completeAtTerm` the deal is Active but collects nothing — no last-harvest griefing window. Test `testBoundary_Income_AfterTermEnd_Reverts`.
> 3. Implementation notes, PLAN-table silent spots resolved as coded: `MAX_TERM` = 730 days inclusive; `channelIdByPubkey` is a derived reverse index (first registration wins); `MismatchFlagged` is emitted by the ORCHESTRATOR-only `flagMismatch` with no state change; `WrongBacker` reverts when the permit signer ≠ named backer; zero-gross income settles to (0, 0) and never qualifies (no revert).

> **Clarification (2026-10-10, approved at Feature 004 specify — Q1/A; not a silent deviation:)** `MIN_EVENT_GAP` is set at `initialize()` as a governed parameter (no setter — init-once, like the asset). Protocol value **60 days**; the Monad-testnet demo deployment uses **60 seconds** so the §6.3 seeded states are producible inside the hackathon window (they need ≥ ~120 days at 60 days — two sequential ISAs × one gap). Testnet→production note, precedent Matocard `minCycleDuration`: a production deployment passes 60 days and the anti-farming property is unchanged. Unit/literal tests keep 60 days; the demo value is disclosed in TRUST.md, `packages/contracts` addresses, and judge instructions. `KiteScoring` stays pure — the gap is an argument, not state.

### 6.3 Score formula (anti-farming) — hand-checkable
Score 0–100 = **History (40) + Consistency (20) + Volume (40)**. Integer maths, floor per component.

- **Qualifying event:** channel-signed, ≥ 60 days after the previous qualifying event, gross ≥ 10% of the ISA's principal. Non-qualifying events still split normally — they just count toward nothing.
- **History** = `40 × completed × min(totalISAs,3) / (totalISAs × 3)`; if `distinctBackers < 2`, History is capped at 13 (one backer can never fund a full record — kills self-dealing).
- **Consistency** = `20 × min(qualEvents,12) / 12`.
- **Volume** = `40 × min(qualEvents,6) / 6` — the target is six season-sized events.
- **Offer:** `maxP = BASE_MAX_P × (100 + 2×score) / 100`; share guidance (UI only) = `2000 − 8×score` bps.

**Demo numbers** (checked by hand, must match the contract exactly):

| State | total | completed | backers | qualEvents | History | Consistency | Volume | **Score** | maxP |
|---|---|---|---|---|---|---|---|---|---|
| New account | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** | 600 |
| Budi, prepared (2 ISAs done) | 2 | 2 | 2 | 4 | 26 | 6 | 26 | **58** | 1,296 |
| After the demo ISA completes | 3 | 3 | 3 | 7 | 40 | 11 | 40 | **91** | 1,692 |

**Demo ISA** (P 600, share 20%, cap 1.3× → cap 780 AUSD):

| Event | Gross | Divert = min(gross×20%, remaining) | To seeker | Remaining | Progress |
|---|---|---|---|---|---|
| Activation | – | – | 600 (principal out) | 780 | 0% |
| Panen 1 | 1,500 | 300 | 1,200 | 480 | 38.5% |
| Panen 2 | 1,500 | 300 | 1,200 | 180 | 76.9% |
| Panen 3 | 1,500 | **180** (cap reached) | 1,320 | 0 → **CompletedCapped** 🎉 | 100% |

> The finish line is the business model made visible: the product wants the 🎉 screen to arrive. The tengkulak never shows that screen. Say so in the pitch.

### 6.4 Invariants to test (Foundry)
- `diverted ≤ remaining`, always; `toSeeker == gross − diverted`, exactly, same transaction.
- A duplicate `eventHash` — or the same `purchaseRef` twice — reverts.
- `receiveIncome` requires ORCHESTRATOR_ROLE **and** an onchain-valid channel signature; a forged event reverts even with a compromised orchestrator.
- No income ever settles against a non-`Active` ISA; `Completed*` and `Cancelled` are terminal — no resurrection.
- One `identityHash` can never be bound to two wallets.
- Terms outside bounds revert at creation; `principal ≤ offerOf(seeker).maxP`.
- Score stays in [0,100], changes **only** on completion, and the §6.3 table matches as literal numbers.
- Cycles below the qualifying bar (gap < 60 days, gross < 10% of principal) add no score.
- Escrow conservation: activation pulls exactly `principal` and pays exactly `principal` to the seeker; income in == backer + seeker out.
- Paused: draft/activate blocked; `receiveIncome` and `completeAtTerm` still work.
- Reentrancy on `activateWithPermit` / `receiveIncome`.
- RELAYER_ROLE and ORCHESTRATOR_ROLE cannot move funds out of the contract; ORCHESTRATOR can only call `receiveIncome` / `completeAtTerm` / `flagMismatch`.

---

## 7. Backend

### 7.1 Services
| Service | Job |
|---|---|
| `api` | Per-screen endpoints: `/me`, `/quote`, `/p/:id`, `/channel/purchases/:id` (WF-1 validation, API-key auth) |
| `channels` | Purchase registry for the Mitra console: `pending → paid → settled`, mill signature captured at creation |
| `relayer` | Tx queue: `activateWithPermit`, ERC-3009 sends, `bindIdentity`, drip. Sends the published gas limits from `@kite/contracts` |
| `fx` | IDR/MYR↔USD quotes, locked 60 seconds; **demo fixed at 16,000** |
| `recon` | Daily cron: ledger vs chain (§7.2 rule 5), writes `recon_daily`, exits non-zero on mismatch |

### 7.2 Money-handling rules (mandatory)
1. **Idempotency**: `purchases.purchase_ref UNIQUE` per channel and `webhook_events.provider_event_id UNIQUE`. A replayed event must never produce a double split (the contract's registry is the second lock).
2. **State machine** per purchase: `PENDING → PAID → SETTLED` (+ `FAILED`). Transitions are logged, never deleted.
3. **Append-only ledger** (simple double-entry: purchase in ↔ AUSD split out).
4. **Daily reconciliation**: sum of `SETTLED` purchases must equal `IncomeSettled` events via the indexer. Mismatch → `flagMismatch` (WF-3) + **exit non-zero**. Never silently repair.
5. **Relayer key** in a secret manager, minimum roles, daily amount caps. MON drip once per verified identity.
6. **Retry with backoff**; never resend without checking the previous status. A receipt is not success: read back the state the tx was meant to change.
7. **Monad specifics**: track nonces locally, one tx at a time per key, hardcode gas limits (gas is charged on the limit).

### 7.3 Data model (Neon Postgres, Drizzle)
```
users(id, wallet UNIQUE, phone, kyc_status, identity_hash, locale, created_at)
isas(isa_id PK, seeker, backer, principal, share_bps, cap_mult, remaining, status, term_end)  -- chain cache
purchases(id PK, channel_id, isa_id, purchase_ref, gross_ausd, status, mill_sig, tx_hash, created_at)  -- UNIQUE(channel_id, purchase_ref): refs are channel-scoped, not globally unique (§7.2 rule 1)
channels(id PK, name, pubkey, active)
fx_quotes(id, pair, rate, expires_at)
relayer_jobs(id, kind, payload_json, status[pending→sent→confirmed], tx_hash, nonce, attempts)
webhook_events(provider_event_id UNIQUE, processed_at)
recon_daily(day PK, backend_total, chain_total, status[ok|mismatch])
```

### 7.4 FX
- The cap and score are locked in AUSD at signing — Budi carries **no FX risk on the deal**. Screens show rupiah headlines with "≈"; detail rows show AUSD.
- FX source for the demo: fixed 16,000, stated on screen. Production: the fiat partner's rate.

### 7.5 CRE workflows (`apps/orchestration`, simulate-first)
| WF | Trigger | Steps | Demo value |
|---|---|---|---|
| **WF-1 Ingest** | HTTP ← Mitra console `{purchaseRef, gross, channelSig}` | validate against `GET /channel/purchases/:id` → DON consensus → EVM write `receiveIncome` | The harvest-day shot: click → tx on the explorer in ~1–2 s → two phones update |
| **WF-2 Sentinel** | cron daily | read ISAs past `termEnd` → `completeAtTerm` → notify backend | Forgiveness is automated and transparent, not admin-hidden |
| **WF-3 Reconcile** | cron daily | ledger totals (HTTP) vs chain totals (Envio GraphQL + Alchemy RPC) → `flagMismatch` on mismatch | One workflow, three bounty touchpoints (CRE + Envio + Alchemy) — say that sentence in the submission |

---

## 8. Frontend (mobile-first PWA)

| Screen | Contents |
|---|---|
| Onboarding | Passkey (Mera), phone number |
| Verification | Demo auto-approve, then `bindIdentity` + MON drip |
| Home (Budi) | Saldo, active Bagi Hasil card (progress %, partner, cap), reputation row, "why" breakdown |
| Bagi hasil detail | Terms card (share · cap · failed-harvest line · end date), per-panen history |
| Split moment | Full-screen dark: gross, two split cards ✓✓, progress jump — triggered by the `IncomeSettled` event |
| Garis finis 🎉 | Confetti, stats, reputation jump, next-offer teaser, share button |
| Kirim | Gasless ERC-3009 send to a Kite contact |
| Dukung (Pak Haji) | People you back + progress; new-backing flow: who → amount+purpose → one-paragraph agreement → Face ID |
| Riwayat | From Envio: income events (gross + share), sends, completions |
| `/p/:id` (public) | Stars, completed count, per-ISA history with explorer links. No name, no documents |
| `/mitra` (desktop, labeled "Demo Tool") | Today's purchases (Kite + non-Kite rows), [Bayar] → split preview → posts to WF-1 |
| Desktop fallback | Phone-frame preview + QR ("best on mobile") for judges on laptops |

Stack: Vite + React PWA, `@category-labs/mera`, viem, Tailwind. Deployed on Vercel (static build). *(Amended F1, 2026-10-11: supersedes the original "Next.js (App Router)" line — decided in 006's plan phase: pure client-side auth/crypto, no SSR needs, apps/api owns all server surfaces. Monorepo layout otherwise per §10.)*

---

## 9. Security and trust (contents of `TRUST.md`)

| Part | Trusted party | Bounded by |
|---|---|---|
| Split, caps, score, terminal states | **Contract**, recomputable by anyone | – |
| Income-event authenticity | Channel signature **verified onchain** + CRE consensus transport | Forgery reverts even if orchestration is compromised; replay blocked by the hash registry |
| Purchase registry | **Operator (demo, centralized — say it)** | A forged registry entry cannot split without the mill's signature; the weak link is stated, not hidden |
| Identity | Operator + demo KYC | Only an identity hash goes onchain |
| Relayer / orchestrator keys | Operator | Minimum roles, daily caps, asymmetric pause, reconciliation |
| **Backer's capital** | **The income stream** | This is not a bond: if income stays low, repayment is partial and `termEnd` forgives the rest. The finish line is the product; the risk is stated on the deal card |
| Collusion (mill + farmer under-reporting) | Open problem | MVP relies on the mill's signature + operator caps; channel reputation + koperasi attestation = roadmap (R2) |
| Account access | User's passkey | Lost passkey = lost account (R5). Passkeys sync via iCloud / Google Password Manager |

**Regulation (roadmap, stated plainly):** profit-sharing with a floor and a cap, no interest, no collateral seizure — structured as partnership, not credit; the realistic path is the OJK Regulatory Sandbox (POJK 3/2024) with a licensed local partner for fiat rails. Stablecoin-as-payment in Indonesia is an open question (BI/OJK boundaries). **Sharia:** *bagi hasil* is the heritage concept — but certification requires an advisory board; until then say "Sharia-inspired, seeking certification", never "halal".

---

## 10. Repo layout

Bun + Turborepo workspaces, Biome at the root. Foundry for contracts. Agents work per-workspace against this PLAN.

```
apps/
  web/           Vite + React PWA: all screens, /p/:id, /mitra, desktop fallback (stack per §8, F1)
  api/           HTTP API, one answer per screen (indexer + contract + DB) — fx lives here until it needs its own process
  relayer/       tx queue: activate, sends, bindIdentity, drip
  indexer/       Envio: config.yaml, schema.graphql, handlers, health script
  orchestration/ CRE: wf1-ingest, wf2-sentinel, wf3-reconcile (own runtime — Docker, not serverless; peer of api, not a child)
contracts/       Foundry: KiteCore (UUPS) + modules/, KiteScoring, MockAUSD
packages/
  contracts/     generated ABIs + typed constants + published gas limits (Foundry → TS, CI-checked)
  core/          shared types, money helpers (integers only), FX
  tsconfig/      shared TypeScript config
```

---

## 11. Resources

### 11.1 Networks and contracts
| Item | Value |
|---|---|
| Monad testnet | chain ID `10143`, RPC `https://testnet-rpc.monad.xyz` ([docs](https://docs.monad.xyz/developer-essentials/testnet), [faucet](https://faucet.monad.xyz/)) |
| AUSD, Monad testnet | `0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimals ([Agora deployments](https://docs.agora.finance/developer/contract-deployments)) |
| AUSD, Monad mainnet | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` |
| Alchemy | Monad endpoint for relayer + CRE EVM capability (bounty integration) |

### 11.2 Third-party services
| Service | For | Status / notes |
|---|---|---|
| [Mera](https://mera.category.xyz/getting-started/) | Passkey account + signing sessions (+PRF, Q5) | Client-side library, no contract, no API key |
| [Chainlink CRE](https://docs.chain.link/cre) | Orchestration (§7.5) | Verify current CLI/SDK on day 1 (Q3/Q4) — API evolved after my reference docs |
| [Envio](https://envio.dev) | Indexer | Dev tier keeps 3 deployments: a redeploy deletes the oldest URL |
| Neon | Postgres | Free tier; auto-wake on request (no Supabase pause risk on judging day) |
| Vercel | App + relayer + cron | Hobby cron (daily) is enough for WF/recon triggers |
| Public FX API | (optional) live rates | Demo uses the fixed 16,000 |

### 11.3 Accounts and credentials to prepare
- [ ] Register for Metropolis (**closes 6 Oct**), create team + project, pick **Track 02**, set community **DevWeb3Jogja** on every member's profile
- [ ] Join the Monad Discord, get the Metropolis role; ask Agora about the **testnet AUSD faucet** (day 1, Q1)
- [ ] Vercel + Neon + Envio + CRE portal accounts
- [ ] Deployer + relayer + orchestrator wallets, funded with testnet MON (orchestrator = the `cre simulate` signer, granted ORCHESTRATOR_ROLE)
- [ ] Mitra demo account (mill) + two seeded phones: **Budi** (prepared score-58 state, P 600 active) and **Pak Haji** (backer)

### 11.4 Team (fill in)
| Role | Person |
|---|---|
| Contracts + tests (`contracts/`) | [you] + agents |
| Backend + relayer (`api`, `relayer`) | [you] + agents |
| Indexer (`apps/indexer`) | [you] + agents |
| CRE workflows (`apps/orchestration`) | [you] + agents |
| Frontend + UX (`apps/web`) | [you] + agents |
| User testing, demo video, write-up | **[you — not delegable]** |

---

## 12. Schedule (29 September – 13 October 2026, deadline 14 Oct 10:59 WIB)

| Day | Date | Goal | Done when |
|---|---|---|---|
| 1 | 29 Sep | Register (§11.3), new repo, monorepo, **verify CRE CLI + Mera PRF + ask Agora for AUSD faucet** | Q1–Q5 in §13 answered or have fallbacks |
| 2–3 | 30 Sep–1 Oct | `KiteScoring` + split math as pure libs, bounds; invariant test scaffold | `forge test` green, §6.3 numbers match |
| 4 | 2 Oct | Deploy `KiteCore` + `MockAUSD` to Monad testnet; seed channel + prepared accounts | Manual loop via `cast`: draft → activate → receiveIncome → cap → 🎉 (demo deployment sets `MIN_EVENT_GAP` 60 s — compressed-gap seed, disclosed; PLAN §6.2 clarification) |
| 5–6 | 3–4 Oct | `api` + `relayer` + purchase registry + fx: idempotency, ledger, gasless ERC-3009 send | Gasless send works phone-to-phone; purchase → `SETTLED` state machine green |
| 7 | 5 Oct | Mera passkey login + signing session + drip + `bindIdentity` | Sign up → verified → account ready, no MON bought |
| 8–9 | 6–7 Oct | App: home, detail, Dukung flow, split moment on two phones, Kirim | §3 steps 1–5 + 8 work end to end on two phones |
| 10 | 8 Oct | Envio (feeds + `/p/:id`); CRE WF-1/2/3 via `cre simulate` → real txs | `/p/budi` public; Mitra click → explorer tx < 2 s |
| 11 | 9 Oct | **User testing** with ≥5 people from the segment, then fix what broke | Numbers from §2.1 written down |
| 12 | 10 Oct | Hardening: full invariant pass, recon exit-non-zero demo, `TRUST.md`, gas snapshot | §9 + §6.4 checklists complete |
| 13 | 11 Oct | Prepare "3 panen kemudian" + failed-harvest states; record demo video + pitch video | Demo ≤ 3 min, pitch ≤ 2 min, live product only |
| 14 | 12 Oct | Write-up, README, diagrams, logo, judge instructions | Submission draft complete |
| 15 | 13 Oct | Buffer + **submit** | Submitted a day before the deadline |

**If time runs short, cut in this order:** `/mitra` polish (fall back to a `cast` script for the split — still films) → PRF bounty attempt → desktop QR fallback → Kirim screen (keep it: Agora send leg) → public-profile extras.
**Never cut:** passkey signup → Dukung/fund → the split moment on two phones → Garis Finis → `/p/:id` public profile → user testing (it is 20% of the score).

---

## 13. Open questions and risks

| # | Question / risk | Impact | Action |
|---|---|---|---|
| Q1 | Is there a testnet AUSD faucet? | Real AUSD vs MockAUSD | Ask Agora day 1 (Discord/bounty channel). Fallback: MockAUSD with ERC-3009 + permit, and a planned redeploy to real AUSD (the asset is immutable at contract init — same evolution Matocard ran) |
| Q2 | Does testnet AUSD support ERC-3009 + permit? | Gasless funding/send path | Matocard's TestAUSD mirrored Agora's capabilities, implying yes — verify against Agora docs on day 1 |
| Q3 | Current CRE CLI/SDK API names + does `simulate` write to arbitrary EVM RPC? | Orchestration bounty path | Verify docs.chain.link/cre on day 1. Fallback: the relayer submits `receiveIncome` directly (the contract doesn't care who transports) — CRE becomes a stretch item, contained loss |
| Q4 | Does the `cre simulate` signer need allowlisting? | WF-1 demo | Grant ORCHESTRATOR_ROLE to the simulate wallet at deploy; document in TRUST.md |
| Q5 | Mera PRF support status | PRF bounty | If absent: PRF → roadmap; Mera UX bounty unaffected |
| Q6 | Does a PWA qualify as the "mobile app" Agora asks for? | Demo format | Prior-cycle answer: **yes** (Agora confirmed a PWA qualifies). Re-confirm day 1 anyway |
| Q7 | Is the share bound [10%, 20%] right? | Originality story | It is the anti-predation argument (a deal taking 40% of income cannot be written). Keep, and say why in the docs |
| R1 | No default state → "what stops abuse?" judges | Pitch | Identity binding (D4) + qualifying-event bars (D9) + term forgiveness declared as the backer's accepted risk. Covenants/default = salary-stream roadmap |
| R2 | Collusion: mill + farmer under-report sales | Enforcement honesty | Stated as the open problem in TRUST.md; channel reputation + koperasi attestation = roadmap. Never claim MVP solves it |
| R3 | Relayer/orchestrator key leak | Fake income events, drained drips | Minimum roles, onchain signature check (D7) means a leaked orchestrator key still cannot forge income without the mill's key; caps + pause + recon |
| R4 | "Why not just a bank / is the tengkulak comparison fair?" | Pitch | Finish line + zero-in-failed-months + portable public record; banks structurally cannot do per-sale splits at $600 tickets |
| R5 | User loses their passkey | Account unreachable | Synced passkeys; roadmap: KYC-gated rebind with a timelock |
| R6 | Two harvests a year makes "live" testing slow | Demo realism | Prepared states, honestly labeled (D: the contract doesn't care about calendar time — the split logic filmed is real) |
| R7 | Track 02 is crowded; Mera + AUSD is the default stack | Standing out | Lead with what others lack: **the split inside settlement + a finish line + the empty quadrant** (income-contingent · settlement-level · consumer-direct · open rails — nobody is there) |
| R8 | Envio hosted stalls (known failure modes) | History + recon | Health script (indexer head vs chain head); degraded direct-RPC reads for critical state; contract stays the authority |

---

## 14. Submission checklist

- [ ] Public repo shared with `metropolis@hackathon.monad.xyz`, **honest git history starting 29 Sep 2026** (no backdating)
- [ ] README: pitch, how to try it, contract addresses, architecture, `PLAN.md` (this file)
- [ ] `TRUST.md` (§9) — including the "this is not a bond" backer-risk statement
- [ ] A hand-checkable score + split calculation example (§6.3) matching the contract exactly
- [ ] Live app (Vercel) + judge instructions: passkey signup, demo verification auto-approves, the three seeded accounts (**Budi** @ 38.5% mid-season, **Pak Haji**, **Mitra**), and the two prepared states (finish line, failed harvest)
- [ ] Demo video ≤ 3 minutes following §3, live product on real phones
- [ ] Pitch video ≤ 2 minutes: team, problem, why us
- [ ] Logo (JPG/PNG/WEBP, ≤ 3 MB)
- [ ] User-testing results in the write-up (§2.1)
- [ ] Contracts verified on the Monad testnet explorer
- [ ] Bounty fields: Agora, Community (DevWeb3Jogja), Chainlink CRE, Mera, Mera PRF, Envio, Alchemy

---

## 15. Out of scope (roadmap)

- Salary / freelance / invoice streams (the same settlement engine; invoice = the uniqueness registry generalizes)
- Default + covenant engine (late cycles, restructuring, score destruction)
- LP pool + tranche design (diaspora junior / stranger senior) and pool diversification across farmers/regions/crops
- Buyout module (`remaining × 90%`), stake module (skin-in-the-game)
- Buyer-channel reputation + koperasi attestation layer
- Sharia advisory board + certification
- Real fiat rails (Xendit/Agora Routes), Didit KYC in production mode
- Native mobile app, WhatsApp notifications, passkey recovery rebind
- Licensing (OJK sandbox, BI), mainnet, multi-chain settlement

---

Two notes on what changed from the earlier PRD, so we're aligned: **(1)** the pool was cut from MVP — Pak Haji funds Budi directly; pooling is roadmap, and the solo-backer story is stronger for the demo anyway. **(2)** Demo numbers were re-tuned to be fully hand-checkable (P 600 AUSD, cap 780, three 1,500-AUSD harvests → score 58 → 91) — the §6.3 tables are now literal acceptance tests, exactly like Matocard's.

