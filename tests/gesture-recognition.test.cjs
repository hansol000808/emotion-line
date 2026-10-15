'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { guideGesture, closedStartAt, unevenDensity, noisy, line, samplePolyline, loadApp } = require('./gesture-fixtures.cjs');

for (const count of [32, 64, 128, 256]) {
  test(`visible heart guide is recognized as heart with ${count} input points`, () => {
    assert.equal(loadApp().recognizeGesture(guideGesture('heart', count)), 'heart');
  });
}

for (const kind of ['heart', 'circle', 'triangle']) {
  for (const reverse of [false, true]) {
    test(`${kind} guide keeps its meaning for shifted starts (${reverse ? 'reverse' : 'forward'})`, () => {
      const app = loadApp();
      for (const fraction of [0, 0.17, 0.43, 0.72]) {
        assert.equal(app.recognizeGesture(closedStartAt(guideGesture(kind), fraction, reverse)), kind, `start=${fraction}`);
      }
    });
  }
}

test('heart guide tolerates drawing size and screen position changes', () => {
  const app = loadApp();
  for (const scale of [3, 6, 10, 17]) {
    const points = guideGesture('heart', 128, scale).map(p => ({ x: p.x + 83, y: p.y + 127 }));
    assert.equal(app.recognizeGesture(points), 'heart', `scale=${scale}`);
  }
});

test('heart remains recognizable with uneven pointer speed and repeated points', () => {
  assert.equal(loadApp().recognizeGesture(unevenDensity(guideGesture('heart'))), 'heart');
});

test('small hand movement noise does not erase the heart notch', () => {
  const app = loadApp();
  for (const amplitude of [0.5, 1.5, 3]) {
    assert.equal(app.recognizeGesture(noisy(guideGesture('heart'), amplitude)), 'heart', `noise=${amplitude}px`);
  }
});

test('a small closing gap is tolerated for a heart', () => {
  const points = guideGesture('heart', 128);
  assert.equal(loadApp().recognizeGesture(points.slice(0, -4)), 'heart');
});

test('a slightly slanted, asymmetric heart remains recognizable', () => {
  const points = guideGesture('heart').map(p => ({ x: p.x + 0.08 * (p.y - 170), y: p.y + 0.025 * (p.x - 180) }));
  assert.equal(loadApp().recognizeGesture(points), 'heart');
});

test('a modest tilt does not change the heart meaning', () => {
  const app = loadApp();
  for (const degrees of [-10, 10]) {
    const angle = degrees * Math.PI / 180;
    const points = guideGesture('heart').map(p => ({
      x: 180 + (p.x - 180) * Math.cos(angle) - (p.y - 170) * Math.sin(angle),
      y: 170 + (p.x - 180) * Math.sin(angle) + (p.y - 170) * Math.cos(angle),
    }));
    assert.equal(app.recognizeGesture(points), 'heart', `rotation=${degrees} degrees`);
  }
});

test('circle and moderate ellipses stay calm instead of becoming hearts', () => {
  const app = loadApp();
  for (const [scaleX, scaleY] of [[1, 1], [1, 0.7], [0.7, 1]]) {
    const points = guideGesture('circle').map(p => ({ x: p.x * scaleX, y: p.y * scaleY }));
    assert.equal(app.recognizeGesture(points), 'circle', `ellipse=${scaleX},${scaleY}`);
    assert.equal(app.recognizeGesture(unevenDensity(points)), 'circle');
  }
});

test('pointer noise on a circle does not create a false heart notch', () => {
  const app = loadApp();
  for (const amplitude of [1.5, 3, 5]) {
    assert.equal(app.recognizeGesture(noisy(guideGesture('circle'), amplitude)), 'circle', `noise=${amplitude}px`);
  }
});

