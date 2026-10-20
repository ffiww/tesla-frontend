# Tesla 车况微信小程序（原生）

这是 `tesla.ffiww.com` 仪表盘的原生微信小程序客户端，不使用 WebView。页面通过现有的 `https://tesla.ffiww.com/api/tesla/energy-history/miniprogram/*` 路由读取同一套车况、行程和能耗数据，不新增 Vercel Serverless Function。

## 页面

- 车况首页：在线状态、电量/续航、充电状态、位置、里程、温度和锁车状态。
- 历史：可切换行程、每日能耗/充电趋势，并选择历史周期。
- 行程详情：行程指标、速度/电量趋势和地图轨迹；轨迹按速度由柔和红色渐变到柔和绿色。

图表使用小程序原生 Canvas 绘制，地图使用小程序原生 `map` 组件。数据缺失时显示空状态，不填充模拟车况。

## 导入与首次连接

1. 用微信开发者工具导入本目录。
2. `project.config.json` 已填入你此前创建小程序时选中的 AppID；如项目实际使用另一个 AppID，请在微信开发者工具中改为对应值。
3. 在已登录 Tesla 仪表盘的浏览器中打开 `https://tesla.ffiww.com/api/tesla/energy-history/miniprogram/session`，复制返回的短期令牌。
4. 在小程序连接页粘贴令牌。令牌有效期 24 小时，过期后在网页重新生成并粘贴。
5. 提交/体验版前，在微信公众平台把 `https://tesla.ffiww.com` 加入小程序 request 合法域名。

不要把 Tesla OAuth Token、`INTERNAL_API_SECRET`、Neon 数据库地址或 Tesla 私钥放进小程序。

## API 兼容

令牌校验与请求代理位于 `lib/miniprogram-proxy.ts`，由现有的 `app/api/tesla/energy-history/[[...path]]/route.ts` 分发；仅代理既有的 vehicle-status、drive-history、energy-history、wake-up 接口及位置逆地理编码。其余路径和请求方式均拒绝。
