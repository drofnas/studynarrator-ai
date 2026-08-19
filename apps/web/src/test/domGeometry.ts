if (typeof Range !== "undefined") {
  Object.defineProperties(Range.prototype, {
    getClientRects: {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
}
