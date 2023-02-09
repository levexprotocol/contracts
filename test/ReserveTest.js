const Reserve = artifacts.require("Reserve");
const LVXToken = artifacts.require("LVXToken");
const {toWei, assertThrows, Uni3DexData} = require("./utils/LevexUtil");

contract("Reserve", async accounts => {

    // rLVXs
    let admin = accounts[0];
    let user = accounts[2];

    it("Transfer test", async () => {
        let LVXToken = await LVXToken.new(admin, admin, "Open Leverage Token", "LVX");
        await LVXToken.mint(admin, toWei(100));
        let reserve = await Reserve.new(admin, LVXToken.address);
        LVXToken.transfer(reserve.address, toWei(100), {from: admin});
        await reserve.transfer(user, toWei(10), {from: admin});
        assert.equal(toWei(10).toString(), await LVXToken.balanceOf(user));
        assert.equal(toWei(90).toString(), await LVXToken.balanceOf(reserve.address));
        await assertThrows(reserve.transfer(user, toWei(10), {from: user}), 'caller must be admin');

    })

})
