# -*- coding: utf-8 -*-
"""生成移动端登录页原型（自包含单文件 HTML，素材以 base64 内嵌）。
设计基准：432x768 逻辑画布（参考图 864x1536 @2x）。1rem = 10 设计 px。

v3.1（2026-10-16）按用户标注删除三处后重排：
  ① 忘记密码?　② 验证码登录　③ 「其他登录方式」+ 钉钉/微信/企业微信三枚社交块 + 页脚两行
  卡片改为内容自适应高度（68.8rem）+ 视口垂直居中，面板内间距重排为等距呼吸感。
  未再内嵌 icon-dingtalk/wechat/wecom.png（文件保留在 assets/ 以便随时恢复）。
"""
import base64, os

BASE = '/Users/zhouzhennan/Desktop/AI测试/AI应用/辅导员工作台/辅导员工作台git/docs/mobile-redesign/prototype/'
A = BASE + 'assets/'

def b64(name, mime):
    with open(A + name, 'rb') as f:
        return 'data:%s;base64,%s' % (mime, base64.b64encode(f.read()).decode())

HERO = b64('hero-clean.jpg', 'image/jpeg')
LOGO = b64('logo-mark.png', 'image/png')

TPL = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#E7F1FD">
<title>欢迎登录 · 知行辅导员工作台</title>
<style>
/* ============================================================
   移动端登录页 —— 1:1 复刻给定参考图
   基准画布 432 x 768（参考图 864x1536 @2x）; 1rem = 10 设计 px
   根字号随视口宽度等比缩放 → 任意设备还原同一视觉效果
   ============================================================ */
