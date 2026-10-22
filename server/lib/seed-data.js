/**
 * 示例数据（首次启动时写入）。
 * 日期为固定的演示数据；正式使用前可由管理员清理（见 docs/deploy.md）。
 */

const counselors = [
  ['zhenann', '周振南'],
  ['hanwen', '张瀚文'],
  ['jinglei', '张婧蕾'],
  ['wujiu', '孙五九'],
  ['yuying', '卢雨颖'],
  ['zhangling', '张玲'],
  ['huaying', '包骅瑛'],
  ['xiquin', '唐溪琴'],
];

const students = [
  { id: 's01', studentNo: '2024010101', name: '陈嘉豪', gender: '男', grade: '2024级', major: '计算机应用技术', className: '计应2401', phone: '13857102345', dorm: '学生公寓5-412', politicalStatus: '共青团员', origin: '浙江杭州', status: '在读', headTeacher: '李国强', counselor: '王老师', fatherName: '陈志明', fatherPhone: '13705711234', motherName: '刘桂芳', motherPhone: '13868102233', position: '班长', enrollDate: '2024-09-12' },
  { id: 's02', studentNo: '2024010102', name: '林思彤', gender: '女', grade: '2024级', major: '计算机应用技术', className: '计应2401', phone: '13968041236', dorm: '学生公寓8-215', politicalStatus: '共青团员', origin: '浙江温州', status: '在读', headTeacher: '李国强', counselor: '王老师', fatherName: '林卫东', fatherPhone: '13906712345', motherName: '王秀英', motherPhone: '15858103456', position: '学习委员', enrollDate: '2024-09-12' },
  { id: 's03', studentNo: '2024010103', name: '王梓轩', gender: '男', grade: '2024级', major: '计算机应用技术', className: '计应2401', phone: '13588320941', dorm: '学生公寓5-408', politicalStatus: '群众', origin: '安徽阜阳', status: '在读', headTeacher: '李国强', counselor: '王老师', fatherName: '王建军', motherName: '张丽萍', motherPhone: '13656789012', remark: '家庭经济困难，已入库；学费缓缴', enrollDate: '2024-09-12' },
  { id: 's04', studentNo: '2024010104', name: '赵雨欣', gender: '女', grade: '2024级', major: '计算机应用技术', className: '计应2401', phone: '15868102234', dorm: '学生公寓8-219', politicalStatus: '中共预备党员', origin: '浙江宁波', status: '在读', headTeacher: '李国强', counselor: '王老师', fatherName: '赵国强', fatherPhone: '13516879012', motherName: '李海燕', motherPhone: '13738291045', position: '团支书', enrollDate: '2024-09-12' },
  { id: 's05', studentNo: '2024010201', name: '李昊然', gender: '男', grade: '2024级', major: '计算机应用技术', className: '计应2402', phone: '13735689012', dorm: '学生公寓5-415', politicalStatus: '共青团员', origin: '浙江金华', status: '在读', headTeacher: '陈慧芳', counselor: '王老师', fatherName: '李伟民', fatherPhone: '13857659012', motherName: '周雪芬', motherPhone: '15906871234', remark: '上学期两门课程不及格', enrollDate: '2024-09-12' },
  { id: 's06', studentNo: '2024010202', name: '黄晓婷', gender: '女', grade: '2024级', major: '计算机应用技术', className: '计应2402', phone: '13656890741', dorm: '学生公寓8-223', politicalStatus: '群众', origin: '江西赣州', status: '在读', headTeacher: '陈慧芳', counselor: '王老师', fatherName: '黄志强', fatherPhone: '13600981234', motherName: '陈美玲', motherPhone: '13805715678', enrollDate: '2024-09-12' },
  { id: 's07', studentNo: '2024020101', name: '吴宇轩', gender: '男', grade: '2024级', major: '大数据技术', className: '大数2401', phone: '15957123408', dorm: '学生公寓6-301', politicalStatus: '共青团员', origin: '浙江台州', status: '在读', headTeacher: '周建国', counselor: '王老师', fatherName: '吴天明', fatherPhone: '15868782345', motherName: '郑小燕', motherPhone: '13706718901', position: '体育委员', enrollDate: '2024-09-12' },
  { id: 's08', studentNo: '2024020102', name: '郑晓彤', gender: '女', grade: '2024级', major: '大数据技术', className: '大数2401', phone: '13587612093', dorm: '学生公寓8-305', politicalStatus: '群众', origin: '河南周口', status: '在读', headTeacher: '周建国', counselor: '王老师', fatherName: '郑国庆', fatherPhone: '13587612309', motherName: '孙爱华', motherPhone: '13868129045', position: '心理委员', remark: '近期情绪波动较大，重点关注', enrollDate: '2024-09-12' },
  { id: 's09', studentNo: '2024020103', name: '冯子豪', gender: '男', grade: '2024级', major: '大数据技术', className: '大数2401', phone: '13819057682', dorm: '学生公寓6-303', politicalStatus: '共青团员', origin: '浙江绍兴', status: '休学', statusChangedAt: '2026-09-01', headTeacher: '周建国', counselor: '王老师', fatherName: '冯德海', fatherPhone: '13819045672', motherName: '何秀娟', motherPhone: '15906892341', remark: '因病休学（2026年9月起），保留学籍一年', enrollDate: '2024-09-12' },
  { id: 's10', studentNo: '2024030101', name: '徐若琳', gender: '女', grade: '2024级', major: '电子商务', className: '电商2401', phone: '15829013476', dorm: '学生公寓9-208', politicalStatus: '中共预备党员', origin: '浙江杭州', status: '在读', headTeacher: '吴晓萍', counselor: '王老师', fatherName: '徐永康', fatherPhone: '15829018763', motherName: '王芳华', motherPhone: '13706895412', position: '班长', enrollDate: '2024-09-12' },
  { id: 's11', studentNo: '2025010101', name: '孙浩然', gender: '男', grade: '2025级', major: '计算机应用技术', className: '计应2501', phone: '13600938472', dorm: '学生公寓5-520', politicalStatus: '共青团员', origin: '浙江衢州', status: '在读', headTeacher: '郑立群', counselor: '王老师', fatherName: '孙立军', fatherPhone: '13600983472', motherName: '吴丽丽', motherPhone: '15906852341', enrollDate: '2025-09-10' },
  { id: 's12', studentNo: '2025010102', name: '何雨欣', gender: '女', grade: '2025级', major: '计算机应用技术', className: '计应2501', phone: '15988820364', dorm: '学生公寓8-402', politicalStatus: '群众', origin: '贵州毕节', status: '在读', headTeacher: '郑立群', counselor: '王老师', fatherName: '何大山', fatherPhone: '13856789021', motherName: '杨春花', motherPhone: '15868091345', remark: '家庭经济困难，已入库', enrollDate: '2025-09-10' },
  { id: 's13', studentNo: '2025010103', name: '高梓涵', gender: '男', grade: '2025级', major: '计算机应用技术', className: '计应2501', phone: '13867459021', dorm: '学生公寓5-522', politicalStatus: '共青团员', origin: '浙江嘉兴', status: '在读', headTeacher: '郑立群', counselor: '王老师', fatherName: '高峰', fatherPhone: '13867451209', motherName: '林晓虹', motherPhone: '15906873412', position: '学习委员', enrollDate: '2025-09-10' },
  { id: 's14', studentNo: '2025010104', name: '罗一鸣', gender: '男', grade: '2025级', major: '计算机应用技术', className: '计应2501', phone: '13556820943', dorm: '学生公寓5-520', politicalStatus: '群众', origin: '四川南充', status: '在读', headTeacher: '郑立群', counselor: '王老师', fatherName: '罗建军', fatherPhone: '13556829043', motherName: '唐雪梅', motherPhone: '13806789125', remark: '旷课次数偏多，重点关注出勤', enrollDate: '2025-09-10' },
  { id: 's15', studentNo: '2025020101', name: '蔡欣怡', gender: '女', grade: '2025级', major: '大数据技术', className: '大数2501', phone: '15868751203', dorm: '学生公寓8-410', politicalStatus: '共青团员', origin: '浙江湖州', status: '在读', headTeacher: '冯雅琴', counselor: '王老师', fatherName: '蔡国祥', fatherPhone: '15868759012', motherName: '沈玉芬', motherPhone: '13606891245', position: '文艺委员', enrollDate: '2025-09-10' },
  { id: 's16', studentNo: '2025020102', name: '潘俊熙', gender: '男', grade: '2025级', major: '大数据技术', className: '大数2501', phone: '13625980734', dorm: '学生公寓6-405', politicalStatus: '群众', origin: '浙江温州', status: '在读', headTeacher: '冯雅琴', counselor: '王老师', fatherName: '潘志成', fatherPhone: '13625981276', motherName: '徐海燕', motherPhone: '13857691230', enrollDate: '2025-09-10' },
  { id: 's17', studentNo: '2025040101', name: '蒋依琳', gender: '女', grade: '2025级', major: '学前教育', className: '学前2501', phone: '15906712385', dorm: '学生公寓10-306', politicalStatus: '中共预备党员', origin: '浙江杭州', status: '在读', headTeacher: '许美娟', counselor: '王老师', fatherName: '蒋文斌', fatherPhone: '15906718902', motherName: '陈晓萍', motherPhone: '13805712643', position: '团支书', enrollDate: '2025-09-10' },
  { id: 's18', studentNo: '2025040102', name: '沈梦琪', gender: '女', grade: '2025级', major: '学前教育', className: '学前2501', phone: '13805718946', dorm: '学生公寓10-311', politicalStatus: '群众', origin: '浙江丽水', status: '在读', headTeacher: '许美娟', counselor: '王老师', fatherName: '沈国华', fatherPhone: '13805761293', motherName: '叶小红', motherPhone: '15858093412', enrollDate: '2025-09-10' },
  { id: 's19', studentNo: '2025050101', name: '韩志强', gender: '男', grade: '2025级', major: '机电一体化技术', className: '机电2501', phone: '13656907413', dorm: '学生公寓7-208', politicalStatus: '共青团员', origin: '安徽六安', status: '在读', headTeacher: '沈国栋', counselor: '王老师', fatherName: '韩广田', fatherPhone: '13656912307', motherName: '刘桂香', motherPhone: '15868091276', remark: '家庭突发变故，情绪低落', enrollDate: '2025-09-10' },
  { id: 's20', studentNo: '2025050102', name: '曹雅静', gender: '女', grade: '2025级', major: '机电一体化技术', className: '机电2501', phone: '15812036947', dorm: '学生公寓9-405', politicalStatus: '群众', origin: '浙江宁波', status: '在读', headTeacher: '沈国栋', counselor: '王老师', fatherName: '曹永强', fatherPhone: '15812039462', motherName: '王雅琴', motherPhone: '13606789023', enrollDate: '2025-09-10' },
  { id: 's21', studentNo: '2026010101', name: '谢明轩', gender: '男', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '13858019367', dorm: '学生公寓5-602', politicalStatus: '共青团员', origin: '浙江杭州', status: '在读', headTeacher: '罗海燕', counselor: '王老师', fatherName: '谢东升', fatherPhone: '13858061293', motherName: '钱雅芳', motherPhone: '15906891204', enrollDate: '2026-09-08' },
  { id: 's22', studentNo: '2026010102', name: '袁欣妍', gender: '女', grade: '2026级', major: '计算机应用技术', className: '计应2601', phone: '15957180246', dorm: '学生公寓8-508', politicalStatus: '群众', origin: '浙江舟山', status: '在读', headTeacher: '罗海燕', counselor: '王老师', fatherName: '袁伟民', fatherPhone: '15957183206', motherName: '倪春燕', motherPhone: '13806791245', position: '生活委员', remark: '新生适应期，需关注', enrollDate: '2026-09-08' },
  { id: 's23', studentNo: '2026030101', name: '唐浩宇', gender: '男', grade: '2026级', major: '电子商务', className: '电商2601', phone: '13606539871', dorm: '学生公寓6-503', politicalStatus: '共青团员', origin: '浙江金华', status: '在读', headTeacher: '唐志强', counselor: '王老师', fatherName: '唐建军', fatherPhone: '13606531287', motherName: '黄丽萍', motherPhone: '15868792130', enrollDate: '2026-09-08' },
  { id: 's24', studentNo: '2026040101', name: '顾语嫣', gender: '女', grade: '2026级', major: '学前教育', className: '学前2601', phone: '15888721094', dorm: '学生公寓10-402', politicalStatus: '中共预备党员', origin: '浙江湖州', status: '在读', headTeacher: '高丽娜', counselor: '王老师', fatherName: '顾建明', fatherPhone: '15888763102', motherName: '费晓芳', motherPhone: '13806752941', position: '班长', enrollDate: '2026-09-08' },
];

