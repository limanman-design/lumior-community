import type { Card } from './canvas-model';

export type AiTranslate = (
  en: string,
  zh: string,
  params?: Record<string, string | number>,
) => string;

const messages: [string, string][] = [
  ['Checking layout and scope…', '正在核对画板排布与操作范围…'],
  ['Canvas layout verified. Presenting the result…', '画板排布已核对，正在呈现结果…'],
  ['Canvas layout complete.', '本次画板排布已完成。'],
  ['Preparing the layout using card sizes, without reading source text…', '正在按卡片尺寸准备排布，不读取资料正文…'],
  ['Preparing the card layout…', '正在准备卡片排布…'],
  ['Preparing canvas changes. They will be saved after verification…', '正在准备画板操作，核对完成后保存…'],
  ['Canvas changes have not passed verification. Correcting them…', '画板操作核对尚未通过，正在修正…'],
  ['Canvas changes verified. Preparing to save…', '画板操作已核对，准备保存…'],
  ['Target cards or sections changed while preparing the layout. Your edits are preserved; try again.', '整理期间目标卡片或分区已有改动，已保留你的修改，请重新发起整理。'],
  ['Cards, connections or sections were changed or referenced later. Your changes are preserved.', '相关卡片、连线或分区已有后续修改、关联或同步引用，未撤销，以保留这些改动。'],
  ['Canvas changes exceed the selected scope. Nothing was saved; select the cards again.', '画板操作超出本次引用范围，尚未保存，请重新选择卡片。'],
  ['This question does not require canvas sources. Answering directly…', '本次问题不需要查阅画板资料，正在直接回答…'],
  ['Checking the configured model.', '正在读取当前会话的模型配置。'],
  ['The answer is ready. Presenting the results…', '本次回答已整理完成，正在呈现结果…'],
  ['The answer and source citations have been checked. Presenting the results…', '回答与原文引用核对完成，正在逐段呈现结果…'],
  ['The direct answer did not finish. Try again or specify which sources to consult.', '直接回答未完成，请重试或明确要查阅的资料。'],
  ['This canvas operation record could not be found.', '找不到这条画板操作记录。'],
  ['Cards or connections were edited or referenced later. Undo was blocked to preserve those changes.', '相关卡片或连线已有后续修改、关联或同步引用，未撤销，以保留这些改动。'],
  ['Preparing cards and connections. They will be saved after verification…', '正在准备卡片与连线，核对完成后保存到画板…'],
  ['The whiteboard request needs correction. Preparing it again…', '画板操作参数需要修正，正在重新整理…'],
  ['Cards and connections have not passed verification. Correcting them…', '卡片与连线核对尚未通过，正在修正…'],
  ['Card contents, sources, and connections checked. Preparing to save…', '卡片正文、来源与连线已核对，准备保存…'],
  ['The previous whiteboard operation is complete. Regenerating only the answer.', '此前的画板操作已完成，本次只重新生成回答。'],
  ['Stopped. The answer is kept; saving the whiteboard operation has not been confirmed.', '已停止，保留收到的回答；画板操作尚未确认保存。'],
  ['The whiteboard scope changed. Nothing was saved; ask again.', '画板操作范围已变化，尚未保存，请重新提问。'],
  ['Inconsistent whiteboard operations were received. Nothing was saved; try again.', '收到不一致的画板操作，尚未保存，请重试。'],
  ['A connection is outside the selected scope. Nothing was saved; select the cards again.', '连线超出本次引用范围，尚未保存，请重新选择卡片。'],
  ['The whiteboard changed or verification is incomplete. Cards and connections were not saved.', '画板已切换或操作尚未核对，未保存卡片与连线。'],
  ['A referenced source was removed or replaced. Cards were not saved; ask again.', '引用资料已移除或被替换，未保存卡片，请重新提问。'],
  ['Card sources could not be verified. Nothing was saved; try again.', '卡片来源无法核对，尚未保存，请重试。'],
  ['The whiteboard operation exceeds this request. Nothing was saved; specify the cards to create or connect.', '画板操作超出本轮要求，尚未保存，请重新说明需要创建或连接的卡片。'],
  ['A card or connection contains an unverifiable citation. Nothing was saved; try again.', '卡片或连线包含无法核对的引用，尚未保存，请重试。'],
  ['New conversation', '新对话'],
  ['Source text', '卡片文字'],
  ['PDF excerpt', 'PDF 摘录'],
  ['Card referenced in this question', '提问时引用的卡片'],
  ['Unable to load model settings', '无法读取模型配置'],
  [
    'The sources have been read again. You can regenerate the answer.',
    '资料已重新读取，可重新生成回答。',
  ],
  [
    'There is still no readable content. Please check the original file.',
    '仍没有可读取内容，请检查原文件。',
  ],
  [
    'Reading did not finish. Check the source notice and try again.',
    '读取未完成，请查看资料提示后重试。',
  ],
  [
    'Stopped. Completed research records have been kept.',
    '已停止，保留已完成的研究记录。',
  ],
  [
    'The original question is unavailable. Please enter it again.',
    '原问题无法读取，请重新输入。',
  ],
  [
    'Some cards in the original research scope were removed. Select the sources again; the old answer still retains its source snapshots.',
    '原研究范围中的部分卡片已移除，请重新选择资料；旧回答的原文快照仍保留。',
  ],
  [
    'Sources are ready. Analyzing the question and checking evidence.',
    '资料已准备，开始分析问题并查证来源。',
  ],
  [
    'The source citation records could not be verified. Please try again.',
    '原文引用记录无法核对，请重试。',
  ],
  [
    'The answer and citations have been checked. Research is complete.',
    '已核对回答与引用，研究完成。',
  ],
  ['The answer is ready.', '本次回答已整理完成。'],
  [
    'Research did not finish. Received records have been kept.',
    '本次研究未完成，已保留收到的记录。',
  ],
  ['Connection failed. Please try again.', '连接失败，请重试。'],
  [
    'The source card was removed. The answer still retains the text originally provided.',
    '来源卡片已移除；当时提供的文字仍保留在回答的引用记录中。',
  ],
  [
    'The source file was replaced, so the old citation cannot be located in the new file. The original text is retained in the citation records.',
    '来源文件已被替换，无法在新文件中定位旧引用；当时提供的文字仍保留在引用记录中。',
  ],
  ['Answer copied', '已复制答案'],
  [
    'Could not copy the answer. Select and copy the text manually.',
    '复制失败，请手动选择文字复制。',
  ],
  [
    'The source card was removed. Its name at the time of the question has been kept.',
    '这张来源卡片已移除，已保留提问时的名称。',
  ],
  [
    'The source file was replaced. The references saved with this question have been kept.',
    '来源文件已被替换，已保留提问时的引用记录。',
  ],
  [
    'This board’s AI history could not be read. The original records have been kept.',
    '这张画板的 AI 历史无法读取，原记录已保留。',
  ],
  [
    'The AI conversation records could not be read. The original records have been kept.',
    'AI 对话记录无法读取，原记录已保留。',
  ],
  [
    'The AI messages could not be read. The original records have been kept.',
    'AI 消息无法读取，原记录已保留。',
  ],
  [
    'AI history cannot be saved right now. Check your browser’s storage space.',
    'AI 历史暂时无法保存，请检查浏览器存储空间。',
  ],
  [
    'Close other Lumiro windows and try again.',
    '请关闭其他 Lumior 窗口后重试。',
  ],
  [
    'Another window changed the AI history. Reopen this board. You can still copy the current conversation.',
    '另一个窗口已修改 AI 历史，请重新打开这张画板。当前对话仍可复制。',
  ],
  [
    'Could not save AI history. Check browser storage and try again.',
    'AI 历史保存失败，请检查浏览器存储空间后重试。',
  ],
  ['Could not save AI history', 'AI 历史保存失败'],
  ['Could not read AI history', 'AI 历史无法读取'],
  ['Waiting to read the source locally…', '等待本机读取…'],
  ['Source reading stopped', '读取已停止'],
  ['Source reading timed out. Please try again.', '资料读取超时，请重试'],
  ['Source reading failed. Please try again.', '资料读取失败，请重试'],
  [
    'No extractable text. Scanned-page recognition is not available yet.',
    '没有可提取文字，扫描件识别尚未接入',
  ],
  [
    'No extractable text. Scanned-page recognition is not available yet.',
    '没有可提取文字，扫描件识别尚未接入。',
  ],
  [
    'No existing subtitles. Automatic transcription is not available yet.',
    '没有已有字幕，自动转写尚未接入',
  ],
  ['This video has no existing subtitles.', '这个视频没有已有字幕。'],
  [
    'The source will be read locally with the first question',
    '首次提问时在本机读取',
  ],
  ['Reading cache is temporarily unavailable', '读取缓存暂时不可用'],
  ['This card has no readable file', '这张卡片没有可读取的文件'],
  [
    'PDFs over 500 pages cannot be read in full yet',
    '这个 PDF 超过 500 页，暂不支持整份读取',
  ],
  [
    'This PDF contains too much text to read in full yet',
    '这个 PDF 的文字过多，暂不支持整份读取',
  ],
  [
    'These subtitles contain too much text to read in full yet',
    '字幕文字过多，暂不支持整份读取',
  ],
  [
    'Understanding the question and organizing the answer…',
    '正在理解问题，整理回答重点…',
  ],
  [
    'Merging reading notes while retaining evidence and limitations…',
    '正在合并各部分阅读笔记，保留证据与研究局限…',
  ],
  ['Combining the reading results…', '正在综合阅读结果…'],
  ['Finding evidence and reading its context…', '正在查找证据并读取前后文…'],
  [
    'Checking the answer, source citations, and question coverage…',
    '正在核对回答、原文引用和问题覆盖情况…',
  ],
  [
    'More evidence is needed. Continuing to search the sources…',
    '核对发现需要补充证据，正在继续查找原文…',
  ],
  [
    'Answer and source citations checked. Presenting the results…',
    '回答与原文引用核对完成，正在呈现结果…',
  ],
  [
    'Checking whether the source is within the references for this question…',
    '正在检查资料是否在本次引用范围内…',
  ],
  ['Checking the source-reading request…', '正在检查资料读取请求…'],
  [
    'Expanding queries and searching the referenced sources…',
    '正在扩展查询，搜索引用范围的原文…',
  ],
  ['Searching for relevant source text by meaning…', '正在按含义查找相关原文…'],
  [
    'The source catalog is too large to process in full. Partial sources have not been substituted.',
    '资料目录过大，无法完整处理；没有截取部分资料代替。',
  ],
  [
    'The sources are not in a valid format and could not be read in full.',
    '资料格式不正确，无法完整读取。',
  ],
  [
    'The research plan referenced a card outside the selected scope. Please ask again.',
    '研究计划引用了范围外的卡片，请重新提问。',
  ],
  [
    'The model returned an invalid response format. Please try again.',
    '模型响应格式异常，请重试。',
  ],
  [
    'The model returned an invalid response format. Please try again.',
    '模型响应格式不正确，请重试。',
  ],
  ['The request failed. Please try again later.', '请求失败，请稍后重试。'],
  ['Connection interrupted. Please try again.', '连接中断，请重试。'],
  [
    'Connection interrupted. Received content has been kept.',
    '连接中断，已保留收到的内容。',
  ],
  [
    'This evidence exceeds the model’s context capacity. Split the research question and continue.',
    '本轮证据超过模型上下文容量，查证尚未完成；请拆分研究问题后继续。',
  ],
  [
    'The API key is invalid. Check your local settings.',
    'API Key 无效，请检查本机配置。',
  ],
  [
    'The DeepSeek API balance is insufficient. Check your balance on its platform.',
    'DeepSeek API 余额不足，请在开放平台查看余额。',
  ],
  [
    'Too many DeepSeek requests. Please try again later.',
    'DeepSeek 请求过于频繁，请稍后重试。',
  ],
  [
    'DeepSeek cannot complete the research request right now. Please try again later.',
    'DeepSeek 暂时无法完成研究请求，请稍后重试。',
  ],
  [
    'The model’s research request failed. Please try again.',
    '模型研究请求失败，请重试。',
  ],
  [
    'The model returned an invalid tool request. Please try again.',
    '模型工具请求格式异常，请重试。',
  ],
  [
    'The model’s research response is too large and has not been verified.',
    '模型研究响应过大，尚未完成核对。',
  ],
  [
    'Connection interrupted before research was complete. Please try again.',
    '连接中断，研究尚未完成，请重试。',
  ],
  [
    'Research reached the context or output capacity before finishing. Split the question and continue.',
    '模型尚未完成本轮研究，已达到上下文或输出容量；请拆分问题后继续。',
  ],
  [
    'The model interrupted this research before verification. Please try again.',
    '模型中断了本轮研究，查证尚未完成；请重试。',
  ],
  [
    'The model’s tool request is incomplete. Please try again.',
    '模型工具请求不完整，请重试。',
  ],
  [
    'Kimi K3 did not finish this response within 10 minutes. Split the question or reduce the source scope, then try again.',
    'Kimi K3 本次响应超过 10 分钟，尚未完成；请拆分问题或缩小资料范围后重试。',
  ],
  [
    'The model did not finish this response within 3 minutes. Reduce the source scope, then try again.',
    '模型本次响应超过 3 分钟，尚未完成；请缩小资料范围后重试。',
  ],
  [
    'The model returned no answer text or tool request. This response was not marked complete; please try again.',
    '模型没有返回正文或工具请求，未将本次响应标为完成；请重试。',
  ],
  [
    'Semantic search did not return a valid result. Verification is incomplete; please try again.',
    '语义查找没有返回有效结果，尚未完成查证；请重试。',
  ],
  [
    'Semantic search results are incomplete and have not been verified.',
    '语义查找结果不完整，尚未完成查证。',
  ],
  [
    'Semantic search returned passages outside the selected scope. Verification is incomplete.',
    '语义查找返回了范围外的段落，尚未完成核对。',
  ],
  [
    'The model did not complete the reading plan. Please try again.',
    '模型没有完成阅读计划，请重试。',
  ],
  [
    'The reading batch returned no notes. Full reading is incomplete.',
    '阅读批次没有返回笔记，尚未完成全文阅读。',
  ],
  [
    'Reading notes cite sources outside their batch and have not been verified.',
    '阅读笔记出现不属于该批次的引用，尚未完成核对。',
  ],
  [
    'The target sources were not read in full. A full-source summary was not generated.',
    '目标资料尚未完整覆盖，未生成全文总结。',
  ],
  [
    'The long-document summary did not finish. Please try again.',
    '长文汇总没有完成，请重试。',
  ],
  [
    'Merged notes contain unverifiable citations. The summary is incomplete.',
    '合并笔记出现无法核对的引用，尚未完成汇总。',
  ],
  [
    'Reading notes exceed the model’s context capacity. Split the question to continue the summary.',
    '阅读笔记超过模型上下文容量，尚未完成汇总；请拆分问题后继续。',
  ],
  [
    'Research reached its execution limit before verification. Split the question to continue; unfinished content was not presented as a final conclusion.',
    '查证还未完成，已达到本轮执行边界；请拆分问题后继续，没有将未完成内容当成最终结论。',
  ],
  [
    'Answer verification did not finish. Please try again.',
    '回答核对没有完成，请重试。',
  ],
  [
    'The answer contains unverifiable citations and was not marked complete. Please try again.',
    '回答含有无法核对的引用，未将其标为完成；请重试。',
  ],
  [
    'This model endpoint is available only on this device.',
    '当前模型接口仅供本机使用。',
  ],
  [
    'Add your DeepSeek API key to the local .dev.vars file, then restart the preview.',
    '请先在本机 .dev.vars 中填写 DeepSeek API Key，然后重启预览。',
  ],
  [
    'Open AI service in Settings and enter your own DeepSeek API key.',
    '请先打开设置中的 AI 服务，填写自己的 DeepSeek API Key。',
  ],
  [
    'The referenced sources exceed this request’s transfer capacity. Split the research scope; no partial subset was substituted.',
    '引用资料超过本轮完整传输容量，尚未处理；请拆分研究范围，不会只读取前几张代替。',
  ],
  ['The request format is invalid.', '请求格式不正确。'],
  ['Enter a question of up to 6,000 characters.', '请输入问题，最多 6000 字。'],
  ['Select a valid reasoning level.', '请选择有效的思考程度。'],
  [
    'Other requests are being processed. Please try again later.',
    '正在处理其他请求，请稍后重试。',
  ],
  [
    'This model is unavailable. Select another model.',
    '该模型不可用，请重新选择。',
  ],
  [
    'Configure an API key for the selected service in AI service settings.',
    '请在设置的 AI 服务中为所选服务配置 API Key。',
  ],
  ['Select a valid AI service and model.', '请选择有效的服务商和模型。'],
  [
    'This model does not support research. Select another model.',
    '该模型不支持当前研究功能，请重新选择。',
  ],
  [
    'Choose a text model in AI service settings to translate this document.',
    '当前默认模型不支持翻译，请在 AI 服务中选择文本模型。',
  ],
  [
    'OpenAI did not finish this research. Split the question and try again.',
    'OpenAI 本轮研究尚未完成，可能达到容量限制或被中断；请拆分问题后重试。',
  ],
  [
    'OpenAI could not complete this request. Adjust the question and try again.',
    'OpenAI 未能完成本轮请求，请调整问题后重试。',
  ],
  [
    'OpenAI returned an invalid research response. Please try again.',
    'OpenAI 返回的研究响应格式不正确，请重试。',
  ],
  [
    'The model returned an incomplete response. Please try again.',
    '模型研究响应不完整，请重试。',
  ],
  [
    'This research timed out before verification. Split the question and continue.',
    '本轮研究超时，查证尚未完成；请拆分问题后继续。',
  ],
  [
    'The research request did not finish. Please try again.',
    '研究请求未完成，请重试。',
  ],
  [
    'Connection interrupted or timed out. Check your network and try again.',
    '连接中断或超时，请检查网络后重试。',
  ],
  ['Enter a meaning or question to search for.', '请输入要查找的含义或问题。'],
  ['This card is outside the reference scope.', '卡片不在引用范围内。'],
  [
    'That passage number does not exist. Select one from the search results.',
    '段落编号不存在，请从搜索结果选择。',
  ],
  ['A valid card ID is required.', '需要有效的卡片 ID。'],
  [
    'This tool is unavailable. Only sources referenced in this question can be searched or read.',
    '工具不可用，只能搜索或读取本次引用的资料。',
  ],
  ['Enter a valid invitation code.', '请输入有效邀请码。'],
  [
    'The trial service is not configured in this build.',
    '此版本尚未配置体验服务。',
  ],
  [
    'Invitation activation failed. Check the code or try again later.',
    '邀请码激活失败，请核对邀请码或稍后重试。',
  ],
  [
    'Invitation activation could not be confirmed. Retry the same code.',
    '无法确认激活结果，请重试同一个邀请码。',
  ],
  [
    'The trial service could not be reached. Retry the same code later.',
    '暂时无法连接体验服务，请稍后重试同一个邀请码。',
  ],
  [
    'Activate an invitation before using trial AI.',
    '请先激活邀请码，再使用体验额度。',
  ],
  ['Choose a valid AI usage mode.', '请选择有效的 AI 使用方式。'],
  ['Saved trial credentials could not be read.', '无法读取已保存的体验凭证。'],
  [
    'System encryption is unavailable. The trial credential was not saved.',
    '系统加密不可用，体验凭证未保存。',
  ],
  [
    'System encryption is unavailable. Unlock your account and try again.',
    '系统加密不可用，请解锁系统账户后重试。',
  ],
  [
    'The trial service is unavailable. Please try again later.',
    '体验服务暂不可用，请稍后重试。',
  ],
  [
    'Your trial credit is used up. Open AI settings to use your own API key.',
    '体验额度已用完，可打开 AI 设置使用自己的 API Key。',
  ],
  [
    'Your trial has expired. Open AI settings to use your own API key.',
    '体验已到期，可打开 AI 设置使用自己的 API Key。',
  ],
  [
    'Your trial access has ended. Open AI settings to use your own API key.',
    '体验权限已停止，可打开 AI 设置使用自己的 API Key。',
  ],
  [
    'A trial request is already running for your account. Please wait until it finishes.',
    '你的账号已有体验请求正在运行，请等待完成。',
  ],
  [
    'Other users are using the trial service. Please try again later.',
    '其他用户正在使用体验服务，请稍后重试。',
  ],
  [
    'Trial service is not open yet. Please use your own API key.',
    '体验服务尚未开放，请先使用自己的 API Key。',
  ],
  [
    'Enter your invitation code in AI service settings first.',
    '请先在 AI 服务设置中输入邀请码。',
  ],
  [
    'Your trial credit is insufficient. Switch to your own API key in Settings.',
    '体验额度不足，可在设置中改用自己的 API Key。',
  ],
  [
    'Your trial has expired or ended. Check it in Settings.',
    '体验资格已到期或停用，请在设置中查看。',
  ],
  [
    'These materials exceed trial capacity. Reduce the scope or use your own API key.',
    '本次资料超过体验模式的容量，请缩小范围或改用自己的 API Key。',
  ],
  [
    'This trial task reached its execution limit. Reduce the question scope and try again.',
    '本轮体验已达到执行上限，请缩小问题范围后重试。',
  ],
  [
    'You have used today’s trial tasks. Continue tomorrow.',
    '今天的体验次数已用完，请明天继续。',
  ],
  [
    'The trial service is processing other requests. Please try again later.',
    '体验服务正在处理其他请求，请稍后重试。',
  ],
  [
    'The selected trial model is unavailable. Select another model or try again later.',
    '当前体验模型不可用，请重新选择或稍后重试。',
  ],
  [
    'Your trial credit is used up. Switch to your own API key in Settings.',
    '体验额度已用完，可在设置中改用自己的 API Key。',
  ],
  [
    'Trial credit is not offered for this model. Choose an available trial model.',
    '该模型未提供体验额度，请选择当前可用的体验模型。',
  ],
  [
    'This trial task has ended. Start a new task.',
    '本轮体验已结束，请重新发起。',
  ],
  [
    'This trial endpoint is available only on this device.',
    '当前体验接口仅供本机使用。',
  ],
];

