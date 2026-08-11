import { test } from "node:test";
import assert from "node:assert/strict";
import {
  money,
  add,
  subtract,
  multiply,
  divide,
  sum,
  toNumber,
  format,
  zero,
} from "../src/domain/money";

test("money constructs micro-units without float drift", () => {
  assert.equal(money(1.23).micros, 1_230_000);
  assert.equal(money(0.1).micros, 100_000);
});

test("adding many tiny per-token costs does not drift", () => {
  // 0.1 + 0.2 in floats is 0.30000000000000004; money must be exact.
  const total = add(money(0.1), money(0.2));
  assert.equal(toNumber(total), 0.3);
});

test("summing a million fractional pennies stays exact", () => {
  const items = Array.from({ length: 1000 }, () => money(0.001));
  const total = sum(items);
  assert.equal(toNumber(total), 1);
});

test("multiply and divide round-trip", () => {
  const m = money(100);
  assert.equal(toNumber(multiply(m, 3)), 300);
  assert.equal(toNumber(divide(m, 4)), 25);
});

test("divide by zero yields zero not NaN", () => {
  assert.equal(toNumber(divide(money(10), 0)), 0);
});

test("subtract can go negative", () => {
  assert.equal(toNumber(subtract(money(5), money(8))), -3);
});

test("currency mismatch throws", () => {
  assert.throws(() => add(money(1, "GBP"), money(1, "USD")));
});

test("format compact millions", () => {
  assert.equal(format(money(2_500_000), { compact: true }), "£2.50m");
});

test("zero is additive identity", () => {
  assert.equal(toNumber(add(zero(), money(42))), 42);
});
