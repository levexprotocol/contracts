const utils = require("./utils/LevexUtil");
const {
    toWei,
    last8,
    prettyPrintBalance,
    checkAmount,
    printBlockNum,
    wait,
    assertPrint,
    Uni2DexData,
    addressToBytes,
    step,
    resetStep, assertThrows
} = require("./utils/LevexUtil");
const {advanceMultipleBlocksAndTime, toBN, advanceBlockAndSetTime} = require("./utils/EtheUtil");
const m = require('mocha-logger');
const TestToken = artifacts.require("MockERC20");
const XLVXDelegator = artifacts.require("XLVXDelegator");
const MockUniswapV2Pair = artifacts.require("MockUniswapV2Pair");

const timeMachine = require('ganache-time-traveler');

contract("XLVX", async accounts => {

    // components
    let xLVX;
    let LVX;
    let dai;
    let usdt;
    let uniswapFactory;

    let H = 3600;
    let DAY = 86400;
    let WEEK = 7 * DAY;
    let MAXTIME = 126144000;
    let TOL = 120 / WEEK;

    // rLVXs
    let admin = accounts[0];
    let john = accounts[1];
    let tom = accounts[2];
    let dev = accounts[7];
    let communityAcc = accounts[8];

    let daiLVXDexData;
    let usdtLVXDexData;
    let daiUsdtDexData;
    let dexAgg;
    let snapshotId;
    beforeEach(async () => {

        // runs once before the first test in this block
        let controller = await utils.createController(admin);
        m.log("Created Controller", last8(controller.address));

        uniswapFactory = await utils.createUniswapV2Factory(admin);
        m.log("Created UniswapFactory", last8(uniswapFactory.address));

        LVX = await TestToken.new('LevexERC20', 'LVX');
        usdt = await TestToken.new('Tether', 'USDT');
        dai = await TestToken.new('DAI', 'DAI');

        let pair = await MockUniswapV2Pair.new(usdt.address, dai.address, toWei(10000), toWei(10000));
        let LVXUsdtPair = await MockUniswapV2Pair.new(usdt.address, LVX.address, toWei(100000), toWei(100000));
        let LVXDaiPair = await MockUniswapV2Pair.new(dai.address, LVX.address, toWei(100000), toWei(100000));
        daiLVXDexData = Uni2DexData + addressToBytes(dai.address) + addressToBytes(LVX.address);
        usdtLVXDexData = Uni2DexData + addressToBytes(usdt.address) + addressToBytes(LVX.address);
        daiUsdtDexData = Uni2DexData + addressToBytes(dai.address) + addressToBytes(usdt.address);


        m.log("LVX.address=", LVX.address);
        m.log("usdt.address=", usdt.address);
        m.log("dai.address=", dai.address);

        m.log("daiLVXDexData=", daiLVXDexData);
        m.log("usdtLVXDexData=", usdtLVXDexData);
        m.log("Created MockUniswapV2Pair (", last8(await pair.token0()), ",", last8(await pair.token1()), ")");

        await uniswapFactory.addPair(pair.address);
        await uniswapFactory.addPair(LVXUsdtPair.address);
        await uniswapFactory.addPair(LVXDaiPair.address);
        m.log("Added pairs", last8(pair.address), last8(LVXUsdtPair.address), last8(LVXDaiPair.address));
        dexAgg = await utils.createEthDexAgg(uniswapFactory.address, "0x0000000000000000000000000000000000000000", admin);
        // Making sure the pair has been added correctly in mock
        let gotPair = await MockUniswapV2Pair.at(await uniswapFactory.getPair(usdt.address, dai.address));
        assert.equal(await pair.token0(), await gotPair.token0());
        assert.equal(await pair.token1(), await gotPair.token1());
        xLVX = await utils.createXLVX(LVX.address, admin, dev, dexAgg.address);
        await xLVX.setShareToken(LVX.address);
        await xLVX.setLVXLpStakeToken(LVX.address, {from: admin});
        m.log("Created xLVX", last8(xLVX.address));
        await utils.mint(usdt, xLVX.address, 10000);

        resetStep();
        let lastbk = await web3.eth.getBlock('latest');
        let timeToMove = lastbk.timestamp + (WEEK - lastbk.timestamp % WEEK);
        m.log("Move time to start of the week", new Date(timeToMove));
        await advanceBlockAndSetTime(timeToMove);
        let snapshot = await timeMachine.takeSnapshot();
        snapshotId = snapshot['result'];
    });
    afterEach(async () => {
        await timeMachine.revertToSnapshot(snapshotId);
    });
    it("Convert current erc20 holdings to reward, withdrawn dev fund", async () => {

        assert.equal('0', (await LVX.balanceOf(xLVX.address)).toString());

        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(10000), lastbk.timestamp + 2 * WEEK + 10);

        await xLVX.convertToSharingToken(toWei(1), 0, usdtLVXDexData);
        m.log("devFund:", (await xLVX.devFund()).toString());
        m.log("totalRewarded:", (await xLVX.totalRewarded()).toString());
        m.log("supply:", (await xLVX.totalLocked()).toString());
        m.log("lastUpdateTime:", (await xLVX.lastUpdateTime()).toString());
        m.log("rewardPerTokenStored:", (await xLVX.rewardPerTokenStored()).toString());
        assert.equal('498495030004550854', (await xLVX.devFund()).toString());

        m.log("Withdrawing dev fund");
        await xLVX.withdrawDevFund({from: dev});
        assert.equal('0', (await xLVX.devFund()).toString());
        assert.equal('10000498495030004550855', (await LVX.balanceOf(xLVX.address)).toString());
        assert.equal('498495030004550854', (await LVX.balanceOf(dev)).toString());
        m.log("Dev Fund balance:", await xLVX.devFund());
        m.log("Dev LVX balance:", await LVX.balanceOf(dev));
        m.log("xLVX LVX balance:", await LVX.balanceOf(xLVX.address));
    })

    it("Convert LVX Token exceed available", async () => {
        await LVX.mint(xLVX.address, toWei(10000));
        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(10000), lastbk.timestamp + 2 * WEEK + 10);

        await xLVX.convertToSharingToken(toWei(10000), 0, '0x');

        m.log("Withdrawing dev fund");
        await xLVX.withdrawDevFund({from: dev});

        m.log("LVX balance in xLVX:", await LVX.balanceOf(xLVX.address));
        m.log("supply:", await xLVX.totalLocked());
        m.log("totalRewarded:", await xLVX.totalRewarded());
        m.log("withdrewReward:", await xLVX.withdrewReward());
        m.log("devFund:", await xLVX.devFund());
        await assertThrows(xLVX.convertToSharingToken(toWei(1), 0, '0x'), 'Exceed share token balance');

    })

    it("Convert Sharing Token correct", async () => {
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(10000), lastbk.timestamp + 2 * WEEK + 10);
        await xLVX.convertToSharingToken(toWei(1000), 0, daiLVXDexData);

        m.log("xLVX LVX balance:", await LVX.balanceOf(xLVX.address));
        assert.equal('10987158034397061298850', (await LVX.balanceOf(xLVX.address)).toString());

        m.log("xLVX totalRewarded:", await xLVX.totalRewarded());
        assert.equal('493579017198530649425', (await xLVX.totalRewarded()).toString());

        m.log("xLVX devFund:", await xLVX.devFund());
        assert.equal('493579017198530649425', (await xLVX.devFund()).toString());

        m.log("xLVX withdrewReward:", await xLVX.withdrewReward());
        assert.equal('0', (await xLVX.withdrewReward()).toString());
        m.log("xLVX.totalSupply", (await xLVX.totalSupply()).toString());
        m.log("xLVX.balanceOf", (await xLVX.balanceOf(admin)).toString());
        assert.equal('0', (await xLVX.rewardPerTokenStored()).toString());
        // withdraw devFund
        await xLVX.withdrawDevFund({from: dev});
        assert.equal('493579017198530649425', (await LVX.balanceOf(dev)).toString());
        // withdraw communityFund
        await xLVX.withdrawCommunityFund(communityAcc);
        assert.equal('493579017198530649425', (await LVX.balanceOf(communityAcc)).toString());
        assert.equal('493579017198530649425', (await xLVX.withdrewReward()).toString());
        //add sharingToken Reward 2000
        await usdt.mint(xLVX.address, toWei(2000));
        //sharing 1000
        await xLVX.convertToSharingToken(toWei(1000), 0, usdtLVXDexData);
        assert.equal('987158034397061298850', (await xLVX.totalRewarded()).toString());
        //Exceed available balance
        await assertThrows(xLVX.convertToSharingToken(toWei(20001), 0, usdtLVXDexData), 'Exceed available balance');

    })
    it("Convert DAI to USDT", async () => {
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(10000), lastbk.timestamp + 2 * WEEK);
        assert.equal('10000000000000000000000', (await usdt.balanceOf(xLVX.address)).toString());
        await xLVX.convertToSharingToken(toWei(1000), 0, daiUsdtDexData);
        m.log("xLVX USDT balance:", await usdt.balanceOf(xLVX.address));
        assert.equal('10906610893880149131581', (await usdt.balanceOf(xLVX.address)).toString());

        m.log("xLVX DAI balance:", await dai.balanceOf(xLVX.address));
        assert.equal('0', (await dai.balanceOf(xLVX.address)).toString());

        m.log("xLVX LVX balance:", await LVX.balanceOf(xLVX.address));
        assert.equal('10000000000000000000000', (await LVX.balanceOf(xLVX.address)).toString());

        m.log("xLVX totalRewarded:", await xLVX.totalRewarded());
        assert.equal('0', (await xLVX.totalRewarded()).toString());

        m.log("xLVX devFund:", await xLVX.devFund());
        assert.equal('0', (await xLVX.devFund()).toString());
    })

    it("Convert DAI to USDT to LVX ", async () => {
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(10000), lastbk.timestamp + 2 * WEEK + 10);
        assert.equal('10000000000000000000000', (await usdt.balanceOf(xLVX.address)).toString());
        await xLVX.convertToSharingToken(toWei(1000), 0, "0x01" + "000000" + "03" + addressToBytes(dai.address) + addressToBytes(usdt.address) + addressToBytes(LVX.address));
        m.log("xLVX USDT balance:", await usdt.balanceOf(xLVX.address));
        assert.equal('10000000000000000000000', (await usdt.balanceOf(xLVX.address)).toString());

        m.log("xLVX DAI balance:", await dai.balanceOf(xLVX.address));
        assert.equal('0', (await dai.balanceOf(xLVX.address)).toString());

        m.log("xLVX LVX balance:", await LVX.balanceOf(xLVX.address));
        assert.equal('10895794058774498675511', (await LVX.balanceOf(xLVX.address)).toString());

        m.log("xLVX totalRewarded:", await xLVX.totalRewarded());
        assert.equal('447897029387249337756', (await xLVX.totalRewarded()).toString());

        m.log("xLVX devFund:", await xLVX.devFund());
        assert.equal('447897029387249337755', (await xLVX.devFund()).toString());
    })

    it("John Deposit for 1 weeks, Tom 2 weeks", async () => {

        await LVX.mint(john, toWei(10000));
        await LVX.mint(tom, toWei(10000));
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.approve(xLVX.address, toWei(500), {from: john});
        await LVX.approve(xLVX.address, toWei(500), {from: tom});

        let lastbk = await web3.eth.getBlock('latest');
        let timeToMove = lastbk.timestamp + (WEEK - lastbk.timestamp % WEEK);
        m.log("Move time to start of the week", new Date(timeToMove));

        step("John stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + 2 * WEEK + 60, {from: john});
        step("Tom stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + (2 * WEEK) + 60 * 60, {from: tom});
        assertPrint("Total staked:", toWei(1000), await xLVX.totalLocked());
        step("New reward 1");
        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '498495030004550854', await xLVX.devFund());
        assertPrint("Total to share:", '498495030004550855', await xLVX.totalRewarded());
    })

    it("John Deposit for 1 weeks, Tom 2 weeks increase amount yet", async () => {

        await LVX.mint(john, toWei(10000));
        await LVX.mint(tom, toWei(10000));
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.approve(xLVX.address, toWei(500), {from: john});
        await LVX.approve(xLVX.address, toWei(1000), {from: tom});

        let lastbk = await web3.eth.getBlock('latest');
        let timeToMove = lastbk.timestamp + (WEEK - lastbk.timestamp % WEEK);
        m.log("Move time to start of the week", new Date(timeToMove));

        step("John stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + 2 * WEEK + 10, {from: john});
        step("Tom stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + (2 * WEEK) + 60 * 60, {from: tom});
        await xLVX.increase_amount(toWei(500), {from: tom});

        assertPrint("Total staked:", toWei(1500), await xLVX.totalLocked());
        step("New reward 1");
        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '498495030004550854', await xLVX.devFund());
        assertPrint("Total to share:", '498495030004550855', await xLVX.totalRewarded());
    })

    it("John Deposit for 1 weeks, Tom 2 weeks increase unlock time to 4 weeks", async () => {

        await LVX.mint(john, toWei(10000));
        await LVX.mint(tom, toWei(10000));
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.approve(xLVX.address, toWei(500), {from: john});
        await LVX.approve(xLVX.address, toWei(1000), {from: tom});
        let lastbk = await web3.eth.getBlock('latest');
        let timeToMove = lastbk.timestamp + (WEEK - lastbk.timestamp % WEEK);
        m.log("Move time to start of the week", new Date(timeToMove));

        step("John stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + 2 * WEEK + 60, {from: john});
        step("Tom stake 500 2 weeks");
        lastbk = await web3.eth.getBlock('latest');
        await xLVX.create_lock(toWei(500), timeToMove + (2 * WEEK) + 60 * 60, {from: tom});
        timeToMove = lastbk.timestamp + WEEK;
        await xLVX.increase_unlock_time(timeToMove + (4 * WEEK) + 60 * 60, {from: tom});

        step("New reward 1");
        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '498495030004550854', await xLVX.devFund());
        assertPrint("Total to share:", '498495030004550855', await xLVX.totalRewarded());
    })

    it("John Deposit for 1 weeks, Tom 2 weeks redraw, share again", async () => {

        await LVX.mint(john, toWei(10000));
        await LVX.mint(tom, toWei(10000));
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.approve(xLVX.address, toWei(500), {from: john});
        await LVX.approve(xLVX.address, toWei(1000), {from: tom});
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        let timeToMove = lastbk.timestamp + (WEEK - lastbk.timestamp % WEEK);
        m.log("Move time to start of the week", new Date(timeToMove));
        step("John stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + 2 * WEEK + 10, {from: john});
        step("Tom stake 500 2 weeks");
        await xLVX.create_lock(toWei(500), timeToMove + (2 * WEEK) + 60 * 60, {from: tom});
        step("New reward 1");
        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);

        m.log("Tom balance=", (await xLVX.balanceOf(tom)).toString());
        m.log("John balance=", (await xLVX.balanceOf(john)).toString());

        let lockedEndBlock = (await xLVX.locked(tom)).end;
        m.log("lockedEndBlock=", lockedEndBlock);
        lastbk = await web3.eth.getBlock('latest');
        m.log("lastbk.timestamp before=", lastbk.timestamp);
        await advanceBlockAndSetTime(parseInt(lockedEndBlock.toString()));
        lastbk = await web3.eth.getBlock('latest');
        m.log("lastbk.timestamp after=", lastbk.timestamp);

        await xLVX.withdraw({from: tom});
        assertPrint("Total Extra Token:", "520800000000000000000", await xLVX.totalSupply());
        assertPrint("Tom Extra Token:", 0, await xLVX.balanceOf(tom));

        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);
    })
    it("John and Tom stakes, Tom stakes more, shares fees", async () => {
        m.log("process.env.FASTMODE", process.env.FASTMODE);
        if (process.env.FASTMODE === 'true') {
            m.log("Skipping this test for FAST Mode");
            return;
        }

        await LVX.mint(john, toWei(10000));
        await LVX.mint(tom, toWei(10000));
        await dai.mint(xLVX.address, toWei(1000));

        await LVX.approve(xLVX.address, toWei(500), {from: john});
        await LVX.approve(xLVX.address, toWei(300), {from: tom});

        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        step("John stake 500");
        await xLVX.create_lock(toWei(500), lastbk.timestamp + 2 * WEEK + 10, {from: john});
        assertPrint("John staked:", toWei(500), (await xLVX.locked(john)).amount);
        step("Tom stake 300");
        await xLVX.create_lock(toWei(300), lastbk.timestamp + 2 * WEEK + 10, {from: tom});
        assertPrint("Tom staked:", toWei(300), (await xLVX.locked(tom)).amount);
        assertPrint("Total staked:", toWei(800), await xLVX.totalLocked());
        step("New reward 1");
        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '498495030004550854', await xLVX.devFund());
        assertPrint("Total to share:", '498495030004550855', await xLVX.totalRewarded());

        step("Tom stake more 200");
        await LVX.approve(xLVX.address, toWei(200), {from: tom});
        await xLVX.increase_amount(toWei(200), {from: tom});
        assertPrint("Tom staked:", toWei(500), (await xLVX.locked(tom)).amount);
        assertPrint("John staked:", toWei(500), (await xLVX.locked(john)).amount);
        assertPrint("Total staked:", toWei(1000), await xLVX.totalLocked());

        step("New reward 1");
        await xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '996980105262148814', await xLVX.devFund());

        // Block time insensitive
        step("Advancing block time ...");
        timeMachine.advanceTimeAndBlock(1000);
        assertPrint("Dev Fund:", '996980105262148814', await xLVX.devFund());

        step("John stack more, but earning should not change because no new reward");
        await LVX.approve(xLVX.address, toWei(1000), {from: john});
        await xLVX.increase_amount(toWei(1000), {from: john});
        assertPrint("Total staked:", toWei(2000), await xLVX.totalLocked());
        assertPrint("Dev Fund:", '996980105262148814', await xLVX.devFund());

        step("New reward 200");
        await xLVX.convertToSharingToken(toWei(200), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '100494603912584309258', await xLVX.devFund());

        await advanceBlockAndSetTime(lastbk.timestamp + 3 * WEEK);
        step("John exits, but earning should not change because no new reward");
        await xLVX.withdraw({from: john});
        assertPrint("Total staked:", toWei(500), await xLVX.totalLocked());
        assertPrint("Dev Fund:", '100494603912584309258', await xLVX.devFund());

        step("New reward 100");
        await xLVX.convertToSharingToken(toWei(100), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '150094767100146587308', await xLVX.devFund());

        step("Tom exit, and more reward");
        await xLVX.withdraw({from: tom});

        step("John stack more, but earning should not change because no new reward");
        await LVX.approve(xLVX.address, toWei(1000), {from: john});
        lastbk = await web3.eth.getBlock('latest');
        await xLVX.create_lock(toWei(1000), lastbk.timestamp + 3 * WEEK, {from: john});

        step("New reward 100");
        await xLVX.convertToSharingToken(toWei(100), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '199596275059873518079', await xLVX.devFund());

        lastbk = await web3.eth.getBlock('latest');
        await xLVX.increase_unlock_time(lastbk.timestamp + 5 * WEEK, {from: john});
        assertPrint("Dev Fund:", '199596275059873518079', await xLVX.devFund());

        step("New reward 100");
        await xLVX.convertToSharingToken(toWei(100), 0, daiLVXDexData);
        assertPrint("Dev Fund:", '248999421985512891445', await xLVX.devFund());

    })

    it("Convert dexData is 0x ", async () => {
        await dai.mint(xLVX.address, toWei(1000));
        await xLVX.setShareToken(dai.address);
        assert.equal('1000000000000000000000', (await xLVX.shareableTokenAmount()).toString());
        assert.equal('0', (await xLVX.claimableTokenAmount()).toString());

        await xLVX.convertToSharingToken(toWei(500), 0, '0x');

        m.log("xLVX dai balance:", await dai.balanceOf(xLVX.address));
        assert.equal('1000000000000000000000', (await dai.balanceOf(xLVX.address)).toString());


        m.log("xLVX totalRewarded:", await xLVX.totalRewarded());
        assert.equal('250000000000000000000', (await xLVX.totalRewarded()).toString());

        m.log("xLVX devFund:", await xLVX.devFund());
        assert.equal('250000000000000000000', (await xLVX.devFund()).toString());

        assert.equal('500000000000000000000', (await xLVX.shareableTokenAmount()).toString());
        assert.equal('250000000000000000000', (await xLVX.claimableTokenAmount()).toString());


        await dai.mint(xLVX.address, toWei(1000));

        assert.equal('1500000000000000000000', (await xLVX.shareableTokenAmount()).toString());
        assert.equal('250000000000000000000', (await xLVX.claimableTokenAmount()).toString());

        // withdraw devFund
        await xLVX.withdrawDevFund({from: dev});
        assert.equal('250000000000000000000', (await dai.balanceOf(dev)).toString());

        await xLVX.convertToSharingToken(toWei(1500), 0, '0x');

        assert.equal('1750000000000000000000', (await dai.balanceOf(xLVX.address)).toString());
        assert.equal('1000000000000000000000', (await xLVX.totalRewarded()).toString());
        assert.equal('750000000000000000000', (await xLVX.devFund()).toString());

        await assertThrows(xLVX.convertToSharingToken(toWei(1), 0, '0x'), 'Exceed share token balance');

        // withdraw devFund
        await xLVX.withdrawDevFund({from: dev});
        assert.equal('1000000000000000000000', (await dai.balanceOf(dev)).toString());
        // withdraw communityFund
        await xLVX.withdrawCommunityFund(communityAcc);
        assert.equal('1000000000000000000000', (await dai.balanceOf(communityAcc)).toString());

        assert.equal('0', (await xLVX.shareableTokenAmount()).toString());
        assert.equal('0', (await xLVX.claimableTokenAmount()).toString());
    })

    it("Convert minBuy limit test", async () => {
        await dai.mint(xLVX.address, toWei(1000));
        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(10000), lastbk.timestamp + 2 * WEEK + 10);
        assert.equal('10000000000000000000000', (await usdt.balanceOf(xLVX.address)).toString());
        await assertThrows(xLVX.convertToSharingToken(toWei(1000), '10906610893880149131582', daiUsdtDexData), 'buy amount less than min');

        await assertThrows(xLVX.convertToSharingToken(toWei(1000), "895794058774498675512",
            "0x01" + "000000" + "03" + addressToBytes(dai.address) + addressToBytes(usdt.address) + addressToBytes(LVX.address)), 'buy amount less than min');

    })

    it("Convert shareToken=LVXToken test", async () => {
        await LVX.mint(admin, toWei(10000));
        await LVX.approve(xLVX.address, toWei(10000));
        let lastbk = await web3.eth.getBlock('latest');
        await advanceBlockAndSetTime(lastbk.timestamp - 10);
        await xLVX.create_lock(toWei(1), lastbk.timestamp + 2 * WEEK + 10);

        assert.equal('0', (await xLVX.shareableTokenAmount()).toString());
        assert.equal('0', (await xLVX.claimableTokenAmount()).toString());
        await LVX.mint(xLVX.address, toWei(10000));
        assert.equal("10000000000000000000000", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('0', (await xLVX.claimableTokenAmount()).toString());
        // increase not effect shareableAmount
        await xLVX.increase_amount(toWei(1));
        assert.equal("10000000000000000000000", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('0', (await xLVX.claimableTokenAmount()).toString());
        // convert dai to LVX
        await dai.mint(xLVX.address, toWei(1000));
        await xLVX.convertToSharingToken(toWei(1000), '0', daiLVXDexData);
        assert.equal("10000000000000000000000", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('493579017198530649425', (await xLVX.claimableTokenAmount()).toString());
        assert.equal('493579017198530649425', (await xLVX.devFund()).toString());
        // convert usdt to LVX
        await usdt.mint(xLVX.address, toWei(1000));
        await xLVX.convertToSharingToken(toWei(1000), '0', usdtLVXDexData);
        assert.equal("10000000000000000000000", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('987158034397061298850', (await xLVX.claimableTokenAmount()).toString());
        assert.equal('987158034397061298850', (await xLVX.devFund()).toString());
        // convert LVX
        await xLVX.convertToSharingToken(toWei(1000), '0', '0x');
        assert.equal("9000000000000000000000", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('1487158034397061298850', (await xLVX.claimableTokenAmount()).toString());
        assert.equal('1487158034397061298850', (await xLVX.devFund()).toString());
        // withdrawCommunityFund
        await xLVX.withdrawCommunityFund(communityAcc);
        assert.equal('1487158034397061298850', (await LVX.balanceOf(communityAcc)).toString());
        assert.equal("9000000000000000000000", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('0', (await xLVX.claimableTokenAmount()).toString());
        assert.equal('1487158034397061298850', (await xLVX.devFund()).toString());
        // user withdraw LVX, no effect
        lastbk = await web3.eth.getBlock('latest');
        end = lastbk.timestamp + WEEK * 3;
        await advanceBlockAndSetTime(end + 60 * 60 * 24);
        await xLVX.withdraw({from: admin});
        assert.equal('0', (await xLVX.balanceOf(admin)).toString());
        assert.equal('10000000000000000000000', (await LVX.balanceOf(admin)).toString());
        // convert all
        await xLVX.convertToSharingToken(toWei(9000), '0', '0x');
        assert.equal("0", (await xLVX.shareableTokenAmount()).toString());
        assert.equal('4500000000000000000000', (await xLVX.claimableTokenAmount()).toString());
        assert.equal('5987158034397061298850', (await xLVX.devFund()).toString());

    })

    // Admin Test
    it("Admin setDevFundRatio test", async () => {
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        await timeLock.executeTransaction(xLVX0.address, 0, 'setDevFundRatio(uint256)',
            web3.eth.abi.encodeParameters(['uint256'], [1]), 0)
        assert.equal(1, await xLVX0.devFundRatio());
        await assertThrows(xLVX0.setDevFundRatio(1), 'caller must be admin');
    })

    it("Admin setDexAgg test", async () => {
        let newDexAgg = accounts[3];
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        await timeLock.executeTransaction(xLVX0.address, 0, 'setDexAgg(address)',
            web3.eth.abi.encodeParameters(['address'], [newDexAgg]), 0)
        assert.equal(newDexAgg, await xLVX0.dexAgg());
        await assertThrows(xLVX0.setDexAgg(newDexAgg), 'caller must be admin');
    })

    it("Admin setShareToken test", async () => {
        let shareToken = LVX.address;
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        await timeLock.executeTransaction(xLVX0.address, 0, 'setShareToken(address)',
            web3.eth.abi.encodeParameters(['address'], [shareToken]), 0)
        assert.equal(shareToken, await xLVX0.shareToken());
        await assertThrows(xLVX0.setShareToken(shareToken), 'caller must be admin');

        await LVX.mint(xLVX0.address, toWei(10000));
        await xLVX0.convertToSharingToken(toWei(10000), 0, '0x');
        // Withdraw fund firstly
        await assertThrows(timeLock.executeTransaction(xLVX0.address, 0, 'setShareToken(address)',
            web3.eth.abi.encodeParameters(['address'], [shareToken]), 0), 'Transaction execution reverted');

    })

    it("Admin setLVXLpStakeToken test", async () => {
        let LVXLpStakeToken = LVX.address;
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        await timeLock.executeTransaction(xLVX0.address, 0, 'setLVXLpStakeToken(address)',
            web3.eth.abi.encodeParameters(['address'], [LVXLpStakeToken]), 0)
        assert.equal(LVXLpStakeToken, await xLVX0.LVXLpStakeToken());
        await assertThrows(xLVX0.setLVXLpStakeToken(LVXLpStakeToken), 'caller must be admin');
    })

    it("Admin setLVXLpStakeAutomator test", async () => {
        let LVXLpStakeAutomator = LVX.address;
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        await timeLock.executeTransaction(xLVX0.address, 0, 'setLVXLpStakeAutomator(address)',
            web3.eth.abi.encodeParameters(['address'], [LVXLpStakeAutomator]), 0)
        assert.equal(LVXLpStakeAutomator, await xLVX0.LVXLpStakeAutomator());
        await assertThrows(xLVX0.setLVXLpStakeAutomator(LVXLpStakeAutomator), 'caller must be admin');
    })

    it("Admin withdrawCommunityFund test", async () => {
        let to = accounts[7];
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);

        await assertThrows(xLVX0.withdrawCommunityFund(to), 'caller must be admin');
        let claimableTokenAmount = await xLVX0.claimableTokenAmount();
        assert.equal(0, claimableTokenAmount);
        // to is 0x address
        await assertThrows(timeLock.executeTransaction(xLVX0.address, 0, 'withdrawCommunityFund(address)',
            web3.eth.abi.encodeParameters(['address'], ["0x0000000000000000000000000000000000000000"]), 0, {from: admin}), 'Transaction execution reverted');
        // fund is 0
        await assertThrows(timeLock.executeTransaction(xLVX0.address, 0, 'withdrawCommunityFund(address)',
            web3.eth.abi.encodeParameters(['address'], [to]), 0, {from: admin}), 'Transaction execution reverted');

        await timeLock.executeTransaction(xLVX0.address, 0, 'setShareToken(address)',
            web3.eth.abi.encodeParameters(['address'], [LVX.address]), 0);

        await LVX.mint(xLVX0.address, toWei(10000));
        await xLVX0.convertToSharingToken(toWei(10000), 0, '0x');

        await timeLock.executeTransaction(xLVX0.address, 0, 'withdrawCommunityFund(address)',
            web3.eth.abi.encodeParameters(['address'], [to]), 0, {from: admin});

    })

    it("Admin setDev test", async () => {
        let newDev = accounts[7];
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        await timeLock.executeTransaction(xLVX0.address, 0, 'setDev(address)',
            web3.eth.abi.encodeParameters(['address'], [newDev]), 0)
        assert.equal(newDev, await xLVX0.dev());
        await assertThrows(xLVX0.setDev(newDev), 'caller must be admin');
    })

    it("Admin convertToSharingToken test", async () => {
        await assertThrows(xLVX.convertToSharingToken(toWei(1), 0, daiLVXDexData, {from: accounts[3]}), 'caller must be admin or developer');
    })
    it("Admin setImplementation test", async () => {
        let timeLock = await utils.createTimelock(admin);
        let xLVX0 = await utils.createXLVX(LVX.address, timeLock.address, dev, dexAgg.address, accounts[0]);
        xLVX0 = await XLVXDelegator.at(xLVX0.address);
        let instance = accounts[8];
        await timeLock.executeTransaction(xLVX0.address, 0, 'setImplementation(address)',
            web3.eth.abi.encodeParameters(['address'], [instance]), 0)
        assert.equal(instance, await xLVX0.implementation());
        await assertThrows(xLVX0.setImplementation(instance), 'caller must be admin');
    });
})
