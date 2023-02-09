// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import '@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router01.sol';
import "./XLVXInterface.sol";
import "./IWETH.sol";

contract LVXLpStakeAutomatorStorage {
    XLVXInterface public xLVX;
    IERC20 public LVX;
    IERC20 public otherToken;
    IERC20 public lpToken;
    IWETH public nativeToken;
    IUniswapV2Router01 router;
}

interface LVXLpStakeAutomatorInterface {

    function createLockBoth(uint LVXAmount, uint otherAmount, uint unlockTime, uint LVXMin, uint otherMin) external payable;

    function createLockLVX(uint LVXAmount, uint unlockTime, uint LVXMin, uint otherMin) external ;

    function createLockOther(uint otherAmount, uint unlockTime, uint LVXMin, uint otherMin) external payable;


    function increaseAmountBoth(uint LVXAmount, uint otherAmount, uint LVXMin, uint otherMin) external payable;

    function increaseAmountLVX(uint LVXAmount, uint LVXMin, uint otherMin) external ;

    function increaseAmountOther(uint otherAmount, uint LVXMin, uint otherMin) external payable;


    function withdrawBoth(uint LVXMin, uint otherMin) external;

    function withdrawLVX(uint LVXMin, uint otherMin) external;

    function withdrawOther(uint LVXMin, uint otherMin) external;


}