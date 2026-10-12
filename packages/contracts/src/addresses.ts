// Live Feature-004 deployment (T011/T012) — recorded from the
// DeployKiteCore.s.sol broadcast manifest; human-readable copy with explorer
// links lives in contracts/script/DEMO-ACCOUNTS.md.
//
// The settlement asset is MockAUSD (ausdIsMock) — Demo Tool per PLAN §3;
// KiteCore's own view of the asset is `ausd()` on the proxy, which is the
// address published here.

export const KITE_DEPLOYMENT = {
  chainId: 10143,
  network: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerBaseUrl: "https://testnet.monadscan.com",
  kiteCore: "0x3B6C79756efa8d13e4beA36F323F8aC67774C0fD",
  kiteCoreImpl: "0xb2A358f6cA6a4aE13b6A14730C29DF6500D5FAcd",
  ausd: "0x0309764915AFC7a2a7CDd1E64c58a57c1F1705E3",
  ausdIsMock: true,
  channelId: 1n,
  minEventGapSec: 60,
  // Epoch seconds of THIS proxy's deployment — the registry/settlement
  // watchers seed their job_state checkpoints from it (blockAtOrAfter), so a
  // RE-DEPLOYMENT must re-record it from the new broadcast manifest or the
  // catch-up scans the wrong window.
  deployedAt: 1791580848,
} as const;

export type KiteDeployment = typeof KITE_DEPLOYMENT;
