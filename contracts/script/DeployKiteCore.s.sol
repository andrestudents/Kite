// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {KiteCore} from "../src/KiteCore.sol";
import {MockAUSD} from "../src/MockAUSD.sol";
import {console2} from "forge-std/console2.sol";
import {KiteScriptCommon} from "./KiteScriptCommon.s.sol";

/// @title DeployKiteCore — the one-command Feature-004 deployment (US1).
/// @notice Order per specs/004 contracts/deploy-seed-api.md: preflight → asset
///         (Q2/C: AUSD_ADDRESS unset deploys MockAUSD; set attaches only after
///         the strengthened probe passes) → implementation → ERC-1967 proxy
///         with `initialize(admin, relayer, orchestrator, pauser, ausd,
///         DEMO_GAP_SECONDS)` → on-chain asserts (roles, gap, channel) →
///         manifest. Verification rides `--verify` (quickstart §3); if the
///         explorer rejects, the D11 retry is printed — never trusted silent.
/// @dev The demo gap is 60 SECONDS here (governed, init-once, NO setter —
///      PLAN §6.2 clarification / FR-018). This disclosure is the point: the
///      manifest below says so on every run. Config rides one memory struct
///      (`Cfg`) — keeps `run`'s stack shallow without `--via-ir`.
contract DeployKiteCore is KiteScriptCommon {
    uint64 internal constant CHANNEL_ID = 1;

    /// @dev Everything the run needs, gathered before anything broadcasts.
    struct Cfg {
        uint256 deployerKey;
        address deployer;
        address relayer;
        address orchestrator;
        address pauser;
        address admin;
        address mill;
        string channelName;
        uint256 demoGap;
        address asset;
        bool ausdIsMock;
    }

    function run() external {
        Cfg memory c = _preflight();
        (KiteCore kite, KiteCore impl) = _broadcast(c);
        _assertOnchain(kite, c);
        _manifest(kite, impl, c);
    }

    // ── Preflight (nothing broadcast yet — aborts are free) ─────────────
    function _preflight() private view returns (Cfg memory c) {
        _chainGuard();
        c.deployerKey = vm.parseUint(_req("DEPLOYER_KEY"));
        c.deployer = vm.addr(c.deployerKey);
        _deployerFunded(c.deployer);
        c.relayer = _addrFrom("RELAYER_KEY", "RELAYER_ADDR");
        c.orchestrator = _addrFrom("ORCHESTRATOR_KEY", "ORCHESTRATOR_ADDR");
        c.pauser = _addr("PAUSER_ADDR");
        c.admin = _admin(c.deployer);
        c.mill = _addrFrom("MILL_KEY", "MILL_ADDR");
        c.channelName = _req("MILL_CHANNEL_NAME");
        c.demoGap = _uintOr("DEMO_GAP_SECONDS", 60);
        if (c.demoGap == 0) revert ZeroGap();
        (c.asset, c.ausdIsMock) = _resolveAsset(c.deployer);
    }

    /// @dev Single-operator demo (PLAN §11.3): the channel is registered by
    ///      the admin in this same run, so the admin must be a wallet we hold.
    function _admin(address deployer) private view returns (address admin) {
        string memory adminEnv = vm.envOr("ADMIN_ADDR", string(""));
        admin = bytes(adminEnv).length == 0 ? deployer : vm.parseAddress(adminEnv);
        if (admin != deployer) revert SingleOperatorAdmin(admin, deployer);
    }

    /// @dev Q2/C: AUSD_ADDRESS unset → MockAUSD is deployed in the broadcast;
    ///      set → attach only after the strengthened probe passes (the asset
    ///      is immutable at init — a wrong pick means a redeploy).
    function _resolveAsset(address deployer)
        private
        view
        returns (address asset, bool ausdIsMock)
    {
        string memory assetEnv = vm.envOr("AUSD_ADDRESS", string(""));
        if (bytes(assetEnv).length == 0) {
            return (address(0), true);
        }
        asset = vm.parseAddress(assetEnv);
        _probeAsset(asset, deployer, _uintOr("SEED_AUSD_MIN", 14_000 * AUSD_BASE));
        return (asset, false);
    }

    // ── Broadcast ───────────────────────────────────────────────────────
    function _broadcast(Cfg memory c)
        private
        returns (KiteCore kite, KiteCore impl)
    {
        vm.startBroadcast(c.deployerKey);
        if (c.asset == address(0)) {
            c.asset = address(new MockAUSD(c.deployer)); // 1,000,000 AUSD → deployer
        }
        impl = new KiteCore();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(KiteCore.initialize, (c.admin, c.relayer, c.orchestrator, c.pauser, c.asset, c.demoGap))
        );
        kite = KiteCore(address(proxy));
        kite.registerChannel(CHANNEL_ID, c.channelName, c.mill);
        vm.stopBroadcast();
    }

    // ── On-chain asserts (FR-006/FR-007: trust the chain, not the plan) ─
    function _assertOnchain(KiteCore kite, Cfg memory c) private view {
        require(kite.hasRole(kite.RELAYER_ROLE(), c.relayer), "RELAYER_ROLE missing");
        require(kite.hasRole(kite.ORCHESTRATOR_ROLE(), c.orchestrator), "ORCHESTRATOR_ROLE missing");
        require(kite.hasRole(kite.DEFAULT_ADMIN_ROLE(), c.admin), "ADMIN missing");
        require(kite.minEventGap() == c.demoGap, "gap mismatch");
        require(kite.ausd() == c.asset, "asset mismatch");
        (string memory name, address pubkey, bool active) = kite.channelOf(CHANNEL_ID);
        require(active && keccak256(bytes(name)) == keccak256(bytes(c.channelName)) && pubkey == c.mill, "channel");
    }

    // ── Manifest (paste into contracts/script/DEMO-ACCOUNTS.md) ─────────
    function _manifest(KiteCore kite, KiteCore impl, Cfg memory c) private view {
        console2.log("=== Kite deployment manifest (Monad testnet, chain 10143) ===");
        console2.log("DISCLOSURE (FR-018): minEventGap seconds (demo; protocol is 60 days):", c.demoGap);
        console2.log("Init-once - NO setter. Judge-facing disclosure is the point of this line.");
        if (c.ausdIsMock) {
            console2.log("DISCLOSURE (Q2/C): settlement asset is MockAUSD (Demo Tool) - ausdIsMock: true");
        } else {
            console2.log("Settlement asset: real AUSD attached behind the preflight - ausdIsMock: false");
        }
        _row("KiteCore proxy", address(kite));
        _row("KiteCore impl", address(impl));
        _row("Asset (ausd)", c.asset);
        _row("Mill (channel 1)", c.mill);
        console2.log("channelId:", CHANNEL_ID);
        console2.log("deployedAt:", block.timestamp);
        console2.log("Verify a straggler (research D11):");
        console2.log(
            "  forge verify-contract <addr> <Contract> --root contracts --chain-id 10143 --verifier etherscan --verifier-url https://api-testnet.monadscan.com/api --watch"
        );
        console2.log("Treat verification as INCOMPLETE (SC-003 open) until every URL above shows verified source.");
    }
}
