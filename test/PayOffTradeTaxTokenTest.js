const utils = require("./utils/LevexUtil");
const {Uni2DexData, assertThrows} = require("./utils/LevexUtil");
const {advanceMultipleBlocksAndTime, toBN, advanceMultipleBlocks} = require("./utils/EtheUtil");
const Controller = artifacts.require("ControllerV1");
const ControllerDelegator = artifacts.require("ControllerDelegator");
const LevexV1 = artifacts.require("LevexV1");
const LevexDelegator = artifacts.require("LevexDelegator");
const m = require('mocha-logger');
const {from} = require("truffle/build/987.bundled");
const LPool = artifacts.require("LPool");
const TestToken = artifacts.require("MockERC20");
const MockTaxToken = artifacts.require("MockTaxToken");
const UniswapV2Factory = artifacts.require("UniswapV2Factory");
const UniswapV2Router = artifacts.require("UniswapV2Router02");
const LevexV1Lib = artifacts.require("LevexV1Lib")

// list all cases for tax token since there is no smaller unit to divide.
contract("Levex payoff trade tax token", async accounts => {
    // components
    let Levex;
    let LVX;
    let treasury;
    let factory;
    let router;
    let gotPair;
    let dexAgg;
    let pool0;
    let poLVXth;

    // rLVXs
    let admin = accounts[0];
    let saver = accounts[1];
    let trader = accounts[2];

    let dev = accounts[3];
    let liquidator2 = accounts[8];
    let token0;
    let delegatee;
    let weth;

    let pairId = 0;

    beforeEach(async () => {
        weth = await utils.createWETH();
        LVX = await TestToken.new('LevexERC20', 'LVX');
        factory = await UniswapV2Factory.new("0x0000000000000000000000000000000000000000");
        router = await UniswapV2Router.new(factory.address, weth.address);
        token0 = await MockTaxToken.new('TokenA', 'TKA', 5, 2, router.address);

        await web3.eth.sendTransaction({from: accounts[9], to: admin, value: utils.toWei(1)});
        await token0.approve(router.address, utils.toWei(1));
        let block = await web3.eth.getBlock("latest");
        await router.addLiquidityETH(token0.address, utils.toWei(1), utils.toWei(1), utils.toWei(1), admin, block.timestamp + 60, {from: admin, value: utils.toWei(1)});

        dexAgg = await utils.createEthDexAgg(factory.address, "0x0000000000000000000000000000000000000000", accounts[0]);
        xLVX = await utils.createXLVX(LVX.address, admin, dev, dexAgg.address);

        let instance = await Controller.new();
        let controller = await ControllerDelegator.new(
            LVX.address,
            xLVX.address,
            weth.address,
            "0x0000000000000000000000000000000000000000",
            "0x0000000000000000000000000000000000000000",
            dexAgg.address,
            "0x01",
            admin,
            instance.address);
        controller = await Controller.at(controller.address);

        LevexV1Lib = await LevexV1Lib.new();
        await LevexV1.link("LevexV1Lib", LevexV1Lib.address);
        delegatee = await LevexV1.new();

        Levex = await LevexDelegator.new(controller.address, dexAgg.address, [token0.address, weth.address], weth.address, xLVX.address, [1, 2], accounts[0], delegatee.address);
        Levex = await LevexV1.at(Levex.address);
        await Levex.setCalculateConfig(30, 33, 3000, 5, 25, 25, (30e18) + '', 300, 10, 60);
        await controller.setLevex(Levex.address);
        await controller.setLPoolImplementation((await utils.createLPoolImpl()).address);
        await controller.setInterestParam(toBN(90e16).div(toBN(2102400)), toBN(10e16).div(toBN(2102400)), toBN(20e16).div(toBN(2102400)), 50e16 + '');
        await dexAgg.setLevex(Levex.address);
        let dexData = Uni2DexData + "011170000000011170000000011170000000";
        await controller.createLPoolPair(token0.address, weth.address, 3000, dexData); // 30% margin ratio by default

        market = await Levex.markets(0);
        let pool0Address = market.pool0;
        let poLVXthAddress = market.pool1;
        pool0 = await LPool.at(pool0Address);
        poLVXth = await LPool.at(poLVXthAddress);

        await token0.approve(pool0.address, utils.toWei(1));
        await pool0.mint(utils.toWei(1));
        await poLVXth.mintEth({from: saver, value: utils.toWei(1)});
        await token0.transfer(trader, utils.toWei(1));
        await token0.approve(Levex.address, utils.toWei(1), {from: trader});
        // set weth to trader
        await weth.mint(trader, utils.toWei(1));
        // set tax rate = 7%
        await Levex.setTaxRate(pairId, token0.address, 0, 70000);
        await advanceMultipleBlocksAndTime(30);
    });

    it("if repay token is a tax Token need pay tax deductions with twice ", async () => {
        let deposit = toBN(1e15);
        let borrow = toBN(1e15);
        m.log("-- marginTrade...");
        await Levex.marginTrade(pairId, true, false, deposit, borrow, 0, Uni2DexData, {from: trader});
        let tradeBefore = await Levex.activeTrades(trader, pairId, 1);
        let borrowedBefore = await pool0.borrowBalanceCurrent(trader);
        let token0BalanceBefore = await token0.balanceOf(trader);
        m.log("current held =", tradeBefore.held);
        m.log("current borrowed =", borrowedBefore);
        m.log("current tax token balance = ", token0BalanceBefore);
        assert.equal(tradeBefore.held.toString(), "1717213647663711");
        assert.equal(borrowedBefore, 1000000000000000);
        assert.equal(token0BalanceBefore, 999001927118839757);

        m.log("-- payoffTrade...");
        let payoffTradeTx = await Levex.payoffTrade(pairId, true, {from: trader});
        let tradeAfter = await Levex.activeTrades(trader, pairId, 1);
        let borrowedAfter = await pool0.borrowBalanceCurrent(trader);
        let token0BalanceAfter = await token0.balanceOf(trader);
        m.log("current held =", tradeAfter.held);
        m.log("current borrowed =", borrowedAfter);
        m.log("current tax token balance = ", token0BalanceAfter);
        assert.equal(tradeAfter.held, 0);
        assert.equal(borrowedAfter.toString(), '0');
        assert.equal(token0BalanceAfter.toString(), "997846836928621941");

        m.log("-- check event...");
        let depositToken = payoffTradeTx.logs[0].args.depositToken;
        let depositDecrease = payoffTradeTx.logs[0].args.depositDecrease;
        let closeAmount = payoffTradeTx.logs[0].args.closeAmount;
        assert.equal(depositToken, false);
        assert.equal(depositDecrease.toString(), "924210463605232");
        assert.equal(closeAmount.toString(), "1717213647663711");
    })

    it("if transfer in with tax token amount can't pay it all off, will fail", async () => {
        let deposit = toBN(1e15);
        let borrow = toBN(1e15);
        m.log("-- marginTrade...");
        await Levex.marginTrade(pairId, true, false, deposit, borrow, 0, Uni2DexData, {from: trader});
        let tradeBefore = await Levex.activeTrades(trader, pairId, 1);
        let borrowedBefore = await pool0.borrowBalanceCurrent(trader);
        let token0BalanceBefore = await token0.balanceOf(trader);
        m.log("current held =", tradeBefore.held);
        m.log("current borrowed =", borrowedBefore);
        m.log("current tax token balance = ", token0BalanceBefore);
        assert.equal(tradeBefore.held.toString(), "1717213647663711");
        assert.equal(borrowedBefore, 1000000000000000);
        assert.equal(token0BalanceBefore, 999001927118839757);

        let transferOutAmount = toBN(997900000000000000);
        m.log("transfer out tak token，amount = ", transferOutAmount);
        await token0.transfer(saver, transferOutAmount, {from: trader});
        let token0AfterTransferOutBalance = await token0.balanceOf(trader);
        m.log("current tax token balance =", token0AfterTransferOutBalance)
        assert.equal(token0AfterTransferOutBalance, 1102477199838617);

        m.log("-- payoffTrade...");
        await assertThrows(Levex.payoffTrade(pairId, true, {from: trader}), 'TFF');
        m.log("payoffTrade fail --- TFF, test pass.")
    })

    it("if repay token is eth, repay weth will fail", async () => {
        let deposit = toBN(1e16);
        let borrow = toBN(1e16);

        m.log("-- marginTrade...");
        await Levex.marginTrade(pairId, false, true, deposit, borrow, 0, Uni2DexData, {from: trader, value: deposit});
        let tradeBefore = await Levex.activeTrades(trader, pairId, 0);
        let borrowedBefore = await poLVXth.borrowBalanceCurrent(trader);
        let token0BalanceBefore = await token0.balanceOf(trader);
        let wethBalance = await weth.balanceOf(trader);

        m.log("current held =", tradeBefore.held);
        m.log("current borrowed =", borrowedBefore);
        m.log("current token0 balance = ", token0BalanceBefore);
        m.log("current weth balance =", wethBalance);
        assert.equal(tradeBefore.held.toString(), "18128352683015392");
        assert.equal(borrowedBefore, 10000000000000000);
        assert.equal(token0BalanceBefore, 1000009746426173664);

        await assertThrows(Levex.payoffTrade(pairId, false, {from: trader}), 'IRP');
    })

    it("if repay token is eth, repay current borrow Amount will fail", async () => {
        let deposit = toBN(1e16);
        let borrow = toBN(1e16);

        m.log("-- marginTrade...");
        await Levex.marginTrade(pairId, false, true, deposit, borrow, 0, Uni2DexData, {from: trader, value: deposit});
        let tradeBefore = await Levex.activeTrades(trader, pairId, 0);
        let borrowed = await poLVXth.borrowBalanceCurrent(trader);
        let token0Balance = await token0.balanceOf(trader);
        let ethBalance = await web3.eth.getBalance(trader);

        m.log("current held =", tradeBefore.held);
        m.log("current borrowed =", borrowed);
        m.log("current token0 balance = ", token0Balance);
        m.log("current eth balance =", ethBalance);
        assert.equal(tradeBefore.held.toString(), "18128352683015392");
        assert.equal(borrowed, 10000000000000000);
        assert.equal(token0Balance, 1000009746426173664);

        await advanceMultipleBlocks(1);
        m.log("advance 1 blocks");
        await assertThrows(Levex.payoffTrade(pairId, false, {from: trader, value: borrowed}), 'IRP');
    })

    it("if repay token is eth, need to repay 1/100000 more of the borrow amount, and received tax token is less than held", async () => {
        let deposit = toBN(1e16);
        let borrow = toBN(1e16);
        let token0Balance = await token0.balanceOf(trader);
        m.log("current token0 balance = ", token0Balance);

        m.log("-- marginTrade...");
        await Levex.marginTrade(pairId, false, true, deposit, borrow, 0, Uni2DexData, {from: trader, value: deposit});
        let tradeBefore = await Levex.activeTrades(trader, pairId, 0);
        let borrowedBefore = await poLVXth.borrowBalanceCurrent(trader);
        let token0BalanceBefore = await token0.balanceOf(trader);
        let wethBalanceBefore = await weth.balanceOf(trader);
        let ethBalanceBefore = await web3.eth.getBalance(trader);

        m.log("current held =", tradeBefore.held);
        m.log("current borrowed =", borrowedBefore);
        m.log("current token0 balance = ", token0BalanceBefore);
        m.log("current weth balance = ", wethBalanceBefore);
        m.log("trader eth balance = ", ethBalanceBefore);
        assert.equal(tradeBefore.held.toString(), "18128352683015392");
        assert.equal(borrowedBefore, 10000000000000000);
        assert.equal(token0BalanceBefore, 1000009746426173664);

        m.log("-- payoffTrade...");
        let borrowReturn = toBN(borrowedBefore * (1 + 1e-5))
        m.log("transfer eth amount = ", borrowReturn);
        let gas_price = 10000000000;
        let payoffTradeTx = await Levex.payoffTrade(pairId, false, {from: trader, value: borrowReturn, gasPrice: gas_price});
        let tradeAfter = await Levex.activeTrades(trader, pairId, 0);
        let borrowedAfter = await poLVXth.borrowBalanceCurrent(trader);
        let token0BalanceAfter = await token0.balanceOf(trader);
        let wethBalanceAfter = await weth.balanceOf(trader);
        let ethBalanceAfter = await web3.eth.getBalance(trader);

        m.log("current held =", tradeAfter.held);
        m.log("current borrowed =", borrowedAfter);
        m.log("current token0 balance = ", token0BalanceAfter);
        m.log("current weth balance = ", wethBalanceAfter);
        m.log("trader eth balance = ", ethBalanceAfter);
        assert.equal(tradeAfter.held, 0);
        assert.equal(borrowedAfter.toString(), '0');
        assert.equal(token0BalanceAfter.toString(), "1016878331585893332");
        assert.equal(wethBalanceAfter.toString(), wethBalanceBefore.toString());
        m.log("weth amount of before payoffTrade equals to after payoffTrade. ")
        let gasUsed = payoffTradeTx.receipt.gasUsed;
        m.log("payoffTrade gas used = ", gasUsed * gas_price);
        assert.equal((toBN(ethBalanceBefore).sub(toBN(ethBalanceAfter))).toString(), ((toBN(gasUsed).mul(toBN(gas_price))).add(toBN(borrowReturn))).toString());
        m.log("eth balance of after payoffTrade = balance of before payoffTrade + gas used + repay amount")

        m.log("-- check event...");
        let depositToken = payoffTradeTx.logs[0].args.depositToken;
        let depositDecrease = payoffTradeTx.logs[0].args.depositDecrease;
        let closeAmount = payoffTradeTx.logs[0].args.closeAmount;
        assert.equal(depositToken, true);
        assert.equal(depositDecrease.toString(), "9940000000000000");
        assert.equal(closeAmount.toString(), "18128352683015392");
    })

})