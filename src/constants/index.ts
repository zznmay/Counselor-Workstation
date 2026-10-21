import type {
  ApprovalStatus,
  ApprovalType,
  BundleKind,
  Gender,
  NoticeStatus,
  NoticeType,
  StudentStatus,
  TalkType,
  TalkWay,
  TodoPriority,
  TodoStatus,
  TodoType,
  WarningLevel,
  WarningStatus,
  WarningType,
} from '@/types';

/**
 * 年级选项：已迁移为「班级管理 → 年级管理」的动态字典（GET /api/grades/options），
 * 此处不再硬编码。通知发布范围（NOTICE_SCOPES）暂保留静态清单，后续可改为动态字典。
 */

/** 专业选项 */
export const MAJORS = [
  '计算机应用技术',
  '大数据技术',
  '电子商务',
  '学前教育',
  '机电一体化技术',
] as const;

/** 通知发布范围选项 */
export const NOTICE_SCOPES = [
  '全部学生',
  '2024级',
  '2025级',
  '2026级',
  '计应2401',
  '计应2402',
  '大数2401',
  '电商2401',
  '计应2501',
  '大数2501',
  '学前2501',
  '机电2501',
  '计应2601',
  '电商2601',
  '学前2601',
] as const;

/** 政治面貌选项 */
export const POLITICAL_STATUSES = ['中共党员', '中共预备党员', '共青团员', '群众'] as const;

export const GENDERS: Gender[] = ['男', '女'];
export const STUDENT_STATUSES: StudentStatus[] = ['在读', '休学', '退学'];
export const TALK_TYPES: TalkType[] = ['学业指导', '心理疏导', '生活关怀', '就业指导', '违纪教育', '资助帮扶'];
export const TALK_WAYS: TalkWay[] = ['面对面', '电话', '线上'];
export const TALK_TYPE_COLOR: Record<TalkType, string> = {
  学业指导: 'blue',
  心理疏导: 'purple',
  生活关怀: 'green',
  就业指导: 'cyan',
  违纪教育: 'volcano',
  资助帮扶: 'gold',
};
export const WARNING_TYPES: WarningType[] = ['学业预警', '心理预警', '行为预警', '经济困难预警'];
export const WARNING_LEVELS: WarningLevel[] = ['红色', '橙色', '黄色'];
export const WARNING_STATUSES: WarningStatus[] = ['待处理', '处理中', '已解除'];
export const NOTICE_TYPES: NoticeType[] = ['事务通知', '活动通知', '安全提醒', '评奖评优', '其他'];
export const NOTICE_STATUSES: NoticeStatus[] = ['草稿', '已发布', '已撤回'];
export const TODO_TYPES: TodoType[] = ['谈话提醒', '材料提交', '会议安排', '宿舍走访', '数据填报', '其他'];
export const TODO_PRIORITIES: TodoPriority[] = ['高', '中', '低'];
export const TODO_STATUSES: TodoStatus[] = ['未完成', '已完成'];
export const APPROVAL_TYPES: ApprovalType[] = ['学生请假', '勤工助学', '奖学金申请', '助学金申请', '活动申请', '其他'];
export const APPROVAL_STATUSES: ApprovalStatus[] = ['待审批', '已通过', '已驳回'];

/* ==================== 颜色映射 ==================== */

export const STUDENT_STATUS_COLOR: Record<StudentStatus, string> = {
  在读: 'blue',
  休学: 'orange',
  退学: 'red',
};

export const WARNING_LEVEL_COLOR: Record<WarningLevel, string> = {
  红色: 'red',
  橙色: 'orange',
  黄色: 'gold',
};

export const WARNING_TYPE_COLOR: Record<WarningType, string> = {
  学业预警: 'volcano',
  心理预警: 'purple',
  行为预警: 'gold',
  经济困难预警: 'cyan',
};

export const WARNING_STATUS_COLOR: Record<WarningStatus, string> = {
  待处理: 'red',
  处理中: 'blue',
  已解除: 'green',
};

export const NOTICE_TYPE_COLOR: Record<NoticeType, string> = {
  事务通知: 'blue',
  活动通知: 'cyan',
  安全提醒: 'red',
  评奖评优: 'gold',
  其他: 'default',
};

