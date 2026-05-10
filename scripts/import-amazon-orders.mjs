// Imports the three Amazon Order Details PDFs into the DB by breaking each
// single Amazon credit-card charge into per-item / tax / shipping / credit
// line items. Data was extracted from the PDFs in csv/amazon/ by hand —
// stable Amazon format with predictable fields:
//   Order Summary section -> subtotal, tax, gift card, points, grand total
//   Each "Delivered ..." section -> items (name + price + optional qty)
//
// Re-run-safe: server endpoint short-circuits if a line item with the
// `amazon-order:<id>` tag already exists. To re-import after edits:
//   curl -X DELETE "http://localhost:3001/import/csv?tag=amazon-order:<id>"

import path from "node:path";

const SERVER = process.env.SERVER ?? "http://localhost:3001";

async function post(p, body) {
  const res = await fetch(`${SERVER}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${p} ${res.status}: ${JSON.stringify(j)}`);
  return j;
}

async function patch(p, body) {
  const res = await fetch(`${SERVER}${p}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${p} ${res.status}: ${JSON.stringify(j)}`);
  return j;
}

const orders = [
  {
    orderId: "112-1217015-6931436",
    datePlaced: "2026-05-05",
    cardLastFour: "8865",
    items: [
      { name: "Nutricost Psyllium Husk Ground Powder (1lbs) - Gluten Free and Non-GMO", unitPrice: 19.95, quantity: 1 },
      { name: "KitchenAid Classic Multifunction Can Opener and Bottle Opener", unitPrice: 13.69, quantity: 1 },
      { name: "Love's cabin Twin Comforter Set Black, 5 Pieces Twin Bed in a Bag", unitPrice: 28.39, quantity: 1 },
      { name: "King Koil Luxury Twin Air Mattress with Built in Pump", unitPrice: 99.95, quantity: 1 },
      { name: "DJI Mic 3 (2 TX + 1 RX + Charging Case), Wireless Microphone", unitPrice: 259.00, quantity: 1 },
      { name: 'VICTIV 74" Camera Tripod', unitPrice: 32.99, quantity: 1 },
      { name: "Room Divider for Room Separation, 4-10ft Adjustable Temporary Privacy Wall", unitPrice: 39.99, quantity: 1 },
      { name: "BUSH'S BEST 16oz Canned Pinto Beans (Pack of 12)", unitPrice: 11.88, quantity: 1 },
      { name: "Air Mattress Cover Full Mattress Pad, Thick Quilted Mattress Topper", unitPrice: 39.99, quantity: 1 },
      { name: "Apple AirPods 4 Wireless Earbuds (Refurbished)", unitPrice: 88.47, quantity: 1 },
    ],
    tax: 63.55,
    shipping: 0,           // $2.99 charged, $2.99 free shipping credit → net $0
    giftCardAmount: 47.35,
    rewardsPoints: 0,
    grandTotal: 650.50,
  },
  {
    orderId: "112-1533482-0473056",
    datePlaced: "2026-05-05",
    cardLastFour: "8865",
    items: [
      { name: "Amazon Grocery, Canned Pinto Beans, 15.5 Oz", unitPrice: 0.90, quantity: 4 },
      { name: "Goya Foods Chick Peas, Garbanzo Beans, 15.5 Ounce (Pack of 8)", unitPrice: 10.16, quantity: 1 },
      { name: "Hagibis 21 inch Ring Light with Stand", unitPrice: 80.41, quantity: 1 },
    ],
    tax: 8.48,
    shipping: 0,
    giftCardAmount: 102.65,
    rewardsPoints: 0,
    grandTotal: 0.00,
  },
  {
    orderId: "113-3093059-0561045",
    datePlaced: "2026-05-09",
    cardLastFour: "8865",
    items: [
      { name: "RYB HOME Blackout Room Divider Curtain", unitPrice: 49.95, quantity: 1 },
    ],
    tax: 5.27,
    shipping: 0,
    giftCardAmount: 0,
    rewardsPoints: 32.52,
    grandTotal: 22.70,
  },
];

console.log(`Importing ${orders.length} Amazon orders…\n`);
for (const order of orders) {
  process.stdout.write(`  ${order.orderId} (${order.items.length} items, $${order.grandTotal.toFixed(2)})… `);
  try {
    const r = await post("/import/amazon-order", order);
    console.log(r.status, r.insertedCount ? `+${r.insertedCount} rows` : "", r.deletedOriginal ? `-1 original charge` : "(no original found)");
    if (r.sumCheck && Math.abs(r.sumCheck.drift) > 0.01) {
      console.log(`    ⚠ sum drift: ${r.sumCheck.sumInserts} vs ${r.sumCheck.expected}`);
    }
  } catch (err) {
    console.log("FAILED:", String(err));
  }
}

// HYSA balance recalc: sum of all transactions on the HYSA account (id 9).
// Assumes balance starts at $0 — the imported CSV is the full activity
// history the user has. If they ever had a prior starting balance, they
// can override this via the inline editor.
console.log(`\nRecalculating Amex HYSA balance from transactions…`);
const txns = await (await fetch(`${SERVER}/transactions?accountId=9&limit=500`)).json();
const sum = txns.reduce((s, t) => s + t.amount, 0);
console.log(`  sum of ${txns.length} HYSA transactions: $${sum.toFixed(2)}`);
await patch(`/accounts/9/balance`, { current: Number(sum.toFixed(2)) });
console.log(`  set HYSA balance to $${sum.toFixed(2)}`);

void path;
console.log("\nDone.");
