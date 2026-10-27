// A stand-in for the payment provider, with a ledger. It only credits money when
// somebody actually charges a card through it, and it is the only party holding
// the webhook secret -- which is what makes its signature worth anything.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { sign } from './signature.mjs';

const PORT = Number(process.env.PROVIDER_PORT ?? 8182);
const SHOP = process.env.SHOP_URL ?? 'http://127.0.0.1:8181';
const SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_test_do_not_use_in_production';

let balanceCents = 0;
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;

  if (req.method === 'POST' && path === '/charge') {
    const { orderId, amount } = JSON.parse((await read(req)) || '{}');
    balanceCents += amount;                       // the money is real only here
    const raw = JSON.stringify({ id: `evt_${randomUUID().slice(0, 8)}`, type: 'payment.succeeded',
      data: { orderId, amountPaid: amount } });
    const header = sign(raw, SECRET);
    // deliver it the way a provider does: server to server, signed
    const r = await fetch(`${SHOP}/webhooks/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': header }, body: raw,
    });
    // hand the caller the exact bytes, so a replay can be attempted later
    return json(res, 200, { delivered: r.status, raw, header });
  }

  if (req.method === 'GET' && path === '/balance') return json(res, 200, { cents: balanceCents });

  json(res, 404, { error: 'no such endpoint' });
}).listen(PORT, '127.0.0.1', () => console.error(`provider up on ${PORT}`));
