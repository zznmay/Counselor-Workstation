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

/* ==================== 年级与班级 ==================== */

/** 年级（管理端完整信息） */
export interface Grade {
  id: number;
  name: string;
  /** 年级下班级数 */
  classCount?: number;
  createdAt?: string;
}

/** 年级下拉选项 */
export interface GradeOption {
  id: number;
  name: string;
}

/** 班级（管理端完整信息，归属年级） */
export interface SchoolClass {
  id: number;
  gradeId: number;
  name: string;
  /** 所属年级名称 */
  gradeName?: string;
  /** 班级学生数 */
  studentCount?: number;
  /** 所辖辅导员数（roleType='counselor'） */
  counselorCount?: number;
  /** 所辖辅导员姓名（、分隔，正式绑定） */
  counselorNames?: string;
  /** 班主任数（roleType='headTeacher'） */
  headTeacherCount?: number;
  /** 班主任姓名（、分隔，正式绑定） */
  headTeacherNames?: string;
  /** 待同步辅导员姓名（、分隔，每项自带「（待同步）」后缀） */
  pendingCounselorNames?: string;
  /** 待同步班主任姓名（、分隔，每项自带「（待同步）」后缀） */
  pendingHeadTeacherNames?: string;
  /** 待同步人员总数（两类身份合计） */
  pendingStaffCount?: number;
  createdAt?: string;
}

/** 班级下拉选项（学生表单级联选择用） */
export interface ClassOption {
  id: number;
  name: string;
  gradeId: number;
  gradeName: string;
  /** 所辖辅导员姓名（、分隔；班级人员配置派生，用于表单只读展示） */
  counselorNames?: string;
  /** 班主任姓名（、分隔；班级人员配置派生，用于表单只读展示） */
  headTeacherNames?: string;
}

/* ==================== 班级人员（工号绑定 + 待同步） ==================== */

/** 班级人员条目：工号 + 姓名（工号即 users.username，未匹配账号的条目记待同步） */
export interface StaffEntry {
  employeeNo: string;
  displayName: string;
}

/** 待同步人员行（「同步用户管理」清单） */
export interface PendingStaffItem {
  id: number;
  classId: number;
  employeeNo: string;
  displayName: string;
  roleType: 'counselor' | 'headTeacher';
  source: string;
  createdAt: string;
  className: string;
  gradeName: string;
}

/** 同步用户管理结果 */
export interface PendingSyncResult {
  total: number;
  /** 新建账号数 */
  createdUsers: number;
  /** 绑定已有账号数（只绑班不建号） */
  linkedExisting: number;
  skippedCount: number;
  /** 跳过明细（停用/管理员账号），对应待同步行保留 */
  skipped: { employeeNo: string; displayName: string; reason: string }[];
  refilledClasses: number;
  refilledStudents: number;
}

/** 工号匹配结果（导入预检/表单内联姓名判定用） */
export interface StaffLookupItem {
  keyword: string;
  matched: boolean;
  userId: number | null;
  displayName: string | null;
}

/** 班级人员明细（编辑回填：正式绑定 + 待同步，pending 标志区分） */
export interface ClassStaffDetail {
  roleType: 'counselor' | 'headTeacher';
  employeeNo: string;
  displayName: string;
  /** 1 = 待同步（尚无账号） */
  pending: number;
}

/* ==================== 班级名单批量导入 ==================== */

/** Excel 解析出的一行班级数据（row 为含表头的实际行号，从 2 开始；工号与姓名按顺序一一对应） */
export interface ParsedClassRow {
  row: number;
  data: {
    name: string;
    grade: string;
    counselorNos: string;
    counselorNames: string;
    headTeacherNos?: string;
    headTeacherNames?: string;
  };
}

/** 一条班级导入失败记录（附原始行数据，便于导出明细修正后重传） */
export interface ClassImportFailure {
  row: number;
  name: string;
  grade: string;
  reason: string;
  data?: ParsedClassRow['data'];
}

export interface ClassImportResult {
  /** 本次提交的总行数 */
  total: number;
  /** 成功处理的条数（新增 + 更新） */
  successCount: number;
  /** 新增班级条数 */
  insertedCount: number;
  /** 更新班级条数（人员配置有变化） */
  updatedCount: number;
  /** 与系统记录完全相同而跳过的条数 */
  skippedCount: number;
  /** 本次写入的待同步人次数（工号未匹配到在职账号） */
  pendingCount: number;
  failures: ClassImportFailure[];
}

/* ==================== 寝室管理 ==================== */

