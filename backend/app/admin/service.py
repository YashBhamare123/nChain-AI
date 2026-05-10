import asyncio
import os

import httpx
from eth_account import Account
from eth_utils import keccak, to_canonical_address, to_checksum_address
from fastapi import HTTPException, status

from app.config import settings


def _build_register_driver_calldata(driver_address: str) -> bytes:
    """
    Encodes the calldata for registerDriver(address d, bytes32 id, bytes32 doc).
    We derive id and doc deterministically from the driver address so the backend
    doesn't have to supply them — they can be overridden later via governance.
    """
    # Function selector: keccak256("registerDriver(address,bytes32,bytes32)")[:4]
    selector = keccak(text="registerDriver(address,bytes32,bytes32)")[:4]

    # ABI-encode the three params (each slot is 32 bytes)
    addr_bytes = b"\x00" * 12 + to_canonical_address(driver_address)  # address left-padded to 32
    # Use keccak of the address as the id hash (unique per driver)
    id_hash = keccak(to_canonical_address(driver_address))
    # Use keccak of (address + "doc") as the doc hash — placeholder
    doc_hash = keccak(to_canonical_address(driver_address) + b"doc")

    return selector + addr_bytes + id_hash + doc_hash


class AdminService:
    def __init__(self) -> None:
        pass

    async def register_driver_onchain(self, driver_address: str) -> str:
        """
        Calls registerDriver(driverAddress, id, doc) on-chain using the backend
        private key (msg.sender must equal the contract's `backend` address).
        Returns the tx hash after the receipt confirms status == 1.
        """
        private_key = settings.treasury_private_key
        if not private_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="TREASURY_PRIVATE_KEY not configured",
            )

        rpc_url = settings.chain_rpc_url.strip()
        if not rpc_url:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="CHAIN_RPC_URL not configured — add it to backend/.env",
            )

        contract_address = settings.carpool_contract_address
        if not contract_address or contract_address == "0x0000000000000000000000000000000000000000":
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="CARPOOL_CONTRACT_ADDRESS not configured",
            )
        contract_address = to_checksum_address(settings.carpool_contract_address)

        account = Account.from_key(private_key)

        # Use a generous timeout per individual HTTP call; polling loop handles the rest.
        async with httpx.AsyncClient(timeout=15.0) as client:

            # 1. Get nonce for the signing account
            nonce_resp = await client.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 1, "method": "eth_getTransactionCount",
                "params": [account.address, "pending"],
            })
            nonce_resp.raise_for_status()
            nonce = int(nonce_resp.json()["result"], 16)

            # 2. Get chain ID
            chain_resp = await client.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 2, "method": "eth_chainId", "params": [],
            })
            chain_resp.raise_for_status()
            chain_id = int(chain_resp.json()["result"], 16)

            # 3. EIP-1559 gas pricing.
            #    Legacy type-0 txs (eth_gasPrice) stall permanently on Sepolia when
            #    the returned gasPrice is below the current baseFee.  Instead, fetch
            #    the baseFee from the latest block and build a type-2 transaction.
            block_resp = await client.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 3, "method": "eth_getBlockByNumber",
                "params": ["latest", False],
            })
            block_resp.raise_for_status()
            block_data = block_resp.json().get("result") or {}
            base_fee_hex = block_data.get("baseFeePerGas", "0x0")
            base_fee = int(base_fee_hex, 16)

            # 1.5 gwei priority tip — more than enough to land quickly on Sepolia
            priority_tip = 1_500_000_000  # wei
            # maxFeePerGas = 2× baseFee + tip gives headroom for one baseFee bump
            max_fee = 2 * base_fee + priority_tip

            # 4. Build calldata
            calldata = _build_register_driver_calldata(driver_address)

            # 5. Sign EIP-1559 (type 2) transaction
            tx = {
                "type": 2,
                "to": contract_address,
                "data": "0x" + calldata.hex(),
                "gas": 200_000,
                "maxPriorityFeePerGas": priority_tip,
                "maxFeePerGas": max_fee,
                "nonce": nonce,
                "chainId": chain_id,
                "value": 0,
            }
            signed = account.sign_transaction(tx)

            # 6. Broadcast
            send_resp = await client.post(rpc_url, json={
                "jsonrpc": "2.0", "id": 4, "method": "eth_sendRawTransaction",
                "params": ["0x" + signed.raw_transaction.hex()],
            })
            send_resp.raise_for_status()
            result = send_resp.json()

            if "error" in result:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"RPC error: {result['error'].get('message', result['error'])}",
                )

            tx_hash: str = result["result"]

            # 7. Poll for receipt — confirms the tx was mined AND didn't revert.
            #    eth_sendRawTransaction only means the tx is in the mempool.
            for _attempt in range(30):
                await asyncio.sleep(2)
                receipt_resp = await client.post(rpc_url, json={
                    "jsonrpc": "2.0", "id": 5, "method": "eth_getTransactionReceipt",
                    "params": [tx_hash],
                })
                receipt_resp.raise_for_status()
                receipt_data = receipt_resp.json().get("result")
                if receipt_data is not None:
                    on_chain_status = int(receipt_data.get("status", "0x0"), 16)
                    if on_chain_status != 1:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=(
                                "registerDriver() was mined but REVERTED. "
                                "Check that the signing key's address matches "
                                "the contract's `backend` address."
                            ),
                        )
                    # Transaction confirmed successfully
                    return tx_hash

            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail=(
                    f"Transaction {tx_hash} submitted but receipt not confirmed within 60 s. "
                    "Check the tx on Sepolia Etherscan."
                ),
            )
