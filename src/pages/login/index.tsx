import { LockOutlined, TeamOutlined, UserOutlined } from '@ant-design/icons';
import { App, Button, Card, Form, Input } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { request } from '@/api/request';
import { setSession } from '@/lib/auth';
import type { AuthUser } from '@/lib/auth';

/** 登录页：自建账号登录 + 首次登录强制改密 */
export default function Login() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [pendingUser, setPendingUser] = useState<AuthUser | null>(null);
  const [loginPassword, setLoginPassword] = useState(''); // 登录表单卸载后仍需用于改密校验
  const [loginForm] = Form.useForm<{ username: string; password: string }>();
  const [changeForm] = Form.useForm<{ newPassword: string; confirm: string }>();

  const handleLogin = async () => {
    let values: { username: string; password: string };
    try {
      values = await loginForm.validateFields();
    } catch {
      return;
    }
    setLoading(true);
    try {
      const res = await request<{ token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setSession(res.token, res.user);
      setLoginPassword(values.password);
      if (res.user.mustChangePassword) {
        setPendingUser(res.user);
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

  /** onFinish 直接携带校验后的表单值；oldPassword 使用登录时缓存的密码 */
  const handleChangePassword = async (values: { newPassword: string; confirm: string }) => {
    if (values.newPassword !== values.confirm) {
      message.error('两次输入的新密码不一致');
      return;
    }
    setLoading(true);
    try {
      const res = await request<{ token: string; user: AuthUser }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword: loginPassword, newPassword: values.newPassword }),
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

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(900px 420px at 108% -8%, rgba(169,194,255,0.3), transparent 62%),' +
          'radial-gradient(700px 360px at -8% 30%, rgba(169,194,255,0.2), transparent 58%),' +
          'linear-gradient(180deg, #f7f9ff 0%, #f1f5fd 100%)',
      }}
    >
      <Card style={{ width: 400, boxShadow: '0 16px 44px rgba(47,62,102,0.12)' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 52, height: 52, borderRadius: 14,
              background: 'linear-gradient(135deg, #6E92FF, #2F3E66)',
              color: '#fff', fontSize: 24, fontWeight: 600,
              boxShadow: '0 8px 20px rgba(95,134,255,0.4)',
            }}
          >
            杭
          </span>
          <div style={{ fontSize: 20, fontWeight: 600, color: '#2F3E66', marginTop: 14 }}>
            杭科院 · 辅导员工作台
          </div>
          <div style={{ fontSize: 13, color: '#7686a8', marginTop: 6 }}>
            内网本地化部署 · 仅限授权教师使用
          </div>
        </div>

        {!pendingUser ? (
          <Form form={loginForm} layout="vertical" onFinish={handleLogin}>
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined style={{ color: 'rgba(47,62,102,0.4)' }} />} placeholder="用户名" size="large" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password
                prefix={<LockOutlined style={{ color: 'rgba(47,62,102,0.4)' }} />}
                placeholder="密码"
                size="large"
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              登 录
            </Button>
            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: '#8a99b5' }}>
              <TeamOutlined style={{ marginRight: 4 }} />
              账号由系统管理员统一开设，忘记密码请联系管理员
            </div>
          </Form>
        ) : (
          <Form form={changeForm} layout="vertical" onFinish={handleChangePassword}>
            <div style={{ marginBottom: 16, fontSize: 13, color: '#5a6b8c' }}>
              当前账号：<b>{pendingUser.displayName}（{pendingUser.username}）</b>
              ，首次登录请设置不少于 8 位（含字母和数字）的新密码。
            </div>
            <Form.Item
              name="newPassword"
              label="新密码"
              rules={[
                { required: true, message: '请输入新密码' },
                { min: 8, message: '至少 8 位' },
                {
                  pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
                  message: '需同时包含字母和数字',
                },
              ]}
            >
              <Input.Password placeholder="新密码" size="large" />
            </Form.Item>
            <Form.Item
              name="confirm"
              label="确认新密码"
              rules={[{ required: true, message: '请再次输入新密码' }]}
            >
              <Input.Password placeholder="再次输入新密码" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={loading}>
              设置并进入系统
            </Button>
          </Form>
        )}
      </Card>
    </div>
  );
}
