const height = 160;
const width = 600;
const analyze = (data: number[], target: SVGPathElement) => {
  // Never want a density of points higher than the number of pixels
  // This is very conservative, could be far fewer points because of curve smoothing.
  // Drawing too many points seems to cause an explosion in browser
  // composite time when animating the playhead
  const takeEveryN = Math.ceil(data.length / width);
  const filteredData =
    takeEveryN === 1
      ? data.slice(0)
      : data.filter((_, i) => i % takeEveryN === 0);
  // Need at least two points to render waveform.
  if (filteredData.length === 1) {
    filteredData.push(filteredData[0]);
  }
  const maxIndex = filteredData.length - 1;
  const points = [
    ...filteredData.map((v, i) => [width * (i / maxIndex), (height * v) / 2]),
    ...filteredData
      .reverse()
      .map((v, i) => [width * (1 - i / maxIndex), (-height * v) / 2]),
  ];
  const pathComponents = points.map(([x, y], i) => {
    const [nx, ny] = points[i < points.length - 1 ? i + 1 : 0];
    return `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  });
  target.setAttribute("d", `M0 0${pathComponents.join(" ")}Z`);
};

export { analyze, width, height };
