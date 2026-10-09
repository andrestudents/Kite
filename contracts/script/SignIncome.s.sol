// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {KiteCore} from "../src/KiteCore.sol";
import {ISA} from "../src/modules/ISA.sol";
import {console2} from "forge-std/console2.sol";
import {KiteScriptCommon} from "./KiteScriptCommon.s.sol";

/// @title SignIncome — EIP-712 IncomeEvent helper for the manual loop (US3).
/// @notice Broadcasts NOTHING: derives KiteCore's domain ("KiteCore","1", the
///         live chain and proxy), signs the channel fact with MILL_KEY, and
///         prints only v/r/s (+ the digest, for the curious judge). The key
///         stays in env and is never logged (research D10, spec FR-005).
///         SignIncome is a Demo Tool: it signs the gross YOU type — in the
///         demo the mill console is simulated, and that honesty boundary is
///         the collusion open problem (PLAN §9, R2).
///
/// Env: KITE_CORE_ADDRESS · MILL_KEY (secret) · ISA_ID ·
///      PURCHASE_REF (0x-hex32) · GROSS (AUSD base units) · SALT (0x-hex32)
contract SignIncome is KiteScriptCommon {
    bytes32 internal constant INCOME_TYPEHASH =
        keccak256("IncomeEvent(uint64 channelId,uint256 isaId,bytes32 purchaseRef,uint256 gross,bytes32 salt)");

    function run() external view {
        _chainGuard();
        uint256 millKey = vm.parseUint(_req("MILL_KEY"));
        KiteCore kite = KiteCore(payable(vm.parseAddress(_req("KITE_CORE_ADDRESS"))));
        uint256 isaId = vm.parseUint(_req("ISA_ID"));
        bytes32 purchaseRef = vm.parseBytes32(_req("PURCHASE_REF"));
        uint256 gross = vm.parseUint(_req("GROSS"));
        bytes32 salt = vm.parseBytes32(_req("SALT"));

        ISA memory isa = kite.isaOf(isaId);
        uint64 channelId = isa.terms.channelId;
        (, address pubkey, bool active) = kite.channelOf(channelId);
        require(active, "channel inactive");
        require(vm.addr(millKey) == pubkey, "MILL_KEY is not this channel's signer");

        // No public DOMAIN_SEPARATOR() on the proxy — derive per EIP-712,
        // exactly as KiteCore.t.sol does.
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KiteCore"),
                keccak256("1"),
                block.chainid,
                address(kite)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01", domain, keccak256(abi.encode(INCOME_TYPEHASH, channelId, isaId, purchaseRef, gross, salt))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(millKey, digest);

        console2.log("=== SignIncome (Demo Tool) - broadcasts nothing ===");
        console2.log("isaId:", isaId);
        console2.log("channelId:", channelId);
        console2.log("gross (AUSD base):", gross);
        console2.log("digest:");
        console2.logBytes32(digest);
        console2.log("receiveIncome args:");
        console2.log("  purchaseRef:");
        console2.logBytes32(purchaseRef);
        console2.log("  salt:");
        console2.logBytes32(salt);
        console2.log("  v:", v);
        console2.log("  r:");
        console2.logBytes32(r);
        console2.log("  s:");
        console2.logBytes32(s);
        console2.log(
            "  cast send $KITE_CORE 'receiveIncome(uint256,bytes32,uint256,bytes32,uint8,bytes32,bytes32)' $ISA_ID $REF $GROSS $SALT $V $R $S --gas-limit <published>"
        );
    }
}
