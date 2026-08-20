// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title A token launched through the Arc launchpad
/// @notice Fixed-supply ERC20 with no mint function, no owner, no pause, no
///         blacklist and — importantly — **no transfer tax**. Every transfer
///         moves the full amount.
///
/// @dev Optionally carries holder-reward accounting. When the creator picks
///      `rewardHolders` at launch, the creator's share of pool swap fees is paid
///      into this contract as USDC and becomes claimable pro-rata by holders.
///
///      That accounting is *not* a tax. Nothing is skimmed from transfers; the
///      contract merely records how much each balance has earned so far, using
///      the standard cumulative-reward-per-share technique. The cost is a little
///      extra gas per transfer, and it is skipped entirely when rewards are off.
contract LaunchToken is ERC20, ERC20Permit {
    using SafeERC20 for IERC20;

    /// @notice Off-chain metadata (image, description, socials) as a URI.
    string public metadataURI;

    /// @notice The account that launched this token.
    address public immutable creator;

    /// @notice The launchpad that deployed this token.
    address public immutable launchpad;

    /// @notice USDC, the currency rewards are paid in.
    address public immutable rewardToken;

    /// @notice Whether swap fees are shared with holders rather than kept by the creator.
    bool public immutable rewardsEnabled;

    /// @notice The Uniswap pool. Excluded from rewards — see `_isEligible`.
    address public pool;

    // ---------------------------------------------------------------------
    // Reward accounting
    // ---------------------------------------------------------------------

    /// @dev Scaling factor for reward-per-share. USDC has 6 decimals while the
    ///      supply is measured in 1e18 units, so a small distribution over a
    ///      large supply would truncate to zero at any lower precision.
    uint256 private constant PRECISION = 1e36;

    /// @dev Cumulative USDC distributed per eligible token, scaled by PRECISION.
    uint256 public rewardPerShareStored;

    /// @dev Supply that actually earns: total minus pool, launchpad and zero address.
    uint256 public rewardEligibleSupply;

    /// @dev Distributions received while nothing was eligible yet; rolled into
    ///      the next distribution rather than being stranded.
    uint256 public undistributed;

    /// @notice Lifetime USDC paid into this contract for holders.
    uint256 public totalRewardsReceived;

    /// @dev USDC this contract believes it is holding on behalf of holders —
    ///      everything distributed but unclaimed, plus anything held back.
    ///      `notifyRewards` credits only the balance *above* this figure, so it
    ///      is impossible to credit rewards that were never actually sent in.
    uint256 public accountedRewards;

    /// @notice Lifetime USDC claimed by holders.
    uint256 public totalRewardsClaimed;

    mapping(address => uint256) private _rewardPerSharePaid;
    mapping(address => uint256) private _accrued;

    /// @notice Addresses that do not earn rewards (pool, launchpad).
    mapping(address => bool) public excludedFromRewards;

    event RewardsAdded(uint256 amount, uint256 eligibleSupply);
    event RewardsClaimed(address indexed holder, uint256 amount);
    event PoolSet(address pool);

    error RewardsDisabled();
    error OnlyLaunchpad();
    error PoolAlreadySet();
    error NothingToClaim();

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        string memory metadataURI_,
        address creator_,
        address rewardToken_,
        bool rewardsEnabled_
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        metadataURI = metadataURI_;
        creator = creator_;
        launchpad = msg.sender;
        rewardToken = rewardToken_;
        rewardsEnabled = rewardsEnabled_;

        // The launchpad holds the supply only in transit to the pool, and the
        // pool's position is locked forever — neither should earn.
        excludedFromRewards[msg.sender] = true;

        _mint(msg.sender, totalSupply_);
    }

    /// @notice Record the pool address so it can be excluded from rewards.
    /// @dev Called by the launchpad immediately after pool creation, before any
    ///      tokens reach the pool, so no eligible balance is ever mis-accounted.
    function setPool(address pool_) external {
        if (msg.sender != launchpad) revert OnlyLaunchpad();
        if (pool != address(0)) revert PoolAlreadySet();
        pool = pool_;
        excludedFromRewards[pool_] = true;
        emit PoolSet(pool_);
    }

    // ---------------------------------------------------------------------
    // Rewards
    // ---------------------------------------------------------------------

    /// @notice Permanently destroy `amount` of the caller's tokens.
    /// @dev Used by the launchpad's buy-back mode, but deliberately open to
    ///      anyone: a holder who wants to burn their own bag can. Burning
    ///      reduces `totalSupply`, so market cap and per-token reward maths pick
    ///      the change up automatically.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /// @notice Distribute USDC already transferred into this contract to holders.
    ///
    /// @dev Takes no amount. The figure is derived from the contract's own USDC
    ///      balance minus what is already accounted for, so it can only ever
    ///      credit money that genuinely arrived.
    ///
    ///      An earlier version trusted a caller-supplied amount. Because the
    ///      function is permissionless, anyone could claim a large deposit
    ///      without sending anything, inflating the per-share accounting until
    ///      claims exceeded the real balance — which would have made every
    ///      holder's rewards permanently unclaimable.
    ///
    ///      Still permissionless by design: anyone may top up holders by
    ///      transferring USDC here and calling this.
    function notifyRewards() external {
        if (!rewardsEnabled) revert RewardsDisabled();

        uint256 balance = IERC20(rewardToken).balanceOf(address(this));
        uint256 amount = balance - accountedRewards;
        if (amount == 0) return;
        accountedRewards = balance;

        uint256 payable_ = amount + undistributed;
        uint256 eligible = rewardEligibleSupply;

        if (eligible == 0) {
            // Nobody can earn yet (all supply still sits in the pool). Hold it.
            undistributed = payable_;
        } else {
            rewardPerShareStored += (payable_ * PRECISION) / eligible;
            undistributed = 0;
        }

        totalRewardsReceived += amount;
        emit RewardsAdded(amount, eligible);
    }

    /// @notice USDC currently claimable by `account`.
    function pendingRewards(address account) public view returns (uint256) {
        if (!rewardsEnabled) return 0;
        uint256 owed = _accrued[account];
        if (_isEligible(account)) {
            owed += (balanceOf(account) * (rewardPerShareStored - _rewardPerSharePaid[account]))
                / PRECISION;
        }
        return owed;
    }

    /// @notice Claim accrued USDC rewards.
    function claimRewards() external returns (uint256 amount) {
        if (!rewardsEnabled) revert RewardsDisabled();

        _accrue(msg.sender);
        amount = _accrued[msg.sender];
        if (amount == 0) revert NothingToClaim();

        _accrued[msg.sender] = 0;
        totalRewardsClaimed += amount;
        accountedRewards -= amount;
        IERC20(rewardToken).safeTransfer(msg.sender, amount);

        emit RewardsClaimed(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    /// @dev Zero address, the pool and the launchpad never earn. Excluding the
    ///      pool matters most: it holds the bulk of supply early on, and its
    ///      liquidity is permanently locked, so any rewards credited to it would
    ///      be irrecoverable.
    function _isEligible(address account) private view returns (bool) {
        return account != address(0) && !excludedFromRewards[account];
    }

    /// @dev Bank what `account` has earned at the current rate, then mark it
    ///      settled. Must run *before* the balance changes.
    function _accrue(address account) private {
        if (_isEligible(account)) {
            _accrued[account] += (balanceOf(account) * (rewardPerShareStored - _rewardPerSharePaid[account]))
                / PRECISION;
        }
        _rewardPerSharePaid[account] = rewardPerShareStored;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!rewardsEnabled) {
            super._update(from, to, value);
            return;
        }

        // Settle both parties at the old balances, move the tokens, then adjust
        // the earning supply. No value is taken from `value` at any point.
        _accrue(from);
        _accrue(to);

        super._update(from, to, value);

        if (_isEligible(from)) rewardEligibleSupply -= value;
        if (_isEligible(to)) rewardEligibleSupply += value;
    }
}
