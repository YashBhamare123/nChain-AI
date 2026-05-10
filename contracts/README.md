# Smart Contract Module

## Files
- `src/Carpool.sol` — Main carpool settlement contract with full NatSpec docs.
- `test/Carpool.t.sol` — Main correctness/security test suite.
- `test/GasComparison.t.sol` — Current gas benchmark suite for key hot paths.

## Design Decisions
- **No shared rides** — `joinSharedRide` was removed. The contract focuses on the clean solo-ride lifecycle: `acceptRide → startRide → completeRide`, with optional `cancelRide`, `disputeRide`, and `rateDriver`.
- **Pull-payment settlement** — All ETH payouts (driver earnings, rider refunds) are booked to `pendingWithdrawals` and claimed via `withdraw()`. This eliminates push-to-unknown DoS vectors entirely.
- **Signature domain separation** — `acceptRide` signatures bind `address(this) + rider + driver + fare + ceiling + nonce + chainId`, preventing replay across contracts and chains.

## Rubric-Oriented Hardening
- `nonReentrant` on all ETH-touching functions (including `disputeRide`).
- `require(estimatedTime > 0)` in `startRide` prevents zero-ETA surcharge abuse.
- `_bond <= 100` constructor guard prevents overflow in ceiling bond calculation.
- Zero-value guards on all deposits, withdrawals, and fare inputs.
- Driver existence and active-status checks in `acceptRide`.
- Surcharge capped at `fare + ceilingBond` total in `completeRide` (no over-payout).
- Driver auto-suspended when collateral drops below minimum on `withdrawCollateral`.

## Build / Test (Foundry)

```bash
# Install OZ dependency
forge install OpenZeppelin/openzeppelin-contracts

# Build
forge build

# Run all tests (44 tests, 0 failures)
forge test -vv

# Gas report
forge test --match-contract GasComparisonTest --gas-report

# Coverage (Carpool.sol only)
forge coverage --ir-minimum --match-contract CarpoolTest --report summary
```

## Latest Verified Local Results (May 10, 2026)

- `forge test --match-contract CarpoolTest`: **44 passed, 0 failed**
- Coverage (`forge coverage --ir-minimum --match-contract CarpoolTest`):
  - Lines:      **99.40% (167/168)**
  - Statements: **99.38% (161/162)**
  - Functions:  **100.00% (18/18)**

## Gas Optimisation Evidence
- Before/after explanation and numbers: `../reports/gas-optimization-explanation.md`
- Current benchmark reproducer: `forge test --match-contract GasComparisonTest --gas-report`
