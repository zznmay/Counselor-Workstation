import { App } from 'antd';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { request } from '@/api/request';
import { setSession } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

import '@/styles/login-mobile.css';

/**
 * 移动端登录页（≤768px）
 * 视觉：docs/mobile-redesign/prototype/login.html（v3.1）
 * 规格：docs/mobile-redesign/09（参考图复刻基线）+ 10（删除标注项后重排）
 *
 * 登录逻辑与桌面端 `LoginDesktop` 完全一致：
 *   POST /auth/login → setSession → mustChangePassword 时进入改密态 → POST /auth/change-password
 * 校验规则、提示文案、跳转与会话保持均沿用桌面端口径，未新增也未删减任何业务约束。
 */

/**
 * 文案来源：prototype/login.html；唯一有意偏差为
 * usernamePlaceholder（用户要求改为「账号」）与 3 处可达性护栏（见样式文件）。
 */
const COPY = {
  brandName: '知行',
  brandSub: '辅导员工作台',
  heroTitle: ['以知润心', '以行育人'],
  heroSub: '知行合一 · 育见未来',
  panelTitle: '欢迎登录',
  panelSub: '知行辅导员工作台',
  changeTitle: '设置新密码',
  usernamePlaceholder: '账号',
  passwordPlaceholder: '密码',
  newPasswordPlaceholder: '新密码',
  confirmPlaceholder: '再次输入新密码',
  submit: '登录',
  changeSubmit: '设置并进入系统',
  agreementDocTip: '内网系统暂未上线该协议文档，如有疑问请联系系统管理员。',
} as const;