const conversations = [
  { id: 'c01', studentId: 's08', talkTime: '2026-09-29 15:30', way: '面对面', type: '心理疏导', needFollowUp: true, content: '近期情绪波动明显，与室友关系紧张。已倾听其诉求，引导其正确处理宿舍矛盾，并建议前往学校心理咨询中心预约咨询。', followUp: '一周后回访，确认心理咨询预约情况' },
  { id: 'c02', studentId: 's05', talkTime: '2026-09-27 10:00', way: '面对面', type: '学业指导', needFollowUp: true, content: '针对上学期两门课程不及格情况进行谈话，分析原因主要为沉迷网络游戏。已共同制定本学期学习计划，约定每两周检查一次学习进度。', followUp: '10月上旬检查学习计划执行情况' },
  { id: 'c03', studentId: 's19', talkTime: '2026-09-25 16:00', way: '面对面', type: '生活关怀', needFollowUp: true, content: '家庭突发变故（父亲住院），情绪低落。已进行安抚疏导，协助其提交临时困难补助申请，并叮嘱班委多加关心。', followUp: '跟进临时困难补助申请审批进度' },
  { id: 'c04', studentId: 's21', talkTime: '2026-09-21 14:00', way: '电话', type: '学业指导', needFollowUp: false, content: '新生入学以来总体适应良好，对专业学习存在困惑。已介绍专业课程体系和职业发展方向，鼓励其尽早建立学习目标。' },
  { id: 'c05', studentId: 's14', talkTime: '2026-09-18 09:30', way: '面对面', type: '违纪教育', needFollowUp: true, content: '本周累计旷课4节，对其进行批评教育。本人认识到错误，承诺按时报到上课，并上交书面检查。', followUp: '下周核查出勤情况' },
  { id: 'c06', studentId: 's03', talkTime: '2026-09-05 15:00', way: '面对面', type: '资助帮扶', needFollowUp: false, content: '了解家庭经济情况，讲解国家助学金和勤工助学政策，指导其完成本学年家庭经济困难认定申请材料。' },
  { id: 'c07', studentId: 's02', talkTime: '2026-08-28 11:00', way: '面对面', type: '就业指导', needFollowUp: false, content: '大二学生开始考虑职业规划，讨论了专升本与直接就业的利弊，建议先夯实专业基础并考取相关技能证书。' },
  { id: 'c08', studentId: 's12', talkTime: '2026-08-21 16:30', way: '电话', type: '心理疏导', needFollowUp: false, content: '开学初出现想家情绪，通过电话进行疏导，鼓励其积极参加社团活动，尽快融入集体生活。', followUp: '关注其军训及社团参与情况' },
  { id: 'c09', studentId: 's17', talkTime: '2026-08-13 10:30', way: '面对面', type: '学业指导', needFollowUp: false, content: '作为团支书工作压力较大，学业出现波动。帮助其平衡学生工作与学习，调整时间管理方式。' },
  { id: 'c10', studentId: 's10', talkTime: '2026-08-06 14:30', way: '线上', type: '就业指导', needFollowUp: false, content: '咨询暑期实习选择问题，提供了电商平台运营方向的实习建议，并推荐了两个校内合作企业的实习岗位。' },
  { id: 'c11', studentId: 's06', talkTime: '2026-07-30 09:00', way: '面对面', type: '生活关怀', needFollowUp: false, content: '与室友因作息问题产生矛盾申请调换宿舍，了解事情经过后进行调解，双方已达成和解。' },
  { id: 'c12', studentId: 's22', talkTime: '2026-09-30 09:00', way: '面对面', type: '生活关怀', needFollowUp: false, content: '新生入学三周，总体适应良好。咨询四六级报名和专业分流政策，已详细解答。' },
  { id: 'c13', studentId: 's23', talkTime: '2026-09-28 19:00', way: '线上', type: '违纪教育', needFollowUp: true, content: '在宿舍使用违规电器被查，线上进行提醒教育，重申宿舍安全管理规定。', followUp: '复查宿舍安全隐患整改情况' },
  { id: 'c14', studentId: 's01', talkTime: '2026-09-22 12:30', way: '面对面', type: '学业指导', needFollowUp: false, content: '作为班长反映班级晚自习纪律问题，共同商议班规执行方案，并提醒其注意学生工作与学业的平衡。' },
  { id: 'c15', studentId: 's20', talkTime: '2026-09-12 15:30', way: '面对面', type: '心理疏导', needFollowUp: true, content: '期初心理测评提示轻度焦虑，进行面谈了解，主要压力来源于家庭期望，已进行情绪疏导。', followUp: '一个月后复评' },
];

