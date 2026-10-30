import { translate, translateSystemMessage } from './i18n-core.ts';

// Only app-generated PDF notices/errors enter this map. Never pass document text.
const pairs: readonly (readonly [string, string])[] = [
  ['This trial translation reached its call limit. Completed translation has been kept; select Continue to resume the remaining content.', '本轮体验翻译已达到调用上限，已保留完成的译文；点击继续翻译可从剩余内容开始。'],
  ['This page has too many aligned paragraphs for one trial translation. Use your own API Key in AI settings.', '本页需要对照的段落过多，超过单轮体验翻译容量；请在 AI 服务设置中改用自己的 API Key。'],
  ['This translation batch exceeds the request capacity. The source text was not cut; split the PDF and try again.', '本批翻译资料超过请求容量，原文未被截断，请拆分 PDF 后重试。'],
  ['The model did not return this translation batch in full. Completed translation has been kept; you can continue.', '模型未完整返回本批译文，已保留完成的部分，可继续翻译。'],
  ['This translation batch timed out. Completed translation has been kept; select Continue to resume the remaining content.', '本批翻译响应超时，已保留完成的译文；点击继续翻译可从剩余内容开始。'],
  ['Go to PDF page', '跳转到 PDF 页码'],
  ['Preview unavailable', '预览不可用'],
  ['Untitled', '未命名'],
  ['Could not load this PDF’s outline.', '无法加载这个 PDF 的大纲。'],
  ['This outline entry has no available page.', '这个大纲条目没有可用页码。'],
  ['PDF navigation', 'PDF 导航'],
  ['PDF navigation view', 'PDF 导航视图'],
  ['Thumbnails', '缩略图'],
  ['Outline', '大纲'],
  ['Loading…', '正在加载…'],
  ['Loading outline…', '正在加载大纲…'],
  ['This PDF has no built-in outline.', '这个 PDF 没有内置大纲。'],
  ['Resize PDF navigation', '调整 PDF 导航宽度'],
  [
    'Drag to resize · Double-click to reset to 268px',
    '拖动调整宽度 · 双击恢复 268px',
  ],
  ['Resize PDF sidebar', '调整 PDF 侧栏宽度'],
  ['Drag to resize · Double-click to reset', '拖动调整宽度 · 双击恢复默认'],
  ['PDF notes drawer', 'PDF 笔记抽屉'],
  ['Collapse PDF notes', '收起 PDF 笔记'],
  ['Expand PDF notes', '展开 PDF 笔记'],
  [
    'Click to expand or collapse; drag upward to resize',
    '点击展开或收起，向上拖动可调整高度',
  ],
  ['Notes', '笔记'],
  ['Done', '完成'],
  ['PDF linked note title', 'PDF 关联笔记标题'],
  ['Add a note…', '添加笔记…'],
  ['Cancel', '取消'],
  ['Save', '保存'],
  ['Add a note', '添加笔记'],
  ['PDF notes', 'PDF 笔记'],
  [
    'Highlights, excerpts, and notes from this PDF appear here. Select source text to highlight it, or add a note for the current page.',
    '这个 PDF 的高亮摘录和笔记会显示在这里。选择原文即可添加高亮，也可以直接记录当前页的笔记。',
  ],
  ['Expanded PDF', '展开的 PDF'],
  ['Expand sidebar', '展开侧边栏'],
  ['Discuss PDF with AI', '用此 PDF 与 AI 对话'],
  ['Pin expanded card to sidebar', '将展开的卡片固定到侧栏'],
  ['Open in right sidebar', '在右侧栏打开'],
  ['Collapse expanded card', '收起展开的卡片'],
  ['Return to whiteboard · Esc', '返回画板 · Esc'],
  ['Region selected. Add a note and save.', '区域已选好，可添加笔记并保存'],
  [
    'This page is still loading. Try again shortly.',
    '该页还在加载，请稍后重试',
  ],
  ['Could not create the screenshot.', '无法创建截图'],
  ['Saved to PDF notes.', '已保存到 PDF 笔记'],
  [
    'Return to the whiteboard and save the excerpt from the PDF sidebar.',
    '请返回画板，在 PDF 侧栏中保存摘录',
  ],
  [
    'Narrow the PDF sidebar to leave room for an excerpt card.',
    '请收窄 PDF 侧栏，留出放置卡片的画板空间',
  ],
  [
    'Excerpt card saved. Use its toolbar to return to the source.',
    '已保存区域摘录卡，可从卡片工具栏返回原文',
  ],
  ['Screenshot failed. Try again.', '截图失败，请重试'],
  ['PDF region excerpt', 'PDF 区域摘录'],
  ['Region excerpt', '区域摘录'],
  [
    'Drag to select an image or formula · Esc to cancel',
    '拖动框选图片或公式 · Esc 取消',
  ],
  ['Region excerpt note', '区域摘录笔记'],
  ['Add a note (optional)', '添加笔记（可选）'],
  ['Save to whiteboard', '保存到画板'],
  ['Read PDF content', '读取 PDF 内容'],
  ['Read existing captions', '读取已有字幕'],
  [
    'No extractable text. Scanned-document recognition is not available yet.',
    '没有可提取文字，扫描件识别尚未接入。',
  ],
  [
    'This video has no existing captions. Automatic transcription is not available yet.',
    '这个视频没有已有字幕，自动转写尚未接入。',
  ],
  [
    'Read and save locally so AI can find relevant passages.',
    '在本机读取并保存，供 AI 选取相关段落。',
  ],
  ['Read', '已读取'],
  ['Processed locally', '本机处理'],
  ['PDF content', 'PDF 内容'],
  ['Existing video captions', '已有视频字幕'],
  [
    'The text is available for this question, but could not be cached locally.',
    '文字可用于本次提问，但本机缓存保存失败。',
  ],
  [
    'Reading does not call a model. AI can cite page numbers or video times; formula recognition is not available yet.',
    '读取本身不调用模型。AI 回答可引用页码或视频时间；公式识别尚未接入。',
  ],
  ['Stop reading', '停止读取'],
  ['Read again', '重新读取'],
  ['Retry reading', '重试读取'],
  [
    'AI automatically reads text when using this PDF.',
    'AI 使用此 PDF 时会自动读取文字。',
  ],
  [
    'You can read this document again in the AI chat.',
    '可在 AI 对话中重新读取。',
  ],
  [
    'Reading does not call a model. AI can cite source page numbers.',
    '读取本身不调用模型。AI 回答可引用原文页码。',
  ],
  ['Close translation prompt', '关闭翻译提示'],
  ['Translate PDF?', '翻译 PDF？'],
  [
    'PDF translation first uses AI to translate the text, then redraws the layout. A 20-page document takes about 20 minutes. Continue?',
    'PDF 翻译需要先由 AI 翻译，再重新绘制排版。20 页内容大致需要 20 分钟。是否继续？',
  ],
  ['Don’t show this again', '以后不再提示'],
  ['Translate', '翻译'],
  [
    'Translated page mapping is incomplete. Generate it again.',
    '译文页面对照信息不完整，请重新生成。',
  ],
  [
    'Could not load the translation preview. Try again.',
    '译文预览加载失败，可重试。',
  ],
  [
    'Return to the whiteboard to save the translation.',
    '请返回画板后保存译文。',
  ],
  ['Export failed. Try again.', '导出失败，请重试。'],
  ['Exporting…', '正在导出…'],
  ['Translation card added and PDF exported.', '已添加译文卡片并导出。'],
  ['Translation complete and saved locally.', '翻译完成，已保存在本机。'],
  ['Preparing translation…', '正在准备翻译…'],
  ['Switch translation layout', '切换翻译版式'],
  ['Pause translation to switch layouts', '暂停后可切换翻译版式'],
  ['Original layout', '原版式'],
  ['Reflow translation', '普通翻译'],
  ['Regenerate layout', '重新生成版式'],
  ['Export', '导出'],
  ['Pause translation', '暂停翻译'],
  ['Pause', '暂停'],
  ['Retry', '重试'],
  ['Continue', '继续'],
  ['Chinese PDF translation', 'PDF 中文译文'],
  ['Reload preview', '重新加载预览'],
  ['Regenerate translation', '重新生成译文'],
  ['Use reflow translation', '使用普通翻译'],
  [' · continued', ' · 续'],
  ['Loading original-layout translation…', '正在加载原版式译文…'],
  ['Translating and restoring the original layout…', '正在翻译并还原原版式…'],
  [
    'Original-layout translation is incomplete. Completed text has been kept.',
    '原版式翻译未完成，已完成的译文仍保留。',
  ],
  [
    'Original-layout translation is paused. You can continue.',
    '原版式翻译已暂停，可继续完成。',
  ],
  ['No translation yet. See the notice above.', '暂无译文，请查看上方提示。'],
  ['Generating PDF preview…', '正在生成 PDF 预览…'],
  ['Translated pages will appear here.', '译文会逐页显示在这里。'],
  [
    'Paused. Completed translation has been kept.',
    '已暂停，完成的译文已保留。',
  ],
  [
    'Reading PDF and identifying the original layout…',
    '正在读取 PDF 并识别原文版式…',
  ],
  ['Reading PDF source text…', '正在读取 PDF 原文…'],
  [
    'No translatable text. Scanned-document and image recognition are not available yet.',
    '没有可翻译的文字。扫描件和图片文字识别尚未接入。',
  ],
  ['Could not connect to translation. Try again.', '翻译连接失败，请重试。'],
  [
    'Unexpected translation response format. Try again.',
    '翻译响应格式异常，请重试。',
  ],
  [
    'Could not verify translated paragraphs. Try again.',
    '译文段落无法核对，可继续重试。',
  ],
  [
    'Translation is incomplete. Received text has been kept; you can continue.',
    '翻译尚未完成，已保留收到的译文，可继续翻译。',
  ],
  [
    'Translation has not covered all source text. Received text has been kept; you can continue.',
    '翻译尚未完整覆盖原文，已保留译文，可继续翻译。',
  ],
  ['Restoring pages and checking the translation…', '正在还原页面并核对译文…'],
  ['Translation failed. Try again to continue.', '翻译失败，可继续重试。'],
  ['This page cannot be displayed right now.', '此页暂时无法显示'],
  [
    'Click to change color · Drag to the whiteboard to create an excerpt card',
    '点击修改颜色 · 拖到画板创建摘录卡',
  ],
  [
    'Could not load the PDF. Upload the file again.',
    '无法加载 PDF，请重新上传文件。',
  ],
  ['PDF reading tools', 'PDF 阅读工具'],
  ['Translate PDF with AI', 'AI 翻译 PDF'],
  ['AI translation · Translate into Chinese', 'AI 翻译 · 自动译成中文'],
  ['Search PDF text', '搜索 PDF 文本'],
  ['Search PDF', '搜索 PDF'],
  ['Zoom PDF out', '缩小 PDF'],
  ['Fit PDF width', '适应 PDF 宽度'],
  ['Zoom PDF in', '放大 PDF'],
  ['Search PDF…', '搜索 PDF…'],
  ['Searching…', '搜索中…'],
  ['No results', '无结果'],
  ['Previous result', '上一个结果'],
  ['Next result', '下一个结果'],
  ['Close PDF search', '关闭 PDF 搜索'],
  ['Loading PDF…', '正在加载 PDF…'],
  ['PDF text highlighting tools', 'PDF 文字高亮工具'],
  ['Copied', '已复制'],
  ['Copy failed. Try again.', '复制失败，请重试'],
  ['Copy', '复制'],
  ['Delete highlight', '删除高亮'],
  ['Yellow highlight', '黄色高亮'],
  ['Green highlight', '绿色高亮'],
  ['Blue highlight', '蓝色高亮'],
  ['Pink highlight', '粉色高亮'],
  ['Purple highlight', '紫色高亮'],
  ['Custom color', '自定义颜色'],
  ['Custom highlight color', '自定义高亮颜色'],
  ['Add PDF annotation', '添加 PDF 标注'],
  ['Save annotation', '保存标注'],
  ['Release to place on the whiteboard', '松开放到画板'],
  ['Could not load the Chinese font. Try again.', '中文字体加载失败，请重试。'],
  ['Translation cancellation has not been confirmed.', '翻译任务取消未确认。'],
  [
    'Could not verify the original-layout translation cache. Try again.',
    '原版式译文缓存无法核对，请重试。',
  ],
  [
    'The original-layout translation cache exceeds capacity. Try again.',
    '原版式译文缓存超过容量，请重试。',
  ],
  [
    'The PDF exceeds upload capacity. Split the file.',
    'PDF 超过上传容量，请拆分文件。',
  ],
  [
    'Unexpected layout-service response. Try later or use reflow translation.',
    '原版式服务响应异常，可稍后重试或使用普通翻译。',
  ],
  [
    'Original-layout processing is incomplete. Retry or use reflow translation.',
    '原版式处理未完成，可重试或使用普通翻译。',
  ],
  [
    'Unexpected original-layout job state. Try again.',
    '原版式任务状态异常，可继续重试。',
  ],
  ['Identifying the source layout…', '正在识别原文版式…'],
  [
    'Could not read the original PDF. Reopen the document.',
    '原 PDF 无法读取，请重新打开资料。',
  ],
  [
    'The PDF exceeds original-layout translation capacity. Split the file.',
    'PDF 超过原版式翻译容量，请拆分文件。',
  ],
  [
    'Could not verify the source layout. Try again.',
    '原版式资料无法核对，请重试。',
  ],
  [
    'Could not verify the original-layout protection markers.',
    '原版式保护标记无法核对。',
  ],
  [
    'Could not verify the older translation cache. Try again.',
    '旧译文缓存无法核对，请重试。',
  ],
  [
    'The translated PDF has not passed integrity checks yet.',
    '译文 PDF 尚未通过完整性核对。',
  ],
  [
    'Translated pages do not fully match source pages.',
    '译文页码未完整对应原文。',
  ],
  ['Paragraph mapping coordinates are incomplete.', '段落对照坐标不完整。'],
  ['Paragraph mapping coordinates are invalid.', '段落对照坐标不正确。'],
  [
    'Could not save the translated PDF. Try again.',
    '译文 PDF 保存失败，可继续重试。',
  ],
  [
    'Translated PDF integrity check failed. Try again.',
    '译文 PDF 完整性核对失败，请重试。',
  ],
  ['Reading cache is temporarily unavailable.', '读取缓存暂时不可用'],
  ['This card has no readable file.', '这张卡片没有可读取的文件'],
  ['Reading stopped.', '读取已停止'],
  ['Waiting to read locally…', '等待本机读取…'],
  ['Document reading timed out. Try again.', '资料读取超时，请重试'],
  [
    'This PDF exceeds 500 pages and cannot be read in full yet.',
    '这个 PDF 超过 500 页，暂不支持整份读取',
  ],
  [
    'This PDF has too much text to read in full yet.',
    '这个 PDF 的文字过多，暂不支持整份读取',
  ],
  [
    'These captions have too much text to read in full yet.',
    '字幕文字过多，暂不支持整份读取',
  ],
  ['Could not read the document. Try again.', '资料读取失败，请重试'],
  ['Could not read the caption file.', '字幕文件无法读取'],
  [
    'The caption file is too large. Provide one no larger than 8 MB.',
    '字幕文件过大，请提供不超过 8 MB 的字幕',
  ],
  [
    'Formula or text-style markers are malformed. This batch was not saved.',
    '译文中的公式或文字样式标记格式不正确，本批未保存。',
  ],
  [
    'Text-style markers are not properly closed. This batch was not saved.',
    '译文中的文字样式标记未正确闭合，本批未保存。',
  ],
  [
    'Formula or text-style markers are incomplete. This batch was not saved.',
    '译文中的公式或文字样式标记未完整保留，本批未保存。',
  ],
  [
    'Formula or text-style markers changed. This batch was not saved; try again.',
    '译文中的公式或文字样式标记发生变化，本批未保存，可重试。',
  ],
  [
    'No translatable text, or this document exceeds translation capacity.',
    '没有可翻译的文字，或资料超过本轮翻译容量。',
  ],
  ['Invalid translation input format.', '翻译资料格式不正确。'],
  [
    'This document exceeds full translation capacity. Split the PDF.',
    '资料超过本轮完整翻译容量，请拆分 PDF。',
  ],
  [
    'Invalid formula or text-style protection format.',
    '公式与文字样式保护格式不正确。',
  ],
  ['Invalid paragraph mapping format.', '段落对照格式不正确。'],
  [
    'Paragraph mapping does not cover the full source text.',
    '段落对照未覆盖完整原文。',
  ],
  [
    'Unexpected translation result format. This batch was not saved; try again.',
    '翻译结果格式异常，本批未保存，可重试。',
  ],
  [
    'The translation does not cover all source text. This batch was not saved; try again.',
    '译文未覆盖全部原文，本批未保存，可重试。',
  ],
  [
    'Translated paragraphs are duplicated. This batch was not saved; try again.',
    '译文段落重复，本批未保存，可重试。',
  ],
  [
    'Source paragraphs are missing from the translation. This batch was not saved; try again.',
    '译文缺少原文段落，本批未保存，可重试。',
  ],
  [
    'Translated paragraph mapping is incomplete. This batch was not saved; try again.',
    '译文段落对照不完整，本批未保存，可重试。',
  ],
  [
    'A matching translated paragraph is missing. This batch was not saved; try again.',
    '译文缺少对应段落，本批未保存，可重试。',
  ],
  [
    'Complete translation before exporting the PDF.',
    '请完成翻译后再导出 PDF。',
  ],
  [
    'The saved translated PDF record is incomplete. Generate it again.',
    '译文 PDF 的保存记录不完整，请重新生成。',
  ],
  [
    'Could not read the saved translated PDF. Generate it again.',
    '无法读取已保存的译文 PDF，请重新生成。',
  ],
  [
    'Translated PDF integrity check failed. Regenerate it before exporting.',
    '译文 PDF 完整性校验失败，请重新生成后再导出。',
  ],
  [
    'The saved translation is not a valid PDF. Generate it again.',
    '保存的译文不是有效 PDF，请重新生成。',
  ],
  [
    'Complete original-layout translation before exporting the PDF.',
    '请完成原版式翻译后再导出 PDF。',
  ],
  ['Translation stopped.', '已停止翻译'],
  [
    'This batch reached the model output limit and was not fully saved. Try again.',
    '本批译文达到模型长度限制，尚未完整保存，请重试。',
  ],
  [
    'The translation endpoint is only available locally.',
    '当前翻译接口仅供本机使用。',
  ],
  [
    'The document exceeds full translation capacity. Split the PDF.',
    '资料超过完整翻译容量，请拆分 PDF。',
  ],
  ['Invalid translation job generation.', '翻译任务代次不正确。'],
  ['Job ownership does not match.', '任务归属不一致。'],
  ['Invalid translation request format.', '翻译请求格式不正确。'],
  [
    'Translation stopped. Reopen the document to continue.',
    '翻译已停止，可重新打开后继续。',
  ],
  [
    'AI is not configured. Connect a model first.',
    'AI 尚未配置，请先接通模型。',
  ],
  [
    'Open AI service in Settings and enter your own DeepSeek API key.',
    '请先打开设置中的 AI 服务，填写自己的 DeepSeek API Key。',
  ],
  [
    'This translation is already running. Stop it first.',
    '同一翻译正在进行，请先停止。',
  ],
  [
    'The translation request has expired. You can continue translating.',
    '翻译请求已过期，可继续翻译。',
  ],
  [
    'Other documents are being translated. Try again later.',
    '正在翻译其他资料，请稍后重试。',
  ],
  [
    'Translation timed out. Completed text has been kept; you can continue.',
    '翻译超时，已保留完成的部分，可继续翻译。',
  ],
  [
    'The original-layout service is not running yet. Try later or use reflow translation.',
    '原版式服务尚未启动，可稍后重试或使用普通翻译。',
  ],
  [
    'The layout endpoint is only available locally.',
    '当前版式接口仅供本机使用。',
  ],
  [
    'Translated style markers are incomplete. This paragraph was not saved; try again.',
    '译文样式标记不完整，本段未保存，请重试。',
  ],
  [
    'Formula or text-style markers changed. This paragraph was not saved; try again.',
    '译文改变了公式或文字样式标记，本段未保存，请重试。',
  ],
  [
    'The source styles cannot be read reliably. Use reflow translation.',
    '原文样式无法可靠读取，请使用普通译文方式。',
  ],
  [
    'This paragraph has too many nested styles to split reliably. Use reflow translation.',
    '这个段落的样式层级过深，无法可靠分片，请使用普通译文方式。',
  ],
  [
    'Source text segments exceed full translation capacity.',
    '原文分片超过完整翻译容量。',
  ],
  [
    'Style boundaries moved in a long translated paragraph. It was not saved; try again.',
    '长段译文的样式边界被移动，本段未保存，请重试。',
  ],
  [
    'Source paragraph IDs are duplicated, so cached translations cannot be reused reliably.',
    '原文段落编号重复，无法可靠复用译文。',
  ],
  ['Invalid translation protection-marker format.', '译文保护标记格式不正确。'],
  ['Could not verify the translated segment cache.', '译文分片缓存无法核对。'],
  ['Reading PDF layout…', '正在读取 PDF 版式…'],
  ['Invalid translation job ID.', '翻译任务编号不正确。'],
  ['Invalid translation job ownership.', '翻译任务归属不正确。'],
  [
    'This translation job has been released. Start again.',
    '翻译任务已释放，可重新开始。',
  ],
  ['Translation job ownership does not match.', '翻译任务归属不一致。'],
  [
    'Provide a complete PDF no larger than 25 MB.',
    '请提供完整的 PDF，文件最大为 25 MB。',
  ],
  ['Invalid PDF page range.', 'PDF 页码范围不正确。'],
  ['This translation job already exists.', '同一翻译任务已存在。'],
  [
    'This translation job already exists. Start again.',
    '同一翻译任务已存在，请重新开始。',
  ],
  ['Translation stopped.', '翻译已停止。'],
  [
    'Layout processing did not pass checks. Translated text has been kept; retry or use reflow translation.',
    '版式处理未通过检查，已保留译文；可重试或使用普通译文方式。',
  ],
  [
    'Original-layout processing failed. Completed text has been kept; try again.',
    '原版式处理失败，已保留完成的译文，可重试。',
  ],
  [
    'Source layout read. Preparing translation…',
    '原文版式已读取，正在准备翻译…',
  ],
  [
    'Layout preparation is incomplete, or the job has been released.',
    '版式准备尚未完成，或任务已释放。',
  ],
  [
    'The translation does not cover all source text yet. Completed text has been kept.',
    '译文尚未覆盖全部原文，完成的部分已保留。',
  ],
  [
    'Translated paragraphs are incomplete or duplicated. Completed text has been kept.',
    '译文段落不完整或重复，完成的部分已保留。',
  ],
  [
    'Restoring the original layout and checking text and formulas…',
    '正在回填原版式并检查文字和公式…',
  ],
  [
    'The translation failed integrity or layout checks. Completed text has been kept; use reflow translation.',
    '译文未通过完整性或版式检查，已保留完成的译文；请使用普通译文方式。',
  ],
  ['Could not verify the generated translation.', '译文生成结果无法核对。'],
  [
    'Translation complete. Original-layout PDF passed checks.',
    '翻译完成，原版式 PDF 已通过检查。',
  ],
  ['The original-layout PDF is not complete yet.', '原版式 PDF 尚未完成。'],
  ['Invalid layout operation.', '版式操作不正确。'],
  ['Layout operation not found.', '未找到版式操作。'],
  [
    'The layout service only accepts local app requests.',
    '版式服务仅接受本机应用请求。',
  ],
  ['Invalid layout request format.', '版式请求格式不正确。'],
  ['PDF upload is incomplete. Try again.', 'PDF 上传不完整，请重试。'],
  ['Invalid PDF upload format.', 'PDF 上传格式不正确。'],
  ['Only one PDF is supported per request.', '每次仅支持一个 PDF。'],
  [
    'The layout service cannot process the request right now. Try again.',
    '版式服务暂时无法处理请求，请重试。',
  ],
  [
    'Invalid API key. Check the local configuration.',
    'API Key 无效，请检查本机配置。',
  ],
  [
    'Your DeepSeek API balance is insufficient. Check your balance on the provider platform.',
    'DeepSeek API 余额不足，请在开放平台查看余额。',
  ],
  [
    'Too many DeepSeek requests. Try again later.',
    'DeepSeek 请求过于频繁，请稍后重试。',
  ],
  [
    'DeepSeek cannot complete the request right now. Try again later.',
    'DeepSeek 暂时无法完成研究请求，请稍后重试。',
  ],
  ['The model request failed. Try again.', '模型研究请求失败，请重试。'],
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
    'The connection was interrupted before the response finished. Try again.',
    '连接中断，研究尚未完成，请重试。',
  ],
  [
    'This PDF is encrypted. Provide a file that opens without a password.',
    '这个 PDF 已加密，请先提供可直接打开的文件。',
  ],
  [
    'Original-layout translation supports PDFs of up to 500 pages.',
    '原版式翻译暂时支持最多 500 页的 PDF。',
  ],
  [
    'This PDF uses unsupported legacy Type3 fonts, so its text cannot be restored reliably. Use reflow translation.',
    '这个 PDF 使用暂不支持的旧 Type3 字体，无法可靠还原文字；请使用普通译文方式。',
  ],
  [
    'This PDF exceeds full text translation capacity. Split it and try again.',
    '这个 PDF 的文字超过完整翻译容量，请拆分后重试。',
  ],
  [
    'This PDF has no extractable text. Scanned-document recognition is not available yet.',
    '这个 PDF 没有可提取文字，扫描件识别尚未接入。',
  ],
  [
    'Translatable paragraphs could not be extracted reliably. Use reflow translation.',
    '没有可靠提取到可翻译段落，请使用普通译文方式。',
  ],
  [
    'The source font encoding cannot be read reliably. Original-layout translation stopped; use reflow translation.',
    '原文字体编码无法可靠读取，已停止原版式翻译；请使用普通译文方式。',
  ],
  [
    'The source font sizes are invalid, so the layout cannot be restored reliably. Use reflow translation.',
    '原文字号信息异常，无法可靠还原版式；请使用普通译文方式。',
  ],
  [
    'This PDF cannot be read reliably. Check that the file is complete.',
    '这个 PDF 无法可靠读取，请检查文件是否完整。',
  ],
];

