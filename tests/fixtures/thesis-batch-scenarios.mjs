// Synthetic methodology notes, not published literature or real company data.
export const batchPapers = Array.from({length:10}, (_,i) => ({
  title: `Synthetic Workflow Method ${String(i+1).padStart(2,'0')}`,
  path: `thesis/refs/batch-${i+1}.md`,
  text: `SYNTHETIC TEST MATERIAL. Not a published paper.\nSynthetic Workflow Method ${String(i+1).padStart(2,'0')}\nAuthor: Test Researcher ${i+1}. Year: 2026. Source: Fictional Teaching Notes.\nPage 1\nThis is a methods demonstration, not empirical evidence about any company. Its question is how to compare written approval responsibilities with handoff records.\nPage 2\nMethod: compare a procedure document, a timestamped log and an interview. Worked example ${i+1} uses three imaginary records. Conclusion: compare assigned responsibility with actual handoffs (p.2).\nPage 3\nConclusion: timestamps alone do not establish the cause of delay (p.3). Limitation: fictional example, no causal or generalizable findings. It is only a methods reference, not a same-topic empirical study.`,
}));
export const batchMatrixCard = i => `### L${String(i+1).padStart(2,'0')} ${batchPapers[i].title}\n- 引用：Test Researcher ${i+1}. ${batchPapers[i].title}[Z]. Fictional Teaching Notes, 2026: 1–3.\n- 来源文件：${batchPapers[i].path}\n- 主要结论：对照规定责任和实际交接（p.2）；时间戳本身不能证明延迟原因（p.3）。\n- 差别陈述：不适用（方法演示，未涉及同题实证研究）\n`;
