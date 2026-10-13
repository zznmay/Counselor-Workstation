/** 通用分页查询参数 */
export interface PageQuery {
  page: number;
  pageSize: number;
  /** 关键字（姓名/学号/班级/内容等，由各模块自行定义匹配字段） */
  keyword?: string;
}

/** 通用分页返回结构 */
export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type Id = string;

/* ==================== 学生信息 ==================== */

export type Gender = '男' | '女';
export type StudentStatus = '在读' | '休学' | '退学';

export interface Student {
  id: Id;
  /** 学号 */
  studentNo: string;
  name: string;
  gender: Gender;
  /** 年级，如 2024级 */
  grade: string;
  major: string;
  className: string;
  phone: string;
  /** 宿舍，如 学生公寓5-412 */
  dorm?: string;
  politicalStatus?: string;
  /** 生源地 */
  origin?: string;
  status: StudentStatus;
  /** 班主任 */
  headTeacher?: string;
  /** 辅导员 */
  counselor?: string;
  /** 父亲姓名 */
  fatherName?: string;
  /** 父亲电话 */
  fatherPhone?: string;
  /** 母亲姓名 */
  motherName?: string;
  /** 母亲电话 */
  motherPhone?: string;
  /** 班内职务 */
  position?: string;
  /** 备注（家庭情况、重点关注事项等） */
  remark?: string;
  /** 入学时间 YYYY-MM-DD */
  enrollDate: string;
}

export interface StudentQuery extends PageQuery {
  grade?: string;
  major?: string;
  status?: StudentStatus;
}

/** 下拉选择用的学生精简信息 */
export interface StudentOption {
  id: Id;
  name: string;
  studentNo: string;
  className: string;
}

/* ==================== 谈心谈话 ==================== */

export type TalkType = '学业指导' | '心理疏导' | '生活关怀' | '就业指导' | '违纪教育' | '资助帮扶';
export type TalkWay = '面对面' | '电话' | '线上';

export interface Conversation {
  id: Id;
  studentId: Id;
  studentName: string;
  studentNo: string;
  /** 谈话时间 YYYY-MM-DD HH:mm */
  talkTime: string;
  way: TalkWay;
  type: TalkType;
  /** 谈话内容记录 */
  content: string;
  /** 后续跟进事项 */
  followUp?: string;
  needFollowUp: boolean;
  createdAt: string;
}

export interface ConversationQuery extends PageQuery {
  studentId?: string;
  type?: TalkType;
  way?: TalkWay;
  needFollowUp?: boolean;
  startDate?: string;
  endDate?: string;
}

/** 时间线视图选项：有谈话记录的学生（含统计） */
export interface TalkedStudentOption {
  id: Id;
  name: string;
  studentNo: string;
  className: string;
  /** 累计谈话次数 */
  count: number;
  /** 最近一次谈话时间 */
  lastTime: string;
  /** 需跟进的记录数 */
  followCount: number;
}

export type ConversationInput = Pick<
  Conversation,
  'studentId' | 'talkTime' | 'way' | 'type' | 'needFollowUp' | 'content'
> & { followUp?: string };

/* ==================== 学业与心理预警 ==================== */

export type WarningType = '学业预警' | '心理预警' | '行为预警' | '经济困难预警';
export type WarningLevel = '红色' | '橙色' | '黄色';
export type WarningStatus = '待处理' | '处理中' | '已解除';

export interface Warning {
  id: Id;
  studentId: Id;
  studentName: string;
  studentNo: string;
  className: string;
  type: WarningType;
  level: WarningLevel;
  /** 预警原因 */
  reason: string;
  /** 预警时间 YYYY-MM-DD HH:mm */
  raisedAt: string;
  status: WarningStatus;
  /** 处理措施 */
  handleNote?: string;
  handledAt?: string;
}

export interface WarningQuery extends PageQuery {
  type?: WarningType;
  level?: WarningLevel;
  status?: WarningStatus;
}

export type WarningInput = Pick<
  Warning,
  'studentId' | 'type' | 'level' | 'reason' | 'status' | 'raisedAt'
> & { handleNote?: string };

/* ==================== 学生名单批量导入 ==================== */

/** Excel 解析出的一行学生数据（row 为含表头的实际行号，从 2 开始） */
export interface ParsedStudentRow {
  row: number;
  data: Omit<Student, 'id'>;
}

/** 一条导入失败记录（附原始行数据，便于导出明细修正后重传） */
export interface StudentImportFailure {
  row: number;
  studentNo: string;
  name: string;
  reason: string;
  data?: Omit<Student, 'id'>;
}

export interface StudentImportResult {
  /** 本次提交的总行数 */
  total: number;
  /** 成功追加的条数 */
  successCount: number;
  failures: StudentImportFailure[];
}

