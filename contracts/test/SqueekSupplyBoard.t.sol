// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {SqueekSupplyBoard} from "../../src/SqueekSupplyBoard.sol";
interface Vm {
    function addr(uint256) external returns(address);
    function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert() external;
}
contract SqueekSupplyBoardTest {
    Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    SqueekSupplyBoard board;
    uint256 constant KEY=0x1234;
    address player=address(0xA11CE);
    bytes32 constant CHALLENGE=keccak256("daily");
    bytes32 constant CONFIG=keccak256("rules+source");
    function setUp() public {board=new SqueekSupplyBoard(address(this),vm.addr(KEY));vm.warp(1000);}
    function signature(bytes32 run,bytes32 challenge,bytes32 config,address who,uint64 score,uint32 deliveries,uint64 deadline) internal returns(bytes memory){
        bytes32 domain=keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),keccak256("SqueekSupply"),keccak256("2"),block.chainid,address(board)));
        bytes32 body=keccak256(abi.encode(board.SCORE_TYPEHASH(),run,challenge,config,who,score,deliveries,deadline));
        (uint8 v,bytes32 r,bytes32 s)=vm.sign(KEY,keccak256(abi.encodePacked("\x19\x01",domain,body)));
        return abi.encodePacked(r,s,v);
    }
    function testValidPinAndReplay() public {
        bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,123,2,2000);
        vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,123,2,2000,sig);
        (uint64 score,bytes32 run)=board.best(CHALLENGE,player);require(score==123 && run==bytes32(uint256(1)));
        vm.expectRevert(SqueekSupplyBoard.AlreadyPinned.selector);vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,123,2,2000,sig);
    }
    function testExpired() public {bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,123,2,999);vm.expectRevert(SqueekSupplyBoard.Expired.selector);vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,123,2,999,sig);}
    function testDifferentPlayer() public {bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,123,2,2000);vm.expectRevert(SqueekSupplyBoard.BadSignature.selector);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,123,2,2000,sig);}
    function testTamperedConfig() public {bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,123,2,2000);vm.expectRevert(SqueekSupplyBoard.BadSignature.selector);vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,keccak256("fake"),123,2,2000,sig);}
    function testNotHigher() public {
        bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,123,2,2000);vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,123,2,2000,sig);
        vm.expectRevert(SqueekSupplyBoard.NotHigher.selector);vm.prank(player);board.pinScore(bytes32(uint256(2)),CHALLENGE,CONFIG,123,2,2000,sig);
    }
    function testSignerOwnerOnly() public {vm.expectRevert();vm.prank(player);board.setSigner(player);board.setSigner(player);require(board.signer()==player);}
    function testConfigFrozen() public {
        bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,123,2,2000);vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,123,2,2000,sig);
        vm.expectRevert(SqueekSupplyBoard.InvalidConfiguration.selector);vm.prank(player);board.pinScore(bytes32(uint256(2)),CHALLENGE,keccak256("different"),124,2,2000,sig);
    }
    function testFuzzScore(uint64 value) public {
        if(value==0)return;bytes memory sig=signature(bytes32(uint256(1)),CHALLENGE,CONFIG,player,value,0,2000);
        vm.prank(player);board.pinScore(bytes32(uint256(1)),CHALLENGE,CONFIG,value,0,2000,sig);(uint64 stored,)=board.best(CHALLENGE,player);require(stored==value);
    }
}
