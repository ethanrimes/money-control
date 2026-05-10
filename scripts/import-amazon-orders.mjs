// Parses every Amazon "Order Details" PDF in csv/amazon/ and posts the
// structured data to /import/amazon-order. The server matches each parsed
// order to the corresponding aggregator-pulled charge by amount+date,
// deletes that single charge, and inserts one transaction per item / tax
// / shipping / credit. Re-run-safe: server short-circuits if the order's
// tag is already imported.
//
// Usage: node scripts/import-amazon-orders.mjs
// Optional env: SERVER=http://localhost:3001
//
// The parser handles known variants in the PDF layout:
//   - Payment method line: "Prime Visa ending in 8865" /
//     "American Express  ending in 1007" (two spaces)
//   - Optional credits: Gift Card Amount, Rewards Points, Subscribe & Save,
//     Your Coupon Savings
//   - Items with multi-line names, optional quantity badges (a leading
//     standalone integer), and various trailing metadata
//     ("Supplied by:", "Condition:", "Return ...", "Auto-delivered:",
//     "FSA or HSA eligible", "Return window closed on ...")

import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SERVER = process.env.SERVER ?? "http://localhost:3001";
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "csv", "amazon");

async function extractText(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = getDocument({ data, useSystemFonts: true });
  // pdfjs emits "Warning: TT: ..." to console for some fonts; harmless.
  const origWarn = console.warn;
  console.warn = () => {};
  let doc;
  try {
    doc = await loadingTask.promise;
  } finally {
    console.warn = origWarn;
  }
  const allLines = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // Reconstruct lines by grouping by Y-coordinate (PDF y is bottom-up).
    const byY = new Map();
    for (const item of content.items) {
      if (!("transform" in item) || !item.str) continue;
      const y = Math.round(item.transform[5]);
      const arr = byY.get(y) ?? [];
      arr.push({ x: item.transform[4], str: item.str });
      byY.set(y, arr);
    }
    const ys = [...byY.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const line = byY.get(y)
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) allLines.push(line);
    }
  }
  return allLines;
}