/* ==================== 通知发布 ==================== */

export type NoticeType = '事务通知' | '活动通知' | '安全提醒' | '评奖评优' | '其他';
export type NoticeStatus = '草稿' | '已发布' | '已撤回';

export interface Notice {
  id: Id;
  title: string;
  type: NoticeType;
  /** 发布范围：全部学生 / 某年级 / 某班级 */
  scope: string;
  content: string;
  status: NoticeStatus;
  pinned: boolean;
  publishAt?: string;
  createdAt: string;
  author: string;
}

export interface NoticeQuery extends PageQuery {
  type?: NoticeType;
  status?: NoticeStatus;
}

export type NoticeInput = Pick<Notice, 'title' | 'type' | 'scope' | 'content' | 'pinned'>;

/* ==================== 待办提醒 ==================== */

export type TodoType = '谈话提醒' | '材料提交' | '会议安排' | '宿舍走访' | '数据填报' | '其他';
export type TodoPriority = '高' | '中' | '低';
export type TodoStatus = '未完成' | '已完成';

export interface Todo {
  id: Id;
  title: string;
  type: TodoType;
  priority: TodoPriority;
  /** 截止日期 YYYY-MM-DD */
  dueDate: string;
  /** 截止时间 HH:mm */
  dueTime?: string;
  status: TodoStatus;
  /** 关联学生姓名（可选） */
  relatedStudent?: string;
  note?: string;
  createdAt: string;
}

export interface TodoQuery extends PageQuery {
  type?: TodoType;
  priority?: TodoPriority;
  status?: TodoStatus;
}

export type TodoInput = Pick<
  Todo,
  'title' | 'type' | 'priority' | 'dueDate' | 'relatedStudent' | 'note'
> & { dueTime?: string };

/* ==================== 审批中心 ==================== */

export type ApprovalType = '学生请假' | '勤工助学' | '奖学金申请' | '助学金申请' | '活动申请' | '其他';
export type ApprovalStatus = '待审批' | '已通过' | '已驳回';

export interface Approval {
  id: Id;
  type: ApprovalType;
  studentId: Id;
  studentName: string;
  studentNo: string;
  className: string;
  /** 申请事由摘要 */
  summary: string;
  /** 补充说明 / 材料信息 */
  detail?: string;
  submittedAt: string;
  status: ApprovalStatus;
  /** 审批意见 */
  comment?: string;
  approvedAt?: string;
}

export interface ApprovalQuery extends PageQuery {
  type?: ApprovalType;
  status?: ApprovalStatus;
}

export type ApprovalInput = Pick<Approval, 'type' | 'studentId' | 'summary'> & { detail?: string };

/* ==================== 申请表模板汇总库 ==================== */

export type TemplateFormat = 'doc' | 'docx' | 'xls' | 'xlsx' | 'pdf';

export interface TemplateCategory {
  id: Id;
  name: string;
}

/** 类别（含模板数量统计，用于左侧导航） */
export interface TemplateCategoryWithCount extends TemplateCategory {
  count: number;
}

export interface TemplateFile {
  id: Id;
  name: string;
  categoryId: Id;
  format: TemplateFormat;
  /** 文件大小（字节） */
  size: number;
  /** 简要说明 */
  description?: string;
  uploader: string;
  /** 更新时间 YYYY-MM-DD HH:mm */
  updatedAt: string;
  /** 是否为用户上传的真实文件（否则为内置示例模板，下载时生成演示内容） */
  uploaded?: boolean;
  /** 内置模板绑定的真实文件地址（public 静态资源），下载时优先返回该文件 */
  assetUrl?: string;
}

export interface TemplateQuery {
  categoryId?: Id;
  keyword?: string;
}

export interface TemplateUploadInput {
  name: string;
  categoryId: Id;
  description?: string;
}

/* ==================== 首页工作台 ==================== */

export interface DashboardStats {
  /** 在读学生数 */
  studentCount: number;
  /** 本月谈心谈话次数 */
  monthTalkCount: number;
  /** 未解除预警数（待处理 + 处理中） */
  pendingWarningCount: number;
  /** 今日及逾期未完成待办数 */
  todayTodoCount: number;
  /** 逾期待办数 */
  overdueTodoCount: number;
  /** 待审批数 */
  pendingApprovalCount: number;
  /** 待处理预警按类型分布 */
  warningByType: { label: string; count: number }[];
  /** 谈话记录按类型分布 */
  talkByType: { label: string; count: number }[];
  /** 最新未解除预警（最多 6 条） */
  recentWarnings: Warning[];
  /** 今日及逾期未完成待办（按截止时间排序） */
  todayTodos: Todo[];
  /** 待处理审批（最多 6 条） */
  pendingApprovals: Approval[];
}
