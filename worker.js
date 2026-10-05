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

const FIAT_LIST = ["AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN", "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL", "BSD", "BTN", "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC", "CUP", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL", "HTG", "HUF", "IDR", "ILS", "INR", "IQD", "IRR", "ISK", "JMD", "JOD", "JPY", "KES", "KGS", "KHR", "KMF", "KPW", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD", "SCR", "SDG", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD", "SSP", "STN", "SVC", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH", "UGX", "USD", "UYU", "UZS", "VED", "VES", "VND", "VUV", "WST", "XAF", "XCD", "XOF", "XPF", "YER", "ZAR", "ZMW", "ZWG"];

async function getRates(base) {
  base = (base || "USD").toUpperCase();
  const now = Date.now();
  const hit = _rateCache[base];
  if (hit && now - hit.ts < 6 * 3600 * 1000) return hit.data;

  let data = null;
  // 主：jsdelivr currency-api（全球法币全覆盖）
  try {
    const r = await fetch(
      "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/" +
        base.toLowerCase() +
        ".json"
    );
    if (r.ok) {
      const j = await r.json();
      const raw = j && j[base.toLowerCase()];
      if (raw) {
        const rates = {};
        for (const c of FIAT_LIST) {
          const v = raw[c.toLowerCase()];
          if (typeof v === "number" && v > 0) rates[c] = v;
        }
        if (Object.keys(rates).length > 20) {
          data = { base: base, rates: rates, date: j.date, source: "currency-api" };
        }
      }
    }
  } catch (e) {}
  // 备：frankfurter（欧洲央行汇率，约 30 种主要货币）
  if (!data) {
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
  }
  if (!data) throw new Error("汇率接口暂不可用");
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
.tabs{display:flex;border-radius:999px;padding:4px;margin:2px 0 4px;background:rgba(255,255,255,.34);-webkit-backdrop-filter:blur(30px) saturate(200%);backdrop-filter:blur(30px) saturate(200%);border:1px solid rgba(255,255,255,.8);box-shadow:0 8px 28px rgba(60,60,90,.14)}
.tabs button{flex:1;border:none;background:none;padding:10px;font-size:15px;font-weight:600;color:#3a3a3c;border-radius:999px;cursor:pointer}
.tabs button.on{background:rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(60,60,90,.16);color:#1c1c1e}
.dim-row{display:flex;gap:8px;align-items:center}
.dim-row input{flex:1;min-width:0;padding:12px 6px;font-size:18px;font-weight:600;background:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.8);border-radius:12px;outline:none;color:#1c1c1e;text-align:center;font-variant-numeric:tabular-nums}
.dim-row input::placeholder{color:#aeaeb2;font-weight:400}
.unit-toggle{display:flex;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.8);flex:none}
.unit-toggle button{border:none;background:rgba(255,255,255,.35);padding:12px 13px;font-size:14px;font-weight:600;color:#636366;cursor:pointer}
.unit-toggle button.on{background:#007aff;color:#fff}
.stat{display:flex;justify-content:space-between;align-items:baseline;font-size:15px;margin:13px 0;position:relative;z-index:1;color:#3a3a3c}
.stat b{font-size:19px;font-variant-numeric:tabular-nums;color:#1c1c1e}
.stat.big{border-top:1px solid rgba(0,0,0,.08);padding-top:15px;margin-top:15px}
.stat.big b{font-size:28px;color:#007aff}
</style>
</head>
<body>
<div class="screen">
  <header><h1>汇率速算</h1><p>跨境卖家随手换算</p></header>
  <div class="tabs">
    <button id="tabBtnFx" class="on">汇率</button>
    <button id="tabBtnShip">物流</button>
  </div>
  <section id="tabFx">
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
  </section>
  <section id="tabShip" class="hidden">
    <div class="card">
      <div class="lbl">包裹尺寸</div>
      <div class="dim-row">
        <input id="dL" type="number" inputmode="decimal" min="0" placeholder="长">
        <input id="dW" type="number" inputmode="decimal" min="0" placeholder="宽">
        <input id="dH" type="number" inputmode="decimal" min="0" placeholder="高">
        <div class="unit-toggle" id="dimUnit"><button data-u="cm" class="on">cm</button><button data-u="in">inch</button></div>
      </div>
      <div class="lbl" style="margin-top:14px">实际重量</div>
      <div class="dim-row">
        <input id="dWt" type="number" inputmode="decimal" min="0" placeholder="重量">
        <div class="unit-toggle" id="wtUnit"><button data-u="kg" class="on">kg</button><button data-u="lb">lb</button></div>
      </div>
    </div>
    <div class="card">
      <div class="stat"><span>体积</span><b id="rCbm">—</b></div>
      <div class="stat"><span>体积重（快递 ÷5000）</span><b id="rVol5">—</b></div>
      <div class="stat"><span>体积重（空运 ÷6000）</span><b id="rVol6">—</b></div>
      <div class="stat big"><span>计费重</span><b id="rChg">—</b></div>
      <div class="meta">计费重按快递口径（÷5000）：实际重量与体积重取大者</div>
    </div>
  </section>
  <div class="foot">汇率每日更新 · 仅供参考，实际以银行成交价为准</div>
</div>
<script>
var CURS = [
  ["USD","美元","$"],
  ["CNY","人民币","¥"],
  ["EUR","欧元","€"],
  ["GBP","英镑","£"],
  ["JPY","日元","¥"],
  ["HKD","港币","HK$"],
  ["AUD","澳元","A$"],
  ["CAD","加元","C$"],
  ["SGD","新加坡元","S$"],
  ["KRW","韩元","₩"],
  ["TWD","台币","NT$"],
  ["THB","泰铢","฿"],
  ["CHF","瑞士法郎","CHF"],
  ["NZD","新西兰元","NZ$"],
  ["MXN","墨西哥比索","MX$"],
  ["INR","印度卢比","₹"],
  ["VND","越南盾","₫"],
  ["IDR","印尼盾","Rp"],
  ["MYR","马来西亚令吉","RM"],
  ["PHP","菲律宾比索","₱"],
  ["AED","阿联酋迪拉姆","AED"],
  ["BRL","巴西雷亚尔","R$"],
  ["ZAR","南非兰特","R"],
  ["AFN","Afghan Afghani",""],
  ["ALL","Albanian Lek",""],
  ["AMD","Armenian Dram",""],
  ["ANG","Dutch Guilder",""],
  ["AOA","Angolan Kwanza",""],
  ["ARS","阿根廷比索",""],
  ["AWG","Aruban or Dutch Guilder",""],
  ["AZN","Azerbaijan Manat",""],
  ["BAM","Bosnian Convertible Mark",""],
  ["BBD","Barbadian or Bajan Dollar",""],
  ["BDT","孟加拉塔卡",""],
  ["BGN","保加利亚列弗",""],
  ["BHD","Bahraini Dinar",""],
  ["BIF","Burundian Franc",""],
  ["BMD","Bermudian Dollar",""],
  ["BND","Bruneian Dollar",""],
  ["BOB","Bolivian Bolíviano",""],
  ["BSD","Bahamian Dollar",""],
  ["BTN","Bhutanese Ngultrum",""],
  ["BWP","Botswana Pula",""],
  ["BYN","Belarusian Ruble",""],
  ["BZD","Belizean Dollar",""],
  ["CDF","Congolese Franc",""],
  ["CLP","智利比索",""],
  ["COP","哥伦比亚比索",""],
  ["CRC","Costa Rican Colon",""],
  ["CUP","Cuban Peso",""],
  ["CVE","Cape Verdean Escudo",""],
  ["CZK","捷克克朗","Kč"],
  ["DJF","Djiboutian Franc",""],
  ["DKK","丹麦克朗","kr"],
  ["DOP","Dominican Peso",""],
  ["DZD","Algerian Dinar",""],
  ["EGP","埃及镑",""],
  ["ERN","Eritrean Nakfa",""],
  ["ETB","Ethiopian Birr",""],
  ["FJD","Fijian Dollar",""],
  ["FKP","Falkland Island Pound",""],
  ["GEL","Georgian Lari",""],
  ["GHS","Ghanaian Cedi",""],
  ["GIP","Gibraltar Pound",""],
  ["GMD","Gambian Dalasi",""],
  ["GNF","Guinean Franc",""],
  ["GTQ","Guatemalan Quetzal",""],
  ["GYD","Guyanese Dollar",""],
  ["HNL","Honduran Lempira",""],
  ["HTG","Haitian Gourde",""],
  ["HUF","匈牙利福林",""],
  ["ILS","以色列新谢克尔","₪"],
  ["IQD","Iraqi Dinar",""],
  ["IRR","Iranian Rial",""],
  ["ISK","Icelandic Krona",""],
  ["JMD","Jamaican Dollar",""],
  ["JOD","Jordanian Dinar",""],
  ["KES","肯尼亚先令",""],
  ["KGS","Kyrgyzstani Som",""],
  ["KHR","柬埔寨瑞尔",""],
  ["KMF","Comorian Franc",""],
  ["KPW","North Korean Won",""],
  ["KWD","科威特第纳尔",""],
  ["KYD","Caymanian Dollar",""],
  ["KZT","Kazakhstani Tenge",""],
  ["LAK","老挝基普",""],
  ["LBP","Lebanese Pound",""],
  ["LKR","斯里兰卡卢比",""],
  ["LRD","Liberian Dollar",""],
  ["LSL","Basotho Loti",""],
  ["LYD","Libyan Dinar",""],
  ["MAD","Moroccan Dirham",""],
  ["MDL","Moldovan Leu",""],
  ["MGA","Malagasy Ariary",""],
  ["MKD","Macedonian Denar",""],
  ["MMK","缅甸缅元",""],
  ["MNT","Mongolian Tughrik",""],
  ["MOP","澳门元",""],
  ["MRU","Mauritanian Ouguiya",""],
  ["MUR","Mauritian Rupee",""],
  ["MVR","Maldivian Rufiyaa",""],
  ["MWK","Malawian Kwacha",""],
  ["MZN","Mozambican Metical",""],
  ["NAD","Namibian Dollar",""],
  ["NGN","尼日利亚奈拉",""],
  ["NIO","Nicaraguan Cordoba",""],
  ["NOK","挪威克朗","kr"],
  ["NPR","Nepalese Rupee",""],
  ["OMR","阿曼里亚尔",""],
  ["PAB","Panamanian Balboa",""],
  ["PEN","秘鲁索尔",""],
  ["PGK","Papua New Guinean Kina",""],
  ["PKR","巴基斯坦卢比",""],
  ["PLN","波兰兹罗提","zł"],
  ["PYG","Paraguayan Guarani",""],
  ["QAR","卡塔尔里亚尔",""],
  ["RON","罗马尼亚列伊",""],
  ["RSD","Serbian Dinar",""],
  ["RUB","俄罗斯卢布","₽"],
  ["RWF","Rwandan Franc",""],
  ["SAR","沙特里亚尔","﷼"],
  ["SBD","Solomon Islander Dollar",""],
  ["SCR","Seychellois Rupee",""],
  ["SDG","Sudanese Pound",""],
  ["SEK","瑞典克朗","kr"],
  ["SHP","Saint Helenian Pound",""],
  ["SLE","Sierra Leonean Leone",""],
  ["SOS","Somali Shilling",""],
  ["SRD","Surinamese Dollar",""],
  ["SSP","South Sudanese Pound",""],
  ["STN","Sao Tomean Dobra",""],
  ["SVC","Salvadoran Colon",""],
  ["SYP","Syrian Pound",""],
  ["SZL","Swazi Lilangeni",""],
  ["TJS","Tajikistani Somoni",""],
  ["TMT","Turkmenistani Manat",""],
  ["TND","Tunisian Dinar",""],
  ["TOP","Tongan Pa'anga",""],
  ["TRY","土耳其里拉","₺"],
  ["TTD","Trinidadian Dollar",""],
  ["TZS","Tanzanian Shilling",""],
  ["UAH","乌克兰格里夫纳",""],
  ["UGX","Ugandan Shilling",""],
  ["UYU","Uruguayan Peso",""],
  ["UZS","Uzbekistani Som",""],
  ["VED","",""],
  ["VES","Venezuelan Bolívar",""],
  ["VUV","Ni-Vanuatu Vatu",""],
  ["WST","Samoan Tala",""],
  ["XAF","Central African CFA Franc BE",""],
  ["XCD","East Caribbean Dollar",""],
  ["XOF","CFA Franc",""],
  ["XPF","CFP Franc",""],
  ["YER","Yemeni Rial",""],
  ["ZMW","Zambian Kwacha",""],
  ["ZWG","",""]
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
/* ---- 物流尺寸/重量 ---- */
$("tabBtnFx").onclick = function(){ showTab("Fx"); };
$("tabBtnShip").onclick = function(){ showTab("Ship"); };
function showTab(t){
  $("tabBtnFx").classList.toggle("on", t === "Fx");
  $("tabBtnShip").classList.toggle("on", t === "Ship");
  $("tabFx").classList.toggle("hidden", t !== "Fx");
  $("tabShip").classList.toggle("hidden", t !== "Ship");
}
var dimU = "cm", wtU = "kg";
function bindToggle(id, cb){
  var box = $(id), btns = box.querySelectorAll("button");
  for(var i=0;i<btns.length;i++){ (function(b){ b.onclick = function(){
    for(var j=0;j<btns.length;j++) btns[j].classList.remove("on");
    b.classList.add("on"); cb(b.getAttribute("data-u"));
  }; })(btns[i]); }
}
bindToggle("dimUnit", function(u){ dimU = u; calcShip(); });
bindToggle("wtUnit", function(u){ wtU = u; calcShip(); });
["dL","dW","dH","dWt"].forEach(function(id){ $(id).addEventListener("input", calcShip); });
function kgLb(kg){ return kg.toFixed(2) + " kg / " + (kg * 2.20462262).toFixed(2) + " lb"; }
function calcShip(){
  var L = parseFloat($("dL").value) || 0, W = parseFloat($("dW").value) || 0, H = parseFloat($("dH").value) || 0;
  var wt = parseFloat($("dWt").value) || 0;
  if(dimU === "in"){ L *= 2.54; W *= 2.54; H *= 2.54; }
  if(wtU === "lb"){ wt *= 0.45359237; }
  if(!(L > 0 && W > 0 && H > 0)){
    $("rCbm").textContent = "—"; $("rVol5").textContent = "—"; $("rVol6").textContent = "—";
    $("rChg").textContent = wt > 0 ? kgLb(wt) : "—";
    return;
  }
  var cbm = L * W * H / 1e6;
  var v5 = L * W * H / 5000, v6 = L * W * H / 6000;
  $("rCbm").textContent = (cbm < 0.01 ? cbm.toFixed(4) : cbm.toFixed(3)) + " m³";
  $("rVol5").textContent = kgLb(v5);
  $("rVol6").textContent = kgLb(v6);
  $("rChg").textContent = kgLb(Math.max(wt, v5));
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
