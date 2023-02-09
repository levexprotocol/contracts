// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.7.6;

import "./DelegateInterface.sol";
import "./Adminable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./LVXLpStakeAutomatorInterface.sol";
import "./lib/TransferHelper.sol";

contract LVXLpStakeAutomator is DelegateInterface, Adminable, ReentrancyGuard, LVXLpStakeAutomatorInterface, LVXLpStakeAutomatorStorage {
    using TransferHelper for IERC20;
    using SafeMath for uint;

    function initialize(
        XLVXInterface _xLVX,
        IERC20 _LVX,
        IERC20 _otherToken,
        IERC20 _lpToken,
        IWETH _nativeToken,
        IUniswapV2Router01 _router
    ) public {
        require(msg.sender == admin, "NAD");
        xLVX = _xLVX;
        LVX = _LVX;
        otherToken = _otherToken;
        lpToken = _lpToken;
        nativeToken = _nativeToken;
        router = _router;
    }

    function createLockBoth(uint LVXAmount, uint otherAmount, uint unlockTime, uint LVXMin, uint otherMin) external payable override nonReentrant {
        transferInBothAndLock(LVXAmount, otherAmount, unlockTime, LVXMin, otherMin);
    }

    function createLockLVX(uint LVXAmount, uint unlockTime, uint LVXMin, uint otherMin) external override nonReentrant {
        transferInLVXAndLock(LVXAmount, unlockTime, LVXMin, otherMin);
    }

    function createLockOther(uint otherAmount, uint unlockTime, uint LVXMin, uint otherMin) external payable override nonReentrant {
        transferInOtherAndLock(otherAmount, unlockTime, LVXMin, otherMin);
    }


    function increaseAmountBoth(uint LVXAmount, uint otherAmount, uint LVXMin, uint otherMin) external payable override nonReentrant {
        transferInBothAndLock(LVXAmount, otherAmount, 0, LVXMin, otherMin);
    }

    function increaseAmountLVX(uint LVXAmount, uint LVXMin, uint otherMin) external override nonReentrant {
        transferInLVXAndLock(LVXAmount, 0, LVXMin, otherMin);
    }

    function increaseAmountOther(uint otherAmount, uint LVXMin, uint otherMin) external payable override nonReentrant {
        transferInOtherAndLock(otherAmount, 0, LVXMin, otherMin);
    }


    function withdrawBoth(uint LVXMin, uint otherMin) external override nonReentrant {
        (uint LVXOut, uint otherOut) = removeLiquidity(LVXMin, otherMin);
        doTransferOut(msg.sender, LVX, LVXOut);
        doTransferOut(msg.sender, otherToken, otherOut);
    }

    function withdrawLVX(uint LVXMin, uint otherMin) external override nonReentrant {
        (uint LVXOut, uint otherOut) = removeLiquidity(LVXMin, otherMin);
        //swap
        otherToken.safeApprove(address(router), otherOut);
        uint[] memory amounts = router.swapExactTokensForTokens(otherOut, 0, getPath(LVX), address(this), timestamp());
        uint LVXSwapIn = amounts[1];
        doTransferOut(msg.sender, LVX, LVXOut.add(LVXSwapIn));
    }

    function withdrawOther(uint LVXMin, uint otherMin) external override nonReentrant {
        (uint LVXOut, uint otherOut) = removeLiquidity(LVXMin, otherMin);
        //swap
        LVX.safeApprove(address(router), LVXOut);
        uint[] memory amounts = router.swapExactTokensForTokens(LVXOut, 0, getPath(otherToken), address(this), timestamp());
        uint otherSwapIn = amounts[1];
        doTransferOut(msg.sender, otherToken, otherOut.add(otherSwapIn));
    }

    function transferInBothAndLock(uint LVXAmount, uint otherAmount, uint unlockTime, uint LVXMin, uint otherMin) internal {
        // transferIn
        uint LVXIn = transferIn(msg.sender, LVX, LVXAmount);
        uint otherIn = transferIn(msg.sender, otherToken, otherAmount);
        // add liquidity and increase amount
        addLiquidityAndLock(LVXIn, otherIn, unlockTime, LVXMin, otherMin);
    }

    function transferInLVXAndLock(uint LVXAmount, uint unlockTime, uint LVXMin, uint otherMin) internal {
        // transferIn
        uint LVXIn = transferIn(msg.sender, LVX, LVXAmount);
        // swap
        uint LVXSwapOut = LVXIn.div(2);
        LVX.safeApprove(address(router), LVXSwapOut);
        uint[] memory amounts = router.swapExactTokensForTokens(LVXSwapOut, 0, getPath(otherToken), address(this), timestamp());
        uint otherIn = amounts[1];
        // add liquidity and create lock
        addLiquidityAndLock(LVXIn.sub(LVXSwapOut), otherIn, unlockTime, LVXMin, otherMin);
    }

    function transferInOtherAndLock(uint otherAmount, uint unlockTime, uint LVXMin, uint otherMin) internal {
        // transferIn
        uint otherIn = transferIn(msg.sender, otherToken, otherAmount);
        // swap
        uint otherSwapOut = otherIn.div(2);
        otherToken.safeApprove(address(router), otherSwapOut);
        uint[] memory amounts = router.swapExactTokensForTokens(otherSwapOut, 0, getPath(LVX), address(this), timestamp());
        uint LVXIn = amounts[1];
        // add liquidity and create lock
        addLiquidityAndLock(LVXIn, otherIn.sub(otherSwapOut), unlockTime, LVXMin, otherMin);
    }

    function addLiquidityAndLock(uint LVXIn, uint otherIn, uint unlockTime, uint LVXMin, uint otherMin) internal {
        // add liquidity
        LVX.safeApprove(address(router), LVXIn);
        otherToken.safeApprove(address(router), otherIn);
        (uint LVXOut, uint otherOut, uint liquidity) = router.addLiquidity(address(LVX), address(otherToken), LVXIn, otherIn, LVXMin, otherMin, address(this), timestamp());
        // create lock
        lpToken.safeApprove(address(xLVX), liquidity);
        if (unlockTime > 0) {
            xLVX.create_lock_for(msg.sender, liquidity, unlockTime);
        } else {
            xLVX.increase_amount_for(msg.sender, liquidity);
        }
        // back remainder
        if (LVXIn > LVXOut) {
            doTransferOut(msg.sender, LVX, LVXIn - LVXOut);
        }
        if (otherIn > otherOut) {
            doTransferOut(msg.sender, otherToken, otherIn - otherOut);
        }
    }

    function removeLiquidity(uint LVXMin, uint otherMin) internal returns (uint LVXOut, uint otherOut){
        //withdraw
        xLVX.withdraw_automator(msg.sender);
        uint liquidity = lpToken.balanceOf(address(this));
        lpToken.safeApprove(address(router), liquidity);
        //remove liquidity
        (LVXOut, otherOut) = router.removeLiquidity(address(LVX), address(otherToken), liquidity, LVXMin, otherMin, address(this), timestamp());
    }

    function transferIn(address from, IERC20 token, uint amount) internal returns (uint) {
        if (isNativeToken(token)) {
            nativeToken.deposit{value : msg.value}();
            return msg.value;
        } else {
            return token.safeTransferFrom(from, address(this), amount);
        }
    }

    function doTransferOut(address to, IERC20 token, uint amount) internal {
        if (isNativeToken(token)) {
            nativeToken.withdraw(amount);
            (bool success,) = to.call{value : amount}("");
            require(success);
        } else {
            token.safeTransfer(to, amount);
        }
    }

    function isNativeToken(IERC20 token) internal view returns (bool) {
        return address(token) == address(nativeToken);
    }

    function getPath(IERC20 destToken) internal view returns (address[] memory path) {
        path = new address[](2);
        path[0] = address(destToken) == address(LVX) ? address(otherToken) : address(LVX);
        path[1] = address(destToken) == address(LVX) ? address(LVX) : address(otherToken);
    }

    function timestamp() internal view returns (uint){
        return block.timestamp;
    }
}

