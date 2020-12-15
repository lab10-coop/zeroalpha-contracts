const { time, balance } = require('@openzeppelin/test-helpers');

const delay = duration => new Promise(resolve => setTimeout(resolve, duration));
const { expect, use } = require("chai");

const { solidity } = require('ethereum-waffle');
use(solidity);

let ERC721;
let ArtSteward;
let Blocker;
let Blocker2;

const ETH0 = ethers.utils.bigNumberify('0');
const ETH0_1 = ethers.utils.parseEther('0.1');
const ETH1 = ethers.utils.parseEther('1');
const ETH2 = ethers.utils.parseEther('2');
const ETH3 = ethers.utils.parseEther('3');
const ETH4 = ethers.utils.parseEther('4');

let TenMinDue;
let TenMinOneSecDue;

let denominator;

let patronageNumerator;

let initSaleArtistShareNumerator;
let initSalePlatformShareNumerator;

let resaleOwnerShareNumerator;
let resaleArtistShareNumerator;
let resalePlatformShareNumerator;

const year = ethers.utils.bigNumberify('31536000'); // 365 days

let initialPrice;

const nftName = 'ZeroAlpha - noname';
const nftSymbol = 'noname-0α_1';
const tokenId = 42;
const tokenURI = "https://ipfs.io/ipfs/QmV28zA9r4nMFXrqR7tLkertskQP91Y8do9XBtgjjhqLFR";

async function stringTimeLatest() {
  const timeBN = await time.latest();
  return timeBN.toString();
}

async function bigTimeLatest() {
  const STL = await stringTimeLatest();
  return ethers.utils.bigNumberify(STL);
}

function calculateDue(price, initTime, endTime) {
  return price.mul(endTime.sub(initTime)).mul(patronageNumerator).div(denominator).div(year);
}

// does a fuzzy comparison of 2 numerical values (any type which can be converted to BN) with the given precision
function fuzzyEqual(val1, val2, reducePrecisionBy = 2) {
  const val1BN = ethers.utils.bigNumberify(val1.toString());
  const val2BN = ethers.utils.bigNumberify(val2.toString());
  const diff = val1BN.sub(val2BN);
  const reducedPrecisionDiff = diff.div(reducePrecisionBy);
  return reducedPrecisionDiff.eq(0);
}

