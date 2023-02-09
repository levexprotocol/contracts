const utils = require("./utils/LevexUtil");
const {
    last8,
    Uni2DexData,
    assertThrows,
} = require("./utils/LevexUtil");
const {advanceMultipleBlocksAndTime, toBN} = require("./utils/EtheUtil");
const LevexV1 = artifacts.require("LevexV1");
const LevexDelegator = artifacts.require("LevexDelegator");
const TestToken = artifacts.require("MockERC20");
const m = require('mocha-logger');
const LPool = artifacts.require("LPool");
const LevexV1Lib = artifacts.require("LevexV1Lib")

contract("Levex payoff trade", async accounts => {

    // components
    let Levex;
    let LVX;
    let treasury;
    let uniswapFactory;
    let gotPair;
    let dexAgg;
    // rLVXs
    let admin = accounts[0];
    let saver = accounts[1];
    let trader = accounts[2];
    let dev = accounts[3];
    let token0;
    let token1;
    let controller;
    let delegatee;
    let weth;

    beforeEach(async () => {

        // runs once before the first test in this block
        controller = await utils.createController(admin);
        m.log("Created Controller", last8(controller.address));

        LVX = await TestToken.new('LevexERC20', 'LVX');
        token0 = await TestToken.new('TokenA', 'TKA');
        token1 = await TestToken.new('TokenB', 'TKB');
        weth = await utils.createWETH();

        uniswapFactory = await utils.createUniswapV2Factory();
        gotPair = await utils.createUniswapV2Pool(uniswapFactory, token0, token1);
        dexAgg = await utils.createEthDexAgg(uniswapFactory.address, "0x0000000000000000000000000000000000000000", accounts[0]);
        xLVX = await utils.createXLVX(LVX.address, admin, dev, dexAgg.address);
        LevexV1Lib = await LevexV1Lib.new();
        await LevexV1.link("LevexV1Lib", LevexV1Lib.address);
        delegatee = await LevexV1.new();

        Levex = await LevexDelegator.new(controller.address, dexAgg.address, [token0.address, token1.address], weth.address, xLVX.address, [1, 2], accounts[0], delegatee.address);
        Levex = await LevexV1.at(Levex.address);
        await Levex.setCalculateConfig(30, 33, 3000, 5, 25, 25, (30e18) + '', 300, 10, 60);
        await controller.setLevex(Levex.address);
        await controller.setLPoolImplementation((await utils.createLPoolImpl()).address);
        await controller.setInterestParam(toBN(90e16).div(toBN(2102400)), toBN(10e16).div(toBN(2102400)), toBN(20e16).div(toBN(2102400)), 50e16 + '');
        await dexAgg.setLevex(Levex.address);

        let createPoolTx = await controller.createLPoolPair(token0.address, token1.address, 3000, Uni2DexData); // 30% margin ratio by default
        m.log("Create Market Gas Used: ", createPoolTx.receipt.gasUsed);
    });

    it("current held is zero, transaction fail ", async () => {
        let pairId = 0;
        await utils.mint(token1, trader, 10000);
        let saverSupply = utils.toWei(1000);
        let pool1 = await LPool.at((await Levex.markets(0)).pool1);
        await token1.approve(pool1.address, utils.toWei(10000), {from: trader});
        await token1.approve(Levex.address, utils.toWei(10000), {from: trader});
        await pool1.mint(saverSupply, {from: trader});
        m.log("mint token1 to pool1, amount = ", saverSupply)
        await advanceMultipleBlocksAndTime(1000);
        await Levex.updatePrice(pairId, Uni2DexData);
        m.log("updatePrice ---");

        let deposit = utils.toWei(1);
        let borrow = utils.toWei(1);
        await Levex.marginTrade(pairId, false, true, deposit, borrow, 0, Uni2DexData, {from: trader});
        let tradeBefore = await Levex.activeTrades(trader, pairId, 0);
        m.log("finish marginTrade, current held = ", tradeBefore.held)
        assert.equal(tradeBefore.held.toString(), "1987978478630008709");

        await Levex.closeTrade(pairId, false, tradeBefore.held, 0, Uni2DexData, {from: trader});
        let tradeAfter = await Levex.activeTrades(trader, 0, 0);
        m.log("finish closeTrade, current held = ", tradeAfter.held)
        assert.equal(tradeAfter.held, 0);
        m.log("start payoffTrade, current held is zero ---")
        await assertThrows(Levex.payoffTrade(pairId, false, {from: trader}), 'HI0');
        m.log("payoffTrade fail --- HI0, test pass.")
    })

    it("not enough to repay current borrow, transaction fail ", async () => {
        let pairId = 0;
        await utils.mint(token1, trader, 1001);
        m.log("mint 1001 amount token1 to trader")
        let saverSupply = utils.toWei(1000);
        let pool1 = await LPool.at((await Levex.markets(0)).pool1);
        await token1.approve(pool1.address, utils.toWei(10000), {from: trader});
        await token1.approve(Levex.address, utils.toWei(10000), {from: trader});
        await pool1.mint(saverSupply, {from: trader});
        m.log("trader mint 1000 token1 to pool1")
        m.log("trader token1 balance = ", utils.toETH(await token1.balanceOf(trader)));
        await advanceMultipleBlocksAndTime(1000);
        await Levex.updatePrice(pairId, Uni2DexData);
        m.log("updatePrice ---");

        let deposit = utils.toWei(1);
        let borrow = utils.toWei(1);
        m.log("start marginTrade, deposit token1 amount = ", utils.toETH(deposit))
        await Levex.marginTrade(pairId, false, true, deposit, borrow, 0, Uni2DexData, {from: trader});
        m.log("finish marginTrade, trader current token1 balance is ---", utils.toETH(await token1.balanceOf(trader)))
        await assertThrows(Levex.payoffTrade(pairId, false, {from: trader}), 'TFF');
        m.log("payoffTrade fail --- TFF, test pass.")
    })

    it("after payoff trade finished, account current borrow and held is zero, receive held token ", async () => {
        let pairId = 0;
        await utils.mint(token1, trader, 10000);
        let saverSupply = utils.toWei(1000);
        let pool1 = await LPool.at((await Levex.markets(0)).pool1);
        await token1.approve(pool1.address, utils.toWei(10000), {from: trader});
        await token1.approve(Levex.address, utils.toWei(10000), {from: trader});
        await pool1.mint(saverSupply, {from: trader});
        await advanceMultipleBlocksAndTime(1000);
        await Levex.updatePrice(pairId, Uni2DexData);
        m.log("updatePrice ---");

        let deposit = utils.toWei(1);
        let borrow = utils.toWei(1);
        await Levex.marginTrade(pairId, false, true, deposit, borrow, 0, Uni2DexData, {from: trader});

        let tradeBefore = await Levex.activeTrades(trader, pairId, 0);
        let borrowedBefore = utils.toETH(await pool1.borrowBalanceCurrent(trader));
        let token0BalanceBefore = utils.toETH(await token0.balanceOf(trader));
        let token1BalanceBefore = utils.toETH(await token1.balanceOf(trader));
        m.log("before payoffTrade ---");
        m.log("current held =", tradeBefore.held);
        m.log("current borrowed =", borrowedBefore);
        m.log("current token0 balance = ", token0BalanceBefore);
        m.log("current token1 balance = ", token1BalanceBefore);
        assert.equal(tradeBefore.held.toString(), "1987978478630008709");
        assert.equal(borrowedBefore, 1);
        assert.equal(token0BalanceBefore, 0);
        assert.equal(token1BalanceBefore, 8999);

        let payoffTradeTx = await Levex.payoffTrade(pairId, false, {from: trader});

        let tradeAfter = await Levex.activeTrades(trader, 0, 0);
        let borrowedAfter = await pool1.borrowBalanceCurrent(trader);
        let token0BalanceAfter = await token0.balanceOf(trader);
        let token1BalanceAfter = await token1.balanceOf(trader);
        m.log("after payoffTrade ---");
        m.log("current held =", tradeAfter.held);
        m.log("current borrowed =", borrowedAfter);
        m.log("current token0 balance = ", token0BalanceAfter);
        m.log("current token1 balance = ", token1BalanceAfter);
        assert.equal(tradeAfter.held, 0);
        assert.equal(borrowedAfter, 0);
        assert.equal(token0BalanceAfter, 1987978478630008709);
        assert.equal(token1BalanceAfter, 8997999999571870243534);

        m.log("-- check event...");
        let depositToken = payoffTradeTx.logs[0].args.depositToken;
        let depositDecrease = payoffTradeTx.logs[0].args.depositDecrease;
        let closeAmount = payoffTradeTx.logs[0].args.closeAmount;
        assert.equal(depositToken, true);
        assert.equal(depositDecrease.toString(), "994000000000000000");
        assert.equal(closeAmount.toString(), "1987978478630008709");
    })

})