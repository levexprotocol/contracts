const utils = require("./utils/LevexUtil");
const {
  toWei,
  last8,
  checkAmount,
  printBlockNum,
  Uni3DexData,
  assertPrint, assertThrows,
} = require("./utils/LevexUtil");
const {toBN} = require("./utils/EtheUtil");
const LevexV1Lib = artifacts.require("LevexV1Lib")
const LevexDelegate = artifacts.require("LevexV1");
const LevexV1 = artifacts.require("LevexDelegator");
const m = require('mocha-logger');
const LPool = artifacts.require("LPool");
const TestToken = artifacts.require("MockERC20");

contract("Levex UniV3", async accounts => {

  // components
  let LevexV1Lib;
  let Levex;
  let LVX;
  let xLVX;
  let gotPair;

  // rLVXs
  let admin = accounts[0];
  let saver = accounts[1];
  let trader = accounts[2];
  let dev = accounts[3];
  let token0;
  let token1;
  let dexAgg;

  beforeEach(async () => {

    // runs once before the first test in this block
    let controller = await utils.createController(admin);
    m.log("Created Controller", last8(controller.address));

    LVX = await TestToken.new('LevexERC20', 'LVX');

    token0 = await TestToken.new('TokenA', 'TKA');
    token1 = await TestToken.new('TokenB', 'TKB');

    let uniswapFactory = await utils.createUniswapV3Factory();
    gotPair = await utils.createUniswapV3Pool(uniswapFactory, token0, token1, accounts[0]);

    token0 = await TestToken.at(await gotPair.token0());
    token1 = await TestToken.at(await gotPair.token1());
    dexAgg = await utils.createEthDexAgg("0x0000000000000000000000000000000000000000", uniswapFactory.address, accounts[0]);

    xLVX = await utils.createXLVX(LVX.address, admin, dev, dexAgg.address);
    let LevexV1Lib = await LevexV1Lib.new();
    await LevexDelegate.link("LevexV1Lib", LevexV1Lib.address);
    let delegate = await LevexDelegate.new();
    Levex = await LevexV1.new(controller.address, dexAgg.address, [token0.address, token1.address], "0x0000000000000000000000000000000000000000", xLVX.address,[1,2], accounts[0], delegate.address);
    Levex = await LevexDelegate.at(Levex.address);
    await Levex.setCalculateConfig(30, 33, 3000, 5, 25, 25, (30e18) + '', 300, 10, 60);
    await controller.setLevex(Levex.address);
    await controller.setLPoolImplementation((await utils.createLPoolImpl()).address);
    await controller.setInterestParam(toBN(90e16).div(toBN(2102400)), toBN(10e16).div(toBN(2102400)), toBN(20e16).div(toBN(2102400)), 50e16 + '');
    await controller.createLPoolPair(token0.address, token1.address, 3000, Uni3DexData); // 30% margin ratio
    await dexAgg.setLevex(Levex.address);

    assert.equal(await Levex.numPairs(), 1, "Should have one active pair");
    m.log("Reset Levex instance: ", last8(Levex.address));
  });

  it("Long Token0 with Token0 deposit, lower price, then close", async () => {
    let pairId = 0;
    let btc = token0;
    let usdt = token1;
    m.log("BTC=", last8(btc.address));
    m.log("USDT=", last8(usdt.address));

    // provide some funds for trader and saver
    await utils.mint(btc, trader, 10000);
    checkAmount(await btc.symbol() + " Trader " + last8(trader) + " Balance", 10000000000000000000000, await btc.balanceOf(trader), 18);

    await utils.mint(usdt, saver, 10000);
    checkAmount(await usdt.symbol() + " Saver " + last8(saver) + " Balance", 10000000000000000000000, await usdt.balanceOf(saver), 18);

    // Trader to approve Levex to spend
    let deposit = utils.toWei(400);
    await btc.approve(Levex.address, deposit, {from: trader});

    // Saver deposit to pool1
    let saverSupply = utils.toWei(1000);
    let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
    await usdt.approve(await pool1.address, utils.toWei(1000), {from: saver});
    await pool1.mint(saverSupply, {from: saver});

    let borrow = utils.toWei(500);


    let tx = await Levex.marginTrade(0, false, false, deposit, borrow, 0, Uni3DexData, {from: trader});

    // Check events
    assertPrint("Deposit BTC", '400000000000000000000', toBN(tx.logs[0].args.deposited));
    assertPrint("Borrow USDT", '500000000000000000000', toBN(tx.logs[0].args.borrowed));
    assertPrint("Held", '893327303890107812554', toBN(tx.logs[0].args.held));
    assertPrint("Fees", '2700000000000000000', toBN(tx.logs[0].args.fees));

    assertPrint("Insurance of Pool0:", '891000000000000000', (await Levex.markets(0)).pool0Insurance);

    // Check balances
    checkAmount("Trader BTC Balance", 9600000000000000000000, await btc.balanceOf(trader), 18);
    checkAmount("Trader USDT Balance", 0, await usdt.balanceOf(trader), 18);
    checkAmount("xLVX USDT Balance", 0, await usdt.balanceOf(xLVX.address), 18);
    checkAmount("xLVX BTC Balance", 1809000000000000000, await btc.balanceOf(xLVX.address), 18);
    checkAmount("Levex BTC Balance", 894218303890107812554, await btc.balanceOf(Levex.address), 18);


    let trade = await Levex.activeTrades(trader, 0, 0);
    m.log("Trade.held:", trade.held);
    m.log("Trade.deposited:", trade.deposited);


    await gotPair.setPrice(btc.address, usdt.address, utils.toWei(1));
    // Market price change, then check margin ratio
    let marginRatio_1 = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
    m.log("Margin Ratio:", marginRatio_1.current / 100, "%");
    /**
     * held:893.327
     * deposit:400
     * borrow:500
     * price:1
     * marginRatio=(held*price-borrow)/borrow=(893.327*1-500)/500=74.42%
     */
    assert.equal(7866, marginRatio_1.current.toString());

    // Partial Close trade
    m.log("Partial Close Trade", 400);
    let tx_close = await Levex.closeTrade(0, 0, "400000000000000000000",  utils.maxUint(), Uni3DexData, {from: trader});

    // Check contract held balance
    checkAmount("Levex USDT Balance", 0, await usdt.balanceOf(Levex.address), 18);
    checkAmount("Levex BTC Balance", 494614303890107812554, await btc.balanceOf(Levex.address), 18);
    checkAmount("Trader USDT Balance", 0, await usdt.balanceOf(trader), 18);
    checkAmount("Trader BTC Balance", 9773740152470129338679, await btc.balanceOf(trader), 18);
    checkAmount("Treasury USDT Balance", 0, await usdt.balanceOf(xLVX.address), 18);
    checkAmount("Treasury BTC Balance", 2613000000000000000, await btc.balanceOf(xLVX.address), 18);
    // await printBlockNum();

    trade = await Levex.activeTrades(trader, 0, 0);
    m.log("Trade held:", trade.held);
    m.log("Trade deposited:", trade.deposited);

    let ratio = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
    m.log("Ratio, current:", ratio.current, "limit", ratio.marketLimit);
    assert.equal(7786, ratio.current.toString());

    // Partial Close trade
    let tx_full_close = await Levex.closeTrade(0, 0, "472129737581559270371",  utils.maxUint(), Uni3DexData, {from: trader});

    checkAmount("Levex USDT Balance", 0, await usdt.balanceOf(Levex.address), 18);
    checkAmount("Levex BTC Balance", 22951974748754285860, await btc.balanceOf(Levex.address), 18);
    checkAmount("Trader USDT Balance", 0, await usdt.balanceOf(trader), 18);
    checkAmount("Trader BTC Balance", 9977506702876168179173, await btc.balanceOf(trader), 18);
    checkAmount("Treasury USDT Balance", 0, await usdt.balanceOf(xLVX.address), 18);
    checkAmount("Treasury BTC Balance", 3561980772538934134, await btc.balanceOf(xLVX.address), 18);

    assertPrint("Insurance of Pool0:", '1754408440205743677', (await Levex.markets(0)).pool0Insurance);
    assertPrint("Insurance of Pool1:", '0', (await Levex.markets(0)).pool1Insurance);

  })

  it("Long Token0 with Token1 deposit,  then close", async () => {
    let pairId = 0;
    let btc = token0;
    let usdt = token1;
    // provide some funds for trader and saver
    let deposit = utils.toWei(400);
    await utils.mint(usdt, trader, 400);

    await utils.mint(usdt, saver, 10000);

    // Trader to approve Levex to spend
    await usdt.approve(Levex.address, deposit, {from: trader});

    // Saver deposit to pool1
    let saverSupply = utils.toWei(1000);
    let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
    await usdt.approve(await pool1.address, utils.toWei(1000), {from: saver});
    await pool1.mint(saverSupply, {from: saver});

    let borrow = utils.toWei(500);


    let tx = await Levex.marginTrade(0, false, true, deposit, borrow, 0, Uni3DexData, {from: trader});

    // Check events
    assertPrint("Deposit USDT", '400000000000000000000', toBN(tx.logs[0].args.deposited));
    assertPrint("Borrow USDT", '500000000000000000000', toBN(tx.logs[0].args.borrowed));
    assertPrint("Held", '886675826237735294796', toBN(tx.logs[0].args.held));
    assertPrint("Fees", '2700000000000000000', toBN(tx.logs[0].args.fees));

    assertPrint("Insurance of Pool1:", '891000000000000000', (await Levex.markets(0)).pool1Insurance);
    assertPrint("Insurance of Pool0:", '0', (await Levex.markets(0)).pool0Insurance);

    // Check balances
    checkAmount("Treasury USDT Balance", 1809000000000000000, await usdt.balanceOf(xLVX.address), 18);
    checkAmount("Treasury BTC Balance", 0, await btc.balanceOf(xLVX.address), 18);
    checkAmount("Levex BTC Balance", 886675826237735294796, await btc.balanceOf(Levex.address), 18);


    let trade = await Levex.activeTrades(trader, 0, 0);
    m.log("Trade.held:", trade.held);
    m.log("Trade.deposited:", trade.deposited);


    // Partial Close trade
    m.log("Partial Close Trade", 400);
    let tx_partial_close = await Levex.closeTrade(0, 0, "400000000000000000000", 0, Uni3DexData, {from: trader});
    m.log("Partial Close Tx ", JSON.stringify(tx_partial_close.logs[0]));
    assert.equal("179231231186616798657", tx_partial_close.logs[0].args.depositDecrease.toString());
    //Check borrows
    assert.equal("274438544363108716943", (await pool1.borrowBalanceCurrent(trader)).toString());

    // Check contract held balance
    checkAmount("Levex BTC Balance", 487071826237735294796, await btc.balanceOf(Levex.address), 18);
    checkAmount("Levex USDT Balance", 891000000000000000, await usdt.balanceOf(Levex.address), 18);
    checkAmount("Trader USDT Balance", 177570520075597641706, await usdt.balanceOf(trader), 18);
    checkAmount("Trader BTC Balance", 0, await btc.balanceOf(trader), 18);
    checkAmount("Treasury USDT Balance", 1809000000000000000, await usdt.balanceOf(xLVX.address), 18);
    checkAmount("Treasury BTC Balance", 804000000000000000, await btc.balanceOf(xLVX.address), 18);
    assertPrint("Insurance of Pool0:", 396000000000000000, (await Levex.markets(0)).pool0Insurance);

    trade = await Levex.activeTrades(trader, 0, 0);
    m.log("Trade held:", trade.held);
    m.log("Trade deposited:", trade.deposited);

    let ratio = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
    m.log("Ratio, current:", ratio.current, "limit", ratio.limit);
    assert.equal(7908, ratio.current.toString());
    //
    // Partial Close trade
    let tx_full_close = await Levex.closeTrade(0, 0, "486675826237735294796", 0, Uni3DexData, {from: trader});
    m.log("Full Close Tx ", JSON.stringify(tx_full_close.logs[0]));
    assert.equal("218068768813383201343", tx_full_close.logs[0].args.depositDecrease.toString());

    trade = await Levex.activeTrades(trader, 0, 0);

    assert.equal("0", trade.held);
    assert.equal("0", trade.deposited);

    checkAmount("Levex BTC Balance", 877809067975357941, await btc.balanceOf(Levex.address), 18);
    checkAmount("Levex USDT Balance", 891000000000000000, await usdt.balanceOf(Levex.address), 18);
    checkAmount("Trader USDT Balance", 389295395931697216945, await usdt.balanceOf(trader), 18);
    checkAmount("Trader BTC Balance", 0, await btc.balanceOf(trader), 18);
    checkAmount("Treasury USDT Balance", 1809000000000000000, await usdt.balanceOf(xLVX.address), 18);
    checkAmount("Treasury BTC Balance", 1782218410737847943, await btc.balanceOf(xLVX.address), 18);
    assertPrint("Insurance of Pool1:", 891000000000000000, (await Levex.markets(0)).pool1Insurance);

    assertPrint("Insurance of Pool0:", "877809067975357941", (await Levex.markets(0)).pool0Insurance);

    assert.equal("0", await pool1.borrowBalanceCurrent(trader));

  })

  it("Opens Long 2x, open again with 3x, partial close, and full close", async () => {
    let pairId = 0;

    // provide some funds for trader and saver
    await utils.mint(token1, trader, 10000);
    checkAmount(await token1.symbol() + " Trader " + last8(saver) + " Balance", 10000000000000000000000, await token1.balanceOf(trader), 18);

    await utils.mint(token1, saver, 10000);
    checkAmount(await token1.symbol() + " Saver " + last8(saver) + " Balance", 10000000000000000000000, await token1.balanceOf(saver), 18);

    // Trader to approve Levex to spend
    let deposit = utils.toWei(400);
    await token1.approve(Levex.address, deposit, {from: trader});

    // Saver deposit to pool1
    let saverSupply = utils.toWei(2000);
    let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
    await token1.approve(await pool1.address, utils.toWei(2000), {from: saver});
    await pool1.mint(saverSupply, {from: saver});

    let borrow = utils.toWei(500);
    m.log("toBorrow from Pool 1: \t", borrow);


    m.log("Margin Trade:", "Deposit=", deposit, "Borrow=", borrow);
    let tx = await Levex.marginTrade(0, false, true, deposit, borrow, 0, Uni3DexData, {from: trader});

    // Check events
    let fees = tx.logs[0].args.fees;
    m.log("Fees", fees);
    assert.equal(fees, 2700000000000000000);

    assertPrint("Insurance of Pool1:", '891000000000000000', (await Levex.markets(0)).pool1Insurance);


    // Check balances
    checkAmount("Trader Balance", 9600000000000000000000, await token1.balanceOf(trader), 18);
    checkAmount("Treasury Balance", 1809000000000000000, await token1.balanceOf(xLVX.address), 18);
    checkAmount("Levex Balance", 886675826237735294796, await token0.balanceOf(Levex.address), 18);


    // Market price change, then check margin ratio
    let marginRatio_1 = await Levex.marginRatio(trader, 0, 0, Uni3DexData, {from: saver});
    m.log("Margin Ratio:", marginRatio_1.current / 100, "%");
    assert.equal(marginRatio_1.current.toString(), 8052);

    m.log("Margin Trade Again:", "Deposit=", deposit, "Borrow=", borrow);
    await token1.approve(Levex.address, deposit, {from: trader});
    tx = await Levex.marginTrade(0, false, true, deposit, borrow, 0, Uni3DexData, {from: trader});

    let trade = await Levex.activeTrades(trader, 0, 0);
    assertPrint("trade.deposited:", '794600000000000000000', trade.deposited);
    assertPrint("trade.held:", '1757765966568077375567', trade.held);

    checkAmount("Trader Balance", 9200000000000000000000, await token1.balanceOf(trader), 18);

    trade = await Levex.activeTrades(trader, 0, 0);
    m.log("Trade:", JSON.stringify(trade, 0, 2));

    let tx_close = await Levex.closeTrade(0, 0, "1042295145981432778660", 0, Uni3DexData, {from: trader});
    m.log("TradeClose event:", JSON.stringify(tx_close.logs[0].args.closeAmount, 0, 2));

    trade = await Levex.activeTrades(trader, 0, 0);
    //Check trade
    assertPrint("trade.deposited:", '323429355699799058500', trade.deposited);
    assertPrint("trade.held:", '715470820586644596907', trade.held);

    // Check contract held balance  9504186992243861070926
    checkAmount("Levex Balance", 1782000000000000000, await token1.balanceOf(Levex.address), 18);
    checkAmount("Trader Balance", 9669288041750866918925, await token1.balanceOf(trader), 18);
    checkAmount("Treasury Balance", 3618000000000000000, await token1.balanceOf(xLVX.address), 18);
    checkAmount("Treasury Balance", 2095013243422679885, await token0.balanceOf(xLVX.address), 18);

    tx_close = await Levex.closeTrade(0, 0, "715470820586644596907", 0, Uni3DexData, {from: trader});
    m.log("TradeClose event:", JSON.stringify(tx_close.logs[0].args.closeAmount, 0, 2));

    trade = await Levex.activeTrades(trader, 0, 0);
    assertPrint("trade.deposited:", '0', trade.deposited);
    assertPrint("trade.held:", '0', trade.held);

    // Check contract held balance   9701623951262107661984
    checkAmount("Levex Balance", 1782000000000000000, await token1.balanceOf(Levex.address), 18);
    checkAmount("Trader Balance", 9978683244982547469060, await token1.balanceOf(trader), 18);
    checkAmount("Treasury Balance", 3618000000000000000, await token1.balanceOf(xLVX.address), 18);
    checkAmount("Treasury Balance", 3533109592801835525, await token0.balanceOf(xLVX.address), 18);
    await printBlockNum();
  })
  it("LONG Token0, Deposit Token0, Close, Blow up", async () => {
    let pairId = 0;

    // provide some funds for trader and saver
    await utils.mint(token0, trader, 10000);
    m.log("Trader", last8(trader), "minted", await token0.symbol(), await token0.balanceOf(trader));

    await utils.mint(token1, saver, 100000);
    m.log("Saver", last8(saver), "minted", await token1.symbol(), await token1.balanceOf(saver));

    // Trader to approve Levex to spend
    let deposit = utils.toWei(1000);
    await token0.approve(Levex.address, deposit, {from: trader});

    // Saver deposit to pool1
    let saverSupply = utils.toWei(10000);
    let pool1 = await LPool.at((await Levex.markets(pairId)).pool1);
    await token1.approve(await pool1.address, utils.toWei(10000), {from: saver});
    await pool1.mint(saverSupply, {from: saver});

    let borrow = utils.toWei(2200);
    m.log("toBorrow from Pool 1: \t", borrow);

    await Levex.marginTrade(0, false, false, deposit, borrow, 0, Uni3DexData, {from: trader});
    //change Price
    await utils.mint(token0, saver, 100000);
    await token0.approve(dexAgg.address, utils.toWei(50000), {from: saver});
    await dexAgg.sell(token1.address, token0.address, utils.toWei(50000), 0, Uni3DexData, {from: saver});
    let trade = await Levex.activeTrades(trader, 0, 0);
    // Close trade
    m.log("trade.deposit=", trade.deposited);
    await assertThrows(Levex.closeTrade(0, 0, trade.held, 0, Uni3DexData, {from: trader}), 'TFF');
  })
})