describe("ZeroAlpha", function() {
  let artwork;
  let steward;
  let blocker;
  let blocker2;
  let provider;
  let signers;
  let accounts;
  let snapshot;
  const gasLimit = 9500000; // if gas limit is set, it doesn't superfluosly run estimateGas, slowing tests down.

  let artist;
  let beneficiary;
  let platform;

  this.beforeAll(async function() {

    provider = new ethers.providers.Web3Provider(web3.currentProvider);
    signers = await ethers.getSigners();
    accounts = await Promise.all(signers.map(async function(signer) {return await signer.getAddress(); }));

    beneficiary = signers[4];
    platform = signers[5];
    artist = signers[6];

    ERC721 = await ethers.getContractFactory("ERC721");
    ArtSteward = await ethers.getContractFactory("ArtSteward");
    Blocker = await ethers.getContractFactory('BlockReceiver');
    Blocker2 = await ethers.getContractFactory('Router');

    artwork = await ERC721.deploy(
        nftName,
        nftSymbol,
        {gasLimit}
        );
    await artwork.deployed();

    steward = await ArtSteward.deploy(
        artwork.address,
        tokenId,
        tokenURI,
        ETH0_1,
        5, // patronagePct
        await artist.getAddress(),
        await beneficiary.getAddress(),
        await platform.getAddress(),
        {gasLimit}
        );
    await steward.deployed();

    denominator = await steward.DENOMINATOR();

    patronageNumerator = await steward.patronageNumerator();
    initSaleArtistShareNumerator = await steward.INITIAL_SALE_ARTIST_SHARE_NUMERATOR();
    initSalePlatformShareNumerator = await steward.INITIAL_SALE_PLATFORM_SHARE_NUMERATOR();
    resaleOwnerShareNumerator = await steward.RESALE_OWNER_SHARE_NUMERATOR();
    resaleArtistShareNumerator = await steward.RESALE_ARTIST_SHARE_NUMERATOR();
    resalePlatformShareNumerator = await steward.RESALE_PLATFORM_SHARE_NUMERATOR();

    initialPrice = await steward.initialPrice();


    TenMinDue = ETH1.mul(patronageNumerator).div(denominator).div(365*24*6);
    TenMinOneSecDue = TenMinDue.add(ETH1.mul(patronageNumerator).div(denominator).div(365*24*3600));

    snapshot = await provider.send('evm_snapshot', []);
  });

  this.beforeEach(async function() {
    // revert to snapshot in order to not break time sensitive calculations
    await provider.send('evm_revert', [snapshot]);
    snapshot = await provider.send('evm_snapshot', []);
  });

  it('steward: expected config', async () => {
    expect(initialPrice).to.equal(ETH0_1);
    expect(denominator.toString()).to.equal('1000000000000');
    expect(patronageNumerator.toString()).to.equal('50000000000');
    expect(initSaleArtistShareNumerator.toString()).to.equal('500000000000');
    expect(initSalePlatformShareNumerator.toString()).to.equal('500000000000');
    expect(resaleOwnerShareNumerator.toString()).to.equal('900000000000');
    expect(resaleArtistShareNumerator.toString()).to.equal('50000000000');
    expect(resalePlatformShareNumerator.toString()).to.equal('50000000000');
  });

  it('NFT: expected config', async () => {
    expect(await steward.artist()).to.equal(await artist.getAddress());
    expect(await steward.beneficiary()).to.equal(await beneficiary.getAddress());
    expect(await steward.platform()).to.equal(await platform.getAddress());
    expect(await artwork.symbol()).to.equal("noname-0α_1");
    expect(steward.address).to.equal(await artwork.ownerOf(tokenId));

    expect(await artwork.name()).to.equal(nftName);
    expect(await artwork.symbol()).to.equal(nftSymbol);
    expect(await artwork.tokenURI(tokenId)).to.equal(tokenURI);
  });

  it('steward: init: deposit wei fail [foreclosed]', async () => {
    await expect(steward.connect(signers[1]).depositWei({value: ethers.utils.parseEther('1')})).to.be.revertedWith('Not patron');
  });

  it('steward: init: change price fail [not patron]', async () => {
    await expect(steward.changePrice(500)).to.be.revertedWith("Not patron");
  });

  it('steward: init: withdraw deposit [not patron]', async () => {
    await expect(steward.withdrawDeposit(10)).to.be.revertedWith("Not patron");
  });

  it('steward: init: buy with zero wei [fail payable]', async () => {
    await expect(steward.buy(1000, ETH0, { value: ethers.utils.parseEther('0') })).to.be.reverted;
  });

  it('steward: init: buy with 1 ether but 0 price [fail on price]', async () => {
    await expect(steward.buy(0, initialPrice, { value: ethers.utils.parseEther('1')})).to.be.revertedWith("Price is zero");
  });

  it('steward: init: buy with 2 ether, price of 1 success [price = 1 eth, deposit = 1 eth]', async () => {
    const artistBalTrack = await balance.tracker(await artist.getAddress());
    const platformBalTrack = await balance.tracker(await platform.getAddress());

    await expect(steward.connect(signers[2]).buy(ethers.utils.parseEther('1'), initialPrice, { value: ethers.utils.parseEther('1') }))
      .to.emit(steward, 'Buy')
      .withArgs(accounts[2], ethers.utils.parseEther('1'));

    expect(await steward.deposit()).to.equal(ethers.utils.parseEther('1').sub(initialPrice));
    expect(await steward.price()).to.equal(ethers.utils.parseEther('1'));
    expect(await steward.pullFunds(accounts[2])).to.equal(ETH0);

    // artist: share of the initial-sale price
    const artistExpAmount = (initialPrice.mul(initSaleArtistShareNumerator).div(denominator));
    const deltaArtist = await artistBalTrack.delta();
    expect(deltaArtist.toString()).to.equal(artistExpAmount.toString());

    // platform: share of the initial-sale price
    const platformExpAmount = (initialPrice.mul(initSalePlatformShareNumerator).div(denominator));
    const delta = await platformBalTrack.delta();
    expect(delta.toString()).to.equal(platformExpAmount.toString());
  });

  it('steward+blocker: withdraw pull funds fail', async() => {
    blocker = await Blocker.deploy(steward.address, {gasLimit});
    await blocker.deployed();
    await blocker.buyFor1ETH(ETH0, {value: ETH1, gasLimit});
    await expect(blocker.withdrawPullFunds({gasLimit}))
      .to.be
      .reverted; // couldn't receive back funds due to blocking
  });

  it('steward+blocker: buy with blocker then buy from another account', async() => {
    blocker = await Blocker.deploy(steward.address, {gasLimit});
    await blocker.deployed();

    // blocker will buy at price of 1 ETH (0 in contract)
    // thus: deposit should be ETH1.
    await blocker.buyFor1ETH(initialPrice, {value: ETH1.add(initialPrice), gasLimit});

    const currentOwner = await artwork.ownerOf(tokenId);
    const currentDeposit = await steward.deposit();
    expect(currentOwner).to.equal(blocker.address);
    expect(currentDeposit).to.equal(ETH1);

    const platformBalTrack = await balance.tracker(await platform.getAddress());

    // new buyer buys with 2 ETH, with price at 1 ETH.
    // thus: 2-1 = deposit should be 1 ETH.
    await steward.connect(signers[2]).buy(ETH1, ETH1, {value: ETH2, gasLimit});

    const finalOwner = await artwork.ownerOf(tokenId);
    const deposit = await steward.deposit();
    const pullFunds = await steward.pullFunds(blocker.address);

    const oneSecDue = calculateDue(ETH1, ethers.utils.bigNumberify('0'), ethers.utils.bigNumberify('1'));

    expect(finalOwner).to.equal(accounts[2]);
    expect(deposit).to.equal(ETH1);

    // owner: ~ 1 ETH of unconsumed deposit + its share of the price
    const ownerExpAmount = ETH1.sub(oneSecDue).add(ETH1.mul(resaleOwnerShareNumerator).div(denominator));
    expect(pullFunds).to.equal(ownerExpAmount);

    // platform: share of the price
    const platformExpAmount = ETH1.mul(resalePlatformShareNumerator).div(denominator);
    const delta = await platformBalTrack.delta();
    expect(delta.toString()).to.equal(platformExpAmount);
  });

  it('steward+blocker: failed to receive funds. correct it. receive withdrawpullfunds', async() => {
    blocker = await Blocker2.deploy(steward.address, {gasLimit});
    await blocker.deployed();
    await blocker.buyFor1ETH(initialPrice, {value: ETH1.add(initialPrice), gasLimit});

    const platformBalTrack = await balance.tracker(await platform.getAddress());

    await steward.connect(signers[2]).buy(ETH1, ETH1, {value: ETH2, gasLimit}); // new buyer

    const deposit = await steward.deposit();
    const pullFunds = await steward.pullFunds(blocker.address);
    const oneSecDue = calculateDue(ETH1, ethers.utils.bigNumberify('0'), ethers.utils.bigNumberify('1'));
    expect(deposit).to.equal(ETH1);

    // ~ 1 ETH of unconsumed deposit + its share of the price
    const ownerAmount = ETH1.sub(oneSecDue).add(ETH1.mul(resaleOwnerShareNumerator).div(denominator));
    expect(pullFunds).to.equal(ownerAmount);

    // platform: share of the price
    const platformExpAmount = ETH1.mul(resalePlatformShareNumerator).div(denominator);
    const delta = await platformBalTrack.delta();
    expect(delta.toString()).to.equal(platformExpAmount);

    await expect(blocker.withdrawPullFunds({gasLimit}))
      .to.be
      .revertedWith('blocked'); // couldn't receive back funds due to blocking

    await blocker.setBlock(false);

    expect(await blocker.toBlock()).to.equal(false);

    await blocker.withdrawPullFunds({gasLimit});

    const b = await balance.current(blocker.address);
    expect(b.toString()).to.equal(pullFunds.toString());
  });

  it('steward+blocker: double pull funds additions', async() => {
    // owner1: blocker - initialPrice -> ETH1
    // owner2: signers[2] - ETH1 -> ETH2
    // owner3: blocker - ETH2 -> ETH1
    // owner4: signers[2] - ETH1 -> ETH1

    owner2 = signers[2];

    blocker = await Blocker.deploy(steward.address, {gasLimit});
    await blocker.deployed();

    const artistBalTrack = await balance.tracker(await artist.getAddress());
    const platformBalTrack = await balance.tracker(await platform.getAddress());

    await blocker.buyFor1ETH(initialPrice, {value: ETH1.add(initialPrice), gasLimit});

    const artistAmount1 = initialPrice.mul(initSaleArtistShareNumerator).div(denominator);
    expect((await artistBalTrack.delta()).toString()).to.equal(artistAmount1);
    const platformAmount1 = initialPrice.mul(initSalePlatformShareNumerator).div(denominator);
    expect((await platformBalTrack.delta()).toString()).to.equal(platformAmount1);

    // 1 second should pass
    // new buyer buys with 2 ETH with old price at 1 ETH.
    // thus: 2-1 = deposit should be 1 ETH.
    await steward.connect(owner2).buy(ETH2, ETH1, {value: ETH2, gasLimit});

    const artistAmount2 = ETH1.mul(resaleArtistShareNumerator).div(denominator);
    expect((await artistBalTrack.delta()).toString()).to.equal(artistAmount2);
    const platformAmount2 = ETH1.mul(resalePlatformShareNumerator).div(denominator);
    expect((await platformBalTrack.delta()).toString()).to.equal(platformAmount2);

    const owner2BalTrack = await balance.tracker(await owner2.getAddress());

    // new buyer buys with 3 ETH, with old price at 2 ETH.
    // thus: 3-2 = deposit should be 1 ETH.
    await blocker.buyFor1ETH(ETH2, {value: ETH3, gasLimit});

    const artistAmount3 = ETH2.mul(resaleArtistShareNumerator).div(denominator);
    expect((await artistBalTrack.delta()).toString()).to.equal(artistAmount3);
    const platformAmount3 = ETH2.mul(resalePlatformShareNumerator).div(denominator);
    expect((await platformBalTrack.delta()).toString()).to.equal(platformAmount3);
    // 1 ETH deposit - oneSecDue(2 ETH) + owner resale share of 2 ETH
    const oneSecDue2ETH = calculateDue(ETH2, ethers.utils.bigNumberify('0'), ethers.utils.bigNumberify('1'));
    const owner2ExpDelta = ETH1.sub(oneSecDue2ETH).add(ETH2.mul(resaleOwnerShareNumerator).div(denominator));
    expect((await owner2BalTrack.delta()).toString()).to.equal(owner2ExpDelta);

    // 1 second should pass
    // new buyer buys with 2 ETH, with old price at 1 ETH.
    // thus: 2-1 = deposit should be 1 ETH.
    await steward.connect(owner2).buy(ETH1, ETH1, {value: ETH2, gasLimit});

    const artistAmount4 = ETH1.mul(resaleArtistShareNumerator).div(denominator);
    expect((await artistBalTrack.delta()).toString()).to.equal(artistAmount4);
    const platformAmount4 = ETH1.mul(resalePlatformShareNumerator).div(denominator);
    expect((await platformBalTrack.delta()).toString()).to.equal(platformAmount4);

    const pullFunds = await steward.pullFunds(blocker.address);
    // because it was bought TWICE from the blocker
    const oneSecDue = calculateDue(ETH1, ethers.utils.bigNumberify('0'), ethers.utils.bigNumberify('1'));
    const twoSecDue = oneSecDue.add(oneSecDue); // due to rounding, it needs to be separate as the contract does collections, twice

    // 1st buy: 1 ETH DEPOSIT.
    // 1st sale: pullFunds = 1 ETH - oneSecDue + 1 ETH owner share.
    // 2nd buy: 1 ETH old price. 1 ETH new price. 2 ETH value (1 ETH DEPOSIT).
    // 2nd sale: pullFunds = funds of 1st sale + 1 ETH - oneSecDue + 1 ETH owner share.
    const blockerOwnerAmount = (ETH1.sub(oneSecDue).add(ETH1.mul(resaleOwnerShareNumerator).div(denominator))).mul(2);
    expect(pullFunds).to.equal(blockerOwnerAmount);
  });

  /*
  it('steward: owned. re-sale at price below initial price (fail)', async () => {
    await expect(artwork.connect(signers[2]).transferFrom(accounts[2], accounts[1], tokenId, {gasLimit})).to.be.revertedWith('ERC721: transfer caller is not steward.');

    owner2 = signers[2];

    blocker = await Blocker.deploy(steward.address, {gasLimit});
    await blocker.deployed();

    await blocker.buyFor1ETH(initialPrice, {value: ETH1.add(initialPrice), gasLimit});

    // 1 second should pass
    // new buyer buys with price set below initial price - should revert
    await expect(steward.connect(owner2).buy(initialPrice.sub(1), ETH1, {value: ETH1, gasLimit})).to.be.revertedWith('Price is too low');

  });
   */

  it('steward: owned. transfer without steward (fail)', async () => {
    await expect(artwork.connect(signers[2]).transferFrom(accounts[2], accounts[1], tokenId, {gasLimit})).to.be.revertedWith('ERC721: transfer caller is not steward.');
  });

  it('steward: owned. check patronage owed after 1 second.', async () => {
    await steward.buy(ETH1, initialPrice, { value: ETH1, gasLimit });

    const timeLastCollected = await steward.timeLastCollected();
    await time.increase(1);
    const owed = await steward.patronageOwedWithTimestamp();

    // price * (now - timeLastCollected) * patronageNumerator/ patronageDenominator / 365 days;
    const due = ETH1.mul(owed.timestamp.sub(timeLastCollected)).mul(patronageNumerator).div(denominator).div(year);

    expect(owed.patronageDue).to.equal(due);
  });


  it('steward: owned. check patronage owed after 1 year.', async () => {
    await steward.buy(ETH1, initialPrice, { value: ETH1, gasLimit });

    const timeLastCollected = await steward.timeLastCollected();
    await time.increase(time.duration.days(365));
    const owed = await steward.patronageOwedWithTimestamp();

    // price * (now - timeLastCollected) * patronageNumerator/ patronageDenominator / 365 days;
    const due = ETH1.mul(owed.timestamp.sub(timeLastCollected)).mul(patronageNumerator).div(denominator).div(year);

    expect(owed.patronageDue).to.equal(due);
    //expect(owed.patronageDue).to.equal('1000000000000000000'); // 100% over 365 days. //todo: change rate
  });

  it('steward: owned. buy with incorrect current price [fail].', async () => {
    await expect(steward.buy(ETH1, ETH1, { value: ETH1, gasLimit }))
      .to.be
      .revertedWith('Current Price incorrect');
  });

  it('steward: owned. collect patronage successfully after 10 minutes.', async () => {
    await steward.buy(ETH1, initialPrice, { value: ETH1.add(initialPrice), gasLimit });

    const preTime = await bigTimeLatest();

    const preDeposit = await steward.deposit();
    await time.increase(time.duration.minutes(10));

    const owed = await steward.patronageOwedWithTimestamp();
    await steward.collectPatronageAndForecloseIfNecessary({ gasLimit });
    const latestTime = await bigTimeLatest();

    const deposit = await steward.deposit();
    const beneficiaryFund = await steward.pullFunds(await beneficiary.getAddress());
    const timeLastCollected = await steward.timeLastCollected();
    const currentCollected =  await steward.currentCollected();
    const totalCollected =  await steward.totalCollected();

    const due = preDeposit.mul(latestTime.sub(preTime)).mul(patronageNumerator).div(denominator).div(year);

    const calcDeposit = ETH1.sub(due);
    expect(deposit).to.equal(calcDeposit);
    expect(beneficiaryFund).to.equal(due);
    expect(timeLastCollected).to.equal(latestTime);
    expect(currentCollected).to.equal(due);
    expect(totalCollected).to.equal(due);
  });


  it('steward: owned. collect patronage successfully after 10min and again after 10min.', async () => {
    await steward.buy(ETH1, initialPrice, { value: ETH1, gasLimit });

    const preTime1 = await bigTimeLatest();

    await time.increase(time.duration.minutes(10));
    await steward.collectPatronageAndForecloseIfNecessary({gasLimit});

    const postTime1 = await bigTimeLatest();
    const d1 = calculateDue(ETH1, preTime1, postTime1);

    await time.increase(time.duration.minutes(10));
    await steward.collectPatronageAndForecloseIfNecessary({gasLimit});

    const postTime2 = await bigTimeLatest();
    const d2 = calculateDue(ETH1, postTime1, postTime2);

    const deposit = await steward.deposit();
    const beneficiaryFund = await steward.pullFunds(await beneficiary.getAddress());
    const timeLastCollected = await steward.timeLastCollected();
    const currentCollected =  await steward.currentCollected();
    const totalCollected =  await steward.totalCollected();

    const due = d1.add(d2);
    const calcDeposit = ETH1.sub(initialPrice).sub(due);

    expect(deposit).to.equal(calcDeposit);
    expect(beneficiaryFund).to.equal(due);
    expect(timeLastCollected).to.equal(postTime2);
    expect(totalCollected).to.equal(due);
  });


  it('steward: owned. collect patronage that forecloses precisely after 10min.', async () => {
    // 10min+1 of patronage
    const initDeposit = TenMinOneSecDue; // wei
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: initialPrice.add(initDeposit), gasLimit });
    const preTime = await bigTimeLatest();
    await time.increase(time.duration.minutes(10));
    await expect(steward.collectPatronageAndForecloseIfNecessary({gasLimit}))
      .to.emit(steward, 'Foreclosure')
      .withArgs(accounts[2]); // will foreclose

    const deposit = await steward.deposit();
    const beneficiaryFund = await steward.pullFunds(await beneficiary.getAddress());
    const timeLastCollected = await steward.timeLastCollected();
    const currentCollected =  await steward.currentCollected();
    const totalCollected =  await steward.totalCollected();
    const price = await steward.price();

    const latestTime = await bigTimeLatest();
    const due = calculateDue(ETH1, preTime, latestTime);

    const currentOwner = await artwork.ownerOf(tokenId);

    const timeHeld = await steward.timeHeld(accounts[2]);

    const tenMinOneSec = time.duration.minutes(10).add(time.duration.seconds(1));

    expect(fuzzyEqual(timeHeld, tenMinOneSec, 2));
    expect(currentOwner).to.equal(steward.address);
    expect(deposit).to.equal(ETH0);
    expect(fuzzyEqual(beneficiaryFund, due));
    expect(fuzzyEqual(timeLastCollected, latestTime));
    expect(currentCollected).to.equal(ETH0);
    expect(fuzzyEqual(totalCollected, due));
    expect(price).to.equal(initialPrice);
  });


  it('steward: owned. Deposit zero after 10min of patronage (after 10min) [success].', async () => {
    // 10min of patronage
    const initDeposit = ethers.utils.bigNumberify('951293759512'); // wei
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: initDeposit.add(initialPrice), gasLimit });

    await time.increase(time.duration.minutes(10));
    const deposit = await steward.deposit();
    const availableToWithdraw = await steward.depositAbleToWithdraw();

    expect(deposit.toString()).to.equal(initDeposit.toString());
    expect(availableToWithdraw.toString()).to.equal('0')
  });


  it('steward: owned. Foreclose Time is 10min into future on 10min patronage deposit [success].', async () => {
    // 10min of patronage
    const initDeposit = TenMinDue; // wei
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: initDeposit.add(initialPrice), gasLimit });

    const forecloseTime = await steward.foreclosureTime();
    const previousBlockTime = await time.latest();
    const finalTime = previousBlockTime.add(time.duration.minutes(10));
    expect(forecloseTime.toString()).to.equal(finalTime.toString());
  });


  it('steward: owned. buy from person that forecloses precisely after 10min.', async () => {
    // 10min+1 of patronage
    const initDeposit = TenMinOneSecDue; // wei
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: initDeposit.add(initialPrice), gasLimit });

    const preTime = await bigTimeLatest();

    await time.increase(time.duration.minutes(10));

    const preTimeBought = await steward.timeAcquired();

    await expect(steward.connect(signers[3]).buy(ethers.utils.parseEther('2'), initialPrice, { value: initDeposit.add(initialPrice), gasLimit }))
    .to.emit(steward, 'Foreclosure')
    .withArgs(accounts[2])
    .and.to.emit(steward, 'Buy')
    .withArgs(accounts[3], ethers.utils.parseEther('2')); // will foreclose + buy

    const deposit = await steward.deposit();
    const beneficiaryFund = await steward.pullFunds(await beneficiary.getAddress());
    const timeLastCollected = await steward.timeLastCollected();
    const latestTime = await time.latest();
    const latestTimeBR = await bigTimeLatest();
    const currentCollected =  await steward.currentCollected();
    const totalCollected =  await steward.totalCollected();
    const price = await steward.price();

    const due = calculateDue(ETH1, preTime, latestTimeBR);

    const currentOwner = await artwork.ownerOf(tokenId);

    const timeHeld = await steward.timeHeld(accounts[2]);
    const calcTH = timeLastCollected.sub(preTimeBought);

    expect(fuzzyEqual(timeHeld, calcTH));
    expect(currentOwner).to.equal(accounts[3]);
    expect(deposit).to.equal(initDeposit);
    expect(fuzzyEqual(beneficiaryFund, due));
    expect(timeLastCollected).to.equal(latestTimeBR);
    expect(currentCollected.toString()).to.equal('0');
    expect(fuzzyEqual(totalCollected, due));
    expect(price).to.equal(ETH2); //owned by 3
  });

  it('steward: owned. collect funds by beneficiary after 10min.', async () => {
    // 10min+1of patronage
    const totalToBuy = TenMinOneSecDue;
    await steward.connect(signers[2]).buy(ETH1, initialPrice, {value: totalToBuy.add(initialPrice), gasLimit });
    await time.increase(time.duration.minutes(10));
    await steward.collectPatronageAndForecloseIfNecessary(); // will foreclose

    const balTrack = await balance.tracker(await beneficiary.getAddress());

    const tx = await steward.connect(beneficiary).withdrawPullFunds({ gasPrice: ethers.utils.bigNumberify('1000000000'), gasLimit }); // 1 gwei gas
    const txReceipt = await provider.getTransactionReceipt(tx.hash);
    const txCost = ethers.utils.bigNumberify(txReceipt.gasUsed).mul(ethers.utils.bigNumberify('1000000000')); // gas used * gas price
    const calcDiff = totalToBuy.sub(txCost); // should receive

    const beneficiaryFund = await steward.pullFunds(await beneficiary.getAddress());

    expect(beneficiaryFund.toString()).to.equal('0');
    const delta = await balTrack.delta();
    expect(delta.toString()).to.equal(calcDiff.toString());
  });


  it('steward: owned. collect patronage. 10min deposit. 20min Foreclose.', async () => {
    // 10min+1sec of patronage
    const totalToBuy = TenMinOneSecDue;
    await steward.connect(signers[2]).buy(ETH1, initialPrice, {value: totalToBuy.add(initialPrice), gasLimit });

    const preTime = await bigTimeLatest();
    await time.increase(time.duration.minutes(20));
    // 20min owed patronage
    // 10min due
    const preForeclosed = await steward.foreclosed();
    const preTLC = await steward.timeLastCollected();
    const preDeposit = await steward.deposit();
    const preTimeBought = await steward.timeAcquired();
    const preForeclosureTime = await steward.foreclosureTime();
    await steward.collectPatronageAndForecloseIfNecessary(); // will foreclose

    const postCollectionTime = await bigTimeLatest();

    // based on what was supposed to be due (10min+1), not 20min
    const due = calculateDue(ETH1, preTime, preTime.add(ethers.utils.bigNumberify('601'))); // 10m + 1 sec

    // collection, however, will be 20min (foreclosure happened AFTER deposit defacto ran out)
    const collection = calculateDue(ETH1, preTime, postCollectionTime);

    const deposit = await steward.deposit();
    const beneficiaryFund = await steward.pullFunds(await beneficiary.getAddress());
    const timeLastCollected = await steward.timeLastCollected();

    // timeLastCollected = timeLastCollected.add(((now.sub(timeLastCollected)).mul(deposit).div(collection)));
    // Collection will > deposit based on 20min.
    const tlcCheck = preTLC.add((postCollectionTime.sub(preTLC)).mul(preDeposit).div(collection));
    const currentCollected =  await steward.currentCollected();
    const totalCollected =  await steward.totalCollected();
    const price = await steward.price();

    const currentOwner = await artwork.ownerOf(tokenId);

    const timeHeld = await steward.timeHeld(accounts[2]);
    const calcTH = timeLastCollected.sub(preTimeBought);

    expect(preForeclosed.toString()).to.equal('true');
    expect(steward.address).to.equal(currentOwner);
    expect(timeHeld.toString()).to.equal(calcTH.toString());
    expect(deposit.toString()).to.equal('0');
    expect(fuzzyEqual(beneficiaryFund, due));
    expect(timeLastCollected.toString()).to.equal(tlcCheck.toString());
    expect(preForeclosureTime.toString()).to.equal(timeLastCollected.toString());
    expect(currentCollected.toString()).to.equal('0');
    expect(fuzzyEqual(totalCollected, due));
    expect(price).to.equal(initialPrice);
  });


  it('steward: owned. deposit wei fail from not patron', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2 , gasLimit });
    await expect(steward.connect(signers[3]).depositWei({value: ETH2, gasLimit}))
      .to.be
      .revertedWith('Not patron');
  });


  it('steward: owned. change price to zero [fail]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await expect(steward.connect(signers[2]).changePrice(0, {gasLimit})).to.be.revertedWith("Price is zero");
  });

  it('steward: owned. change price to more [success]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await expect(steward.connect(signers[2]).changePrice(ETH3, {gasLimit})).
      to.emit(steward, 'PriceChange')
      .withArgs(ETH3);
    const postPrice = await steward.price();
    expect(ETH3).to.equal(postPrice);
  });

  it('steward: owned. change price to less [success]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await steward.connect(signers[2]).changePrice(ethers.utils.parseEther('0.5'), { gasLimit});
    const postPrice = await steward.price();
    expect(ethers.utils.parseEther('0.5')).to.equal(postPrice);
  });

  it('steward: owned. change price to less with another account [fail]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await expect(steward.connect(signers[3]).changePrice(ETH2, {gasLimit})).to.be.revertedWith("Not patron");
  });

  it('steward: owned. change initial price with unauthorized sender [fail]', async () => {
    await expect(steward.connect(signers[2]).changeInitialPrice(ETH1)).to.be.revertedWith("Not artist");
  });

  it('steward: owned. change initial price to 0 while steward owned', async () => {
    await steward.connect(artist).changeInitialPrice(ETH0);
    const newInitialPrice = await steward.initialPrice();
    expect(newInitialPrice).to.equal(ETH0);

    await steward.buy(ETH1, ETH0, { value: ETH1, gasLimit });

    const timeLastCollected = await steward.timeLastCollected();
    await time.increase(1);
    const owed = await steward.patronageOwedWithTimestamp();

    // price * (now - timeLastCollected) * patronageNumerator/ patronageDenominator / 365 days;
    const due = ETH1.mul(owed.timestamp.sub(timeLastCollected)).mul(patronageNumerator).div(denominator).div(year);

    expect(owed.patronageDue).to.equal(due);
  });

  it('steward: owned. change initial price to 0 while not steward owned', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });

    await steward.connect(artist).changeInitialPrice(ETH0);
    const newInitialPrice = await steward.initialPrice();
    expect(newInitialPrice).to.equal(ETH0);

    await steward.connect(signers[2]).buy(ETH1, ETH1, { value: ETH2, gasLimit });
  });

  it('steward: owned. withdraw whole deposit into foreclosure [succeed]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    const deposit = await steward.deposit();
    const collected = calculateDue(ETH1, ethers.utils.bigNumberify('0'), ethers.utils.bigNumberify('1')); // 1 second of patronage is collected when issuing the tx
    await steward.connect(signers[2]).withdrawDeposit(deposit.sub(collected), {gasLimit});
    const price = await steward.price();
    expect(price).to.equal(initialPrice);
  });


  it('steward: owned. withdraw whole deposit through exit into foreclosure after 10min [succeed]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await time.increase(time.duration.minutes(10));
    await steward.connect(signers[2]).exit({gasLimit});
    const price = await steward.price();
    expect(price).to.equal(initialPrice);
  });


  it('steward: owned. withdraw some deposit [succeeds]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2.add(initialPrice), gasLimit });
    await steward.connect(signers[2]).withdrawDeposit(ETH1, {gasLimit});
    const deposit = await steward.deposit();
    const collected = calculateDue(ETH1, ethers.utils.bigNumberify('0'), ethers.utils.bigNumberify('1')); // 1 second of patronage is collected when issuing the tx
    expect(deposit).to.equal(ETH2.sub(ETH1).sub(collected));
  });


  it('steward: owned. withdraw more than exists [fail]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await expect(steward.connect(signers[2]).withdrawDeposit(ETH3, {gasLimit}))
      .to.be.revertedWith("Withdrawing too much");
  });

  it('steward: owned. withdraw some deposit from another account [fails]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await expect(steward.connect(signers[3]).withdrawDeposit(ETH1, {gasLimit}))
      .to.be.revertedWith("Not patron");
  });


  it('steward: bought once, bought again from same account [success]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await steward.connect(signers[2]).buy(ETH1, ETH1, { value: ETH2, gasLimit });
    const deposit2 = await steward.deposit();
    const price2 = await steward.price();
    const currentOwner2 = await artwork.ownerOf(tokenId);
    const cc = await steward.currentCollected();
    expect(deposit2).to.equal(ETH1);
    expect(price2).to.equal(ETH1);
    expect(cc.toString()).to.equal('0');
    expect(currentOwner2).to.equal(accounts[2]);
  });


  it('steward: bought once, bought again from another account [success]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });
    await steward.connect(signers[3]).buy(ETH1, ETH1, { value: ETH2, gasLimit });
    const deposit2 = await steward.deposit();
    const price2 = await steward.price();
    const currentOwner2 = await artwork.ownerOf(tokenId);
    expect(deposit2).to.equal(ETH1);
    expect(price2).to.equal(ETH1);
    expect(currentOwner2).to.equal(accounts[3]);
  });


  it('steward: bought once, bought again from another account after 10min [success]', async () => {
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: ETH2, gasLimit });

    await time.increase(time.duration.minutes(10));

    const balTrack = await balance.tracker(accounts[2]);
    const preBuy = await balTrack.get();
    const preDeposit = await steward.deposit();
    await steward.connect(signers[3]).buy(ETH1, ETH1, { value: ETH2, gasLimit, gasPrice: ethers.utils.bigNumberify('1000000000') });

    // deposit - due + 1 (from sale)
    const calcDiff = preDeposit.sub(TenMinOneSecDue).add(ETH1);

    const delta = await balTrack.delta();
    expect(fuzzyEqual(delta, calcDiff));
    const deposit2 = await steward.deposit();
    const price2 = await steward.price();
    const currentOwner2 = await artwork.ownerOf(tokenId);
    expect(deposit2).to.equal(ETH1);
    expect(price2).to.equal(ETH1);
    expect(currentOwner2).to.equal(accounts[3]);
  });


  it('steward: owned: deposit wei, change price, withdrawing deposit in foreclosure state [fail]', async() => {
    // 10min of patronage
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: TenMinOneSecDue.add(initialPrice), gasLimit });
    await time.increase(time.duration.minutes(20)); // into foreclosure state

    await expect(steward.connect(signers[2]).depositWei({value: ETH1, gasLimit}))
      .to.be.revertedWith("Not patron");

    await expect(steward.connect(signers[2]).changePrice(ETH2, {gasLimit}))
      .to.be.revertedWith("Not patron");

    await expect(steward.connect(signers[2]).withdrawDeposit(ETH1, {gasLimit}))
      .to.be.revertedWith("Not patron");
  });


  it('steward: owned: goes into foreclosure state & bought from another account [success]', async() => {
    // 10min of patronage
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: TenMinOneSecDue.add(initialPrice), gasLimit });
    await time.increase(time.duration.minutes(20)); // into foreclosure state

    // price should be zero, thus totalToBuy should primarily going into the deposit [as if from init]
    await steward.connect(signers[3]).buy(ETH2, initialPrice, { value: TenMinOneSecDue.add(initialPrice), gasLimit });

    const deposit = await steward.deposit();
    const totalCollected = await steward.totalCollected();
    const currentCollected = await steward.currentCollected();
    const previousBlockTime = await bigTimeLatest();
    const timeLastCollected = await steward.timeLastCollected(); // on buy.
    const price = await steward.price();
    const owner = await artwork.ownerOf(tokenId);
    const wasPatron1 = await steward.patrons(accounts[2]);
    const wasPatron2 = await steward.patrons(accounts[3]);

    expect(deposit).to.equal(TenMinOneSecDue);
    expect(price).to.equal(ETH2);
    expect(totalCollected).to.equal(TenMinOneSecDue);
    expect(currentCollected.toString()).to.equal('0');
    expect(timeLastCollected).to.equal(previousBlockTime);
    expect(owner).to.equal(accounts[3]);
    expect(wasPatron1).to.equal(true);
    expect(wasPatron2).to.equal(true);
  });


  it('steward: owned: goes into foreclosure state & bought from same account [success]', async() => {
    // 10min of patronage
    await steward.connect(signers[2]).buy(ETH1, initialPrice, { value: TenMinOneSecDue.add(initialPrice), gasLimit });
    await time.increase(time.duration.minutes(20)); // into foreclosure state

    // price should be zero, thus totalToBuy should primarily going into the deposit [as if from init]
    await steward.connect(signers[2]).buy(ETH2, initialPrice, { value: TenMinOneSecDue.add(initialPrice), gasLimit });

    const deposit = await steward.deposit();
    const totalCollected = await steward.totalCollected();
    const currentCollected = await steward.currentCollected();
    const previousBlockTime = await bigTimeLatest();
    const timeLastCollected = await steward.timeLastCollected(); // on buy.
    const price = await steward.price();
    const owner = await artwork.ownerOf(tokenId);

    expect(deposit).to.equal(TenMinOneSecDue);
    expect(price).to.equal(ETH2);
    expect(totalCollected).to.equal(TenMinOneSecDue);
    expect(currentCollected.toString()).to.equal('0');
    expect(timeLastCollected).to.equal(previousBlockTime);
    expect(owner).to.equal(accounts[2]);
  });

  it('steward: init timeHeld is zero', async() => {
    const th = await steward.timeHeld(steward.address);

    expect(th.toString()).to.equal('0');
  });

  it('steward: init. foreClosureTime is zero, 1970,', async() => {
    const ft = await steward.foreclosureTime();
    expect(ft.toString()).to.equal('0');
  });

  it('steward: let artist change its account address', async() =>  {
    await expect(steward.connect(signers[2]).changeArtistTo(accounts[2])).to.be.reverted;
    await steward.connect(artist).changeArtistTo(accounts[2]);
    expect(await steward.artist()).to.equal(accounts[2]);
    // and back
    await steward.connect(signers[2]).changeArtistTo(await artist.getAddress());
    expect(await steward.artist()).to.equal(await artist.getAddress());
  });

  it('steward: let beneficiary change its account address', async() =>  {
    await expect(steward.connect(signers[2]).changeBeneficiaryTo(accounts[2])).to.be.reverted;
    await steward.connect(beneficiary).changeBeneficiaryTo(accounts[2]);
    expect(await steward.beneficiary()).to.equal(accounts[2]);
    // and back
    await steward.connect(signers[2]).changeBeneficiaryTo(await beneficiary.getAddress());
    expect(await steward.beneficiary()).to.equal(await beneficiary.getAddress());
  });

  it('steward: let platform change its account address', async() =>  {
    await expect(steward.connect(signers[2]).changePlatformTo(accounts[2])).to.be.reverted;
    await steward.connect(platform).changePlatformTo(accounts[2]);
    expect(await steward.platform()).to.equal(accounts[2]);
    // and back
    await steward.connect(signers[2]).changePlatformTo(await platform.getAddress());
    expect(await steward.platform()).to.equal(await platform.getAddress());
  });
});