const messages = new Map(
  pairs.flatMap(
    (pair) =>
      [
        [pair[0], pair],
        [pair[1], pair],
      ] as const,
  ),
);

export function pdfSystemMessage(message: string): string {
  const pair = messages.get(message);
  if (pair) return translate(pair[0], pair[1]);
  const tallPage = /^原文第 (\d+) 页的译文过长，无法在一张可阅读的 PDF 页面内展示。译文已保留。$/.exec(message);
  if (tallPage) return translate('The translation of source page {page} is too long for one readable PDF sheet. The translation has been kept.', '原文第 {page} 页的译文过长，无法在一张可阅读的 PDF 页面内展示。译文已保留。', { page: tallPage[1] });
  const reading = /^(?:正在读取第 |Reading page )(\d+) \/ (\d+)(?: 页)?$/.exec(
    message,
  );
  if (reading)
    return translate(
      'Reading page {page} / {total}',
      '正在读取第 {page} / {total} 页',
      { page: reading[1], total: reading[2] },
    );
  const translating =
    /^(?:正在翻译原文第 |Translating source pages? )([\d、, ]+)(?: 页)?$/.exec(
      message,
    );
  if (translating) {
    const pages = translating[1].split(/[、,]\s*/).join(', ');
    return translate(
      'Translating source pages {pages}',
      '正在翻译原文第 {pages} 页',
      { pages },
    );
  }
  const font =
    /^(?:导出字体暂不支持这些字符：|The export font does not support: )(.*?)(?:。译文已保留。|\. Translation has been kept\.)$/.exec(
      message,
    );
  if (font)
    return translate(
      'The export font does not support: {characters}. Translation has been kept.',
      '导出字体暂不支持这些字符：{characters}。译文已保留。',
      { characters: font[1] },
    );
  return translateSystemMessage(message);
}
