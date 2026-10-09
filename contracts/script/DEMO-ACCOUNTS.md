# Demo deployment — Monad testnet (chain 10143)

Recorded from the `DeployKiteCore.s.sol` live manifest (T011). All addresses are
throwaway demo accounts on a public testnet; the matching private keys live ONLY
in the gitignored `contracts/.env` (Feature 004 spec rule: keys never in code,
prompts, or git).

> **Disclosure (FR-018 / PLAN §6.3):** the demo runs with `minEventGap = 60 s` so
> the whole seed story fits a live judging session. The production value is
> 60 days. The gap is init-once (no setter) and readable on-chain via
> `minEventGap()` — the disclosure IS the demo config.
>
> **Disclosure (Q2/C):** the settlement asset is **MockAUSD — Demo Tool**
> (6 dp, mint-to-deployer). PLAN's real AUSD (ERC-3009 + permit) replaces it.

## Contracts

| What | Address | Explorer |
|------|---------|----------|
| KiteCore (ERC-1967 proxy) | `0x3B6C79756efa8d13e4beA36F323F8aC67774C0fD` | https://testnet.monadscan.com/address/0x3B6C79756efa8d13e4beA36F323F8aC67774C0fD |
| KiteCore implementation | `0xb2A358f6cA6a4aE13b6A14730C29DF6500D5FAcd` | https://testnet.monadscan.com/address/0xb2A358f6cA6a4aE13b6A14730C29DF6500D5FAcd |
| MockAUSD (Demo Tool) | `0x0309764915AFC7a2a7CDd1E64c58a57c1F1705E3` | https://testnet.monadscan.com/address/0x0309764915AFC7a2a7CDd1E64c58a57c1F1705E3 |
| Mill — channel 1 | `0x9561616Dd04C7646c8Aa5eaC0C52C17795ef1221` | https://testnet.monadscan.com/address/0x9561616Dd04C7646c8Aa5eaC0C52C17795ef1221 |

`channelOf(1)` = `{ name: "Koperasi Mill", pubkey: 0x9561…1221, active: true }`
· `minEventGap()` = `60` · `ausd()` = MockAUSD proxy address.

## Personas (throwaway wallets)

| Persona | Role on Kite | Address |
|---------|--------------|---------|
| Deployer | DEFAULT_ADMIN_ROLE + tx payer | `0x7A968ba34b0F7eE9eb2Fb8e5C97267626757ffA1` |
| Relayer | RELAYER_ROLE (`bindIdentity`) | `0xBcC28Ab39D8e888895da900425d824F9f92442d2` |
| Orchestrator | ORCHESTRATOR_ROLE (`receiveIncome`) | `0xD2F3a2F3c20Ca006dB1582dEaf82447b46B71Ee1` |
| Pauser | PAUSER_ROLE (asymmetric pause) | `0x1Da21c81917810957aDF84bfD0025966A240EC68` |
| Budi | seeker (street vendor) | `0xDbAc9A1F342a1b5Fb2956e58E6528ca0F8C44aAD` |
| Siti | backer (ISA-1) | `0xA7F77CC6246441cDC8f8517111298B3F3241975a` |
| Wati | backer (ISA-2) | `0xA8B08240B370d3f720490E2328b7eD860D5E3D60` |
| Pak Haji | backer (ISA-3) | `0x127BD57eA26e6F5eee15efe8b5b495ae539d82Ea` |
| Mill | channel 1 + income signing key | `0x9561616Dd04C7646c8Aa5eaC0C52C17795ef1221` |

Deployed at epoch `1791580848` (2026-10-10). Deployment txs: 4 broadcast
(MockAUSD, KiteCore impl, ERC-1967 proxy + initialize, registerChannel),
total ~5.53M gas, ~0.59 MON charged (paid on the limit, Monad).

## Source verification (SC-003)

`forge script --verify` aborts without an explorer API key, so verification runs
as a straggler pass after the broadcast (research D11 flow). Monadscan's native
endpoint is Etherscan V1-style and unresponsive; the working path is the Etherscan
V2 multichain endpoint (chainid 10143 = monad-testnet) with a free
[etherscan.io](https://etherscan.io/apis) key:

```sh
export ETHERSCAN_API_KEY=<your etherscan.io key>
forge verify-contract 0xb2A358f6cA6a4aE13b6A14730C29DF6500D5FAcd src/KiteCore.sol:KiteCore \
  --root contracts --chain-id 10143 --verifier etherscan \
  --verifier-url 'https://api.etherscan.io/v2/api?chainid=10143' --compiler-version 0.8.36
```

(Impl: no ctor args. Proxy: pass `--constructor-args-path` / encoded ERC-1967 +
initialize call if attempted. MockAUSD: ctor arg = deployer address.)

Gate: every address URL above shows verified source. Status: PENDING API key.
