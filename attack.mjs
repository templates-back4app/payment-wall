// A stranger with curl and no credentials, against both shapes of the same shop.
// Nothing here uses a session, a token or the webhook secret unless a case says so.
import { sign } from './signature.mjs';

const BASE = `http://127.0.0.1:${process.env.PORT ?? 8181}`;
const PROVIDER = `http://127.0.0.1:${process.env.PROVIDER_PORT ?? 8182}`;
const SECRET = 'whsec_test_do_not_use_in_production';
const PRICE = 4900;   // cents

const hit = async (path, { method = 'POST', body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const newOrder = async () => (await hit('/orders', { body: { item: 'a licence', amount: PRICE } })).body;
const statusOf = async (id) => (await hit(`/orders/${id}`, { method: 'GET' })).body?.status;
const stats = async () => (await hit('/stats', { method: 'GET' })).body;
// the only number that is actually money: the provider's own ledger
const balance = async () => (await fetch(`${PROVIDER}/balance`).then((r) => r.json())).cents;

const event = (orderId, amountPaid = PRICE, id = `evt_${Math.random().toString(36).slice(2, 10)}`) =>
  JSON.stringify({ id, type: 'payment.succeeded', data: { orderId, amountPaid } });

const rows = [];
const record = (name, requests, result, paid) => rows.push({ name, requests, result, paid });

const MODE = process.argv[2];

if (MODE === 'client-trust') {
  // the whole attack: make an order, tell the server it is paid
  const t0 = performance.now();
  const o = await newOrder();
  const r = await hit(`/orders/${o.id}/paid`);
  const ms = Math.round(performance.now() - t0);
  record('buy it, then say you paid', 2, `HTTP ${r.status}, order is ${await statusOf(o.id)}`, 0);

  // and the same thing done to an order that is not yours
  const victim = await newOrder();
  const r2 = await hit(`/orders/${victim.id}/paid`);
  record("do it to someone else's order", 1, `HTTP ${r2.status}, order is ${await statusOf(victim.id)}`, 0);

  const s = await stats();
  const cents = await balance();
  console.log('');
  console.log(`  MODE: the browser tells the server the payment went through`);
  console.log(`  the whole attack took ${ms} ms and needed no credential of any kind`);
  console.log('');
  for (const row of rows) console.log(`  ${row.name.padEnd(32)} ${String(row.requests).padStart(2)} request(s)   ${row.result}`);
  console.log('');
  console.log(`  goods released: ${s.released} of ${s.orders} orders`);
  console.log(`  the provider's ledger says: $${(cents / 100).toFixed(2)} charged`);
  console.log('');
}

if (MODE === 'webhook') {
  const cases = [];
  const run = async (name, orderId, { body, header }) => {
    const r = await hit('/webhooks/payments', { body, headers: header ? { 'stripe-signature': header } : {} });
    cases.push([name, r.status, r.body?.why ?? r.body?.note ?? (r.body?.ok ? 'accepted' : r.body?.error ?? ''), await statusOf(orderId)]);
  };

  let o = await newOrder();
  await run('no signature at all', o.id, { body: event(o.id) });

  o = await newOrder();
  const guessed = event(o.id);
  await run('signed with a guessed secret', o.id, { body: guessed, header: sign(guessed, 'whsec_guess') });

  o = await newOrder();
  const honest = event(o.id);
  const hdr = sign(honest, SECRET);
  await run('signed, then the body edited', o.id, { body: event(o.id, 1), header: hdr });

  o = await newOrder();
  const old = event(o.id);
  await run('a signature from an hour ago', o.id, { body: old, header: sign(old, SECRET, Math.floor(Date.now() / 1000) - 3600) });

  o = await newOrder();
  const cheap = event(o.id, 1);
  await run('a real event for 1 cent', o.id, { body: cheap, header: sign(cheap, SECRET) });

  // and a real purchase, charged through the provider, which signs and delivers
  o = await newOrder();
  const charged = await fetch(`${PROVIDER}/charge`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orderId: o.id, amount: PRICE }),
  }).then((r) => r.json());
  cases.push(['the provider itself', charged.delivered, 'accepted', await statusOf(o.id)]);
  // then the same signed bytes sent again, which is what an attacker who sniffed
  // one genuine delivery would try
  await run('the same event replayed', o.id, { body: charged.raw, header: charged.header });

  const s = await stats();
  const cents = await balance();
  const w = Math.max(...cases.map((c) => c[0].length));
  const w2 = Math.max(...cases.map((c) => String(c[2]).length));
  console.log('');
  console.log(`  MODE: only the payment provider can say so, and it has to prove it`);
  console.log('');
  console.log(`  ${'the request claims to be'.padEnd(w)}  code  ${'why'.padEnd(w2)}  order`);
  console.log(`  ${'-'.repeat(w)}  ----  ${'-'.repeat(w2)}  -------`);
  for (const [n, code, why, st] of cases) console.log(`  ${n.padEnd(w)}  ${String(code).padEnd(4)}  ${String(why).padEnd(w2)}  ${st}`);
  console.log('');
  console.log(`  goods released: ${s.released} of ${s.orders} orders`);
  console.log(`  the provider's ledger says: $${(cents / 100).toFixed(2)} charged`);
  console.log('');
}