export function aiReferenceKind(
  kind: Card['kind'],
  excerpt: boolean,
  t: AiTranslate,
) {
  if (excerpt) return t('PDF excerpt', 'PDF 摘录');
  return {
    database: t('Database', '多维表'),
    note: t('Note', '笔记'),
    text: t('Text', '文本'),
    pdf: 'PDF',
    video: t('Video', '视频'),
    image: t('Image', '图片'),
  }[kind];
}

// Translate observable system records at render time. Never apply this helper to
// answers, questions, source text, card titles, or other user-authored content.
export function localizeAiSystemText(text: string, t: AiTranslate): string {
  const exact = messages.find(([en, zh]) => text === en || text === zh);
  if (exact) return t(exact[0], exact[1]);
  const patterns: [RegExp, (match: RegExpMatchArray) => string][] = [
    [
      /^(DeepSeek|GLM|Kimi|OpenAI) API Key 无效或没有使用权限，请检查本机配置与账号可用地区。$/,
      (m) =>
        t(
          '{provider} API key is invalid or unavailable. Check your settings and supported region.',
          '{provider} API Key 无效或没有使用权限，请检查本机配置与账号可用地区。',
          { provider: m[1] },
        ),
    ],
    [
      /^(DeepSeek|GLM|Kimi|OpenAI) API 余额不足，请在开放平台查看余额。$/,
      (m) =>
        t(
          '{provider} API balance is insufficient. Check the balance on its platform.',
          '{provider} API 余额不足，请在开放平台查看余额。',
          { provider: m[1] },
        ),
    ],
    [
      /^(DeepSeek|GLM|Kimi|OpenAI) 请求过于频繁或额度不足，请在开放平台查看额度后重试。$/,
      (m) =>
        t(
          '{provider} requests are too frequent or the quota is insufficient. Check its platform and try again.',
          '{provider} 请求过于频繁或额度不足，请在开放平台查看额度后重试。',
          { provider: m[1] },
        ),
    ],
    [
      /^(DeepSeek|GLM|Kimi|OpenAI) 暂不支持这份模型配置，请检查模型 ID 与账号权限。$/,
      (m) =>
        t(
          '{provider} does not support this model configuration. Check the model ID and account access.',
          '{provider} 暂不支持这份模型配置，请检查模型 ID 与账号权限。',
          { provider: m[1] },
        ),
    ],
    [
      /^(DeepSeek|GLM|Kimi|OpenAI) 暂时无法完成研究请求，请稍后重试。$/,
      (m) =>
        t(
          '{provider} is temporarily unable to complete this research. Please try again later.',
          '{provider} 暂时无法完成研究请求，请稍后重试。',
          { provider: m[1] },
        ),
    ],
    [
      /^请先在本机 \.dev\.vars 中填写 (DeepSeek|GLM|Kimi|OpenAI) API Key，然后重启预览。$/,
      (m) =>
        t(
          'Add your {provider} API key to the local .dev.vars file, then restart the preview.',
          '请先在本机 .dev.vars 中填写 {provider} API Key，然后重启预览。',
          { provider: m[1] },
        ),
    ],
    [
      /^PDF 摘录 · 第 (\d+) 页$/,
      (m) =>
        t('PDF excerpt · Page {page}', 'PDF 摘录 · 第 {page} 页', {
          page: m[1],
        }),
    ],
    [
      /^PDF 第 (\d+) 页$/,
      (m) => t('PDF · Page {page}', 'PDF 第 {page} 页', { page: m[1] }),
    ],
    [
      /^视频字幕 (.+)$/,
      (m) => t('Video subtitles {time}', '视频字幕 {time}', { time: m[1] }),
    ],
    [
      /^正在读取第 (\d+) \/ (\d+) 页$/,
      (m) =>
        t('Reading page {page} / {total}', '正在读取第 {page} / {total} 页', {
          page: m[1],
          total: m[2],
        }),
    ],
    [
      /^(\d+) (页|条字幕)已提取(?:；(\d+) 页没有可提取文字)?$/,
      (m) =>
        t(
          m[2] === '页'
            ? '{count} pages extracted'
            : '{count} subtitles extracted',
          '{count} {unit}已提取',
          { count: m[1], unit: m[2] },
        ) +
        (m[3]
          ? t(
              '; {count} pages have no extractable text',
              '；{count} 页没有可提取文字',
              { count: m[3] },
            )
          : ''),
    ],
    [
      /^准备原问题的 (\d+) 张资料。$/,
      (m) =>
        t(
          'Preparing {count} sources for the original question.',
          '准备原问题的 {count} 张资料。',
          { count: m[1] },
        ),
    ],
    [
      /^准备本次指定的 (\d+) 张资料。$/,
      (m) =>
        t(
          'Preparing the {count} selected sources.',
          '准备本次指定的 {count} 张资料。',
          { count: m[1] },
        ),
    ],
    [
      /^准备当前画板的 (\d+) 张资料。$/,
      (m) =>
        t(
          'Preparing {count} sources from this board.',
          '准备当前画板的 {count} 张资料。',
          { count: m[1] },
        ),
    ],
    [
      /^正在准备资料：(.+)$/,
      (m) =>
        t('Preparing source: {title}', '正在准备资料：{title}', {
          title: m[1],
        }),
    ],
    [
      /^正在理解问题，检查 (\d+) 张卡片的资料目录，制定阅读安排…$/,
      (m) =>
        t(
          'Understanding the question and planning how to read {count} cards…',
          '正在理解问题，检查 {count} 张卡片的资料目录，制定阅读安排…',
          { count: m[1] },
        ),
    ],
    [
      /^正在继续查证 · 第 (\d+) 轮…$/,
      (m) =>
        t(
          'Continuing verification · Round {round}…',
          '正在继续查证 · 第 {round} 轮…',
          { round: m[1] },
        ),
    ],
    [
      /^问题重点：(.+)$/,
      (m) => t('Question focus: {focus}', '问题重点：{focus}', { focus: m[1] }),
    ],
    [
      /^正在扩展查询：(.+)…$/,
      (m) =>
        t('Expanding queries: {query}…', '正在扩展查询：{query}…', {
          query: m[1],
        }),
    ],
    [
      /^正在按含义查找：(.+)…$/,
      (m) =>
        t('Searching by meaning: {query}…', '正在按含义查找：{query}…', {
          query: m[1],
        }),
    ],
    [
      /^正在读取《(.+)》原文…$/,
      (m) =>
        t('Reading source: {title}…', '正在读取《{title}》原文…', {
          title: m[1],
        }),
    ],
    [
      /^正在完整阅读：(.+) · 已覆盖 (\d+) \/ (\d+) 段$/,
      (m) =>
        t(
          'Reading in full: {title} · {read} / {total} passages covered',
          '正在完整阅读：{title} · 已覆盖 {read} / {total} 段',
          { title: m[1], read: m[2], total: m[3] },
        ),
    ],
    [
      /^按含义查找：(.+) · 正在检查第 (\d+)–(\d+) \/ (\d+) 段…$/,
      (m) =>
        t(
          'Searching by meaning: {query} · Checking passages {from}–{to} / {total}…',
          '按含义查找：{query} · 正在检查第 {from}–{to} / {total} 段…',
          { query: m[1], from: m[2], to: m[3], total: m[4] },
        ),
    ],
    [
      /^按含义查找：已检查 (\d+) \/ (\d+) 段，找到 (\d+) 段候选原文，尚待读取核对。$/,
      (m) =>
        t(
          'Semantic search: checked {read} / {total} passages; {found} candidates await reading and verification.',
          '按含义查找：已检查 {read} / {total} 段，找到 {found} 段候选原文，尚待读取核对。',
          { read: m[1], total: m[2], found: m[3] },
        ),
    ],
    [
      /^查询结果：在 (\d+) 张卡片中找到 (\d+) 段候选原文，尚待读取核对。$/,
      (m) =>
        t(
          'Search results: {found} candidate passages in {cards} cards await reading and verification.',
          '查询结果：在 {cards} 张卡片中找到 {found} 段候选原文，尚待读取核对。',
          { found: m[2], cards: m[1] },
        ),
    ],
    [
      /^本次资料查找未完成：(.+)$/,
      (m) =>
        t(
          'Source search did not finish: {error}',
          '本次资料查找未完成：{error}',
          { error: localizeAiSystemText(m[1], t) },
        ),
    ],
  ];
  for (const [pattern, format] of patterns) {
    const match = text.match(pattern);
    if (match) return format(match);
  }
  const plan = text.match(
    /^阅读安排：(针对问题查证|完整阅读并总结|完整阅读并比较|查找证据并综合分析)(?: · (\d+) 张资料)?，完成后核对回答与引用。$/,
  );
  if (plan) {
    const tasks: Record<string, string> = {
      针对问题查证: t('Verify the question', '针对问题查证'),
      完整阅读并总结: t('Read in full and summarize', '完整阅读并总结'),
      完整阅读并比较: t('Read in full and compare', '完整阅读并比较'),
      查找证据并综合分析: t(
        'Find evidence and synthesize',
        '查找证据并综合分析',
      ),
    };
    return t(
      'Reading plan: {task}{scope}; then check the answer and citations.',
      '阅读安排：{task}{scope}，完成后核对回答与引用。',
      {
        task: tasks[plan[1]],
        scope: plan[2]
          ? t(' · {count} sources', ' · {count} 张资料', { count: plan[2] })
          : '',
      },
    );
  }
  const reading = text.match(/^正在读取(：.+?|命中段落)(及前后文)?…$/);
  if (reading)
    return t('Reading{sources}{context}…', '正在读取{sources}{context}…', {
      sources:
        reading[1] === '命中段落'
          ? t(' matching passages', '命中段落')
          : t(': {sources}', '：{sources}', {
              sources: sourceLocations(reading[1].slice(1), t),
            }),
      context: reading[2] ? t(' and surrounding context', '及前后文') : '',
    });
  const evidence = text.match(
    /^已取得原文：(.+?)(?:，仍有 (\d+) 段待继续读取)?；累计读取 (\d+) 段。$/,
  );
  if (evidence)
    return t(
      'Source text obtained: {sources}{remaining}; {total} passages read in total.',
      '已取得原文：{sources}{remaining}；累计读取 {total} 段。',
      {
        sources:
          evidence[1] === '本次没有新增段落'
            ? t('no new passages in this step', '本次没有新增段落')
            : sourceLocations(evidence[1], t),
        remaining: evidence[2]
          ? t(
              '; {count} passages remain to be read',
              '，仍有 {count} 段待继续读取',
              { count: evidence[2] },
            )
          : '',
        total: evidence[3],
      },
    );
  return text;
}

