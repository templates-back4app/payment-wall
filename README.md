# payment-wall

The same shop, in the two shapes this problem comes in, with the same stranger
attacking both. The payment provider keeps the only ledger that holds real money,
so "how much was actually paid" is a measurement rather than a claim.

## Run it

```
./run.sh
```

Needs Node 22 and nothing else.

## What it found

| | the browser says it paid | a signed webhook says it paid |
| --- | --- | --- |
| requests needed to get the goods free | **1** | — |
| credentials needed | **none** | the webhook secret |
| orders released | **2 of 2** | 1 of 6 |
| the provider's ledger | **$0.00** | $49.00 |

In the first shape the attack is a single HTTP request to an endpoint the browser
was always going to call. It works on somebody else's order too.

In the second, five different forgeries are refused and the one genuine delivery
is accepted:

```
the request claims to be      code  why                              order
no signature at all           400   no signature header              pending
signed with a guessed secret  400   signature does not match         pending
signed, then the body edited  400   signature does not match         pending
a signature from an hour ago  400   timestamp outside tolerance      pending
a real event for 1 cent       400   amount does not match the order  pending
the provider itself           200   accepted                         paid
the same event replayed       200   already processed                paid
```

## The negative test

A battery that cannot fail proves nothing, so `SKIP_VERIFY=1` removes the signature
check and the same battery is run again. Three of the five forgeries then succeed
and the shop gives away 4 of 6 orders for $49.00.

It also shows the two defences are not the same defence. Even with no signature
check at all, the amount comparison still refuses the edited body and the genuine
one-cent event. Neither check covers the other.

## The pieces

| file | what it does |
| --- | --- |
| `shop.mjs` | the order API, in both shapes (`MODE=client-trust` or `MODE=webhook`) |
| `provider.mjs` | the payment provider: holds the ledger and the secret, signs and delivers |
| `signature.mjs` | sign and verify, the scheme real providers use, in its own module |
| `attack.mjs` | the stranger: two cases against the first shape, seven against the second |
| `run.sh` | starts both services, runs both batteries, cleans up |

## What to check in your own app

1. Is there any endpoint that marks an order paid because the caller said so?
2. Does your webhook handler verify a signature before it reads the body?
3. Does it compare the amount paid against the amount owed?
4. Does it refuse an event id it has already processed?
5. Does it refuse a signature older than a few minutes?
