import { CommentOutlined, DeleteOutlined, DownloadOutlined, InboxOutlined, PhoneOutlined, PlusOutlined, RedoOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';import {
  Alert,
  App,
  Button,
  Col,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  batchDeleteStudents,
  createStudent,
  deleteStudent,
  getRoommates,
  getStudentBriefs,
  getStudentMajors,
  getStudents,
  importStudents,
  updateStudent,
} from '@/api/student';
import { createConversation } from '@/api/conversation';
import { getClassOptions, getGradeOptions } from '@/api/classes';
import ConversationFormFields, {
  conversationFormToInput,
} from '@/components/ConversationFormFields';
import type { ConversationFormValues } from '@/components/ConversationFormFields';
import PageHeader from '@/components/PageHeader';
import { canExportStudents, canManageStudentFront, canViewAllStudents, getStoredUser, isSystemAdmin, subscribeSession } from '@/lib/auth';
import {
  GENDERS,
  MAJORS,
  POLITICAL_STATUSES,
  STUDENT_STATUSES,
  STUDENT_STATUS_COLOR,
  toOptions,
} from '@/constants';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useList } from '@/hooks/useList';
import { dormOfStudent } from '@/utils/dormitory';
import {
  downloadStudentTemplate,
  exportImportFailures,
  parseStudentExcel,
  validateStudentRows,
} from '@/utils/studentImport';
import {
  buildExportFileName,
  fetchAllStudentsForExport,
  rememberExportFieldKeys,
  writeStudentWorkbook,
  type ExportFieldDef,
} from '@/utils/studentExport';
import ExportDialog from './ExportDialog';
import type {
  ClassOption,
  Gender,
  GradeOption,
  ParsedStudentRow,
  Roommate,
  Student,
  StudentBrief,
  StudentImportFailure,
  StudentImportResult,
  StudentQuery,
  StudentStatus,
} from '@/types';
import StudentsMobile from './mobile';

interface StudentFormValues {
  studentNo: string;
  name: string;
  gender: Gender;
  grade: string;
  major: string;
  /** 归属班级（班级管理字典）；className 文本由所选班级派生 */
  classId: number;
  phone: string;
  /** 宿舍镜像字段（寝室管理为本源，此处填写后同步回寝室管理） */
  dorm?: string | null;
  /** 班主任 / 辅导员为只读派生值，表单不收集、不提交 */
  headTeacher?: string | null;
  counselor?: string | null;
  politicalStatus?: string;
  origin?: string;
  status: StudentStatus;
  statusChangedAt?: Dayjs;
  fatherName?: string;
  fatherPhone?: string;
  motherName?: string;
  motherPhone?: string;
  position?: string;
  remark?: string;
  enrollDate: Dayjs;
}

/** 学生名册：列表 / 筛选搜索 / 新增 / 编辑 / 删除 / 详情（查看全员放开；维护限带班辅导员或管理员） */
const EXPORT_PROGRESS_THRESHOLD = 300;