/** 寝室分配记录（姓名/班级/年级/性别 取自学生名册，宿舍楼与房间号由本模块维护） */
export interface Dormitory {
  id: number;
  /** 学号（唯一；寝室分配挂在该学号对应的学生上） */
  studentNo: string;
  /** 学生主键（按带班权限判定可维护性用） */
  studentId: string;
  name: string;
  gender: string;
  grade: string;
  className: string;
  classId?: number | null;
  /** 宿舍楼，如 荷园B */
  building: string;
  /** 房间号，如 512 */
  room: string;
  /** 合并展示值：宿舍楼 + 房间号（如 荷园B512）；仅详情接口返回 */
  dorm?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface DormitoryQuery extends PageQuery {
  /** 学号（模糊） */
  studentNo?: string;
  /** 姓名（模糊） */
  name?: string;
  /** 班级名称（模糊，兼容旧调用） */
  className?: string;
  /** 年级（精确） */
  grade?: string;
  /** 班级字典 ID（多选，命中任一班级） */
  classIds?: number[];
  /** 宿舍楼（模糊） */
  building?: string;
  /** 房间号（模糊） */
  room?: string;
  /** 综合关键字：学号 / 姓名 / 房间号 任一命中（移动端单搜索框） */
  keyword?: string;
}

/** 新增/编辑入参 */
export interface DormitoryInput {
  studentNo: string;
  building: string;
  room: string;
}

/** 筛选下拉选项（取自可见范围内真实数据） */
export interface DormitoryOptions {
  buildings: string[];
  classNames: string[];
}

/** Excel 解析出的一行寝室数据（row 为含表头的实际行号，从 2 开始） */
export interface ParsedDormRow {
  row: number;
  data: {
    studentNo: string;
    name: string;
    className: string;
    grade: string;
    gender: string;
    building: string;
    room: string;
  };
}

/** 一条寝室导入失败记录（附原始行数据，便于导出明细修正后重传） */
export interface DormImportFailure {
  row: number;
  studentNo: string;
  name: string;
  building: string;
  room: string;
  reason: string;
  data?: ParsedDormRow['data'];
}

export interface DormImportResult {
  total: number;
  successCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  failures: DormImportFailure[];
}

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
  /** 归属班级 ID（班级管理字典外键；历史数据可能为空） */
  classId?: number | null;
  /** 手机号 */
  phone: string;
  /**
   * 宿舍（展示用只读镜像）：由「寝室管理」回写，值为 宿舍楼+房间号 拼接。
   * 名册页面展示宿舍时一律改用 dormBuilding / dormRoom 现场拼接，不再直接读本字段。
   */
  dorm?: string | null;
  /**
   * 班主任（只读派生）：由班级人员配置（工号绑定）中该班的班主任姓名生成，
   * 不再由学生导入/编辑写入，仅作导出与历史留档。
   */
  headTeacher?: string | null;
  /**
   * 辅导员（只读派生）：同上，取该班辅导员姓名，多人按 users.id 升序以「、」连接。
   */
  counselor?: string | null;
  /** 宿舍楼（来自寝室管理，未分配时为 null） */
  dormBuilding?: string | null;
  /** 房间号（来自寝室管理，未分配时为 null） */
  dormRoom?: string | null;
  politicalStatus?: string;
  /** 生源地 */
  origin?: string;
  status: StudentStatus;
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
  /** 归属班级字典 ID（按班级筛选） */
  classId?: number;
  major?: string;
  status?: StudentStatus;
}

/** 批量选择/删除确认用的学生精简信息 */
export interface StudentBrief {
  id: Id;
  name: string;
  studentNo: string;
  grade?: string;
  className?: string;
  classId?: number | null;
}

/** 批量删除结果（服务端事务性删除，全部成功或全部回滚） */
export interface BatchDeleteResult {
  ok: true;
  deletedCount: number;
  deleted: Pick<StudentBrief, 'id' | 'name' | 'studentNo' | 'className'>[];
}

/** 下拉选择用的学生精简信息 */
export interface StudentOption {
  id: Id;
  name: string;
  studentNo: string;
  className: string;
  /** 归属班级 ID（前端按带班权限过滤表单下拉用） */
  classId?: number | null;
}

/** 同宿舍学生（学生详情页「同宿舍学生」模块；服务端按可见范围 + 在读状态过滤，不含本人） */
export interface Roommate {
  id: Id;
  name: string;
  className: string;
  /** 联系电话；空 / null = 未登记（前端展示「未登记电话」且不渲染拨号按钮） */
  phone?: string | null;
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
  /** 成功处理的条数（新增 + 更新） */
  successCount: number;
  /** 新增学生条数 */
  insertedCount: number;
  /** 更新学生条数（仅字段有变化的记录） */
  updatedCount: number;
  /** 与系统记录完全相同而跳过的条数 */
  skippedCount: number;
  failures: StudentImportFailure[];
}

