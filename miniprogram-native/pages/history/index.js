const api = require("../../utils/api");
const { drawLine } = require("../../utils/chart");

const now = new Date();
const dayKey = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const timeLabel = value => new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
function durationLabel(start, end) {
  if (!end) return "进行中";
  const minutes = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60}分钟` : `${minutes}分钟`;
}
function daysFor(range) {
  if (range === "all") return null;
  const count = Number(range);
  const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - count + 1);
  return dayKey(date);
}

Page({
  data: {
    range: "30", ranges: [{ value: "7", label: "近7天" }, { value: "30", label: "近30天" }, { value: "90", label: "近90天" }, { value: "all", label: "全部" }],
    section: "drives", drives: [], charges: [], energy: null, dailyBars: [], dailyWidth: 620, dailyDriveDays: [], batterySeries: [],
    dailyBatteryUse: "0.0", dailyBatteryAdded: "0.0", hasMore: false, nextBefore: null, loading: false, loadingMore: false, error: ""
  },
  onLoad() { if (api.hasToken()) this.load(); else this.setData({ error: "请先在车况页连接仪表盘" }); },
  onShow() { if (api.hasToken() && !this.data.energy && !this.data.loading) this.load(); },
  onReady() { this.drawBatteryChart(); this.drawDailyDriveCharts(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  changeRange(event) { const range = event.currentTarget.dataset.value; if (range === this.data.range) return; this.setData({ range }); this.load(); },
  changeSection(event) { this.setData({ section: event.currentTarget.dataset.value }, () => { this.drawBatteryChart(); this.drawDailyDriveCharts(); }); },
  load() {
    if (!api.hasToken()) { this.setData({ error: "请先在车况页连接仪表盘" }); return Promise.resolve(); }
    this.setData({ loading: true, error: "", drives: [], nextBefore: null });
    const from = daysFor(this.data.range);
    const query = { to: dayKey(new Date()) };
    if (from) query.from = from; else query.all = "1";
    return Promise.all([
      api.request("drive-history", { data: query }),
      api.request("energy-history", { data: query })
    ]).then(([driveResult, energy]) => {
      const drives = (driveResult.drives || []).map(item => ({
        ...item, startedLabel: timeLabel(item.started_at), durationLabel: durationLabel(item.started_at, item.ended_at),
        distanceLabel: item.distance_km == null ? "里程暂无" : `${Number(item.distance_km).toFixed(1)} km`,
        energyLabel: item.energy_used_kwh == null ? "耗电暂无" : `${Number(item.energy_used_kwh).toFixed(2)} kWh`
      }));
      const charges = (energy.charging_sessions || []).map(item => ({
        ...item, startedLabel: timeLabel(item.started_at), durationLabel: durationLabel(item.started_at, item.ended_at),
        energyLabel: item.energy_added_kwh == null ? "电量暂无" : `+${Number(item.energy_added_kwh).toFixed(2)} kWh`,
        batteryLabel: item.start_battery_level == null || item.end_battery_level == null ? "" : `${item.start_battery_level}% → ${item.end_battery_level}%`
      }));
      const dailyBars = this.makeDailyBars(energy);
      const dailyDriveDays = this.makeDailyDriveDays(energy);
      const battery = energy.battery || {};
      const batterySeries = (battery.BatteryLevel || []).map(point => ({ recorded_at: point.recorded_at, value: Number(point.value) })).filter(point => Number.isFinite(point.value));
      const socSeries = (battery.Soc || []).map(point => ({ recorded_at: point.recorded_at, value: Number(point.value) })).filter(point => Number.isFinite(point.value));
      this.setData({ drives, charges, energy, dailyBars, dailyDriveDays, dailyWidth: Math.max(620, dailyBars.length * 66), batterySeries, socSeries,
        hasMore: Boolean(driveResult.has_more), nextBefore: driveResult.next_before || null,
        dailyBatteryUse: this.percentSum(energy.drives || [], "start_battery_level", "end_battery_level", true),
        dailyBatteryAdded: this.percentSum(energy.charging_sessions || [], "start_battery_level", "end_battery_level", false)
      }, () => { this.drawBatteryChart(); this.drawDailyDriveCharts(); });
    }).catch(error => this.setData({ error: error.message || "历史数据读取失败" })).finally(() => this.setData({ loading: false, loadingMore: false }));
  },
  percentSum(rows, startKey, endKey, decrease) {
    const sum = rows.reduce((total, item) => {
      const a = Number(item[startKey]); const b = Number(item[endKey]);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return total;
      return total + (decrease ? Math.max(0, a - b) : Math.max(0, b - a));
    }, 0);
    return sum.toFixed(1);
  },
  makeDailyBars(energy) {
    const to = new Date(); to.setHours(12, 0, 0, 0);
    const fromKey = energy.range_start || daysFor(this.data.range) || dayKey(to);
    const from = new Date(`${fromKey}T12:00:00`);
    const spanDays = Math.max(1, Math.ceil((to - from) / 86400000) + 1);
    const start = new Date(to); start.setDate(start.getDate() - spanDays + 1);
    const keys = [];
    for (let cursor = new Date(start); cursor <= to; cursor.setDate(cursor.getDate() + 1)) keys.push(dayKey(cursor));
    const drives = new Map(); const charges = new Map();
    (energy.drives || []).forEach(item => {
      const key = dayKey(new Date(item.started_at)); drives.set(key, (drives.get(key) || 0) + Number(item.energy_used_kwh || 0));
    });
    (energy.charging_sessions || []).forEach(item => {
      const key = dayKey(new Date(item.started_at)); charges.set(key, (charges.get(key) || 0) + Number(item.energy_added_kwh || 0));
    });
    const max = Math.max(1, ...keys.flatMap(key => [drives.get(key) || 0, charges.get(key) || 0]));
    return keys.map((key, index) => {
      const drive = drives.get(key) || 0; const charge = charges.get(key) || 0;
      const date = new Date(`${key}T12:00:00`);
      return { day: key, label: index % 3 === 0 || index === keys.length - 1 ? `${date.getMonth() + 1}/${date.getDate()}` : "", driveHeight: Math.round(drive / max * 210), chargeHeight: Math.round(charge / max * 210), driveLabel: drive ? drive.toFixed(1) : "", chargeLabel: charge ? charge.toFixed(1) : "" };
    });
  },
  makeDailyDriveDays(energy) {
    const to = new Date(); to.setHours(12, 0, 0, 0);
    const fromKey = energy.range_start || daysFor(this.data.range) || dayKey(to);
    const from = new Date(`${fromKey}T12:00:00`);
    const spanDays = Math.max(1, Math.ceil((to - from) / 86400000) + 1);
    const start = new Date(to); start.setDate(start.getDate() - spanDays + 1);
    const byDay = new Map();
    (energy.drives || []).forEach(item => {
      const key = dayKey(new Date(item.started_at));
      const current = byDay.get(key) || { distance: 0, duration: 0, energy: 0 };
      const distance = Number(item.distance_km);
      const used = Number(item.energy_used_kwh);
      const duration = item.ended_at ? (new Date(item.ended_at) - new Date(item.started_at)) / 60000 : 0;
      if (Number.isFinite(distance)) current.distance += distance;
      if (Number.isFinite(used)) current.energy += used;
      if (Number.isFinite(duration) && duration > 0) current.duration += duration;
      byDay.set(key, current);
    });
    const days = [];
    for (let cursor = new Date(start); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
      const key = dayKey(cursor); const values = byDay.get(key) || { distance: 0, duration: 0, energy: 0 };
      days.push({ day: key, label: `${cursor.getMonth() + 1}/${cursor.getDate()}`, ...values });
    }
    return days;
  },
  drawDailyDriveCharts() {
    if (this.data.section !== "dailyDrives") return;
    const days = this.data.dailyDriveDays || [];
    const labels = days.map(item => item.label);
    const makePoints = key => days.map(item => ({ value: item[key] }));
    const common = { page: this, width: 320, height: 168, min: 0, labels };
    drawLine("dailyDriveDistance", [{ points: makePoints("distance"), color: "#418cc8" }], { ...common, unit: " km", showXAxis: false });
    drawLine("dailyDriveDuration", [{ points: makePoints("duration"), color: "#e8a23a" }], { ...common, unit: " 分", showXAxis: false });
    drawLine("dailyDriveEnergy", [{ points: makePoints("energy"), color: "#e82127" }], { ...common, unit: " kWh" });
  },
  drawBatteryChart() {
    if (this.data.section !== "battery") return;
    const first = this.data.batterySeries || []; const second = this.data.socSeries || [];
    const all = [...first, ...second];
    if (!all.length) return drawLine("batteryTrend", [], { page: this });
    const times = [...new Set(all.map(item => item.recorded_at))].sort();
    let b = null; let s = null;
    const bMap = new Map(first.map(item => [item.recorded_at, item.value])); const sMap = new Map(second.map(item => [item.recorded_at, item.value]));
    const seriesA=[]; const seriesB=[];
    times.forEach(time => { if (bMap.has(time)) b=bMap.get(time); if (sMap.has(time)) s=sMap.get(time); seriesA.push({ value:b }); seriesB.push({ value:s }); });
    drawLine("batteryTrend", [{ points:seriesA, color:"#e82127" }, { points:seriesB, color:"#418cc8" }], { page:this, width:320, height:190, unit:"%", startLabel:"较早", endLabel:"最近" });
  },
  loadMore() {
    if (!this.data.hasMore || !this.data.nextBefore) return;
    this.setData({ loadingMore: true });
    api.request("drive-history", { data: { before: this.data.nextBefore } }).then(result => {
      const older = (result.drives || []).map(item => ({ ...item, startedLabel:timeLabel(item.started_at), durationLabel:durationLabel(item.started_at,item.ended_at), distanceLabel:item.distance_km == null ? "里程暂无" : `${Number(item.distance_km).toFixed(1)} km`, energyLabel:item.energy_used_kwh == null ? "耗电暂无" : `${Number(item.energy_used_kwh).toFixed(2)} kWh` }));
      this.setData({ drives:this.data.drives.concat(older), hasMore:Boolean(result.has_more), nextBefore:result.next_before || null });
    }).catch(error => this.setData({ error:error.message })).finally(() => this.setData({ loadingMore:false }));
  },
  openDrive(event) { wx.navigateTo({ url:`/pages/drive-detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` }); }
});
