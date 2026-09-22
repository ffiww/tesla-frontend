# Tesla 车况

独立部署的 Next.js 前端。Tesla 登录、车辆状态和唤醒请求均通过 `https://api.ffiww.com` 的服务端接口代理，前端不包含任何 Tesla Secret、Token 或数据库连接信息。

## 本地运行

```bash
npm install
npm run dev
```

## Vercel 部署

使用 Vercel 默认的 `*.vercel.app` 域名部署即可。本项目不包含自定义域名配置，也不会修改 ChatGPT Sites 的正式域名。
