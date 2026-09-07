import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimatedSms, remainingQuota, parseBalance, profitPerSms, marginPct } from '../sms-economics.ts';

describe('estimatedSms', () => {
  it('divides balance by per-sms cost, floored', () => {
    assert.equal(estimatedSms(1000, 32), 31);
    assert.equal(estimatedSms(100, 25), 4);
  });
  it('guards zero/negative/NaN', () => {
    assert.equal(estimatedSms(0, 32), 0);
    assert.equal(estimatedSms(1000, 0), 0);
    assert.equal(estimatedSms(-5, 32), 0);
    assert.equal(estimatedSms(1000, NaN), 0);
  });
});

describe('remainingQuota', () => {
  it('quota minus used, never negative', () => {
    assert.equal(remainingQuota(20000, 5000), 15000);
    assert.equal(remainingQuota(1000, 1500), 0);
  });
  it('null quota = uncapped (Infinity)', () => {
    assert.equal(remainingQuota(null, 9999), Infinity);
    assert.equal(remainingQuota(undefined, 1), Infinity);
  });
});

describe('parseBalance', () => {
  it('parses "KES 1785.50"', () => {
    assert.deepEqual(parseBalance('KES 1785.50'), { currency: 'KES', amount: 1785.5 });
  });
  it('parses "UGX 100,000"', () => {
    assert.deepEqual(parseBalance('UGX 100,000'), { currency: 'UGX', amount: 100000 });
  });
  it('handles amount-only + junk', () => {
    assert.equal(parseBalance('500').amount, 500);
    assert.deepEqual(parseBalance(null), { currency: '', amount: 0 });
    assert.deepEqual(parseBalance('n/a'), { currency: '', amount: 0 });
  });
});

describe('profitPerSms', () => {
  it('retail minus internal cost', () => {
    assert.equal(profitPerSms(30, 27), 3);
    assert.equal(profitPerSms(30, 30), 0);
  });
  it('can be negative when undercharging', () => {
    assert.equal(profitPerSms(25, 27), -2);
  });
});

describe('marginPct', () => {
  it('profit as a % of retail price', () => {
    assert.equal(marginPct(30, 27), 10);
    assert.equal(marginPct(20, 10), 50);
  });
  it('zero when retail price is not positive', () => {
    assert.equal(marginPct(0, 27), 0);
    assert.equal(marginPct(-5, 27), 0);
  });
});
