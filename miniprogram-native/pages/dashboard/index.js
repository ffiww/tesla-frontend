const api = require("../../utils/api");
const { drawRing } = require("../../utils/chart");

const dateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const display = (value, suffix = "") => value == null || !Number.isFinite(Number(value)) ? "—" : `${Math.round(Number(value))}${suffix}`;

Page({
  data: {
    authorized: false, tokenInput: "", loading: false, waking: false,
    online: false, sleeping: false, vehicle: {}, snapshot: null, error: "",
    updatedLabel: "暂无同步数据", batteryText: "—", rangeText: "—", chargeLabel: "状态未知",
    chargeRateText: "—", minutesText: "—", odometerText: "—", temperatureText: "—",
    lockedText: "—", hasLocation: false, mapLatitude: 0, mapLongitude: 0,
    markers: [], locationTitle: "暂无可用位置", locationSubtitle: "车辆尚未同步位置", locationUpdatedLabel: ""
  },

  onLoad() {
    if (api.hasToken()) { this.setData({ authorized: true }); this.refresh(); }
  },
  onReady() { this.drawBattery(); },
  onPullDownRefresh() { this.refresh().finally(() => wx.stopPullDownRefresh()); },
  onTokenInput(event) { this.setData({ tokenInput: event.detail.value }); },
  connect() {
    const token = this.data.tokenInput.trim();
    if (!token) { this.setData({ error: "请先粘贴网页生成的连接令牌" }); return; }
    api.saveToken(token);
    this.setData({ authorized: true, error: "" });
    this.refresh();
  },
  refresh() {
    if (!api.hasToken()) return Promise.resolve();
    this.setData({ loading: true, error: "" });
    return api.request("vehicle-status").then(result => {
      const snapshot = result.snapshot || {};
      const online = result.vehicle?.state === "online";
      const chargingNames = { Charging: "正在充电", Complete: "充电完成", Disconnected: "未连接充电器", NoPower: "已连接 · 无电流", Stopped: "充电已停止" };
      const lat = Number(snapshot.latitude);
      const lon = Number(snapshot.longitude);
      const hasLocation = Number.isFinite(lat) && Number.isFinite(lon);
      const time = snapshot.capturedAt ? dateFormatter.format(new Date(snapshot.capturedAt)) : "暂无同步数据";
      this.setData({
        vehicle: result.vehicle || {}, snapshot, online, sleeping: Boolean(result.sleeping),
        updatedLabel: `更新于 ${time}`, batteryText: display(snapshot.batteryLevel, "%"),
        rangeText: display(snapshot.batteryRangeKm, " km"),
        chargeLabel: online ? (chargingNames[snapshot.chargingState] || snapshot.chargingState || "状态未知") : "—",
        chargeRateText: snapshot.chargingState === "Charging" ? display(snapshot.chargeRateKmH, " km/h") : "—",
        minutesText: snapshot.chargingState === "Charging" && Number(snapshot.minutesToFullCharge) > 0 ? `约 ${Math.max(1, Math.round(Number(snapshot.minutesToFullCharge)))} 分钟` : "—",
        odometerText: display(snapshot.odometerKm, " km"),
        temperatureText: `${display(snapshot.insideTempC, "°")} / ${display(snapshot.outsideTempC, "°")}`,
        lockedText: snapshot.locked == null ? "—" : snapshot.locked ? "已锁车" : "未锁车",
        hasLocation, mapLatitude: hasLocation ? lat : 0, mapLongitude: hasLocation ? lon : 0,
        markers: hasLocation ? [{ id: 1, latitude: lat, longitude: lon, width: 28, height: 34, callout: { content: "车辆位置", display: "ALWAYS", padding: 8, borderRadius: 8 } }] : [],
        locationTitle: hasLocation ? "车辆位置已获取" : "暂无可用位置",
        locationSubtitle: hasLocation ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : "车辆重新上线后会同步位置",
        locationUpdatedLabel: snapshot.locationUpdatedAt ? `位置更新于 ${dateFormatter.format(new Date(snapshot.locationUpdatedAt))}` : "",
        error: result.error && !online ? result.error : ""
      });
      this.drawBattery();
      if (hasLocation) {
        const coordinate = this.gcjLocation(lat, lon).join(",");
        api.request("location-name", { data: { location: coordinate } }).then(place => {
          this.setData({
            locationTitle: place.name || "车辆位置已获取",
            locationSubtitle: place.formattedAddress || `${lat.toFixed(5)}, ${lon.toFixed(5)}`
          });
        }).catch(() => undefined);
      }
    }).catch(error => {
      this.setData({ error: error.message || "车况读取失败" });
      if (error.message.includes("连接已过期")) this.setData({ authorized: false });
    }).finally(() => this.setData({ loading: false }));
  },
  drawBattery() {
    const snapshot = this.data.snapshot || {};
    drawRing("batteryRing", snapshot.batteryLevel, snapshot.batteryRangeKm, this);
  },
  gcjLocation(latitude, longitude) {
    const x = longitude - 105; const y = latitude - 35;
    if (longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271) return [longitude, latitude];
    const a = 6378245; const ee = 0.00669342162296594323;
    let dLat = -100 + 2*x + 3*y + .2*y*y + .1*x*y + .2*Math.sqrt(Math.abs(x));
    dLat += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;
    dLat += (20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3;
    dLat += (160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
    let dLon = 300 + x + 2*y + .1*x*x + .1*x*y + .1*Math.sqrt(Math.abs(x));
    dLon += (20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3;
    dLon += (20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3;
    dLon += (150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3;
    const rad = latitude / 180 * Math.PI; const magic = 1 - ee*Math.sin(rad)**2; const root = Math.sqrt(magic);
    dLat = dLat*180/((a*(1-ee))/(magic*root)*Math.PI);
    dLon = dLon*180/(a/root*Math.cos(rad)*Math.PI);
    return [longitude+dLon, latitude+dLat];
  },
  wake() {
    this.setData({ waking: true, error: "" });
    api.request("wake-up", { method: "POST" }).then(() => {
      wx.showToast({ title: "已发送唤醒请求", icon: "none" });
      setTimeout(() => this.refresh(), 4500);
    }).catch(error => this.setData({ error: error.message })).finally(() => this.setData({ waking: false }));
  },
  openHistory() { wx.switchTab({ url: "/pages/history/index" }); },
  disconnect() { api.removeToken(); this.setData({ authorized: false, snapshot: null }); }
});
