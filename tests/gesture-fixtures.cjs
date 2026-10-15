'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'emotion_line.html');
const readHtml = () => fs.readFileSync(htmlPath, 'utf8');

// These fixtures read the application's visible guide, rather than maintaining
// a second, potentially different outline in the test suite.
function flattenPath(data, subdivisions = 80) {
  const tokens = data.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
  const points = [];
  let index = 0;
  let position;
  let start;
  const number = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      position = { x: number(), y: number() };
      start = position;
      points.push(position);
    } else if (command === 'C') {
      const from = position;
      const control1 = { x: number(), y: number() };
      const control2 = { x: number(), y: number() };
      const end = { x: number(), y: number() };
      for (let step = 1; step <= subdivisions; step++) {
        const t = step / subdivisions;
        const u = 1 - t;
        points.push({
          x: u ** 3 * from.x + 3 * u ** 2 * t * control1.x + 3 * u * t ** 2 * control2.x + t ** 3 * end.x,
          y: u ** 3 * from.y + 3 * u ** 2 * t * control1.y + 3 * u * t ** 2 * control2.y + t ** 3 * end.y,
        });
      }
      position = end;
    } else if (command === 'Z') {
      points.push({ ...start });
      position = start;
    } else {
      throw new Error(`Unsupported guide path command: ${command}`);
    }
  }
  return points;
}

function samplePolyline(points, count) {
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    lengths.push(lengths.at(-1) + Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y));
  }
  const total = lengths.at(-1);
  let segment = 1;
  return Array.from({ length: count }, (_, index) => {
    const distance = total * index / (count - 1);
    while (segment < points.length - 1 && lengths[segment] < distance) segment++;
    const span = lengths[segment] - lengths[segment - 1];
    const t = span === 0 ? 0 : (distance - lengths[segment - 1]) / span;
    const a = points[segment - 1];
    const b = points[segment];
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  });
}

function guideGesture(kind, count = 128, scale = 10, html = readHtml()) {
  const guide = html.slice(html.indexOf('<div id="guide">'), html.indexOf('<div id="ui-overlay">'));
  let points;
  if (kind === 'heart') {
    const match = guide.match(/<path d="([^"]+)"/);
    if (!match) throw new Error('The visible guide has no heart path');
    points = flattenPath(match[1]);
  } else if (kind === 'circle') {
    const match = guide.match(/<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/);
    if (!match) throw new Error('The visible guide has no circle');
    points = Array.from({ length: 1025 }, (_, index) => {
      const angle = 2 * Math.PI * index / 1024;
      return { x: Number(match[1]) + Number(match[3]) * Math.cos(angle), y: Number(match[2]) + Number(match[3]) * Math.sin(angle) };
    });
  } else if (kind === 'triangle') {
    const match = guide.match(/<polygon points="([^"]+)"/);
    if (!match) throw new Error('The visible guide has no triangle');
    points = match[1].trim().split(/\s+/).map(pair => {
      const [x, y] = pair.split(',').map(Number);
      return { x, y };
    });
    points.push({ ...points[0] });
  } else {
    throw new Error(`Unknown guide kind: ${kind}`);
  }
  return samplePolyline(points, count).map(point => ({ x: point.x * scale, y: point.y * scale }));
}

function closedStartAt(points, fraction, reverse = false) {
  const ring = points.slice(0, -1);
  const offset = Math.floor(fraction * ring.length) % ring.length;
  let shifted = ring.slice(offset).concat(ring.slice(0, offset));
  if (reverse) shifted = shifted.reverse();
  return shifted.concat([{ ...shifted[0] }]);
}

function unevenDensity(points) {
  const result = [{ ...points[0] }];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    const subdivisions = index < points.length * 0.42 ? 10 : 1;
    for (let step = 1; step <= subdivisions; step++) {
      result.push({ x: a.x + (b.x - a.x) * step / subdivisions, y: a.y + (b.y - a.y) * step / subdivisions });
    }
    // A stationary pointer can deliver repeated coordinates.
    if (index % 9 === 0) result.push({ ...b }, { ...b }, { ...b });
  }
  return result;
}

function noisy(points, amplitude = 1.5) {
  return points.map((point, index) => ({
    x: point.x + Math.sin(index * 1.7) * amplitude,
    y: point.y + Math.cos(index * 2.3) * amplitude,
  }));
}

function line(from, to, count = 32) {
  return samplePolyline([from, to], count);
}

function loadApp(html = readHtml()) {
  const elements = new Map();
  const drawingContext = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => { target[key] = value; return true; } });
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      const handlers = new Map();
      elements.set(id, {
        style: {}, textContent: '', width: 800, height: 600,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
        getContext: () => drawingContext,
        addEventListener: (name, callback) => handlers.set(name, callback),
        dispatch: (name, event = {}) => handlers.get(name)?.(event),
      });
    }
    return elements.get(id);
  }
  let now = 10000;
  class TestDate extends Date { static now() { return now; } }
  const context = vm.createContext({
    console, Math, Date: TestDate,
    document: { getElementById: element, addEventListener() {} },
    window: { innerWidth: 800, innerHeight: 600, addEventListener() {} },
    requestAnimationFrame: () => 0,
    setTimeout: () => 0,
    clearTimeout() {},
  });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error('Expected one application script');
  vm.runInContext(`${scripts[0][1]}\n
    // Only audio device access is suppressed; drawing and world transitions run.
    unlockAudio = () => {};
    globalThis.testApi = {
      recognizeGesture, startDraw, moveDraw, endDraw, checkCrossFromRecent,
      getWorld: () => currentWorld,
      getStrokes: () => allStrokes,
      getRecentStrokes: () => recentStrokes,
      getDrawPoints: () => drawPoints,
      isDrawing: () => isDrawing,
    };`, context, { filename: htmlPath });
  return {
    ...context.testApi,
    element,
    advance: milliseconds => { now += milliseconds; },
    draw(points) {
      context.testApi.startDraw(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.testApi.moveDraw(point.x, point.y);
      context.testApi.endDraw();
    },
  };
}

module.exports = { readHtml, flattenPath, samplePolyline, guideGesture, closedStartAt, unevenDensity, noisy, line, loadApp };
