// Checks for the webcam error messages. Run with `npm test -w @studio/core` (Node 22+).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cameraErrorMessage} from '../src/media.js';

test('each camera failure says what to do and names the browser error', () => {
  const m = name => cameraErrorMessage(Object.assign(new Error('x'), {name}));
  assert.match(m('NotReadableError'), /busy.*Close any other app.*\(NotReadableError\)$/);
  assert.match(m('NotAllowedError'), /refused.*address bar.*\(NotAllowedError\)$/);
  assert.match(m('NotFoundError'), /No camera found.*\(NotFoundError\)$/);
  assert.match(m('TimeoutError'), /sent no picture/);
  assert.match(m('WeirdError'), /Camera failed to start: x \(WeirdError\)$/);
  assert.match(cameraErrorMessage(null), /Camera failed to start \(Error\)$/);
});
