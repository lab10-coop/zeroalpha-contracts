## ZeroAlpha

_ZeroAlpha_ is based on _This Artwork is Always On Sale_ (see below) which can be found at https://github.com/simondlr/thisartworkisalwaysonsale.

Changes:
* artist can set and update the _initial price_ (the price at which the artwort can be bought from the steward contract)
* when the artwork goes back to the artist (e.g. due to foreclosure caused by missed patronage payment), automatically reset to the _initial price_ set by the artist
* initial sale (transfer of ownership from the steward contract to a buyer): 50% artist, 50% platform
* re-sale: 90% owner, 5% artist, 5% platform
* patronage: 5% pa to a predefined beneficiary
* Removal of UI component. The zeroalpha UI was developed from scratch and is nomore bundled in this repo

### contracts

Initialize:
```
yarn install
yarn run add_contracts
```

Test:
* console 1: `yarn run node`
* console 2: `yarn run test_contracts`

Deploy:
* `MNEMONIC="..." yarn run deploy_contracts` or `PRIVKEY="..." yarn run deploy_contracts` (if deploying to a network using infura RPC, also set the env var `INFURA_ID`)
* provide the information requested by the interactive process 

### TODO

When the artwork is in implicit foreclosed state, the NFT still shows the previous owner and the contract still returns the previous price.
In order to show the correct owner before explicit foreclosure, the NFT contract would need to do a lookup into the steward contract when checking ownership.  
UIs can however show the correct state without this change by implementing some more logic themselves.
