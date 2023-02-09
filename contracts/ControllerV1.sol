// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.7.6;
pragma experimental ABIEncoderV2;

import "./ControllerInterface.sol";
import "./liquidity/LPoolDelegator.sol";
import "./Adminable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./DelegateInterface.sol";
import "./lib/DexData.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./LevexInterface.sol";
import "./XlvxInterface.sol";

/// @title Levexerage Controller Logic
/// @author Levexerage
/// @notice You can use this contract for operating trades and find trading intel.
/// @dev Admin of this contract is the address of Timelock. Admin set configs and transfer insurance expected to Xlvx.
contract ControllerV1 is DelegateInterface, Adminable, ControllerInterface, ControllerStorage {
    using SafeMath for uint;
    constructor () {}

    /// @notice Initialize proxy contract
    /// @dev This function is not supposed to call multiple times. All configs can be set through other functions.
    /// @param _lvxToken Address of lvxToken.
    /// @param _xlvxToken address of XlvxToken.
    /// @param _wETH Address of wrapped native coin.
    /// @param _lpoolImplementation Address of lending pool logic contract.
    /// @param _Levex Address of Levex aggregator contract.
    /// @param _dexAggregator Address of DexAggregatorDelegator.
    /// @param _lvxWethDexData Index and feeRate of lvx/weth pair.
    function initialize(
        IERC20 _lvxToken,
        address _xlvxToken,
        address _wETH,
        address _lpoolImplementation,
        address _Levex,
        DexAggregatorInterface _dexAggregator,
        bytes memory _lvxWethDexData
    ) public {
        require(msg.sender == admin, "not admin");
        lvxToken = _lvxToken;
        xlvxToken = _xlvxToken;
        wETH = _wETH;
        lpoolImplementation = _lpoolImplementation;
        Levex = _Levex;
        dexAggregator = _dexAggregator;
        lvxWethDexData = _lvxWethDexData;
    }

    struct LPoolPairVar {
        address token0;
        address token1;
        uint16 marginLimit;
        bytes dexData;
        string tokenName;
        string tokenSymbol;
    }

    /// @notice Create Lending pools for token0, token1. create market on Levex
    /// @param token0 Address of token0
    /// @param token1 Address of token1
    /// @param marginLimit The liquidation trigger ratio of deposited token value to borrowed token value.
    /// @param dexData Pair initiate data including index, feeRate of the Dex and tax rate of the underlying tokens.
    function createLPoolPair(address token0, address token1, uint16 marginLimit, bytes memory dexData) external override {
        require(token0 != token1, 'identical address');
        require(lpoolPairs[token0][token1].lpool0 == address(0) || lpoolPairs[token1][token0].lpool0 == address(0), 'pool pair exists');
        LPoolPairVar memory pairVar = LPoolPairVar(token0, token1, marginLimit, dexData, "Levexerage LToken", "LToken");
        LPoolDelegator pool0 = new LPoolDelegator();
        pool0.initialize(pairVar.token0, pairVar.token0 == wETH ? true : false, address(this), baseRatePerBlock, multiplierPerBlock, jumpMultiplierPerBlock, kink, 1e18,
            pairVar.tokenName, pairVar.tokenSymbol, ERC20(pairVar.token0).decimals(), admin, lpoolImplementation);
        LPoolDelegator pool1 = new LPoolDelegator();
        pool1.initialize(pairVar.token1, pairVar.token1 == wETH ? true : false, address(this), baseRatePerBlock, multiplierPerBlock, jumpMultiplierPerBlock, kink, 1e18,
            pairVar.tokenName, pairVar.tokenSymbol, ERC20(pairVar.token1).decimals(), admin, lpoolImplementation);
        lpoolPairs[token0][token1] = LPoolPair(address(pool0), address(pool1));
        lpoolPairs[token1][token0] = LPoolPair(address(pool0), address(pool1));
        uint16 marketId = (LevexInterface(Levex)).addMarket(LPoolInterface(address(pool0)), LPoolInterface(address(pool1)), pairVar.marginLimit, pairVar.dexData);
        emit LPoolPairCreated(pairVar.token0, address(pool0), pairVar.token1, address(pool1), marketId, pairVar.marginLimit, pairVar.dexData);
    }


    /*** Policy Hooks ***/
    function mintAllowed(address minter, uint lTokenAmount) external override onlyLPoolAllowed onlyNotSuspended {
        // Shh - currently unused
        minter;
        lTokenAmount;
    }

    function transferAllowed(address from, address to, uint lTokenAmount) external override {
        // Shh - currently unused
        from;
        to;
        lTokenAmount;
    }

    function redeemAllowed(address redeemer, uint lTokenAmount) external override onlyNotSuspended {
        // Shh - currently unused
        redeemer;
        lTokenAmount;
    }

    function borrowAllowed(address borrower, address payee, uint borrowAmount) external override onlyLPoolAllowed onlyNotSuspended onlyLevexOperator(payee) {
        // Shh - currently unused
        borrower;
        require(LPoolInterface(msg.sender).availableForBorrow() >= borrowAmount, "Borrow out of range");
    }

    function repayBorrowAllowed(address payer, address borrower, uint repayAmount, bool isEnd) external override {
        // Shh - currently unused
        repayAmount;
        borrower;
        repayAmount;
        if (isEnd) {
            require(Levex == payer, "Operator not Levex");
        }
    }

    function liquidateAllowed(uint marketId, address liquidator, uint liquidateAmount, bytes memory dexData) external override onlyLevexOperator(msg.sender) {
        // Shh - currently unused
        liquidator;
        liquidateAmount;
        dexData;
        require(!marketSuspend[marketId], 'Market suspended');

    }

    function marginTradeAllowed(uint marketId) external view override onlyNotSuspended returns (bool){
        require(!marketSuspend[marketId], 'Market suspended');
        return true;
    }

    function closeTradeAllowed(uint marketId) external view override returns (bool){
        require(!suspendAll, 'Suspended');
        return true;
    }

    function updatePriceAllowed(uint marketId, address payee) external override onlyLevexOperator(msg.sender) {
        // Shh - currently unused
        marketId;
        payee;
    }

    function updateInterestAllowed(address payable sender) external override {
        require(sender == admin || sender == developer, 'caller must be admin or developer');
    }


    function setLPoolImplementation(address _lpoolImplementation) external override onlyAdmin {
        require(address(0) != _lpoolImplementation, '0x');
        lpoolImplementation = _lpoolImplementation;
    }

    function setLevex(address _Levex) external override onlyAdmin {
        require(address(0) != _Levex, '0x');
        Levex = _Levex;
    }

    function setDexAggregator(DexAggregatorInterface _dexAggregator) external override onlyAdmin {
        require(address(0) != address(_dexAggregator), '0x');
        dexAggregator = _dexAggregator;
    }

    function setInterestParam(uint256 _baseRatePerBlock, uint256 _multiplierPerBlock, uint256 _jumpMultiplierPerBlock, uint256 _kink) external override onlyAdmin {
        require(_baseRatePerBlock < 1e13 && _multiplierPerBlock < 1e13 && _jumpMultiplierPerBlock < 1e13 && _kink <= 1e18, 'PRI');
        baseRatePerBlock = _baseRatePerBlock;
        multiplierPerBlock = _multiplierPerBlock;
        jumpMultiplierPerBlock = _jumpMultiplierPerBlock;
        kink = _kink;
    }

    function setLPoolUnAllowed(address lpool, bool unAllowed) external override onlyAdminOrDeveloper {
        lpoolUnAlloweds[lpool] = unAllowed;
    }

    function setSuspend(bool _uspend) external override onlyAdminOrDeveloper {
        suspend = _uspend;
    }

    function setSuspendAll(bool _uspend) external override onlyAdminOrDeveloper {
        suspendAll = _uspend;
    }

    function setMarketSuspend(uint marketId, bool suspend) external override onlyAdminOrDeveloper {
        marketSuspend[marketId] = suspend;
    }

    function setlvxWethDexData(bytes memory _lvxWethDexData) external override onlyAdminOrDeveloper {
        lvxWethDexData = _lvxWethDexData;
    }

    modifier onlyLPoolAllowed() {
        require(!lpoolUnAlloweds[msg.sender], "LPool paused");
        _;
    }

    modifier onlyNotSuspended() {
        require(!suspend, 'Suspended');
        require(!suspendAll, 'Suspended all');
        _;
    }

    modifier onlyLevexOperator(address operator) {
        require(Levex == operator || Levex == address(0), "Operator not Levex");
        _;
    }

}