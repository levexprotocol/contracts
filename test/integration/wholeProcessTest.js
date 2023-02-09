const {toBN, maxUint} = require("../utils/EtheUtil");
const utils = require("../utils/LevexUtil");
const m = require('mocha-logger');


const LevexV1 = artifacts.require("LevexDelegator");
const LPool = artifacts.require("LPool");
const MockERC20 = artifacts.require("MockERC20");
const Controller = artifacts.require("ControllerDelegator");
const XLVX = artifacts.require("XLVXDelegator");

let network;
contract("Levex integration test ", async accounts => {

    before(async () => {
        network = process.env.NETWORK
    });
    it("trade test", async () => {
        if (network != 'integrationTest') {
            consLVX.log("Ignore swap test")
            return;
        }

        consLVX.log("starting....");
        let marketId = 7;
        let developer = accounts[0];
        let Levex = await LevexV1.at(LevexV1.address);
        let controller = await Controller.at(Controller.address);
        let treasury = await XLVX.at(XLVX.address);
        let markets = await Levex.markets(marketId);
        let pool0 = await LPool.at(markets.pool0);
        let pool1 = await LPool.at(markets.pool1);
        //
        let token0 = await MockERC20.at(await pool0.underlying());
        let token1 = await MockERC20.at(await pool1.underlying());
        //
        m.log("Levex=", Levex.address);
        m.log("controller=", controller.address);
        m.log("treasury=", treasury.address);
        m.log("pool0=", pool0.address);
        m.log("pool1=", pool1.address);
        m.log("token0=", token0.address);
        m.log("token1=", token1.address);
        token0.mint(accounts[0], await utils.toWei(1000));
        token1.mint(accounts[0], await utils.toWei(1000));
        let uniV2 = "0x01";
        /**
         * lpool supply
         */
        // let rewardStartByBorrow = await controller.earned(pool1.address, developer, true);
        // let rewardStartBySupply = await controller.earned(pool1.address, developer, false);

        utils.resetStep();
        utils.step("lpool supply");
        await token1.approve(pool1.address, maxUint());
        let pool1BalanceBeforeSupply = await token1.balanceOf(pool1.address);
        m.log("pool1BalanceBeforeSupply=", pool1BalanceBeforeSupply.toString());
        let supplyAmount = await utils.toWei(10);
        await pool1.mint(supplyAmount);
        let pool1BalanceAfterSupply = await token1.balanceOf(pool1.address);
        m.log("pool1BalanceAfterSupply=", pool1BalanceAfterSupply.toString());
        assert.equal(pool1BalanceAfterSupply.sub(pool1BalanceBeforeSupply).toString(), supplyAmount.toString());
        m.log("update price...");
        await Levex.updatePrice(marketId, uniV2);

        utils.step("Levex open margin trade 1");
        let deposit = await utils.toWei(10);
        let borrow = await utils.toWei(2);
        await token0.approve(Levex.address, maxUint());
        await token1.approve(Levex.address, maxUint());

        await Levex.marginTrade(marketId, false, false, deposit, borrow, 0, uniV2);
        let activeTrade1 = await Levex.activeTrades(developer, marketId, false);
        m.log("open trades1=", JSON.stringify(activeTrade1));
        /**
         * Levex open margin trade 2
         */
        utils.step("Levex open margin trade 2");
        await Levex.marginTrade(marketId, false, false, deposit, borrow, 0, uniV2);
        let activeTrade2 = await Levex.activeTrades(developer, marketId, false);
        m.log("open trades1=", JSON.stringify(activeTrade2));
        // let rewardAfterByBorrow = await controller.earned(pool1.address, developer, true);
        /**
         * Levex close margin trade half
         */
        utils.step("Levex close margin trade half");
        let borrowsBeforeClose = await pool1.borrowBalanceStored(developer);
        let treasuryBeforeClose = await token0.balanceOf(treasury.address);
        await Levex.closeTrade(marketId, false, toBN(activeTrade2[1]).div(toBN(2)), 0, uniV2);
        let closeTrade = await Levex.activeTrades(developer, marketId, false);
        m.log("close trades=", JSON.stringify(closeTrade));
        let borrowsAfterClose = await pool1.borrowBalanceStored(developer);
        let treasuryAfterClose = await token0.balanceOf(treasury.address);
        m.log("borrowsBeforeClose=", borrowsBeforeClose.toString());
        m.log("borrowsAfterClose=", borrowsAfterClose.toString());
        m.log("treasuryBeforeClose=", treasuryBeforeClose.toString());
        m.log("treasuryAfterClose=", treasuryAfterClose.toString());

        utils.step("checking borrows and treasury after closed...");
        assert.equal(toBN(borrowsBeforeClose).cmp(toBN(borrowsAfterClose)) > 0, true);
        assert.equal(toBN(treasuryAfterClose).cmp(toBN(treasuryBeforeClose)) > 0, true);

        /**
         * supply & lender LVX reward
         */
        // let rewardAfterBySupply = await controller.earned(pool1.address, developer, false);
        //
        // m.log("rewardStartByBorrow=", rewardStartByBorrow.toString());
        // m.log("rewardAfterByBorrow=", rewardAfterByBorrow.toString());
        // m.log("rewardStartBySupply=", rewardStartBySupply.toString());
        // m.log("rewardAfterBySupply=", rewardAfterBySupply.toString());

        // utils.step("checking borrow & supply LVX rewards...");
        // assert.equal(toBN(rewardAfterByBorrow).cmp(toBN(rewardStartByBorrow)) > 0, true);
        // assert.equal(toBN(rewardAfterBySupply).cmp(toBN(rewardStartBySupply)) > 0, true);

        utils.step("ending...");

    })
})