/** 用户图标（内联 SVG，描边 1.4，与效果图一致） */
function IconUser() {
  return (
    <svg className="lg-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.1" r="3.35" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M1.85 15.2c0-3.42 2.75-5.85 6.15-5.85s6.15 2.43 6.15 5.85"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 锁图标 */
function IconLock() {
  return (
    <svg className="lg-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.7" y="6.9" width="10.6" height="7.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5.25 6.9V5.15a2.75 2.75 0 0 1 5.5 0V6.9"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** 眼睛图标（密码可见性切换） */
function IconEye() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.9C4.6 2.9 1.9 5.2.7 7.5c1.2 2.3 3.9 4.6 7.3 4.6s6.1-2.3 7.3-4.6C14.1 5.2 11.4 2.9 8 2.9Z"
        fill="currentColor"
      />
      <circle cx="8" cy="7.5" r="2.55" fill="#fff" />
      <circle cx="8" cy="7.5" r="1.05" fill="currentColor" />
    </svg>
  );
}

export default function LoginMobile() {
  const navigate = useNavigate();
  const { message } = App.useApp();

  const [mode, setMode] = useState<'login' | 'change'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agreed, setAgreed] = useState(true); // 仅声明、不做门禁（沿用既有决策）
  const [loading, setLoading] = useState(false);
  const [errUser, setErrUser] = useState(false);
  const [errPwd, setErrPwd] = useState(false);
  const [errConfirm, setErrConfirm] = useState(false);

  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  /** 登录表单切换为改密态后仍需用于 oldPassword */
  const [loginPassword, setLoginPassword] = useState('');

  /** 登录提交：校验 → 请求 → 写会话 → 改密态 / 跳转 */
  const doLogin = async () => {
    const missUser = !username.trim();
    const missPwd = !password;
    setErrUser(missUser);
    setErrPwd(missPwd);
    if (missUser) {
      message.warning('请输入用户名');
      return;
    }
    if (missPwd) {
      message.warning('请输入密码');
      return;
    }

    setLoading(true);
    try {
      const res = await request<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        skipAuthRedirect: true, // 口令错误的 401 就地提示，不整页跳转
      });
      setSession(res.token, res.user);
      setLoginPassword(password);
      if (res.user.mustChangePassword) {
        setPendingUser(res.user);
        setPassword('');
        setConfirm('');
        setErrPwd(false);
        setErrConfirm(false);
        setMode('change');
        message.info('首次登录请先设置新密码');
      } else {
        message.success(`欢迎，${res.user.displayName}`);
        navigate('/', { replace: true });
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  /** 首次登录改密：规则与桌面端一致（≥8 位且含字母和数字、两次一致） */
  const doChangePassword = async () => {
    const missPwd = !password;
    const missConfirm = !confirm;
    setErrPwd(missPwd);
    setErrConfirm(missConfirm);
    if (missPwd) {
      message.warning('请输入新密码');
      return;
    }
    if (password.length < 8) {
      setErrPwd(true);
      message.warning('至少 8 位');
      return;
    }
    if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password)) {
      setErrPwd(true);
      message.warning('需同时包含字母和数字');
      return;
    }
    if (missConfirm) {
      message.warning('请再次输入新密码');
      return;
    }
    if (password !== confirm) {
      setErrConfirm(true);
      message.error('两次输入的新密码不一致');
      return;
    }

    setLoading(true);
    try {
      const res = await request<{ token: string; user: AuthUser }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword: loginPassword, newPassword: password }),
        skipAuthRedirect: true, // 旧密码错误的 401 就地提示，不整页跳转
      });
      setSession(res.token, res.user);
      message.success('密码已更新，欢迎加入！');
      navigate('/', { replace: true });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '修改失败');
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;
    if (mode === 'login') void doLogin();
    else void doChangePassword();
  };

  const isLogin = mode === 'login';

  return (
    <div className="lg-page">
      <div className="lg-stage">
        <div className="lg-card">
          {/* ===== 头图 ===== */}
          <div className="lg-hero">
            <div className="lg-brand">
              <img className="lg-brand-mark" src="/login/brand.png" alt="知行" />
              <span className="lg-brand-name">{COPY.brandName}</span>
              <span className="lg-brand-sub">{COPY.brandSub}</span>
            </div>
            <h1 className="lg-hero-title">
              <span>{COPY.heroTitle[0]}</span>
              <span className="l2">{COPY.heroTitle[1]}</span>
            </h1>
            <p className="lg-hero-sub">{COPY.heroSub}</p>
          </div>

          {/* ===== 白色面板 ===== */}
          <form className="lg-panel" onSubmit={onSubmit} noValidate>
            <h2 className="lg-h2">{isLogin ? COPY.panelTitle : COPY.changeTitle}</h2>
            {isLogin ? (
              <p className="lg-sub">{COPY.panelSub}</p>
            ) : (
              <p className="lg-sub">
                当前账号：{pendingUser?.displayName ?? ''}（{pendingUser?.username ?? ''}）
                <br />
                首次登录请设置不少于 8 位（含字母和数字）的新密码。
              </p>
            )}

            <div className="lg-fields">
              {isLogin ? (
                <div className={errUser ? 'lg-field is-err' : 'lg-field'}>
                  <IconUser />
                  <input
                    className="lg-inp"
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    placeholder={COPY.usernamePlaceholder}
                    aria-label={COPY.usernamePlaceholder}
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      if (errUser) setErrUser(false);
                    }}
                  />
                </div>
              ) : (
                <div className={errPwd ? 'lg-field is-err' : 'lg-field'}>
                  <IconLock />
                  <input
                    className="lg-inp"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={COPY.newPasswordPlaceholder}
                    aria-label={COPY.newPasswordPlaceholder}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errPwd) setErrPwd(false);
                    }}
                  />
                  <button
                    className="lg-eye"
                    type="button"
                    aria-label={showPassword ? '隐藏新密码' : '显示新密码'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <IconEye />
                  </button>
                </div>
              )}

              {isLogin ? (
                <div className={errPwd ? 'lg-field is-err' : 'lg-field'}>
                  <IconLock />
                  <input
                    className="lg-inp"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder={COPY.passwordPlaceholder}
                    aria-label={COPY.passwordPlaceholder}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errPwd) setErrPwd(false);
                    }}
                  />
                  <button
                    className="lg-eye"
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    <IconEye />
                  </button>
                </div>
              ) : (
                <div className={errConfirm ? 'lg-field is-err' : 'lg-field'}>
                  <IconLock />
                  <input
                    className="lg-inp"
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={COPY.confirmPlaceholder}
                    aria-label={COPY.confirmPlaceholder}
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      if (errConfirm) setErrConfirm(false);
                    }}
                  />
                  <button
                    className="lg-eye"
                    type="button"
                    aria-label={showConfirm ? '隐藏确认密码' : '显示确认密码'}
                    aria-pressed={showConfirm}
                    onClick={() => setShowConfirm((v) => !v)}
                  >
                    <IconEye />
                  </button>
                </div>
              )}
            </div>

            <button className="lg-btn" type="submit" disabled={loading}>
              {loading && <span className="lg-spin" aria-hidden="true" />}
              {loading ? (
                <span>
                  <span className="lg-btn-loading-text">处理中…</span>
                </span>
              ) : (
                isLogin ? COPY.submit : COPY.changeSubmit
              )}
            </button>

            {isLogin && (
              <div className="lg-agree">
                <input
                  className="lg-cbx"
                  type="checkbox"
                  id="lg-agree"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <label className="lg-agree-tx" htmlFor="lg-agree">
                  我已阅读并同意平台的
                  <button
                    className="lg-link"
                    type="button"
                    onClick={() => message.info(COPY.agreementDocTip)}
                  >
                    《用户隐私协议》
                  </button>
                  和
                  <button
                    className="lg-link"
                    type="button"
                    onClick={() => message.info(COPY.agreementDocTip)}
                  >
                    《服务条款》
                  </button>
                </label>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
