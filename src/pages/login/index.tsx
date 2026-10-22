import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { request } from '@/api/request';
import RouteFallback from '@/components/RouteFallback';
import { firstAccessiblePath, setSession } from '@/lib/auth';
import { tryDemoLogin } from '@/lib/demoLogin';
import type { AuthUser } from '@/lib/auth';
import { useIsMobile } from '@/hooks/useIsMobile';
import './desktop.css';

/** 移动端登录依赖 antd 消息上下文，单独成包；桌面端登录不加载 antd */
const LoginMobile = lazy(() => import('./mobileHost'));

/** 设计稿基准画布 (16:9) */
const DESIGN_W = 836;
const DESIGN_H = 470.5;

const UserIcon = () => (
  <svg className="lgpc-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="5.1" r="3.35" stroke="currentColor" strokeWidth="1.4" />
    <path d="M1.85 15.2c0-3.42 2.75-5.85 6.15-5.85s6.15 2.43 6.15 5.85" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const LockIcon = () => (
  <svg className="lgpc-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2.7" y="6.9" width="10.6" height="7.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.25 6.9V5.15a2.75 2.75 0 0 1 5.5 0V6.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const EyeIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 2.9C4.6 2.9 1.9 5.2.7 7.5c1.2 2.3 3.9 4.6 7.3 4.6s6.1-2.3 7.3-4.6C14.1 5.2 11.4 2.9 8 2.9Z" fill="currentColor" />
    <circle cx="8" cy="7.5" r="2.55" fill="#fff" />
    <circle cx="8" cy="7.5" r="1.05" fill="currentColor" />
  </svg>
);

const WarnIcon = () => (
  <svg viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <circle cx="7" cy="7" r="6.2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M7 3.8v3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="7" cy="10.2" r=".8" fill="currentColor" />
  </svg>
);

/** 桌面端登录页（设计稿等比舞台）：真实登录 + 首次登录强制改密 */
function LoginDesktop() {
  const navigate = useNavigate();
  const [view, setView] = useState<'login' | 'change'>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [loginPassword, setLoginPassword] = useState(''); // 登录表单卸载后仍需用于改密校验
  const [showPwd, setShowPwd] = useState(false);
  // 改密态新密码默认明文：设置场景明文更直观，浏览器自动填充的脏值一眼可见
  const [showNew, setShowNew] = useState(true);
  const [showConfirm, setShowConfirm] = useState(false);
  const accountRef = useRef<HTMLInputElement>(null);
  const pwdRef = useRef<HTMLInputElement>(null);
  const newPwdRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const shakeTimer = useRef<number | undefined>(undefined);

  /** 视口 cover 缩放: 舞台等比放大并居中裁剪, 任意视口铺满无留边 */
  useEffect(() => {
    const apply = () => {
      const scale = Math.max(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H);
      scalerRef.current?.style.setProperty('--lgpc-scale', String(scale));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  useEffect(() => () => window.clearTimeout(shakeTimer.current), []);

  /** 改密视图挂载后主动清空输入框：iOS/安卓/部分桌面浏览器会无视 autoComplete，
   *  把记住的用户名自动填进第一个输入框（新密码框出现 "admin" 的根因）。
   *  300ms + 900ms 两次清理，覆盖绝大多数延迟填充时机。 */
  useEffect(() => {
    if (view !== 'change') return;
    const clear = () => {
      if (newPwdRef.current?.value) newPwdRef.current.value = '';
      if (confirmRef.current?.value) confirmRef.current.value = '';
    };
    const t1 = window.setTimeout(clear, 300);
    const t2 = window.setTimeout(clear, 900);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [view]);

  const fail = (msg: string) => {
    setError(msg);
    setShake(false);
    // 下一帧重启动画
    requestAnimationFrame(() => setShake(true));
    window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => setShake(false), 500);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = accountRef.current?.value.trim() ?? '';
    const password = pwdRef.current?.value ?? '';
    if (!username || !password) { fail('请输入账号和密码'); return; }
    setLoading(true);
    try {
      const res = await request<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        skipAuthRedirect: true, // 口令错误的 401 就地提示，不整页跳转
      });
      setSession(res.token, res.user);
      setLoginPassword(password);
      setError('');
      if (res.user.mustChangePassword) {
        setPendingUser(res.user);
        setView('change');
      } else {
        navigate(firstAccessiblePath(res.user), { replace: true });
      }
    } catch (e2) {
      fail(e2 instanceof Error ? e2.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  /** 首次登录强制改密; oldPassword 使用登录时缓存的密码。
   *  校验顺序：先查两次一致（浏览器自动填充用户名进第一个框时，
   *  「两次不一致」能让用户立刻发现真因），再查强度规则。 */
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const newPassword = newPwdRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';
    if (newPassword !== confirm) { fail('两次输入的新密码不一致'); return; }
    if (newPassword.length < 8 || !/^(?=.*[A-Za-z])(?=.*\d).+$/.test(newPassword)) {
      fail('新密码需不少于 8 位，且同时包含字母和数字');
      return;
    }
    if (pendingUser && newPassword === pendingUser.username) {
      fail('新密码不能与用户名相同');
      return;
    }
    setLoading(true);
    try {
      const res = await request<{ token: string; user: AuthUser }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword: loginPassword, newPassword }),
        skipAuthRedirect: true, // 旧密码错误的 401 就地提示，不整页跳转
      });
      setSession(res.token, res.user);
      navigate(firstAccessiblePath(res.user), { replace: true });
    } catch (e2) {
      fail(e2 instanceof Error ? e2.message : '修改失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="lgpc-stage">
      <div className="lgpc-scaler" ref={scalerRef}>
        {/* 品牌行 */}
        <header className="lgpc-brand">
          <img src="/login/brand.png" alt="知行 logo" />
          <span className="lgpc-brand-zx">知行</span>
          <span className="lgpc-brand-zw">辅导员工作台</span>
        </header>

        {/* 右上标语 */}
        <p className="lgpc-slogan">知行合一 · 育见未来</p>

        {/* 主文案 */}
        <h1 className="lgpc-title"><span>以知润心</span><span className="l2">以行育人</span></h1>
        <div className="lgpc-dash" aria-hidden="true" />
        <p className="lgpc-sub">知行合一 · 育见未来</p>

        {/* 三项特色 */}
        <ul className="lgpc-feats">
          <li>
            <svg viewBox="0 0 20 17" fill="none" aria-hidden="true">
              <path d="M10 1.2 18.8 5 10 8.8 1.2 5 10 1.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              <path d="M5.4 7v4.1c0 1.2 2.06 2.4 4.6 2.4s4.6-1.2 4.6-2.4V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <path d="M18.8 5v4.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="t">服务树生</span>
          </li>
          <li>
            <svg viewBox="0 0 20 17" fill="none" aria-hidden="true">
              <path d="M10 15.6S1.6 10.9 1.6 5.6C1.6 3.1 3.6 1.2 6 1.2c1.6 0 3.1.9 4 2.2.9-1.3 2.4-2.2 4-2.2 2.4 0 4.4 1.9 4.4 4.4 0 5.3-8.4 10-8.4 10Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span className="t">赋能成长</span>
          </li>
          <li>
            <svg viewBox="0 0 20 17" fill="none" aria-hidden="true">
              <circle cx="7.2" cy="4.6" r="2.6" stroke="currentColor" strokeWidth="1.4" />
              <path d="M1.6 15.4c0-3.1 2.5-5.3 5.6-5.3s5.6 2.2 5.6 5.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="14" cy="5.4" r="2.1" stroke="currentColor" strokeWidth="1.3" />
              <path d="M15.4 10.5c1.8.5 3 2 3 4.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <span className="t">共建未来</span>
          </li>
        </ul>

        {/* 登录卡片 */}
        <section className={`lgpc-card${shake ? ' shake' : ''}`}>
          {view === 'login' ? (
            <form onSubmit={handleLogin} noValidate autoComplete="off">
              <h2 className="lgpc-card-title">欢迎登录</h2>
              <p className="lgpc-card-sub">知行辅导员工作台</p>

              <div className="lgpc-field lgpc-field-user">
                <UserIcon />
                <input
                  ref={accountRef}
                  type="text"
                  name="account"
                  placeholder="用户名 / 工号 / 手机号"
                  aria-label="用户名 / 工号 / 手机号"
                  autoComplete="username"
                  onChange={() => setError('')}
                />
              </div>

              <div className="lgpc-field lgpc-field-pwd">
                <LockIcon />
                <input
                  ref={pwdRef}
                  type={showPwd ? 'text' : 'password'}
                  name="password"
                  placeholder="密码"
                  aria-label="密码"
                  autoComplete="current-password"
                  onChange={() => setError('')}
                />
                <button
                  type="button"
                  className="lgpc-eye"
                  onClick={() => setShowPwd((v) => !v)}
                  aria-label={showPwd ? '隐藏密码' : '显示密码'}
                >
                  <EyeIcon />
                </button>
              </div>

              {error && (
                <p className="lgpc-error" role="alert">
                  <WarnIcon />
                  {error}
                </p>
              )}

              <button className="lgpc-btn lgpc-btn-login" type="submit" disabled={loading}>
                {loading ? '登录中…' : '登录'}
              </button>

              {/* 协议行（与参考稿一致） */}
              <div className="lgpc-agree">
                <input type="checkbox" id="lgpc-agree" aria-label="同意平台协议" />
                <label htmlFor="lgpc-agree">
                  我已阅读并同意平台的<a href="#">《用户隐私协议》</a>和<a href="#">《服务条款》</a>
                </label>
              </div>
            </form>
          ) : (
            <div className="lgpc-change">
              <form onSubmit={handleChangePassword} noValidate autoComplete="off">
                {/* 诱捕浏览器自动填充：记住的用户名/密码落在屏外隐藏字段，不污染新密码输入框 */}
                <input type="text" name="username" autoComplete="username" tabIndex={-1} aria-hidden="true" className="lgpc-trap" />
                <input type="password" name="password" autoComplete="current-password" tabIndex={-1} aria-hidden="true" className="lgpc-trap" />
                <div className="lgpc-ring" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="5" y="10.5" width="14" height="9.5" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M8.4 10.5V8.2a3.6 3.6 0 0 1 7.2 0v2.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </div>
                <h2>设置新密码</h2>
                <p className="lgpc-change-note">
                  当前账号：{pendingUser?.displayName}（{pendingUser?.username}）
                  ，首次登录请设置不少于 8 位、同时包含字母和数字的新密码。
                </p>

                <div className="lgpc-field lgpc-field-new">
                  <LockIcon />
                  <input
                    ref={newPwdRef}
                    type={showNew ? 'text' : 'password'}
                    name="new-password"
                    placeholder="新密码"
                    aria-label="新密码"
                    autoComplete="new-password"
                    onChange={() => setError('')}
                  />
                  <button
                    type="button"
                    className="lgpc-eye"
                    onClick={() => setShowNew((v) => !v)}
                    aria-label={showNew ? '隐藏新密码' : '显示新密码'}
                  >
                    <EyeIcon />
                  </button>
                </div>

                <div className="lgpc-field lgpc-field-confirm">
                  <LockIcon />
                  <input
                    ref={confirmRef}
                    type={showConfirm ? 'text' : 'password'}
                    name="confirm-password"
                    placeholder="确认新密码"
                    aria-label="确认新密码"
                    autoComplete="new-password"
                    onChange={() => setError('')}
                  />
                  <button
                    type="button"
                    className="lgpc-eye"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? '隐藏确认密码' : '显示确认密码'}
                  >
                    <EyeIcon />
                  </button>
                </div>

                {error && (
                  <p className="lgpc-error lgpc-error-change" role="alert">
                    <WarnIcon />
                    {error}
                  </p>
                )}

                <button className="lgpc-btn lgpc-btn-change" type="submit" disabled={loading}>
                  {loading ? '提交中…' : '设置并进入系统'}
                </button>
              </form>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（头图 + 非对称圆角白面板，
 * 见 docs/mobile-redesign/prototype/login.html），桌面端为设计稿等比舞台。
 * 两端共用同一套登录逻辑（/auth/login → 会话写入 → 首次登录改密），仅呈现层不同。
 *
 * 演示模式兜底：RequireAuth 已做过自动登录，能到登录页通常是「演示令牌过期被 401
 * 踢出」或「演示服务恰好不可用」；挂载时再静默尝试一次演示登录，成功即直接进入，
 * 失败则停留本页（常规部署下 demo-login 404，一次静默请求开销可忽略）。
 */
export default function Login() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    tryDemoLogin().then((user) => {
      if (!cancelled && user) navigate(firstAccessiblePath(user), { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);
  if (!isMobile) return <LoginDesktop />;
  return (
    <Suspense fallback={<RouteFallback full />}>
      <LoginMobile />
    </Suspense>
  );
}
