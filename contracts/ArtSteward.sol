// SPDX-License-Identifier: MIT

pragma solidity ^0.6.12;
import "./interfaces/IERC721.sol";
import "./utils/SafeMath.sol";
import "./interfaces/IERC20.sol";

/*
    This smart contract collects patronage from the current owner through a Harberger tax model and
    takes stewardship of the artwork if the patron can't pay anymore (foreclosure).

    Harberger Tax (COST):
    - Artwork is always on sale.
    - Owner sets the price when buying.
    - Tax (Patronage) is paid to maintain ownership.
    - Steward maintains control over ERC721.
*/

// What changed for ZeroAlpha (Dec 2020)
// - introduction of an artist adjustable "initial price" which is to be paid in order to buy the artwort from the steward
// - introduction of "platform" who gets a share of the sale prices
// - introduction of a "beneficiary" who gets the patronage
// - payment for initial sales (buying from steward) is split between artist and platform
// - payment for sales from one owner to another is split between previous owner, artist and platform
// - NFT id and URI set through this contract on setup()
// - artist, beneficiary and platform can change their adddress (e.g. in order to switch to a multisig account)
//
// What changed for V2 (June 2020 update):
// - Medium Severity Fixes:
// - Added a check on buy to prevent front-running. Needs to give currentPrice when buying.
// - Removed ability for someone to block buying through revert on ETH send. Funds get sent to a pull location.
// - Added patron check on depositWei. Since anyone can send, it can be front-run, stealing a deposit by buying before deposit clears.
// - Other Minor Changes:
// - Added past foreclosureTime() if it happened in the past.
// - Moved patron modifier checks to AFTER patronage. Thus, not necessary to have steward state anymore.
// - Removed steward state. Only check on price now. If price = zero = foreclosed.
// - Removed paid mapping. Wasn't used.
// - Moved constructor to a function in case this is used with upgradeable contracts.
// - Changed currentCollected into a view function rather than tracking variable. This fixed a bug where CC would keep growing in between ownerships.
// - Kept the numerator/denominator code (for reference), but removed to save gas costs for 100% patronage rate.

// - Changes for UI:
// - Need to have additional current price when buying.
// - foreclosureTime() will now backdate if past foreclose time.

