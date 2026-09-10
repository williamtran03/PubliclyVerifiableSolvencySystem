import {readFileSync,writeFileSync} from 'node:fs';
const abi=JSON.parse(readFileSync('out/MinimumSolvencyRegistry.sol/MinimumSolvencyRegistry.json','utf8')).abi;
writeFileSync('frontend/src/minimumAbi.ts','// Generated from MinimumSolvencyRegistry; run npm run abi after contract changes.\nexport const minimumAbi = '+JSON.stringify(abi,null,2)+' as const;\n');
