const HDWalletProvider = require('@truffle/hdwallet-provider');
const mnemonic = process.env.MNEMONIC; // only used in development
const privKey = process.env.PRIVKEY;
const infuraID = process.env.INFURA_ID; // same here, but needs to be transferred to production build too

const mnemonicOrPrivkey = mnemonic ? mnemonic : [privKey];

module.exports = {
  networks: {
    development: {
      protocol: 'http',
      host: 'localhost',
      port: 8545,
      gas: 5000000,
      gasPrice: 5e9,
      networkId: '*',
    },
    mainnet: {
      provider: () => new HDWalletProvider(
        mnemonicOrPrivkey, `https://mainnet.infura.io/v3/${infuraID}`, 3
      ),
      networkId: 1,
      gasPrice: 50e9,
    },
    artis_tau1: {
      provider: () => new HDWalletProvider(
        mnemonicOrPrivkey, 'http://rpc.tau1.artis.network', 0
      ),
      networkId: 246785,
      gasPrice: 1000000000,
    },
    xdaichain: {
      provider: () => new HDWalletProvider(
          mnemonicOrPrivkey, 'https://rpc.gnosischain.com/', 0
      ),
      networkId: 100,
      gasPrice: 1000000000,
    },
  },
};
