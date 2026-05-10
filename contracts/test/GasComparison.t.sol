// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/Carpool.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract GasComparisonTest is Test {
    using MessageHashUtils for bytes32;

    uint256 internal ownerPk = 0xA11CE;
    uint256 internal backendPk = 0xB0B;
    uint256 internal driverPk = 0xD1;
    uint256 internal riderPk = 0xE1;

    function _sig(address c, address rider, address driver, uint256 fare, bool ceiling, uint256 nonce)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encode(c, rider, driver, fare, ceiling, nonce, block.chainid)).toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(driverPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function testGas_AcceptRide_Current() public {
        address owner = vm.addr(ownerPk);
        address backend = vm.addr(backendPk);
        address driver = vm.addr(driverPk);
        address rider = vm.addr(riderPk);

        vm.deal(driver, 10 ether);
        vm.deal(rider, 10 ether);

        Carpool c = new Carpool(owner, backend, 1 ether, 20, 120, 1e12);
        vm.prank(owner);
        c.registerDriver(driver, keccak256("id-a"), keccak256("doc-a"));
        vm.prank(driver);
        c.depositDriverCollateral{value: 1 ether}();
        vm.prank(rider);
        c.registerUser();

        bytes memory sig = _sig(address(c), rider, driver, 1 ether, true, c.driverNonces(driver));
        vm.prank(rider);
        c.acceptRide{value: 1.2 ether}(driver, 1 ether, true, sig);
    }
}