contract ArtSteward {
    using SafeMath for uint256;

    uint256 public price; // current price of the artwort in wei
    IERC721 public artwork; // the ERC721 NFT
    uint256 public tokenId; // tokenId of the artwork (there's only 1)

    // percentage patronage rate. eg 5% or 100%
    // granular to an additional 10 zeroes.
    uint256 public patronageNumerator;

    // price at which the artwork can be bought from the steward contract
    uint256 public initialPrice;

    address payable public artist;
    // receiver of the patronage
    address payable public beneficiary;

    address payable public platform;

    uint256 public INITIAL_SALE_ARTIST_SHARE_NUMERATOR = 500000000000; // 50%
    uint256 public INITIAL_SALE_PLATFORM_SHARE_NUMERATOR = 500000000000; // 50%

    uint256 public RESALE_OWNER_SHARE_NUMERATOR = 900000000000; // 90%
    uint256 public RESALE_ARTIST_SHARE_NUMERATOR = 50000000000; // 5%
    uint256 public RESALE_PLATFORM_SHARE_NUMERATOR = 50000000000; // 5%

    uint256 public totalCollected; // all patronage ever collected

    /* In the event that a foreclosure happens AFTER it should have been foreclosed already,
    this variable is backdated to when it should've occurred. Thus: timeHeld is accurate to actual deposit. */
    uint256 public timeLastCollected; // timestamp when last collection occurred
    uint256 public deposit; // amount of funds still in deposit for ongoing patronage payment

    /*
    If for whatever reason (e.g. gas constraints) an outgoing transfer of ETH fails,
    receiver and owed amount are persisted here in order to allow later withdrawal */
    mapping (address => uint256) public pullFunds;
    mapping (address => bool) public patrons; // list of all patrons who ever owned the artwork
    mapping (address => uint256) public timeHeld; // time held by a particular patron

    uint256 public timeAcquired; // timestamp of last sale

    // used for sufficiently precise calculations of shares
    uint256 public constant DENOMINATOR = 1000000000000;

    constructor(
        address _artwork,
        uint256 _tokenId,
        string memory _tokenURI,
        uint256 _initialPrice,
        uint256 _patronagePct,
        address payable _artist,
        address payable _beneficiary,
        address payable _platform)
    public {
        // sanity checks
        assert(INITIAL_SALE_PLATFORM_SHARE_NUMERATOR + INITIAL_SALE_PLATFORM_SHARE_NUMERATOR == DENOMINATOR);
        assert(RESALE_OWNER_SHARE_NUMERATOR + RESALE_ARTIST_SHARE_NUMERATOR + RESALE_PLATFORM_SHARE_NUMERATOR == DENOMINATOR);

        initialPrice = _initialPrice;
        artist = _artist;
        beneficiary = _beneficiary;
        platform = _platform;

        // 0% patronage may also work, but is untested
        require(_patronagePct > 0 && _patronagePct <= 100, "invalid patronage");
        patronageNumerator = _patronagePct * DENOMINATOR / 100;

        artwork = IERC721(_artwork);
        artwork.setup(_tokenId, _tokenURI);
        tokenId = _tokenId;

        transferArtworkTo(address(this), initialPrice);
    }

    event Buy(address indexed owner, uint256 price);
    event PriceChange(uint256 newPrice);
    event InitialPriceChange(uint256 newInitialPrice);
    event Foreclosure(address indexed prevOwner);
    event PatronageCollected(uint256 amount, address indexed beneficiary);

    event ArtistChanged(address newArtist);
    event BeneficiaryChanged(address newBeneficiary);
    event PlatformChanged(address newPlatform);

    modifier onlyPatron() {
        require(msg.sender == currentOwner(), "Not patron");
        _;
    }

    modifier onlyArtist() {
        require(msg.sender == artist, "Not artist");
        _;
    }

    /*
    * This modifier is added to most state changing methods.
    * It collects owed patronage and forecloses in case of insufficient deposit.
    * Be aware that when used together with other modifiers, the order is important.
    */
    modifier collectPatronage() {
       collectPatronageAndForecloseIfNecessary();
       _;
    }

    // ================== public view functions ==================

    function currentOwner() public view returns (address) {
        return artwork.ownerOf(tokenId);
    }

    // patronage owed since last collected
    function patronageOwed() public view returns (uint256) {
        return price.mul(now.sub(timeLastCollected)).mul(patronageNumerator).div(DENOMINATOR).div(365 days);
    }

    /* not used internally in external actions */
    function patronageOwedRange(uint256 _time) public view returns (uint256) {
        return price.mul(_time).mul(patronageNumerator).div(DENOMINATOR).div(365 days);
    }

    // patronage collected so far from the current owner since she last bought the artwork
    // TODO: is this method useful? Should probably be removed or renamed.
    function currentCollected() public view returns (uint256) {
        if(timeLastCollected > timeAcquired) {
            return patronageOwedRange(timeLastCollected.sub(timeAcquired));
        } else { return 0; }
    }

    function patronageOwedWithTimestamp() public view returns (uint256 patronageDue, uint256 timestamp) {
        return (patronageOwed(), now);
    }

    // @return true if the artwork is in foreclosed state because of empty deposit
    // TODO: shouldn't this also return true after the implied foreclosure was executed?
    function foreclosed() public view returns (bool) {
        return depositAbleToWithdraw() == 0;
    }

    // amount of unconsumed deposit the owner could withdraw right now
    function depositAbleToWithdraw() public view returns (uint256) {
        uint256 collection = patronageOwed();
        if(collection >= deposit) {
            return 0;
        } else {
            return deposit.sub(collection);
        }
    }

    // returns the projected timestamp of foreclosure in case price and deposit don't change
    function foreclosureTime() public view returns (uint256) {
        // patronage per second
        uint256 pps = price.mul(patronageNumerator).div(DENOMINATOR).div(365 days);
        uint256 daw = depositAbleToWithdraw();
        if(daw > 0) {
            return now + depositAbleToWithdraw().div(pps);
        } else if (pps > 0) {
            // it is still active, but in foreclosure state
            // it is NOW or was in the past
            uint256 collection = patronageOwed();
            return timeLastCollected.add(((now.sub(timeLastCollected)).mul(deposit).div(collection)));
        } else {
            // not active and actively foreclosed (price is zero)
            return timeLastCollected; // it has been foreclosed or in foreclosure.
        }
    }

    // ================== public state changing functions ==================

    /*
    * subtract the patronage currently owed from the deposit, update related state, foreclose if necessary
    * can be triggered by anybody because it's basically just an update of the contract state
    * to what is already determined by time based formulas and previous state.
    */
    function collectPatronageAndForecloseIfNecessary() public {
        if (currentOwner() != address(this)) { //  == active owned state
            uint256 collectAmount = patronageOwed();

            if (collectAmount >= deposit) { // we are in foreclosure state
                // up to when was it actually paid for?
                // TLC + (time_elapsed)*deposit/collection
                timeLastCollected = timeLastCollected.add((now.sub(timeLastCollected)).mul(deposit).div(collectAmount));
                collectAmount = deposit; // take what's left.
            } else { // normal collection
                timeLastCollected = now;
            }

            deposit = deposit.sub(collectAmount);
            totalCollected = totalCollected.add(collectAmount);
            pullFunds[beneficiary] = pullFunds[beneficiary].add(collectAmount);
            emit PatronageCollected(collectAmount, beneficiary);

            if(deposit == 0) {
                _foreclose();
            }
        }
    }

    /*
    * buys the artwork from the current owner (can be the steward).
    * The initial deposit amount is the difference between the ETH amount sent with this call and the _newPrice given.
    */
    function buy(uint256 _newPrice, uint256 _currentPrice) public payable collectPatronage {
        /*
            The check of _currentPrice is protection against a front-run attack.
            the person will only buy the artwork if it is what they agreed to.
            thus: someone can't buy it from under them and change the price, eating into their deposit.
        */
        require(price == _currentPrice, "Current Price incorrect");
        require(_newPrice > 0, "Price is zero");
        //require(_newPrice >= initialPrice, "Price is too low"); // we decided not to enforce this
        require(msg.value > price, "Not enough"); // >, coz need to have at least something for deposit

        address oldOwner = currentOwner();
        bool initialSale = oldOwner == address(this);
        uint256 curOwnerAmount = 0;
        uint256 artistAmount = 0;
        uint256 platformAmount = 0;

        if(initialSale) {
            // the initial sale price is split betweeen artist and platform
            artistAmount = price.mul(INITIAL_SALE_ARTIST_SHARE_NUMERATOR).div(DENOMINATOR);
            platformAmount = price.mul(INITIAL_SALE_PLATFORM_SHARE_NUMERATOR).div(DENOMINATOR);
            // the sum of those may be smaller due to rounding artifacts, but never larger
            assert(artistAmount + platformAmount <= price);
        } else {
            // the resale price is split between current owner, artist and platform
            uint256 curOwnerPartAmount = price.mul(RESALE_OWNER_SHARE_NUMERATOR).div(DENOMINATOR);
            artistAmount = price.mul(RESALE_ARTIST_SHARE_NUMERATOR).div(DENOMINATOR);
            platformAmount = price.mul(RESALE_PLATFORM_SHARE_NUMERATOR).div(DENOMINATOR);
            // the sum of those may be smaller due to rounding artifacts, but never larger
            assert(curOwnerPartAmount + artistAmount + platformAmount <= price);
            curOwnerAmount = curOwnerPartAmount.add(deposit);
        }

        // new purchase -> reset this timestamp to now
        timeLastCollected = now;

        deposit = msg.value.sub(price);
        transferArtworkTo(msg.sender, _newPrice);
        emit Buy(msg.sender, _newPrice);

        // finally, make payouts - keep track of owed amounts if send() fails
        if(curOwnerAmount > 0 && !(address(uint160(oldOwner))).send(curOwnerAmount)) {
            pullFunds[oldOwner] = pullFunds[oldOwner].add(curOwnerAmount);
        }
        if(artistAmount > 0 && !artist.send(artistAmount)) {
            pullFunds[artist] = pullFunds[artist].add(artistAmount);
        }
        if(platformAmount > 0 && !platform.send(platformAmount)) {
            pullFunds[platform] = pullFunds[platform].add(platformAmount);
        }
    }

    // ================== Permissioned functions ==================

    /// add deposits for patronage payments
    function depositWei() public payable collectPatronage onlyPatron {
        deposit = deposit.add(msg.value);
    }

    /*
    * Change the price of the artwork.
    * This will also adjust the patronage due from now on.
    */
    function changePrice(uint256 _newPrice) public collectPatronage onlyPatron {
        require(_newPrice > 0, 'Price is zero');
        price = _newPrice;
        emit PriceChange(price);
    }

    function withdrawDeposit(uint256 _wei) public collectPatronage onlyPatron {
        _withdrawDeposit(_wei);
    }

    function exit() public collectPatronage onlyPatron {
        _withdrawDeposit(deposit);
    }

    // change the price at which the artwork can be bought from the steward (first sale or after foreclosure)
    function changeInitialPrice(uint256 _newInitialPrice) public onlyArtist {
        initialPrice = _newInitialPrice;
        if(currentOwner() == address(this)) {
            price = initialPrice;
        }
        emit InitialPriceChange(initialPrice);
    }

    // allows to withdraw funds owed to the tx sender
    function withdrawPullFunds() public {
        require(pullFunds[msg.sender] > 0, "No pull funds available.");
        uint256 toSend = pullFunds[msg.sender];
        pullFunds[msg.sender] = 0;
        msg.sender.transfer(toSend);
    }

    // receive function as easily accessible method for pulling funds owed to the tx sender
    // basically it's abused as a reverse receive :-)
    receive () external payable {
        require(msg.value == 0, "amount non-zero");
        withdrawPullFunds();
    }

    // allow privileged accounts to update themselves to a different address (e.g. for switching to a multisig account)

    function changeArtistTo(address payable _newArtistAddr) external {
        require(msg.sender == artist);
        artist = _newArtistAddr;
        emit ArtistChanged(_newArtistAddr);
    }

    function changeBeneficiaryTo(address payable _newBeneficiaryAddr) external {
        require(msg.sender == beneficiary);
        beneficiary = _newBeneficiaryAddr;
        emit BeneficiaryChanged(_newBeneficiaryAddr);
    }

    function changePlatformTo(address payable _newPlatformAddr) external {
        require(msg.sender == platform);
        platform = _newPlatformAddr;
        emit PlatformChanged(_newPlatformAddr);
    }

    // allow withdrawal of tokens sent to this contract
    function withdrawLostERC20Tokens(IERC20 token, address receiver) external {
        // the platform guys are probably best suited to withdraw tokens landing here by mistake
        require(msg.sender == platform, "none of your business");
        require(token.balanceOf(address(this)) > 0, "balance 0");
        token.transfer(receiver, token.balanceOf(address(this)));
    }

    /* ================== internal functions ==================  */

    function _withdrawDeposit(uint256 _withdrawAmount) internal {
        // note: can withdraw whole deposit, which puts it in immediate to be foreclosed state.
        require(deposit >= _withdrawAmount, 'Withdrawing too much');
        deposit = deposit.sub(_withdrawAmount);
        if(deposit == 0) {
            _foreclose();
        }
        msg.sender.transfer(_withdrawAmount); // msg.sender == patron
    }

    // transfers ownership of the artwork to the steward
    function _foreclose() internal {
        emit Foreclosure(currentOwner());
        transferArtworkTo(address(this), initialPrice);
    }

    function transferArtworkTo(address _newOwner, uint256 _newPrice) internal {
        // note: it would also tabulate time held in stewardship by smart contract
        timeHeld[currentOwner()] = timeHeld[currentOwner()].add((timeLastCollected.sub(timeAcquired)));

        artwork.transferFrom(currentOwner(), _newOwner, tokenId);

        price = _newPrice;
        timeAcquired = now;
        patrons[_newOwner] = true;
    }
}