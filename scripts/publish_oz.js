const fs = require('fs');
const chalk = require('chalk');
const contractDir = "./contracts";
const buildDir = "./build/contracts";

//Note: for some reason, npx run is turning this into 'watch' mode, which it shouldn't.

async function main() {
  const publishDir = "../react-app/src/contracts"
  if (!fs.existsSync(publishDir)){
    fs.mkdirSync(publishDir);
  }
  fs.copyFile(buildDir+"/ERC721.json", publishDir+"/ERC721.json", (err) => { console.log(err)});
  console.log("Publishing",chalk.cyan('ERC721'), "to",chalk.yellow(publishDir))
  fs.copyFile(buildDir+"/ArtSteward.json", publishDir+"/ArtSteward.json", (err) => { console.log(err)});
  console.log("Publishing",chalk.cyan('ArtSteward'), "to",chalk.yellow(publishDir))
}
main().then(() => {
  console.log('If this process does not automatically exit, you may do so now.');
  process.exit(0);
}).catch(error => {console.error(error);process.exit(1);});
