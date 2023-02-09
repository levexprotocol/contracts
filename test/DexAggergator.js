const utils = require("./utils/LevexUtil");
const {assertThrows} = require("./utils/LevexUtil");


contract("DexAggregator", async accounts => {
    let add0 = "0x0000000000000000000000000000000000000000";
    let add1 = "0x0000000000000000000000000000000000000001";
    let admin = accounts[0];
    beforeEach(async () => {

    });

    it("Admin setLevex test ", async () => {
        let bscDexAgg = await utils.createBscDexAgg(add0, add0, admin);
        await assertThrows(bscDexAgg.setLevex(add0, {from: accounts[1]}), 'caller must be admin');
        await bscDexAgg.setLevex(add1, {from: admin})
        assert.equal(add1, await bscDexAgg.Levex());
        let ethDexAgg = await utils.createEthDexAgg(add0, add0, admin);
        await assertThrows(ethDexAgg.setLevex(add0, {from: accounts[1]}), 'caller must be admin');
        await ethDexAgg.setLevex(add1, {from: admin})
        assert.equal(add1, await ethDexAgg.Levex());
    })
    it("Admin setDexInfo test", async () => {
        let bscDexAgg = await utils.createBscDexAgg(add0, add0, admin);
        await assertThrows(bscDexAgg.setDexInfo([1], [add1], [25], {from: accounts[1]}), 'caller must be admin');
        await bscDexAgg.setDexInfo([1], [add1], [25], {from: admin})
        assert.equal(add1, (await bscDexAgg.dexInfo(1)).factory);
        assert.equal(25, (await bscDexAgg.dexInfo(1)).fees);

        let ethDexAgg = await utils.createEthDexAgg(add0, add0, admin);
        await assertThrows(ethDexAgg.setDexInfo([1], [add1], [25], {from: accounts[1]}), 'caller must be admin');
        await ethDexAgg.setDexInfo([1], [add1], [25], {from: admin})
        assert.equal(add1, (await ethDexAgg.dexInfo(1)).factory);
        assert.equal(25, (await ethDexAgg.dexInfo(1)).fees);
    })
});