/* ==================== 角色与用户导入 ==================== */

/** 角色下拉选项（不含权限明细） */
export interface RoleOption {
  key: string;
  name: string;
  isSystem: boolean;
}

/** 角色（管理端完整信息） */
export interface Role extends RoleOption {
  id: number;
  description: string;
  /** 可访问的模块 key 列表 */
  permissions: string[];
  /** 主负责的模块 key 列表（该模块最高权限：查看全院数据 + 全部操作；必须 ⊆ permissions） */
  ownerModules: string[];
  /** 该角色下的用户数（删除护栏提示） */
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInput {
  name: string;
  description?: string;
  permissions: string[];
  ownerModules?: string[];
}

/** Excel 解析出的一行用户数据（row 为含表头的实际行号，从 2 开始） */
export interface ParsedUserRow {
  row: number;
  data: {
    username: string;
    displayName: string;
    role: string;
    /** 所辖班级文本：多班用「、」分隔；同名班级写成「2024级·计应2401」 */
    classNames?: string;
  };
}

/** 一条用户导入失败记录（附原始行数据，便于导出修正后重传） */
export interface UserImportFailure {
  row: number;
  username: string;
  displayName: string;
  reason: string;
  data?: ParsedUserRow['data'];
}

export interface UserImportResult {
  total: number;
  successCount: number;
  failures: UserImportFailure[];
}

/* ==================== 心理健康 ==================== */

/** 关注等级（展示顺序即紧急程度从高到低；末位「无需关注」为留档档位，不安排访谈） */
export type AttentionLevel = '密切关注' | '重点关注' | '日常关注' | '一般关注' | '无需关注';

/** 关注学生条目（列表行：学生基础信息 + 关注标记 + 谈话统计） */
export interface MentalConcern {
  studentId: Id;
  name: string;
  studentNo: string;
  className: string;
  grade?: string;
  major?: string;
  status?: StudentStatus;
  level: AttentionLevel;
  note?: string | null;
  updatedAt: string;
  updatedBy?: string | null;
  /** 关联谈心谈话统计 */
  talkCount: number;
  lastTalkTime?: string | null;
  followCount: number;
  /** 本学期心理访谈进度（服务端判定写权，前端只读消费） */
  interviewDone: number;
  interviewRequired: number;
  canInterview: boolean;
}

/** 关注等级汇总（页首分类卡，五个等级恒齐全） */
export interface MentalLevelSummary {
  level: AttentionLevel;
  count: number;
}

/** 可标记学生候选（可见范围内、尚未标记） */
export interface MentalCandidate {
  id: Id;
  name: string;
  studentNo: string;
  className: string;
  grade?: string;
}

/** 学生谈话时间线（心理健康模块只读打通） */
export interface MentalTimeline {
  student: { id: Id; name: string; studentNo: string; className: string };
  list: Conversation[];
}

/* ==================== 心理健康关注名单批量导入 ==================== */

/** 导入行（学号优先、姓名兜底；等级留空由服务端按「一般关注」处理） */
export interface MentalImportRow {
  row: number;
  studentNo: string;
  name: string;
  level: string;
  note?: string;
}

/** 导入成功明细：created 新建 / updated 变更 / unchanged 已存在且无变化 */
export interface MentalImportSuccess {
  row: number;
  studentId: Id;
  studentNo: string;
  name: string;
  className: string;
  level: AttentionLevel;
  previousLevel: AttentionLevel | null;
  action: 'created' | 'updated' | 'unchanged';
}

/** 跳过明细：未在学生名册、学号与姓名不匹配、同名歧义、重复行等 */
export interface MentalImportSkip {
  row: number;
  studentNo: string;
  name: string;
  reason: string;
}

/** 导入/预览汇总（dryRun=true 时为校验预览，不落库） */
export interface MentalImportResult {
  dryRun: boolean;
  total: number;
  successCount: number;
  skippedCount: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  successes: MentalImportSuccess[];
  skipped: MentalImportSkip[];
}

/* ==================== 心理访谈记录单模板 ==================== */

/** 模板题目（key 为 answers JSON 的唯一标识，既有题目不可改 key） */
export interface InterviewTemplateQuestion {
  key: string;
  /** 题干 */
  text: string;
  /** 预填提示（选填） */
  placeholder?: string;
  /** 答案字数下限（非负整数；0 或缺省 = 不限制，历史题目保持此行为） */
  min?: number;
  /** 答案字数上限 */
  max: number;
  /** 输入框行数 */
  rows: number;
}

/** 模板题目分组（对应纸质表分区标题） */
export interface InterviewTemplateGroup {
  title: string;
  questions: InterviewTemplateQuestion[];
}

/** 生效表单模型（前端渲染记录单用；服务端按学生年级 + 当前关注等级解析） */
export interface InterviewFormModel {
  /** 模板 ID；null = 内置默认记录单（库内无兼容模板时兜底） */
  id: string | null;
  name: string;
  /** 适用年级名；空数组 = 全部年级适用 */
  grades: string[];
  /** 适用关注等级；空数组 = 不限等级 */
  levels: string[];
  groups: InterviewTemplateGroup[];
  /** 模板版本（每保存一次内容变更 +1） */
  version: number;
}

/** 记录单模板（管理端列表/编辑用） */
export interface InterviewTemplate extends InterviewFormModel {
  /** 模板 ID（已落库模板恒有值；null 仅用于内置默认兜底模型） */
  id: string;
  enabled: boolean;
  /** 引用该模板的未删除访谈记录数 */
  usageCount: number;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 记录单模板入参 */
export interface InterviewTemplateInput {
  name: string;
  grades: string[];
  /** 适用关注等级；空数组 = 不限等级 */
  levels: string[];
  groups: InterviewTemplateGroup[];
  enabled?: boolean;
}

/* ==================== 心理访谈记录批量导出 ==================== */

/** 导出查询入参（level 传「全部」或空 = 不限档位） */
export interface InterviewExportQuery {
  level?: string;
  classId?: number;
  dateFrom?: string;
  dateTo?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

/** 导出行：学生基本信息 + 记录关键字段 + 题目快照（用于展开动态问答列） */
export interface InterviewExportRecord {
  id: string;
  studentId: Id;
  studentName: string;
  studentNo: string;
  className: string;
  grade: string;
  /** 学生当前关注等级（导出筛选依据） */
  currentLevel: AttentionLevel | null;
  interviewDate: string;
  interviewerName: string;
  levelBefore: AttentionLevel | null;
  levelAfter: AttentionLevel | null;
  answers: Record<string, string>;
  summary: string;
  signatureName: string;
  signedAt: string;
  semesterLabel: string;
  /** 填写时的题目快照（可能为 null：极老记录无快照） */
  formGroups: InterviewTemplateGroup[] | null;
}

/** 导出查询分页结果 */
export interface InterviewExportPage {
  total: number;
  page: number;
  pageSize: number;
  list: InterviewExportRecord[];
}

/* ==================== 心理访谈 ==================== */

/** 访谈后评估等级：含「无需关注」，与关注列表 4 档 AttentionLevel 顺序不同，勿混用 */
export type InterviewLevel = '无需关注' | '一般关注' | '日常关注' | '重点关注' | '密切关注';

/** 学期（服务端按 Asia/Shanghai 推导：第一学期 8/1–次年 1/31，第二学期 2/1–7/31） */
export interface SemesterInfo {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  daysLeft: number;
}

/** 心理访谈记录（字段对齐纸质《心理访谈记录单》，answers 按模板题目 key 存储） */
export interface MentalInterview {
  id: string;
  studentId: Id;
  studentName: string;
  className?: string | null;
  semesterKey: string;
  semesterLabel: string;
  interviewDate: string;
  interviewerId?: number | null;
  interviewerName: string;
  levelBefore?: string | null;
  levelAfter: InterviewLevel;
  answers: Record<string, string>;
  summary: string;
  signatureName: string;
  signedAt: string;
  formVersion: number;
  /** 填写时所用的记录单模板（快照，模板后续改题不影响本条记录） */
  templateId?: string | null;
  templateVersion?: number | null;
  formGroups?: InterviewTemplateGroup[] | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  createdAt: string;
}

/** 某学生某学期的访谈视图（进度 + 记录列表 + 写权 + 生效记录单模板） */
export interface MentalInterviewView {
  student: { id: Id; name: string; studentNo: string; className: string };
  semester: SemesterInfo;
  required: number;
  done: number;
  canWrite: boolean;
  level: AttentionLevel | null;
  list: MentalInterview[];
  /** 该生当前生效的记录单模板（按年级解析；渲染表单与历史问答兜底用） */
  form: InterviewFormModel;
}

/** 关注等级变更审计（手工调整 / 访谈评估联动 / 记录作废 / 初始化基线） */
export interface MentalLevelLog {
  id: number;
  studentId: Id;
  studentName: string;
  fromLevel: string | null;
  toLevel: string | null;
  source: 'init' | 'manual' | 'interview' | 'interview-edit' | 'interview-delete';
  refId?: string | null;
  operatorName?: string | null;
  note?: string | null;
  createdAt: string;
}

/** 本学期访谈未达标学生（横幅/待完成名单用） */
export interface InterviewPendingStudent {
  id: Id;
  name: string;
  studentNo: string;
  className: string;
  classId?: number | null;
  level: AttentionLevel | null;
  done: number;
  required: number;
  canWrite: boolean;
}

/** 本学期访谈任务总览（页面横幅数据源） */
export interface InterviewOverview {
  semester: SemesterInfo;
  required: number;
  pendingCount: number;
  pending: InterviewPendingStudent[];
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
  /** 创建人用户 ID（服务端按此严格隔离：仅本人可见/可编辑/可删除；历史共享数据归属管理员） */
  createdBy?: number | null;
}

export interface TodoQuery extends PageQuery {
  type?: TodoType;
  priority?: TodoPriority;
  status?: TodoStatus;
}

export type TodoInput = Pick<
  Todo,
  'title' | 'type' | 'priority' | 'dueDate'
> & {
  /** 截止时间 HH:mm；null = 清空（JSON 会丢弃 undefined，清空必须显式传 null） */
  dueTime?: string | null;
  /** 关联学生姓名；null = 清空 */
  relatedStudent?: string | null;
  /** 备注；null = 清空 */
  note?: string | null;
};

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

/* ==================== 数据管理（备份 / 恢复 / 迁移） ==================== */

/** 数据包类型（字典项，与服务端 lib/datamgmt.js 的 BUNDLE_KINDS 一致） */
export type BundleKind = '手动备份' | '自动备份' | '恢复前快照' | '迁移包' | '上传包';

/** 数据包元信息：包体落盘于服务端 data/backups，列表只回索引与校验信息 */
export interface DataBundle {
  id: number;
  kind: BundleKind;
  label: string;
  note?: string | null;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  schemaVersion: number;
  /** 各数据表条数快照 { students: 120, ... } */
  counts: Record<string, number>;
  createdBy?: string | null;
  createdAt: string;
}

export interface BundleInput {
  /** 数据包标签（必填） */
  label: string;
  /** 备注（选填） */
  note?: string | null;
  /** 类型：手动备份（默认）/ 迁移包；其余类型由系统内部产生 */
  kind?: BundleKind;
}

export interface BundleQuery extends PageQuery {
  kind?: BundleKind;
  startDate?: string;
  endDate?: string;
  sortBy?: 'createdAt' | 'sizeBytes' | 'id';
  sortOrder?: 'asc' | 'desc';
}

/** 自动备份策略 */
export interface AutoBackupConfig {
  enabled: boolean;
  /** 间隔小时数（字典项：1 / 2 / 4 / 6 / 12 / 24） */
  intervalHours: number;
  /** 环形保留份数 3–30 */
  keep: number;
  lastRunAt?: string | null;
  /** 上次内容签名（签名未变则跳过写包） */
  lastSignature?: string | null;
}

/** 数据管理操作日志 */
export interface DataOplogItem {
  id: number;
  ts: string;
  actor?: string | null;
  action: string;
  summary?: string | null;
}

/** 数据包校验明细（恢复预检） */
export interface BundleCheck {
  item: string;
  ok: boolean;
  detail: string;
}

/** 恢复预检结果：不落盘，仅返回校验明细与条数差异 */
export interface RestorePreview {
  ok: boolean;
  checks: BundleCheck[];
  diff: { table: string; current: number; incoming: number; delta: number }[];
  meta: {
    kind?: string | null;
    label?: string | null;
    exportedAt?: string | null;
    source?: string | null;
    schemaVersion?: number | null;
  };
}

/** 数据总览 */
export interface DataOverview {
  generatedAt: string;
  schemaVersion: number;
  appVersion: string;
  tables: string[];
  counts: Record<string, number>;
  db: { file: string; sizeBytes: number; walBytes: number };
  uploads: { files: number; bytes: number };
  bundles: { total: number; bytes: number; byKind: { kind: string; n: number; bytes: number }[] };
  latestBundle: { id: number; label: string; kind: string; createdAt: string } | null;
  autoBackup: AutoBackupConfig;
  oplog: DataOplogItem[];
}