function parseOrder(lines) {
  const joined = lines.join("\n");
  // Flat copy with all whitespace collapsed to single spaces — used for
  // matching multi-word labels that wrap across PDF lines (e.g. "Estimated
  // tax to be\ncollected:" breaks our regex if we keep the newline).
  const flat = joined.replace(/\s+/g, " ");

  const orderId = flat.match(/Order #\s*(\d{3}-\d{7}-\d{7})/)?.[1] ?? null;
  const dateRaw = flat.match(/Order placed\s+([A-Za-z]+ \d{1,2},\s*\d{4})/)?.[1] ?? null;
  const datePlaced = isoFromAmericanDate(dateRaw);
  const cardLastFour = flat.match(/ending\s+in\s+(\d{4,5})\b/)?.[1] ?? null;

  // Label-to-amount extraction. We try two strategies in order:
  //
  //   1. STRICT: full label immediately followed by colon + amount. This
  //      is the common case and disambiguates labels that appear in
  //      multiple sections of the PDF (e.g. "Rewards Points" can appear
  //      as a payment-method label AND as the actual credit line — only
  //      the credit line has a colon-amount form).
  //
  //   2. LOOSE: shorter prefix + up to 80 non-$ chars + amount. Used when
  //      the label visually wraps onto two lines AND the amount column
  //      lands BETWEEN the wrapped words — e.g. "Estimated tax to be
  //      $5.27 collected:". The strict full-label regex would miss this.
  const moneyStrict = (label) => {
    const re = new RegExp(label.replace(/ /g, "\\s+") + "\\s*:\\s*-?\\$([\\d,]+\\.\\d{2})");
    const m = flat.match(re);
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  const moneyLoose = (labelPrefix) => {
    const re = new RegExp(labelPrefix.replace(/ /g, "\\s+") + "[^\\$]{0,80}?-?\\$([\\d,]+\\.\\d{2})");
    const m = flat.match(re);
    return m ? Number(m[1].replace(/,/g, "")) : 0;
  };
  const money = (strictLabel, looseLabel = strictLabel) => {
    const strict = moneyStrict(strictLabel);
    if (strict !== null) return strict;
    return moneyLoose(looseLabel);
  };

  const subtotal = money("Item\\(s\\) Subtotal");
  const shipping = money("Shipping & Handling");
  const freeShipping = money("Free Shipping");
  // Tax label often wraps — fall back to the short prefix on the loose pass.
  const tax = money("Estimated tax to be collected", "Estimated tax");
  const grandTotal = money("Grand Total");

  const credits = [];
  const addCredit = (pdfLabel, ourLabel) => {
    const amt = money(escapeRegex(pdfLabel));
    if (amt > 0) credits.push({ label: ourLabel, amount: amt });
  };
  addCredit("Gift Card Amount", "Gift Card Used");
  addCredit("Rewards Points", "Rewards Points Used");
  addCredit("Subscribe & Save", "Subscribe & Save");
  addCredit("Your Coupon Savings", "Coupon Savings");

  const items = parseItems(lines);

  return {
    orderId,
    datePlaced,
    cardLastFour,
    items,
    tax,
    shipping: Math.max(0, shipping - freeShipping),
    credits,
    grandTotal,
  };
}

function parseItems(lines) {
  // Find the start (after the last Grand Total line) and end (Back to top).
  let startIdx = -1;
  let endIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^Grand Total:/.test(lines[i])) startIdx = i + 1;
    if (lines[i] === "Back to top") {
      endIdx = i;
      break;
    }
  }
  if (startIdx === -1) return [];

  const items = [];
  let buffer = [];
  let qty = 1;
  let state = "item-buffer"; // "item-buffer" | "looking-for-price"

  const sectionHeaderRe = /^(Delivered |Arriving |Your package |It was handed|Track package)/;
  const metadataRe = /^(Supplied by:|Condition:|Return |Auto-delivered:|FSA or HSA|Return window closed)/;
  const priceRe = /^\$([\d,]+\.\d{2})$/;

  // Whole Foods pickup orders use "Purchased at Whole Foods Market" as the
  // section header (instead of "Delivered ...") and skip "Sold by:" — just
  // name + price per item. Generalize sectionHeaderRe to include that
  // pattern; the rest of the state machine handles the rest.
  const wholeFoodsHeaderRe = /^Purchased at /;

  for (let i = startIdx; i < endIdx; i++) {
    const line = lines[i];
    // Skip the FSA-eligible summary tail line that sometimes appears
    // between Grand Total and the first item header.
    if (/^FSA or HSA eligible/.test(line) || /^\(inc\. tax/.test(line)) continue;

    if (sectionHeaderRe.test(line) || wholeFoodsHeaderRe.test(line)) {
      buffer = [];
      qty = 1;
      state = "item-buffer";
      continue;
    }
    if (/^Sold by:/.test(line)) {
      state = "looking-for-price";
      continue;
    }
    const priceM = line.match(priceRe);
    if (priceM && state === "looking-for-price") {
      // Standard format: Sold by: came earlier; this is the price.
      const price = Number(priceM[1].replace(/,/g, ""));
      const name = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (name && Number.isFinite(price)) items.push({ name, unitPrice: price, quantity: qty });
      buffer = [];
      qty = 1;
      state = "item-buffer";
      continue;
    }
    if (priceM && state === "item-buffer" && buffer.length > 0) {
      // Whole-Foods-style: name lines, then price, no Sold by:.
      const price = Number(priceM[1].replace(/,/g, ""));
      const name = buffer.join(" ").replace(/\s+/g, " ").trim();
      if (name && Number.isFinite(price)) items.push({ name, unitPrice: price, quantity: qty });
      buffer = [];
      qty = 1;
      continue;
    }
    if (state === "looking-for-price") {
      // Skip metadata while waiting for the price.
      if (metadataRe.test(line)) continue;
      // Quantity badge can appear AFTER the metadata block, right before
      // the price — capture it as the item's quantity.
      if (/^\d{1,3}$/.test(line)) {
        qty = parseInt(line, 10);
        continue;
      }
      continue;
    }
    // state === "item-buffer"
    if (/^\d{1,3}$/.test(line)) {
      qty = parseInt(line, 10);
      continue;
    }
    buffer.push(line);
  }
  return items;
}

function isoFromAmericanDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

async function main() {
  if (!fs.existsSync(dir)) {
    console.error(`No csv/amazon directory found at ${dir}`);
    process.exit(1);
  }
  const pdfs = fs.readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort();
  if (pdfs.length === 0) {
    console.log("No PDFs in csv/amazon/. Nothing to do.");
    return;
  }
  console.log(`Found ${pdfs.length} PDF${pdfs.length === 1 ? "" : "s"} in csv/amazon/.\n`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let totalDriftCents = 0;

  for (const filename of pdfs) {
    const pdfPath = path.join(dir, filename);
    process.stdout.write(`  ${filename.padEnd(28)} `);
    try {
      const lines = await extractText(pdfPath);
      const order = parseOrder(lines);

      if (!order.orderId || !order.datePlaced || order.items.length === 0) {
        console.log(`FAILED to parse (orderId=${order.orderId}, items=${order.items.length})`);
        failed++;
        continue;
      }
      // Whole Foods pickup orders ship without a card-on-file charge —
      // payment happens at the store and shows up as a separate WHOLEFDS
      // Teller transaction on whichever card the user used. Skip the
      // import (no card to match) and report.
      if (!order.cardLastFour) {
        console.log(`skipped — no card on order (likely Whole Foods pickup, ${order.items.length} items, $${order.grandTotal.toFixed(2)})`);
        skipped++;
        continue;
      }

      // Sanity check: items + tax + shipping - credits should match grandTotal.
      const calcTotal = order.items.reduce((s, it) => s + it.unitPrice * (it.quantity ?? 1), 0)
        + (order.tax ?? 0)
        + (order.shipping ?? 0)
        - order.credits.reduce((s, c) => s + c.amount, 0);
      const drift = Math.abs(calcTotal - order.grandTotal);
      if (drift > 0.01) {
        totalDriftCents += Math.round(drift * 100);
      }

      const res = await post("/import/amazon-order", order);
      if (res.status === "already-imported") {
        console.log(`already-imported (${order.items.length} items, $${order.grandTotal.toFixed(2)})`);
        skipped++;
      } else {
        const ins = res.insertedCount ?? 0;
        const del = res.deletedOriginal ? " -1 original" : "";
        const driftMsg = drift > 0.01 ? ` ⚠ drift $${drift.toFixed(2)}` : "";
        console.log(`imported +${ins} rows${del} (${order.items.length} items, $${order.grandTotal.toFixed(2)})${driftMsg}`);
        imported++;
      }
    } catch (err) {
      console.log(`ERROR: ${String(err).slice(0, 120)}`);
      failed++;
    }
  }

  console.log(`\nSummary: ${imported} imported · ${skipped} already-imported · ${failed} failed`);
  if (totalDriftCents > 0) {
    console.log(`Total drift across orders: $${(totalDriftCents / 100).toFixed(2)} — review any orders flagged with ⚠ above.`);
  }
}

await main();