export const NOTICE_STATUS_COLOR: Record<NoticeStatus, string> = {
  草稿: 'default',
  已发布: 'green',
  已撤回: 'gray',
};

export const TODO_PRIORITY_COLOR: Record<TodoPriority, string> = {
  高: 'red',
  中: 'orange',
  低: 'blue',
};

export const TODO_TYPE_COLOR: Record<TodoType, string> = {
  谈话提醒: 'purple',
  材料提交: 'blue',
  会议安排: 'cyan',
  宿舍走访: 'green',
  数据填报: 'gold',
  其他: 'default',
};

export const APPROVAL_TYPE_COLOR: Record<ApprovalType, string> = {
  学生请假: 'blue',
  勤工助学: 'cyan',
  奖学金申请: 'gold',
  助学金申请: 'green',
  活动申请: 'purple',
  其他: 'default',
};

export const APPROVAL_STATUS_COLOR: Record<ApprovalStatus, string> = {
  待审批: 'orange',
  已通过: 'green',
  已驳回: 'red',
};

/** 由选项数组生成 Select 的 options */
export function toOptions(values: readonly string[]): { value: string; label: string }[] {
  return values.map((v) => ({ value: v, label: v }));
}

/* ==================== 数据管理（备份 / 恢复 / 迁移） ==================== */

/** 数据包类型字典：与服务端 lib/datamgmt.js 的 BUNDLE_KINDS 同序同名 */
export const BUNDLE_KINDS: BundleKind[] = ['手动备份', '自动备份', '恢复前快照', '迁移包', '上传包'];

/** 可由管理员手工创建的类型（其余由系统内部产生） */
export const BUNDLE_CREATE_KINDS: BundleKind[] = ['手动备份', '迁移包'];

/** 自动备份间隔字典（小时） */
export const AUTO_BACKUP_INTERVALS = [1, 2, 4, 6, 12, 24];

/** 自动备份保留份数区间（环形保留） */
export const AUTO_BACKUP_KEEP_MIN = 3;
export const AUTO_BACKUP_KEEP_MAX = 30;

/** 恢复确认短语：必须原样输入才允许落库，防误操作 */
export const RESTORE_CONFIRM_PHRASE = '恢复';

/** 上传数据包体积上限（字节）：受服务端 express.json 20mb 限制 */
export const BUNDLE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;

/** 数据包类型 → 列表标签色（与既有的状态色体系一致） */
export const BUNDLE_KIND_COLOR: Record<BundleKind, string> = {
  手动备份: 'blue',
  自动备份: 'cyan',
  恢复前快照: 'orange',
  迁移包: 'purple',
  上传包: 'green',
};

/** 数据表中文名兜底（服务端 overview.tableStats 已下发中文名，此处防止旧数据缺字段时露出英文表名） */
export const DATA_TABLE_LABELS: Record<string, string> = {
  users: '登录账号',
  roles: '角色权限',
  userRoles: '账号角色',
  students: '学生名单',
  studentCounselors: '学生辅导员',
  grades: '年级管理',
  classes: '班级管理',
  classCounselors: '班级教师',
  classPendingStaff: '待同步教师',
  dormitories: '寝室管理',
  conversations: '谈心谈话',
  mentalHealth: '心理关注',
  mentalInterviews: '心理访谈',
  mentalInterviewTemplates: '访谈模板',
  mentalLevelLogs: '等级变更记录',
  warnings: '预警记录',
  notices: '通知公告',
  approvals: '请假审批',
  todos: '待办事项',
  templateCategories: '模板分类',
  templateFiles: '模板文件',
  csScheduler: '值班排班',
  accessLogs: '访问日志',
  loginAttempts: '登录尝试',
};

/** 总览卡片圆点色板（按序循环，保持单卡一色） */
export const DATA_CARD_COLORS = [
  '#4f7cff',
  '#35a37a',
  '#c8842d',
  '#7b61ff',
  '#d95c5c',
  '#2f9aa8',
  '#8e5bd9',
  '#c26b2b',
  '#4f9d69',
  '#5a6b8c',
  '#a15bb8',
  '#b8862b',
];
