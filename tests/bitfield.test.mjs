import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/bitfield.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exports = {};
new Function('exports', js)(exports);

test('all 48 slots round-trip through AM/PM bitfields', () => {
  for (let slot = 0; slot < 48; slot++) {
    const slots = Array(48).fill(false);
    slots[slot] = true;
    const { am, pm } = exports.splitAmPm(slots);
    assert.deepEqual(exports.combineAmPm(am, pm), slots, 'slot ' + slot);
  }
});
test('toggle changes only the requested bit', () => {
  for (let bit = 0; bit < 24; bit++) {
    const value = exports.toggleBit(0, bit);
    assert.equal(value, 2 ** bit);
    assert.equal(exports.toggleBit(value, bit), 0);
  }
});