test('flat and pointed convex tops are not mistaken for a heart notch', () => {
  const app = loadApp();
  const outlines = {
    square: [{ x: 80, y: 80 }, { x: 280, y: 80 }, { x: 280, y: 280 }, { x: 80, y: 280 }, { x: 80, y: 80 }],
    diamond: [{ x: 180, y: 50 }, { x: 310, y: 180 }, { x: 180, y: 310 }, { x: 50, y: 180 }, { x: 180, y: 50 }],
  };
  for (const [name, points] of Object.entries(outlines)) {
    assert.notEqual(app.recognizeGesture(samplePolyline(points, 128)), 'heart', name);
  }
});

test('too few points and stationary touches do not select a world', () => {
  const app = loadApp();
  assert.equal(app.recognizeGesture([]), null);
  assert.equal(app.recognizeGesture(guideGesture('heart', 8)), null);
  assert.equal(app.recognizeGesture(Array.from({ length: 50 }, () => ({ x: 100, y: 100 }))), null);
  assert.equal(app.recognizeGesture(guideGesture('heart', 128, 0.2)), null);
});

test('an open heart fragment and an open scribble do not trigger love', () => {
  const app = loadApp();
  assert.notEqual(app.recognizeGesture(guideGesture('heart').slice(0, 70)), 'heart');
  const scribble = samplePolyline([{ x: 50, y: 150 }, { x: 130, y: 80 }, { x: 100, y: 230 }, { x: 200, y: 120 }, { x: 290, y: 260 }], 128);
  assert.notEqual(app.recognizeGesture(scribble), 'heart');
});

test('upward swipe still selects joy; downward swipe does not', () => {
  const app = loadApp();
  const up = line({ x: 180, y: 330 }, { x: 190, y: 90 });
  assert.equal(app.recognizeGesture(up), 'swipe');
  assert.notEqual(app.recognizeGesture([...up].reverse()), 'swipe');
  app.draw(up);
  assert.equal(app.getWorld(), 'swipe');
  assert.equal(app.element('world-indicator').textContent, '기쁨의 세계');
});

test('drawing the guide heart reaches the love world through the real endDraw lifecycle', () => {
  const app = loadApp();
  app.draw(guideGesture('heart'));
  assert.equal(app.getWorld(), 'heart');
  assert.equal(app.element('world-indicator').textContent, '사랑의 세계');
  assert.equal(app.element('msg-main-text').textContent, '사랑하는 모든 것에게');
  assert.equal(app.getStrokes().at(-1).gesture, 'heart');
  assert.equal(app.getDrawPoints().length, 0);
  assert.equal(app.isDrawing(), false);
});

test('two crossing diagonal strokes select anger through the real lifecycle', () => {
  const app = loadApp();
  app.draw(line({ x: 80, y: 80 }, { x: 280, y: 280 }));
  assert.equal(app.getWorld(), 'default');
  app.advance(300);
  app.draw(line({ x: 280, y: 80 }, { x: 80, y: 280 }));
  assert.equal(app.getWorld(), 'cross');
  assert.equal(app.element('world-indicator').textContent, '분노의 세계');
});

test('separated or expired diagonals do not combine into a cross', () => {
  const separated = loadApp();
  separated.draw(line({ x: 80, y: 80 }, { x: 280, y: 280 }));
  separated.draw(line({ x: 580, y: 80 }, { x: 380, y: 280 }));
  assert.equal(separated.getWorld(), 'default');
  const expired = loadApp();
  expired.draw(line({ x: 80, y: 80 }, { x: 280, y: 280 }));
  expired.advance(2001);
  expired.draw(line({ x: 280, y: 80 }, { x: 80, y: 280 }));
  assert.equal(expired.getWorld(), 'default');
});

test('clearing resets the selected world and removes pending strokes', () => {
  const app = loadApp();
  app.draw(guideGesture('heart'));
  app.element('clear-btn').dispatch('click');
  assert.equal(app.getWorld(), 'default');
  assert.equal(app.getStrokes().length, 0);
  assert.equal(app.getRecentStrokes().length, 0);
});
