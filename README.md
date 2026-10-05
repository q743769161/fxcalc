# 💱 汇率速算 fxcalc

跨境卖家用的极简汇率换算，手机打开就能算。

- **纯 Cloudflare Worker**：无需 R2/KV、无需密钥、无需登录
- **实时汇率**：frankfurter（主）→ jsdelivr currency-api（备），服务端缓存 6 小时
- **156 种全球法币**：ISO 4217 全覆盖，常用货币带中文名
- 快捷金额（100/500/1000/10000）、一键互换、记住上次币种

## 上线步骤（3 分钟）

> 代码在 GitHub，push 后 Cloudflare 自动同步部署。

1. Workers & Pages → Create → Connect to Git → 选中本仓库 → Deploy（构建设置默认）
2. 打开分配的 `*.workers.dev` 域名就能用

就这么简单，没有存储桶、没有变量要配。

## 本地开发（可选）

```bash
npx wrangler dev
```

## 文件说明

| 文件 | 说明 |
|---|---|
| `worker.js` | 全部代码：汇率 API + 内嵌前端，单文件 |
| `wrangler.toml` | Worker 配置 |
