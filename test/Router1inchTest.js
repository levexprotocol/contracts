const utils = require("./utils/LevexUtil");
const {
    Uni2DexData,
    assertThrows,
    getCall1inchSwapData,
} = require("./utils/LevexUtil");
const {advanceMultipleBlocksAndTime, toBN} = require("./utils/EtheUtil");
const LevexV1 = artifacts.require("LevexV1");
const LevexDelegator = artifacts.require("LevexDelegator");
const TestToken = artifacts.require("MockERC20");
const m = require('mocha-logger');
const LevexV1Lib = artifacts.require("LevexV1Lib")
const Mock1inchRouter = artifacts.require("Mock1inchRouter");
const LPool = artifacts.require("LPool");


contract("1inch router", async accounts => {

    let admin = accounts[0];
    let trader = accounts[1];
    let dev = accounts[2];
    let Levex;
    let token0;
    let token1;
    let pool0;
    let pool1;
    let controller;
    let pairId = 0;
    let router;
    let weth;
    let deposit = utils.toWei(1);
    let borrow = utils.toWei(1);

    beforeEach(async () => {
        // create contract
        controller = await utils.createController(admin);
        let LVX = await TestToken.new('LevexERC20', 'LVX');
        token0 = await TestToken.new('TokenA', 'TKA');
        token1 = await TestToken.new('TokenB', 'TKB');
        weth = await utils.createWETH();
        let uniswapFactory = await utils.createUniswapV2Factory();
        await utils.createUniswapV2Pool(uniswapFactory, token0, token1);
        let dexAgg = await utils.createEthDexAgg(uniswapFactory.address, "0x0000000000000000000000000000000000000000", admin);
        xLVX = await utils.createXLVX(LVX.address, admin, dev, dexAgg.address);
        LevexV1Lib = await LevexV1Lib.new();
        await LevexV1.link("LevexV1Lib", LevexV1Lib.address);
        let delegatee = await LevexV1.new();
        Levex = await LevexDelegator.new(controller.address, dexAgg.address, [token0.address, token1.address], weth.address, xLVX.address, [1, 2, 21], admin, delegatee.address);
        Levex = await LevexV1.at(Levex.address);
        await Levex.setCalculateConfig(30, 33, 3000, 5, 25, 25, (30e18) + '', 300, 10, 60);
        await controller.setLevex(Levex.address);
        await controller.setLPoolImplementation((await utils.createLPoolImpl()).address);
        await controller.setInterestParam(toBN(90e16).div(toBN(2102400)), toBN(10e16).div(toBN(2102400)), toBN(20e16).div(toBN(2102400)), 50e16 + '');
        await dexAgg.setLevex(Levex.address);
        await controller.createLPoolPair(token0.address, token1.address, 3000, Uni2DexData);
        router = await Mock1inchRouter.new(dev);
        await Levex.setRouter1inch(router.address);
        await Levex.setMarketConfig(0, 0, 3000, 0, [1, 2, 21]);

        // approve and transfer
        await token0.approve(router.address, utils.toWei(10000000000), {from: dev});
        await token1.approve(router.address, utils.toWei(10000000000), {from: dev});
        await utils.mint(token0, trader, 20000);
        await utils.mint(token1, trader, 20000);
        pool0 = await LPool.at((await Levex.markets(0)).pool0);
        pool1 = await LPool.at((await Levex.markets(0)).pool1);
        await token0.approve(pool0.address, utils.toWei(10000), {from: trader});
        await token0.approve(Levex.address, utils.toWei(10000), {from: trader});
        await token1.approve(pool1.address, utils.toWei(10000), {from: trader});
        await token1.approve(Levex.address, utils.toWei(10000), {from: trader});
        await pool0.mint(utils.toWei(10000), {from: trader});
        await pool1.mint(utils.toWei(10000), {from: trader});
    });

    it("Open and close by 1inch, success", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        await utils.mint(token1, dev, 2);
        await Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader});

        let trade = await Levex.activeTrades(trader, pairId, 1);
        let borrowed = await pool0.borrowBalanceCurrent(trader);
        m.log("after marginTrade ---");
        m.log("current held =", trade.held);
        m.log("current borrowed =", borrowed);
        assert.equal(trade.held.toString(), "1999999999999999999");
        assert.equal(borrowed, "1000000000000000000");

        await advanceMultipleBlocksAndTime(100);
        let closeCallData = getCall1inchSwapData(router, token1.address, token0.address, Levex.address, trade.held.toString(), trade.held.toString());
        await utils.mint(token0, dev, 2);
        await Levex.closeTrade(pairId, true, trade.held, 0, closeCallData, {from: trader});
        let tradeAfter = await Levex.activeTrades(trader, pairId, 1);
        m.log("finish closeTrade, current held = ", tradeAfter.held)
        assert.equal(tradeAfter.held, 0);
        let borrowedAfter = await pool0.borrowBalanceCurrent(trader);
        m.log("current borrowed =", borrowedAfter);
        assert.equal(tradeAfter.held.toString(), 0);
        assert.equal(borrowedAfter, 0);
    })

    it("Verify call 1inch data, receive buyToken address is not LevexV1, revert", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, trader, sellAmount.toString(), "1999999999999999999");
        await utils.mint(token1, dev, 2);
        await assertThrows(Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader}), '1inch: buy amount less than min');
    })

    it("Verify call 1inch data, sellToken address is another token, revert", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, weth.address, token1.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        await utils.mint(token1, dev, 2);
        await assertThrows(Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader}), 'sell token error');
    })

    it("Verify call 1inch data, buyToken address is another token, revert", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        await weth.approve(router.address, utils.toWei(10000000000), {from: dev});
        let callData = getCall1inchSwapData(router, token0.address, weth.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        await utils.mint(weth, dev, 2);
        await assertThrows(Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader}), '1inch: buy amount less than min');
    })

    it("Test replace call 1inch data", async () => {
        let sellAmount = utils.toWei(4);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        m.log("set incoming sell amount more than actual sell amount");
        await utils.mint(token1, dev, 2);
        assert.equal(await token0.balanceOf(Levex.address), 0);
        await Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader});
        assert.equal(await token0.balanceOf(Levex.address), 0);
        m.log("Levex balance check passed");
        let tradeAfter = await Levex.activeTrades(trader, pairId, 1);
        m.log("margin trade successful, current held = ", tradeAfter.held)
        assert.equal(tradeAfter.held.toString(), "1999999999999999999");

        let callData2 = getCall1inchSwapData(router, token1.address, token0.address, Levex.address, utils.toWei(1).toString(), "1999999999999999999");
        m.log("set incoming sell amount less than actual sell amount");
        await utils.mint(token0, dev, 2);
        assert.equal(await token1.balanceOf(Levex.address), "1999999999999999999");
        await Levex.marginTrade(pairId, false, true, deposit, borrow, borrow, callData2, {from: trader});
        assert.equal(await token1.balanceOf(Levex.address), "1999999999999999999");
        m.log("Levex balance check passed");
        let tradeAfter2 = await Levex.activeTrades(trader, pairId, 0);
        m.log("margin trade successful, current held = ", tradeAfter2.held)
        assert.equal(tradeAfter2.held.toString(), "1999999999999999999");
    })

    it("Sell by 1inch data, if 1inch revert, then revert with error info", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "2000000000000000001");
        await utils.mint(token1, dev, 2);
        await assertThrows(Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader}), 'ReturnAmountIsNotEnough');
    })

    it("Sell by 1inch data, buyAmount less than minBuyAmount, revert", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "999999999999999999");
        await utils.mint(token1, dev, 1);
        await assertThrows(Levex.marginTrade(pairId, true, false, deposit, borrow, "1999999999999999999", callData, {from: trader}), '1inch: buy amount less than min');
    })

    it("Long token = deposit token, close by sell twice, success", async () => {
        let sellAmount = utils.toWei(1);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "999999999999999999");
        await utils.mint(token1, dev, 1);
        await Levex.marginTrade(pairId, true, true, deposit, borrow, "999999999999999999", callData, {from: trader});

        let trade = await Levex.activeTrades(trader, pairId, 1);
        let borrowed = await pool0.borrowBalanceCurrent(trader);
        m.log("after marginTrade ---");
        m.log("current held =", trade.held);
        m.log("current borrowed =", borrowed);
        assert.equal(trade.held.toString(), "1999999999999999999");
        assert.equal(borrowed, "1000000000000000000");

        await advanceMultipleBlocksAndTime(100);
        let closeCallData = getCall1inchSwapData(router, token1.address, token0.address, Levex.address, trade.held.toString(), "1999999999999999999");
        await utils.mint(token0, dev, 2);
        let token1BalanceBefore = await token1.balanceOf(trader);
        await Levex.closeTrade(pairId, true, trade.held, trade.held, closeCallData, {from: trader});
        let token1BalanceAfter =await token1.balanceOf(trader);
        assert.equal(token1BalanceAfter - token1BalanceBefore, "996946527001772000");
        let tradeAfter = await Levex.activeTrades(trader, pairId, 1);
        m.log("finish closeTrade, current held = ", tradeAfter.held)
        assert.equal(tradeAfter.held, 0);
        let borrowedAfter = await pool0.borrowBalanceCurrent(trader);
        m.log("current borrowed =", borrowedAfter);
        assert.equal(tradeAfter.held.toString(), 0);
        assert.equal(borrowedAfter, 0);
    })

    it("Long token = deposit token, close by sell twice, fist sell return amount less than buyAmount, revert", async () => {
        let deposit = utils.toWei(1);
        let borrow = utils.toWei(2);
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        await utils.mint(token1, dev, 2);
        await Levex.marginTrade(pairId, true, true, deposit, borrow, "1999999999999999999", callData, {from: trader});

        let trade = await Levex.activeTrades(trader, pairId, 1);
        let borrowed = await pool0.borrowBalanceCurrent(trader);
        m.log("after marginTrade ---");
        m.log("current held =", trade.held);
        m.log("current borrowed =", borrowed);
        assert.equal(trade.held.toString(), "2999999999999999999");
        assert.equal(borrowed, "2000000000000000000");

        await advanceMultipleBlocksAndTime(100);
        let closeCallData = getCall1inchSwapData(router, token1.address, token0.address, Levex.address, trade.held.toString(), "1999999999999999999");
        await utils.mint(token0, dev, 2);
        await assertThrows(Levex.closeTrade(pairId, true, trade.held, trade.held, closeCallData, {from: trader}), 'SafeMath: subtraction overflow');
    })

    it("Long token = deposit token, close by sell twice, second sell return amount less than maxSellAmount, revert", async () => {
        let deposit = utils.toWei(2);
        let borrow = utils.toWei(2);
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        await utils.mint(token1, dev, 2);
        await Levex.marginTrade(pairId, true, true, deposit, borrow, "1999999999999999999", callData, {from: trader});

        let trade = await Levex.activeTrades(trader, pairId, 1);
        let borrowed = await pool0.borrowBalanceCurrent(trader);
        m.log("after marginTrade ---");
        m.log("current held =", trade.held);
        m.log("current borrowed =", borrowed);
        assert.equal(trade.held.toString(), "3999999999999999999");
        assert.equal(borrowed, "2000000000000000000");

        await advanceMultipleBlocksAndTime(100);
        let closeCallData = getCall1inchSwapData(router, token1.address, token0.address, Levex.address, trade.held.toString(), "2999999999999999999");
        await utils.mint(token0, dev, 3);
        await assertThrows(Levex.closeTrade(pairId, true, trade.held, "2500000000000000000", closeCallData, {from: trader}), 'buy amount less than min');
    })

    it("Liquidate not support 1inch", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);

        let callData = getCall1inchSwapData(router, token0.address, token1.address, Levex.address, sellAmount.toString(), "1999999999999999999");
        await utils.mint(token1, dev, 2);
        await Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, callData, {from: trader});

        await assertThrows(Levex.liquidate(trader, pairId, true, 0, utils.maxUint(), callData), 'UDX');
    })

    it("Market create default dex not allow 1inch", async () => {
        await assertThrows(controller.createLPoolPair(weth.address, token1.address, 3000, "0x1500000002"), 'UDX');
    })

    it("1inch router address only can modify by admin", async () => {
        await Levex.setRouter1inch(token1.address);
        assert.equal(await Levex.router1inch(), token1.address);
        consLVX.log("1inch router update success by admin.");
        await assertThrows(Levex.setRouter1inch(router.address, {from: trader}), 'caller must be admin');
    })

    it("1inch router by function : unoswap", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);
        let callData = router.contract.methods.unoswap(token0.address, sellAmount.toString(), "1999999999999999999", ["1457117133357877736574669614693451329632719413002162662161"]).encodeABI();
        await utils.mint(token1, dev, 2);

        m.log("set verify info, start ---");
        await router.setVerifyAmount(sellAmount);
        await router.setVerifyMinReturn("1999999999999999999");
        await router.setVerifyPools(["1457117133357877736574669614693451329632719413002162662161"]);
        await router.setVerifySrcToken(token0.address);
        await router.setVerifyDstToken(token1.address);
        m.log("set verify info, finished ---");

        await Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, "0x1500000002" + callData.substring(2), {from: trader});
        let trade = await Levex.activeTrades(trader, pairId, 1);
        m.log("after marginTrade ---");
        m.log("current held =", trade.held);
        assert.equal(trade.held.toString(), sellAmount.toString());
    })

    it("1inch router by function : uniswapV3Swap", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);
        let callData = router.contract.methods.uniswapV3Swap(sellAmount.toString(), "1999999999999999999", ["1457117133357877736574669614693451329632719413002162662161"]).encodeABI();
        await utils.mint(token1, dev, 2);

        m.log("set verify info, start ---");
        await router.setVerifyAmount(sellAmount);
        await router.setVerifyMinReturn("1999999999999999999");
        await router.setVerifyPools(["1457117133357877736574669614693451329632719413002162662161"]);
        await router.setVerifySrcToken(token0.address);
        await router.setVerifyDstToken(token1.address);
        m.log("set verify info, finished ---");

        await Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, "0x1500000002" + callData.substring(2), {from: trader});
        let trade = await Levex.activeTrades(trader, pairId, 1);
        m.log("after marginTrade ---");
        m.log("current held =", trade.held);
        assert.equal(trade.held.toString(), sellAmount.toString());
    })

    it("1inch router by not supported function, revert", async () => {
        let sellAmount = utils.toWei(2);
        await advanceMultipleBlocksAndTime(100);
        await Levex.updatePrice(pairId, Uni2DexData);
        let callData = router.contract.methods.clipperSwap(sellAmount.toString(), "1999999999999999999", ["1457117133357877736574669614693451329632719413002162662161"]).encodeABI();
        await assertThrows(Levex.marginTrade(pairId, true, false, deposit, borrow, borrow, "0x1500000002" + callData.substring(2), {from: trader}), "USF");
    })

})