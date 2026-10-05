/**
 * 汇率速算 fxcalc —— 跨境卖家用的极简汇率换算，纯 Cloudflare Worker 部署
 *
 * 架构：Worker 内嵌单文件前端，无需 R2/KV、无需任何密钥
 * 汇率：frankfurter.app（主）→ jsdelivr currency-api（备），服务端缓存 6 小时
 * 部署：GitHub 仓库 + Workers Git 集成，push 即自动上线
 */

// ---------------- 汇率 ----------------
// 内存缓存：每个基准货币缓存 6 小时
let _rateCache = {};

async function getRates(base) {
  base = (base || "USD").toUpperCase();
  const now = Date.now();
  const hit = _rateCache[base];
  if (hit && now - hit.ts < 6 * 3600 * 1000) return hit.data;

  let data = null;
  // 主：frankfurter（欧洲央行汇率，干净）
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=" + base, {
      redirect: "follow",
      headers: { "User-Agent": "fxcalc/1.0" },
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.rates) data = { base: j.base, rates: j.rates, date: j.date, source: "frankfurter" };
    }
  } catch (e) {}
  // 备：jsdelivr currency-api
  if (!data) {
    try {
      const r = await fetch(
        "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/" +
          base.toLowerCase() +
          ".json"
      );
      if (r.ok) {
        const j = await r.json();
        const rates = j && j[base.toLowerCase()];
        if (rates) data = { base: base, rates: rates, date: j.date, source: "currency-api" };
      }
    } catch (e) {}
  }
  if (!data) throw new Error("汇率接口暂不可用");
  // frankfurter 不返回基准货币自身，补上 1
  data.rates[data.base] = 1;
  _rateCache[base] = { ts: now, data: data };
  return data;
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// ---------------- 前端页面（iOS 液态玻璃风） ----------------
const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>汇率速算</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",sans-serif;color:#1c1c1e;min-height:100vh;-webkit-font-smoothing:antialiased;background:linear-gradient(180deg,#b9cdf5 0%,#dfc2f2 52%,#bfe9da 100%)}
body::before{content:"";position:fixed;inset:-60px;z-index:0;pointer-events:none;background:radial-gradient(620px 460px at 12% 8%,rgba(0,110,255,.6),transparent 62%),radial-gradient(580px 560px at 88% 18%,rgba(170,60,220,.55),transparent 62%),radial-gradient(700px 520px at 55% 95%,rgba(60,190,250,.5),transparent 62%),radial-gradient(480px 460px at 82% 78%,rgba(255,130,0,.42),transparent 62%),radial-gradient(520px 420px at 30% 60%,rgba(40,200,90,.32),transparent 62%);animation:drift 22s ease-in-out infinite}
@keyframes drift{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(50px,-36px) scale(1.08)}}
.hidden{display:none!important}
.screen{max-width:560px;margin:0 auto;padding:12px 16px 60px;position:relative;z-index:1}
header{padding:22px 6px 14px}
header h1{font-size:34px;font-weight:700;margin:0;letter-spacing:1px;text-shadow:0 1px 0 rgba(255,255,255,.6)}
header p{margin:6px 0 0;font-size:14px;color:#636366}
.card{position:relative;background:rgba(255,255,255,.34);-webkit-backdrop-filter:blur(30px) saturate(200%);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.8);border-radius:24px;padding:20px;margin-top:14px;box-shadow:0 8px 28px rgba(60,60,90,.14),inset 0 1px 1px rgba(255,255,255,.95),inset 0 -1px 0 rgba(255,255,255,.25);overflow:hidden}
.card::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.65),rgba(255,255,255,0) 42%)}
.card>*{position:relative;z-index:1}
.lbl{font-size:13px;color:#636366;margin-bottom:8px;letter-spacing:1px}
.big-input{width:100%;padding:6px 2px;font-size:44px;font-weight:700;background:transparent;border:none;outline:none;color:#1c1c1e;font-variant-numeric:tabular-nums}
.big-input::placeholder{color:#aeaeb2}
.chips{display:flex;gap:8px;margin:12px 0 4px;flex-wrap:wrap}
.chips button{border:1px solid rgba(255,255,255,.8);background:rgba(255,255,255,.45);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-radius:999px;padding:7px 14px;font-size:14px;font-weight:600;color:#1c1c1e;cursor:pointer}
.chips button:active{background:rgba(255,255,255,.8)}
.pair{display:flex;gap:10px;align-items:stretch;margin-top:14px}
.pair select{flex:1;min-width:0;padding:13px 10px;font-size:16px;font-weight:600;border:1px solid rgba(255,255,255,.8);border-radius:14px;background:rgba(255,255,255,.5);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#1c1c1e;outline:none;cursor:pointer}
#swap{width:52px;flex:none;border:1px solid rgba(255,255,255,.8);border-radius:14px;background:rgba(0,122,255,.14);color:#007aff;font-size:22px;cursor:pointer;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
#swap:active{background:rgba(0,122,255,.28)}
.result-num{font-size:46px;font-weight:700;margin:4px 0 8px;font-variant-numeric:tabular-nums;word-break:break-all}
.result-num small{font-size:20px;font-weight:600;color:#636366}
.rate-line{font-size:15px;font-weight:600;color:#1c1c1e}
.meta{font-size:12px;color:#636366;margin-top:10px}
.err{color:#ff3b30;font-size:14px;margin-top:12px;min-height:20px}
.foot{text-align:center;font-size:12px;color:#8e8e93;margin-top:26px;text-shadow:0 1px 0 rgba(255,255,255,.5)}
</style>
</head>
<body>
<div class="screen">
  <header><h1>汇率速算</h1><p>跨境卖家随手换算</p></header>
  <div class="card">
    <div class="lbl">金额</div>
    <input id="amount" class="big-input" type="number" inputmode="decimal" min="0" placeholder="0" value="100">
    <div class="chips" id="chips"></div>
    <div class="pair">
      <select id="fromSel"></select>
      <button id="swap" title="互换">⇄</button>
      <select id="toSel"></select>
    </div>
    <div class="err" id="err"></div>
  </div>
  <div class="card">
    <div class="rate-line" id="rateLine">—</div>
    <div class="result-num" id="result">—</div>
    <div class="meta" id="updated"></div>
  </div>
  <div class="foot">汇率每日更新 · 仅供参考，实际以银行成交价为准</div>
</div>
<script>
var CURS = [
  ["USD","美元","$"],["CNY","人民币","¥"],["EUR","欧元","€"],["GBP","英镑","£"],
  ["JPY","日元","¥"],["HKD","港币","HK$"],["AUD","澳元","A$"],["CAD","加元","C$"],
  ["SGD","新元","S$"],["KRW","韩元","₩"],["TWD","台币","NT$"],["THB","泰铢","฿"],
  ["CHF","瑞郎","CHF"],["NZD","纽元","NZ$"],["MXN","墨西哥比索","MX$"],["INR","印度卢比","₹"],
  ["VND","越南盾","₫"],["IDR","印尼盾","Rp"],["MYR","马来西亚令吉","RM"],["PHP","菲律宾比索","₱"],
  ["AED","迪拉姆","AED"],["BRL","雷亚尔","R$"],["ZAR","兰特","R"]
];
var $ = function(id){ return document.getElementById(id); };
var rates = {}, base = "USD";
function sym(code){ for(var i=0;i<CURS.length;i++) if(CURS[i][0]===code) return CURS[i][2]; return code; }
function fillSel(sel, val){
  var h = "";
  for(var i=0;i<CURS.length;i++){ h += '<option value="'+CURS[i][0]+'"'+(CURS[i][0]===val?" selected":"")+'>'+CURS[i][0]+" "+CURS[i][1]+"</option>"; }
  sel.innerHTML = h;
}
function fmt(n){
  if(!isFinite(n)) return "—";
  var s = n.toLocaleString("en-US",{maximumFractionDigits: n<1?4:2});
  return s;
}
function load(baseCur){
  base = baseCur;
  $("err").textContent = "";
  fetch("/api/rates?base="+baseCur).then(function(r){ return r.json(); }).then(function(d){
    if(!d.ok){ $("err").textContent = "汇率获取失败，稍后重试"; return; }
    rates = d.rates;
    var dt = d.date ? "更新于 "+d.date : "";
    $("updated").textContent = dt;
    try{ localStorage.setItem("fx_base", base); }catch(e){}
    convert();
  }).catch(function(){ $("err").textContent = "汇率获取失败，稍后重试"; });
}
function convert(){
  var amt = parseFloat($("amount").value);
  var f = $("fromSel").value, t = $("toSel").value;
  try{ localStorage.setItem("fx_pair", f+":"+t); }catch(e){}
  if(!(amt >= 0) || !rates[t]){ $("result").innerHTML = "—"; $("rateLine").textContent = "—"; return; }
  var r = rates[t] / (rates[f] || 1);
  var out = amt * r;
  $("result").innerHTML = sym(t) + " " + fmt(out) + " <small>" + t + "</small>";
  $("rateLine").textContent = "1 " + f + " = " + (r < 0.01 ? r.toFixed(6) : r < 1 ? r.toFixed(4) : r.toFixed(4)) + " " + t;
}
function init(){
  var f = "USD", t = "CNY";
  try{
    var p = (localStorage.getItem("fx_pair") || "").split(":");
    if(p.length === 2){ f = p[0]; t = p[1]; }
    var b = localStorage.getItem("fx_base"); if(b) f = b;
  }catch(e){}
  fillSel($("fromSel"), f); fillSel($("toSel"), t);
  var chips = [100, 500, 1000, 10000];
  var ch = "";
  for(var i=0;i<chips.length;i++){ ch += '<button data-amt="'+chips[i]+'">'+chips[i].toLocaleString("en-US")+"</button>"; }
  $("chips").innerHTML = ch;
  var btns = $("chips").querySelectorAll("button");
  for(var j=0;j<btns.length;j++){ (function(b){ b.onclick = function(){ $("amount").value = b.getAttribute("data-amt"); convert(); }; })(btns[j]); }
  $("amount").addEventListener("input", convert);
  $("fromSel").addEventListener("change", function(){ load($("fromSel").value); });
  $("toSel").addEventListener("change", convert);
  $("swap").onclick = function(){
    var a = $("fromSel").value;
    $("fromSel").value = $("toSel").value;
    $("toSel").value = a;
    load($("fromSel").value);
  };
  load(f);
}
init();
</script>
</body>
</html>`;

// ---------------- 路由 ----------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/api/rates" && request.method === "GET") {
      const base = (url.searchParams.get("base") || "USD").toUpperCase();
      try {
        const data = await getRates(base);
        return json({ ok: true, base: data.base, rates: data.rates, date: data.date });
      } catch (e) {
        return json({ ok: false, error: "汇率接口暂不可用" }, 502);
      }
    }
    return json({ ok: false, error: "not found" }, 404);
  },
};
