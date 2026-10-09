// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/interfaces/IERC20Metadata.sol";

/// @title KiteScriptCommon
/// @notice Shared preflight + env plumbing for the Feature-004 scripts
///         (specs/004 contracts/deploy-seed-api.md). Every abort names its
///         CAUSE — never a value: keys enter via env only and are never
///         logged (spec FR-005, quickstart §7 secrets gate).
/// @dev Chain guard pins every run to Monad testnet (research D2): an
///      accidental local/mainnet broadcast is impossible.
abstract contract KiteScriptCommon is Script {
    // ── Abort surface (deploy-seed-api.md table) ────────────────────────
    error EnvMissing(string name);
    error WrongChain(uint256 got, uint256 want);
    error DeployerUnderfunded(uint256 balance, uint256 need);
    error ZeroGap();
    error AssetNotErc20(address asset);
    error AssetDecimals(uint8 got, uint256 want);
    error AssetFundingShort(uint256 balance, uint256 need);
    error SingleOperatorAdmin(address admin, address deployer);

    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10143; // research D2
    uint256 internal constant DEPLOYER_MIN_MON = 0.5e18; // research D13
    uint256 internal constant AUSD_BASE = 1e6; // 6 dp (constitution VI)

    // ── Env plumbing (names abort; values never echo) ───────────────────
    /// @dev Required string; aborts naming the variable, never printing one.
    function _req(string memory name) internal view returns (string memory) {
        string memory v = vm.envOr(name, string(""));
        if (bytes(v).length == 0) revert EnvMissing(name);
        return v;
    }

    /// @dev Address from `KEY` (derived — never logged) falling back to `ADDR`.
    function _addrFrom(string memory keyName, string memory addrName)
        internal
        view
        returns (address a)
    {
        string memory k = vm.envOr(keyName, string(""));
        if (bytes(k).length > 0) {
            a = vm.addr(vm.parseUint(k));
        } else {
            string memory v = _req(addrName);
            a = vm.parseAddress(v);
        }
        if (a == address(0)) revert EnvMissing(addrName);
    }

    function _addr(string memory name) internal view returns (address) {
        return vm.parseAddress(_req(name));
    }

    function _uintOr(string memory name, uint256 defaultValue) internal view returns (uint256) {
        string memory v = vm.envOr(name, string(""));
        return bytes(v).length == 0 ? defaultValue : vm.parseUint(v);
    }

    // ── Preflights (deploy-seed-api.md behavior order) ──────────────────
    function _chainGuard() internal view {
        if (block.chainid != MONAD_TESTNET_CHAIN_ID) {
            revert WrongChain(block.chainid, MONAD_TESTNET_CHAIN_ID);
        }
    }

    function _deployerFunded(address deployer) internal view {
        if (deployer.balance < DEPLOYER_MIN_MON) {
            revert DeployerUnderfunded(deployer.balance, DEPLOYER_MIN_MON);
        }
    }

    /// @dev Q2/C strengthened real-asset probe, run BEFORE the proxy is
    ///      initialized (the asset is immutable at init — a wrong pick means
    ///      a redeploy): code exists, 6 decimals, and `holder` (the deployer —
    ///      NOT msg.sender, which is the script contract in simulation) holds
    ///      at least `minAusd` (seed + finale headroom).
    function _probeAsset(address asset, address holder, uint256 minAusd) internal view {
        if (asset.code.length == 0) revert AssetNotErc20(asset);
        IERC20Metadata token = IERC20Metadata(asset);
        if (token.decimals() != 6) revert AssetDecimals(token.decimals(), 6);
        uint256 bal = token.balanceOf(holder);
        if (bal < minAusd) revert AssetFundingShort(bal, minAusd);
    }

    // ── Manifest (constitution VIII: everything public, on the explorer) ─
    function _explorer(address a) internal pure returns (string memory) {
        return string.concat("https://testnet.monadscan.com/address/", vm.toString(a));
    }

    function _row(string memory what, address a) internal view {
        console2.log(what, a); // (string,address) overload
        console2.log("      ", _explorer(a));
    }
}
