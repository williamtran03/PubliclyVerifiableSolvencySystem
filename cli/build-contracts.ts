import {mkdirSync,writeFileSync} from 'node:fs';
import {compileSolidity} from '../testing/evm.ts';
mkdirSync('artifacts/contracts',{recursive:true});
writeFileSync('artifacts/contracts/compiled.json',JSON.stringify(compileSolidity(),null,2));
console.log('Compiled Solidity 0.8.28 / Cancun, with library link references.');
