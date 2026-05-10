// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title Carpool
/// @notice On-chain ride settlement contract for rider/driver matching, trip lifecycle, and payouts.
/// @dev Uses signature-based approvals and pull payments to reduce transfer-related reentrancy/DoS risk.
contract Carpool is Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    /// @notice Backend service address used by off-chain integrations.
    address public backend;

    /// @notice Next sequential ride id to assign.
    uint256 public nextRideId;

    /// @notice Minimum collateral a driver must deposit to become active.
    uint256 public immutable DRIVER_MIN_DEPOSIT;

    /// @notice Percentage bond applied when ceiling protection is enabled.
    uint256 public immutable CEILING_BOND_PERCENT;

    /// @notice Delay grace period before surcharge is applied.
    uint256 public immutable delayThreshold;

    /// @notice Additional wei charged per second after threshold breach.
    uint256 public immutable surchargePerSecond;

    /// @notice Tracks whether a driver identity hash was already used.
    mapping(bytes32 => bool) public idsHashUsed;
    /// @notice Driver profile by driver wallet.
    mapping(address => Driver) public drivers;
    /// @notice Nonce per driver for `acceptRide` signatures.
    mapping(address => uint256) public driverNonces;
    /// @notice Ride data by on-chain ride id.
    mapping(uint256 => Ride) public rides;
    /// @notice Registered user profiles by wallet.
    mapping(address => User) public users;
    /// @notice Pull-payment balances for all participants.
    mapping(address => uint256) public pendingWithdrawals;

    /// @notice Driver lifecycle state.
    enum DriverStatus {
        Verified,
        Active,
        Suspended,
        Banned
    }

    /// @notice Ride lifecycle state.
    enum RideStatus {
        Requested,
        Accepted,
        Started,
        Completed,
        Cancelled,
        Disputed
    }

    /// @notice Driver profile and accounting state.
    struct Driver {
        address driverAddress;
        DriverStatus status;
        bool isOnRide;
        bytes32 docHash;
        uint256 rating;
        uint256 ratingCount;
        uint256 amtDeposited;
    }

    /// @notice Latitude/longitude pair.
    struct Location {
        int256 lat;
        int256 long;
    }

    /// @notice Core ride settlement record.
    struct Ride {
        address user;
        RideStatus status;
        address driver;
        Location start;
        Location end;
        uint256 fare;
        uint256 finalFare;
        uint256 ceilingBond;
        uint256 startTime;
        uint256 endTime;
        uint256 estimatedTime;
        uint256 rating;
        bytes32 reviewCidHash;
    }

    /// @notice User profile and simple activity counters.
    struct User {
        address userAddress;
        uint256 totalRides;
        uint256 totalScoreGiven;
    }

    /// @notice Emitted when owner registers a driver.
    event DriverRegistered(address indexed driver);
    /// @notice Emitted when driver adds collateral.
    event DriverCollateralDeposited(address indexed driver, uint256 amount);
    /// @notice Emitted when collateral is moved to pending withdrawal.
    event DriverCollateralWithdrawn(address indexed driver, uint256 amount);
    /// @notice Emitted when suspended driver is reactivated.
    event DriverReactivated(address indexed driver);
    /// @notice Emitted on successful ride acceptance.
    event RideAccepted(
        uint256 indexed rideId, address indexed passenger, address indexed driver, uint256 fare, bool ceiling
    );
    /// @notice Emitted when ride is started.
    event RideStarted(uint256 indexed rideId);
    /// @notice Emitted when ride settlement is finalized.
    event RideCompleted(uint256 indexed rideId, uint256 payout);
    /// @notice Emitted when ride is cancelled.
    event RideCancelled(uint256 indexed rideId);
    /// @notice Emitted when ride enters dispute state.
    event RideDisputed(uint256 indexed rideId);
    /// @notice Emitted when owner resolves dispute.
    event DisputeResolved(uint256 indexed rideId);
    /// @notice Emitted when rider rates a driver.
    event DriverRated(address indexed driver, uint256 rating, bytes32 reviewCidHash);
    /// @notice Emitted on successful pull withdrawal.
    event Withdrawal(address indexed to, uint256 amount);
    /// @notice Emitted when backend address changes.
    event BackendUpdated(address indexed oldBackend, address indexed newBackend);

    /// @dev Restricts call to active drivers only.
    modifier onlyActiveDriver() {
        require(drivers[msg.sender].status == DriverStatus.Active, "Inactive");
        _;
    }

    /// @dev Restricts call to existing rides only.
    modifier rideExists(uint256 id) {
        require(rides[id].user != address(0), "No rider");
        _;
    }

    /// @notice Deploys contract and immutable runtime parameters.
    /// @param _owner Owner/admin wallet.
    /// @param _backend Backend service wallet.
    /// @param _min Minimum driver collateral.
    /// @param _bond Ceiling bond percent (0-100).
    /// @param _delayThreshold Delay threshold in seconds before surcharge accrues.
    /// @param _surchargePerSecond Surcharge in wei per excess second.
    constructor(
        address _owner,
        address _backend,
        uint256 _min,
        uint256 _bond,
        uint256 _delayThreshold,
        uint256 _surchargePerSecond
    ) Ownable(_owner) {
        require(_owner != address(0), "Invalid");
        require(_backend != address(0), "Invalid ");
        require(_bond <= 100, "Bond too high");
        backend = _backend;
        DRIVER_MIN_DEPOSIT = _min;
        CEILING_BOND_PERCENT = _bond;
        delayThreshold = _delayThreshold;
        surchargePerSecond = _surchargePerSecond;
    }

    /// @notice Updates backend address.
    /// @param _backend New backend wallet address.
    function setBackend(address _backend) external onlyOwner {
        require(_backend != address(0), "Invalid");
        address oldBackend = backend;
        backend = _backend;
        emit BackendUpdated(oldBackend, _backend);
    }

    /// @notice Registers a new verified driver.
    /// @param d Driver wallet address.
    /// @param id Unique hashed driver identity (prevents duplicate registrations).
    /// @param doc Driver document hash stored on-chain for audit.
    function registerDriver(address d, bytes32 id, bytes32 doc) external onlyOwner {
        require(d != address(0), "Invalid driver");
        require(drivers[d].driverAddress == address(0), "Driver exists");
        require(!idsHashUsed[id], "ID used");
        idsHashUsed[id] = true;

        drivers[d] = Driver(d, DriverStatus.Verified, false, doc, 0, 0, 0);
        emit DriverRegistered(d);
    }

    /// @notice Deposits driver collateral; auto-activates a verified driver once minimum is met.
    function depositDriverCollateral() external payable nonReentrant {
        Driver storage d = drivers[msg.sender];
        require(d.driverAddress != address(0), "Not");
        require(d.status != DriverStatus.Banned, "Driver banned");
        require(msg.value > 0, "Zero deposit");

        d.amtDeposited += msg.value;

        if (d.status == DriverStatus.Verified && d.amtDeposited >= DRIVER_MIN_DEPOSIT) {
            d.status = DriverStatus.Active;
        }

        emit DriverCollateralDeposited(msg.sender, msg.value);
    }

    /// @notice Reactivates a suspended driver after sufficient collateral top-up.
    function reactivateDriver() external payable nonReentrant {
        Driver storage d = drivers[msg.sender];
        require(d.status == DriverStatus.Suspended, "Not suspended");
        require(msg.value > 0, "Zero deposit");

        d.amtDeposited += msg.value;
        require(d.amtDeposited >= DRIVER_MIN_DEPOSIT, "Below minimum");

        d.status = DriverStatus.Active;
        emit DriverReactivated(msg.sender);
    }

    /// @notice Moves collateral amount into pending withdrawals; suspends driver if below minimum.
    /// @param amount Amount in wei to move from collateral to withdrawable balance.
    function withdrawCollateral(uint256 amount) external nonReentrant {
        Driver storage d = drivers[msg.sender];
        require(d.driverAddress != address(0), "Not");
        require(!d.isOnRide, "On ride");
        require(amount > 0, "Zero amount");
        require(amount <= d.amtDeposited, "Insufficient");

        d.amtDeposited -= amount;
        pendingWithdrawals[msg.sender] += amount;
        if (d.status == DriverStatus.Active && d.amtDeposited < DRIVER_MIN_DEPOSIT) {
            d.status = DriverStatus.Suspended;
        }

        emit DriverCollateralWithdrawn(msg.sender, amount);
    }

    /// @notice Pulls the caller's entire pending balance via the pull-payment pattern.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "failed");

        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Registers the caller as a rider on-chain.
    function registerUser() external {
        require(users[msg.sender].userAddress == address(0), "Already");
        users[msg.sender] = User(msg.sender, 0, 0);
    }

    /// @notice Accepts a driver offer and locks fare (+ optional ceiling bond) on-chain.
    /// @param driver Chosen driver wallet address.
    /// @param fare Base fare in wei agreed with the driver.
    /// @param ceiling Whether to enable the ceiling bond (rider deposits extra bond to cap max fare).
    /// @param sig Driver ECDSA signature over (contractAddress, rider, driver, fare, ceiling, nonce, chainId).
    /// @return id Newly created on-chain ride id.
    function acceptRide(address driver, uint256 fare, bool ceiling, bytes calldata sig)
        external
        payable
        returns (uint256 id)
    {
        require(users[msg.sender].userAddress != address(0), "User");
        require(driver != address(0), "Invalid driver");
        require(drivers[driver].driverAddress != address(0), "Driver");
        require(drivers[driver].status == DriverStatus.Active, "Inactive");
        require(!drivers[driver].isOnRide, " busy");
        require(fare > 0, "Fare");

        uint256 nonce = driverNonces[driver];

        bytes32 hash = keccak256(abi.encode(address(this), msg.sender, driver, fare, ceiling, nonce, block.chainid));
        require(MessageHashUtils.toEthSignedMessageHash(hash).recover(sig) == driver, "Invalid driver sig");

        unchecked {
            ++driverNonces[driver];
        }
        uint256 required = fare + (ceiling ? (fare * CEILING_BOND_PERCENT) / 100 : 0);
        require(msg.value == required, "Incorrect");

        drivers[driver].isOnRide = true;

        id = nextRideId;
        unchecked {
            ++nextRideId;
        }
        Ride storage r = rides[id];
        r.user = msg.sender;
        r.driver = driver;
        r.fare = fare;
        r.ceilingBond = required - fare;
        r.status = RideStatus.Accepted;

        emit RideAccepted(id, msg.sender, driver, fare, ceiling);
    }

    /// @notice Starts an accepted ride, recording coordinates and estimated trip duration.
    /// @param id Ride id to start.
    /// @param a Pickup latitude (scaled integer).
    /// @param b Pickup longitude (scaled integer).
    /// @param c Drop latitude (scaled integer).
    /// @param d Drop longitude (scaled integer).
    /// @param estimatedTime Estimated trip duration in seconds; must be > 0.
    function startRide(uint256 id, int256 a, int256 b, int256 c, int256 d, uint256 estimatedTime)
        external
        onlyActiveDriver
        rideExists(id)
    {
        Ride storage r = rides[id];
        require(msg.sender == r.driver, "Not ride driver");
        require(r.status == RideStatus.Accepted, "Invalid status");
        require(estimatedTime > 0, "Zero ETA");

        r.status = RideStatus.Started;
        r.start = Location(a, b);
        r.end = Location(c, d);
        r.startTime = block.timestamp;
        r.estimatedTime = estimatedTime;

        emit RideStarted(id);
    }

    /// @notice Completes a started ride and books driver payout / rider refund to pull balances.
    /// @dev Applies a per-second surcharge for time exceeding estimatedTime + delayThreshold,
    ///      capped at the total escrowed amount (fare + ceiling bond).
    /// @param id Ride id to complete.
    function completeRide(uint256 id) external onlyActiveDriver nonReentrant rideExists(id) {
        Ride storage r = rides[id];
        address rDriver = r.driver;
        address rUser = r.user;
        require(msg.sender == rDriver, "Not ride driver");
        require(r.status == RideStatus.Started, "Wrong");

        uint256 endTime = block.timestamp;
        r.endTime = endTime;
        uint256 rFare = r.fare;
        uint256 finalFare = rFare;
        uint256 actualTime;
        unchecked {
            actualTime = endTime - r.startTime;
        }

        if (actualTime > r.estimatedTime + delayThreshold) {
            unchecked {
                uint256 excessTime = actualTime - (r.estimatedTime + delayThreshold);
                finalFare += excessTime * surchargePerSecond;
            }
        }

        uint256 total = rFare + r.ceilingBond;
        if (finalFare > total) {
            finalFare = total;
        }

        r.status = RideStatus.Completed;
        r.finalFare = finalFare;
        drivers[rDriver].isOnRide = false;

        uint256 riderRefund = total - finalFare;
        uint256 driverPayout = finalFare;

        pendingWithdrawals[rDriver] += driverPayout;

        if (riderRefund > 0) {
            pendingWithdrawals[rUser] += riderRefund;
        }
        emit RideCompleted(id, driverPayout);
    }

    /// @notice Cancels an accepted or started ride and queues a full refund for the rider.
    /// @param id Ride id to cancel.
    function cancelRide(uint256 id) external nonReentrant rideExists(id) {
        Ride storage r = rides[id];
        address rUser = r.user;
        address rDriver = r.driver;
        require(msg.sender == rUser || msg.sender == rDriver, "Unauthorized");
        require(r.status == RideStatus.Started || r.status == RideStatus.Accepted, "Wrong status");

        r.status = RideStatus.Cancelled;
        drivers[rDriver].isOnRide = false;

        pendingWithdrawals[rUser] += r.fare + r.ceilingBond;

        emit RideCancelled(id);
    }

    /// @notice Marks a started ride as disputed, pausing settlement until resolved by owner.
    /// @param id Ride id to dispute.
    function disputeRide(uint256 id) external nonReentrant rideExists(id) {
        Ride storage r = rides[id];
        require(msg.sender == r.user || msg.sender == r.driver, "Unauthorized");
        require(r.status == RideStatus.Started, "Wrong status");

        r.status = RideStatus.Disputed;
        emit RideDisputed(id);
    }

    /// @notice Owner resolves a disputed ride by assigning driver payout; remainder refunded to rider.
    /// @param id Ride id to resolve.
    /// @param payout Driver payout in wei; must not exceed the total escrowed amount.
    function resolveDispute(uint256 id, uint256 payout) external onlyOwner nonReentrant {
        Ride storage r = rides[id];
        require(r.status == RideStatus.Disputed, "Not disputed");

        uint256 total = r.fare + r.ceilingBond;
        require(payout <= total, "Payout exceeds total");

        r.status = RideStatus.Completed;
        r.finalFare = payout;
        r.endTime = block.timestamp;
        address rDriver = r.driver;
        address rUser = r.user;
        drivers[rDriver].isOnRide = false;

        pendingWithdrawals[rDriver] += payout;
        pendingWithdrawals[rUser] += (total - payout);

        emit DisputeResolved(id);
    }

    /// @notice Rates the driver for a completed ride; each ride may only be rated once.
    /// @param id Ride id to rate.
    /// @param rating Integer rating between 1 and 5 (inclusive).
    /// @param reviewCidHash Keccak hash (or canonical hash representation) of off-chain IPFS review CID metadata.
    function rateDriver(uint256 id, uint256 rating, bytes32 reviewCidHash) external rideExists(id) {
        require(rating >= 1 && rating <= 5, "Rating out of range");
        require(reviewCidHash != bytes32(0), "Empty review hash");

        Ride storage r = rides[id];
        require(msg.sender == r.user, "Not rider");
        require(r.status == RideStatus.Completed, "Ride not complete");
        require(r.rating == 0, "Already rated");

        r.rating = rating;
        r.reviewCidHash = reviewCidHash;
        address rDriver = r.driver;
        Driver storage dr = drivers[rDriver];
        dr.rating += rating;
        unchecked {
            ++dr.ratingCount;
        }

        emit DriverRated(rDriver, rating, reviewCidHash);
    }

    /// @notice Returns full stored ride details as a memory struct.
    /// @param id Ride id to query.
    /// @return ride Ride memory struct for the given id.
    function getRide(uint256 id) external view returns (Ride memory ride) {
        return rides[id];
    }
}
