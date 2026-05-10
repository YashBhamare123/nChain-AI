// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/src/Carpool.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract CarpoolTest is Test {
    using MessageHashUtils for bytes32;

    Carpool internal cp;

    uint256 internal ownerPk    = 0xA11CE;
    uint256 internal backendPk  = 0xB0B;
    uint256 internal driverPk   = 0xD1;
    uint256 internal riderPk    = 0xE1;
    uint256 internal strangerPk = 0xFA;

    address internal owner;
    address internal backend;
    address internal driver;
    address internal rider;
    address internal stranger;

    uint256 internal constant MIN_DEPOSIT        = 1 ether;
    uint256 internal constant BOND_PERCENT       = 20;
    uint256 internal constant DELAY_THRESHOLD    = 120;
    uint256 internal constant SURCHARGE_PER_SEC  = 1e12;
    bytes32 internal constant REVIEW_HASH = keccak256("ipfs://bafybeigoodreview");

    // ─── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        owner   = vm.addr(ownerPk);
        backend = vm.addr(backendPk);
        driver  = vm.addr(driverPk);
        rider   = vm.addr(riderPk);
        stranger = vm.addr(strangerPk);

        cp = new Carpool(owner, backend, MIN_DEPOSIT, BOND_PERCENT, DELAY_THRESHOLD, SURCHARGE_PER_SEC);

        vm.deal(owner,   100 ether);
        vm.deal(driver,  100 ether);
        vm.deal(rider,   100 ether);
        vm.deal(stranger, 100 ether);
    }

    // ─── Internal helpers ───────────────────────────────────────────────────────

    function _signDriverAccept(address riderAddr, uint256 fare, bool ceiling, uint256 nonce, uint256 signerPk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encode(address(cp), riderAddr, driver, fare, ceiling, nonce, block.chainid))
            .toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _registerAndActivateDriver() internal {
        vm.prank(owner);
        cp.registerDriver(driver, keccak256("id-1"), keccak256("doc-1"));

        vm.prank(driver);
        cp.depositDriverCollateral{value: MIN_DEPOSIT}();

        (,Carpool.DriverStatus st,,,,,) = cp.drivers(driver);
        assertEq(uint256(st), uint256(Carpool.DriverStatus.Active));
    }

    function _acceptRide(uint256 fare, bool ceiling) internal returns (uint256 rideId) {
        vm.prank(rider);
        cp.registerUser();

        uint256 nonce = cp.driverNonces(driver);
        bytes memory sig = _signDriverAccept(rider, fare, ceiling, nonce, driverPk);
        uint256 required = fare + (ceiling ? (fare * BOND_PERCENT) / 100 : 0);

        vm.prank(rider);
        rideId = cp.acceptRide{value: required}(driver, fare, ceiling, sig);
    }

    function _startRide(uint256 rideId) internal {
        vm.prank(driver);
        cp.startRide(rideId, 12971600, 77594600, 12935200, 77624500, 300);
    }

    // ─── Driver registration ────────────────────────────────────────────────────

    function test_RegisterDriverAndActivate() public {
        _registerAndActivateDriver();

        (address dAddr, Carpool.DriverStatus st, bool onRide, , , , uint256 deposited) = cp.drivers(driver);
        assertEq(dAddr, driver);
        assertEq(deposited, MIN_DEPOSIT);
        assertEq(uint256(st), uint256(Carpool.DriverStatus.Active));
        assertFalse(onRide);
    }

    function test_Revert_RegisterDriver_Unauthorized() public {
        vm.expectRevert();
        vm.prank(stranger);
        cp.registerDriver(driver, keccak256("id"), keccak256("doc"));
    }

    function test_Revert_RegisterDriver_DuplicateId() public {
        vm.prank(owner);
        cp.registerDriver(driver, keccak256("id-dup"), keccak256("doc-1"));

        vm.expectRevert(bytes("ID used"));
        vm.prank(owner);
        cp.registerDriver(stranger, keccak256("id-dup"), keccak256("doc-2"));
    }

    function test_Revert_RegisterDriver_ZeroAddress() public {
        vm.expectRevert(bytes("Invalid driver"));
        vm.prank(owner);
        cp.registerDriver(address(0), keccak256("id-zero"), keccak256("doc-zero"));
    }

    // ─── Constructor guards ─────────────────────────────────────────────────────

    function test_Revert_Constructor_InvalidOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new Carpool(address(0), backend, MIN_DEPOSIT, BOND_PERCENT, DELAY_THRESHOLD, SURCHARGE_PER_SEC);
    }

    function test_Revert_Constructor_InvalidBackend() public {
        vm.expectRevert(bytes("Invalid "));
        new Carpool(owner, address(0), MIN_DEPOSIT, BOND_PERCENT, DELAY_THRESHOLD, SURCHARGE_PER_SEC);
    }

    function test_Revert_Constructor_BondTooHigh() public {
        vm.expectRevert(bytes("Bond too high"));
        new Carpool(owner, backend, MIN_DEPOSIT, 101, DELAY_THRESHOLD, SURCHARGE_PER_SEC);
    }

    // ─── setBackend ─────────────────────────────────────────────────────────────

    function test_Revert_SetBackend_ZeroAddress() public {
        vm.expectRevert(bytes("Invalid"));
        vm.prank(owner);
        cp.setBackend(address(0));
    }

    function test_SetBackend_EmitsEvent() public {
        address newBackend = vm.addr(0xBEEF);
        vm.expectEmit(true, true, false, false);
        emit Carpool.BackendUpdated(backend, newBackend);
        vm.prank(owner);
        cp.setBackend(newBackend);
        assertEq(cp.backend(), newBackend);
    }

    // ─── acceptRide ─────────────────────────────────────────────────────────────

    function test_AcceptRide_HappyPath() public {
        _registerAndActivateDriver();
        uint256 fare  = 1 ether;
        uint256 rideId = _acceptRide(fare, true);

        assertEq(rideId, 0);
        assertEq(cp.driverNonces(driver), 1);

        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(r.user,       rider);
        assertEq(r.driver,     driver);
        assertEq(r.fare,       fare);
        assertEq(r.ceilingBond, fare * BOND_PERCENT / 100);
        assertEq(uint256(r.status), uint256(Carpool.RideStatus.Accepted));
    }

    function test_Revert_AcceptRide_InvalidSignature() public {
        _registerAndActivateDriver();
        vm.prank(rider);
        cp.registerUser();

        uint256 fare  = 1 ether;
        uint256 nonce = cp.driverNonces(driver);
        bytes memory badSig = _signDriverAccept(rider, fare, true, nonce, strangerPk);

        vm.expectRevert(bytes("Invalid driver sig"));
        vm.prank(rider);
        cp.acceptRide{value: fare + (fare * BOND_PERCENT) / 100}(driver, fare, true, badSig);
    }

    function test_Revert_AcceptRide_DriverInactive() public {
        vm.prank(owner);
        cp.registerDriver(driver, keccak256("id-inactive"), keccak256("doc-inactive"));
        vm.prank(rider);
        cp.registerUser();

        uint256 fare  = 1 ether;
        uint256 nonce = cp.driverNonces(driver);
        bytes memory sig = _signDriverAccept(rider, fare, false, nonce, driverPk);

        vm.expectRevert(bytes("Inactive"));
        vm.prank(rider);
        cp.acceptRide{value: fare}(driver, fare, false, sig);
    }

    function test_Revert_AcceptRide_IncorrectValue() public {
        _registerAndActivateDriver();
        vm.prank(rider);
        cp.registerUser();

        uint256 fare  = 1 ether;
        uint256 nonce = cp.driverNonces(driver);
        bytes memory sig = _signDriverAccept(rider, fare, false, nonce, driverPk);

        vm.expectRevert(bytes("Incorrect"));
        vm.prank(rider);
        cp.acceptRide{value: fare - 1}(driver, fare, false, sig);
    }

    function test_Revert_AcceptRide_UserNotRegistered() public {
        _registerAndActivateDriver();

        uint256 fare  = 1 ether;
        uint256 nonce = cp.driverNonces(driver);
        bytes memory sig = _signDriverAccept(stranger, fare, false, nonce, driverPk);

        vm.expectRevert(bytes("User"));
        vm.prank(stranger);
        cp.acceptRide{value: fare}(driver, fare, false, sig);
    }

    // ─── startRide ──────────────────────────────────────────────────────────────

    function test_StartRide_HappyPath() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);

        vm.prank(driver);
        cp.startRide(rideId, 1, 2, 3, 4, 300);

        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(uint256(r.status), uint256(Carpool.RideStatus.Started));
        assertEq(r.estimatedTime, 300);
    }

    function test_Revert_StartRide_ZeroEstimatedTime() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);

        vm.expectRevert(bytes("Zero ETA"));
        vm.prank(driver);
        cp.startRide(rideId, 1, 2, 3, 4, 0);
    }

    function test_Revert_StartRide_WrongStatus() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.expectRevert(bytes("Invalid status"));
        vm.prank(driver);
        cp.startRide(rideId, 1, 2, 3, 4, 300);
    }

    function test_Revert_StartRide_NotRideDriver() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);

        // Register and activate a second driver
        address driver2 = vm.addr(0xD2);
        vm.deal(driver2, 10 ether);
        vm.prank(owner);
        cp.registerDriver(driver2, keccak256("id-2"), keccak256("doc-2"));
        vm.prank(driver2);
        cp.depositDriverCollateral{value: MIN_DEPOSIT}();

        vm.expectRevert(bytes("Not ride driver"));
        vm.prank(driver2);
        cp.startRide(rideId, 1, 2, 3, 4, 300);
    }

    // ─── completeRide ───────────────────────────────────────────────────────────

    function test_StartAndCompleteRide_HappyPath() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        uint256 rideId = _acceptRide(fare, true);

        _startRide(rideId);
        vm.warp(block.timestamp + 500); // exceeds 300 + 120 threshold → surcharge

        vm.prank(driver);
        cp.completeRide(rideId);

        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(uint256(r.status), uint256(Carpool.RideStatus.Completed));
        assertGt(r.finalFare, fare);
        assertGt(cp.pendingWithdrawals(driver), 0);
    }

    function test_CompleteRide_WithinTime_NoSurcharge() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        uint256 rideId = _acceptRide(fare, false);

        _startRide(rideId);
        vm.warp(block.timestamp + 100); // within estimatedTime (300) + threshold (120)

        vm.prank(driver);
        cp.completeRide(rideId);

        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(r.finalFare, fare); // no surcharge
        assertEq(cp.pendingWithdrawals(driver), fare);
    }

    function test_CompleteRide_SurchargeCappedAtTotal() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        // ceiling bond = 20% = 0.2 ETH → total = 1.2 ETH
        // surchargePerSecond = 1e12 wei/s → need >200_000 excess seconds to exceed 0.2 ETH
        uint256 rideId = _acceptRide(fare, true);

        _startRide(rideId); // estimatedTime = 300, delayThreshold = 120
        // warp 400_000 seconds past start — well beyond threshold, surcharge >> total
        vm.warp(block.timestamp + 400_000);

        vm.prank(driver);
        cp.completeRide(rideId);

        Carpool.Ride memory r = cp.getRide(rideId);
        uint256 total = fare + (fare * BOND_PERCENT / 100);
        assertEq(r.finalFare, total); // capped at escrowed total
        assertEq(cp.pendingWithdrawals(driver), total);
        assertEq(cp.pendingWithdrawals(rider), 0); // no refund when capped
    }

    function test_Revert_CompleteRide_NotRideDriver() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.expectRevert(bytes("Inactive"));
        vm.prank(stranger);
        cp.completeRide(rideId);
    }

    // ─── cancelRide ─────────────────────────────────────────────────────────────

    function test_CancelRide_WhenAccepted_RefundsRider() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        uint256 rideId = _acceptRide(fare, true);

        uint256 balBefore = rider.balance;
        vm.prank(rider);
        cp.cancelRide(rideId);

        uint256 expected = fare + (fare * BOND_PERCENT) / 100;
        assertEq(cp.pendingWithdrawals(rider), expected);

        (, , bool onRide,,,,) = cp.drivers(driver);
        assertFalse(onRide);

        vm.prank(rider);
        cp.withdraw();
        assertGt(rider.balance, balBefore);
    }

    function test_CancelRide_WhenStarted_RefundsViaWithdrawal() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        uint256 rideId = _acceptRide(fare, true);
        _startRide(rideId);

        vm.prank(rider);
        cp.cancelRide(rideId);

        uint256 pending = cp.pendingWithdrawals(rider);
        assertEq(pending, fare + (fare * BOND_PERCENT) / 100);

        uint256 balBefore = rider.balance;
        vm.prank(rider);
        cp.withdraw();
        assertGt(rider.balance, balBefore);
    }

    function test_CancelRide_WhenAccepted_ByDriver() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);

        vm.prank(driver);
        cp.cancelRide(rideId);

        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(uint256(r.status), uint256(Carpool.RideStatus.Cancelled));
    }

    function test_Revert_CancelRide_Unauthorized() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);

        vm.expectRevert(bytes("Unauthorized"));
        vm.prank(stranger);
        cp.cancelRide(rideId);
    }

    function test_Revert_CancelRide_WrongStatus() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.expectRevert(bytes("Wrong status"));
        vm.prank(rider);
        cp.cancelRide(rideId);
    }

    // ─── disputeRide / resolveDispute ───────────────────────────────────────────

    function test_DisputeAndResolve_HappyPath() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        uint256 rideId = _acceptRide(fare, true);
        _startRide(rideId);

        vm.prank(rider);
        cp.disputeRide(rideId);

        vm.prank(owner);
        cp.resolveDispute(rideId, 0.7 ether);

        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(uint256(r.status), uint256(Carpool.RideStatus.Completed));
        assertEq(r.finalFare, 0.7 ether);

        uint256 total = fare + (fare * BOND_PERCENT / 100);
        assertEq(cp.pendingWithdrawals(driver), 0.7 ether);
        assertEq(cp.pendingWithdrawals(rider),  total - 0.7 ether);
    }

    function test_Revert_DisputeRide_Unauthorized() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.expectRevert(bytes("Unauthorized"));
        vm.prank(stranger);
        cp.disputeRide(rideId);
    }

    function test_Revert_DisputeRide_WrongStatus() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        // ride is in Accepted state, not Started

        vm.expectRevert(bytes("Wrong status"));
        vm.prank(rider);
        cp.disputeRide(rideId);
    }

    function test_Revert_ResolveDispute_PayoutExceedsTotal() public {
        _registerAndActivateDriver();
        uint256 fare   = 1 ether;
        uint256 rideId = _acceptRide(fare, true);
        _startRide(rideId);

        vm.prank(rider);
        cp.disputeRide(rideId);

        vm.expectRevert(bytes("Payout exceeds total"));
        vm.prank(owner);
        cp.resolveDispute(rideId, fare + (fare * BOND_PERCENT) / 100 + 1);
    }

    function test_Revert_ResolveDispute_NotDisputed() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.expectRevert(bytes("Not disputed"));
        vm.prank(owner);
        cp.resolveDispute(rideId, 0);
    }

    // ─── rateDriver ─────────────────────────────────────────────────────────────

    function test_RateDriver_HappyPath() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.prank(rider);
        cp.rateDriver(rideId, 5, REVIEW_HASH);

        (,,,, uint256 rating, uint256 ratingCount,) = cp.drivers(driver);
        assertEq(rating,      5);
        assertEq(ratingCount, 1);
        Carpool.Ride memory r = cp.getRide(rideId);
        assertEq(r.reviewCidHash, REVIEW_HASH);
    }

    function test_Revert_RateDriver_Twice() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.prank(rider);
        cp.rateDriver(rideId, 4, REVIEW_HASH);

        vm.expectRevert(bytes("Already rated"));
        vm.prank(rider);
        cp.rateDriver(rideId, 5, keccak256("ipfs://bafybeianother"));
    }

    function test_Revert_RateDriver_TooLow() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.expectRevert(bytes("Rating out of range"));
        vm.prank(rider);
        cp.rateDriver(rideId, 0, REVIEW_HASH);
    }

    function test_Revert_RateDriver_TooHigh() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.expectRevert(bytes("Rating out of range"));
        vm.prank(rider);
        cp.rateDriver(rideId, 6, REVIEW_HASH);
    }

    function test_Revert_RateDriver_NotRider() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.expectRevert(bytes("Not rider"));
        vm.prank(stranger);
        cp.rateDriver(rideId, 5, REVIEW_HASH);
    }

    function test_Revert_RateDriver_RideNotComplete() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.expectRevert(bytes("Ride not complete"));
        vm.prank(rider);
        cp.rateDriver(rideId, 5, REVIEW_HASH);

    }

    function test_Revert_RateDriver_EmptyReviewHash() public {
        _registerAndActivateDriver();
        uint256 rideId = _acceptRide(1 ether, false);
        _startRide(rideId);

        vm.warp(block.timestamp + 120);
        vm.prank(driver);
        cp.completeRide(rideId);

        vm.expectRevert(bytes("Empty review hash"));
        vm.prank(rider);
        cp.rateDriver(rideId, 5, bytes32(0));
    }

    // ─── collateral withdraw ────────────────────────────────────────────────────

    function test_WithdrawCollateralAndWithdraw_HappyPath() public {
        _registerAndActivateDriver();

        vm.prank(driver);
        cp.withdrawCollateral(0.4 ether);

        assertEq(cp.pendingWithdrawals(driver), 0.4 ether);

        uint256 balBefore = driver.balance;
        vm.prank(driver);
        cp.withdraw();
        assertGt(driver.balance, balBefore);
        assertEq(cp.pendingWithdrawals(driver), 0);
    }

    function test_WithdrawCollateral_SuspendsDriver() public {
        _registerAndActivateDriver();

        // Withdraw enough to drop below MIN_DEPOSIT
        vm.prank(driver);
        cp.withdrawCollateral(0.5 ether);

        (, Carpool.DriverStatus st,,,,,) = cp.drivers(driver);
        assertEq(uint256(st), uint256(Carpool.DriverStatus.Suspended));
    }

    function test_Revert_WithdrawCollateral_WhenOnRide() public {
        _registerAndActivateDriver();
        _acceptRide(1 ether, false);

        vm.expectRevert(bytes("On ride"));
        vm.prank(driver);
        cp.withdrawCollateral(0.1 ether);
    }

    function test_Revert_Withdraw_NothingToWithdraw() public {
        vm.expectRevert(bytes("Nothing to withdraw"));
        vm.prank(stranger);
        cp.withdraw();
    }

    // ─── reactivateDriver ───────────────────────────────────────────────────────

    function test_ReactivateDriver_HappyPath() public {
        _registerAndActivateDriver();

        // Drop below minimum to suspend
        vm.prank(driver);
        cp.withdrawCollateral(0.5 ether);

        (, Carpool.DriverStatus st1,,,,,) = cp.drivers(driver);
        assertEq(uint256(st1), uint256(Carpool.DriverStatus.Suspended));

        // Reactivate with top-up
        vm.prank(driver);
        cp.reactivateDriver{value: 0.6 ether}();

        (, Carpool.DriverStatus st2,,,,,) = cp.drivers(driver);
        assertEq(uint256(st2), uint256(Carpool.DriverStatus.Active));
    }

    function test_Revert_ReactivateDriver_NotSuspended() public {
        _registerAndActivateDriver();

        vm.expectRevert(bytes("Not suspended"));
        vm.prank(driver);
        cp.reactivateDriver{value: 0.5 ether}();
    }
}
