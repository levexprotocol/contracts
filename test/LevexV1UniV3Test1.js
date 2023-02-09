const utils = require("./utils/LevexUtil");
const {
    toWei,
    last8,
    checkAmount,
    printBlockNum,
    Uni3DexData,
    assertPrint, assertThrows, Uni2DexData,
} = require("./utils/LevexUtil");
const {advanceMultipleBlocks, toBN} = require("./utils/EtheUtil");
const LevexV1Lib = artifacts.require("LevexV1Lib")
const LevexV1 = artifacts.require("LevexV1");
const LevexDelegator = artifacts.require("LevexDelegator");

const m = require('mocha-logger');
const LPool = artifacts.require("LPool");
const TestToken = artifacts.require("MockERC20");

contract("Levex UniV3", async accounts => {

    // components
    let LevexV1Lib;
    let Levex;
    let LVX;
    let xLVX;
    let uniswapFactory;
    let gotPair;

    // rLVXs
    let admin = accounts[0];
    let saver = accounts[1];
    let trader = accounts[2];
    let trader2 = accounts[4];

    let dev = accounts[3];
    let liquidator2 = accounts[9];
    let token0;
    let token1;
    beforeEach(async () => {

        // runs once before the first test in this block
        let controller = await utils.createController(admin);
        m.log("Created Controller", last8(controller.address));

        LVX = await TestToken.new('LevexERC20', 'LVX');

        token0 = await TestToken.new('TokenA', 'TKA');
        token1 = await TestToken.new('TokenB', 'TKB');

        uniswapFactory = await utils.createUniswapV3Factory();
        gotPair = await utils.createUniswapV3Pool(uniswapFactory, token0, token1, accounts[0]);

        token0 = await TestToken.at(await gotPair.token0());
        token1 = await TestToken.at(await gotPair.token1());
        dexAgg = await utils.createEthDexAgg("0x0000000000000000000000000000000000000000", uniswapFactory.address, accounts[0]);

        xLVX = await utils.createXLVX(LVX.address, admin, dev, dexAgg.address);

        LevexV1Lib = await LevexV1Lib.new();
        await LevexV1.link("LevexV1Lib", LevexV1Lib.address);
        let delegatee = await LevexV1.new();
        Levex = await LevexDelegator.new(controller.address, dexAgg.address, [token0.address, token1.address], "0x0000000000000000000000000000000000000000", xLVX.address, [1, 2], accounts[0], delegatee.address);
        Levex = await LevexV1.at(Levex.address);
        await Levex.setCalculateConfig(30, 33, 3000, 5, 25, 25, (30e18) + '', 300, 10, 60);
        await controller.setLevex(Levex.address);
        await controller.setLPoolImplementation((await utils.createLPoolImpl()).address);
        await controller.setInterestParam(toBN(90e16).div(toBN(2102400)), toBN(10e16).div(toBN(2102400)), toBN(20e16).div(toBN(2102400)), 50e16 + '');
        await dexAgg.setLevex(Levex.address);

        let createPoolTx = await controller.createLPoolPair(token0.address, token1.address, 3000, Uni3DexData); // 30% margin ratio by default
        // m.log("Create PoolPair Gas Used: ", createPoolTx.receipt.gasUsed);

        assert.equal(3000, (await Levex.markets(0)).marginLimit);

        assert.equal(await Levex.numPairs(), 1, "Should have one active pair");
        m.log("Reset Levex instance: ", last8(Levex.address));
    });
    it("Open in unsupport dex", async () => {
        let pairId = 0;
        await printBlockNum();
        // provide some funds for trader and saver
        await utils.mint(token0, trader, 10000);
        await utils.mint(token0, saver, 10000);
        // Trader to approve Levex to spend
        let deposit = utils.toWei(400);
        await token0.approve(Levex.address, deposit, {from: trader});
        // Saver deposit to pool1
        let saverSupply = utils.toWei(1000);
        let pool0 = await LPool.at((await Levex.markets(pairId)).pool0);
        await token0.approve(await pool0.address, utils.toWei(1000), {from: saver});
        await pool0.mint(saverSupply, {from: saver});
        let borrow = utils.toWei(500);
        //"0x02000bb8"=>"0x02001710"
        await assertThrows(Levex.marginTrade(0, true, false, deposit,
            borrow, 0, "0x02001710", {from: trader}), 'DNS');
    });

    it("LONG Token0,  Add deposit, Close", async () => {
        let pairId = 0;
        await printBlockNum();

        // provide some funds for trader and saver
        await utils.mint(token1, trader, 10000);
        checkAmount(await token1.symbol() + " Trader " + last8(saver) + " Balance", 10000000000000000000000, await token1.balanceOf(trader), 18);

        await utils.mint(token1, saver, 10000);
        checkAmount(await token1.symbol() + " Saver " + last8(saver) + " Balance", 10000000000000000000000, await token1.balanceOf(saver), 18);

        // Trader to approve Levex to spend
        let deposit = utils.toWei(400);
        await token1.approve(Levex.address, deposit, {from: trader});

        // Saver deposit to pool1
        let saverSupply = utils.toWei(1000);
        let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
        await token1.approve(await pool1.address, utils.toWei(1000), {from: saver});
        await pool1.mint(saverSupply, {from: saver});


        let borrow = utils.toWei(500);
        m.log("toBorrow from Pool 1: \t", borrow);

        let tx = await Levex.marginTrade(0, false, true, deposit, borrow, 0, Uni3DexData, {from: trader});

        // Check events
        let fees = tx.logs[0].args.fees;
        m.log("Fees", fees);
        assert.equal(fees, 2700000000000000000);

        // Check active trades
        let numPairs = await Levex.numPairs();

        let numTrades = 0;
        for (let i = 0; i < numPairs; i++) {
            let trade = await Levex.activeTrades(trader, i, 0);
            m.log("Margin Trade executed", i, ": ", JSON.stringify(trade, 0, 2));
            assert.equal(trade.deposited, 397300000000000000000); // TODO check after fees amount accuracy
            assert.equal(trade.held, 886675826237735300000, "");
            numTrades++;
        }

        assert.equal(numTrades, 1, "Should have one trade only");

        // Check balances
        checkAmount("Trader Balance", 9600000000000000000000, await token1.balanceOf(trader), 18);
        checkAmount("xLVX Balance", 1809000000000000000, await token1.balanceOf(xLVX.address), 18);
        checkAmount("Levex Balance", 886675826237735294796, await token0.balanceOf(Levex.address), 18);


        let moreDeposit = utils.toWei(200);
        await token1.approve(Levex.address, moreDeposit, {from: trader});
        tx = await Levex.marginTrade(0, false, true, moreDeposit, 0, 0, Uni3DexData, {from: trader});

        let marginRatio_3 = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
        trade = await Levex.activeTrades(trader, 0, 0);
        m.log("Trade.held:", trade.held);
        m.log("Trade.deposited:", trade.deposited);

        m.log("Margin Ratio after deposit:", marginRatio_3.current, marginRatio_3.limit);
        assert.equal(marginRatio_3.current.toString(), 12107); // TODO check

        // Close trade
        await Levex.closeTrade(0, 0, "821147572990716389330", 0, Uni3DexData, {from: trader});

        // Check contract held balance
        checkAmount("Levex Balance", 1089000000000000000, await token1.balanceOf(Levex.address), 18);
        checkAmount("Trader Balance", 9847743451118695853707, await token1.balanceOf(trader), 18);
        checkAmount("xLVX Balance", 2211000000000000000, await token1.balanceOf(xLVX.address), 18);
        checkAmount("xLVX Balance", 1650506621711339942, await token0.balanceOf(xLVX.address), 18);
        await printBlockNum();
    })

    it("LONG Token0,DepositToken 1 Liquidate", async () => {
        let pairId = 0;

        // provide some funds for trader and saver
        await utils.mint(token1, trader, 10000);
        m.log("Trader", last8(trader), "minted", await token1.symbol(), await token1.balanceOf(trader));

        await utils.mint(token1, saver, 10000);
        m.log("Saver", last8(saver), "minted", await token1.symbol(), await token1.balanceOf(saver));

        // Trader to approve Levex to spend
        let deposit = utils.toWei(400);
        await token1.approve(Levex.address, deposit, {from: trader});

        // Saver deposit to pool1
        let saverSupply = utils.toWei(2000);
        let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
        await token1.approve(await pool1.address, utils.toWei(2000), {from: saver});
        await pool1.mint(saverSupply, {from: saver});


        let borrow = utils.toWei(1000);
        m.log("toBorrow from Pool 1: \t", borrow);

        await Levex.marginTrade(0, false, true, deposit, borrow, 0, Uni3DexData, {from: trader});

        // Check xLVX
        assert.equal('2814000000000000000', (await token1.balanceOf(xLVX.address)).toString());

        // Market price change, then check margin ratio
        await gotPair.setPrice(token0.address, token1.address, "800000000000000000");
        await gotPair.setPreviousPrice(token0.address, token1.address, "800000000000000000");
        let marginRatio_1 = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
        m.log("Margin Ratio:", marginRatio_1.current / 100, "%");
        // assert.equal(marginRatio_1.current.toString(), 0);
        let priceData = await dexAgg.getPriceCAvgPriceHAvgPrice(token0.address, token1.address, 28, Uni3DexData);
        m.log("priceData:", JSON.stringify(priceData));

        m.log("Liquidating trade ... ");
        await Levex.liquidate(trader, 0, 0, 0, utils.maxUint(), Uni3DexData, {from: liquidator2});

        assertPrint("Insurance of Pool0:", '1358787417096470955', (await Levex.markets(pairId)).pool0Insurance);
        assertPrint("Insurance of Pool1:", '1386000000000000000', (await Levex.markets(pairId)).pool1Insurance);
        checkAmount("Borrows is zero", 0, await pool1.borrowBalanceCurrent(trader), 18);
        checkAmount("Levex Balance", 1358787417096470955, await token0.balanceOf(Levex.address), 18);
        checkAmount("Levex Balance", 1386000000000000000, await token1.balanceOf(Levex.address), 18);
        checkAmount("xLVX Balance", 2814000000000000000, await token1.balanceOf(xLVX.address), 18);
        checkAmount("xLVX Balance", 2758750210468592548, await token0.balanceOf(xLVX.address), 18);
    })

    it("LONG Token0, Deposit Token0, Liquidate", async () => {
        let pairId = 0;

        // provide some funds for trader and saver
        await utils.mint(token0, trader, 400);
        m.log("Trader", last8(trader), "minted", await token0.symbol(), await token0.balanceOf(trader));

        await utils.mint(token1, saver, 10000);
        m.log("Saver", last8(saver), "minted", await token1.symbol(), await token1.balanceOf(saver));

        // Trader to approve Levex to spend
        let deposit = utils.toWei(400);
        await token0.approve(Levex.address, deposit, {from: trader});

        // Saver deposit to pool1
        let saverSupply = utils.toWei(2000);
        let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
        await token1.approve(await pool1.address, utils.toWei(2000), {from: saver});
        await pool1.mint(saverSupply, {from: saver});

        let borrow = utils.toWei(1000);
        m.log("toBorrow from Pool 1: \t", borrow);
        await Levex.marginTrade(0, false, false, deposit, borrow, 0, Uni3DexData, {from: trader});

        await advanceMultipleBlocks(1000);
        await gotPair.setPrice(token0.address, token1.address, "800000000000000000");
        await gotPair.setPreviousPrice(token0.address, token1.address, "800000000000000000");
        let slot0 = await gotPair.slot0();
        m.log("uniV3Price: ", slot0.sqrtPriceX96.toString());
        m.log("uniV3Tick: ", slot0.tick.toString());

        marginRatio_2 = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
        m.log("Margin Ratio:", marginRatio_2.current / 100, "%");

        let trade = await Levex.activeTrades(trader, 0, 0);
        m.log("Trade.held:", trade.held);
        m.log("Trade.deposited:", trade.deposited);

        m.log("Liquidating trade ... ");
        let tx_liquidate = await Levex.liquidate(trader, 0, 0, 0, utils.maxUint(), Uni3DexData, {from: liquidator2});

        assertPrint("Deposit Decrease", '395800000000000000000', tx_liquidate.logs[0].args.depositDecrease);
        assertPrint("Deposit Return", '68802010819687692046', tx_liquidate.logs[0].args.depositReturn);
        assertPrint("Liquidate Rewards ", '41488741031911838965', tx_liquidate.logs[0].args.penalty);

        assertPrint("Insurance of Pool0:", '2755128454053090685', (await Levex.markets(pairId)).pool0Insurance);
        assertPrint("Insurance of Pool1:", '0', (await Levex.markets(pairId)).pool1Insurance);
        checkAmount("Levex Balance", '2755128454053090685', await token0.balanceOf(Levex.address), 18);
        checkAmount("Levex Balance", 0, await token1.balanceOf(Levex.address), 18);
        checkAmount("xLVX Balance", 0, await token1.balanceOf(xLVX.address), 18);
        checkAmount("xLVX Balance", '5593745649138093211', await token0.balanceOf(xLVX.address), 18);
        checkAmount("Borrows is zero", 0, await pool1.borrowBalanceCurrent(trader), 18);
        checkAmount("Trader Despoit Token Balance will be back", '68802010819687692046', await token0.balanceOf(trader), 18);
        checkAmount("Trader Borrows Token Balance is Zero", 0, await token1.balanceOf(trader), 18);
    })

    it("LONG Token0, Deposit Token0, Liquidate, Reduce insurance ", async () => {
        let pairId = 0;

        // provide some funds for trader and saver
        await utils.mint(token0, trader, 400);
        await utils.mint(token1, trader2, 1000000);

        m.log("Trader", last8(trader), "minted", await token0.symbol(), await token0.balanceOf(trader));

        await utils.mint(token1, saver, 10000);
        await utils.mint(token0, saver, 10000);
        m.log("Saver", last8(saver), "minted", await token1.symbol(), await token1.balanceOf(saver));

        // Trader to approve Levex to spend
        let deposit = utils.toWei(400);
        let deposit2 = utils.toWei(1000000);
        await token0.approve(Levex.address, deposit, {from: trader});
        await token1.approve(Levex.address, deposit2, {from: trader2});

        // Saver deposit to pool1
        let saverSupply = utils.toWei(4000);
        let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
        await token1.approve(await pool1.address, saverSupply, {from: saver});
        await pool1.mint(saverSupply, {from: saver});

        let borrow = utils.toWei(1000);
        m.log("toBorrow from Pool 1: \t", borrow);
        await Levex.marginTrade(0, false, false, deposit, borrow, 0, Uni3DexData, {from: trader});
        await Levex.marginTrade(0, false, true, deposit2, borrow, 0, Uni3DexData, {from: trader2});

        await advanceMultipleBlocks(1000);
        await gotPair.setPrice(token0.address, token1.address, "400000000000000000");
        await gotPair.setPreviousPrice(token0.address, token1.address, "400000000000000000");
        let slot0 = await gotPair.slot0();
        m.log("uniV3Price: ", slot0.sqrtPriceX96.toString());
        m.log("uniV3Tick: ", slot0.tick.toString());

        marginRatio_2 = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
        m.log("Margin Ratio:", marginRatio_2.current / 100, "%");

        let trade = await Levex.activeTrades(trader, 0, 0);
        m.log("Trade.held:", trade.held);
        m.log("Trade.deposited:", trade.deposited);

        m.log("Liquidating trade ... ");
        let tx_liquidate = await Levex.liquidate(trader, 0, 0, 0, utils.maxUint(), Uni3DexData, {from: liquidator2});

        assertPrint("Deposit Decrease", '395800000000000000000', tx_liquidate.logs[0].args.depositDecrease);
        assertPrint("Deposit Return", '0', tx_liquidate.logs[0].args.depositReturn);

        assertPrint("Insurance of Pool0:", '2755128454053090685', (await Levex.markets(pairId)).pool0Insurance);
        assertPrint("Insurance of Pool1:", '519400035826617452742', (await Levex.markets(pairId)).pool1Insurance);
        assertPrint("TotalHeld of Token0:", '89891509577740192199543', (await Levex.totalHelds(token0.address)));
        assertPrint("TotalHeld of Token1:", '519400035826617452742', (await Levex.totalHelds(token1.address)));
        assertPrint("Balance of Token0:", '89891509577740192199543', (await token0.balanceOf(Levex.address)));
        assertPrint("Balance of Token1:", '519400035826617452742', (await token1.balanceOf(Levex.address)));
    })

    it("LONG Token0, Deposit Token0, Liquidate, Blow up", async () => {
        let pairId = 0;

        m.log("Levex.token0() = ", last8(token0.address));
        m.log("Levex.token1() = ", last8(token1.address));

        // provide some funds for trader and saver
        await utils.mint(token0, trader, 10000);
        await utils.mint(token0, saver, 10000);

        m.log("Trader", last8(trader), "minted", await token0.symbol(), await token0.balanceOf(trader));

        await utils.mint(token1, saver, 10000);
        await utils.mint(token1, trader, 10000);

        m.log("Saver", last8(saver), "minted", await token1.symbol(), await token1.balanceOf(saver));

        // Trader to approve Levex to spend
        let deposit = utils.toWei(1000);
        await token0.approve(Levex.address, deposit, {from: trader});
        await token1.approve(Levex.address, deposit, {from: trader});

        // Saver deposit to pool1
        let saverSupply = utils.toWei(3000);
        let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
        await token1.approve(await pool1.address, utils.toWei(3000), {from: saver});
        await pool1.mint(saverSupply, {from: saver});

        let pool0 = await LPool.at((await Levex.markets(pairId)).pool0);
        await token0.approve(pool0.address, saverSupply, {from: saver});
        await pool0.mint(saverSupply, {from: saver});

        let borrow = utils.toWei(2000);
        m.log("toBorrow from Pool 1: \t", borrow);

        await Levex.marginTrade(0, false, false, deposit, borrow, 0, Uni3DexData, {from: trader});

        await utils.mint(token0, saver, 1000000);
        await token0.approve(dexAgg.address, utils.toWei(108000), {from: saver});
        await dexAgg.sell(token1.address, token0.address, utils.toWei(108000), 0, Uni3DexData, {from: saver});
        await gotPair.setPreviousPrice(token0.address, token1.address, utils.toWei(10));
        m.log("Liquidating trade ... ");
        await assertThrows(Levex.liquidate(trader, 0, 0, 0, utils.maxUint(), Uni3DexData, {from: liquidator2}), 'MPT');
        await gotPair.setPreviousPrice(token0.address, token1.address, utils.toWei(1));
        let priceData = await dexAgg.getPriceCAvgPriceHAvgPrice(token0.address, token1.address, 25, Uni3DexData);
        m.log("priceData: \t", JSON.stringify(priceData));
        assertPrint("Insurance of Pool1:", '0', (await Levex.markets(pairId)).pool1Insurance);

        await gotPair.setPrice(token0.address, token1.address, "600000000000000000");
        await gotPair.setPreviousPrice(token0.address, token1.address, "600000000000000000");

        let tx_liquidate = await Levex.liquidate(trader, 0, 0, 0, utils.maxUint(), Uni3DexData, {from: liquidator2});
        m.log("V3 Liquidation Gas Used: ", tx_liquidate.receipt.gasUsed);

        assertPrint("Deposit Return", '0', tx_liquidate.logs[0].args.depositReturn);

        assertPrint("Outstanding Amount", '332542298956732350919', tx_liquidate.logs[0].args.outstandingAmount);

        assertPrint("Insurance of Pool1:", '0', (await Levex.markets(pairId)).pool1Insurance);
        checkAmount("Borrows is zero", 0, await pool1.borrowBalanceCurrent(trader), 18);
        checkAmount("Trader Despoit Token Balance will not back", 9000000000000000000000, await token0.balanceOf(trader), 18);
        checkAmount("Trader Borrows Token Balance is Zero", 10000000000000000000000, await token1.balanceOf(trader), 18);
    })


    it("Long Token1, Close", async () => {
        let pairId = 0;
        await printBlockNum();

        // provide some funds for trader and saver
        await utils.mint(token0, trader, 10000);
        checkAmount(await token0.symbol() + " Trader " + last8(saver) + " Balance", 10000000000000000000000, await token0.balanceOf(trader), 18);

        await utils.mint(token0, saver, 10000);
        checkAmount(await token0.symbol() + " Saver " + last8(saver) + " Balance", 10000000000000000000000, await token0.balanceOf(saver), 18);

        // Trader to approve Levex to spend
        let deposit = utils.toWei(400);
        await token0.approve(Levex.address, deposit, {from: trader});

        // Saver deposit to pool1
        let saverSupply = utils.toWei(1000);
        let pool0 = await LPool.at((await Levex.markets(pairId)).pool0);
        await token0.approve(await pool0.address, utils.toWei(1000), {from: saver});
        await pool0.mint(saverSupply, {from: saver});

        let borrow = utils.toWei(500);
        m.log("toBorrow from Pool 1: \t", borrow);

        let marginTradeTx = await Levex.marginTrade(0, true, false, deposit, borrow, 0, Uni3DexData, {from: trader});
        m.log("V3 Margin Trade Gas Used: ", marginTradeTx.receipt.gasUsed);
        // Check events
        let fees = marginTradeTx.logs[0].args.fees;
        m.log("Fees", fees);
        assert.equal(fees, 2700000000000000000);

        // Check balances
        checkAmount("Trader Balance", 9600000000000000000000, await token0.balanceOf(trader), 18);
        checkAmount("xLVX Balance", 1809000000000000000, await token0.balanceOf(xLVX.address), 18);
        checkAmount("Levex Balance", 886675826237735294796, await token1.balanceOf(Levex.address), 18);

        // Market price change, then check margin ratio
        let marginRatio_1 = await Levex.marginRatio(trader, 0, 1, Uni3DexData, {from: saver});
        m.log("Margin Ratio:", marginRatio_1.current / 100, "%");
        assert.equal(marginRatio_1.current.toString(), 8052);

        // Close trade
        let closeTradeTx = await Levex.closeTrade(0, 1, "821147572990716389330", 0, Uni3DexData, {from: trader});
        m.log("V3 Close Trade Gas Used: ", closeTradeTx.receipt.gasUsed);

        // Check contract held balance
        checkAmount("Levex Balance", 891000000000000000, await token0.balanceOf(Levex.address), 18);
        checkAmount("Trader Balance", 9961062119353101932094, await token0.balanceOf(trader), 18);
        checkAmount("xLVX Balance", 1809000000000000000, await token0.balanceOf(xLVX.address), 18);
        checkAmount("xLVX Balance", 1650506621711339942, await token1.balanceOf(xLVX.address), 18);
        await printBlockNum();
    })


    /*** Admin Test ***/

    it("Admin setCalculateConfig test", async () => {
        let {timeLock, Levex} = await instanceSimpleLevex();
        await timeLock.executeTransaction(Levex.address, 0, 'setCalculateConfig(uint16,uint8,uint16,uint16,uint16,uint16,uint128,uint16,uint8,uint16)',
            web3.eth.abi.encodeParameters(['uint16', 'uint8', 'uint16', 'uint16', 'uint16', 'uint16', 'uint128', 'uint16', 'uint8', 'uint16'], [1, 2, 3, 4, 7, 5, 6, 8, 9, 10]), 0);
        let calculateConfig = await Levex.calculateConfig();
        assert.equal(1, calculateConfig.defaultFeesRate);
        assert.equal(2, calculateConfig.insuranceRatio);
        assert.equal(3, calculateConfig.defaultMarginLimit);
        assert.equal(4, calculateConfig.priceDiffientRatio);
        assert.equal(7, calculateConfig.updatePriceDiscount);
        assert.equal(5, calculateConfig.feesDiscount);
        assert.equal(6, calculateConfig.feesDiscountThreshold);
        assert.equal(8, calculateConfig.penaltyRatio);
        assert.equal(9, calculateConfig.maxLiquidationPriceDiffientRatio);
        assert.equal(10, calculateConfig.twapDuration);
        await assertThrows(Levex.setCalculateConfig(1, 2, 3, 4, 7, 5, 6, 8, 9, 10), 'caller must be admin');
    })

    it("Admin setAddressConfig test", async () => {
        let {timeLock, Levex} = await instanceSimpleLevex();
        await timeLock.executeTransaction(Levex.address, 0, 'setAddressConfig(address,address)',
            web3.eth.abi.encodeParameters(['address', 'address'], [accounts[0], accounts[1]]), 0);
        let addressConfig = await Levex.addressConfig();
        assert.equal(accounts[0], addressConfig.controller);
        assert.equal(accounts[1], addressConfig.dexAggregator);
        await assertThrows(Levex.setAddressConfig(accounts[0], accounts[1]), 'caller must be admin');
    })

    it("Admin setMarketConfig test", async () => {
        let {timeLock, Levex} = await instanceSimpleLevex();
        await timeLock.executeTransaction(Levex.address, 0, 'setMarketConfig(uint16,uint16,uint16,uint16,uint32[])',
            web3.eth.abi.encodeParameters(['uint16', 'uint16', 'uint16', 'uint16', 'uint32[]'], [1, 2, 3, 4, [1]]), 0);
        let market = await Levex.markets(1);
        assert.equal(2, market.feesRate);
        assert.equal(3, market.marginLimit);
        assert.equal(4, market.priceDiffientRatio);
        // let dexes = await Levex.getMarketSupportDexs(1);
        // assert.equal(1, dexes[0]);
        await assertThrows(Levex.setMarketConfig(1, 2, 3, 4, [1]), 'caller must be admin');

    })


    it("Admin setSupportDexs test", async () => {
        let {timeLock, Levex} = await instanceSimpleLevex();
        await timeLock.executeTransaction(Levex.address, 0, 'setSupportDex(uint8,bool)',
            web3.eth.abi.encodeParameters(['uint8', 'bool'], [1, true]), 0);
        assert.equal(true, await Levex.supportDexs(1));
        await assertThrows(Levex.setSupportDex(1, true), 'caller must be admin');
    })

    it("Admin moveInsurance test", async () => {
        let pairId = 0;
        await printBlockNum();
        await utils.mint(token1, trader, 10000);
        checkAmount(await token1.symbol() + " Trader " + last8(saver) + " Balance", 10000000000000000000000, await token1.balanceOf(trader), 18);
        await utils.mint(token1, saver, 10000);
        checkAmount(await token1.symbol() + " Saver " + last8(saver) + " Balance", 10000000000000000000000, await token1.balanceOf(saver), 18);
        let deposit = utils.toWei(400);
        await token1.approve(Levex.address, deposit, {from: trader});
        let saverSupply = utils.toWei(1000);
        let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
        await token1.approve(await pool1.address, utils.toWei(1000), {from: saver});
        await pool1.mint(saverSupply, {from: saver});
        let borrow = utils.toWei(500);
        await Levex.marginTrade(0, false, true, deposit, borrow, 0, Uni3DexData, {from: trader});

        let timeLock = await utils.createTimelock(admin);
        await Levex.setPendingAdmin(timeLock.address);
        await timeLock.executeTransaction(Levex.address, 0, 'acceptAdmin()',
            web3.eth.abi.encodeParameters([], []), 0)

        let pool1Insurance = (await Levex.markets(pairId)).pool1Insurance;
        let totalHeld = await Levex.totalHelds(token0.address);
        assert.equal(pool1Insurance.toString(), (await Levex.totalHelds(token1.address)).toString());

        m.log("pool1Insurance", pool1Insurance);
        await timeLock.executeTransaction(Levex.address, 0, 'moveInsurance(uint16,uint8,address,uint256)',
            web3.eth.abi.encodeParameters(['uint16', 'uint8', 'address', 'uint256'], [pairId, 1, accounts[5], pool1Insurance]), 0)
        assert.equal("0", (await Levex.totalHelds(token1.address)));
        assert.equal("0", (await Levex.markets(pairId)).pool1Insurance);
        assert.equal(pool1Insurance, (await token1.balanceOf(accounts[5])).toString());
        //close
        await Levex.closeTrade(0, 0, toBN(totalHeld).div(toBN(2)), 0, Uni3DexData, {from: trader});
        let pool0Insurance = (await Levex.markets(pairId)).pool0Insurance;
        m.log("pool0Insurance", pool0Insurance);
        let marginRatio_0 = await Levex.marginRatio(trader, 0, 0, Uni3DexData);
        await timeLock.executeTransaction(Levex.address, 0, 'moveInsurance(uint16,uint8,address,uint256)',
            web3.eth.abi.encodeParameters(['uint16', 'uint8', 'address', 'uint256'], [pairId, 0, accounts[5], pool0Insurance]), 0)
        let marginRatio_1 = await Levex.marginRatio(trader, 0, 0, Uni3DexData);
        m.log("marginRatio_0.current", marginRatio_0.current);
        m.log("marginRatio_1.current", marginRatio_1.current);

        assert.equal(marginRatio_1.current.toString(), marginRatio_0.current.toString());

        assert.equal((await Levex.totalHelds(token0.address)).toString(), (await Levex.activeTrades(trader, pairId, false)).held.toString());
        assert.equal("0", (await Levex.markets(pairId)).pool0Insurance);
        assert.equal(pool0Insurance, (await token0.balanceOf(accounts[5])).toString());

        await Levex.closeTrade(0, 0, (await Levex.activeTrades(trader, pairId, false)).held, 0, Uni3DexData, {from: trader});
        assert.equal("0", (await Levex.activeTrades(trader, pairId, false)).held.toString());
        assert.equal("0", (await pool1.borrowBalanceCurrent(trader)).toString());

        await assertThrows(Levex.moveInsurance(pairId, 1, accounts[5], pool1Insurance), 'caller must be admin');

    })

    it("Admin setOpLimitOrder test", async () => {
        let {timeLock, Levex} = await instanceSimpleLevex();
        let opLimitOrder = timeLock.address;
        await timeLock.executeTransaction(Levex.address, 0, 'setOpLimitOrder(address)',
            web3.eth.abi.encodeParameters(['address'], [opLimitOrder]), 0);
        assert.equal(opLimitOrder, await Levex.opLimitOrder());
        await assertThrows(Levex.setOpLimitOrder(opLimitOrder), 'caller must be admin');
    })

    it("Admin setImplementation test", async () => {
        LevexV1Lib = await LevexV1Lib.new();
        await LevexV1.link("LevexV1Lib", LevexV1Lib.address);
        let instance = await LevexV1.new();
        let {timeLock, Levex} = await instanceSimpleLevex();
        Levex = await LevexDelegator.at(Levex.address);
        await timeLock.executeTransaction(Levex.address, 0, 'setImplementation(address)',
            web3.eth.abi.encodeParameters(['address'], [instance.address]), 0)
        assert.equal(instance.address, await Levex.implementation());
        await assertThrows(Levex.setImplementation(instance.address), 'caller must be admin');
    });

    async function instanceSimpleLevex() {
        let timeLock = await utils.createTimelock(admin);
        let Levex = await utils.createLevex("0x0000000000000000000000000000000000000000",
            timeLock.address, "0x0000000000000000000000000000000000000000",
            "0x0000000000000000000000000000000000000000", []);
        return {
            timeLock: timeLock,
            Levex: Levex
        };
    }
})
