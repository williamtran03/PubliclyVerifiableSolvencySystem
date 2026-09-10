// Generated from MinimumSolvencyRegistry; run npm run abi after contract changes.
export const minimumAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "company_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "auditor_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "capacity_",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "maxAge_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "DOMAIN_SEPARATOR",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "USD_SCALE",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "addAsset",
    "inputs": [
      {
        "name": "token",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "reserve",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "feed",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nativeAsset",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addLiability",
    "inputs": [
      {
        "name": "input",
        "type": "tuple",
        "internalType": "struct MinimumSolvencyRegistry.SnapshotInput",
        "components": [
          {
            "name": "id",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "rootHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "totalLiabilitiesUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rateManifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "snapshotTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "snapshotBlock",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "identities",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "rates",
        "type": "tuple[]",
        "internalType": "struct SnapshotOracle.Rate[]",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feed",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "oracleDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "rate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "roundId",
            "type": "uint80",
            "internalType": "uint80"
          },
          {
            "name": "updatedAt",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "approveAsset",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "assetCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "auditor",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "capacity",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "company",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "computeRoot",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "identities",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentClaim",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct MinimumSolvencyRegistry.Claim",
        "components": [
          {
            "name": "snapshotId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "rootHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "totalLiabilitiesUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalEligibleAssetsUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "surplus",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rateManifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "snapshotTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "snapshotBlock",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "submittedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liabilityVerifiedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "finalizedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifiedBy",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "finalized",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "currentClaimId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "finalizeClaim",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getAsset",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct AuditedAssets.Asset",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "reserve",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feed",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "nativeAsset",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "ownershipVerified",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum AuditedAssets.Status"
          },
          {
            "name": "removalPending",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "proposedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifiedAt",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getClaim",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct MinimumSolvencyRegistry.Claim",
        "components": [
          {
            "name": "snapshotId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "rootHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "totalLiabilitiesUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "totalEligibleAssetsUsd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "surplus",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rateManifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "snapshotTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "snapshotBlock",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "submittedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "liabilityVerifiedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "finalizedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifiedBy",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "finalized",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getClaimAssets",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct MinimumSolvencyRegistry.Observation[]",
        "components": [
          {
            "name": "assetId",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rawAmount",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "usd",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rateIndex",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifiedAt",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getClaimProposal",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct MinimumSolvencyRegistry.ClaimProposal",
        "components": [
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "decided",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "submittedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "assetIds",
            "type": "uint256[]",
            "internalType": "uint256[]"
          },
          {
            "name": "rawAmounts",
            "type": "uint256[]",
            "internalType": "uint256[]"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getLiability",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct MinimumSolvencyRegistry.Liability",
        "components": [
          {
            "name": "rootHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "rootSum",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "rateManifestHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "snapshotTime",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "snapshotBlock",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "submittedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifiedAt",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "verifiedBy",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum AuditedAssets.Status"
          },
          {
            "name": "removalPending",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getRates",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple[]",
        "internalType": "struct SnapshotOracle.Rate[]",
        "components": [
          {
            "name": "token",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "feed",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "tokenDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "oracleDecimals",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "rate",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "roundId",
            "type": "uint80",
            "internalType": "uint80"
          },
          {
            "name": "updatedAt",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "maxOracleAge",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "ownershipDigest",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeClaim",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "assetIds",
        "type": "uint256[]",
        "internalType": "uint256[]"
      },
      {
        "name": "rawAmounts",
        "type": "uint256[]",
        "internalType": "uint256[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "removeAsset",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "removeLiability",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "snapshotCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "snapshotIds",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyAddLiability",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifyAsset",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "expiry",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifyRemoveAsset",
    "inputs": [
      {
        "name": "id",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "verifyRemoveLiability",
    "inputs": [
      {
        "name": "id",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "approved",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "AssetProposed",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "token",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "reserve",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "feed",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AssetRemovalRequested",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AssetRemovalVerified",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AssetVerified",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "auditor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ClaimFinalized",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "assets",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "liabilities",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "surplus",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "auditor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ClaimProposed",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "assetIds",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "rawAmounts",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ClaimRejected",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "auditor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LiabilityProposed",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "rootHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "rootSum",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "rateManifestHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "snapshotTime",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "snapshotBlock",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LiabilityRemovalRequested",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LiabilityRemovalVerified",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "LiabilityVerified",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "approved",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "auditor",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PublicLedger",
    "inputs": [
      {
        "name": "snapshotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "identities",
        "type": "bytes32[]",
        "indexed": false,
        "internalType": "bytes32[]"
      },
      {
        "name": "amounts",
        "type": "uint256[]",
        "indexed": false,
        "internalType": "uint256[]"
      },
      {
        "name": "capacity",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ReserveVerified",
    "inputs": [
      {
        "name": "assetId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "reserve",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "nonce",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "Expired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Insolvent",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidInput",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidLedger",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidState",
    "inputs": []
  },
  {
    "type": "error",
    "name": "Unauthorized",
    "inputs": []
  }
] as const;