const warnings = [
  { id: 'w01', studentId: 's08', type: '心理预警', level: '橙色', reason: '连续两周情绪低落，室友反映其夜间常失眠哭泣，心理委员上报', raisedAt: '2026-09-28 09:00', status: '待处理' },
  { id: 'w02', studentId: 's05', type: '学业预警', level: '红色', reason: '2025-2026-2学期不及格学分达8学分，触发红色学业预警', raisedAt: '2026-09-24 10:00', status: '处理中', handleNote: '已约谈并制定学业帮扶计划，已告知家长，安排学习委员结对帮扶', handledAt: '2026-09-26 14:00' },
  { id: 'w03', studentId: 's14', type: '行为预警', level: '橙色', reason: '本月累计旷课12节，且两次夜不归宿', raisedAt: '2026-09-23 11:00', status: '处理中', handleNote: '已进行纪律谈话，联系家长共同监督，每日查寝确认在寝情况', handledAt: '2026-09-24 09:30' },
  { id: 'w04', studentId: 's19', type: '经济困难预警', level: '黄色', reason: '父亲重病住院，家庭主要收入来源中断', raisedAt: '2026-09-25 15:00', status: '处理中', handleNote: '已协助提交临时困难补助申请，待学校审核', handledAt: '2026-09-26 10:00' },
  { id: 'w05', studentId: 's12', type: '学业预警', level: '黄色', reason: '高等数学期中测试不及格，学习基础薄弱', raisedAt: '2026-09-15 14:00', status: '已解除', handleNote: '安排一对一辅导，期末测验成绩回升至75分', handledAt: '2026-09-20 16:00' },
  { id: 'w06', studentId: 's03', type: '经济困难预警', level: '黄色', reason: '家庭为低保户，本学期学费缓缴', raisedAt: '2026-09-10 09:30', status: '已解除', handleNote: '已完成困难认定，纳入国家助学金资助名单', handledAt: '2026-09-12 11:00' },
  { id: 'w07', studentId: 's09', type: '学业预警', level: '橙色', reason: '因病休学办理期间多门课程缺考，需确认学分补救方案', raisedAt: '2026-09-05 10:30', status: '待处理' },
  { id: 'w08', studentId: 's16', type: '心理预警', level: '黄色', reason: '期初心理测评提示焦虑因子偏高，需进一步访谈评估', raisedAt: '2026-09-27 16:00', status: '待处理' },
  { id: 'w09', studentId: 's01', type: '学业预警', level: '黄色', reason: '上学期专业基础课不及格，班长事务影响学业投入', raisedAt: '2026-09-12 14:30', status: '待处理' },
];