function StudentsDesktop() {
  const isMobile = useIsMobile();
  const { message } = App.useApp();
  /** 角色/权限变更后实时重算按钮显隐（布局层 /auth/me 刷新时广播），避免沿用挂载时的旧角色快照 */
  const [authUser, setAuthUser] = useState(getStoredUser);
  const [form] = Form.useForm<StudentFormValues>();

  const { query, patchQuery, data, loading, refresh } = useList<Student, StudentQuery>(getStudents, {
    page: 1,
    pageSize: 10,
  });

  const [keywordInput, setKeywordInput] = useState('');
  const [editing, setEditing] = useState<Student | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detail, setDetail] = useState<Student | null>(null);
  /** 同宿舍学生：null=加载中/未加载；[]=已加载无数据；拉取失败时 roommatesFailed=true */
  const [roommates, setRoommates] = useState<Roommate[] | null>(null);
  const [roommatesFailed, setRoommatesFailed] = useState(false);

  /**
   * 专业筛选项：取自名册数据本身（服务端 /students/majors 去重，与列表同口径）。
   * 专业在导入/编辑时是自由文本，用静态常量当选项会与名册脱节：
   * 常量里的专业可能一个学生都没有，名册里新出现的专业又选不到。
   * 增删改/导入/角色范围变化后需重新拉取，避免选项停留在旧快照（缓存未同步）。
   */
  const [majorOptions, setMajorOptions] = useState<string[]>([]);
  const loadMajors = useCallback(() => {
    getStudentMajors()
      .then(setMajorOptions)
      // 接口异常时回退到预设专业清单，保证筛选框仍可用（正常情况下不会走到这里）
      .catch(() => setMajorOptions([...MAJORS]));
  }, []);

  useEffect(() => {
    loadMajors();
  }, [loadMajors]);

  /**
   * 角色/权限/带班范围变更后同步角色快照并回到第 1 页重新拉取：
   * 可见范围由服务端按当前角色实时计算（仅班主任时只剩所带班级），
   * 若停留在旧页码可能落在收窄后的范围之外，故统一重置分页；
   * 同时关闭详情/编辑弹窗，避免继续展示已不在可见范围内的学生信息。
   */
  useEffect(() => subscribeSession((user) => {
    setAuthUser(user);
    setDetail(null);
    setEditing(null);
    setModalOpen(false);
    patchQuery({ page: 1 });
    // 角色/带班范围变化 → 可见名册变了，专业选项需同步重算
    loadMajors();
  }), [patchQuery, loadMajors]);

  /* 同宿舍学生：详情抽屉打开时按学生 ID 拉取（关闭时清空，避免下次打开闪现旧数据） */
  useEffect(() => {
    if (!detail) {
      setRoommates(null);
      setRoommatesFailed(false);
      return undefined;
    }
    let alive = true;
    setRoommates(null);
    setRoommatesFailed(false);
    getRoommates(detail.id)
      .then((list) => alive && setRoommates(list))
      .catch(() => alive && setRoommatesFailed(true));
    return () => {
      alive = false;
    };
  }, [detail]);

  /* ---------- 年级/班级字典（由「班级管理」模块维护，动态获取） ---------- */
  const [gradeOptions, setGradeOptions] = useState<GradeOption[]>([]);
  const [classOptions, setClassOptions] = useState<ClassOption[]>([]);

  useEffect(() => {
    getGradeOptions().then(setGradeOptions).catch(() => undefined);
    getClassOptions().then(setClassOptions).catch(() => undefined);
  }, []);

  const watchedGrade = Form.useWatch('grade', form);
  const gradeIdByName = useMemo(
    () => new Map(gradeOptions.map((g) => [g.name, g.id])),
    [gradeOptions],
  );
  const classListForGrade = useMemo(() => {
    const gid = watchedGrade ? gradeIdByName.get(watchedGrade) : undefined;
    return gid === undefined ? [] : classOptions.filter((c) => c.gradeId === gid);
  }, [watchedGrade, gradeIdByName, classOptions]);
  const gradeSelectOptions = useMemo(
    () => gradeOptions.map((g) => ({ value: g.name, label: g.name })),
    [gradeOptions],
  );

  /**
   * 表单专业选项 = 预设字典 ∪ 名册实际专业 ∪ 当前编辑对象原值。
   * 名册里可能存在历史数据或导入写入的自定义专业，只给预设清单会让这类学生
   * 在编辑时专业显示为空、保存时被必填校验拦住。
   */
  const formMajorOptions = useMemo(() => {
    const set = new Set<string>(MAJORS);
    majorOptions.forEach((m) => set.add(m));
    if (editing?.major) set.add(editing.major);
    return [...set];
  }, [majorOptions, editing]);

  /* ---------- 批量选择 / 批量删除（仅管理员） ---------- */
  const isAdmin = isSystemAdmin(authUser);
  /**
   * 批量导出入口：仅辅导员角色可用（admin 恒可见；其他角色如班主任、心理主负责不显示，
   * 越权调用在 handleExportConfirm 里二次拦截并提示，与 canStartTalkRecord 同口径）。
   */
  const canExport = canExportStudents(authUser);
  /**
   * 新增/导入入口：管理员或至少带一个班（与后端 canManageStudent 同口径）。
   * 角色只给了「学生名册」模块但未分配班级时，隐藏写入口，避免点了才被 403。
   */
  const canWrite = isAdmin || (authUser?.classIds ?? []).length > 0;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  /** 已选学生摘要缓存：跨页选择时仍能展示姓名/学号/班级 */
  const [briefMap, setBriefMap] = useState<Record<string, StudentBrief>>({});
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);

  /** 筛选口径变化时清空选择，避免「看不见的学生」被误删 */
  useEffect(() => {
    setSelectedKeys([]);
  }, [query.keyword, query.grade, query.classId, query.major, query.status]);

  /** 当前页数据补充进摘要缓存 */
  useEffect(() => {
    setBriefMap((prev) => {
      let changed = false;
      const next = { ...prev };
      data.list.forEach((s) => {
        const cur = next[s.id];
        if (!cur || cur.name !== s.name || cur.className !== s.className) {
          next[s.id] = {
            id: s.id,
            name: s.name,
            studentNo: s.studentNo,
            grade: s.grade,
            className: s.className,
            classId: s.classId,
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [data.list]);

  const selectedBriefs = useMemo(
    () => selectedKeys.map((id) => briefMap[id]).filter(Boolean) as StudentBrief[],
    [selectedKeys, briefMap],
  );

  /** 删除确认：按班级汇总（年级 · 班级 → 人数） */
  const batchGroups = useMemo(() => {
    const count = new Map<string, number>();
    selectedBriefs.forEach((b) => {
      const label = [b.grade, b.className].filter(Boolean).join(' · ') || '未分班';
      count.set(label, (count.get(label) ?? 0) + 1);
    });
    return [...count.entries()]
      .map(([label, n]) => ({ label, count: n }))
      .sort((a, b) => b.count - a.count);
  }, [selectedBriefs]);

  /** 班级筛选项：已选年级时只展示该年级下的班级 */
  const filterGradeId = query.grade ? gradeIdByName.get(query.grade) : undefined;
  const filterClassOptions = useMemo(() => {
    const rows = filterGradeId === undefined
      ? classOptions
      : classOptions.filter((c) => c.gradeId === filterGradeId);
    return rows.map((c) => ({
      value: c.id,
      label: filterGradeId === undefined ? `${c.gradeName} · ${c.name}` : c.name,
    }));
  }, [classOptions, filterGradeId]);

  /**
   * 班主任 / 辅导员：只读派生（班级管理的人员配置为唯一来源）。
   * 编辑弹窗中随所选班级实时带出，提示文案说明不可手改；服务端也会忽略这两项入参。
   * 注意：Form.useWatch 是 hook，必须无条件在组件顶层调用——此前误包进 useMemo 回调，
   * 依赖未变时回调跳过执行，各次渲染 hook 数量不一致会触发 React error #311（名册页崩溃）。
   */
  const watchedClassId = Form.useWatch('classId', form) as number | undefined;
  const watchedStatus = Form.useWatch('status', form) as StudentStatus | undefined;

  // 学籍状态回到「在读」时清空异动办理时间，避免隐藏字段残留在提交数据中
  useEffect(() => {
    if (watchedStatus === '在读') {
      form.setFieldValue('statusChangedAt', undefined);
    }
  }, [watchedStatus, form]);
  const derivedTeachers = useMemo(() => {
    const cls = classOptions.find((c) => c.id === Number(watchedClassId));
    if (!cls) return { headTeacher: '', counselor: '' };
    return {
      headTeacher: cls.headTeacherNames || '',
      counselor: cls.counselorNames || '',
    };
  }, [classOptions, watchedClassId]);

  /* ---------- 记录谈话（联动谈心谈话模块） ---------- */
  const [talkForm] = Form.useForm<ConversationFormValues>();
  const [talkTarget, setTalkTarget] = useState<Student | null>(null);
  const [talkOpen, setTalkOpen] = useState(false);
  const [talkSubmitting, setTalkSubmitting] = useState(false);

  useEffect(() => {
    if (talkOpen) {
      talkForm.setFieldsValue({
        talkTime: dayjs(),
        way: '面对面',
        type: '学业指导',
        needFollowUp: false,
      });
    }
  }, [talkOpen, talkForm]);

  const openTalk = (record: Student) => {
    setTalkTarget(record);
    setTalkOpen(true);
  };

  /** 保存后写入谈心谈话模块共用的数据源，实现模块联动 */
  const handleTalkSubmit = async () => {
    if (!talkTarget) return;
    let values: ConversationFormValues;
    try {
      values = await talkForm.validateFields();
    } catch {
      return;
    }
    setTalkSubmitting(true);
    try {
      await createConversation(conversationFormToInput(values, talkTarget.id));
      message.success(`已记录与${talkTarget.name}的谈话，并同步至谈心谈话模块`);
      setTalkOpen(false);
    } finally {
      setTalkSubmitting(false);
    }
  };

  /* ---------- 批量导入状态 ---------- */
  const [importOpen, setImportOpen] = useState(false);
  const [importDone, setImportDone] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parsed, setParsed] = useState<{
    fileName: string;
    totalRows: number;
    valid: ParsedStudentRow[];
    failures: StudentImportFailure[];
  } | null>(null);
  const [importResult, setImportResult] = useState<StudentImportResult | null>(null);

  const openImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
    setImportOpen(true);
  };

  const closeImport = () => {
    setImportOpen(false);
    if (importResult && importResult.successCount > 0) {
      refresh();
      // 导入常带来名册中原本没有的专业，筛选项必须同步更新
      loadMajors();
    }
  };

  const resetImport = () => {
    setParsed(null);
    setImportResult(null);
    setImportDone(false);
  };

  /** 解析并校验上传的 Excel（仅本地预检，系统内已有学号由服务端按 upsert 处理） */
  const handleImportFile = async (file: File) => {
    try {
      const rows = await parseStudentExcel(file);
      if (rows.length === 0) {
        message.warning('未解析到数据行，请检查文件内容');
        return;
      }
      // 班级字典预检：字典已加载时提前拦截不匹配行（服务端导入时仍会兜底校验）
      const classKeys = classOptions.length > 0
        ? new Set(classOptions.map((c) => `${c.gradeName}|${c.name}`))
        : undefined;
      const { valid, failures } = validateStudentRows(rows, classKeys);
      setParsed({ fileName: file.name, totalRows: rows.length, valid, failures });
      if (valid.length === 0) {
        message.warning('没有可导入的数据行，请根据失败原因修正后重新上传');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '文件解析失败，请使用标准模板填写');
    }
  };

  const confirmImport = async () => {
    if (!parsed || parsed.valid.length === 0) return;
    setImporting(true);
    try {
      const result = await importStudents(parsed.valid);
      setImportResult(result);
      setImportDone(true);
      message.success(`新增 ${result.insertedCount}、更新 ${result.updatedCount}、跳过 ${result.skippedCount} 名学生`);
    } finally {
      setImporting(false);
    }
  };

  /** 预检失败 + 导入时被二次校验驳回的记录，合并展示/导出 */
  const allFailures: StudentImportFailure[] = parsed
    ? [...parsed.failures, ...(importResult?.failures ?? [])]
    : [];

  useEffect(() => {
    if (!modalOpen) return;
    if (editing) {
      form.setFieldsValue({
        ...editing,
        classId: editing.classId ?? undefined,
        enrollDate: dayjs(editing.enrollDate),
        statusChangedAt: editing.statusChangedAt ? dayjs(editing.statusChangedAt) : undefined,
      });
    } else {
      form.resetFields();
    }
  }, [modalOpen, editing, form]);

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (record: Student) => {
    setEditing(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    let values: StudentFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return; // 校验失败，表单内已提示
    }
    setSubmitting(true);
    try {
      // 年级/班级文本与 classId 外键一并提交，保证三者一致
      const classOpt = classOptions.find((c) => c.id === values.classId);
      const payload = {
        ...values,
        className: classOpt?.name ?? '',
        enrollDate: values.enrollDate.format('YYYY-MM-DD'),
        statusChangedAt: values.status === '在读'
          ? null
          : values.statusChangedAt?.format('YYYY-MM-DD') ?? null,
      };
      if (editing) {
        await updateStudent(editing.id, payload);
        message.success('学生信息已更新');
      } else {
        await createStudent(payload);
        message.success('新增学生成功');
      }
      setModalOpen(false);
      refresh();
      // 新增/编辑可能引入新专业或让某专业清零，同步刷新筛选项
      loadMajors();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteStudent(id);
    message.success('删除成功');
    refresh();
    loadMajors();
  };

  /** 全选当前筛选结果（跨页；与列表同一套筛选口径，服务端解析） */
  const handleSelectAllFiltered = async () => {
    setSelectingAll(true);
    try {
      const rows = await getStudentBriefs(query);
      if (rows.length === 0) {
        message.warning('当前筛选条件下没有学生');
        return;
      }
      setBriefMap((prev) => {
        const next = { ...prev };
        rows.forEach((b) => { next[b.id] = b; });
        return next;
      });
      setSelectedKeys(rows.map((b) => b.id));
      message.success(`已选中当前筛选结果共 ${rows.length} 名学生`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '全选失败，请重试');
    } finally {
      setSelectingAll(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedKeys.length === 0) return;
    const selectedSet = new Set(selectedKeys);
    setBatchDeleting(true);
    try {
      const result = await batchDeleteStudents(selectedKeys);
      message.success(`已删除 ${result.deletedCount} 名学生，操作已写入日志`);
      setBatchOpen(false);
      setSelectedKeys([]);
      // 批量删除可能让某些专业清零，同步刷新筛选项
      loadMajors();
      // 当前页被删空时回退一页，避免停留在空页
      const remaining = data.list.filter((s) => !selectedSet.has(s.id)).length;
      if (remaining === 0 && data.page > 1) {
        patchQuery({ page: data.page - 1 }, false);
      } else {
        refresh();
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量删除失败');
      setBatchOpen(false);
      setSelectedKeys([]);
      refresh();
    } finally {
      setBatchDeleting(false);
    }
  };

  const resetFilters = () => {
    setKeywordInput('');
    patchQuery({ keyword: undefined, grade: undefined, classId: undefined, major: undefined, status: undefined });
  };

  /* ---------- 批量导出（仅辅导员角色；纯前端生成 xlsx） ---------- */
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  /**
   * 确认导出：范围 = 勾选学生（跨页）为空时取当前筛选结果全部。
   * 辅导员没有全量 briefs 接口，全量走列表接口分页循环（pageSize=100），
   * 可见范围仍由服务端 rosterScope 收口，前端不重复实现权限过滤。
   */
  const handleExportConfirm = async (fields: ExportFieldDef[]) => {
    if (!canExport) {
      message.error('批量导出仅对辅导员角色开放，当前账号无权使用');
      return;
    }
    setExporting(true);
    try {
      let rows: Student[];
      if (selectedKeys.length > 0) {
        const picked = new Set(selectedKeys);
        // 勾选可能跨页/跨筛选：从已加载的各页缓存里取完整记录，缺失的再按当前筛选翻页补齐
        const cached = data.list.filter((s) => picked.has(s.id));
        if (cached.length === picked.size) {
          rows = cached;
        } else {
          const all = await fetchAllStudentsForExport(query);
          rows = all.filter((s) => picked.has(s.id));
        }
        // 二次防御：勾选缓存缺失（筛选已变）时按现有可取数据导出，绝不静默丢列丢行
        if (rows.length === 0) {
          message.warning('已勾选的学生不在当前可见范围内，请重新勾选后再导出');
          return;
        }
      } else {
        if (data.total === 0) {
          message.warning('当前筛选条件下没有学生，无法导出');
          return;
        }
        rows = await fetchAllStudentsForExport(query, (done, total) => {
          if (total > EXPORT_PROGRESS_THRESHOLD) message.loading({ content: `正在导出 ${done}/${total} 名学生…`, key: 'export-progress', duration: 0 });
        });
      }
      const fileName = buildExportFileName(authUser?.displayName);
      await writeStudentWorkbook(fields, rows, fileName);
      rememberExportFieldKeys(fields.map((f) => f.key));
      message.success(`已导出 ${rows.length} 名学生（${fileName}）`);
      setExportOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导出失败，请重试');
    } finally {
      message.destroy('export-progress');
      setExporting(false);
    }
  };

  const columns: ColumnsType<Student> = [
    { title: '学号', dataIndex: 'studentNo', width: 110 },
    {
      title: '姓名',
      dataIndex: 'name',
      width: 90,
      render: (value: string, record) => <a onClick={() => setDetail(record)}>{value}</a>,
    },
    { title: '性别', dataIndex: 'gender', width: 70 },
    { title: '年级', dataIndex: 'grade', width: 90 },
    { title: '专业', dataIndex: 'major', width: 150, ellipsis: true },
    { title: '班级', dataIndex: 'className', width: 100 },
    { title: '手机号', dataIndex: 'phone', width: 125 },
    {
      title: '宿舍',
      key: 'dorm',
      width: 130,
      ellipsis: true,
      /* 直接读取「寝室管理」的宿舍楼 + 房间号合并显示（如 荷园B512），不再读学生表镜像字段 */
      render: (_, record) => dormOfStudent(record) || '—',
    },
    {
      title: '学籍状态',
      dataIndex: 'status',
      width: 120,
      render: (status: StudentStatus) => <Tag color={STUDENT_STATUS_COLOR[status]}>{status}</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 245,
      fixed: 'right',
      render: (_, record) => {
        const canManage = canManageStudentFront(authUser, record.classId);
        return (
          <Space size={0}>
            {canManage && (
              <Button type="link" size="small" icon={<CommentOutlined />} onClick={() => openTalk(record)}>
                记录谈话
              </Button>
            )}
            <Button type="link" size="small" onClick={() => setDetail(record)}>
              详情
            </Button>
            {canManage && (
              <Button type="link" size="small" onClick={() => openEdit(record)}>
                编辑
              </Button>
            )}
            {canManage && (
              <Popconfirm
                title="确定删除该学生吗？"
                description="删除后不可恢复"
                onConfirm={() => handleDelete(record.id)}
              >
                <Button type="link" size="small" danger>
                  删除
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        title="学生名册"
        subtitle={!canViewAllStudents(authUser)
          ? '仅显示您所带班级的学生'
          : '全体学生的基础信息、学籍状态与重点关注事项；谈话与预警仅所带班级的学生可维护'}
      />

      <div className="toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.35)' }} />}
          placeholder="搜索姓名 / 学号 / 班级 / 手机号"
          style={{ width: isMobile ? '100%' : 250 }}
          value={keywordInput}
          onChange={(e) => {
            setKeywordInput(e.target.value);
            if (!e.target.value && query.keyword) patchQuery({ keyword: undefined });
          }}
          onPressEnter={() => patchQuery({ keyword: keywordInput || undefined })}
        />
        <Select
          placeholder="年级"
          allowClear
          style={{ minWidth: 110 }}
          options={gradeSelectOptions}
          value={query.grade}
          onChange={(grade) => patchQuery({ grade, classId: undefined })}
        />
        <Select
          placeholder="班级"
          allowClear
          showSearch
          optionFilterProp="label"
          style={{ width: 240, flex: '0 0 auto' }}
          popupMatchSelectWidth={false}
          popupClassName="students-class-select-popup"
          options={filterClassOptions}
          value={query.classId}
          onChange={(classId) => patchQuery({ classId })}
          disabled={filterClassOptions.length === 0}
        />
        <Select
          placeholder="专业"
          allowClear
          style={{ minWidth: 150 }}
          options={toOptions(majorOptions)}
          value={query.major}
          onChange={(major) => patchQuery({ major })}
          disabled={majorOptions.length === 0}
          notFoundContent="名册中暂无可筛选的专业"
        />
        <Select
          placeholder="学籍状态"
          allowClear
          style={{ minWidth: 110 }}
          options={toOptions(STUDENT_STATUSES)}
          value={query.status}
          onChange={(status) => patchQuery({ status })}
        />
        <Button icon={<RedoOutlined />} onClick={resetFilters}>
          重置
        </Button>
        <div className="toolbar-spacer" />
        {canExport && (
          <Button icon={<DownloadOutlined />} disabled={data.total === 0 && selectedKeys.length === 0} onClick={() => setExportOpen(true)}>
            批量导出{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
          </Button>
        )}
        {isAdmin && (
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selectedKeys.length === 0}
            onClick={() => setBatchOpen(true)}
          >
            批量删除{selectedKeys.length > 0 ? `（${selectedKeys.length}）` : ''}
          </Button>
        )}
        {canWrite && (
          <Button icon={<UploadOutlined />} onClick={openImport}>
            批量导入
          </Button>
        )}
        {canWrite && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新增学生
          </Button>
        )}
      </div>

      {/* 批量选择状态条：管理员（删除用）或辅导员（导出用）可见；辅导员用复选框圈定导出范围 */}
      {(isAdmin || canExport) && (
        <div className="batch-bar">
          <span>
            已选 <b>{selectedKeys.length}</b> 名学生
          </span>
          <span className="batch-bar-hint">
            {isAdmin ? '勾选可批量删除' : '勾选可限定导出范围，不勾选则导出当前筛选结果'}，支持跨页选择
          </span>
          <div className="batch-bar-spacer" />
          <Button size="small" type="link" loading={selectingAll} onClick={handleSelectAllFiltered}>
            全选当前筛选结果（共 {data.total} 名）
          </Button>
          <Button size="small" type="link" disabled={selectedKeys.length === 0} onClick={() => setSelectedKeys([])}>
            清空选择
          </Button>
        </div>
      )}

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data.list}
        loading={loading}
        scroll={{ x: 1280 }}
        rowSelection={
          isAdmin || canExport
            ? {
                selectedRowKeys: selectedKeys,
                preserveSelectedRowKeys: true,
                onChange: (keys) => setSelectedKeys(keys.map(String)),
              }
            : undefined
        }
        pagination={{
          current: data.page,
          pageSize: data.pageSize,
          total: data.total,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 名学生`,
          onChange: (page, pageSize) => patchQuery({ page, pageSize }, false),
        }}
      />

      {/* 学生详情抽屉 */}
      <Drawer
        title="学生详情"
        width={isMobile ? '100%' : 560}
        open={!!detail}
        onClose={() => setDetail(null)}
      >
        {detail && (
          <>
            <Descriptions
              bordered
              size="small"
              column={isMobile ? 1 : 2}
              labelStyle={{ width: 96 }}
            >
            <Descriptions.Item label="学号">{detail.studentNo}</Descriptions.Item>
            <Descriptions.Item label="姓名">{detail.name}</Descriptions.Item>
            <Descriptions.Item label="性别">{detail.gender}</Descriptions.Item>
            <Descriptions.Item label="年级">{detail.grade}</Descriptions.Item>
            <Descriptions.Item label="专业" span={2}>
              {detail.major}
            </Descriptions.Item>
            <Descriptions.Item label="班级">{detail.className}</Descriptions.Item>
            <Descriptions.Item label="职务">{detail.position ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="手机号">{detail.phone}</Descriptions.Item>
            <Descriptions.Item label="宿舍">{dormOfStudent(detail) || '—'}</Descriptions.Item>
            <Descriptions.Item label="政治面貌">{detail.politicalStatus ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="生源地">{detail.origin ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="入学时间">{detail.enrollDate}</Descriptions.Item>
            <Descriptions.Item label="学籍状态">
              <Tag color={STUDENT_STATUS_COLOR[detail.status]}>{detail.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="学籍异动办理时间">
              {detail.statusChangedAt ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="班主任">{detail.headTeacher ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="辅导员">{detail.counselor ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {detail.remark ?? '—'}
            </Descriptions.Item>
          </Descriptions>
          <div style={{ fontWeight: 600, margin: '20px 0 12px', color: 'var(--app-ink)' }}>
            家庭联系信息
          </div>
          <Descriptions
            bordered
            size="small"
            column={isMobile ? 1 : 2}
            labelStyle={{ width: 96 }}
          >
            <Descriptions.Item label="父亲姓名">{detail.fatherName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="父亲电话">{detail.fatherPhone ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="母亲姓名">{detail.motherName ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="母亲电话">{detail.motherPhone ?? '—'}</Descriptions.Item>
          </Descriptions>

          {/* 同宿舍学生：姓名 / 班级 / 联系电话 + 一键外拨；区分「未登记宿舍 / 无室友 / 未登记电话」 */}
          <div style={{ fontWeight: 600, margin: '20px 0 12px', color: 'var(--app-ink)' }}>
            同宿舍学生{roommates && roommates.length > 0 ? `（${roommates.length} 人）` : ''}
          </div>
          {roommatesFailed ? (
            <Typography.Text type="secondary">同宿舍学生信息加载失败，稍后重试</Typography.Text>
          ) : !dormOfStudent(detail) ? (
            <Typography.Text type="secondary">该学生未登记宿舍，暂无同宿舍学生</Typography.Text>
          ) : roommates === null ? (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          ) : roommates.length === 0 ? (
            <Typography.Text type="secondary">暂无同宿舍的其他学生</Typography.Text>
          ) : (
            <Table<Roommate>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={roommates}
              columns={[
                { title: '姓名', dataIndex: 'name', width: 90 },
                { title: '班级', dataIndex: 'className', width: 130 },
                {
                  title: '联系电话',
                  dataIndex: 'phone',
                  render: (v: Roommate['phone']) => v || '未登记',
                },
                {
                  title: '操作',
                  key: 'op',
                  width: 84,
                  render: (_, r) =>
                    r.phone ? (
                      <a href={`tel:${r.phone}`} aria-label={`拨打${r.name}电话 ${r.phone}`}>
                        <PhoneOutlined /> 拨打
                      </a>
                    ) : (
                      <Typography.Text type="secondary">—</Typography.Text>
                    ),
                },
              ]}
            />
          )}
          </>
        )}
      </Drawer>

      {/* 新增 / 编辑学生 */}
      <Modal
        title={editing ? '编辑学生' : '新增学生'}
        width={isMobile ? 'calc(100vw - 24px)' : 680}
        open={modalOpen}
        confirmLoading={submitting}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            gender: '男',
            status: '在读',
            major: MAJORS[0],
          }}
        >
          <Row gutter={16}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="studentNo"
                label="学号"
                rules={[{ required: true, message: '请输入学号' }]}
              >
                <Input placeholder="如 2026010101" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                <Input placeholder="学生姓名" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="gender" label="性别" rules={[{ required: true }]}>
                <Radio.Group options={toOptions(GENDERS)} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="phone"
                label="手机号"
                rules={[
                  { required: true, message: '请输入手机号' },
                  { pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' },
                ]}
              >
                <Input placeholder="11位手机号" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="grade" label="年级" rules={[{ required: true, message: '请选择年级' }]}>
                <Select
                  options={gradeSelectOptions}
                  onChange={() => form.setFieldValue('classId', undefined)}
                />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="major" label="专业" rules={[{ required: true, message: '请选择专业' }]}>
                <Select options={toOptions(formMajorOptions)} showSearch optionFilterProp="label" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="classId"
                label="班级"
                rules={[{ required: true, message: '请选择班级' }]}
              >
                <Select
                  disabled={!watchedGrade}
                  showSearch
                  optionFilterProp="children"
                  placeholder={
                    !watchedGrade
                      ? '请先选择年级'
                      : classListForGrade.length > 0
                        ? '请选择班级'
                        : '该年级暂无班级，请先在「班级管理」中创建'
                  }
                >
                  {classListForGrade.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="status" label="学籍状态" rules={[{ required: true }]}>
                <Select options={toOptions(STUDENT_STATUSES)} />
              </Form.Item>
            </Col>
            {watchedStatus !== '在读' && (
              <Col xs={24} sm={12}>
                <Form.Item
                  name="statusChangedAt"
                  label="学籍异动办理时间"
                  extra="学籍状态为非在读时必填"
                  rules={[{ required: true, message: '请选择学籍异动办理时间' }]}
                >
                  <DatePicker style={{ width: '100%' }} placeholder="请选择办理时间" />
                </Form.Item>
              </Col>
            )}
            <Col xs={24} sm={12}>
              <Form.Item
                name="dorm"
                label="宿舍"
                extra="宿舍以「寝室管理」为准，此处修改会同步（如 荷园B512）"
              >
                <Input placeholder="如 荷园B512" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="politicalStatus" label="政治面貌">
                <Select options={toOptions(POLITICAL_STATUSES)} allowClear placeholder="请选择" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="origin" label="生源地">
                <Input placeholder="如 浙江杭州" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="enrollDate"
                label="入学时间"
                rules={[{ required: true, message: '请选择入学时间' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="position" label="班内职务">
                <Input placeholder="如 班长 / 学习委员" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="家庭情况、重点关注事项等" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <div className="form-section-title">班级与家庭联系</div>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="班主任" extra="由「班级管理」的人员配置按班级自动派生，不可手改">
                <Input value={derivedTeachers.headTeacher || '该班暂无班主任'} disabled />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="辅导员" extra="由「班级管理」的人员配置按班级自动派生，不可手改">
                <Input value={derivedTeachers.counselor || '该班暂无辅导员'} disabled />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="fatherName" label="父亲姓名">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="fatherPhone"
                label="父亲电话"
                rules={[{ pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' }]}
              >
                <Input placeholder="11位手机号" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item name="motherName" label="母亲姓名">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item
                name="motherPhone"
                label="母亲电话"
                rules={[{ pattern: /^1\d{10}$/, message: '请输入正确的11位手机号' }]}
              >
                <Input placeholder="11位手机号" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
      {/* 批量导入学生名单 */}
      <Modal
        title="批量导入学生名单"
        width={isMobile ? 'calc(100vw - 24px)' : 780}
        open={importOpen}
        onCancel={closeImport}
        footer={
          importDone
            ? [
                <Button key="again" onClick={resetImport}>
                  再次导入
                </Button>,
                <Button key="close" type="primary" onClick={closeImport}>
                  完成
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={closeImport}>
                  取消
                </Button>,
                <Button
                  key="ok"
                  type="primary"
                  loading={importing}
                  disabled={!parsed || parsed.valid.length === 0}
                  onClick={confirmImport}
                >
                  {parsed ? `确认导入 ${parsed.valid.length} 条` : '确认导入'}
                </Button>,
              ]
        }
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div className="import-step">
            <div className="import-step-title">① 下载并填写模板</div>
            <Space wrap>
              <Button icon={<DownloadOutlined />} onClick={downloadStudentTemplate}>
                下载 Excel 模板
              </Button>
              <Typography.Text type="secondary">
                模板包含全部字段、示例行与填写说明（「填写说明」工作表）
              </Typography.Text>
            </Space>
          </div>

          {!importDone && (
            <div className="import-step">
              <div className="import-step-title">② 上传填写好的 Excel</div>
              <Upload.Dragger
                accept=".xlsx,.xls"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  void handleImportFile(file);
                  return false; // 阻止自动上传，改为前端解析校验
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
                <p className="ant-upload-hint">支持 .xlsx / .xls；先校验后导入，可预览失败明细</p>
              </Upload.Dragger>
            </div>
          )}

          {parsed && (
            <div className="import-step">
              <div className="import-step-title">{importDone ? '③ 导入结果' : '③ 校验结果'}</div>
              <Alert
                showIcon
                type={allFailures.length > 0 ? 'warning' : 'success'}
                message={
                  importDone
                    ? `处理完成：新增 ${importResult?.insertedCount ?? 0}、更新 ${importResult?.updatedCount ?? 0}、跳过 ${importResult?.skippedCount ?? 0} 名学生。`
                    : `文件「${parsed.fileName}」共解析 ${parsed.totalRows} 行：可导入 ${parsed.valid.length} 条，${parsed.failures.length} 条存在问题。`
                }
                description={
                  importDone
                    ? allFailures.length > 0
                      ? '部分数据未通过校验未处理，可导出失败明细修正后重新上传。'
                      : '全部数据处理成功（新增/更新/跳过）。'
                    : allFailures.length > 0
                      ? '导入按学号 upsert：学号不存在则新增，已存在则仅更新有变化的字段，完全相同自动跳过；可导出失败明细修正后重新上传。'
                      : undefined
                }
              />
              {allFailures.length > 0 && (
                <>
                  <Table
                    size="small"
                    rowKey="row"
                    style={{ marginTop: 12 }}
                    columns={[
                      { title: 'Excel 行号', dataIndex: 'row', width: 90 },
                      { title: '学号', dataIndex: 'studentNo', width: 120 },
                      { title: '姓名', dataIndex: 'name', width: 90 },
                      { title: '失败原因', dataIndex: 'reason' },
                    ]}
                    dataSource={allFailures}
                    pagination={false}
                    scroll={{ y: 180 }}
                  />
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    style={{ marginTop: 12 }}
                    onClick={() => exportImportFailures(allFailures)}
                  >
                    导出失败明细
                  </Button>
                </>
              )}
            </div>
          )}
        </Space>
      </Modal>
      {/* 批量删除确认：数量 + 班级汇总 + 名单明细，二次确认防误删 */}
      <Modal
        title="批量删除学生"
        width={isMobile ? 'calc(100vw - 24px)' : 640}
        open={batchOpen}
        confirmLoading={batchDeleting}
        okText={`确认删除 ${selectedKeys.length} 名`}
        okButtonProps={{ danger: true }}
        cancelText="取消"
        onOk={handleBatchDelete}
        onCancel={() => setBatchOpen(false)}
      >
        <Alert
          type="warning"
          showIcon
          message={`即将永久删除 ${selectedKeys.length} 名学生，此操作不可撤销`}
          description="学生基础信息与共管关系将一并删除；谈话、预警、审批等历史记录会保留以便追溯。"
          style={{ marginBottom: 16 }}
        />
        <div className="batch-block-title">按班级汇总（{batchGroups.length} 个班级）</div>
        <div className="batch-tags">
          {batchGroups.map((g) => (
            <Tag key={g.label} color="blue">
              {g.label} · {g.count} 人
            </Tag>
          ))}
        </div>
        <div className="batch-block-title" style={{ marginTop: 16 }}>
          名单明细（{selectedBriefs.length} 名）
        </div>
        <div className="batch-names">
          {selectedBriefs.slice(0, 60).map((b) => (
            <span className="batch-name" key={b.id}>
              {b.name}
              <em>{b.studentNo}</em>
            </span>
          ))}
          {selectedBriefs.length > 60 && (
            <span className="batch-more">…等共 {selectedBriefs.length} 名</span>
          )}
        </div>
        {selectedKeys.length > selectedBriefs.length && (
          <Typography.Text type="danger" style={{ display: 'block', marginTop: 8 }}>
            有 {selectedKeys.length - selectedBriefs.length} 名学生的信息未能加载，删除时同样会被移除，建议刷新后重新选择。
          </Typography.Text>
        )}
      </Modal>
      {/* 记录谈话：写入谈心谈话模块共用的数据源 */}
      <Modal
        title={`记录谈话 · ${talkTarget?.name ?? ''}`}
        width={isMobile ? 'calc(100vw - 24px)' : 620}
        open={talkOpen}
        confirmLoading={talkSubmitting}
        onOk={handleTalkSubmit}
        onCancel={() => setTalkOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        {talkTarget && (
          <div className="talk-target">
            <span className="student-chip">{talkTarget.name.charAt(0)}</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--app-ink)' }}>{talkTarget.name}</div>
              <div style={{ fontSize: 12, color: '#7686a8' }}>
                {talkTarget.className} · {talkTarget.studentNo}
              </div>
            </div>
            <Tag color="blue" style={{ marginLeft: 'auto' }}>
              保存后同步至谈心谈话模块
            </Tag>
          </div>
        )}
        <Form form={talkForm} layout="vertical">
          <ConversationFormFields />
        </Form>
      </Modal>

      {/* 批量导出字段选择弹窗（仅网页端入口；移动端不提供导出） */}
      <ExportDialog
        open={exportOpen}
        exporting={exporting}
        filterTotal={data.total}
        selectedCount={selectedKeys.length}
        onConfirm={handleExportConfirm}
        onCancel={() => setExportOpen(false)}
      />
    </div>
  );
}

/**
 * 视口分发：≤768px 走移动端独立渲染层（卡片化 + 触控优化），
 * 桌面端沿用原组件，桌面样式与行为零改动。
 */
export default function Students() {
  const isMobile = useIsMobile();
  return isMobile ? <StudentsMobile /> : <StudentsDesktop />;
}
