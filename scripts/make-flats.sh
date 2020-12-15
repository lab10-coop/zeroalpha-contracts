#!/bin/bash

node_modules/.bin/poa-solidity-flattener contracts/ERC721.sol flats/
node_modules/.bin/poa-solidity-flattener contracts/ArtSteward.sol flats/

