import { newThesisProject, thesisSnapshot } from '../lib/thesis/model.ts';
import { thesisSettingsTemplate } from '../lib/thesis/skill-content.generated.ts';
export const topic=`# 选题卡 v1
更新：2026-10-23 · 来源：/mba-topic
状态：文献收敛中
## 暂定题目
A 公司采购审批责任边界优化研究
## 一句话研究问题
A 公司采购审批的责任边界不清如何造成退回与延迟？
## 论文类型
案例研究——毕业导向，以真实流程证据为准。
## 研究对象
A 公司采购部门；2025 年；学生是采购流程专员。
## 问题证据
学生原话：“申请经常在采购和财务之间退回，但尚未获得完整的退回原因日志。”
## 理论锚点（待文献验证）
组织信息处理理论——解释信息需求与流程协调能力的匹配。
## 数据来源与可得性
目前只有流程制度，可以联系三位采购员工，日志尚未获批。
## 待文献验证的关键假设
- H1：责任边界含糊会增加退回。
- H2：跨部门状态可见性与等待时间相关。
- H3：制度条文与实际执行存在差异。
## 已确认的前提
学生目标是按期毕业；使用 A 公司化名；只据现有材料下结论。
## 文献检索起点
主题：审批流程 + 责任边界；AND：采购 + 跨部门协同
`;
export const background='学校：虚构商学院 MBA\n开题截止：2027 年 3 月\n角色：A 公司采购流程专员\n学院限制：允许案例研究，匿名处理，尚无专用模板。目标：按期毕业。每周可投入 8 小时。';
export const paperNames=['Responsibility Boundaries in Approval Work','Visibility and Coordination in Workflow','Interviews for Process Diagnosis','Comparing Written and Enacted Procedures','Information Needs in Procurement','Exception Handling in Approval Chains'];
export function paperText(i,pages=3){return Array.from({length:pages},(_,page)=>`=== PDF p.${page+1} ===\nFICTIONAL ACCEPTANCE FIXTURE. Not a published paper.\n${paperNames[i]}\nFixture Author ${i+1}. Fictional Methods Journal. 2026, 1(1): ${101+i*20}-${100+i*20+pages}.\nPrinted page ${101+i*20+page}\n${page===0?'Abstract: This synthetic methods note describes approval work using invented examples. It is a methodological reference, not an empirical study of Company A.':''}\nMethod: A fictional worked example uses 3 invented workflow records, no real people. Responsibility is checked against written role rules.\nFinding: The worked example distinguishes assigned responsibility from actual handoffs. The log contains status changes; it does not demonstrate causality.\nLimitation: Invented demonstration only; no generalization or empirical causal conclusion.\nPrinted page ${101+i*20+page}\n`).join('\n');}
export function file(snapshot,path,text,uploaded=false){snapshot.files[path]={path,text,modifiedAt:1792738800000,...(uploaded?{uploaded:true,mediaType:'application/pdf',pages:(text.match(/=== PDF p\./g)||[]).length}: {})};return snapshot;}
export function matrixCard(i,difference='不适用（方法参考，未涉及同题研究）'){return `### L${String(i+1).padStart(2,'0')} ${paperNames[i]}\n- 引用：Fixture Author ${i+1}. ${paperNames[i]}[J]. Fictional Methods Journal, 2026, 1(1): ${101+i*20}-${103+i*20}.\n- 来源文件：thesis/refs/paper-${i+1}.pdf\n- 研究问题：如何核对流程记录与责任规则。\n- 理论：组织信息处理理论（理论解释尚待验证）。\n- 方法与样本：3 条虚构流程记录，方法演示。\n- 主要结论：\n  - 区分规定责任与实际交接（p.${102+i*20}）。\n  - 状态记录不能单独证明因果（p.${103+i*20}）。\n- 局限：虚构方法演示，不可推广。\n- 关系：方法参考\n- 假设表态：H1–H3 均不能据此确认或否定。\n- 差别陈述：${difference}\n- 可借用：流程记录核对方法（p.${102+i*20}）。\n`;}
export function base(withMatrix=true){const value=thesisSnapshot(newThesisProject('虚构 MBA 验收项目',thesisSettingsTemplate));file(value,'CLAUDE.md',background);file(value,'thesis/topic.md',topic);for(let i=0;i<2;i++)file(value,`thesis/refs/paper-${i+1}.pdf`,paperText(i),true);if(withMatrix){file(value,'thesis/lit-matrix.md','# 文献矩阵\n\n'+[0,1].map(i=>matrixCard(i)).join('\n'));value.literatureSequence=2;}return value;}
export const outline=`# 文献综述提纲\n状态：已确认\n确认日期：2026-10-23\n目标字数：800–1000 字（验收用短稿）\n综述主张：区分责任边界和可见性，现有材料只能提供核对方法，不能给出 A 公司因果结论。\n## 一、概念与范围\n- 区分制度责任与实际交接；L01（p.102）。\n## 二、证据比较\n- 两篇均为虚构方法演示；L01（p.103）、L02（p.123）。\n## 三、缺口与研究问题\n- A 公司仍需实际退回日志与访谈的交叉核验。\n生成意图：学生已明确确认此提纲并要求生成初稿。`;
export const validDraft=`> 本稿由 /mba-review 于 2026-10-23 根据选题卡 v1、文献矩阵与已确认的提纲生成。\n> 提交前请逐句核对，按自己的理解修改；文末的“核对表”在提交前删除。\n> 学院对使用 AI 有说明要求的，请按要求披露。\n\n# 采购审批综述\n\n## 一、概念与范围\n现有方法材料区分了制度中的责任与实际交接[1]。记录可用于核对，但不能单独证明因果[2]。\n\n## 参考文献\n[1] Fixture Author 1. ${paperNames[0]}[J]. Fictional Methods Journal, 2026, 1(1): 101-103.\n[2] Fixture Author 2. ${paperNames[1]}[J]. Fictional Methods Journal, 2026, 1(1): 121-123.\n\n## 核对表（提交前删除）\n| 节 | 内容依据 |\n|---|---|\n| 概念 | L01（p.102）、L02（p.123） |\n`;
