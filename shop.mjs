// A small shop API, in the two shapes this problem comes in.
//
//   MODE=client-trust  the browser tells the server the payment went through
//   MODE=webhook       only the payment provider can say so, and it has to prove it
//
// Everything else is identical: same orders, same endpoints, same storage.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { verify } from './signature.mjs';

const MODE = process.env.MODE ?? 'client-trust';
const PORT = Number(process.env.PORT ?? 8181);
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_test_do_not_use_in_production';
// SKIP_VERIFY=1 takes the signature check out. It exists only so the attack
// battery can be shown to fail: a test that cannot fail is not a test.
const SKIP_VERIFY = process.env.SKIP_VERIFY === '1';

const orders = new Map();
const seenEvents = new Set();   // webhook ids already processed
let released = 0;               // goods handed over

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const read = (req) => new Promise((ok) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b));
});

function markPaid(order, source) {
  if (order.status === 'paid') return false;
  order.status = 'paid';
  order.paidVia = source;
  released++;
  return true;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const seg = url.pathname.split('/').filter(Boolean);

  if (req.method === 'POST' && seg[0] === 'orders' && seg.length === 1) {
    const body = JSON.parse((await read(req)) || '{}');
    const id = `ord_${randomUUID().slice(0, 8)}`;
    orders.set(id, { id, item: body.item ?? 'a thing', amount: body.amount ?? 4900, status: 'pending' });
    return json(res, 201, orders.get(id));
  }

  if (req.method === 'GET' && seg[0] === 'orders' && seg[1]) {
    const o = orders.get(seg[1]);
    return o ? json(res, 200, o) : json(res, 404, { error: 'no such order' });
  }

  if (req.method === 'GET' && seg[0] === 'stats') {
    return json(res, 200, { mode: MODE, orders: orders.size, released });
  }

  // the endpoint the browser calls after the payment widget says it worked
  if (req.method === 'POST' && seg[0] === 'orders' && seg[2] === 'paid') {
    if (MODE !== 'client-trust') return json(res, 404, { error: 'no such endpoint' });
    const o = orders.get(seg[1]);
    if (!o) return json(res, 404, { error: 'no such order' });
    markPaid(o, 'the browser said so');
    return json(res, 200, o);
  }

  // the endpoint the payment provider calls, which has to prove who it is
  if (req.method === 'POST' && seg[0] === 'webhooks' && seg[1] === 'payments') {
    if (MODE !== 'webhook') return json(res, 404, { error: 'no such endpoint' });
    const raw = await read(req);
    const why = SKIP_VERIFY ? null : verify(raw, req.headers['stripe-signature'], WEBHOOK_SECRET);
    if (why) return json(res, 400, { error: 'rejected', why });

    const event = JSON.parse(raw);
    if (seenEvents.has(event.id)) return json(res, 200, { ok: true, note: 'already processed' });
    seenEvents.add(event.id);

    const o = orders.get(event.data.orderId);
    if (!o) return json(res, 404, { error: 'no such order' });
    if (event.data.amountPaid !== o.amount)
      return json(res, 400, { error: 'rejected', why: 'amount does not match the order' });
    markPaid(o, 'a signed webhook');
    return json(res, 200, { ok: true, order: o });
  }

  json(res, 404, { error: 'no such endpoint' });
}).listen(PORT, '127.0.0.1', () => console.error(`shop up on ${PORT} in ${MODE} mode`));