const notices = [
  { id: 'n01', title: '关于2026年国庆节假期安全注意事项的通知', type: '安全提醒', scope: '全部学生', status: '已发布', pinned: true, publishAt: '2026-09-29 10:00', createdAt: '2026-09-29 09:30', author: '王老师', content: '各位同学：\n2026年国庆节放假时间为10月1日至10月8日，10月9日（周五）正常上课。假期期间请注意以下事项：\n1. 离校学生须履行请假手续，登记离校去向和联系方式，返校后及时销假；\n2. 注意交通安全、防溺水、防电信诈骗，不乘坐无营运资质车辆；\n3. 留校学生须遵守宿舍管理规定，严禁使用违规电器，宿舍长每日报告在寝情况；\n4. 假期结束前请各班班长统计返校情况，并于10月8日20:00前报告辅导员。' },
  { id: 'n02', title: '关于开展2026年国家奖学金、国家励志奖学金评定的通知', type: '评奖评优', scope: '全部学生', status: '已发布', pinned: false, publishAt: '2026-09-27 09:00', createdAt: '2026-09-27 08:40', author: '王老师', content: '各位同学：\n根据学校统一安排，现启动2026年国家奖学金、国家励志奖学金评定工作。\n一、申请条件：热爱祖国，遵守学校规章制度；上学年学习成绩排名与综合测评排名均位于专业前10%（国家奖学金）/前30%（励志奖学金，须为家庭经济困难学生）。\n二、申请方式：请于10月10日17:00前在「审批中心-奖学金申请」提交申请，并同步提交成绩单电子版。\n三、评定程序：班级民主评议→辅导员审核→学院评审公示→学校审定。' },
  { id: 'n03', title: '关于开展2026年秋季学期心理健康普查的通知', type: '事务通知', scope: '全部学生', status: '已发布', pinned: false, publishAt: '2026-09-25 15:00', createdAt: '2026-09-25 14:30', author: '王老师', content: '各位同学：\n学校心理健康教育中心定于9月28日至10月15日开展秋季学期心理健康普查，请全体同学在规定时间内登录「心晴驿站」平台完成测评问卷（约10分钟）。\n测评结果仅用于心理健康服务，请如实作答。如近期有情绪困扰，欢迎预约心理咨询。' },
  { id: 'n04', title: '迎新晚会节目征集开始啦', type: '活动通知', scope: '2026级', status: '已发布', pinned: false, publishAt: '2026-09-22 11:30', createdAt: '2026-09-22 11:00', author: '王老师', content: '2026级的新同学们：\n学院迎新晚会定于10月下旬举行，现面向全体新生征集节目，类型不限（歌舞、小品、朗诵、乐器演奏等）。\n有意向的同学请以班级为单位，由文艺委员汇总后于10月8日前报送至辅导员处，名额有限，先到先得！' },
  { id: 'n05', title: '关于组织宿舍消防安全疏散演练的通知', type: '安全提醒', scope: '2025级', status: '草稿', pinned: false, publishAt: null, createdAt: '2026-09-28 16:00', author: '王老师', content: '各位同学：\n为增强消防安全意识，学校定于10月中旬组织宿舍消防安全疏散演练，届时将拉响警报，请同学们按疏散路线有序撤离至操场集合。\n具体时间另行通知。' },
  { id: 'n06', title: '2026年秋季学期国家助学贷款办理指南', type: '事务通知', scope: '全部学生', status: '已撤回', pinned: false, publishAt: '2026-08-31 10:00', createdAt: '2026-08-31 09:40', author: '王老师', content: '需要办理2026年秋季学期国家助学贷款的同学：\n请于9月30日前将贷款申请材料（申请表、身份证复印件、家庭经济困难认定表）提交至辅导员处，逾期不予受理。' },
  { id: 'n07', title: '班会通知：新学期第一次主题班会', type: '事务通知', scope: '计应2601', status: '草稿', pinned: false, publishAt: null, createdAt: '2026-09-29 18:00', author: '王老师', content: '计应2601班全体同学：\n定于本周五举行新学期第一次主题班会，具体时间地点待定，暂不发布。' },
  { id: 'n08', title: '校运动会志愿者招募', type: '活动通知', scope: '全部学生', status: '已发布', pinned: false, publishAt: '2026-09-18 14:00', createdAt: '2026-09-18 13:30', author: '王老师', content: '校运动会将于10月下旬举行，现招募赛事志愿者30名，负责检录、计时、后勤等工作，可认定志愿服务时长。\n有意向的同学请于10月5日前扫码报名，有赛事服务经验者优先。' },
];