function sourceLocations(text: string, t: AiTranslate) {
  return text
    .replace(
      /(》 · )PDF 摘录 · 第 (\d+) 页(?=；《| · \d+ 段|等 \d+ 处|$)/g,
      (_all, before: string, page: string) =>
        before +
        t('PDF excerpt · Page {page}', 'PDF 摘录 · 第 {page} 页', { page }),
    )
    .replace(
      /(》 · )PDF 第 (\d+) 页(?=；《| · \d+ 段|等 \d+ 处|$)/g,
      (_all, before: string, page: string) =>
        before + t('PDF · Page {page}', 'PDF 第 {page} 页', { page }),
    )
    .replace(
      /(》 · )卡片文字(?=；《| · \d+ 段|等 \d+ 处|$)/g,
      (_all, before: string) => before + t('Source text', '卡片文字'),
    )
    .replace(
      /(》 · )PDF 摘录(?=；| · \d+ 段|等 \d+ 处|$)/g,
      (_all, before: string) => before + t('PDF excerpt', 'PDF 摘录'),
    )
    .replace(
      /(》 · )视频字幕 ([\d:]+–[\d:]+)(?=；《| · \d+ 段|等 \d+ 处|$)/g,
      (_all, before: string, time: string) =>
        before + t('Video subtitles {time}', '视频字幕 {time}', { time }),
    )
    .replace(/ · (\d+) 段$/, (_all, count: string) =>
      t(' · {count} passages', ' · {count} 段', { count }),
    )
    .replace(/等 (\d+) 处$/, (_all, count: string) =>
      t(' and others ({count} sources)', '等 {count} 处', { count }),
    );
}
