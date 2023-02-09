const utils = require("./utils/LevexUtil");
const m = require('mocha-logger');
const LPool = artifacts.require("LPool");
const {advanceBlockAndSetTime, toBN} = require("./utils/EtheUtil");
const timeMachine = require('ganache-time-traveler');
const {mint, Uni3DexData, assertThrows} = require("./utils/LevexUtil");
const Controller = artifacts.require('ControllerV1');
const ControllerDelegator = artifacts.require('ControllerDelegator');


contract("ControllerV1", async accounts => {
    let admin = accounts[0];
    it("create lpool pair succeed test", async () => {
        let {controller, tokenA, tokenB} = await instanceController();
        let transaction = await createMarket(controller, tokenA, tokenB);
        let token0 = transaction.logs[0].args.token0;
        let token1 = transaction.logs[0].args.token1;
        let pool0 = transaction.logs[0].args.pool0;
        let pool1 = transaction.logs[0].args.pool1;
        m.log("created pool pair toke0,token1,pool0,poo1", token0, token1, pool0, pool1);
        let lpoolPairs = await controller.lpoolPairs(token0, token1);
        assert.equal(lpoolPairs.lpool0, pool0);
        assert.equal(lpoolPairs.lpool1, pool1);
        let pool0Ctr = await LPool.at(pool0);
        let pool1Ctr = await LPool.at(pool1);
        assert.equal(token0, await pool0Ctr.underlying());
        assert.equal(token1, await pool1Ctr.underlying());

        assert.equal("LToken", await pool0Ctr.symbol());
        assert.equal("LToken", await pool1Ctr.symbol());

        m.log("pool0 token name:", await pool0Ctr.name());
        m.log("pool1 token name:", await pool1Ctr.name());
        m.log("pool0 token symbol:", await pool0Ctr.symbol());
        m.log("pool1 token symbol:", await pool1Ctr.symbol());

    });

    it("create lpool pair failed with same token test", async () => {
        let {controller, tokenA, tokenB} = await instanceController();
        await assertThrows(createMarket(controller, tokenA, tokenA), 'identical address');
    });

    it("create lpool pair failed with pool exists test", async () => {
        let {controller, tokenA, tokenB} = await instanceController();
        await createMarket(controller, tokenA, tokenB);
        await assertThrows(createMarket(controller, tokenA, tokenB), 'pool pair exists');
    });

    it("MarginTrade Suspend test", async () => {
        let {controller, tokenA, tokenB, Levex} = await instanceController();
        let transaction = await createMarket(controller, tokenA, tokenB);
        let pool0 = transaction.logs[0].args.pool0;
        //supply
        let pool0Ctr = await LPool.at(pool0);
        let token0Ctr = await utils.tokenAt(await pool0Ctr.underlying());
        await token0Ctr.mint(accounts[0], utils.toWei(10));
        await token0Ctr.approve(pool0, utils.toWei(10));
        await pool0Ctr.mint(utils.toWei(5));
        await token0Ctr.approve(Levex.address, utils.toWei(10));
        await controller.setSuspend(true);
        await assertThrows(Levex.marginTrade(0, true, false, utils.toWei(1), utils.toWei(1), 0, Uni3DexData), 'Suspended');

    });

    it("CloseTrade Suspend test", async () => {
        let {controller, tokenA, tokenB, Levex} = await instanceController();
        let transaction = await createMarket(controller, tokenA, tokenB);
        let pool0 = transaction.logs[0].args.pool0;
        //supply
        let pool0Ctr = await LPool.at(pool0);
        let token0Ctr = await utils.tokenAt(await pool0Ctr.underlying());
        await token0Ctr.mint(accounts[0], utils.toWei(10));
        await token0Ctr.approve(pool0, utils.toWei(10));
        await pool0Ctr.mint(utils.toWei(5));
        await token0Ctr.approve(Levex.address, utils.toWei(10));
        Levex.marginTrade(0, true, false, utils.toWei(1), utils.toWei(1), 0, Uni3DexData)
        await controller.setSuspendAll(true);
        await assertThrows(Levex.closeTrade(0, true, 1, 0, Uni3DexData), 'Suspended');
    });

    /*** Admin Test ***/

    it("Admin setLPoolImplementation test", async () => {
        let poolAddr = (await utils.createLPoolImpl()).address;
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setLPoolImplementation(address)', web3.eth.abi.encodeParameters(['address'], [poolAddr]), 0)
        assert.equal(poolAddr, await controller.lpoolImplementation());
        await assertThrows(controller.setLPoolImplementation(poolAddr), 'caller must be admin');
    });

    it("Admin setLevex test", async () => {
        let address = (await utils.createToken("tokenA")).address;
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setLevex(address)', web3.eth.abi.encodeParameters(['address'], [address]), 0);
        assert.equal(address, await controller.Levex());
        await assertThrows(controller.setLevex(address), 'caller must be admin');
    });
    it("Admin setInterestParam test", async () => {
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setInterestParam(uint256,uint256,uint256,uint256)',
            web3.eth.abi.encodeParameters(['uint256', 'uint256', 'uint256', 'uint256'], [1, 2, 3, 4]), 0)
        assert.equal(1, await controller.baseRatePerBlock());
        assert.equal(2, await controller.multiplierPerBlock());
        assert.equal(3, await controller.jumpMultiplierPerBlock());
        assert.equal(4, await controller.kink());
        await assertThrows(controller.setInterestParam(1, 2, 3, 4), 'caller must be admin');
    });

    it("Admin setLPoolUnAllowed test", async () => {
        let address = (await utils.createToken("tokenA")).address;
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setLPoolUnAllowed(address,bool)', web3.eth.abi.encodeParameters(['address', 'bool'], [address, true]), 0);
        assert.equal(true, (await controller.lpoolUnAlloweds(address)), {from: accounts[2]});
        await assertThrows(controller.setLPoolUnAllowed(address, true, {from: accounts[2]}), 'caller must be admin or developer');
    });

    it("Admin setSuspend test", async () => {
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setSuspend(bool)', web3.eth.abi.encodeParameters(['bool'], [true]), 0);
        assert.equal(true, (await controller.suspend()));
        await assertThrows(controller.setSuspend(false, {from: accounts[2]}), 'caller must be admin or developer');
    });
    it("Admin setMarketSuspend test", async () => {
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setMarketSuspend(uint256,bool)', web3.eth.abi.encodeParameters(['uint256', 'bool'], [1, true]), 0);
        assert.equal(true, (await controller.marketSuspend(1)), {from: accounts[2]});
        await assertThrows(controller.setMarketSuspend(1, true, {from: accounts[2]}), 'caller must be admin or developer');
    });

    it("Admin setLVXWethDexData test", async () => {
        let {controller, timeLock} = await instanceSimpleController();
        await timeLock.executeTransaction(controller.address, 0, 'setLVXWethDexData(bytes)', web3.eth.abi.encodeParameters(['bytes'], ["0x03"]), 0);
        assert.equal("0x03", (await controller.LVXWethDexData()), {from: accounts[2]});
        await assertThrows(controller.setLVXWethDexData("0x03", {from: accounts[2]}), 'caller must be admin or developer');

    });




    it("Admin setImplementation test", async () => {
        let instance = await Controller.new();
        let {controller, timeLock} = await instanceSimpleController();
        controller = await ControllerDelegator.at(controller.address);
        await timeLock.executeTransaction(controller.address, 0, 'setImplementation(address)',
            web3.eth.abi.encodeParameters(['address'], [instance.address]), 0)
        assert.equal(instance.address, await controller.implementation());
        await assertThrows(controller.setImplementation(instance.address), 'caller must be admin');
    });

    async function createMarket(controller, token0, token1) {
        return await controller.createLPoolPair(token0.address, token1.address, 3000, Uni3DexData);
    }

    async function instanceSimpleController() {
        let timeLock = await utils.createTimelock(admin);
        let LVXToken = await utils.createToken("LVX");
        let controller = await utils.createController(timeLock.address, LVXToken.address);
        return {
            timeLock: timeLock,
            controller: controller,
            LVXToken: LVXToken,
        };
    }

    async function instanceController(timelock, createXLVX) {
        let tokenA = await utils.createToken("tokenA");
        let tokenB = await utils.createToken("tokenB");
        let LVXToken = await utils.createToken("LVX");
        let xLVX;
        if (createXLVX) {
            xLVX = await utils.createToken("XLVX");
        }
        let weth = await utils.createWETH();

        let controller = await utils.createController(timelock ? timelock : admin, LVXToken.address, weth.address, xLVX ? xLVX.address : "0x0000000000000000000000000000000000000000");

        let uniswapFactoryV3 = await utils.createUniswapV3Factory();
        let uniswapFactoryV2 = await utils.createUniswapV2Factory();
        await utils.createUniswapV2Pool(uniswapFactoryV2, weth, LVXToken);
        gotPair = await utils.createUniswapV3Pool(uniswapFactoryV3, tokenA, tokenB, accounts[0]);
        await utils.createUniswapV3Pool(uniswapFactoryV3, weth, LVXToken, accounts[0]);
        let dexAgg = await utils.createEthDexAgg(uniswapFactoryV2.address, uniswapFactoryV3.address, accounts[0]);

        m.log("LVXToken.address " + LVXToken.address);
        let xLVX = await utils.createXLVX(LVXToken.address, admin, accounts[9], dexAgg.address);
        let Levex = await utils.createLevex(controller.address, admin, dexAgg.address, xLVX.address, [tokenA.address, tokenB.address]);

        await controller.setLevex(Levex.address);
        await controller.setDexAggregator(dexAgg.address);
        await controller.setLPoolImplementation((await utils.createLPoolImpl()).address);
        await controller.setInterestParam(toBN(5e16).div(toBN(2102400)), toBN(10e16).div(toBN(2102400)), toBN(20e16).div(toBN(2102400)), 50e16 + '');
        await dexAgg.setLevex(Levex.address);
        return {
            controller: controller,
            tokenA: tokenA,
            tokenB: tokenB,
            LVXToken: LVXToken,
            pair: gotPair,
            Levex: Levex,
            xLVX: xLVX
        };
    }
})
