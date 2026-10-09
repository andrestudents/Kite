// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {KiteCore} from "../src/KiteCore.sol";
import {ISA} from "../src/modules/ISA.sol";
import {console2} from "forge-std/console2.sol";
import {KiteScriptCommon} from "./KiteScriptCommon.s.sol";

/// @title SignPermit — ERC-2612 signature helper for the manual loop (US3).
/// @notice Broadcasts NOTHING: reads the live ISA, signs the permit over the
///         live asset's domain (chain 10143, read via DOMAIN_SEPARATOR()),
///         prints only v/r/s (+ the parameters a `cast send activateWithPermit`
///         needs). The key stays in env and is never logged (research D10,
///         spec FR-005). SignPermit is a Demo Tool: it signs what you tell it
///         for the ISA you name — verify the isaId before pasting.
///
/// Env: KITE_CORE_ADDRESS · BACKER_KEY (secret) · ISA_ID (the throwaway draft)
contract SignPermit is KiteScriptCommon {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function run() external view {
        _chainGuard();
        uint256 backerKey = vm.parseUint(_req("BACKER_KEY"));
        KiteCore kite = KiteCore(payable(vm.parseAddress(_req("KITE_CORE_ADDRESS"))));
        uint256 isaId = vm.parseUint(_req("ISA_ID"));

        // The ISA names the backer and the amount — read, never guess.
        ISA memory isa = kite.isaOf(isaId);
        address signer = vm.addr(backerKey);
        require(signer == isa.backer, "BACKER_KEY does not own this ISA's backer seat");

        IERC20Permit ausd = IERC20Permit(kite.ausd());
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                ausd.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        PERMIT_TYPEHASH, isa.backer, address(kite), isa.terms.principal, ausd.nonces(isa.backer), deadline
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(backerKey, digest);

        console2.log("=== SignPermit (Demo Tool) - broadcasts nothing ===");
        console2.log("isaId:", isaId);
        console2.log("backer", isa.backer);
        console2.log("principal (AUSD base):", isa.terms.principal);
        console2.log("nonce:", ausd.nonces(isa.backer));
        console2.log("deadline:", deadline);
        console2.log("activateWithPermit args:");
        console2.log("  v:", v);
        console2.log("  r:");
        console2.logBytes32(r);
        console2.log("  s:");
        console2.logBytes32(s);
        console2.log(
            "  cast send $KITE_CORE 'activateWithPermit(uint256,uint256,uint8,bytes32,bytes32)' $ISA_ID $DEADLINE $V $R $S --gas-limit <published>"
        );
    }
}
