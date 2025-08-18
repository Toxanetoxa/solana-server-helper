wscat -c ws://localhost:8787/ws

https://rpc.ankr.com/solana_devnet/2352f3ed24e7fccabfd6504786217a7ce8163de4b23ef0b115418c77680b2433

curl -X POST https://rpc.ankr.com/solana_devnet/2352f3ed24e7fccabfd6504786217a7ce8163de4b23ef0b115418c77680b2433 \
-H 'Content-Type: application/json' \
-d '{
      "jsonrpc": "2.0",
      "method": "getAccountInfo",
      "params": [
        "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg",
        {
          "encoding": "base58"
        }
      ],
      "id": 1
    }'