const todos = [
  { id: 't01', title: '与郑晓彤进行心理约谈', type: '谈话提醒', priority: '高', dueDate: '2026-09-30', dueTime: '16:00', status: '未完成', relatedStudent: '郑晓彤', note: '心理预警学生，需完成首次约谈并记录谈话台账', createdAt: '2026-09-28 09:00' },
  { id: 't02', title: '提交9月学工台账及谈心谈话记录', type: '数据填报', priority: '高', dueDate: '2026-09-30', dueTime: '17:30', status: '未完成', note: '学工办要求，台账模板见工作群', createdAt: '2026-09-26 10:00' },
  { id: 't03', title: '参加学工办周例会', type: '会议安排', priority: '中', dueDate: '2026-09-30', dueTime: '14:00', status: '已完成', note: '地点：行政楼302会议室', createdAt: '2026-09-27 09:00' },
  { id: 't04', title: '跟进韩志强临时困难补助申请材料', type: '材料提交', priority: '高', dueDate: '2026-09-29', dueTime: '12:00', status: '未完成', relatedStudent: '韩志强', note: '补助申请今日截止，材料需补签字页', createdAt: '2026-09-27 15:00' },
  { id: 't05', title: '核查罗一鸣本周出勤情况', type: '谈话提醒', priority: '中', dueDate: '2026-09-29', dueTime: '09:00', status: '未完成', relatedStudent: '罗一鸣', note: '与任课教师核对其早课到课率', createdAt: '2026-09-24 10:00' },
  { id: 't06', title: '走访学生公寓5号楼宿舍', type: '宿舍走访', priority: '中', dueDate: '2026-10-02', dueTime: '19:00', status: '未完成', note: '重点走访计应2501、计应2601男生宿舍', createdAt: '2026-09-28 11:00' },
  { id: 't07', title: '完成心理预警学生周报', type: '数据填报', priority: '中', dueDate: '2026-10-03', dueTime: '17:00', status: '未完成', note: '报送心理健康教育中心', createdAt: '2026-09-29 14:00' },
  { id: 't08', title: '组织计应2401班主题班会', type: '会议安排', priority: '低', dueDate: '2026-10-05', dueTime: '19:00', status: '未完成', relatedStudent: '陈嘉豪', note: '主题：防电信诈骗，班长负责策划', createdAt: '2026-09-28 09:30' },
  { id: 't09', title: '收集奖学金评定申请材料', type: '材料提交', priority: '高', dueDate: '2026-10-04', dueTime: '17:00', status: '未完成', note: '10月10日截止，提前提醒各班学习委员', createdAt: '2026-09-29 09:00' },
  { id: 't10', title: '更新家庭经济困难学生库信息', type: '数据填报', priority: '低', dueDate: '2026-09-26', dueTime: '17:00', status: '已完成', createdAt: '2026-09-22 10:00' },
];

