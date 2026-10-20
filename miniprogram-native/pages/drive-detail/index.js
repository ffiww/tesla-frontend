const api = require("../../utils/api");
const { drawLine } = require("../../utils/chart");

const timeLabel = value => new Intl.DateTimeFormat("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" }).format(new Date(value));
function duration(start, end) {
  if (!end) return "进行中";
  const mins = Math.max(0, Math.round((new Date(end) - new Date(start)) / 60000));
  return mins >= 60 ? `${Math.floor(mins / 60)}小时${mins % 60}分钟` : `${mins}分钟`;
}
function toGcj(lon, lat) {
  const a = 6378245; const ee = 0.00669342162296594323;
  if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lon, lat];
  let dLat = transformLat(lon - 105, lat - 35); let dLon = transformLon(lon - 105, lat - 35);
  const rad = lat / 180 * Math.PI; const magic = 1 - ee * Math.sin(rad) ** 2; const sqrtMagic = Math.sqrt(magic);
  dLat = dLat * 180 / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLon = dLon * 180 / (a / sqrtMagic * Math.cos(rad) * Math.PI);
  return [lon + dLon, lat + dLat];
}
function transformLat(x,y) { let r=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x)); r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r+=(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3; r+=(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3; return r; }
function transformLon(x,y) { let r=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x)); r+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3; r+=(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3; r+=(150*Math.sin(x/12*Math.PI)+300*Math.sin(x/30*Math.PI))*2/3; return r; }
function validPoints(points) { return (points || []).filter(point => Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude))); }
function speedAt(recordedAt, speeds) {
  if (!speeds.length) return null;
  const ts = new Date(recordedAt).getTime(); let best = null; let delta = Infinity;
  speeds.forEach(item => { const d = Math.abs(new Date(item.recorded_at).getTime() - ts); if (d < delta) { delta = d; best = item.value * 1.609344; } });
  return delta <= 90000 ? best : null;
}
function speedColor(speed, max) {
  if (speed == null) return "#a4a7ac";
  const t = Math.max(0, Math.min(1, speed / max));
  const colors = [[204,133,135],[201,173,120],[125,168,141]];
  const lo = t < .5 ? colors[0] : colors[1]; const hi = t < .5 ? colors[1] : colors[2]; const p = t < .5 ? t*2 : (t-.5)*2;
  return `#${lo.map((v,i)=>Math.round(v+(hi[i]-v)*p).toString(16).padStart(2,"0")).join("")}`;
}

