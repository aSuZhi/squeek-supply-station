// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Records server-attested scores. This contract does NOT replay the game.
/// @dev No token transfers, deposits, fees, upgrades or reward promises.
contract SqueekSupplyBoard is EIP712, Ownable2Step {
    bytes32 public constant SCORE_TYPEHASH = keccak256(
        "ScoreAttestation(bytes32 runId,bytes32 challengeId,bytes32 configHash,address player,uint64 score,uint32 deliveries,uint64 deadline)"
    );
    struct Best { uint64 score; bytes32 runId; }
    mapping(bytes32 => mapping(address => Best)) public best;
    mapping(bytes32 => bool) public pinned;
    mapping(bytes32 => bytes32) public challengeConfig;
    address public signer;

    error Expired();
    error BadSignature();
    error AlreadyPinned();
    error NotHigher();
    error InvalidConfiguration();
    event ScorePinned(address indexed player, bytes32 indexed challengeId, bytes32 indexed runId, bytes32 configHash, uint64 score, uint32 deliveries);
    event SignerChanged(address oldSigner, address newSigner);

    constructor(address initialOwner, address initialSigner) EIP712("SqueekSupply", "2") Ownable(initialOwner) {
        if (initialSigner == address(0)) revert InvalidConfiguration();
        signer = initialSigner;
    }

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert InvalidConfiguration();
        emit SignerChanged(signer, newSigner);
        signer = newSigner;
    }

    function pinScore(bytes32 runId, bytes32 challengeId, bytes32 configHash, uint64 score, uint32 deliveries, uint64 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        if (pinned[runId]) revert AlreadyPinned();
        if (runId == bytes32(0) || challengeId == bytes32(0) || configHash == bytes32(0)) revert InvalidConfiguration();
        if (score <= best[challengeId][msg.sender].score) revert NotHigher();
        bytes32 known = challengeConfig[challengeId];
        if (known != bytes32(0) && known != configHash) revert InvalidConfiguration();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(SCORE_TYPEHASH,runId,challengeId,configHash,msg.sender,score,deliveries,deadline)));
        if (ECDSA.recover(digest,signature) != signer) revert BadSignature();
        pinned[runId] = true;
        challengeConfig[challengeId] = configHash;
        best[challengeId][msg.sender] = Best(score,runId);
        emit ScorePinned(msg.sender,challengeId,runId,configHash,score,deliveries);
    }
}
