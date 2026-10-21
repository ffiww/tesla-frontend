function drawLine(canvasId, series, options = {}) {
  const context = wx.createCanvasContext(canvasId, options.page);
  const width = options.width || 320;
  const height = options.height || 190;
  const left = 42;
  const right = 12;
  const top = 16;
  const bottom = 28;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = series.flatMap(item => item.points.map(point => point.value == null ? NaN : Number(point.value)).filter(Number.isFinite));
  if (!values.length) {
    context.setFillStyle("#9aa0a8");
    context.setFontSize(12);
    context.fillText("暫无趋势数据", left, height / 2);
    context.draw();
    return;
  }
  let min = options.min != null ? options.min : Math.min(...values);
  let max = options.max != null ? options.max : Math.max(...values);
  if (min === max) {
    if (min === 0) max = 1;
    else { min -= 1; max += 1; }
  }
  const span = max - min;
  for (let index = 0; index <= 4; index += 1) {
    const y = top + plotHeight * index / 4;
    const label = (max - span * index / 4).toFixed(span < 8 ? 1 : 0);
    context.setStrokeStyle("#eceef1");
    context.setLineWidth(1);
    context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
    context.setFillStyle("#9297a0"); context.setFontSize(10);
    context.fillText(`${label}${options.unit || ""}`, 2, y + 3);
  }
  series.forEach(item => {
    const points = item.points;
    if (!points.length) return;
    context.beginPath();
    let started = false;
    points.forEach((point, index) => {
      if (point.value == null || !Number.isFinite(Number(point.value))) return;
      const x = left + (points.length === 1 ? plotWidth / 2 : plotWidth * index / (points.length - 1));
      const y = top + (max - Number(point.value)) / span * plotHeight;
      if (!started) { context.moveTo(x, y); started = true; } else context.lineTo(x, y);
    });
    if (started) { context.setStrokeStyle(item.color); context.setLineWidth(2.5); context.stroke(); }
  });
  if (options.showXAxis !== false) {
    context.setFillStyle("#858a92"); context.setFontSize(9);
    const labels = options.labels || [];
    if (labels.length) {
      const indexes = [...new Set([0, Math.floor((labels.length - 1) / 2), labels.length - 1])];
      indexes.forEach(index => {
        const x = left + (labels.length === 1 ? plotWidth / 2 : plotWidth * index / (labels.length - 1));
        const text = labels[index] || "";
        const offset = index === 0 ? 0 : index === labels.length - 1 ? -28 : -12;
        context.fillText(text, x + offset, height - 5);
      });
    } else {
      context.fillText(options.startLabel || "较早", left, height - 5);
      context.fillText(options.endLabel || "最近", width - right - 28, height - 5);
    }
  }
  context.draw();
}

function drawRing(canvasId, battery, range, page) {
  const context = wx.createCanvasContext(canvasId, page);
  const centerX = 112;
  const centerY = 112;
  const start = -Math.PI / 2;
  const outer = 88;
  const inner = 66;
  const drawTrack = (radius, color) => {
    context.beginPath(); context.setStrokeStyle("#eceef1"); context.setLineWidth(radius === outer ? 12 : 9);
    context.arc(centerX, centerY, radius, 0, Math.PI * 2); context.stroke();
    const ratio = Math.max(0, Math.min(1, Number(color.value || 0)));
    context.beginPath(); context.setStrokeStyle(color.stroke); context.setLineWidth(radius === outer ? 12 : 9);
    context.setLineCap("round"); context.arc(centerX, centerY, radius, start, start + Math.PI * 2 * ratio); context.stroke();
  };
  drawTrack(outer, { value: battery == null ? 0 : battery / 100, stroke: "#e82127" });
  drawTrack(inner, { value: range == null ? 0 : range / 435, stroke: "#4d92c8" });
  context.draw();
}

module.exports = { drawLine, drawRing };