const approvals = [
  { id: 'a01', type: '学生请假', studentId: 's07', summary: '因感冒发烧申请病假2天（9月30日-10月1日），已提供校医院就诊证明', detail: null, submittedAt: '2026-09-30 08:40', status: '待审批', comment: null, approvedAt: null },
  { id: 'a02', type: '助学金申请', studentId: 's12', summary: '申请本学年国家助学金（二档），家庭经济困难认定已通过', detail: '困难认定等级：特殊困难；已提交《家庭经济困难学生认定申请表》', submittedAt: '2026-09-30 09:15', status: '待审批', comment: null, approvedAt: null },
  { id: 'a03', type: '学生请假', studentId: 's23', summary: '因参加省级电子商务技能竞赛集训，申请请假3天（10月1日-3日）', detail: '集训地点：实训楼A403，由指导教师带队', submittedAt: '2026-09-29 16:20', status: '待审批', comment: null, approvedAt: null },
  { id: 'a04', type: '活动申请', studentId: 's01', summary: '计应2401班申请组织「迎国庆」主题团日活动，需借用报告厅', detail: '活动时间：10月8日 19:00-21:00；预计参加人数：42人', submittedAt: '2026-09-29 14:00', status: '待审批', comment: null, approvedAt: null },
  { id: 'a05', type: '奖学金申请', studentId: 's10', summary: '申请国家励志奖学金，综合测评专业排名第2，家庭经济困难已认定', detail: null, submittedAt: '2026-09-28 10:30', status: '已通过', comment: '材料齐全，符合评定条件，同意推荐至学院评审', approvedAt: '2026-09-29 09:00' },
  { id: 'a06', type: '勤工助学', studentId: 's03', summary: '申请图书馆勤工助学岗位（每周8小时）', detail: null, submittedAt: '2026-09-26 11:00', status: '已通过', comment: '符合困难生资助条件，同意安排至图书馆流通部', approvedAt: '2026-09-27 15:00' },
  { id: 'a07', type: '活动申请', studentId: 's17', summary: '学前2501班申请外出参观幼儿园见习，需申请车辆与带队教师', detail: null, submittedAt: '2026-09-25 09:30', status: '已驳回', comment: '本学期见习由学院统一安排，个人申请暂不批准', approvedAt: '2026-09-26 16:00' },
];