Page({
  data: { id:"", loading:true, error:"", drive:null, trends:{}, startedLabel:"", startName:"暂无位置名称", endName:"暂无位置名称", distanceLabel:"—", durationLabel:"—", energyLabel:"耗电 —", efficiencyLabel:"能耗效率 —", speedLabel:"最高速度 —", batteryUseLabel:"耗电 —", positionCount:0, hasRoute:false, polylines:[], markers:[], mapPoints:[], centerLatitude:22.5, centerLongitude:113.9, mapScale:15, minSpeedLabel:"0", maxSpeedLabel:"0 km/h", hasTpms:false },
  onLoad(options) { this.setData({ id:options.id || "" }); this.load(); },
  load() {
    if (!this.data.id) { this.setData({ loading:false, error:"缺少行程编号" }); return; }
    api.request("drive-history", { data:{ drive_id:this.data.id } }).then(result => {
      const drive=result.drive || {}; const positions=validPoints(result.positions); const trends=result.trends || {};
      const speed=(trends.VehicleSpeed || []).filter(p=>typeof p.value === "number").map(p=>({ recorded_at:p.recorded_at, value:Number(p.value) }));
      const speedKmh=speed.map(p=>p.value*1.609344); const maximum=Math.max(1,...speedKmh);
      const converted=positions.map(p=>({ ...p, coord:toGcj(Number(p.longitude),Number(p.latitude)) }));
      const lines=[];
      for(let i=1;i<converted.length;i++) {
        const a=converted[i-1]; const b=converted[i]; const avgA=speedAt(a.recorded_at,speed); const avgB=speedAt(b.recorded_at,speed);
        lines.push({ points:[{latitude:a.coord[1],longitude:a.coord[0]},{latitude:b.coord[1],longitude:b.coord[0]}], color:speedColor(avgA==null&&avgB==null?null:((avgA||0)+(avgB||0))/2,maximum), width:5, arrowLine:false, borderColor:"#ffffff", borderWidth:1 });
      }
      const start=converted[0]; const end=converted[converted.length-1];
      const markers=[];
      if(start) markers.push({id:1,latitude:start.coord[1],longitude:start.coord[0],width:22,height:28,callout:{content:"起点",display:"ALWAYS",padding:5,borderRadius:6}});
      if(end) markers.push({id:2,latitude:end.coord[1],longitude:end.coord[0],width:22,height:28,callout:{content:"终点",display:"ALWAYS",padding:5,borderRadius:6}});
      const startBattery=Number(drive.start_battery_level); const endBattery=Number(drive.end_battery_level);
      const batteryUse=Number.isFinite(startBattery)&&Number.isFinite(endBattery)?startBattery-endBattery:null;
      const displayTrend = key => (trends[key]||[]).map(point=>({value:Number(point.value)})).filter(point=>Number.isFinite(point.value));
      const mapPoints=converted.filter((point,index)=>index===0||index===converted.length-1||index%Math.max(1,Math.ceil(converted.length/100))===0).map(point=>({latitude:point.coord[1],longitude:point.coord[0]}));
      this.setData({ drive, trends, startedLabel:timeLabel(drive.started_at),
        distanceLabel:drive.distance_km==null?"里程暂无":`${Number(drive.distance_km).toFixed(1)} km`,
        durationLabel:duration(drive.started_at,drive.ended_at),
        energyLabel:drive.energy_used_kwh==null?"耗电暂无":`耗电 ${Number(drive.energy_used_kwh).toFixed(2)} kWh`,
        efficiencyLabel:drive.efficiency_wh_km==null?"能耗效率暂无":`能耗效率 ${Math.round(drive.efficiency_wh_km)} Wh/km`,
        speedLabel:drive.max_speed_kmh==null?"最高速度暂无":`最高速度 ${Math.round(drive.max_speed_kmh)} km/h`,
        batteryUseLabel:batteryUse==null?"耗电比例暂无":`耗电 ${batteryUse.toFixed(1)}%，${startBattery.toFixed(1)}% → ${endBattery.toFixed(1)}%`,
        positionCount:Number(result.total_position_count || positions.length), hasRoute:positions.length>1, polylines:lines, markers, mapPoints,
        centerLatitude:start&&end?(start.coord[1]+end.coord[1])/2:(start?start.coord[1]:22.5),
        centerLongitude:start&&end?(start.coord[0]+end.coord[0])/2:(start?start.coord[0]:113.9),
        mapScale:positions.length>100?14:16, minSpeedLabel:"0 km/h", maxSpeedLabel:`${Math.round(maximum)} km/h`,
        startName: drive.start_location_name || drive.startLocationName || (start ? "正在解析位置…" : "暂无位置名称"),
        endName: drive.end_location_name || drive.endLocationName || (end ? "正在解析位置…" : "暂无位置名称"),
        hasTpms:["TpmsPressureFl","TpmsPressureFr","TpmsPressureRl","TpmsPressureRr"].some(key=>(trends[key]||[]).length>0),
        chartSeries:{ speed:speed.map(p=>({value:p.value*1.609344})), battery:displayTrend("BatteryLevel"), soc:displayTrend("Soc"), lat:displayTrend("LateralAcceleration"), lon:displayTrend("LongitudinalAcceleration"), pedal:displayTrend("PedalPosition"), brake:displayTrend("BrakePedalPos"), inside:displayTrend("InsideTemp"), outside:displayTrend("OutsideTemp"), fl:displayTrend("TpmsPressureFl"), fr:displayTrend("TpmsPressureFr"), rl:displayTrend("TpmsPressureRl"), rr:displayTrend("TpmsPressureRr") }
      },()=>{
        this.drawCharts();
        if (start && !(drive.start_location_name || drive.startLocationName)) {
          const location=toGcj(Number(start.longitude),Number(start.latitude)).join(",");
          api.request("location-name",{data:{location}}).then(place=>this.setData({startName:place.name || place.formattedAddress || "位置名称暂不可用"})).catch(()=>this.setData({startName:"位置名称暂不可用"}));
        }
        if (end && !(drive.end_location_name || drive.endLocationName)) {
          const location=toGcj(Number(end.longitude),Number(end.latitude)).join(",");
          api.request("location-name",{data:{location}}).then(place=>this.setData({endName:place.name || place.formattedAddress || "位置名称暂不可用"})).catch(()=>this.setData({endName:"位置名称暂不可用"}));
        }
      });
    }).catch(error=>this.setData({error:error.message||"行程读取失败"})).finally(()=>this.setData({loading:false}));
  },
  drawCharts() {
    const charts=this.data.chartSeries||{}; const options={page:this,width:320,height:190};
    drawLine("speedChart",[{points:charts.speed||[],color:"#438cc1"}],{...options,unit:" km/h"});
    drawLine("batteryChart",[{points:charts.battery||[],color:"#e82127"},{points:charts.soc||[],color:"#418cc8"}],{...options,unit:"%"});
    drawLine("accelerationChart",[{points:charts.lat||[],color:"#e39a48"},{points:charts.lon||[],color:"#418cc8"}],{...options,unit:""});
    drawLine("pedalChart",[{points:charts.pedal||[],color:"#e39a48"},{points:charts.brake||[],color:"#e35d61"}],{...options,unit:"%"});
    drawLine("temperatureChart",[{points:charts.inside||[],color:"#e39a48"},{points:charts.outside||[],color:"#438cc1"}],{...options,unit:"°"});
    drawLine("tpmsChart",[{points:charts.fl||[],color:"#e82127"},{points:charts.fr||[],color:"#e39a48"},{points:charts.rl||[],color:"#418cc8"},{points:charts.rr||[],color:"#5caa96"}],{...options,unit:" bar"});
  }
});