:root{
  --brand:#0F69E4;          /* 品牌蓝: 按钮/链接(参考图实测 #0F69E4) */
  --ink:#1A1A1A;            /* 主标题 */
  --ink-2:#909399;          /* 面板副标题 */
  --ph:#9B9B9F;             /* 输入占位 */
  --icon:#66686C;           /* 输入框图标 */
  --line:#EBEBED;           /* 输入框描边 */
  --agree:#5F6167;          /* 协议正文 */
  --cb-line:#A8A9AE;        /* 勾选框描边 */
  --ff:"Noto Sans SC","PingFang SC","Hiragino Sans GB","Source Han Sans SC","Microsoft YaHei",system-ui,-apple-system,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
html{
  /* 432 宽视口 → 10px；同时以 9:16 高度为上限，矮视口（如 375x600）整体再缩一档，
     保证整屏可完整呈现、不出现滚动裁切。 */
  font-size:min(calc(100vw / 43.2), calc(100dvh / 76.8), 10px);
  -webkit-text-size-adjust:100%;
}
body{
  margin:0;
  min-height:100dvh;
  display:flex;
  justify-content:center;
  font-family:var(--ff);
  -webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;
  background:radial-gradient(122% 44% at 50% 15%, #D7E9FD 0%, #E2EEFD 30%, #EDF5FE 64%, #F7FBFE 100%) #F7FBFE;
}

/* ---------- 舞台：432 宽，卡片水平 42.5 / 垂直居中 ----------
   用 .card{margin:auto} 而非 align-items:center：视口过矮时 auto 外边距归零，
   卡片退回顶部对齐并可滚动，不会出现「顶部被裁且无法触达」的经典 flex 居中陷阱。 */
.stage{
  width:43.2rem;
  min-height:max(76.8rem, 100dvh);
  padding:2rem 4.25rem;
  display:flex;
}
.card{
  flex:none; width:100%; margin:auto;
  display:flex; flex-direction:column;
  border-radius:3.1rem;
  overflow:hidden;
  background:#fff;
  box-shadow:0 .6rem 2.2rem rgba(23,101,237,.10), 0 1.8rem 4.8rem rgba(23,101,237,.07);
}

/* ---------- 头图区 高 261.5 ---------- */
.hero{
  position:relative; flex:none;
  height:35rem;
  background:url(__HERO__) center/cover no-repeat;
}
.brand{position:absolute; left:2.2rem; top:3rem; height:2.6rem; display:flex; align-items:center;}
.brand__mark{display:block; width:2.7rem; height:2.6rem;}
.brand__zx{margin-left:.58rem; font-size:1.9rem; font-weight:900; color:#fff; letter-spacing:.02em;}
.brand__zw{margin-left:.49rem; font-size:1rem; font-weight:400; color:rgba(255,255,255,.96);}
.hero__title{
  position:absolute; left:2.71rem; top:10.5rem; margin:0;
  font-size:2.635rem; line-height:3.5rem; font-weight:900;
  letter-spacing:.27rem; color:#fff;
  -webkit-text-stroke:.4px #fff;   /* 补足参考图更重的笔画 */
}
.hero__title span{display:block}
.hero__title .l2{padding-left:.95rem}
.hero__sub{
  position:absolute; left:2.7rem; top:18.5rem; margin:0;
  font-size:1.11rem; line-height:1.6rem; letter-spacing:.05rem;
  color:rgba(255,255,255,.96);
}

/* ---------- 白色面板 ----------
   v3.1 重排：面板改内容自适应（不再 flex:1 撑满），上下内边距对称 56，
   元素间距重新分级：标题组 12 / 表单组 40-10 / 主按钮 42 / 协议 28.5，
   使「标题—表单—行动—协议」四段形成清晰呼吸节奏。 */
.panel{
  flex:none; display:flex; flex-direction:column;
  position:relative; z-index:1; margin-top:-8.85rem;
  background:#fff;
  border-radius:3.25rem 8rem 0 0;      /* 参考图签名：左上 32.5 / 右上 80 */
  padding:5.6rem 4.05rem 5.6rem;
}
.panel__h2{margin:0; font-size:2.3rem; line-height:3rem; font-weight:800; color:var(--ink); letter-spacing:.005em;}
.panel__sub{margin:1.2rem 0 0; font-size:1.1rem; line-height:1.4rem; color:var(--ink-2);}

/* 表单 */
.fields{margin-top:4rem; display:flex; flex-direction:column; gap:1rem;}
.field{
  position:relative; height:4.05rem;
  border:1px solid var(--line); border-radius:.6rem;
  background:#fff; display:flex; align-items:center;
  transition:border-color .15s ease;
}
.field:focus-within{border-color:#B9C6DE}
.field__ico{position:absolute; left:1.28rem; top:50%; transform:translateY(-50%); width:1.55rem; height:1.55rem; color:var(--icon); pointer-events:none;}
.field input{
  width:100%; height:100%; margin:0; border:0; background:none; outline:none;
  font:inherit; font-size:1.05rem; color:var(--ink); word-spacing:-.14rem;
  padding:0 3.4rem 0 4.15rem; border-radius:.6rem;
}
.field input::placeholder{color:var(--ph)}
.field__eye{
  position:absolute; right:.95rem; top:50%; transform:translateY(-50%);
  width:2rem; height:2rem; padding:0; border:0; background:none; cursor:pointer;
  display:grid; place-items:center; color:#5C5E62;
}
.field__eye svg{width:1.55rem; height:1.55rem}

/* 主按钮 */
.btn{
  margin-top:4.2rem; width:100%; height:4.1rem; flex:none;
  border:0; border-radius:99rem; background:var(--brand); color:#fff;
  font:inherit; font-size:1.22rem; font-weight:600; letter-spacing:.04em;
  cursor:pointer; transition:transform .12s ease, background .15s ease;
}
.btn:active{transform:scale(.985); background:#0C5CCB}

/* 协议 */
.agree{margin-top:2.85rem; display:flex; align-items:center; height:1.6rem;}
.agree input{
  appearance:none; -webkit-appearance:none; flex:none;
  width:1.15rem; height:1.15rem; margin:0;
  border:1px solid var(--cb-line); border-radius:.3rem; background:#fff;
  cursor:pointer; position:relative;
}
.agree input:checked{background:var(--brand); border-color:var(--brand)}
.agree input:checked::after{
  content:""; position:absolute; left:.3rem; top:.13rem;
  width:.24rem; height:.5rem; border:solid #fff; border-width:0 .15rem .15rem 0;
  transform:rotate(45deg);
}
.agree label{margin-left:.65rem; font-size:.95rem; line-height:1.6rem; color:var(--agree);}
.agree a{color:var(--brand); text-decoration:none}

@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="stage">
  <div class="card">

    <!-- ===== 头图 ===== -->
    <div class="hero">
      <div class="brand">
        <img class="brand__mark" src="__LOGO__" alt="知行">
        <span class="brand__zx">知行</span>
        <span class="brand__zw">辅导员工作台</span>
      </div>
      <h1 class="hero__title"><span>以知润心</span><span class="l2">以行育人</span></h1>
      <p class="hero__sub">知行合一 · 育见未来</p>
    </div>

    <!-- ===== 白色面板 ===== -->
    <div class="panel">
      <h2 class="panel__h2">欢迎登录</h2>
      <p class="panel__sub">知行辅导员工作台</p>

      <div class="fields">
        <div class="field">
          <svg class="field__ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="5.1" r="3.35" stroke="currentColor" stroke-width="1.4"/>
            <path d="M1.85 15.2c0-3.42 2.75-5.85 6.15-5.85s6.15 2.43 6.15 5.85" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input type="text" inputmode="text" autocomplete="username" placeholder="用户名 / 工号 / 手机号" aria-label="用户名 / 工号 / 手机号">
        </div>

        <div class="field">
          <svg class="field__ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.7" y="6.9" width="10.6" height="7.4" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
            <path d="M5.25 6.9V5.15a2.75 2.75 0 0 1 5.5 0V6.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
          </svg>
          <input id="pwd" type="password" autocomplete="current-password" placeholder="密码" aria-label="密码">
          <button class="field__eye" type="button" id="eye" aria-label="显示密码" aria-pressed="false">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 2.9C4.6 2.9 1.9 5.2.7 7.5c1.2 2.3 3.9 4.6 7.3 4.6s6.1-2.3 7.3-4.6C14.1 5.2 11.4 2.9 8 2.9Z" fill="currentColor"/>
              <circle cx="8" cy="7.5" r="2.55" fill="#fff"/>
              <circle cx="8" cy="7.5" r="1.05" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </div>

      <button class="btn" type="button" id="submit">登录</button>

      <div class="agree">
        <input type="checkbox" id="agree">
        <label for="agree">我已阅读并同意平台的<a href="#">《用户隐私协议》</a>和<a href="#">《服务条款》</a></label>
      </div>
    </div>

  </div>
</div>

<script>
(function () {
  // 密码可见性
  var pwd = document.getElementById('pwd');
  var eye = document.getElementById('eye');
  eye.addEventListener('click', function () {
    var show = pwd.type === 'password';
    pwd.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
    eye.style.opacity = show ? '.55' : '1';
  });

  // 未接入的能力：如实提示，不伪造成功
  var pending = {
    'submit': '这是设计效果图，尚未接入真实的登录接口。'
  };
  Object.keys(pending).forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', function (e) {
      e.preventDefault(); alert(pending[id]);
    });
  });
})();
</script>
</body>
</html>
'''

html = TPL.replace('__HERO__', HERO).replace('__LOGO__', LOGO)
out = BASE + 'login.html'
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('written', out, '%.1f KB' % (os.path.getsize(out) / 1024))
