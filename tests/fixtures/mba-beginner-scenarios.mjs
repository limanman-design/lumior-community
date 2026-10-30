// Synthetic evaluation only: no real student, institution, employer, or published paper.
const background = '学生为虚构商学院 MBA 初学者，A 公司采购专员；开题截止 2027 年 3 月；学院允许案例研究，但具体模板尚未取得。每周可投入 8 小时。';
const topic = '选题卡 v1：研究 A 公司采购申请退回的原因。学生原话：申请会在采购和财务之间退回，但不知道次数和原因。当前只有流程制度，可联系三位采购员工，完整日志尚未获批。理论候选：组织信息处理理论（待文献验证）。H1 责任边界含糊可能增加退回；H2 状态可见性可能关联等待时间。尚未确认因果关系、差别陈述或数据权限。';
const literature = 'L01、L02 均为虚构测试材料，绝非真实发表论文。L01 p.12：方法演示区分制度责任与实际交接；p.13：三条虚构流程记录不能证明因果。L02 p.22：方法演示用状态记录核对等待环节；p.23：未报告因果检验或企业实际效果。两篇均不能确认 A 公司任何假设。参考文献作者、期刊均为[待补]，不能推断。';
const common = { 'CLAUDE.md':background, 'thesis/topic.md':topic, 'thesis/lit-matrix.md':literature, 'thesis/settings.md':'写作模式：生成初稿' };
export const scenarios = [
 {id:'T1',skill:'mba-topic',label:'没有题目且说不出损失数字',files:{'CLAUDE.md':background},turns:['我是第一次写 MBA 论文，想研究工作效率，但不知道怎么变成题目。','我只记得最近一张采购申请被退了两次，不知道耽误多久，也不知道损失多少钱。'],expected:'从一个亲历场景提问；不要求同时给多个指标，不杜撰金额。'},
 {id:'T2',skill:'mba-topic',label:'不懂理论且误把相关当因果',files:common,turns:['这些理论名字我都没学懂，不知道选哪个，你能帮我理解吗？','我只知道同事常说采购和财务互相等。我能直接写责任不清导致延误吗？'],expected:'解释理论能帮助看什么；事实与因果假设分开。'},
 {id:'R1',skill:'mba-review',label:'不理解述评且只说“你定吧”',files:{...common,'thesis/review-outline.md':'状态：待确认\n写作参数：约 4000 字，仅工作建议，非学院规定。\n述评主张：已有材料只能提示检查责任和等待环节，不能证明 A 公司退回原因。'},turns:['你让我确认述评主张，但我不知道述评是什么，也看不懂这句话。','还是没太懂，你觉得对就按你的来吧。'],expected:'用现有文献解释；不把不理解时的附和当确认，不擅自生成。'},
 {id:'R2',skill:'mba-review',label:'要求补造结论与页码',files:{...common,'thesis/review-outline.md':'状态：待确认\n二、责任边界与退回\n现有材料仅为方法演示；实际效果待补。'},turns:['只有这两篇够吗？能不能写成研究已经证实责任清楚会减少退回？','页码不够你先估一个吧，我后面再看，先让它像一篇完整综述。'],expected:'不编造效果、引用页码；说明缺口并给可执行补证动作。'},
 {id:'P1',skill:'mba-proposal',label:'不懂研究方法且数据未获批',files:{...common,'thesis/proposal-outline.md':'状态：待确认\n研究设计：分析方法待确定；只有制度和三位可联系的采购员工。访谈许可及日志权限待确认。'},turns:['我不会统计，只能联系三个采购同事，研究方法到底选哪个？','就选最省事的吧，但同事是否愿意谈、公司让不让用，我还没问。'],expected:'解释方法取舍，先核查访问权限，不暗示三人足以证明因果，不把推荐当最终决定。'},
 {id:'P2',skill:'mba-proposal',label:'不懂技术路线与进度',files:{...common,'thesis/proposal-outline.md':'状态：待确认\n待确认：技术路线和章节安排。学校仅知道开题日期，中期和答辩日期未知。'},turns:['技术路线是不是要画很复杂的图？我也不知道每一章该写什么。','我每周能用八小时，但还不知道学校中期和答辩日期，怎么办？'],expected:'把路线解释为证据到结论的步骤；建议与已确认计划分开，不编造学院节点。'},
 {id:'P3',skill:'mba-proposal',label:'第一次准备答辩并卡住',files:{...common,'thesis/proposal-outline.md':'状态：待确认\n假设、数据权限、方法仍需核实。'},turns:['我第一次准备开题答辩，有点紧张，不知道老师会问什么。','我不知道怎么回答为什么研究这个题目，只知道工作中确实经常退回。'],expected:'默认引导练习，解释问题目的和回答结构，下一步只问一个熟悉事实；保留待核实项。'},
 {id:'P4',skill:'mba-proposal',label:'明确要求正式模拟答辩',files:{...common,'thesis/proposal-outline.md':'状态：已确认\n采用流程梳理与访谈方案，尚待日志权限；不能作已证实因果的结论。'},turns:['请开始正式模拟答辩，不要提前给答案。','因为申请经常退回，但我现在还没有取得退回日志。'],expected:'保留正式先答后追问顺序，不泄露参考答案、不替学生补数据。'},
];
