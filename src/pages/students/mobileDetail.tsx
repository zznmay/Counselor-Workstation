import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';

import { getStudent } from '@/api/student';
import MaskedValue from '@/components/mobile/MaskedValue';
import { MIcon } from '@/components/mobile/icons';
import { useIsMobile } from '@/hooks/useIsMobile';
import { canManageStudentFront, getStoredUser } from '@/lib/auth';
import type { Student, StudentStatus } from '@/types';

/** 学籍状态 → 语义标签（颜色 + 文字，不引入裸 hex） */
const STATUS_TAG: Record<StudentStatus, string> = {
  在读: 'success',
  休学: 'warning',
  退学: 'danger',
};

function KV({ k, v, nowrap }: { k: string; v?: string | null; nowrap?: boolean }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <div className="m-kv">
      <span className="m-kv-k">{k}</span>
      <span className={`m-kv-v${nowrap ? ' nowrap' : ''}`}>{v}</span>
    </div>
  );
}

/**
 * 移动端学生详情：字段分层 + 敏感信息默认脱敏 + 底部固定操作条。
 * 顶部安全区由外壳 .m-topbar 承担；本页操作条吸附在内容底部（sticky，非 fixed）。
 */
export default function StudentDetailMobile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isMobile) return undefined;
    let alive = true;
    setLoading(true);
    setFailed(false);
    getStudent(id)
      .then((s) => alive && setStudent(s))
      .catch(() => alive && setFailed(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id, isMobile]);

  /* 桌面端不提供全屏详情页（沿用列表弹窗），避免出现无样式的移动端组件 */
  if (!isMobile) return <Navigate to="/students" replace />;

  if (loading) {
    return (
      <div className="m-loadmore" style={{ padding: '80px 0' }}>
        <MIcon name="spinner" size={18} className="m-spin" />
        正在加载学生信息…
      </div>
    );
  }

  if (failed || !student) {
    return (
      <div className="m-card empty">
        <MIcon name="alertTriangle" size={22} style={{ color: 'var(--danger-fg)' }} />
        <div className="m-t3" style={{ marginTop: 6 }}>学生信息加载失败</div>
        <button type="button" className="m-btn m-btn-soft" style={{ marginTop: 10 }} onClick={() => navigate('/students')}>
          返回列表
        </button>
      </div>
    );
  }

  /* 操作栏：拨号/短信全员可用；发起谈心/标记预警仅带班辅导员（/notices 通知模块已下线，移除入口） */
  const canManage = canManageStudentFront(getStoredUser(), student.classId);
  const actions: { icon: 'phone' | 'message' | 'comment' | 'triangle'; label: string; href?: string; to?: string }[] = [
    { icon: 'phone', label: '拨号', href: `tel:${student.phone}` },
    { icon: 'message', label: '短信', href: `sms:${student.phone}` },
    ...(canManage
      ? [
          { icon: 'comment' as const, label: '发起谈心', to: `/conversations?studentId=${student.id}` },
          { icon: 'triangle' as const, label: '标记预警', to: `/warnings?studentId=${student.id}` },
        ]
      : []),
  ];

  return (
    <>
      <div className="m-detail-head">
        <span className="m-ava" style={{ width: 52, height: 52, borderRadius: 14, fontSize: 20 }}>
          {student.name.slice(0, 1)}
        </span>
        <div className="m-row-main">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 20, fontWeight: 600, color: 'var(--m-text-1)' }}>{student.name}</span>
            <span className={`m-tag ${STATUS_TAG[student.status]}`}>{student.status}</span>
          </div>
          <div className="m-t3" style={{ marginTop: 4 }}>
            {student.className} · {student.major} · {student.grade}
          </div>
        </div>
      </div>

      <div className="m-card">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="user" size={16} />
            基本信息
          </span>
        </div>
        <KV k="学号" v={student.studentNo} nowrap />
        <KV k="性别" v={student.gender} nowrap />
        <KV k="年级" v={student.grade} nowrap />
        <KV k="专业" v={student.major} />
        <KV k="班级" v={student.className} nowrap />
        <KV k="政治面貌" v={student.politicalStatus} nowrap />
        <KV k="生源地" v={student.origin} />
      </div>

      <div className="m-card">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="grid4" size={16} />
            在校信息
          </span>
        </div>
        <KV k="宿舍" v={student.dorm} nowrap />
        <KV k="班主任" v={student.headTeacher} nowrap />
        <KV k="辅导员" v={student.counselor} nowrap />
        <KV k="班内职务" v={student.position} nowrap />
        <KV k="入学时间" v={student.enrollDate} nowrap />
      </div>

      {/* 联系方式：默认脱敏，点击「查看」显明文，离开本页自动回隐 */}
      <div className="m-card">
        <div className="m-sec-head">
          <span className="m-sec-title">
            <MIcon name="phone" size={16} />
            联系方式
          </span>
          <span className="m-t4">敏感信息默认脱敏</span>
        </div>
        <div className="m-kv">
          <span className="m-kv-k">本人电话</span>
          <span className="m-kv-v nowrap">
            <MaskedValue value={student.phone} label="本人电话" />
          </span>
        </div>
        <div className="m-kv">
          <span className="m-kv-k">父亲</span>
          <span className="m-kv-v nowrap">
            {student.fatherName || '—'}
            {student.fatherPhone && <> · <MaskedValue value={student.fatherPhone} label="父亲电话" /></>}
          </span>
        </div>
        <div className="m-kv">
          <span className="m-kv-k">母亲</span>
          <span className="m-kv-v nowrap">
            {student.motherName || '—'}
            {student.motherPhone && <> · <MaskedValue value={student.motherPhone} label="母亲电话" /></>}
          </span>
        </div>
      </div>

      {student.remark && (
        <div className="m-card">
          <div className="m-sec-head">
            <span className="m-sec-title">
              <MIcon name="file" size={16} />
              备注
            </span>
          </div>
          <div className="m-t3" style={{ lineHeight: 1.7 }}>{student.remark}</div>
        </div>
      )}

      <div className="m-actionbar">
        <div className="m-act-grid">
          {actions.map((a) => (
            <a
              key={a.label}
              className="m-act"
              href={a.href}
              onClick={(e) => {
                if (a.to) {
                  e.preventDefault();
                  navigate(a.to);
                }
              }}
              aria-label={a.label}
            >
              <MIcon name={a.icon} size={20} />
              {a.label}
            </a>
          ))}
        </div>
      </div>
    </>
  );
}