const templateCategories = [
  { id: 'tc01', name: '学费缓缴申请' },
  { id: 'tc02', name: '阳光长跑免跑申请' },
  { id: 'tc03', name: '保健班申请' },
  { id: 'tc04', name: '换宿舍或退宿舍' },
  { id: 'tc05', name: '走读申请' },
  { id: 'tc06', name: '退学申请' },
  { id: 'tc07', name: '学籍异动申请' },
  { id: 'tc08', name: '体测免测和缓测' },
  { id: 'tc09', name: '新生军训' },
  { id: 'tc10', name: '其他模板' },
];

const templateFiles = [
  { id: 'tf01', name: '学费缓缴申请表', categoryId: 'tc01', format: 'docx', size: 42896, description: '用于家庭经济困难学生缓缴学费的申请与审批', uploader: '王老师', updatedAt: '2026-09-18 10:20' },
  { id: 'tf02', name: '学费缓缴情况汇总表', categoryId: 'tc01', format: 'xlsx', size: 21504, description: '各班缓缴名单汇总，报学工办留存', uploader: '王老师', updatedAt: '2026-08-31 16:40' },
  { id: 'tf03', name: '阳光长跑免跑申请表', categoryId: 'tc02', format: 'docx', size: 14802, description: '因伤病等原因免予阳光长跑的申请表（真实模板文件）', uploader: '王老师', updatedAt: '2026-09-10 09:10', assetUrl: '/templates/阳光长跑免跑申请.docx' },
  { id: 'tf04', name: '保健班申请表', categoryId: 'tc03', format: 'docx', size: 37888, description: '体育保健班准入申请，需附医院证明', uploader: '王老师', updatedAt: '2026-08-16 14:00' },
  { id: 'tf05', name: '学生换宿舍申请表', categoryId: 'tc04', format: 'docx', size: 47104, description: '校内宿舍调换申请，双方宿舍长签字', uploader: '王老师', updatedAt: '2026-09-22 11:30' },
  { id: 'tf06', name: '退宿申请表', categoryId: 'tc04', format: 'doc', size: 30208, description: '校外居住退宿申请，需家长签字确认', uploader: '王老师', updatedAt: '2026-09-22 11:32' },
  { id: 'tf07', name: '走读申请表', categoryId: 'tc05', format: 'docx', size: 36352, description: '走读生申请，含家长与班主任签署栏', uploader: '王老师', updatedAt: '2026-08-01 15:00' },
  { id: 'tf08', name: '走读安全承诺书', categoryId: 'tc05', format: 'pdf', size: 88432, description: '走读安全责任承诺，随走读申请一并提交', uploader: '王老师', updatedAt: '2026-08-01 15:05' },
  { id: 'tf09', name: '退学申请表', categoryId: 'tc06', format: 'doc', size: 28160, description: '退学申请及家长确认，须面谈后使用', uploader: '王老师', updatedAt: '2026-07-02 10:00' },
  { id: 'tf10', name: '学籍异动审批表', categoryId: 'tc07', format: 'docx', size: 52224, description: '休学、复学、保留学籍等异动通用审批表', uploader: '王老师', updatedAt: '2026-09-15 09:40' },
  { id: 'tf11', name: '体测免测申请表', categoryId: 'tc08', format: 'docx', size: 33792, description: '体质健康测试免测申请，附病历材料', uploader: '王老师', updatedAt: '2026-09-25 13:20' },
  { id: 'tf12', name: '体测缓测申请表', categoryId: 'tc08', format: 'docx', size: 33280, description: '因考试冲突或临时伤病申请缓测', uploader: '王老师', updatedAt: '2026-09-25 13:22' },
  { id: 'tf13', name: '军训请假申请表', categoryId: 'tc09', format: 'doc', size: 27136, description: '新生军训期间请假申请', uploader: '王老师', updatedAt: '2026-07-22 16:10' },
  { id: 'tf14', name: '军训免训申请表', categoryId: 'tc09', format: 'pdf', size: 96256, description: '免予军训申请，须附医疗证明', uploader: '王老师', updatedAt: '2026-07-22 16:12' },
  { id: 'tf15', name: '常用证明材料模板汇总', categoryId: 'tc10', format: 'xlsx', size: 18944, description: '在读证明、住宿证明等常用证明填写模板', uploader: '王老师', updatedAt: '2026-06-22 11:00' },
];

/**
 * 心理健康关注标记（studentId → 关注等级）。
 * 等级：密切关注 / 重点关注 / 日常关注 / 一般关注；仅带班辅导员可见本班数据。
 */
const mentalHealth = [
  { studentId: 's08', level: '密切关注', note: '近期情绪波动较大，心理预警处理中，已联动心理健康教育中心建立一生一策' },
  { studentId: 's19', level: '重点关注', note: '家庭突发变故（父亲重病），情绪低落，每周至少谈话一次' },
  { studentId: 's03', level: '重点关注', note: '家庭经济困难叠加学业压力，需持续关注状态' },
  { studentId: 's05', level: '日常关注', note: '两门课程不及格，学业焦虑明显，结合学业预警帮扶跟进' },
  { studentId: 's14', level: '日常关注', note: '旷课偏多，出勤与精神状态需持续观察' },
  { studentId: 's22', level: '一般关注', note: '新生适应期，观察班级融入情况' },
];

module.exports = { counselors, students, conversations, warnings, notices, todos, approvals, templateCategories, templateFiles, mentalHealth };
